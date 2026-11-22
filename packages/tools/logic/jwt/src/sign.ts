/**
 * Signing a token (docs/tools/specs/jwt.md §16): a header and a payload as the person typed them — compacted by the
 * shared JSON scanner (literals kept as written) or taken byte for byte —, the algorithm the header names (only those
 * the tool verifies, never `none`), and a key: a shared secret for HS*, a private key for RS, PS, ES and EdDSA (PKCS#8,
 * PKCS#1 or SEC1 PEM, or a JWK with "d"). The signature is `crypto.subtle.sign` — nothing of our own; an ES signature
 * is Web Crypto's r ‖ s, which is JWS's form. The key is used for this call and kept nowhere.
 */
import { isObject } from './decode';
import { jwkKind, kindWords, parseKey } from './key';
import { ALGORITHMS, errorName, importParams, mismatch, UNAVAILABLE, verifyParams } from './verify';
import { bytesToBase64, parseBase64 } from '@workspace/tools-shared/base64';
import { children, isContext, isUniversal, readOid, readTlv, UNIVERSAL } from '@workspace/tools-shared/der';
import { parseJsonTree, scanJson } from '@workspace/tools-shared/json-scan';
import type { Jwk, SecretFormat } from './key';
import type { Algorithm, KeyKind } from './verify';
import type { Tlv } from '@workspace/tools-shared/der';

export type SigningKeyInput =
  { kind: 'secret'; text: string; format: SecretFormat } | { kind: 'private'; text: string };

export interface SignRequest {
  header: string;
  payload: string;
  /** Compact JSON (the scanner's minified text, literals as written); off: the fields' bytes exactly. */
  compact: boolean;
  key: SigningKeyInput;
}

export type SignResult =
  | { ok: true; token: string; alg: string; notes: string[] }
  | { ok: false; field: 'header' | 'payload' | 'key'; message: string };

/** The algorithms the tool signs with: those it verifies (§5.3). */
export const SIGNING_ALGORITHMS = [
  'HS256',
  'HS384',
  'HS512',
  'RS256',
  'RS384',
  'RS512',
  'PS256',
  'PS384',
  'PS512',
  'ES256',
  'ES384',
  'ES512',
  'EdDSA',
  'Ed25519',
] as const;

export const NONE_REFUSED = 'alg "none" makes an unsecured token; this tool signs only with a key.';
export const NEED_PRIVATE =
  'Paste the private key to sign with: PEM (PRIVATE KEY, RSA PRIVATE KEY, EC PRIVATE KEY) or a JWK with "d".';
export const PUBLIC_NOT_PRIVATE = 'Signing needs the private key; this is a public key.';
export const NOT_THIS_FORM =
  'This private key is encrypted or in the OpenSSH format; sign with a PKCS#8, PKCS#1 or SEC1 PEM key or a JWK. The Key Pairs tool converts OpenSSH keys.';

const enc = new TextEncoder();
const b64url = (bytes: Uint8Array): string => bytesToBase64(bytes, { alphabet: 'url', padding: false });

/** JSON compacted with its literals as written (numbers, escapes, member order): the scanner's tokens joined. */
const compactJson = (text: string): string => {
  const out: string[] = [];
  scanJson(
    text,
    {},
    {
      open: b => out.push(b),
      close: b => out.push(b === '{' ? '}' : ']'),
      key: raw => out.push(`${raw}:`),
      value: raw => out.push(raw),
      comma: () => out.push(','),
    },
  );
  return out.join('');
};

/** A part of the token: JSON checked by the shared scanner (no repeated member, RFC 7515 §4 and RFC 7519 §4). */
const part = (
  text: string,
  field: 'header' | 'payload',
  compact: boolean,
):
  | { ok: true; text: string; tree: ReturnType<typeof parseJsonTree> & { ok: true } }
  | { ok: false; message: string } => {
  const words = field === 'header' ? 'header' : 'payload';
  const tree = parseJsonTree(text);
  if (!tree.ok)
    return {
      ok: false,
      message: `The ${words} is not JSON. Line ${tree.error.line}, column ${tree.error.column}: ${tree.error.message}.`,
    };
  if (field === 'header' && tree.tree.type !== 'object')
    return { ok: false, message: 'The header must be a JSON object.' };
  const repeated = tree.notes.duplicateKeys[0];
  if (repeated) return { ok: false, message: `The ${words} has "${repeated.key}" twice.` };
  return { ok: true, text: compact ? compactJson(text) : text, tree };
};

