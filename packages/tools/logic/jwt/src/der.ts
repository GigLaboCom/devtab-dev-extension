/**
 * The keys the tool reads from DER (docs/tools/specs/jwt.md §5.4): take the `subjectPublicKeyInfo` out of a certificate
 * (RFC 5280 §4.1), wrap a PKCS#1 `RSAPublicKey` into an SPKI (WebCrypto imports only SPKI), and say what kind of key an
 * SPKI holds — before WebCrypto sees it, so a wrong key gets words. Elements are read by the shared strict DER reader
 * (@workspace/tools-shared/der: definite, shortest-form lengths only); anything it refuses reads as "not this".
 */
import { children, isContext, isUniversal, readOid, readTlv, UNIVERSAL } from '@workspace/tools-shared/der';
import type { Tlv } from '@workspace/tools-shared/der';

const { SEQUENCE, BIT_STRING, INTEGER, OBJECT_IDENTIFIER } = UNIVERSAL;

/** A SEQUENCE at `offset` and its elements, or null when it is not one that DER reads. */
const sequenceAt = (der: Uint8Array, offset = 0, limit = der.length): { tlv: Tlv; items: Tlv[] } | null => {
  const read = readTlv(der, offset, limit);
  if (!read.ok || !isUniversal(read.tlv, SEQUENCE) || !read.tlv.constructed) return null;
  const items = children(der, read.tlv);
  return items.ok ? { tlv: read.tlv, items: items.items } : null;
};

/** A primitive element of this universal type (the identifier octet the tool used to compare: 0x02, 0x03, 0x06). */
const primitive = (tlv: Tlv | undefined, tag: number): boolean => !!tlv && isUniversal(tlv, tag) && !tlv.constructed;

const oidOf = (der: Uint8Array, tlv: Tlv | undefined): string | undefined => {
  if (!primitive(tlv, OBJECT_IDENTIFIER)) return undefined;
  const oid = readOid(der, tlv!);
  return oid.ok ? oid.value : undefined;
};

/** A DER element that spans all the bytes, with `firstByte` as its identifier (0x30: a SEQUENCE). */
export const spansAll = (bytes: Uint8Array, firstByte: number): boolean => {
  if (bytes[0] !== firstByte) return false;
  const read = readTlv(bytes, 0);
  return read.ok && read.tlv.end === bytes.length;
};

/**
 * The SPKI of a certificate (RFC 5280 §4.1): in `tbsCertificate`, skip `[0] version` when present, then
 * `serialNumber`, `signature`, `issuer`, `validity`, `subject`; the next element is `subjectPublicKeyInfo`.
 */
export const spkiOfCertificate = (der: Uint8Array): Uint8Array | null => {
  const certificate = sequenceAt(der);
  if (!certificate || certificate.tlv.end !== der.length || certificate.items.length !== 3) return null;
  const tbs = sequenceAt(der, certificate.items[0]!.start);
  if (!tbs) return null;
  const first = tbs.items[0];
  const fields = first && isContext(first, 0) && first.constructed ? tbs.items.slice(1) : tbs.items;
  const spki = fields[5];
  if (!spki || !isUniversal(spki, SEQUENCE) || !spki.constructed) return null;
  return der.slice(spki.start, spki.end);
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
/** AlgorithmIdentifier { rsaEncryption (1.2.840.113549.1.1.1), NULL }. */
const RSA_ALGORITHM = [0x30, 0x0d, 0x06, 0x09, 0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 0x01, 0x01, 0x01, 0x05, 0x00];

/** PKCS#1 `RSAPublicKey` → SPKI: SEQUENCE { AlgorithmIdentifier, BIT STRING (0x00 ‖ pkcs1) }. */
export const spkiOfPkcs1 = (pkcs1: Uint8Array): Uint8Array<ArrayBuffer> =>
  new Uint8Array(element(0x30, [...RSA_ALGORITHM, ...element(0x03, [0, ...pkcs1])]));

export type SpkiKind =
  | { type: 'RSA'; bits: number }
  | { type: 'EC'; curve: string }
  | { type: 'Ed25519' }
  | { type: 'Ed448' }
  | { type: 'unknown' };

const CURVES: Record<string, string> = {
  '1.2.840.10045.3.1.7': 'P-256',
  '1.3.132.0.34': 'P-384',
  '1.3.132.0.35': 'P-521',
  '1.3.132.0.10': 'secp256k1',
};

/** What an SPKI holds (RSA and its size, the EC curve, Ed25519, Ed448), read without WebCrypto. */
export const spkiKind = (der: Uint8Array): SpkiKind => {
  const spki = sequenceAt(der);
  const algorithm = spki?.items[0] && sequenceAt(der, spki.items[0].start);
  const key = spki?.items[1];
  if (!spki || !algorithm || !key || !primitive(key, BIT_STRING) || !primitive(algorithm.items[0], OBJECT_IDENTIFIER))
    return { type: 'unknown' };
  const oid = oidOf(der, algorithm.items[0]);
  if (oid === '1.3.101.112') return { type: 'Ed25519' };
  if (oid === '1.3.101.113') return { type: 'Ed448' };
  if (oid === '1.2.840.10045.2.1') {
    const param = algorithm.items[1];
    return {
      type: 'EC',
      curve: primitive(param, OBJECT_IDENTIFIER) ? (CURVES[oidOf(der, param) ?? ''] ?? 'an unknown curve') : 'unknown',
    };
  }
  if (oid === '1.2.840.113549.1.1.1') {
    const rsa = sequenceAt(der, key.body + 1);
    const modulus = rsa?.items[0];
    return {
      type: 'RSA',
      bits: primitive(modulus, INTEGER) ? unsignedBits(der.subarray(modulus!.body, modulus!.end)) : 0,
    };
  }
  return { type: 'unknown' };
};

/** The bit length of a big-endian unsigned integer (an RSA modulus; a leading 0x00 of DER's sign is skipped). */
export const unsignedBits = (bytes: Uint8Array): number => {
  let i = 0;
  while (i < bytes.length - 1 && bytes[i] === 0) i++;
  const first = bytes[i] ?? 0;
  return first === 0 ? 0 : (bytes.length - i - 1) * 8 + (32 - Math.clz32(first));
};
