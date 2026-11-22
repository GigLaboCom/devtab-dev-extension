/**
 * Keys in DER, read with the shared strict reader (docs/tools/specs/keys.md §5.5): what a DER element is by its outer
 * tags (`shapeOf`), and the readers of SPKI, PKCS#8 (OneAsymmetricKey v1 and v2), PKCS#1 (public and private) and
 * SEC1. A reader throws a `KeyError` with the sentence a person sees; nothing is guessed.
 */
import { stripZeros } from './bytes';
import { curveOfOid, FIELD_BYTES, OID, OTHER_ALGORITHMS, OTHER_CURVES } from './oids';
import {
  children,
  contentOf,
  isContext,
  isUniversal,
  parseDer,
  readBitString,
  readInteger,
  readOctetString,
  readOid,
  UNIVERSAL,
} from '@workspace/tools-shared/der';
import type { Curve, KeyData } from './types';
import type { DerError, DerResult, Tlv } from '@workspace/tools-shared/der';

export class KeyError extends Error {}

export const derMessage = (error: DerError): string =>
  `Byte ${error.offset}: ${error.message}${error.code === 'truncated' && !error.message.includes('header') ? ' (truncated key?)' : ''}.`;

const get = <T>(result: DerResult<T>): T => {
  if (!result.ok) throw new KeyError(derMessage(result.error));
  return result.value;
};

const kids = (der: Uint8Array, tlv: Tlv): Tlv[] => {
  const read = children(der, tlv);
  if (!read.ok) throw new KeyError(derMessage(read.error));
  return read.items;
};

export type Shape =
  | 'spki'
  | 'pkcs8'
  | 'encrypted-pkcs8'
  | 'pkcs1-public'
  | 'pkcs1-private'
  | 'sec1'
  | 'dsa-private'
  | 'certificate'
  | 'csr'
  | 'unknown';

export const SHAPE_WORDS: Record<Shape, string> = {
  spki: 'a public key (SPKI)',
  pkcs8: 'a private key (PKCS#8)',
  'encrypted-pkcs8': 'an encrypted private key (PKCS#8)',
  'pkcs1-public': 'an RSA public key (PKCS#1)',
  'pkcs1-private': 'an RSA private key (PKCS#1)',
  sec1: 'an EC private key (SEC1)',
  'dsa-private': 'a DSA private key',
  certificate: 'a certificate',
  csr: 'a certificate request (CSR)',
  unknown: 'no key this tool knows',
};

/** The whole DER checked strictly, one element and nothing after it; its shape by the outer tags. */
export const parseKeyDer = (der: Uint8Array, where: string): { root: Tlv; shape: Shape } => {
  const parsed = parseDer(der);
  if (!parsed.ok) throw new KeyError(derMessage(parsed.error));
  if (parsed.trailing > 0)
    throw new KeyError(
      `${parsed.trailing} ${parsed.trailing === 1 ? 'byte follows' : 'bytes follow'} the key${where}; a key block holds one key.`,
    );
  return { root: parsed.root, shape: shapeOf(der, parsed.root) };
};

const isSeq = (t: Tlv | undefined): t is Tlv => !!t && isUniversal(t, UNIVERSAL.SEQUENCE);
const isInt = (t: Tlv | undefined): t is Tlv => !!t && isUniversal(t, UNIVERSAL.INTEGER);

export const shapeOf = (der: Uint8Array, root: Tlv): Shape => {
  if (!isSeq(root)) return 'unknown';
  const items = kids(der, root);
  const [a, b, c] = items;
  if (items.length === 2 && isSeq(a) && b && isUniversal(b, UNIVERSAL.BIT_STRING)) return 'spki';
  if (items.length === 2 && isSeq(a) && b && isUniversal(b, UNIVERSAL.OCTET_STRING)) return 'encrypted-pkcs8';
  if (items.length >= 3 && isInt(a) && isSeq(b) && c && isUniversal(c, UNIVERSAL.OCTET_STRING)) return 'pkcs8';
  if (items.length === 2 && isInt(a) && isInt(b)) return 'pkcs1-public';
  if (items.length >= 9 && items.every(isInt)) return 'pkcs1-private';
  if (items.length === 6 && items.every(isInt)) return 'dsa-private';
  if (items.length >= 2 && isInt(a) && b && isUniversal(b, UNIVERSAL.OCTET_STRING)) return 'sec1';
  if (items.length === 3 && isSeq(a) && isSeq(b) && c && isUniversal(c, UNIVERSAL.BIT_STRING)) {
    const inner = kids(der, a);
    if (inner[0] && isContext(inner[0], 0)) return 'certificate';
    // A CSR's second element is a Name (SETs); a v1 certificate's is the signature algorithm (an OID first).
    if (isInt(inner[0]) && isSeq(inner[1]) && kids(der, inner[1]).every(t => isUniversal(t, UNIVERSAL.SET)))
      return 'csr';
    return 'certificate';
  }
  return 'unknown';
};