// ——— Private keys: PKCS#8 as Web Crypto takes it, and what kind of key it is ———

const sequenceItems = (der: Uint8Array, at: number, limit = der.length): { tlv: Tlv; items: Tlv[] } | null => {
  const read = readTlv(der, at, limit);
  if (!read.ok || !isUniversal(read.tlv, UNIVERSAL.SEQUENCE)) return null;
  const items = children(der, read.tlv);
  return items.ok ? { tlv: read.tlv, items: items.items } : null;
};
const oidOf = (der: Uint8Array, tlv: Tlv | undefined): string | undefined => {
  if (!tlv || !isUniversal(tlv, UNIVERSAL.OBJECT_IDENTIFIER)) return undefined;
  const r = readOid(der, tlv);
  return r.ok ? r.value : undefined;
};
const lengthBytes = (n: number): number[] => {
  if (n < 0x80) return [n];
  const bytes: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) bytes.unshift(v % 256);
  return [0x80 | bytes.length, ...bytes];
};
const element = (tag: number, content: ArrayLike<number>): number[] => [
  tag,
  ...lengthBytes(content.length),
  ...Array.from(content),
];
const OID_BYTES: Record<string, number[]> = {
  rsa: [0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01],
  ec: [0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01],
};
const CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
};

/** PKCS#1 RSAPrivateKey → PKCS#8 { 0, rsaEncryption NULL, OCTET STRING }. */
const pkcs8OfPkcs1 = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(
    element(0x30, [0x02, 0x01, 0x00, ...element(0x30, [...OID_BYTES.rsa!, 0x05, 0x00]), ...element(0x04, pkcs1)]),
  );

/** SEC1 ECPrivateKey (with its `[0]` curve) → PKCS#8, the curve moved to the AlgorithmIdentifier, `[0]` left out. */
const pkcs8OfSec1 = (sec1: Uint8Array): Uint8Array<ArrayBuffer> | null => {
  const s = sequenceItems(sec1, 0);
  if (!s || s.tlv.end !== sec1.length) return null;
  const params = s.items.find(t => isContext(t, 0));
  const curveTlv = params ? children(sec1, params) : null;
  if (!curveTlv || !curveTlv.ok || !curveTlv.items[0] || !isUniversal(curveTlv.items[0], UNIVERSAL.OBJECT_IDENTIFIER))
    return null;
  const curve = curveTlv.items[0];
  const kept = s.items.filter(t => t !== params).flatMap(t => Array.from(sec1.subarray(t.start, t.end)));
  return new Uint8Array(
    element(0x30, [
      0x02,
      0x01,
      0x00,
      ...element(0x30, [...OID_BYTES.ec!, ...Array.from(sec1.subarray(curve.start, curve.end))]),
      ...element(0x04, element(0x30, kept)),
    ]),
  );
};

/** What a PKCS#8 key is, as `spkiKind` tells it of a public key. */
const pkcs8Kind = (der: Uint8Array): KeyKind => {
  const s = sequenceItems(der, 0);
  const alg = s?.items[1] && sequenceItems(der, s.items[1].start);
  const oid = oidOf(der, alg?.items[0]);
  if (oid === '1.3.101.112') return { type: 'Ed25519' };
  if (oid === '1.3.101.113') return { type: 'Ed448' };
  if (oid === '1.2.840.10045.2.1')
    return { type: 'EC', curve: CURVES[oidOf(der, alg?.items[1]) ?? ''] ?? 'an unknown curve' };
  if (oid === '1.2.840.113549.1.1.1') {
    const octet = s!.items[2];
    const inner =
      octet && isUniversal(octet, UNIVERSAL.OCTET_STRING) ? sequenceItems(der, octet.body, octet.end) : null;
    const n = inner?.items[1];
    let bits = 0;
    if (n) {
      const bytes = der.subarray(n.body, n.end);
      let i = 0;
      while (i < bytes.length - 1 && bytes[i] === 0) i++;
      bits = bytes[i] ? (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]!)) : 0;
    }
    return { type: 'RSA', bits };
  }
  return { type: 'unknown' };
};

type PrivateKey =
  { format: 'pkcs8'; der: Uint8Array<ArrayBuffer>; kind: KeyKind } | { format: 'jwk'; jwk: Jwk; kind: KeyKind };

