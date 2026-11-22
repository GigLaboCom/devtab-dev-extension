/**
 * DER written by hand, for the tests: certificates and other structures OpenSSL will not make (a UniversalString name,
 * a negative serial, a time without seconds, a duplicated or broken extension, x400Address and ediPartyName). The
 * signatures are filler bytes — the tool never checks a signature. Not part of the tool: nothing outside the tests
 * imports it.
 */

export type Bytes = Uint8Array | number[];

const flat = (parts: Bytes[]): number[] => parts.flatMap(p => Array.from(p));

const lengthOf = (n: number): number[] => {
  if (n < 0x80) return [n];
  const out: number[] = [];
  for (let v = n; v > 0; v = Math.floor(v / 256)) out.unshift(v & 0xff);
  return [0x80 | out.length, ...out];
};

/** One element with the identifier byte `id`, the shortest length and `parts` as content. */
export const tlv = (id: number, ...parts: Bytes[]): number[] => {
  const body = flat(parts);
  return [id, ...lengthOf(body.length), ...body];
};

export const seq = (...parts: Bytes[]): number[] => tlv(0x30, ...parts);
export const set = (...parts: Bytes[]): number[] => tlv(0x31, ...parts);
export const nul = (): number[] => [0x05, 0x00];
export const bool = (v: boolean): number[] => [0x01, 0x01, v ? 0xff : 0x00];
export const octet = (...parts: Bytes[]): number[] => tlv(0x04, ...parts);
export const bits = (bytes: Bytes, unused = 0): number[] => tlv(0x03, [unused], bytes);
/** `[n]` constructed (explicit, or an implicit SEQUENCE / SET). */
export const ctx = (n: number, ...parts: Bytes[]): number[] => tlv(0xa0 | n, ...parts);
/** `[n]` primitive (an implicit string, OCTET STRING, INTEGER, OID). */
export const prim = (n: number, ...parts: Bytes[]): number[] => tlv(0x80 | n, ...parts);

/** INTEGER, shortest two's complement. */
export const int = (value: number | bigint): number[] => {
  let v = BigInt(value);
  const out: number[] = [];
  for (;;) {
    out.unshift(Number(v & 0xffn));
    const rest = v >> 8n;
    const sign = out[0]! & 0x80;
    if ((rest === 0n && !sign) || (rest === -1n && sign)) break;
    v = rest;
  }
  return tlv(0x02, out);
};

/** INTEGER from its exact content bytes (for non-minimal or long serials). */
export const intBytes = (bytes: Bytes): number[] => tlv(0x02, bytes);

const base128 = (n: bigint): number[] => {
  const out = [Number(n & 0x7fn)];
  for (let v = n >> 7n; v > 0n; v >>= 7n) out.unshift(Number(v & 0x7fn) | 0x80);
  return out;
};

export const oidContent = (dotted: string): number[] => {
  const arcs = dotted.split('.').map(BigInt);
  return [...base128(arcs[0]! * 40n + arcs[1]!), ...arcs.slice(2).flatMap(base128)];
};
export const oid = (dotted: string): number[] => tlv(0x06, oidContent(dotted));

const utf8 = (s: string): number[] => Array.from(new TextEncoder().encode(s));
export const utf8String = (s: string): number[] => tlv(0x0c, utf8(s));
export const printable = (s: string): number[] => tlv(0x13, utf8(s));
export const ia5 = (s: string): number[] => tlv(0x16, utf8(s));
export const teletex = (s: string): number[] =>
  tlv(
    0x14,
    Array.from(s, c => c.charCodeAt(0) & 0xff),
  );
export const bmp = (s: string): number[] =>
  tlv(
    0x1e,
    Array.from(s).flatMap(c => {
      const units: number[] = [];
      for (let i = 0; i < c.length; i++) units.push(c.charCodeAt(i) >> 8, c.charCodeAt(i) & 0xff);
      return units;
    }),
  );
export const universal = (s: string): number[] =>
  tlv(
    0x1c,
    Array.from(s).flatMap(c => {
      const cp = c.codePointAt(0)!;
      return [(cp >>> 24) & 0xff, (cp >> 16) & 0xff, (cp >> 8) & 0xff, cp & 0xff];
    }),
  );
export const utcTime = (s: string): number[] => tlv(0x17, utf8(s));
export const generalizedTime = (s: string): number[] => tlv(0x18, utf8(s));

/** A Name of RDNs; each RDN a list of [oid, value DER]. */
export const name = (...rdns: Array<Array<[string, Bytes]>>): number[] =>
  seq(...rdns.map(rdn => set(...rdn.map(([type, value]) => seq(oid(type), value)))));
export const cn = (text: string): number[] => name([['2.5.4.3', utf8String(text)]]);

export const extension = (id: string, value: Bytes, critical?: boolean): number[] =>
  seq(oid(id), ...(critical === undefined ? [] : [bool(critical)]), octet(value));

export const ECDSA_SHA256 = seq(oid('1.2.840.10045.4.3.2'));
/** An EC P-256 key with filler point bytes. */
export const P256_SPKI = seq(
  seq(oid('1.2.840.10045.2.1'), oid('1.2.840.10045.3.1.7')),
  bits([0x04, ...new Array(64).fill(0x11)]),
);

export interface CertificateParts {
  /** null: no [0] version field (v1). */
  version?: number | null;
  serial?: Bytes;
  signature?: Bytes;
  issuer?: Bytes;
  notBefore?: Bytes;
  notAfter?: Bytes;
  subject?: Bytes;
  spki?: Bytes;
  issuerUniqueId?: Bytes;
  subjectUniqueId?: Bytes;
  /** null: no [3] field. */
  extensions?: Bytes[] | null;
  outerSignature?: Bytes;
  signatureValue?: Bytes;
}

/** A certificate's DER with defaults for every part: v3, serial 1, ECDSA with SHA-256, CN=builder.example. */
export const certificate = (parts: CertificateParts = {}): Uint8Array => {
  const {
    version = 2,
    serial = int(1),
    signature = ECDSA_SHA256,
    issuer = cn('builder.example'),
    notBefore = utcTime('250101000000Z'),
    notAfter = utcTime('350101000000Z'),
    subject = issuer,
    spki = P256_SPKI,
    issuerUniqueId,
    subjectUniqueId,
    extensions = [extension('2.5.29.19', seq(), true)],
    outerSignature = signature,
    signatureValue = bits(seq(int(1), int(1))),
  } = parts;
  const tbs = seq(
    ...(version === null ? [] : [ctx(0, int(version))]),
    serial,
    signature,
    issuer,
    seq(notBefore, notAfter),
    subject,
    spki,
    ...(issuerUniqueId ? [prim(1, issuerUniqueId)] : []),
    ...(subjectUniqueId ? [prim(2, subjectUniqueId)] : []),
    ...(extensions === null ? [] : [ctx(3, seq(...extensions))]),
  );
  return new Uint8Array(seq(tbs, outerSignature, signatureValue));
};
