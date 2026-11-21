/**
 * Seam `HistoryCipher` — how the history protects what it keeps (docs/replaceable-behaviors.md). Two implementations:
 * `noCipher` (the default: no master password, nothing is encrypted, secret kinds are not recorded) and
 * `passwordCipher` (an optional master password). Tools never see it: the factory (factory.ts) seals and opens.
 *
 * Construction (WebCrypto only, standard primitives; docs/tools/history-format.md §9):
 *   - a random 256-bit DATA KEY (master secret) per keyring;
 *   - HKDF-SHA-256 (RFC 5869) derives from it: the content key (AES-256-GCM), the blob-id key (HMAC-SHA-256) and the
 *     key-wrapping key for other keyrings (AES-KW);
 *   - a record's content: AES-256-GCM (NIST SP 800-38D), a fresh random 96-bit nonce per record, the record's identity
 *     (envelope version, id, owner, kind, session, time, schema and its clear blob references) as additional data, so a
 *     ciphertext moved to another record does not open;
 *   - a blob: id = HMAC-SHA-256(blob-id key, bytes) (equal blobs still deduplicate, a plaintext hash does not leak),
 *     bytes = nonce ‖ AES-256-GCM(content key, nonce, bytes, additional data = the id);
 *   - the password only WRAPS the data key: KEK = PBKDF2-HMAC-SHA-256(password, 128-bit random salt, 600 000
 *     iterations — OWASP Password Storage Cheat Sheet) → AES-KW (RFC 3394). Changing the password re-wraps one key;
 *     the parameters are stored with the wrapped key, so they can be raised later.
 * The unwrapped data key lives only in memory: in the KeyHolder (the extension's keeps its raw bytes in
 * chrome.storage.session, memory only, so the tabs share one unlock) and, per page, as non-extractable CryptoKeys.
 */
import { concatBytes, fromBase64, fromUtf8, idGenerator, toBase64, toHex, utf8 } from './bytes';
import type { BlobRef, JsonValue, Sealed } from './envelope';

export type CipherState = 'none' | 'locked' | 'unlocked';

/** The clear identity of a record, bound to its ciphertext. */
export interface RecordIdentity {
  v: number;
  id: string;
  owner: string;
  kind: string;
  session: string;
  time: string;
  schema: number;
  /** The clear blob references (hash, size). */
  blobs: readonly BlobRef[];
}

/** What an encrypted record carries inside its ciphertext. */
export interface SealedContent {
  label?: string;
  text?: string;
  payload?: JsonValue;
  blobs?: readonly BlobRef[];
}

export interface HistoryCipher {
  state(): CipherState;
  subscribe(listener: () => void): () => void;
  /** The kid new records are sealed with (unlocked only). */
  activeKid(): string | undefined;
  sealRecord(identity: RecordIdentity, content: SealedContent): Promise<Sealed>;
  openRecord(identity: RecordIdentity, sealed: Sealed): Promise<SealedContent>;
  /** Keyed id of blob bytes under the active key. */
  blobId(bytes: Uint8Array<ArrayBuffer>): Promise<string>;
  sealBlob(id: string, bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
  openBlob(id: string, kid: string, stored: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>>;
}

export class LockedError extends Error {
  constructor() {
    super('the history is locked');
  }
}
export class WrongPasswordError extends Error {
  constructor() {
    super('wrong password');
  }
}
export class DamagedError extends Error {}

/** No master password: nothing to seal or open. */
export const noCipher: HistoryCipher = {
  state: () => 'none',
  subscribe: () => () => {},
  activeKid: () => undefined,
  sealRecord: () => Promise.reject(new LockedError()),
  openRecord: () => Promise.reject(new LockedError()),
  blobId: () => Promise.reject(new LockedError()),
  sealBlob: () => Promise.reject(new LockedError()),
  openBlob: () => Promise.reject(new LockedError()),
};

// --- Keyrings -------------------------------------------------------------------------------------------------------

export interface KdfParams {
  name: 'PBKDF2';
  hash: 'SHA-256';
  iterations: number;
  /** Base64, 16 bytes. */
  salt: string;
}

/**
 * A keyring: one data key, wrapped. Stored in the history (and exported) as its JSON line.
 *   {"v":1,"kid":"01JD…","created":"…","kdf":{"name":"PBKDF2","hash":"SHA-256","iterations":600000,"salt":"…"},
 *    "wrap":{"alg":"AES-KW","by":"password"},"key":"<Base64 of the wrapped 32 bytes>"}
 * `wrap.by` is "password" (the KEK comes from the password and `kdf`) or the kid of another keyring whose wrapping key
 * wraps this one (a keyring brought in by an import, adopted under the history's own password).
 */
export interface Keyring {
  v: number;
  kid: string;
  created: string;
  kdf?: KdfParams;
  wrap: { alg: 'AES-KW'; by: string };
  key: string;
}

export const KDF_ITERATIONS = 600_000;
const nextId = idGenerator();

const kwAlgorithm = { name: 'AES-KW', length: 256 } as const;

/** PBKDF2-HMAC-SHA-256 bits (exposed for the known-answer test). */
export const pbkdf2Bits = async (password: string, salt: Uint8Array<ArrayBuffer>, iterations: number, bits: number) => {
  const base = await crypto.subtle.importKey('raw', utf8(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, bits),
  );
};

/** HKDF-SHA-256 bits (exposed for the known-answer test). */
export const hkdfBits = async (
  ikm: Uint8Array<ArrayBuffer>,
  salt: Uint8Array<ArrayBuffer>,
  info: Uint8Array<ArrayBuffer>,
  bits: number,
) => {
  const base = await crypto.subtle.importKey('raw', ikm, 'HKDF', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt, info }, base, bits));
};

