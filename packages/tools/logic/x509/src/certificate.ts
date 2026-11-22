/**
 * One certificate (RFC 5280 §4.1; docs/tools/specs/x509.md §5.2–§5.8): the DER is first checked strictly as a whole
 * (the shared reader), then read field by field. A structure that is not a certificate's gives one sentence with the
 * byte it is about; an extension that does not decode keeps its hex and the rest is read on.
 */
import { DECODERS } from './extensions';
import {
  COULD_NOT_DECODE,
  NOT_A_CERTIFICATE,
  TRUNCATED_HINT,
  WARN_ALGORITHMS_DIFFER,
  WARN_LONG_SERIAL,
  WARN_NEGATIVE_SERIAL,
  WARN_WEAK_RSA,
  WARN_WEAK_SIGNATURE,
  warnCriticalFalse,
  warnExtensionsInV,
  warnTwice,
} from './messages';
import { readName } from './names';
import {
  CURVES,
  DSA,
  EC,
  EXTENSIONS,
  HASHES,
  KEY_NAMES,
  RSA,
  RSA_PSS,
  SIGNATURE_ALGORITHMS,
  WEAK_SIGNATURES,
} from './oids';
import { Failure, fail, hexColons, inner, integerHex, isType, must, sequence } from './read';
import {
  contentOf,
  describeTag,
  explicit,
  isContext,
  parseDer,
  readBitString,
  readBoolean,
  readInteger,
  readOctetString,
  readOid,
  readTime,
  UNIVERSAL,
} from '@workspace/tools-shared/der';
import type { ExtensionContext } from './extensions';
import type { Name } from './names';
import type { DerError, Tlv } from '@workspace/tools-shared/der';

export type { Name, NameAttribute } from './names';

export interface CertTime {
  /** The characters as written: `251119120000Z`. */
  raw: string;
  type: 'UTCTime' | 'GeneralizedTime';
  /** The instant; absent when `raw` is not RFC 5280's form. */
  date?: Date;
  valid: boolean;
  /** `99991231235959Z`: no well-defined expiration date (RFC 5280 §4.1.2.5). */
  noExpiry?: true;
  /** Why it is not RFC 5280's form. */
  problem?: string;
}

export interface PublicKeyInfo {
  /** The algorithm's OID. */
  algorithm: string;
  /** Its name (`RSA`, `EC`, `Ed25519`…), or the OID. */
  name: string;
  /** `RSA 2048-bit, exponent 65537`, `EC P-256`, `Ed25519`. */
  description: string;
  /** The DER of subjectPublicKeyInfo (its SHA-256 is the pin, §5.6). */
  spkiDer: Uint8Array;
  bits?: number;
  weak?: true;
}

export type ExtensionValue =
  | { kind: 'text'; lines: string[] } // decoded, one entry per line
  | { kind: 'hex'; hex: string; error?: string; detail?: string };

export interface Extension {
  oid: string;
  name: string;
  critical: boolean;
  value: ExtensionValue;
  /** Where the extension starts in the certificate. */
  offset: number;
}

export interface Certificate {
  version: 1 | 2 | 3;
  /** Uppercase hex without separators or the sign byte (`1234567890ABCDEF`); negative: `-` and the magnitude. */
  serialHex: string;
  /** Decimal; empty for a serial longer than 256 bytes. */
  serialDecimal: string;
  /** The signature algorithm's name (§5.6), or its OID. */
  signatureAlgorithm: string;
  signatureAlgorithmOid: string;
  signatureBytes: number;
  signatureHex: string;
  issuer: Name;
  subject: Name;
  notBefore: CertTime;
  notAfter: CertTime;
  publicKey: PublicKeyInfo;
  extensions: Extension[];
  /** Issuer and subject are the same bytes (RFC 5280's term); whether it signed itself is not checked. */
  selfIssued: boolean;
  /** Basic constraints say `CA: yes`. */
  ca: boolean;
  issuerUniqueId?: string;
  subjectUniqueId?: string;
  warnings: string[];
  der: Uint8Array;
}

export type ParseResult = { ok: true; certificate: Certificate } | { ok: false; message: string; offset?: number };

/** `Byte 412: the element is longer than the data left (truncated certificate?).` */
export const derMessage = (error: DerError): string =>
  `Byte ${error.offset}: ${error.message}${error.code === 'truncated' ? TRUNCATED_HINT : ''}.`;

const DECIMAL_LIMIT = 256;