const unsupportedAlgorithm = (oid: string): string => {
  const name = OTHER_ALGORITHMS[oid];
  if (name === 'DSA')
    return 'DSA keys are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.';
  if (name === 'Ed448' || name === 'X448')
    return `${name} keys are not supported: the browser's Web Crypto has no ${name}.`;
  if (name === 'RSA-PSS')
    return 'RSA-PSS-only keys (id-RSASSA-PSS) are not supported; a plain RSA key (rsaEncryption) is.';
  if (name) return `${name} keys are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.`;
  return `Keys of the algorithm ${oid} are not supported: the tool reads RSA, EC P-256, P-384, P-521, Ed25519 and X25519.`;
};

type Algorithm = { kind: 'rsa' } | { kind: 'ec'; curve: Curve } | { kind: 'okp'; curve: 'Ed25519' | 'X25519' };

/** AlgorithmIdentifier of a key (RFC 5280 §4.1.1.2; RFC 3279, RFC 5480 §2.1.1, RFC 8410 §3). */
const readAlgorithm = (der: Uint8Array, tlv: Tlv): Algorithm => {
  const items = kids(der, tlv);
  if (!items[0]) throw new KeyError(`Byte ${tlv.start}: the algorithm identifier is empty.`);
  const oid = get(readOid(der, items[0]));
  const params = items[1];
  if (items.length > 2) throw new KeyError(`Byte ${tlv.start}: the algorithm identifier has more than two elements.`);
  if (oid === OID.rsaEncryption) {
    if (params && !(isUniversal(params, UNIVERSAL.NULL) && params.length === 0))
      throw new KeyError(`Byte ${params.start}: RSA's algorithm parameters must be NULL.`);
    return { kind: 'rsa' };
  }
  if (oid === OID.ecPublicKey) {
    if (!params) throw new KeyError(`Byte ${tlv.start}: the EC key does not name its curve.`);
    if (isUniversal(params, UNIVERSAL.SEQUENCE))
      throw new KeyError(
        'This EC key spells out its curve instead of naming it; only named curves are read (RFC 5480 §2.1.1).',
      );
    if (!isUniversal(params, UNIVERSAL.OBJECT_IDENTIFIER))
      throw new KeyError(`Byte ${params.start}: the EC key's parameters are not a named curve (RFC 5480 §2.1.1).`);
    const curveOid = get(readOid(der, params));
    const curve = curveOfOid(curveOid);
    if (!curve)
      throw new KeyError(
        `The curve ${OTHER_CURVES[curveOid] ?? curveOid} is not supported: Web Crypto has P-256, P-384 and P-521.`,
      );
    return { kind: 'ec', curve };
  }
  if (oid === OID.ed25519 || oid === OID.x25519) {
    if (params)
      throw new KeyError(
        `Byte ${params.start}: ${oid === OID.ed25519 ? 'Ed25519' : 'X25519'} takes no algorithm parameters (RFC 8410 §3).`,
      );
    return { kind: 'okp', curve: oid === OID.ed25519 ? 'Ed25519' : 'X25519' };
  }
  throw new KeyError(unsupportedAlgorithm(oid));
};

const unsignedInt = (der: Uint8Array, tlv: Tlv, name: string): Uint8Array => {
  const value = get(readInteger(der, tlv));
  if (value < 0n) throw new KeyError(`Byte ${tlv.start}: the RSA key's ${name} is negative.`);
  return stripZeros(contentOf(der, tlv));
};

/** RSAPublicKey (RFC 8017 A.1.1). */
export const readPkcs1Public = (der: Uint8Array, tlv: Tlv): Extract<KeyData, { type: 'rsa' }> => {
  const items = kids(der, tlv);
  if (items.length !== 2) throw new KeyError(`Byte ${tlv.start}: an RSA public key is two integers, n and e.`);
  return { type: 'rsa', n: unsignedInt(der, items[0]!, 'n'), e: unsignedInt(der, items[1]!, 'e') };
};