const passwordKek = async (password: string, kdf: KdfParams): Promise<CryptoKey> => {
  // NFC: the same password typed on another system gives the same bytes.
  const base = await crypto.subtle.importKey('raw', utf8(password.normalize('NFC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: kdf.hash, salt: fromBase64(kdf.salt), iterations: kdf.iterations },
    base,
    kwAlgorithm,
    false,
    ['wrapKey', 'unwrapKey'],
  );
};

/** The keys one data key gives (all non-extractable). */
export interface DataKeys {
  kid: string;
  content: CryptoKey;
  blobId: CryptoKey;
  wrap: CryptoKey;
}

const EMPTY = new Uint8Array(0);

export const dataKeys = async (kid: string, raw: Uint8Array<ArrayBuffer>): Promise<DataKeys> => {
  const base = await crypto.subtle.importKey('raw', raw, 'HKDF', false, ['deriveKey']);
  const derive = (info: string, algorithm: AesKeyAlgorithm | HmacImportParams, usages: KeyUsage[]) =>
    crypto.subtle.deriveKey(
      { name: 'HKDF', hash: 'SHA-256', salt: EMPTY, info: utf8(info) },
      base,
      algorithm,
      false,
      usages,
    );
  return {
    kid,
    content: await derive('tool-history content v1', { name: 'AES-GCM', length: 256 }, ['encrypt', 'decrypt']),
    blobId: await derive('tool-history blob-id v1', { name: 'HMAC', hash: 'SHA-256', length: 256 }, ['sign']),
    wrap: await derive('tool-history wrap v1', kwAlgorithm, ['wrapKey', 'unwrapKey']),
  };
};

const wrapRaw = async (raw: Uint8Array<ArrayBuffer>, kek: CryptoKey): Promise<string> => {
  // AES-KW wraps a CryptoKey: the raw secret goes in as a throwaway extractable AES key, used for nothing else.
  const carrier = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, true, ['encrypt']);
  return toBase64(new Uint8Array(await crypto.subtle.wrapKey('raw', carrier, kek, 'AES-KW')));
};

const unwrapRaw = async (wrapped: string, kek: CryptoKey): Promise<Uint8Array<ArrayBuffer>> => {
  const carrier = await crypto.subtle.unwrapKey('raw', fromBase64(wrapped), kek, 'AES-KW', { name: 'AES-GCM' }, true, [
    'encrypt',
  ]);
  return new Uint8Array(await crypto.subtle.exportKey('raw', carrier));
};

export const keyringLine = (k: Keyring): string =>
  JSON.stringify({
    v: k.v,
    kid: k.kid,
    created: k.created,
    ...(k.kdf ? { kdf: k.kdf } : {}),
    wrap: k.wrap,
    key: k.key,
  });

export const parseKeyring = (line: string): Keyring => {
  const k = JSON.parse(line) as Keyring;
  if (!k || typeof k.kid !== 'string' || typeof k.key !== 'string' || k.wrap?.alg !== 'AES-KW')
    throw new DamagedError('not a keyring');
  if (k.wrap.by === 'password' && (k.kdf?.name !== 'PBKDF2' || !(k.kdf.iterations > 0)))
    throw new DamagedError('keyring without key derivation');
  return k;
};

/** A new data key wrapped under `password`; returns the keyring and the raw key (for the holder). */
export const createKeyring = async (
  password: string,
  now: number,
  iterations = KDF_ITERATIONS,
): Promise<{ keyring: Keyring; raw: Uint8Array<ArrayBuffer> }> => {
  const raw = crypto.getRandomValues(new Uint8Array(32));
  const kdf: KdfParams = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
    salt: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  };
  const keyring: Keyring = {
    v: 1,
    kid: nextId(now),
    created: new Date(now).toISOString(),
    kdf,
    wrap: { alg: 'AES-KW', by: 'password' },
    key: await wrapRaw(raw, await passwordKek(password, kdf)),
  };
  return { keyring, raw };
};

