/**
 * What needs the browser, and the checks of a key (docs/tools/specs/keys.md §5.6): the public part of a private key
 * that came without it — derived by Web Crypto (`importKey('pkcs8')`, `exportKey('jwk')`), never by arithmetic of our
 * own —, the stored public key compared with it, an EC point checked by `importKey`, and the numbers of an RSA private
 * key checked for belonging together with BigInt (consistency, not cryptography). Notes for weak or odd keys.
 */
import { bitLength, equal, padTo, parseBase64url, toBigInt } from './bytes';
import { octetString, oid, sequence, smallInteger } from './der-write';
import { pkcs8, spki } from './encode';
import { CURVE_OIDS, FIELD_BYTES, OID } from './oids';
import type { KeyData, ReadItem, ReadKey, RsaKey } from './types';

type Subtle = typeof crypto.subtle;

export const WEAK_RSA = 'RSA keys shorter than 2048 bits are considered weak.';
export const MISMATCH = 'The public key stored with this private key does not belong to it.';
export const MAX_RSA_BITS = 16_384;

const gcd = (a: bigint, b: bigint): bigint => {
  while (b) [a, b] = [b, a % b];
  return a;
};

/** The first way the numbers of an RSA private key do not belong together, or null (§5.6). */
export const checkRsa = (data: RsaKey): string | null => {
  const p = data.priv;
  if (!p) return null;
  const [n, e, d, P, Q, dp, dq, qi] = [data.n, data.e, p.d, p.p, p.q, p.dp, p.dq, p.qi].map(toBigInt) as bigint[] as [
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
    bigint,
  ];
  const head = "The RSA private key's numbers do not belong together: ";
  if (P < 2n || Q < 2n || n !== P * Q) return `${head}n is not p × q.`;
  if (dp !== d % (P - 1n)) return `${head}dp is not d mod (p − 1).`;
  if (dq !== d % (Q - 1n)) return `${head}dq is not d mod (q − 1).`;
  if ((qi * Q) % P !== 1n) return `${head}qi is not the inverse of q mod p.`;
  const lambda = ((P - 1n) * (Q - 1n)) / gcd(P - 1n, Q - 1n);
  if ((e * d - 1n) % lambda !== 0n) return `${head}e × d is not 1 mod lcm(p − 1, q − 1).`;
  return null;
};

/** Public notes and refusals of an RSA key's n and e. */
const rsaPublic = (data: RsaKey): { error?: string; notes: string[] } => {
  const bits = bitLength(data.n);
  const e = toBigInt(data.e);
  if (bits > MAX_RSA_BITS)
    return { error: `The RSA modulus is ${bits} bits; the tool reads keys up to ${MAX_RSA_BITS} bits.`, notes: [] };
  if (bits < 16 || toBigInt(data.n) % 2n === 0n)
    return { error: 'The RSA modulus is not an RSA modulus (too small or even).', notes: [] };
  if (e < 3n || e % 2n === 0n) return { error: `The public exponent ${e} cannot belong to an RSA key.`, notes: [] };
  const notes: string[] = [];
  if (bits < 2048) notes.push(WEAK_RSA);
  if (e !== 65537n) notes.push(`The public exponent is ${e}, not the usual 65537.`);
  return { notes };
};

/** PKCS#8 of an EC private key without its public point: what Web Crypto derives the point from. */
const ecPrivateOnly = (data: Extract<KeyData, { type: 'ec' }>): Uint8Array =>
  sequence(
    smallInteger(0),
    sequence(oid(OID.ecPublicKey), oid(CURVE_OIDS[data.curve])),
    octetString(sequence(smallInteger(1), octetString(padTo(data.d!, FIELD_BYTES[data.curve])!))),
  );

const errorName = (error: unknown): string =>
  error && typeof error === 'object' && 'name' in error ? String((error as { name: unknown }).name) : 'Error';

const jwkBytes = (value: unknown): Uint8Array | null => {
  if (typeof value !== 'string') return null;
  const r = parseBase64url(value);
  return r.ok ? r.bytes : null;
};

