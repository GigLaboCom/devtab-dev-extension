/**
 * The key a person gives (docs/tools/specs/jwt.md §3, §5.4): an HMAC secret in one of four formats, or a public key —
 * PEM (`PUBLIC KEY`, `RSA PUBLIC KEY`, `CERTIFICATE`), a JWK or a JWKS, told apart by the text itself. A private key
 * is refused, never trimmed down to its public half. Which key of a set is used, and whether it fits the token's
 * algorithm, is decided when verifying (verify.ts), because that needs the header.
 */
import { decodeBase64url } from './base64url';
import { isObject } from './decode';
import { spkiKind, spkiOfCertificate, spkiOfPkcs1, unsignedBits } from './der';
import { parseBase64 } from '@workspace/tools-shared/base64';
import type { SpkiKind } from './der';

export type SecretFormat = 'text' | 'base64' | 'hex' | 'jwk';
export type KeyInput = { kind: 'secret'; text: string; format: SecretFormat } | { kind: 'public'; text: string };

/** A JSON Web Key as pasted (RFC 7517): the members this tool reads; the rest is kept and ignored. */
export type Jwk = {
  kty?: unknown;
  crv?: unknown;
  kid?: unknown;
  alg?: unknown;
  use?: unknown;
  key_ops?: unknown;
  [member: string]: unknown;
};

export type VerifyKey =
  // jwk: the oct JWK the secret came from (its alg, use, key_ops are checked); looksPublic: text that starts like a
  // public key, given as a Text secret (algorithm confusion, §5.4)
  | { type: 'secret'; bytes: Uint8Array; jwk?: Jwk; looksPublic?: true }
  | { type: 'spki'; der: Uint8Array; fromCertificate: boolean }
  | { type: 'jwk'; jwk: Jwk };

export type ParsedKey =
  // set: a JWKS — the key is chosen by the token's kid, or by kty and crv (verify.ts)
  | { ok: true; description: string; warnings: string[]; candidates: VerifyKey[]; set?: true }
  // message '': nothing entered yet (no message to show)
  | { ok: false; message: string; private?: true };

export const PRIVATE_KEY =
  "This is a private key. Verification needs only the public key; don't paste private keys here.";
export const CERTIFICATE_NOTE = 'Key taken from a certificate. The certificate itself is not checked.';
export const PASTE_A_KEY = 'Paste a PEM key, a certificate, a JWK or a JWKS.';
const NOTHING: ParsedKey = { ok: false, message: '' };
const PRIVATE: ParsedKey = { ok: false, message: PRIVATE_KEY, private: true };
const PRIVATE_MEMBERS = ['d', 'p', 'q', 'dp', 'dq', 'qi', 'oth'];

const hasPrivateMembers = (jwk: Jwk): boolean => PRIVATE_MEMBERS.some(m => m in jwk);
const secretDescription = (bytes: Uint8Array): string => `${bytes.length}-byte secret (${bytes.length * 8} bits)`;
const HEX_DIGITS = '0123456789abcdef';

/** `zz` → "Position 1: "z" is not a hex digit." (§6); whitespace anywhere is skipped. */
const parseHex = (text: string): { bytes: Uint8Array } | { message: string } => {
  const digits: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (/\s/.test(c)) continue;
    const v = HEX_DIGITS.indexOf(c.toLowerCase());
    if (v < 0)
      return {
        message: `Position ${i + 1}: ${JSON.stringify(String.fromCodePoint(text.codePointAt(i)!))} is not a hex digit.`,
      };
    digits.push(v);
  }
  if (digits.length % 2 === 1) return { message: 'The hex secret has an odd number of digits.' };
  const bytes = new Uint8Array(digits.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = digits[2 * i]! * 16 + digits[2 * i + 1]!;
  return { bytes };
};