/** The raw data key of a password keyring; WrongPasswordError when AES-KW's integrity check fails. */
export const unlockKeyring = async (keyring: Keyring, password: string): Promise<Uint8Array<ArrayBuffer>> => {
  if (keyring.wrap.by !== 'password' || !keyring.kdf) throw new DamagedError('not a password keyring');
  try {
    return await unwrapRaw(keyring.key, await passwordKek(password, keyring.kdf));
  } catch {
    throw new WrongPasswordError();
  }
};

/** The same data key under a new password (and fresh salt, current iterations). */
export const rewrapKeyring = async (
  keyring: Keyring,
  raw: Uint8Array<ArrayBuffer>,
  password: string,
  iterations = KDF_ITERATIONS,
): Promise<Keyring> => {
  const kdf: KdfParams = {
    name: 'PBKDF2',
    hash: 'SHA-256',
    iterations,
    salt: toBase64(crypto.getRandomValues(new Uint8Array(16))),
  };
  return {
    ...keyring,
    kdf,
    wrap: { alg: 'AES-KW', by: 'password' },
    key: await wrapRaw(raw, await passwordKek(password, kdf)),
  };
};

/** A foreign keyring adopted under one of ours: its data key wrapped by our wrapping key. */
export const adoptKeyring = async (foreign: Keyring, foreignRaw: Uint8Array<ArrayBuffer>, by: DataKeys) => {
  const adopted: Keyring = {
    v: foreign.v,
    kid: foreign.kid,
    created: foreign.created,
    wrap: { alg: 'AES-KW', by: by.kid },
    key: await wrapRaw(foreignRaw, by.wrap),
  };
  return adopted;
};

export const unwrapAdopted = (keyring: Keyring, by: DataKeys): Promise<Uint8Array<ArrayBuffer>> =>
  unwrapRaw(keyring.key, by.wrap);

// --- Sealing --------------------------------------------------------------------------------------------------------

const recordAad = (r: RecordIdentity): Uint8Array<ArrayBuffer> =>
  utf8(
    JSON.stringify([
      'tool-history record v1',
      r.v,
      r.id,
      r.owner,
      r.kind,
      r.session,
      r.time,
      r.schema,
      r.blobs.map(b => [b.hash, b.size]),
    ]),
  );
const blobAad = (id: string) => utf8(`tool-history blob v1 ${id}`);

export const sealWith = async (keys: DataKeys, identity: RecordIdentity, content: SealedContent): Promise<Sealed> => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, additionalData: recordAad(identity) },
    keys.content,
    utf8(JSON.stringify(content)),
  );
  return { alg: 'A256GCM', kid: keys.kid, iv: toBase64(iv), ct: toBase64(new Uint8Array(ct)) };
};

export const openWith = async (keys: DataKeys, identity: RecordIdentity, sealed: Sealed): Promise<SealedContent> => {
  if (sealed.alg !== 'A256GCM') throw new DamagedError(`unknown algorithm ${sealed.alg}`);
  let plain: ArrayBuffer;
  try {
    plain = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: fromBase64(sealed.iv), additionalData: recordAad(identity) },
      keys.content,
      fromBase64(sealed.ct),
    );
  } catch {
    throw new DamagedError('the record does not open: changed, moved, or not this key');
  }
  return JSON.parse(fromUtf8(new Uint8Array(plain))) as SealedContent;
};

export const blobIdWith = async (keys: DataKeys, bytes: Uint8Array<ArrayBuffer>): Promise<string> =>
  `hmac256-${toHex(new Uint8Array(await crypto.subtle.sign('HMAC', keys.blobId, bytes)))}`;

