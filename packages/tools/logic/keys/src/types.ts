/**
 * The key model and the names of the forms (docs/tools/specs/keys.md §9). A key is its numbers as unsigned big-endian
 * bytes — the JWK members, decoded — whatever form it was read from; every form is written from them.
 */
export type Curve = 'P-256' | 'P-384' | 'P-521';
export type Okp = 'Ed25519' | 'X25519';

export interface RsaPrivate {
  d: Uint8Array;
  p: Uint8Array;
  q: Uint8Array;
  dp: Uint8Array;
  dq: Uint8Array;
  qi: Uint8Array;
}

export type KeyData =
  | { type: 'rsa'; n: Uint8Array; e: Uint8Array; priv?: RsaPrivate }
  /** `x` (and `y`) are absent when a private key came without its public key, until `completeKey` derives them. */
  | { type: 'ec'; curve: Curve; x?: Uint8Array; y?: Uint8Array; d?: Uint8Array }
  | { type: 'okp'; curve: Okp; x?: Uint8Array; d?: Uint8Array };

export type RsaKey = Extract<KeyData, { type: 'rsa' }>;
export type EcKey = Extract<KeyData, { type: 'ec' }>;
export type OkpKey = Extract<KeyData, { type: 'okp' }>;

export type SourceForm =
  'spki' | 'pkcs1' | 'pkcs8' | 'sec1' | 'openssh' | 'rfc4716' | 'jwk' | 'jwks' | 'der' | 'generated';

/** What a JWK said besides the key: kept and shown, written back into the JWK forms. */
export interface JwkMeta {
  kid?: string;
  alg?: string;
  use?: string;
  key_ops?: string[];
}

export interface ReadKey {
  data: KeyData;
  source: SourceForm;
  /** The OpenSSH comment (a public line, RFC 4716 `Comment:`, an openssh-key-v1 file, or the one typed in Generate). */
  comment?: string;
  jwk?: JwkMeta;
  notes: string[];
  /** Set by readKeys: the source said it holds a public key next to the private one (it is checked, §5.6). */
  storedPublic?: Uint8Array;
}

export type ReadItem = { ok: true; key: ReadKey } | { ok: false; message: string };

export interface ReadResult {
  /** One per key found (PEM block, set member, line), at most MAX_KEYS. */
  items: ReadItem[];
  /** Nothing readable at all: why. */
  message?: string;
  /** About the input as a whole (`Only the first 20 keys are shown.`, a skipped EC PARAMETERS block). */
  notes: string[];
}

export type PublicForm = 'pem' | 'pkcs1' | 'openssh' | 'jwk';
export type PrivateForm = 'pkcs8' | 'traditional' | 'openssh' | 'jwk';

export const isPrivate = (data: KeyData): boolean =>
  data.type === 'rsa' ? data.priv !== undefined : data.d !== undefined;

/** Is the public part known (always for RSA; EC and OKP until derived from a private key without it)? */
export const hasPublic = (data: KeyData): boolean => (data.type === 'rsa' ? true : data.x !== undefined);