const parseSecret = (text: string, format: SecretFormat): ParsedKey => {
  if (format === 'text') {
    if (text === '') return NOTHING;
    const bytes = new TextEncoder().encode(text);
    const looksPublic = /^\s*(?:-----BEGIN|\{\s*"kty")/.test(text);
    return {
      ok: true,
      description: secretDescription(bytes),
      warnings: [],
      candidates: [{ type: 'secret', bytes, ...(looksPublic ? { looksPublic: true as const } : {}) }],
    };
  }
  if (text.trim() === '') return NOTHING;
  if (format === 'base64') {
    const parsed = parseBase64(text);
    if (!parsed.ok) return { ok: false, message: `Position ${parsed.error.column}: ${parsed.error.message}.` };
    if (parsed.bytes.length === 0) return NOTHING;
    return {
      ok: true,
      description: secretDescription(parsed.bytes),
      warnings: [],
      candidates: [{ type: 'secret', bytes: parsed.bytes }],
    };
  }
  if (format === 'hex') {
    const parsed = parseHex(text);
    if ('message' in parsed) return { ok: false, message: parsed.message };
    return {
      ok: true,
      description: secretDescription(parsed.bytes),
      warnings: [],
      candidates: [{ type: 'secret', bytes: parsed.bytes }],
    };
  }
  const jwk = parseJsonObject(text);
  if (!jwk) return { ok: false, message: 'The JWK is not a JSON object.' };
  if (jwk.kty !== 'oct' || typeof jwk.k !== 'string')
    return { ok: false, message: 'A secret JWK needs "kty": "oct" and "k".' };
  let end = jwk.k.length;
  while (end > 0 && jwk.k[end - 1] === '=') end--;
  const bytes = decodeBase64url(jwk.k.slice(0, end));
  if (!bytes) return { ok: false, message: 'The JWK\'s "k" is not valid Base64url.' };
  if (bytes.length === 0) return NOTHING;
  return {
    ok: true,
    description: `${secretDescription(bytes)}${typeof jwk.kid === 'string' ? `, JWK kid ${JSON.stringify(jwk.kid)}` : ', JWK'}`,
    warnings: [],
    candidates: [{ type: 'secret', bytes, jwk }],
  };
};

const parseJsonObject = (text: string): Jwk | undefined => {
  try {
    const value: unknown = JSON.parse(text);
    return isObject(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/** What a public key is, in words: "RSA 2048-bit", "EC P-256", "Ed25519"; undefined when it cannot be told. */
export const kindWords = (kind: SpkiKind): string | undefined =>
  kind.type === 'RSA'
    ? `RSA ${kind.bits}-bit`
    : kind.type === 'EC'
      ? `EC ${kind.curve}`
      : kind.type === 'unknown'
        ? undefined
        : kind.type;

/** The kind of a JWK, as spkiKind tells it of an SPKI (an `oct` key is a secret, not a public key). */
export const jwkKind = (jwk: Jwk): SpkiKind | { type: 'oct' } => {
  if (jwk.kty === 'RSA') {
    const n = typeof jwk.n === 'string' ? decodeBase64url(jwk.n) : null;
    return { type: 'RSA', bits: n ? unsignedBits(n) : 0 };
  }
  if (jwk.kty === 'EC') return { type: 'EC', curve: typeof jwk.crv === 'string' ? jwk.crv : 'unknown' };
  if (jwk.kty === 'OKP' && (jwk.crv === 'Ed25519' || jwk.crv === 'Ed448')) return { type: jwk.crv };
  if (jwk.kty === 'oct') return { type: 'oct' };
  return { type: 'unknown' };
};

export const jwkDescription = (jwk: Jwk): string => {
  const kind = jwkKind(jwk);
  const what = kind.type === 'oct' ? 'Shared secret' : `${kindWords(kind) ?? 'Unknown'} public key`;
  return `${what}, JWK${typeof jwk.kid === 'string' ? ` kid ${JSON.stringify(jwk.kid)}` : ''}`;
};

const PRIVATE_LABEL = /PRIVATE KEY$/;
const BEGIN = /^-----BEGIN ([^\r\n]{1,80}?)-----/;

const parsePem = (text: string): ParsedKey => {
  const begin = BEGIN.exec(text);
  if (!begin) return { ok: false, message: PASTE_A_KEY };
  const label = begin[1]!;
  if (PRIVATE_LABEL.test(label)) return PRIVATE;
  if (!['PUBLIC KEY', 'RSA PUBLIC KEY', 'CERTIFICATE'].includes(label))
    return {
      ok: false,
      message: `Unsupported PEM block "${label}". Paste a PUBLIC KEY, RSA PUBLIC KEY or CERTIFICATE.`,
    };
  const end = text.indexOf('-----END ', begin[0].length);
  if (end < 0) return { ok: false, message: 'The PEM block has no END line.' };
  const body = parseBase64(text.slice(begin[0].length, end));
  if (!body.ok || body.bytes.length === 0) return { ok: false, message: 'The PEM block is not valid Base64.' };
  if (label === 'CERTIFICATE') {
    const der = spkiOfCertificate(body.bytes);
    if (!der) return { ok: false, message: 'The certificate could not be read.' };
    return {
      ok: true,
      description: `${kindWords(spkiKind(der)) ?? 'Unknown'} public key from a certificate`,
      warnings: [CERTIFICATE_NOTE],
      candidates: [{ type: 'spki', der, fromCertificate: true }],
    };
  }
  const der = label === 'RSA PUBLIC KEY' ? spkiOfPkcs1(body.bytes) : body.bytes;
  const words = kindWords(spkiKind(der));
  return {
    ok: true,
    description: words ? `${words} public key` : 'Public key',
    warnings: [],
    candidates: [{ type: 'spki', der, fromCertificate: false }],
  };
};

const parseJwkOrSet = (text: string): ParsedKey => {
  const value = parseJsonObject(text);
  if (!value) return { ok: false, message: 'The key is not a JSON object.' };
  if (Array.isArray(value.keys)) {
    const keys = value.keys.filter(isObject) as Jwk[];
    if (keys.some(hasPrivateMembers)) return PRIVATE;
    if (keys.length === 0) return { ok: false, message: 'The set has no keys.' };
    return {
      ok: true,
      description: `JWKS with ${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`,
      warnings: [],
      candidates: keys.map(jwk => ({ type: 'jwk', jwk })),
      set: true,
    };
  }
  if (hasPrivateMembers(value)) return PRIVATE;
  if (typeof value.kty !== 'string') return { ok: false, message: 'The JWK has no "kty".' };
  return { ok: true, description: jwkDescription(value), warnings: [], candidates: [{ type: 'jwk', jwk: value }] };
};

/** Reads the key a person gave (§5.4). Nothing entered: `{ ok: false, message: '' }`. */
export const parseKey = (input: KeyInput): ParsedKey => {
  if (input.kind === 'secret') return parseSecret(input.text, input.format);
  const text = input.text.trim();
  if (text === '') return NOTHING;
  if (text.startsWith('-----BEGIN ')) return parsePem(text);
  if (text.startsWith('{')) return parseJwkOrSet(text);
  return { ok: false, message: PASTE_A_KEY };
};