interface Algorithm {
  oid: string;
  name: string;
  der: Uint8Array;
  params?: Tlv;
}

const algorithmIdentifier = (der: Uint8Array, tlv: Tlv | undefined, what: string): Algorithm => {
  const [id, params, extra] = sequence(der, tlv, what);
  if (!isType(id, UNIVERSAL.OBJECT_IDENTIFIER)) return fail(tlv!.body, `${what} starts with an OBJECT IDENTIFIER`);
  if (extra) fail(extra.start, `unexpected ${describeTag(extra)} in ${what}`);
  const oid = must(readOid(der, id));
  return {
    oid,
    name: SIGNATURE_ALGORITHMS[oid] ?? oid,
    der: der.subarray(tlv!.start, tlv!.end),
    ...(params ? { params } : {}),
  };
};

/** RSASSA-PSS with the hash of its parameters (RFC 4055 §3.1; absent `[0]`: SHA-1). */
const pssName = (der: Uint8Array, params: Tlv | undefined): string => {
  try {
    if (!params || !isType(params, UNIVERSAL.SEQUENCE)) return 'RSASSA-PSS';
    const hash = sequence(der, params, 'RSASSA-PSS parameters').find(p => isContext(p, 0));
    if (!hash) return 'RSASSA-PSS with SHA-1';
    const oid = must(readOid(der, sequence(der, must(explicit(der, hash)), 'a hash algorithm')[0]!));
    return `RSASSA-PSS with ${HASHES[oid] ?? oid}`;
  } catch (error) {
    if (error instanceof Failure) return 'RSASSA-PSS';
    throw error;
  }
};

const certTime = (der: Uint8Array, tlv: Tlv | undefined, what: string): CertTime => {
  if (!tlv) return fail(der.length, `${what} is missing`);
  const t = must(readTime(der, tlv));
  return {
    raw: t.raw,
    type: t.type,
    valid: t.epochMs !== undefined,
    ...(t.epochMs !== undefined ? { date: new Date(t.epochMs) } : {}),
    ...(t.type === 'GeneralizedTime' && t.raw === '99991231235959Z' ? { noExpiry: true as const } : {}),
    ...(t.problem ? { problem: t.problem } : {}),
  };
};

/** The bit length of a big-endian unsigned integer's bytes (DER's sign byte skipped). */
const bitLength = (bytes: Uint8Array): number => {
  let i = 0;
  while (i < bytes.length && bytes[i] === 0) i++;
  return i === bytes.length ? 0 : (bytes.length - i - 1) * 8 + (32 - Math.clz32(bytes[i]!));
};

/** An INTEGER in decimal, or in hex when it is long (a decimal of thousands of digits helps no one). */
const smallInteger = (der: Uint8Array, tlv: Tlv): string =>
  tlv.length <= 64 ? must(readInteger(der, tlv)).toString() : `0x${integerHex(der, tlv)}`;

/** subjectPublicKeyInfo (§5.6): what the key is, read as far as it shows its size or curve. */
const publicKey = (der: Uint8Array, tlv: Tlv | undefined, warnings: string[]): PublicKeyInfo => {
  const [algorithm, key, extra] = sequence(der, tlv, 'the public key (subjectPublicKeyInfo)');
  if (extra) fail(extra.start, `unexpected ${describeTag(extra)} in the public key`);
  const alg = algorithmIdentifier(der, algorithm, 'the public key’s algorithm');
  if (!isType(key, UNIVERSAL.BIT_STRING)) return fail(algorithm!.end, 'the public key must be a BIT STRING');
  const bitString = must(readBitString(der, key));
  const spkiDer = der.slice(tlv!.start, tlv!.end);
  const base = { algorithm: alg.oid, spkiDer };
  if (alg.oid === RSA || alg.oid === RSA_PSS) {
    const name = alg.oid === RSA ? 'RSA' : 'RSA-PSS';
    if (bitString.unusedBits !== 0) fail(key.start, 'an RSA key’s BIT STRING has unused bits');
    const rsa = inner(der, key.body + 1, key.end);
    const [modulus, exponent, more] = sequence(der, rsa, 'an RSA public key (SEQUENCE of modulus and exponent)');
    if (!isType(modulus, UNIVERSAL.INTEGER) || !isType(exponent, UNIVERSAL.INTEGER) || more)
      return fail(rsa.start, 'an RSA public key is two INTEGERs: the modulus and the exponent');
    must(readInteger(der, modulus));
    const bits = bitLength(contentOf(der, modulus));
    const weak = bits < 2048;
    if (weak) warnings.push(WARN_WEAK_RSA);
    return {
      ...base,
      name,
      bits,
      description: `${name} ${bits}-bit, exponent ${smallInteger(der, exponent)}`,
      ...(weak ? { weak: true as const } : {}),
    };
  }
  if (alg.oid === EC) {
    const params = alg.params;
    const curve = isType(params, UNIVERSAL.OBJECT_IDENTIFIER)
      ? (() => {
          const oid = must(readOid(der, params));
          return CURVES[oid] ?? oid;
        })()
      : isType(params, UNIVERSAL.SEQUENCE)
        ? 'with explicit curve parameters'
        : 'with an inherited curve';
    return { ...base, name: 'EC', description: `EC ${curve}` };
  }
  if (alg.oid === DSA) {
    const params = alg.params;
    if (isType(params, UNIVERSAL.SEQUENCE)) {
      const [p] = sequence(der, params, 'DSA parameters');
      if (isType(p, UNIVERSAL.INTEGER)) {
        must(readInteger(der, p));
        const bits = bitLength(contentOf(der, p));
        return { ...base, name: 'DSA', bits, description: `DSA ${bits}-bit` };
      }
    }
    return { ...base, name: 'DSA', description: 'DSA' };
  }
  const name = KEY_NAMES[alg.oid] ?? alg.oid;
  return { ...base, name, description: name };
};