export const sealBlobWith = async (keys: DataKeys, id: string, bytes: Uint8Array<ArrayBuffer>) => {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: blobAad(id) }, keys.content, bytes);
  return concatBytes([iv, new Uint8Array(ct)]);
};

export const openBlobWith = async (keys: DataKeys, id: string, stored: Uint8Array<ArrayBuffer>) => {
  let plain: Uint8Array<ArrayBuffer>;
  try {
    plain = new Uint8Array(
      await crypto.subtle.decrypt(
        { name: 'AES-GCM', iv: stored.slice(0, 12), additionalData: blobAad(id) },
        keys.content,
        stored.slice(12),
      ),
    );
  } catch {
    throw new DamagedError('the blob does not open');
  }
  if ((await blobIdWith(keys, plain)) !== id) throw new DamagedError('the blob is not the one its id names');
  return plain;
};

// --- Where the unwrapped key lives -------------------------------------------------------------------------------------

/**
 * Seam `KeyHolder` — where the raw data keys of an unlocked history live while it is unlocked. Memory of this page by
 * default (memoryKeyHolder); the extension's keeps them in chrome.storage.session (memory only, shared by its pages,
 * cleared when the browser closes) and locks after idle time. Raw keys never go to persistent storage.
 */
export interface KeyHolder {
  /** kid → raw key; empty when locked. */
  get(): Promise<Map<string, Uint8Array<ArrayBuffer>>>;
  set(keys: Map<string, Uint8Array<ArrayBuffer>>): Promise<void>;
  clear(): Promise<void>;
  /** Called when another page locked or unlocked. */
  subscribe(listener: () => void): () => void;
}

export const memoryKeyHolder = (): KeyHolder => {
  let keys = new Map<string, Uint8Array<ArrayBuffer>>();
  const listeners = new Set<() => void>();
  return {
    get: async () => new Map(keys),
    set: async next => {
      keys = new Map(next);
      listeners.forEach(l => l());
    },
    clear: async () => {
      keys = new Map();
      listeners.forEach(l => l());
    },
    subscribe: l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
  };
};

/** Where keyrings are kept (the history store does it: they travel with an export). */
export interface KeyringStore {
  keyrings(): Promise<Map<string, string>>;
  putKeyring(kid: string, line: string): Promise<void>;
  deleteKeyring(kid: string): Promise<void>;
}

/** What the settings can do with a master password, on top of the cipher. */
export interface PasswordVault extends HistoryCipher {
  /** Read the keyrings (after an import, a change elsewhere). */
  refresh(): Promise<void>;
  hasPassword(): boolean;
  setPassword(password: string): Promise<void>;
  unlock(password: string): Promise<void>;
  lock(): Promise<void>;
  changePassword(current: string, next: string): Promise<void>;
  /** Forget the keyrings (after their records were deleted): the history has no password again. */
  removePassword(): Promise<void>;
  /**
   * Bring in a keyring of another history (an import): `foreign` is wrapped by its own password, `children` are keyrings
   * adopted under it there. With that password (and this history unlocked) it is re-wrapped under this history's key, so
   * one password opens everything. A history holds at most one keyring wrapped by a password.
   */
  adopt(foreign: Keyring, password: string, children: readonly Keyring[]): Promise<void>;
  /** The active (password) keyring, if any. */
  activeKeyring(): Keyring | undefined;
  /** Derivation time of the last unlock, ms (for the settings' note). */
  lastUnlockMs(): number | undefined;
}

/**
 * The password implementation. Keyrings come from `keyrings` (the store); the unwrapped keys go to `holder`. Exactly one
 * keyring is wrapped by the password (the active one); adopted keyrings open through it.
 */
