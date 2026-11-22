/**
 * A new key pair — only `crypto.subtle.generateKey` (docs/tools/specs/keys.md §5.1, §5.3): no randomness or arithmetic of
 * our own. The private key is exported as JWK (every number of the key) and read like a pasted JWK, so every form comes
 * from the same writers as in Inspect; the tests compare those writers with Web Crypto's own `spki` and `pkcs8`.
 */
import { readJwkNode } from './jwk';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import { cryptoRandom } from '@workspace/tools-shared/random';
import type { JwkMeta, ReadKey } from './types';

type Subtle = typeof crypto.subtle;

export type Algorithm = 'Ed25519' | 'P-256' | 'P-384' | 'P-521' | 'RSA' | 'X25519';
export type RsaSize = 2048 | 3072 | 4096;
export type RsaJwkAlg = 'RS256' | 'PS256' | 'RSA-OAEP-256';

export interface GenerateOptions {
  algorithm: Algorithm;
  size: RsaSize;
  rsaAlg: RsaJwkAlg;
}

export const ALGORITHMS: readonly Algorithm[] = ['Ed25519', 'P-256', 'P-384', 'P-521', 'RSA', 'X25519'];
export const RSA_SIZES: readonly RsaSize[] = [2048, 3072, 4096];
export const RSA_JWK_ALGS: readonly RsaJwkAlg[] = ['RS256', 'PS256', 'RSA-OAEP-256'];

export const ALGORITHM_LABELS: Record<Algorithm, string> = {
  Ed25519: 'Ed25519',
  'P-256': 'ECDSA P-256',
  'P-384': 'ECDSA P-384',
  'P-521': 'ECDSA P-521',
  RSA: 'RSA',
  X25519: 'X25519',
};

const EC_ALG = { 'P-256': 'ES256', 'P-384': 'ES384', 'P-521': 'ES512' } as const;
const RSA_PARAMS: Record<RsaJwkAlg, { name: string; usages: string[]; use: string }> = {
  RS256: { name: 'RSASSA-PKCS1-v1_5', usages: ['sign', 'verify'], use: 'sig' },
  PS256: { name: 'RSA-PSS', usages: ['sign', 'verify'], use: 'sig' },
  'RSA-OAEP-256': { name: 'RSA-OAEP', usages: ['encrypt', 'decrypt'], use: 'enc' },
};

type Usages = Parameters<Subtle['generateKey']>[2];

/** What `generateKey` gets for these options, its usages, and the JWK's `alg` and `use` (§5.1). */
export const generationOf = (
  o: GenerateOptions,
): { params: Record<string, unknown>; usages: string[]; meta: JwkMeta } => {
  switch (o.algorithm) {
    case 'Ed25519':
      return { params: { name: 'Ed25519' }, usages: ['sign', 'verify'], meta: { alg: 'Ed25519', use: 'sig' } };
    case 'X25519':
      return { params: { name: 'X25519' }, usages: ['deriveBits'], meta: { alg: 'ECDH-ES', use: 'enc' } };
    case 'RSA': {
      const r = RSA_PARAMS[o.rsaAlg];
      return {
        params: { name: r.name, modulusLength: o.size, publicExponent: Uint8Array.of(1, 0, 1), hash: 'SHA-256' },
        usages: r.usages,
        meta: { alg: o.rsaAlg, use: r.use },
      };
    }
    default:
      return {
        params: { name: 'ECDSA', namedCurve: o.algorithm },
        usages: ['sign', 'verify'],
        meta: { alg: EC_ALG[o.algorithm], use: 'sig' },
      };
  }
};

/** A pair from Web Crypto, as a key the forms are written from. */
export const generatePair = async (o: GenerateOptions, subtle: Subtle = crypto.subtle): Promise<ReadKey> => {
  const g = generationOf(o);
  const pair = (await subtle.generateKey(g.params as never, true, g.usages as Usages)) as {
    privateKey: Parameters<Subtle['exportKey']>[1];
  };
  const jwk = await subtle.exportKey('jwk', pair.privateKey);
  const tree = parseJsonTree(JSON.stringify(jwk));
  if (!tree.ok) throw new Error('the browser exported an unreadable JWK');
  const read = readJwkNode(tree.tree);
  if (!read.ok) throw new Error(read.message);
  return { data: read.key.data, source: 'generated', notes: [], jwk: g.meta };
};

/** Which of the newer curves this browser's Web Crypto has (§5.1): tried, never assumed from a version. */
export const supported = async (subtle: Subtle = crypto.subtle): Promise<Record<'Ed25519' | 'X25519', boolean>> => {
  const probe = async (name: 'Ed25519' | 'X25519'): Promise<boolean> => {
    try {
      await subtle.generateKey({ name } as never, false, (name === 'Ed25519' ? ['sign'] : ['deriveBits']) as Usages);
      return true;
    } catch {
      return false;
    }
  };
  const [ed, x] = await Promise.all([probe('Ed25519'), probe('X25519')]);
  return { Ed25519: ed, X25519: x };
};

export const UNSUPPORTED: Record<'Ed25519' | 'X25519', string> = {
  Ed25519: 'Ed25519 needs Chrome 137 or later; this browser has no Ed25519 in Web Crypto.',
  X25519: 'X25519 needs Chrome 133 or later; this browser has no X25519 in Web Crypto.',
};

/**
 * The check number of an OpenSSH private key file (PROTOCOL.key: the same random uint32 twice, so a wrong passphrase
 * shows) — the one random value this package draws itself, from the shared source; it is no key material.
 */
export const newCheckint = (): number => {
  const b = new Uint8Array(4);
  cryptoRandom(b);
  return ((b[0]! << 24) | (b[1]! << 16) | (b[2]! << 8) | b[3]!) >>> 0;
};