const extensionList = (der: Uint8Array, tlv: Tlv, warnings: string[], context: ExtensionContext): Extension[] => {
  const list = sequence(der, must(explicit(der, tlv)), 'the extensions (a SEQUENCE)');
  if (list.length === 0) fail(tlv.start, 'the extensions field is empty (RFC 5280 §4.1: SIZE (1..MAX))');
  const seen = new Set<string>();
  return list.map(item => {
    const parts = sequence(der, item, 'an extension (SEQUENCE)');
    const [id] = parts;
    if (!isType(id, UNIVERSAL.OBJECT_IDENTIFIER))
      return fail(item.body, 'an extension starts with its OBJECT IDENTIFIER');
    const oid = must(readOid(der, id));
    const name = EXTENSIONS[oid] ?? oid;
    let i = 1;
    let critical = false;
    if (isType(parts[i], UNIVERSAL.BOOLEAN)) {
      critical = must(readBoolean(der, parts[i]!));
      if (!critical) warnings.push(warnCriticalFalse(name));
      i++;
    }
    const value = parts[i];
    const where = (value as Tlv | undefined)?.start ?? item.start;
    if (!isType(value, UNIVERSAL.OCTET_STRING)) return fail(where, 'an extension’s value must be an OCTET STRING');
    if (parts[i + 1]) fail(parts[i + 1]!.start, `unexpected ${describeTag(parts[i + 1]!)} after an extension’s value`);
    if (seen.has(oid)) warnings.push(warnTwice(name));
    seen.add(oid);
    const bytes = must(readOctetString(der, value));
    const decode = DECODERS[oid];
    let shown: ExtensionValue;
    if (!decode) shown = { kind: 'hex', hex: hexColons(bytes) };
    else {
      try {
        shown = { kind: 'text', lines: decode(der, inner(der, value.body, value.end), context) };
      } catch (error) {
        if (!(error instanceof Failure)) throw error;
        shown = { kind: 'hex', hex: hexColons(bytes), error: COULD_NOT_DECODE, detail: derMessage(error.error) };
      }
    }
    return { oid, name, critical, value: shown, offset: item.start };
  });
};

const uniqueId = (der: Uint8Array, tlv: Tlv): string => {
  const { bytes } = must(readBitString(der, tlv, true));
  return hexColons(bytes);
};

