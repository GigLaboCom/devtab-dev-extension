/**
 * What a DER file is by its structure (docs/tools/specs/base64-file.md §5.2, table «DER»): a certificate, a request, a
 * revocation list, a public or private key, a PKCS #7 or PKCS #12 container — or other DER. The whole file must be one
 * element the shared strict reader accepts. Shapes only: nothing is verified, no key is read beyond its outline.
 */
import { children, parseDer, readInteger, readOid } from '@workspace/tools-shared/der';
import type { TypeId } from './types';
import type { Tlv } from '@workspace/tools-shared/der';

const SEQUENCE = 16;
const INTEGER = 2;
const BIT_STRING = 3;
const OCTET_STRING = 4;
const OID = 6;
const UTC_TIME = 23;
const GENERALIZED_TIME = 24;

const is = (t: Tlv | undefined, tag: number): boolean => !!t && t.cls === 'universal' && t.tag === tag;
const ctx = (t: Tlv | undefined, tag: number): boolean => !!t && t.cls === 'context' && t.tag === tag;
const isTime = (t: Tlv | undefined): boolean => is(t, UTC_TIME) || is(t, GENERALIZED_TIME);

const kids = (der: Uint8Array, t: Tlv | undefined): Tlv[] | null => {
  if (!t || !t.constructed) return null;
  const read = children(der, t);
  return read.ok ? read.items : null;
};
const int = (der: Uint8Array, t: Tlv | undefined): bigint | null => {
  if (!is(t, INTEGER)) return null;
  const read = readInteger(der, t!);
  return read.ok ? read.value : null;
};
const oid = (der: Uint8Array, t: Tlv | undefined): string | null => {
  if (!is(t, OID)) return null;
  const read = readOid(der, t!);
  return read.ok ? read.value : null;
};
/** An AlgorithmIdentifier: SEQUENCE { OID, … }. */
const algorithm = (der: Uint8Array, t: Tlv | undefined): boolean => {
  const k = kids(der, t);
  return !!k && is(t, SEQUENCE) && oid(der, k[0]) !== null;
};
/** SEQUENCE { tbs SEQUENCE, AlgorithmIdentifier, BIT STRING } — the signed envelope of certificates, CRLs and CSRs. */
const signed = (der: Uint8Array, top: Tlv[]): Tlv[] | null =>
  top.length === 3 && is(top[0], SEQUENCE) && algorithm(der, top[1]) && is(top[2], BIT_STRING)
    ? kids(der, top[0])
    : null;

const PKCS7_TYPES = /^1\.2\.840\.113549\.1\.7\.[1-6]$/;

/** The form of `der`, or null when it is not one DER element filling all the bytes. Up to `maxBytes`. */
export const derForm = (der: Uint8Array, maxBytes: number): TypeId | null => {
  if (der.length < 2 || der[0] !== 0x30) return null;
  const parsed = parseDer(der, { maxBytes });
  if (!parsed.ok || parsed.trailing !== 0) return null;
  const top = kids(der, parsed.root);
  if (!top) return null;

  const tbs = signed(der, top);
  if (tbs) {
    // Certificate (RFC 5280 §4.1): [0] version?, serial, signature, issuer, validity { time, time }, subject, SPKI…
    const c = ctx(tbs[0], 0) ? tbs.slice(1) : tbs;
    const validity = kids(der, c[3]);
    if (
      is(c[0], INTEGER) &&
      algorithm(der, c[1]) &&
      is(c[2], SEQUENCE) &&
      validity?.length === 2 &&
      isTime(validity[0]) &&
      isTime(validity[1]) &&
      is(c[4], SEQUENCE) &&
      is(c[5], SEQUENCE)
    )
      return 'x509';
    // CSR (RFC 2986 §4): CertificationRequestInfo { version 0, subject, SPKI, [0] attributes }.
    if (int(der, tbs[0]) === 0n && is(tbs[1], SEQUENCE) && is(tbs[2], SEQUENCE) && ctx(tbs[3], 0) && tbs.length === 4)
      return 'csr';
    // CRL (RFC 5280 §5.1): version?, signature, issuer, thisUpdate, nextUpdate?, revoked?, [0] extensions?
    const r = is(tbs[0], INTEGER) ? tbs.slice(1) : tbs;
    if (algorithm(der, r[0]) && is(r[1], SEQUENCE) && isTime(r[2])) return 'crl';
  }

  // SubjectPublicKeyInfo (RFC 5280 §4.1.2.7): { AlgorithmIdentifier, BIT STRING }.
  if (top.length === 2 && algorithm(der, top[0]) && is(top[1], BIT_STRING)) return 'spki';
  // EncryptedPrivateKeyInfo (RFC 5958 §3): { AlgorithmIdentifier, OCTET STRING }.
  if (top.length === 2 && algorithm(der, top[0]) && is(top[1], OCTET_STRING)) return 'pkcs8-encrypted';
  const first = int(der, top[0]);
  // OneAsymmetricKey / PrivateKeyInfo (RFC 5958 §2): { version 0|1, AlgorithmIdentifier, OCTET STRING, … }.
  if ((first === 0n || first === 1n) && algorithm(der, top[1]) && is(top[2], OCTET_STRING)) return 'pkcs8';
  // RSAPrivateKey (RFC 8017 A.1.2): version 0|1 and n, e, d, p, q, dP, dQ, qInv — all INTEGER.
  if ((first === 0n || first === 1n) && top.length >= 9 && top.slice(0, 9).every(t => is(t, INTEGER)))
    return 'rsa-private';
  // ECPrivateKey (RFC 5915 §3): { version 1, OCTET STRING, [0] parameters?, [1] publicKey? }.
  if (first === 1n && is(top[1], OCTET_STRING) && top.length <= 4 && top.slice(2).every(t => ctx(t, 0) || ctx(t, 1)))
    return 'ec-private';
  // PFX (RFC 7292 §4): { version 3, ContentInfo { data or signedData, [0] }, MacData? }.
  if (first === 3n && is(top[1], SEQUENCE)) {
    const info = kids(der, top[1]);
    const type = oid(der, info?.[0]);
    if (type === '1.2.840.113549.1.7.1' || type === '1.2.840.113549.1.7.6') return 'pkcs12';
  }
  // RSAPublicKey (RFC 8017 A.1.1): { modulus, publicExponent }.
  if (top.length === 2 && is(top[0], INTEGER) && is(top[1], INTEGER)) return 'rsa-public';
  // ContentInfo (RFC 5652 §3): { contentType 1.2.840.113549.1.7.1–6, [0] content }.
  const type = oid(der, top[0]);
  if (type && PKCS7_TYPES.test(type) && (top.length === 1 || ctx(top[1], 0))) return 'pkcs7';
  return 'der';
};

/** Does `head` start like a DER SEQUENCE whose length says exactly `size` bytes (a quick test before reading it all)? */
export const derOutline = (head: Uint8Array, size: number): boolean => {
  if (head.length < 2 || head[0] !== 0x30) return false;
  const first = head[1]!;
  if (first < 0x80) return 2 + first === size;
  const count = first & 0x7f;
  if (count < 1 || count > 4 || head.length < 2 + count || head[2] === 0) return false;
  let length = 0;
  for (let i = 0; i < count; i++) length = length * 256 + head[2 + i]!;
  return length >= 0x80 && 2 + count + length === size;
};
