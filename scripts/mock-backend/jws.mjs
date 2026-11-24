// DEVTAB_MOCK_BACKEND — development only.
//
// The licence token as compact JWS with ES256 (pro-entitlement-implementation.md §3.1, §3.3): strict base64url, the
// exact bytes signed, a 64-byte r‖s signature (what WebCrypto produces and takes). `verifyToken` is a reference of the
// extension's planned check, in the order of its table §4.1, so the mock's tests check what the extension will check.
import { webcrypto } from 'node:crypto';
import { claimsCheck, headerProblems, LIMITS, TOKEN_TYPE } from './contract.mjs';

const { subtle } = webcrypto;
const ALGORITHM = { name: 'ECDSA', namedCurve: 'P-256' };
const SIGN = { name: 'ECDSA', hash: 'SHA-256' };

const B64URL = /^[A-Za-z0-9_-]*$/;

export const base64url = {
  encode: bytes => Buffer.from(bytes).toString('base64url'),
  /** Strict: the alphabet only, no padding, no length ≡ 1 (mod 4); undefined otherwise. */
  decode(text) {
    if (typeof text !== 'string' || !B64URL.test(text) || text.length % 4 === 1) return undefined;
    return new Uint8Array(Buffer.from(text, 'base64url'));
  },
};

const encodeJson = value => base64url.encode(Buffer.from(JSON.stringify(value), 'utf8'));

/** A new ES256 key pair with its id: the private key, and the public entry the extension's configuration holds. */
export async function generateSigningKey(kid) {
  const pair = await subtle.generateKey(ALGORITHM, true, ['sign', 'verify']);
  const privateJwk = await subtle.exportKey('jwk', pair.privateKey);
  return { kid, privateKey: pair.privateKey, privateJwk, publicEntry: publicEntryOf(kid, privateJwk) };
}

/** `{ kid, jwk: { kty, crv, x, y } }` — the extension's PublicKeyEntry (§3.4, §6.1). */
export const publicEntryOf = (kid, jwk) => ({ kid, jwk: { kty: 'EC', crv: 'P-256', x: jwk.x, y: jwk.y } });

/** A signing key from its stored private JWK. */
export async function importSigningKey(kid, privateJwk) {
  const privateKey = await subtle.importKey('jwk', privateJwk, ALGORITHM, false, ['sign']);
  return { kid, privateKey, privateJwk, publicEntry: publicEntryOf(kid, privateJwk) };
}

/** Signs `claims` (wire form, seconds); `header` overrides fields to make broken tokens in tests. */
export async function signToken(claims, key, header = {}) {
  const head = encodeJson({ alg: 'ES256', kid: key.kid, typ: TOKEN_TYPE, ...header });
  const input = `${head}.${encodeJson(claims)}`;
  const signature = await subtle.sign(SIGN, key.privateKey, Buffer.from(input, 'ascii'));
  return `${input}.${base64url.encode(new Uint8Array(signature))}`;
}

/** The header and fields of a token, unverified (for logs and tests); undefined when it does not parse. */
export function decodeToken(compact) {
  const parts = typeof compact === 'string' ? compact.split('.') : [];
  if (parts.length !== 3) return undefined;
  try {
    const [header, claims] = parts.slice(0, 2).map(p => JSON.parse(Buffer.from(base64url.decode(p) ?? [], 'utf8')));
    return { header, claims };
  } catch {
    return undefined;
  }
}

/** The same token with one bit of its signature flipped: an answer with a bad signature. */
export function breakSignature(compact) {
  const parts = compact.split('.');
  const bytes = base64url.decode(parts[2]);
  bytes[bytes.length - 1] ^= 0x01;
  return `${parts[0]}.${parts[1]}.${base64url.encode(bytes)}`;
}

/**
 * A JSON object from strict UTF-8 bytes; undefined for bytes that are not UTF-8, JSON that does not parse and a JSON
 * value that is not an object (an array, a string, a number, null) — each of them `malformed` (§3.1, step 1).
 */
const parseJson = bytes => {
  try {
    const value = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value : undefined;
  } catch {
    return undefined;
  }
};

/**
 * Checks a compact JWS against `keys` (PublicKeyEntry[]) as the extension will (§3, §4.1 rows 3–7, §8.2). Never throws.
 * `{ ok: true, header, claims, kid, ignored }` or `{ ok: false, reason, problems }` with reason `malformed`,
 * `unsupported`, `unknown-key`, `signature` or `claims`.
 */
export async function verifyToken(compact, keys) {
  const fail = (reason, problems = []) => ({ ok: false, reason, problems });
  if (typeof compact !== 'string' || compact.length > LIMITS.tokenLength) return fail('malformed', ['length']);
  const parts = compact.split('.');
  if (parts.length !== 3) return fail('malformed', ['not three parts']);
  const decoded = parts.map(base64url.decode);
  if (decoded.some(d => d === undefined)) return fail('malformed', ['not strict base64url']);
  const header = parseJson(decoded[0]);
  const claims = parseJson(decoded[1]);
  if (header === undefined || claims === undefined) return fail('malformed', ['not UTF-8 JSON objects']);
  // The header before the signature's size: `alg: none` without a signature and HS256 with a 32-byte one are
  // `unsupported` (§8.2); a 64-byte rule breaker with a good header is `malformed` (§3.1).
  const headerWrong = headerProblems(header);
  if (headerWrong.length) return fail('unsupported', headerWrong);
  if (decoded[2].length !== 64) return fail('malformed', [`signature of ${decoded[2].length} bytes`]);
  const entry = keys.find(k => k.kid === header.kid);
  if (!entry) return fail('unknown-key', [`kid ${header.kid}`]);
  let valid = false;
  try {
    const key = await subtle.importKey('jwk', { ...entry.jwk, ext: true }, ALGORITHM, false, ['verify']);
    valid = await subtle.verify(SIGN, key, decoded[2], Buffer.from(`${parts[0]}.${parts[1]}`, 'ascii'));
  } catch {
    valid = false;
  }
  if (!valid) return fail('signature');
  const check = claimsCheck(claims);
  if (check.reason) return fail(check.reason, check.problems);
  return { ok: true, header, claims, kid: header.kid, ignored: check.ignored };
}
