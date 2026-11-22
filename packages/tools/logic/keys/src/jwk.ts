/**
 * JWK and JWK Set (RFC 7517; members RFC 7518 §6, RFC 8037 §2), read from the shared JSON scanner's tree — never
 * `JSON.parse` (docs/tools/README.md «Общий сканер JSON»): a repeated member is seen and refused. Strict Base64url
 * (RFC 7515 §2), every required member, exact lengths (docs/tools/specs/keys.md §5.5).
 */
import { parseBase64url } from './bytes';
import { FIELD_BYTES } from './oids';
import type { Curve, JwkMeta, KeyData, ReadItem } from './types';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

type Obj = Extract<JsonNode, { type: 'object' }>;

class JwkError extends Error {}

const SIZES: Record<string, number> = { Ed25519: 32, X25519: 32 };

const memberMap = (node: Obj): Map<string, JsonNode> => {
  const map = new Map<string, JsonNode>();
  for (const e of node.entries) {
    if (map.has(e.key)) throw new JwkError(`The JWK has "${e.key}" twice.`);
    map.set(e.key, e.value);
  }
  return map;
};

const text = (m: Map<string, JsonNode>, name: string, required: boolean): string | undefined => {
  const v = m.get(name);
  if (v === undefined) {
    if (required) throw new JwkError(`The JWK has no "${name}".`);
    return undefined;
  }
  if (v.type !== 'string') throw new JwkError(`The JWK's "${name}" is not a string.`);
  return v.value;
};

const bytes = (m: Map<string, JsonNode>, name: string, required = true): Uint8Array | undefined => {
  const s = text(m, name, required);
  if (s === undefined) return undefined;
  const r = parseBase64url(s);
  if (r.ok) return r.bytes;
  if (r.problem === 'padding')
    throw new JwkError(`The JWK's "${name}" has "=" padding; JWK uses Base64url without padding (RFC 7515 §2).`);
  if (r.problem === 'char')
    throw new JwkError(`The JWK's "${name}" is not Base64url: position ${r.position}, "${r.char}".`);
  throw new JwkError(`The JWK's "${name}" has an impossible length for Base64url.`);
};

const exact = (value: Uint8Array, name: string, size: number, what: string): Uint8Array => {
  if (value.length !== size) throw new JwkError(`The JWK's "${name}" is ${value.length} bytes; ${what} needs ${size}.`);
  return value;
};

const meta = (m: Map<string, JsonNode>): JwkMeta => {
  const out: JwkMeta = {};
  const kid = text(m, 'kid', false);
  const alg = text(m, 'alg', false);
  const use = text(m, 'use', false);
  if (kid !== undefined) out.kid = kid;
  if (alg !== undefined) out.alg = alg;
  if (use !== undefined) out.use = use;
  const ops = m.get('key_ops');
  if (ops !== undefined) {
    if (ops.type !== 'array' || !ops.items.every(i => i.type === 'string'))
      throw new JwkError('The JWK\'s "key_ops" is not a list of strings.');
    out.key_ops = ops.items.map(i => (i as Extract<JsonNode, { type: 'string' }>).value);
  }
  return out;
};

const RSA_PRIVATE = ['p', 'q', 'dp', 'dq', 'qi'] as const;

export const readJwkNode = (node: JsonNode): ReadItem => {
  try {
    if (node.type !== 'object') throw new JwkError('The key is not a JSON object.');
    const m = memberMap(node);
    const kty = text(m, 'kty', true)!;
    const notes: string[] = [];
    if (m.has('x5c') || m.has('x5t') || m.has('x5t#S256') || m.has('x5u'))
      notes.push("The JWK's certificate members (x5c, x5t, x5u) are not read.");
    let data: KeyData;
    if (kty === 'RSA') {
      if (m.has('oth')) throw new JwkError('Multi-prime RSA keys (more than two primes) are not supported.');
      const n = bytes(m, 'n')!;
      const e = bytes(m, 'e')!;
      const d = bytes(m, 'd', false);
      data = { type: 'rsa', n, e };
      if (d) {
        const missing = RSA_PRIVATE.filter(k => !m.has(k));
        if (missing.length > 0)
          throw new JwkError(
            'The JWK has "d" but not "p", "q", "dp", "dq" and "qi"; RSA private keys without them are not read.',
          );
        const [p, q, dp, dq, qi] = RSA_PRIVATE.map(k => bytes(m, k)!) as [
          Uint8Array,
          Uint8Array,
          Uint8Array,
          Uint8Array,
          Uint8Array,
        ];
        data.priv = { d, p, q, dp, dq, qi };
      }
    } else if (kty === 'EC') {
      const crv = text(m, 'crv', true)!;
      if (!(crv in FIELD_BYTES))
        throw new JwkError(`The curve ${crv} is not supported: Web Crypto has P-256, P-384 and P-521.`);
      const curve = crv as Curve;
      const size = FIELD_BYTES[curve];
      const x = exact(bytes(m, 'x')!, 'x', size, curve);
      const y = exact(bytes(m, 'y')!, 'y', size, curve);
      const d = bytes(m, 'd', false);
      data = { type: 'ec', curve, x, y, ...(d ? { d: exact(d, 'd', size, curve) } : {}) };
    } else if (kty === 'OKP') {
      const crv = text(m, 'crv', true)!;
      if (crv === 'Ed448' || crv === 'X448')
        throw new JwkError(`${crv} keys are not supported: the browser's Web Crypto has no ${crv}.`);
      if (!(crv in SIZES))
        throw new JwkError(`The OKP curve "${crv}" is not supported: the tool reads Ed25519 and X25519.`);
      const curve = crv as 'Ed25519' | 'X25519';
      const x = exact(bytes(m, 'x')!, 'x', 32, curve);
      const d = bytes(m, 'd', false);
      data = { type: 'okp', curve, x, ...(d ? { d: exact(d, 'd', 32, curve) } : {}) };
    } else if (kty === 'oct') {
      throw new JwkError('This JWK is a shared secret (kty "oct"), not a key pair.');
    } else throw new JwkError(`The JWK's "kty" is "${kty}"; the tool reads RSA, EC and OKP keys.`);
    const storedPublic = data.type !== 'rsa' && data.d !== undefined ? data.x : undefined;
    return {
      ok: true,
      key: { data, source: 'jwk', jwk: meta(m), notes, ...(storedPublic ? { storedPublic } : {}) },
    };
  } catch (error) {
    if (error instanceof JwkError) return { ok: false, message: error.message };
    throw error;
  }
};

/** Is the tree a JWK Set (`{"keys":[…]}`) rather than one JWK? */
export const setMembers = (node: JsonNode): JsonNode[] | null => {
  if (node.type !== 'object') return null;
  const keys = node.entries.find(e => e.key === 'keys');
  if (!keys || node.entries.some(e => e.key === 'kty')) return null;
  return keys.value.type === 'array' ? keys.value.items : null;
};