export const passwordCipher = (deps: {
  keyrings: KeyringStore;
  holder: KeyHolder;
  now?: () => number;
  iterations?: number;
}): PasswordVault => {
  const now = deps.now ?? Date.now;
  const iterations = deps.iterations ?? KDF_ITERATIONS;
  let rings = new Map<string, Keyring>();
  let keys = new Map<string, DataKeys>();
  let unlockMs: number | undefined;
  const listeners = new Set<() => void>();
  const notify = () => listeners.forEach(l => l());
  const active = (): Keyring | undefined => [...rings.values()].find(k => k.wrap.by === 'password');

  const loadKeys = async () => {
    const raw = await deps.holder.get();
    const next = new Map<string, DataKeys>();
    for (const [kid, bytes] of raw) if (rings.has(kid)) next.set(kid, await dataKeys(kid, bytes));
    keys = next;
  };

  const refresh = async () => {
    const lines = await deps.keyrings.keyrings();
    const next = new Map<string, Keyring>();
    for (const [kid, line] of lines) {
      try {
        next.set(kid, parseKeyring(line));
      } catch {
        // a damaged keyring opens nothing; its records stay locked
      }
    }
    rings = next;
    await loadKeys();
    notify();
  };

  // Another page locked, unlocked or set a password: read the keyrings again too (a new one may be among them).
  deps.holder.subscribe(() => {
    refresh().catch(notify);
  });

  /** Raw keys of the active keyring and of every keyring adopted under an opened one. */
  const openAll = async (activeRaw: Uint8Array<ArrayBuffer>, ring: Keyring) => {
    const raw = new Map<string, Uint8Array<ArrayBuffer>>([[ring.kid, activeRaw]]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const k of rings.values()) {
        if (raw.has(k.kid) || !raw.has(k.wrap.by)) continue;
        try {
          raw.set(k.kid, await unwrapAdopted(k, await dataKeys(k.wrap.by, raw.get(k.wrap.by)!)));
          grew = true;
        } catch {
          // a damaged adopted keyring stays locked
        }
      }
    }
    return raw;
  };

  const keysFor = (kid: string): DataKeys => {
    const k = keys.get(kid);
    if (!k) throw new LockedError();
    return k;
  };
  const activeKeys = (): DataKeys => {
    const ring = active();
    if (!ring) throw new LockedError();
    return keysFor(ring.kid);
  };

  return {
    state: () => (!active() ? 'none' : keys.has(active()!.kid) ? 'unlocked' : 'locked'),
    subscribe: l => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    activeKid: () => (active() && keys.has(active()!.kid) ? active()!.kid : undefined),
    sealRecord: async (identity, content) => sealWith(activeKeys(), identity, content),
    openRecord: async (identity, sealed) => openWith(keysFor(sealed.kid), identity, sealed),
    blobId: async bytes => blobIdWith(activeKeys(), bytes),
    sealBlob: async (id, bytes) => sealBlobWith(activeKeys(), id, bytes),
    openBlob: async (id, kid, stored) => openBlobWith(keysFor(kid), id, stored),
    refresh,
    hasPassword: () => !!active(),
    setPassword: async password => {
      if (active()) throw new Error('a master password is already set');
      const { keyring, raw } = await createKeyring(password, now(), iterations);
      await deps.keyrings.putKeyring(keyring.kid, keyringLine(keyring));
      rings.set(keyring.kid, keyring);
      await deps.holder.set(new Map([[keyring.kid, raw]]));
      await loadKeys();
      notify();
    },
    unlock: async password => {
      const ring = active();
      if (!ring) throw new Error('no master password is set');
      const t0 = performance.now();
      const raw = await unlockKeyring(ring, password);
      unlockMs = performance.now() - t0;
      await deps.holder.set(await openAll(raw, ring));
      await loadKeys();
      notify();
    },
    lock: async () => {
      await deps.holder.clear();
      keys = new Map();
      notify();
    },
    changePassword: async (current, next) => {
      const ring = active();
      if (!ring) throw new Error('no master password is set');
      const raw = await unlockKeyring(ring, current);
      const rewrapped = await rewrapKeyring(ring, raw, next, iterations);
      await deps.keyrings.putKeyring(ring.kid, keyringLine(rewrapped));
      rings.set(ring.kid, rewrapped);
      notify();
    },
    removePassword: async () => {
      for (const kid of rings.keys()) await deps.keyrings.deleteKeyring(kid);
      rings = new Map();
      await deps.holder.clear();
      keys = new Map();
      notify();
    },
    adopt: async (foreign, password, children) => {
      const ring = active();
      if (!ring || foreign.wrap.by !== 'password') throw new Error('nothing to adopt');
      const by = activeKeys();
      const raw = await unlockKeyring(foreign, password);
      const adopted = await adoptKeyring(foreign, raw, by);
      for (const k of [adopted, ...children]) {
        await deps.keyrings.putKeyring(k.kid, keyringLine(k));
        rings.set(k.kid, k);
      }
      const held = await deps.holder.get();
      await deps.holder.set(new Map([...held, ...(await openAll(held.get(ring.kid)!, ring))]));
      await loadKeys();
      notify();
    },
    activeKeyring: active,
    lastUnlockMs: () => unlockMs,
  };
};
