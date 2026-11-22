/**
 * Small helpers over the shared DER reader for walking a certificate: a failure carries a `DerError` up to the one place
 * that turns it into words (certificate.ts), so the walk reads as the structure it expects. Offsets are always from the
 * start of the certificate's DER.
 */
import {
  children,
  contentOf,
  describeTag,
  isUniversal,
  parseDer,
  readTlv,
  UNIVERSAL,
} from '@workspace/tools-shared/der';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { DerError, DerErrorCode, DerResult, Tlv } from '@workspace/tools-shared/der';

/** A structure that is not what it should be: caught by parseCertificate and by each extension's decoder. */
export class Failure {
  constructor(readonly error: DerError) {}
}

export const fail = (offset: number, message: string, code: DerErrorCode = 'invalid-content'): never => {
  throw new Failure({ code, offset, message });
};

export const must = <T>(result: DerResult<T>): T => {
  if (!result.ok) throw new Failure(result.error);
  return result.value;
};

export const kids = (der: Uint8Array, tlv: Tlv): Tlv[] => {
  const read = children(der, tlv);
  if (!read.ok) throw new Failure(read.error);
  return read.items;
};

/** The elements of a SEQUENCE (or SET with `tag`), or a failure naming what was expected. */
export const sequence = (
  der: Uint8Array,
  tlv: Tlv | undefined,
  what: string,
  tag: number = UNIVERSAL.SEQUENCE,
): Tlv[] => {
  if (!tlv) return fail(der.length, `${what} is missing`);
  if (!isUniversal(tlv, tag) || !tlv.constructed)
    return fail(tlv.start, `expected ${what}, found ${describeTag(tlv)}`, 'wrong-type');
  return kids(der, tlv);
};

/** Is it there and of this universal type? */
export const isType = (tlv: Tlv | undefined, tag: number): tlv is Tlv => !!tlv && isUniversal(tlv, tag);

/**
 * DER wrapped in an OCTET STRING (an extension's value), checked strictly and as a whole: one element filling
 * [start, end). Returns that element with offsets in the certificate.
 */
export const inner = (der: Uint8Array, start: number, end: number): Tlv => {
  const checked = parseDer(der.subarray(start, end));
  if (!checked.ok) {
    const { code, offset, message } = checked.error;
    // Inside a value, "the data ends" means the value ends: the certificate is not truncated.
    throw new Failure(
      code === 'truncated'
        ? {
            code: 'overrun',
            offset: offset + start,
            message: 'the element runs past the end of the element that contains it',
          }
        : { code, offset: offset + start, message },
    );
  }
  if (checked.trailing > 0)
    fail(
      start + checked.root.end,
      `${checked.trailing} ${checked.trailing === 1 ? 'byte follows' : 'bytes follow'} the value`,
    );
  const read = readTlv(der, start, end);
  if (!read.ok) throw new Failure(read.error);
  return read.tlv;
};

/** Bytes as `AB:CD:…` (fingerprints, key identifiers, unknown values). */
export const hexColons = (bytes: Uint8Array): string => bytesToHex(bytes, { format: 'colons', uppercase: true });

/** An INTEGER's content as hexadecimal without the sign byte: `01`, `1234567890ABCDEF`; negative with `-`. */
export const integerHex = (der: Uint8Array, tlv: Tlv): string => {
  const bytes = contentOf(der, tlv);
  if (bytes.length > 0 && bytes[0]! >= 0x80) {
    // Two's complement: the magnitude is the bytes negated.
    const magnitude = new Uint8Array(bytes.length);
    let carry = 1;
    for (let i = bytes.length - 1; i >= 0; i--) {
      const v = (~bytes[i]! & 0xff) + carry;
      magnitude[i] = v & 0xff;
      carry = v >> 8;
    }
    let s = 0;
    while (s < magnitude.length - 1 && magnitude[s] === 0) s++;
    return `-${bytesToHex(magnitude.subarray(s), { uppercase: true })}`;
  }
  const start = bytes.length > 1 && bytes[0] === 0 ? 1 : 0;
  return bytesToHex(bytes.subarray(start), { uppercase: true });
};