const BEGIN = /^-----BEGIN ([A-Z0-9 ]{1,60})-----/;

/** The private key text (§16): PEM PKCS#8 / PKCS#1 / SEC1 or a JWK with "d"; a sentence when it is not one. */
export const readPrivateKey = (input: string): PrivateKey | string => {
  const text = input.trim();
  if (text === '') return '';
  if (text.startsWith('{')) {
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return 'The JWK is not a JSON object.';
    }
    if (!isObject(value)) return 'The JWK is not a JSON object.';
    const jwk = value as Jwk;
    if (typeof jwk.kty !== 'string') return 'The JWK has no "kty".';
    if (jwk.kty === 'oct') return 'This JWK is a shared secret; RS, PS, ES and EdDSA sign with a private key.';
    if (typeof jwk.d !== 'string') return PUBLIC_NOT_PRIVATE;
    return { format: 'jwk', jwk, kind: jwkKind(jwk) as KeyKind };
  }
  const begin = BEGIN.exec(text);
  if (!begin) return NEED_PRIVATE;
  const label = begin[1]!;
  if (label === 'PUBLIC KEY' || label === 'RSA PUBLIC KEY' || label === 'CERTIFICATE') return PUBLIC_NOT_PRIVATE;
  if (label === 'ENCRYPTED PRIVATE KEY' || label === 'OPENSSH PRIVATE KEY' || /Proc-Type:\s*4,ENCRYPTED/i.test(text))
    return NOT_THIS_FORM;
  if (!['PRIVATE KEY', 'RSA PRIVATE KEY', 'EC PRIVATE KEY'].includes(label)) return NEED_PRIVATE;
  const end = text.indexOf(`-----END ${label}-----`);
  if (end < 0) return 'The PEM block has no END line.';
  const body = parseBase64(text.slice(begin[0].length, end));
  if (!body.ok || body.bytes.length === 0) return 'The PEM block is not valid Base64.';
  const der =
    label === 'PRIVATE KEY'
      ? new Uint8Array(body.bytes)
      : label === 'RSA PRIVATE KEY'
        ? pkcs8OfPkcs1(body.bytes)
        : pkcs8OfSec1(body.bytes);
  if (!der) return 'The EC PRIVATE KEY could not be read (it must name its curve).';
  return { format: 'pkcs8', der, kind: pkcs8Kind(der) };
};

/** JWK members Web Crypto needs to sign, nothing else (no alg, use or key_ops to trip over). */
const privateJwk = (jwk: Jwk): Record<string, unknown> => {
  const names =
    jwk.kty === 'RSA'
      ? ['kty', 'n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi']
      : jwk.kty === 'EC'
        ? ['kty', 'crv', 'x', 'y', 'd']
        : ['kty', 'crv', 'x', 'd'];
  return Object.fromEntries(names.filter(n => n in jwk).map(n => [n, jwk[n]]));
};

const HASH_BYTES = { 'SHA-256': 32, 'SHA-384': 48, 'SHA-512': 64 } as const;

/** The header's `alg`, as the person wrote it (the tool never rewrites it), or why it cannot sign. */
const algOf = (tree: ReturnType<typeof parseJsonTree> & { ok: true }): { alg: string; a: Algorithm } | string => {
  if (tree.tree.type !== 'object') return 'The header must be a JSON object.';
  const entry = tree.tree.entries.find(e => e.key === 'alg');
  if (!entry) return 'The header has no "alg".';
  if (entry.value.type !== 'string') return 'The header\'s "alg" is not a string.';
  const alg = entry.value.value;
  if (alg === 'none') return NONE_REFUSED;
  const a = Object.hasOwn(ALGORITHMS, alg) ? ALGORITHMS[alg] : undefined;
  if (!a) return UNAVAILABLE[alg] ?? `Algorithm ${JSON.stringify(alg)} is not supported for signing.`;
  return { alg, a };
};