/** RSAPrivateKey (RFC 8017 A.1.2), two primes only. */
export const readPkcs1Private = (der: Uint8Array, tlv: Tlv): Extract<KeyData, { type: 'rsa' }> => {
  const items = kids(der, tlv);
  const version = isInt(items[0]) ? get(readInteger(der, items[0])) : -1n;
  if (version === 1n || items.length > 9)
    throw new KeyError('Multi-prime RSA keys (more than two primes) are not supported.');
  if (version !== 0n || items.length !== 9 || !items.every(isInt))
    throw new KeyError(`Byte ${tlv.start}: an RSA private key is version 0 and eight integers (RFC 8017 A.1.2).`);
  const [n, e, d, p, q, dp, dq, qi] = (['n', 'e', 'd', 'p', 'q', 'dp', 'dq', 'qi'] as const).map((name, i) =>
    unsignedInt(der, items[i + 1]!, name),
  ) as [Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array, Uint8Array];
  return { type: 'rsa', n, e, priv: { d, p, q, dp, dq, qi } };
};

/** A curve point: uncompressed `04‖x‖y` of the curve's size (compressed points are refused by name). */
export const readPoint = (bytes: Uint8Array, curve: Curve): { x: Uint8Array; y: Uint8Array } => {
  const size = FIELD_BYTES[curve];
  if (bytes.length === size + 1 && (bytes[0] === 2 || bytes[0] === 3))
    throw new KeyError("The key's point is compressed; only uncompressed points (04…) are read.");
  if (bytes.length !== 2 * size + 1 || bytes[0] !== 4)
    throw new KeyError(`The public point is not an uncompressed ${curve} point (${bytes.length} bytes).`);
  return { x: bytes.slice(1, 1 + size), y: bytes.slice(1 + size) };
};

const bitBytes = (der: Uint8Array, tlv: Tlv): Uint8Array => {
  const bits = get(readBitString(der, tlv));
  if (bits.unusedBits !== 0) throw new KeyError(`Byte ${tlv.start}: the key's BIT STRING has unused bits.`);
  return bits.bytes;
};

/** SubjectPublicKeyInfo. */
export const readSpki = (der: Uint8Array, tlv: Tlv): KeyData => {
  const [alg, key] = kids(der, tlv);
  const algorithm = readAlgorithm(der, alg!);
  const bytes = bitBytes(der, key!);
  if (algorithm.kind === 'rsa') {
    const inner = parseDer(bytes);
    if (!inner.ok) throw new KeyError(`The RSA key inside the SPKI cannot be read: ${derMessage(inner.error)}`);
    if (inner.trailing > 0) throw new KeyError('The RSA key inside the SPKI has bytes after it.');
    return readPkcs1Public(bytes, inner.root);
  }
  if (algorithm.kind === 'ec') return { type: 'ec', curve: algorithm.curve, ...readPoint(bytes, algorithm.curve) };
  if (bytes.length !== 32)
    throw new KeyError(`The ${algorithm.curve} public key is ${bytes.length} bytes; ${algorithm.curve} needs 32.`);
  return { type: 'okp', curve: algorithm.curve, x: bytes.slice() };
};

/** ECPrivateKey (RFC 5915 §3) of a known curve or of the curve its `[0]` names; `[1]` is the stored public point. */
export const readSec1 = (
  der: Uint8Array,
  tlv: Tlv,
  outerCurve?: Curve,
): { data: Extract<KeyData, { type: 'ec' }>; storedPublic?: Uint8Array } => {
  const items = kids(der, tlv);
  const version = isInt(items[0]) ? get(readInteger(der, items[0])) : -1n;
  if (version !== 1n) throw new KeyError(`Byte ${tlv.start}: an EC private key is version 1 (RFC 5915 §3).`);
  const scalar = get(readOctetString(der, items[1]!));
  let curve = outerCurve;
  let storedPublic: Uint8Array | undefined;
  for (const item of items.slice(2)) {
    if (isContext(item, 0)) {
      const inner = kids(der, item);
      if (inner.length !== 1) throw new KeyError(`Byte ${item.start}: the EC key's [0] must hold one element.`);
      const p = inner[0]!;
      if (isUniversal(p, UNIVERSAL.SEQUENCE))
        throw new KeyError(
          'This EC key spells out its curve instead of naming it; only named curves are read (RFC 5480 §2.1.1).',
        );
      const named = get(readOid(der, p));
      const c = curveOfOid(named);
      if (!c)
        throw new KeyError(
          `The curve ${OTHER_CURVES[named] ?? named} is not supported: Web Crypto has P-256, P-384 and P-521.`,
        );
      if (outerCurve && c !== outerCurve) throw new KeyError(`The EC key names ${c} inside and ${outerCurve} outside.`);
      curve = c;
    } else if (isContext(item, 1)) {
      const inner = kids(der, item);
      if (inner.length !== 1 || !isUniversal(inner[0]!, UNIVERSAL.BIT_STRING))
        throw new KeyError(`Byte ${item.start}: the EC key's [1] must hold the public point as a BIT STRING.`);
      storedPublic = bitBytes(der, inner[0]!);
    } else throw new KeyError(`Byte ${item.start}: unexpected element in the EC private key.`);
  }
  if (!curve) throw new KeyError('The EC PRIVATE KEY does not name its curve.');
  const size = FIELD_BYTES[curve];
  if (scalar.length !== size)
    throw new KeyError(`The EC private key is ${scalar.length} bytes; ${curve} needs ${size} (RFC 5915 §3).`);
  const data: Extract<KeyData, { type: 'ec' }> = { type: 'ec', curve, d: scalar.slice() };
  if (storedPublic) Object.assign(data, readPoint(storedPublic, curve));
  return { data, ...(storedPublic ? { storedPublic } : {}) };
};

