/** Object identifiers of the keys this tool reads and those it names to refuse (docs/tools/specs/keys.md §5.5). */
import type { Curve } from './types';

export const OID = {
  rsaEncryption: '1.2.840.113549.1.1.1',
  rsaPss: '1.2.840.113549.1.1.10',
  ecPublicKey: '1.2.840.10045.2.1',
  ed25519: '1.3.101.112',
  ed448: '1.3.101.113',
  x25519: '1.3.101.110',
  x448: '1.3.101.111',
  dsa: '1.2.840.10040.4.1',
  pbes2: '1.2.840.113549.1.5.13',
} as const;

export const CURVE_OIDS: Record<Curve, string> = {
  'P-256': '1.2.840.10045.3.1.7',
  'P-384': '1.3.132.0.34',
  'P-521': '1.3.132.0.35',
};

export const curveOfOid = (oid: string): Curve | undefined =>
  (Object.keys(CURVE_OIDS) as Curve[]).find(c => CURVE_OIDS[c] === oid);

/** Curves people meet that Web Crypto has not: named in the refusal. */
export const OTHER_CURVES: Record<string, string> = {
  '1.3.132.0.10': 'secp256k1',
  '1.2.840.10045.3.1.1': 'P-192',
  '1.3.132.0.33': 'P-224',
  '1.3.36.3.3.2.8.1.1.7': 'brainpoolP256r1',
  '1.3.36.3.3.2.8.1.1.11': 'brainpoolP384r1',
  '1.3.36.3.3.2.8.1.1.13': 'brainpoolP512r1',
  '1.2.156.10197.1.301': 'SM2',
};

/** Other key algorithms, named in the refusal. */
export const OTHER_ALGORITHMS: Record<string, string> = {
  [OID.dsa]: 'DSA',
  [OID.ed448]: 'Ed448',
  [OID.x448]: 'X448',
  [OID.rsaPss]: 'RSA-PSS',
  '2.16.840.1.101.3.4.3.17': 'ML-DSA-44',
  '2.16.840.1.101.3.4.3.18': 'ML-DSA-65',
  '2.16.840.1.101.3.4.3.19': 'ML-DSA-87',
  '2.16.840.1.101.3.4.4.1': 'ML-KEM-512',
  '2.16.840.1.101.3.4.4.2': 'ML-KEM-768',
  '2.16.840.1.101.3.4.4.3': 'ML-KEM-1024',
  '1.2.840.10046.2.1': 'DH',
  '1.2.840.113549.1.3.1': 'DH',
};

/** Field size in bytes of each curve: the length of x, y and d (RFC 7518 §6.2.1.2, §6.2.2.1; RFC 5915 §3). */
export const FIELD_BYTES: Record<Curve, number> = { 'P-256': 32, 'P-384': 48, 'P-521': 66 };

export const SSH_CURVE: Record<Curve, string> = { 'P-256': 'nistp256', 'P-384': 'nistp384', 'P-521': 'nistp521' };