/** Signs the header and payload with the key (§16): `crypto.subtle.sign` only. */
export const signToken = async (request: SignRequest): Promise<SignResult> => {
  const header = part(request.header, 'header', request.compact);
  if (!header.ok) return { ok: false, field: 'header', message: header.message };
  const which = algOf(header.tree);
  if (typeof which === 'string') return { ok: false, field: 'header', message: which };
  const { alg, a } = which;
  let payloadText: string;
  if (request.compact) {
    const payload = part(request.payload, 'payload', true);
    if (!payload.ok)
      return { ok: false, field: 'payload', message: `${payload.message} Turn off Compact JSON to sign it as text.` };
    payloadText = payload.text;
  } else payloadText = request.payload;

  const notes: string[] = [];
  let cryptoKey: Awaited<ReturnType<typeof crypto.subtle.importKey>>;
  const params = importParams(a);
  if (a.family === 'HS') {
    if (request.key.kind !== 'secret')
      return { ok: false, field: 'key', message: `${alg} signs with a shared secret, not a private key.` };
    const parsed = parseKey({ kind: 'secret', text: request.key.text, format: request.key.format });
    if (!parsed.ok) return { ok: false, field: 'key', message: parsed.message || 'Enter the secret to sign with.' };
    const secret = parsed.candidates[0]!;
    if (secret.type !== 'secret') return { ok: false, field: 'key', message: 'Enter the secret to sign with.' };
    const need = HASH_BYTES[a.hash!];
    if (secret.bytes.length < need)
      notes.push(`The secret is shorter than ${need * 8} bits. RFC 7518 §3.2 requires at least the hash size.`);
    cryptoKey = await crypto.subtle.importKey('raw', secret.bytes.slice(), params, false, ['sign']);
  } else {
    if (request.key.kind !== 'private')
      return { ok: false, field: 'key', message: `${alg} signs with a private key, not a shared secret.` };
    const key = readPrivateKey(request.key.text);
    if (typeof key === 'string') return { ok: false, field: 'key', message: key || NEED_PRIVATE };
    const wrong = mismatch(alg, a, key.kind);
    if (wrong) return { ok: false, field: 'key', message: wrong };
    if (key.kind.type === 'RSA' && key.kind.bits > 0 && key.kind.bits < 2048)
      notes.push('The RSA key is shorter than 2048 bits (RFC 7518 §3.3).');
    if (key.format === 'jwk' && key.jwk.alg !== undefined && key.jwk.alg !== alg)
      return {
        ok: false,
        field: 'key',
        message: `The key is meant for ${String(key.jwk.alg)}; the header says ${alg}.`,
      };
    try {
      cryptoKey =
        key.format === 'pkcs8'
          ? await crypto.subtle.importKey('pkcs8', key.der, params, false, ['sign'])
          : await crypto.subtle.importKey('jwk', privateJwk(key.jwk), params, false, ['sign']);
    } catch (error) {
      const name = errorName(error);
      if (a.family === 'Ed' && name === 'NotSupportedError')
        return {
          ok: false,
          field: 'key',
          message: 'This browser has no Ed25519 support (Chrome 137 or later is needed).',
        };
      const words = kindWords(key.kind as never);
      return {
        ok: false,
        field: 'key',
        message: `The browser could not read this key${words ? ` (${words})` : ''}: ${name}.`,
      };
    }
  }
  const signingInput = `${b64url(enc.encode(header.text))}.${b64url(enc.encode(payloadText))}`;
  const signature = new Uint8Array(await crypto.subtle.sign(verifyParams(a), cryptoKey, enc.encode(signingInput)));
  return { ok: true, token: `${signingInput}.${b64url(signature)}`, alg, notes };
};

/** The header text with its `alg` set (the algorithm list writes it; everything else stays as typed). */
export const withAlg = (header: string, alg: string): string => {
  const at = /("alg"\s*:\s*)"(?:[^"\\]|\\.)*"/.exec(header);
  if (at) return `${header.slice(0, at.index)}${at[1]}${JSON.stringify(alg)}${header.slice(at.index + at[0].length)}`;
  const tree = parseJsonTree(header);
  if (tree.ok && tree.tree.type === 'object') {
    const open = header.indexOf('{');
    const empty = tree.tree.entries.length === 0;
    return `${header.slice(0, open + 1)}"alg":${JSON.stringify(alg)}${empty ? '' : ','}${header.slice(open + 1)}`;
  }
  return JSON.stringify({ alg, typ: 'JWT' }, null, 2);
};

/** The header's `alg` as a string, when it is one (for the algorithm list). */
export const headerAlg = (header: string): string | undefined => {
  const tree = parseJsonTree(header);
  if (!tree.ok || tree.tree.type !== 'object') return undefined;
  const v = tree.tree.entries.find(e => e.key === 'alg')?.value;
  return v?.type === 'string' ? v.value : undefined;
};