const readCertificate = (der: Uint8Array, root: Tlv): Certificate => {
  const warnings: string[] = [];
  const top = isType(root, UNIVERSAL.SEQUENCE) ? sequence(der, root, 'a certificate') : [];
  const [tbs, outerAlgorithm, signature] = top;
  if (
    top.length !== 3 ||
    !isType(tbs, UNIVERSAL.SEQUENCE) ||
    !isType(outerAlgorithm, UNIVERSAL.SEQUENCE) ||
    !isType(signature, UNIVERSAL.BIT_STRING)
  )
    return fail(0, NOT_A_CERTIFICATE, 'wrong-type');
  const fields = sequence(der, tbs, 'the tbsCertificate');
  let i = 0;
  let version: 1 | 2 | 3 = 1;
  if (fields[i] && isContext(fields[i]!, 0)) {
    const v = must(explicit(der, fields[i]!));
    const n = must(readInteger(der, v));
    if (n < 0n || n > 2n) fail(v.start, `the version must be 0, 1 or 2 (v1–v3), found ${n}`);
    version = (Number(n) + 1) as 1 | 2 | 3;
    i++;
  }
  const serial = fields[i++];
  const serialAt = (serial as Tlv | undefined)?.start ?? tbs.body;
  if (!isType(serial, UNIVERSAL.INTEGER)) return fail(serialAt, 'expected the serial number (an INTEGER)');
  const serialValue = must(readInteger(der, serial));
  if (serialValue < 0n) warnings.push(WARN_NEGATIVE_SERIAL);
  if (serial.length > 20) warnings.push(WARN_LONG_SERIAL);
  const innerAlgorithm = algorithmIdentifier(der, fields[i++], 'the signature algorithm');
  const issuer = readName(der, fields[i++], 'issuer', warnings);
  const validity = sequence(der, fields[i++], 'the validity (a SEQUENCE of two times)');
  if (validity.length !== 2) fail(fields[i - 1]!.start, 'the validity must hold exactly two times');
  const notBefore = certTime(der, validity[0], 'notBefore');
  const notAfter = certTime(der, validity[1], 'notAfter');
  const subject = readName(der, fields[i++], 'subject', warnings);
  const key = publicKey(der, fields[i++], warnings);
  let issuerUniqueId: string | undefined;
  let subjectUniqueId: string | undefined;
  let extensions: Extension[] = [];
  const context: ExtensionContext = { warnings };
  let last = 0;
  for (; i < fields.length; i++) {
    const f = fields[i]!;
    const order = f.cls === 'context' ? f.tag : 0;
    if (order < 1 || order > 3 || order <= last)
      return fail(f.start, `unexpected ${describeTag(f)} in the tbsCertificate`);
    last = order;
    if (order === 1) issuerUniqueId = uniqueId(der, f);
    else if (order === 2) subjectUniqueId = uniqueId(der, f);
    else {
      if (version < 3) warnings.push(warnExtensionsInV(version));
      extensions = extensionList(der, f, warnings, context);
    }
  }
  const alg = algorithmIdentifier(der, outerAlgorithm, 'the signature algorithm');
  const signatureAlgorithm = alg.oid === RSA_PSS ? pssName(der, alg.params) : alg.name;
  if (alg.der.length !== innerAlgorithm.der.length || alg.der.some((b, k) => b !== innerAlgorithm.der[k]))
    warnings.push(WARN_ALGORITHMS_DIFFER);
  if (WEAK_SIGNATURES.has(alg.oid)) warnings.push(WARN_WEAK_SIGNATURE);
  const sig = must(readBitString(der, signature));
  const selfIssued = issuer.der.length === subject.der.length && issuer.der.every((b, k) => b === subject.der[k]);
  return {
    version,
    serialHex: integerHex(der, serial),
    serialDecimal: serial.length <= DECIMAL_LIMIT ? serialValue.toString() : '',
    signatureAlgorithm,
    signatureAlgorithmOid: alg.oid,
    signatureBytes: sig.bytes.length,
    signatureHex: hexColons(sig.bytes),
    issuer,
    subject,
    notBefore,
    notAfter,
    publicKey: key,
    extensions,
    selfIssued,
    ca: context.ca === true,
    ...(issuerUniqueId !== undefined ? { issuerUniqueId } : {}),
    ...(subjectUniqueId !== undefined ? { subjectUniqueId } : {}),
    warnings: [...new Set(warnings)],
    der,
  };
};

/**
 * Reads one certificate's DER (exactly one element; bytes after it are the caller's to report). Never throws: a
 * structure that is not a certificate's is `{ ok: false, message: 'Byte N: …', offset }`.
 */
export const parseCertificate = (der: Uint8Array): ParseResult => {
  const checked = parseDer(der);
  if (!checked.ok) return { ok: false, message: derMessage(checked.error), offset: checked.error.offset };
  const exact = checked.trailing > 0 ? der.subarray(0, checked.root.end) : der;
  try {
    return { ok: true, certificate: readCertificate(exact, checked.root) };
  } catch (error) {
    if (error instanceof Failure) return { ok: false, message: derMessage(error.error), offset: error.error.offset };
    return { ok: false, message: 'This certificate could not be read.' };
  }
};