/**
 * The key made whole and checked: RSA numbers and notes; an EC point on its curve, the public point of an EC or
 * OKP private key derived (and the stored one compared with it); an RSA or EC private key accepted by Web Crypto.
 */
export const completeKey = async (key: ReadKey, subtle: Subtle = crypto.subtle): Promise<ReadItem> => {
  const data = key.data;
  const notes = [...key.notes];
  if (data.type === 'rsa') {
    const pub = rsaPublic(data);
    if (pub.error) return { ok: false, message: pub.error };
    notes.push(...pub.notes);
    if (data.priv) {
      const problem = checkRsa(data);
      if (problem) return { ok: false, message: problem };
      try {
        await subtle.importKey('pkcs8', pkcs8(data).slice(), { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, [
          'sign',
        ]);
      } catch (error) {
        return { ok: false, message: `The browser's Web Crypto refused this key (${errorName(error)}).` };
      }
    }
    return { ok: true, key: { ...key, notes } };
  }

  if (data.type === 'ec') {
    const params = { name: 'ECDSA', namedCurve: data.curve };
    let complete: KeyData = data;
    if (data.d) {
      let derived: { x: Uint8Array; y: Uint8Array };
      try {
        const k = await subtle.importKey('pkcs8', ecPrivateOnly(data).slice(), params, true, ['sign']);
        const jwk = (await subtle.exportKey('jwk', k)) as { x?: string; y?: string };
        const x = jwkBytes(jwk.x);
        const y = jwkBytes(jwk.y);
        if (!x || !y) throw new Error('no point');
        derived = { x, y };
      } catch (error) {
        return { ok: false, message: `The browser's Web Crypto refused this key (${errorName(error)}).` };
      }
      if (data.x && data.y) {
        const size = FIELD_BYTES[data.curve];
        if (!equal(padTo(data.x, size)!, derived.x) || !equal(padTo(data.y, size)!, derived.y)) {
          // A stored point off the curve is the more precise refusal.
          try {
            await subtle.importKey('spki', spki(data).slice(), params, false, ['verify']);
          } catch {
            return { ok: false, message: `The public point is not on the ${data.curve} curve; the key was refused.` };
          }
          return { ok: false, message: MISMATCH };
        }
      }
      complete = { ...data, ...derived };
    } else {
      try {
        await subtle.importKey('spki', spki(data).slice(), params, false, ['verify']);
      } catch {
        return { ok: false, message: `The public point is not on the ${data.curve} curve; the key was refused.` };
      }
    }
    return { ok: true, key: { ...key, data: complete, notes } };
  }

  // Ed25519, X25519.
  if (!data.d) return { ok: true, key: { ...key, notes } };
  const name = data.curve;
  let derived: Uint8Array | null = null;
  try {
    const usages = name === 'Ed25519' ? ['sign'] : ['deriveBits'];
    const k = await subtle.importKey(
      'pkcs8',
      pkcs8({ ...data, x: undefined }).slice(),
      { name },
      true,
      usages as KeyUsageList,
    );
    derived = jwkBytes(((await subtle.exportKey('jwk', k)) as { x?: string }).x);
    if (!derived || derived.length !== 32) throw new Error('no public key');
  } catch (error) {
    if (errorName(error) === 'NotSupportedError') {
      const version = name === 'Ed25519' ? 137 : 133;
      if (!data.x)
        return {
          ok: false,
          message: `This browser has no ${name} in Web Crypto (Chrome ${version} or later), so the public key cannot be derived here.`,
        };
      notes.push(
        `This browser cannot check that the public key belongs to the private key (no ${name} in Web Crypto).`,
      );
      return { ok: true, key: { ...key, notes } };
    }
    return { ok: false, message: `The browser's Web Crypto refused this key (${errorName(error)}).` };
  }
  if (data.x && !equal(data.x, derived)) return { ok: false, message: MISMATCH };
  return { ok: true, key: { ...key, data: { ...data, x: derived }, notes } };
};

type KeyUsageList = Parameters<Subtle['importKey']>[4];
