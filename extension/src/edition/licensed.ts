/**
 * `EditionSource` that follows a signed licence: the record `entitlement` in chrome.storage.local, which only the
 * service worker writes (src/shared/licenceRecords.ts). The page checks the token's signature itself with the keys the
 * build trusts (seam LicenceConfig, src/licence) and computes the state with the clock and the record's clock mark
 * (`evaluate`, @extension/licence); it never writes and never goes to the network. `unknown` until the record is read;
 * then each change of the record — activation, a check, deactivation in another tab — and each boundary of the token
 * (time to check, the warning, the end) reaches the open page without a reload. Settings → Pro gets its controls
 * (`licence`), which ask the worker (./licenceClient.ts).
 */
import { licenceClient } from './licenceClient';
import { evaluate, nextBoundary, verifyToken } from '@extension/licence';
import { licence as licenceConfig } from '@src/licence';
import { hostOf } from '@src/licence/config';
import { ENTITLEMENT_KEY, readEntitlement } from '@src/shared/licenceRecords';
import type { EditionSource, EditionSourceEnvironment, EditionSourceFactory, SourceState } from './source';
import type { PublicKeyEntry, Stored, Verified } from '@extension/licence';

/** The longest delay setTimeout keeps (about 24.8 days); a boundary further away is reached in steps. */
const MAX_DELAY_MS = 2 ** 31 - 1;

const sameState = (a: SourceState, b: SourceState): boolean => JSON.stringify(a) === JSON.stringify(b);

export const licensedSource = (
  env: EditionSourceEnvironment & {
    readonly keys: readonly PublicKeyEntry[];
    readonly host: string | undefined;
  },
): EditionSource => {
  const now = env.now ?? Date.now;
  const { local, onChanged } = env.chrome.storage;
  const listeners = new Set<(state: SourceState) => void>();
  let state: SourceState = { kind: 'unknown' };
  let read: { readonly stored: Stored; readonly seen: number } | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let disposed = false;
  /** Each read starts a generation; a check that finishes in an older one changes nothing. */
  let generation = 0;
  let known: (state: SourceState) => void = () => undefined;
  const ready = new Promise<SourceState>(resolve => (known = resolve));

  // The last token's check, kept by its text: a change of the mark alone needs no new check of the signature.
  let checked: { readonly token: string; readonly verified: Promise<Verified> } | undefined;
  const verifiedOf = (token: string): Promise<Verified> => {
    if (checked?.token !== token) checked = { token, verified: verifyToken(token, env.keys, env.subtle) };
    return checked.verified;
  };

  const set = (next: SourceState) => {
    if (sameState(next, state)) return;
    state = next;
    if (next.kind !== 'unknown') known(next);
    for (const listener of [...listeners]) {
      try {
        listener(next);
      } catch {
        // One listener's failure is its own: the others still hear the change.
      }
    }
  };

  const decide = () => {
    clearTimeout(timer);
    timer = undefined;
    if (disposed || !read) return;
    const at = now();
    set(evaluate(read.stored, at, read.seen));
    const boundary = nextBoundary(read.stored, at, read.seen);
    if (boundary !== undefined) timer = setTimeout(decide, Math.min(Math.max(boundary - at, 0), MAX_DELAY_MS));
  };

  const take = async (raw: unknown) => {
    const mine = ++generation;
    const record = readEntitlement(raw);
    let stored: Stored;
    if (record === 'none') stored = { kind: 'none' };
    else if (record === 'unreadable') stored = { kind: 'unreadable' };
    else {
      const verified = await verifiedOf(record.token);
      if (mine !== generation || disposed) return;
      stored = verified.ok
        ? { kind: 'token', claims: verified.claims, inst: record.inst }
        : { kind: 'rejected', reason: verified.reason };
    }
    read = { stored, seen: typeof record === 'object' ? record.seen : 0 };
    decide();
  };

  /** A storage that cannot be read gives `invalid: unreadable` — as the free edition, never a guess. */
  const unreadable = () => {
    if (disposed) return;
    ++generation;
    read = { stored: { kind: 'unreadable' }, seen: 0 };
    decide();
  };

  const changed = (changes: Record<string, chrome.storage.StorageChange>, area: string) => {
    if (area !== 'local' || !(ENTITLEMENT_KEY in changes)) return;
    take(changes[ENTITLEMENT_KEY].newValue).catch(unreadable);
  };
  onChanged.addListener(changed);

  // After sleep, timers run late: the state is decided again when the page is seen.
  const doc = typeof document === 'undefined' ? undefined : document;
  const visible = () => {
    if (doc?.visibilityState === 'visible') decide();
  };
  doc?.addEventListener('visibilitychange', visible);

  // The first read; a change heard meanwhile is newer and wins (its generation is later). A storage that never answers
  // leaves the state `unknown` (the free edition): the page does not wait for it longer than 2 s (src/app/main.tsx).
  const first = generation;
  local
    .get(ENTITLEMENT_KEY)
    .then(rows => {
      if (generation === first) return take((rows as Record<string, unknown>)[ENTITLEMENT_KEY]);
    })
    .catch(unreadable);

  return {
    id: 'licensed',
    current: () => state,
    ready,
    subscribe: listener => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    licence: licenceClient(env.chrome.runtime, env.host),
    dispose: () => {
      disposed = true;
      clearTimeout(timer);
      timer = undefined;
      listeners.clear();
      onChanged.removeListener(changed);
      doc?.removeEventListener('visibilitychange', visible);
    },
  };
};

/** The source of a build that follows the licence: keys and host from the licence root (src/licence). */
export const licensed: EditionSourceFactory = Object.assign(
  (env: EditionSourceEnvironment) => licensedSource({ ...env, keys: licenceConfig.keys, host: hostOf(licenceConfig) }),
  { id: 'licensed' as const },
);
