/**
 * The little DER the tool needs (docs/tools/specs/jwt.md §5.4): read a TLV and its children, take the
 * `subjectPublicKeyInfo` out of a certificate (RFC 5280 §4.1), wrap a PKCS#1 `RSAPublicKey` into an SPKI (WebCrypto
 * imports only SPKI), and say what kind of key an SPKI holds — before WebCrypto sees it, so a wrong key gets words.
 * Definite lengths only (DER); anything else reads as "not this".
 */

export interface Tlv {
  /** The identifier octet (low tag numbers only: 0x30 SEQUENCE, 0x02 INTEGER, 0xa0 [0] …). */
  tag: number;
  start: number;
  /** Where the content starts. */
  body: number;
  end: number;
}

/** The element at `offset`, or null when it is not a DER element that fits in `der`. */
export const readTlv = (der: Uint8Array, offset: number): Tlv | null => {
  if (offset + 2 > der.length) return null;
  const tag = der[offset]!;
  if ((tag & 0x1f) === 0x1f) return null;
  let length = der[offset + 1]!;
  let body = offset + 2;
  if (length & 0x80) {
    const count = length & 0x7f;
    if (count === 0 || count > 4 || body + count > der.length) return null;
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + der[body + i]!;
    body += count;
  }
  const end = body + length;
  return end > der.length ? null : { tag, start: offset, body, end };
};

/** The elements inside a constructed element, or null when they do not fill it exactly. */
export const children = (der: Uint8Array, parent: Tlv): Tlv[] | null => {
  const items: Tlv[] = [];
  for (let at = parent.body; at < parent.end;) {
    const item = readTlv(der, at);
    if (!item || item.end > parent.end) return null;
    items.push(item);
    at = item.end;
  }
  return items;
};

const SEQUENCE = 0x30;
const BIT_STRING = 0x03;
const OID = 0x06;
const INTEGER = 0x02;

/** Dotted notation of an OBJECT IDENTIFIER's content. */
const readOid = (der: Uint8Array, tlv: Tlv): string => {
  const arcs: number[] = [];
  let value = 0;
  for (let i = tlv.body; i < tlv.end; i++) {
    value = value * 128 + (der[i]! & 0x7f);
    if (der[i]! & 0x80) continue;
    if (arcs.length === 0) arcs.push(value < 80 ? Math.floor(value / 40) : 2, value < 80 ? value % 40 : value - 80);
    else arcs.push(value);
    value = 0;
  }
  return arcs.join('.');
};

const sequenceAt = (der: Uint8Array, offset = 0): { tlv: Tlv; items: Tlv[] } | null => {
  const tlv = readTlv(der, offset);
  if (!tlv || tlv.tag !== SEQUENCE) return null;
  const items = children(der, tlv);
  return items && { tlv, items };
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
  const fields = tbs.items[0]?.tag === 0xa0 ? tbs.items.slice(1) : tbs.items;
  const spki = fields[5];
  if (!spki || spki.tag !== SEQUENCE) return null;
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
  new Uint8Array(element(SEQUENCE, [...RSA_ALGORITHM, ...element(BIT_STRING, [0, ...pkcs1])]));

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
  if (!spki || !algorithm || !key || key.tag !== BIT_STRING || algorithm.items[0]?.tag !== OID)
    return { type: 'unknown' };
  const oid = readOid(der, algorithm.items[0]);
  if (oid === '1.3.101.112') return { type: 'Ed25519' };
  if (oid === '1.3.101.113') return { type: 'Ed448' };
  if (oid === '1.2.840.10045.2.1') {
    const param = algorithm.items[1];
    return { type: 'EC', curve: param?.tag === OID ? (CURVES[readOid(der, param)] ?? 'an unknown curve') : 'unknown' };
  }
  if (oid === '1.2.840.113549.1.1.1') {
    const rsa = sequenceAt(der, key.body + 1);
    const modulus = rsa?.items[0];
    return { type: 'RSA', bits: modulus?.tag === INTEGER ? unsignedBits(der.subarray(modulus.body, modulus.end)) : 0 };
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