/** PrivateKeyInfo / OneAsymmetricKey (RFC 5208, RFC 5958): version 0 or 1, attributes [0] skipped, public key [1]. */
export const readPkcs8 = (der: Uint8Array, tlv: Tlv): { data: KeyData; storedPublic?: Uint8Array; notes: string[] } => {
  const items = kids(der, tlv);
  const version = get(readInteger(der, items[0]!));
  if (version !== 0n && version !== 1n)
    throw new KeyError(`Byte ${items[0]!.start}: a PKCS#8 key is version 0 or 1 (RFC 5958 §2).`);
  const algorithm = readAlgorithm(der, items[1]!);
  const keyBytes = get(readOctetString(der, items[2]!));
  const notes: string[] = [];
  let publicItem: Tlv | undefined;
  for (const item of items.slice(3)) {
    if (isContext(item, 0)) notes.push("The key's attributes were skipped.");
    else if (isContext(item, 1)) {
      if (version !== 1n)
        throw new KeyError(`Byte ${item.start}: a version 0 PKCS#8 key cannot carry a public key (RFC 5958 §2).`);
      publicItem = item;
    } else throw new KeyError(`Byte ${item.start}: unexpected element in the PKCS#8 key.`);
  }
  // Read after the private key, whose refusals say more.
  const readPublic = (): Uint8Array | undefined => {
    if (!publicItem) return undefined;
    if (publicItem.constructed)
      throw new KeyError(
        `Byte ${publicItem.start}: the public key [1] must be an implicitly tagged BIT STRING (RFC 5958 §2).`,
      );
    const bits = get(readBitString(der, publicItem, true));
    if (bits.unusedBits !== 0)
      throw new KeyError(`Byte ${publicItem.start}: the public key's BIT STRING has unused bits.`);
    return bits.bytes.slice();
  };
  const inner = parseDer(keyBytes);
  if (!inner.ok) throw new KeyError(`The key inside the PKCS#8 cannot be read: ${derMessage(inner.error)}`);
  if (inner.trailing > 0) throw new KeyError('The key inside the PKCS#8 has bytes after it.');
  if (algorithm.kind === 'rsa') {
    if (publicItem) notes.push('The public key stored in the PKCS#8 was ignored; RSA keys hold it themselves.');
    return { data: readPkcs1Private(keyBytes, inner.root), notes };
  }
  if (algorithm.kind === 'ec') {
    const sec1 = readSec1(keyBytes, inner.root, algorithm.curve);
    readPublic();
    return { data: sec1.data, notes, ...(sec1.storedPublic ? { storedPublic: sec1.storedPublic } : {}) };
  }
  // RFC 8410 §7: CurvePrivateKey ::= OCTET STRING, 32 bytes.
  const seed = get(readOctetString(keyBytes, inner.root));
  if (seed.length !== 32)
    throw new KeyError(`The ${algorithm.curve} private key is ${seed.length} bytes; ${algorithm.curve} needs 32.`);
  const data: KeyData = { type: 'okp', curve: algorithm.curve, d: seed.slice() };
  const storedPublic = readPublic();
  if (storedPublic) {
    if (storedPublic.length !== 32)
      throw new KeyError(
        `The ${algorithm.curve} public key is ${storedPublic.length} bytes; ${algorithm.curve} needs 32.`,
      );
    data.x = storedPublic;
  }
  return { data, notes, ...(storedPublic ? { storedPublic } : {}) };
};

/** EncryptedPrivateKeyInfo (RFC 5958 §3): only its encryption algorithm is named. */
export const encryptionOf = (der: Uint8Array, root: Tlv): string => {
  try {
    const [alg] = kids(der, root);
    const oid = get(readOid(der, kids(der, alg!)[0]!));
    return oid === OID.pbes2 ? 'PBES2' : oid;
  } catch {
    return 'unknown scheme';
  }
};
