/**
 * A strict reader of DER (ITU-T X.690 §8, §10), shared by the tools that read keys and certificates
 * (docs/tools/specs/x509.md §5.2, §9; jwt.md §5.4). Pure code: no DOM, no library.
 *
 * Strict means DER, not BER: definite lengths only, lengths and tag numbers in their shortest form, no end-of-contents
 * marker, no constructed strings, INTEGER in its shortest form, BOOLEAN 0x00 / 0xFF, NULL empty, a BIT STRING's unused
 * bits zero. Every refusal is a `DerError` with the byte offset (from 0) of the element it is about and a sentence a
 * tool can put after "Byte N: ". Nothing here throws on any input.
 *
 * Two levels:
 *   readTlv / children    one element's header, the elements inside a constructed one — no recursion; a caller walks
 *                         the structure it expects
 *   parseDer              the whole tree at once, iteratively (an explicit stack, depth-limited), with the content of
 *                         every primitive universal element that DER constrains checked — linear in the input
 * and the readers of the universal types a certificate uses: INTEGER (any size, exact), BIT STRING, OCTET STRING, NULL,
 * BOOLEAN, OBJECT IDENTIFIER, the string types (each decoded by its own rule), UTCTime and GeneralizedTime (RFC 5280
 * §4.1.2.5), and `explicit` for an explicitly tagged element. An implicitly tagged element is read by the reader of the
 * type it stands for, with `implicit` set.
 *
 * Not checked, because it depends on the schema and real certificates break it: the order of the elements of a SET OF
 * (X.690 §11.6) and DEFAULT values written out (§11.5).
 */
import { daysFromCivil } from './time';

export type TagClass = 'universal' | 'application' | 'context' | 'private';

/** One element: where it is and what its identifier says. `tag` is the tag number (0x30 SEQUENCE has tag 16). */
export interface Tlv {
  tag: number;
  cls: TagClass;
  constructed: boolean;
  /** The offset of the identifier octet. */
  start: number;
  /** The number of bytes of the identifier and the length. */
  header: number;
  /** The content's length. */
  length: number;
  /** Where the content starts: `start + header`. */
  body: number;
  /** Where the next element starts: `body + length`. */
  end: number;
}

export type DerErrorCode =
  | 'truncated' // the data ends inside the element
  | 'overrun' // the element ends past the end of the element that contains it
  | 'indefinite-length'
  | 'non-minimal-length'
  | 'length-too-large'
  | 'reserved-length'
  | 'non-minimal-tag'
  | 'tag-too-large'
  | 'end-of-contents'
  | 'constructed-string' // a primitive-only universal type in the constructed form (BER)
  | 'primitive-sequence' // a SEQUENCE or SET in the primitive form
  | 'not-constructed'
  | 'invalid-content'
  | 'wrong-type'
  | 'too-deep'
  | 'too-large'
  | 'empty';

export interface DerError {
  /** A sentence without the place, starting in lower case: `indefinite length is BER, not DER`. */
  message: string;
  /** The offset of the element (or byte) the error is about, from 0. */
  offset: number;
  code: DerErrorCode;
}

export type DerResult<T> = { ok: true; value: T } | { ok: false; error: DerError };

/** Universal tag numbers (X.680 §8.6) of the types a certificate uses. */
export const UNIVERSAL = {
  BOOLEAN: 1,
  INTEGER: 2,
  BIT_STRING: 3,
  OCTET_STRING: 4,
  NULL: 5,
  OBJECT_IDENTIFIER: 6,
  ENUMERATED: 10,
  UTF8String: 12,
  SEQUENCE: 16,
  SET: 17,
  NumericString: 18,
  PrintableString: 19,
  TeletexString: 20,
  IA5String: 22,
  UTCTime: 23,
  GeneralizedTime: 24,
  VisibleString: 26,
  UniversalString: 28,
  BMPString: 30,
} as const;

/** The default limits of `parseDer`: nesting (a certificate needs fewer than 10 levels) and the input's size. */
export const MAX_DER_DEPTH = 32;
export const MAX_DER_BYTES = 1_048_576;

const UNIVERSAL_NAMES: Record<number, string> = {
  0: 'end-of-contents',
  1: 'BOOLEAN',
  2: 'INTEGER',
  3: 'BIT STRING',
  4: 'OCTET STRING',
  5: 'NULL',
  6: 'OBJECT IDENTIFIER',
  7: 'ObjectDescriptor',
  8: 'EXTERNAL',
  9: 'REAL',
  10: 'ENUMERATED',
  11: 'EMBEDDED PDV',
  12: 'UTF8String',
  13: 'RELATIVE-OID',
  16: 'SEQUENCE',
  17: 'SET',
  18: 'NumericString',
  19: 'PrintableString',
  20: 'TeletexString',
  21: 'VideotexString',
  22: 'IA5String',
  23: 'UTCTime',
  24: 'GeneralizedTime',
  25: 'GraphicString',
  26: 'VisibleString',
  27: 'GeneralString',
  28: 'UniversalString',
  29: 'CHARACTER STRING',
  30: 'BMPString',
};
/** Universal types that DER writes constructed (X.690 §10.2: the others, strings included, are primitive). */
const CONSTRUCTED_ONLY = new Set([8, 11, 16, 17, 29]);
const CLASSES: readonly TagClass[] = ['universal', 'application', 'context', 'private'];

/** How a person reads a tag: `INTEGER`, `[3]`, `[APPLICATION 1]`, `[PRIVATE 0]`. */
export const describeTag = (tlv: Pick<Tlv, 'cls' | 'tag'>): string =>
  tlv.cls === 'universal'
    ? (UNIVERSAL_NAMES[tlv.tag] ?? `universal tag ${tlv.tag}`)
    : tlv.cls === 'context'
      ? `[${tlv.tag}]`
      : `[${tlv.cls.toUpperCase()} ${tlv.tag}]`;

const fail = <T>(code: DerErrorCode, offset: number, message: string): DerResult<T> & { ok: false } => ({
  ok: false,
  error: { code, offset, message },
});

/** The content bytes of an element (a view, not a copy). */
export const contentOf = (der: Uint8Array, tlv: Tlv): Uint8Array => der.subarray(tlv.body, tlv.end);

/**
 * The element at `offset`, which must end at or before `limit` (default: the end of `der`; a parent's `end` when
 * reading inside it). Errors are placed at `offset`.
 */
export const readTlv = (
  der: Uint8Array,
  offset: number,
  limit: number = der.length,
): { ok: true; tlv: Tlv } | { ok: false; error: DerError } => {
  const short = limit < der.length ? 'overrun' : 'truncated';
  const cutOff = () =>
    fail(
      short,
      offset,
      short === 'overrun'
        ? 'the element runs past the end of the element that contains it'
        : 'the data ends inside the element’s header',
    );
  if (offset < 0 || offset >= limit) return cutOff();
  const id = der[offset]!;
  const cls = CLASSES[id >> 6]!;
  const constructed = (id & 0x20) !== 0;
  let tag = id & 0x1f;
  let p = offset + 1;
  if (tag === 0x1f) {
    // High tag number (X.690 §8.1.2.4): base 128, at most 4 bytes here (2^28 − 1), no leading 0x80.
    tag = 0;
    for (let count = 0; ; count++) {
      if (p >= limit) return cutOff();
      const b = der[p++]!;
      if (count === 0 && b === 0x80)
        return fail('non-minimal-tag', offset, 'the tag number is not in its shortest form');
      if (count === 4) return fail('tag-too-large', offset, 'the tag number is too large');
      tag = tag * 128 + (b & 0x7f);
      if ((b & 0x80) === 0) break;
    }
    if (tag < 31) return fail('non-minimal-tag', offset, 'the tag number is not in its shortest form');
  }
  if (p >= limit) return cutOff();
  const first = der[p++]!;
  let length = first;
  if (first === 0x80) return fail('indefinite-length', offset, 'indefinite length is BER, not DER');
  if (first === 0xff) return fail('reserved-length', offset, 'the length byte 0xFF is reserved');
  if (first > 0x80) {
    const count = first & 0x7f;
    if (count > 4) return fail('length-too-large', offset, `the declared length takes ${count} bytes (at most 4)`);
    if (p + count > limit) return cutOff();
    if (der[p] === 0)
      return fail('non-minimal-length', offset, 'the length is not in its shortest form (BER, not DER)');
    length = 0;
    for (let i = 0; i < count; i++) length = length * 256 + der[p + i]!;
    p += count;
    if (length < 0x80)
      return fail('non-minimal-length', offset, 'the length is not in its shortest form (BER, not DER)');
  }
  if (cls === 'universal' && tag === 0)
    return fail('end-of-contents', offset, 'an end-of-contents marker belongs to BER indefinite lengths, not DER');
  const end = p + length;
  if (end > limit)
    return fail(
      short,
      offset,
      short === 'overrun'
        ? 'the element runs past the end of the element that contains it'
        : 'the element is longer than the data left',
    );
  return { ok: true, tlv: { tag, cls, constructed, start: offset, header: p - offset, length, body: p, end } };
};

/** The elements inside a constructed element; they must fill it exactly. */
export const children = (der: Uint8Array, parent: Tlv): { ok: true; items: Tlv[] } | { ok: false; error: DerError } => {
  if (!parent.constructed)
    return fail(
      'not-constructed',
      parent.start,
      `expected a constructed element, found a primitive ${describeTag(parent)}`,
    );
  const items: Tlv[] = [];
  for (let at = parent.body; at < parent.end;) {
    const read = readTlv(der, at, parent.end);
    if (!read.ok) return read;
    items.push(read.tlv);
    at = read.tlv.end;
  }
  return { ok: true, items };
};

/** Is it this universal type? */
export const isUniversal = (tlv: Tlv, tag: number): boolean => tlv.cls === 'universal' && tlv.tag === tag;
/** Is it this context-specific tag (`[n]`)? */
export const isContext = (tlv: Tlv, tag: number): boolean => tlv.cls === 'context' && tlv.tag === tag;

const expect = (tlv: Tlv, tag: number, implicit: boolean, constructed = false): DerError | null => {
  const right = implicit ? tlv.cls !== 'universal' : isUniversal(tlv, tag);
  if (!right)
    return {
      code: 'wrong-type',
      offset: tlv.start,
      message: `expected ${UNIVERSAL_NAMES[tag]}, found ${describeTag(tlv)}`,
    };
  if (tlv.constructed !== constructed)
    return constructed
      ? { code: 'primitive-sequence', offset: tlv.start, message: `a ${UNIVERSAL_NAMES[tag]} must be constructed` }
      : {
          code: 'constructed-string',
          offset: tlv.start,
          message: `a constructed ${UNIVERSAL_NAMES[tag]} is BER, not DER`,
        };
  return null;
};

/** The one element inside an explicitly tagged one (`[0] EXPLICIT …`). */
export const explicit = (der: Uint8Array, tlv: Tlv): DerResult<Tlv> => {
  const inner = children(der, tlv);
  if (!inner.ok) return inner;
  if (inner.items.length !== 1)
    return fail('invalid-content', tlv.start, `an explicit ${describeTag(tlv)} must hold exactly one element`);
  return { ok: true, value: inner.items[0]! };
};

/** The contents rules DER puts on primitive universal types, without building a value. */
const checkContent = (der: Uint8Array, tlv: Tlv): DerError | null => {
  const at = tlv.start;
  const n = tlv.length;
  const b0 = der[tlv.body];
  const b1 = der[tlv.body + 1];
  switch (tlv.tag) {
    case UNIVERSAL.BOOLEAN:
      return n === 1 && (b0 === 0 || b0 === 0xff)
        ? null
        : { code: 'invalid-content', offset: at, message: 'a BOOLEAN must be one byte, 0x00 or 0xFF' };
    case UNIVERSAL.INTEGER:
    case UNIVERSAL.ENUMERATED: {
      const name = UNIVERSAL_NAMES[tlv.tag];
      if (n === 0) return { code: 'invalid-content', offset: at, message: `an ${name} has no content bytes` };
      if (n > 1 && ((b0 === 0 && b1! < 0x80) || (b0 === 0xff && b1! >= 0x80)))
        return {
          code: 'invalid-content',
          offset: at,
          message: `an ${name} is not in its shortest form (BER, not DER)`,
        };
      return null;
    }
    case UNIVERSAL.NULL:
      return n === 0 ? null : { code: 'invalid-content', offset: at, message: 'a NULL must be empty' };
    case UNIVERSAL.BIT_STRING:
      return bitStringProblem(der, tlv);
    case UNIVERSAL.OBJECT_IDENTIFIER: {
      const oid = decodeOid(der, tlv);
      return oid.ok ? null : oid.error;
    }
    default:
      return null;
  }
};

/**
 * The whole tree at `der` checked as DER: one element filling the data (bytes after it are counted, not read), every
 * element's header, the constructed and primitive forms, the contents rules of BOOLEAN, INTEGER, ENUMERATED, NULL,
 * BIT STRING and OBJECT IDENTIFIER, nesting up to `maxDepth` levels (the outermost element is level 1) and `maxBytes`
 * of data. Iterative: an explicit stack, no recursion; every byte is looked at a bounded number of times.
 */
export const parseDer = (
  der: Uint8Array,
  options: { maxDepth?: number; maxBytes?: number } = {},
): { ok: true; root: Tlv; trailing: number } | { ok: false; error: DerError } => {
  const { maxDepth = MAX_DER_DEPTH, maxBytes = MAX_DER_BYTES } = options;
  if (der.length === 0) return fail('empty', 0, 'there are no bytes to read');
  if (der.length > maxBytes) return fail('too-large', 0, `the data is larger than ${maxBytes} bytes`);
  const first = readTlv(der, 0);
  if (!first.ok) return first;
  const root = first.tlv;
  const ends: number[] = [];
  let tlv = root;
  for (;;) {
    const depth = ends.length + 1;
    if (tlv.cls === 'universal') {
      if (CONSTRUCTED_ONLY.has(tlv.tag)) {
        if (!tlv.constructed)
          return fail('primitive-sequence', tlv.start, `a ${UNIVERSAL_NAMES[tlv.tag]} must be constructed`);
      } else if (tlv.constructed) {
        return fail('constructed-string', tlv.start, `a constructed ${describeTag(tlv)} is BER, not DER`);
      } else {
        const problem = checkContent(der, tlv);
        if (problem) return { ok: false, error: problem };
      }
    }
    let next: number;
    if (tlv.constructed && tlv.length > 0) {
      if (depth >= maxDepth) return fail('too-deep', tlv.body, `elements are nested deeper than ${maxDepth} levels`);
      ends.push(tlv.end);
      next = tlv.body;
    } else next = tlv.end;
    while (ends.length > 0 && next === ends[ends.length - 1]) ends.pop();
    if (ends.length === 0) break;
    const read = readTlv(der, next, ends[ends.length - 1]);
    if (!read.ok) return read;
    tlv = read.tlv;
  }
  return { ok: true, root, trailing: der.length - root.end };
};

/** INTEGER — signed, two's complement, of any size, exact (`implicit`: an implicitly tagged INTEGER). */
export const readInteger = (der: Uint8Array, tlv: Tlv, implicit = false): DerResult<bigint> => {
  const wrong = expect(tlv, UNIVERSAL.INTEGER, implicit);
  if (wrong) return { ok: false, error: wrong };
  const problem = checkContent(der, { ...tlv, tag: UNIVERSAL.INTEGER });
  if (problem) return { ok: false, error: problem };
  const bytes = contentOf(der, tlv);
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i++) parts.push(HEX[bytes[i]!]!);
  let value = BigInt(`0x${parts.join('')}`);
  if (bytes[0]! >= 0x80) value -= 1n << BigInt(bytes.length * 8);
  return { ok: true, value };
};

const HEX = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));

/** BOOLEAN: one byte, 0x00 or 0xFF. */
export const readBoolean = (der: Uint8Array, tlv: Tlv, implicit = false): DerResult<boolean> => {
  const wrong = expect(tlv, UNIVERSAL.BOOLEAN, implicit);
  if (wrong) return { ok: false, error: wrong };
  const problem = checkContent(der, { ...tlv, tag: UNIVERSAL.BOOLEAN });
  return problem ? { ok: false, error: problem } : { ok: true, value: der[tlv.body] === 0xff };
};

/** NULL: no content. */
export const readNull = (_der: Uint8Array, tlv: Tlv, implicit = false): DerResult<null> => {
  const wrong = expect(tlv, UNIVERSAL.NULL, implicit);
  if (wrong) return { ok: false, error: wrong };
  return tlv.length === 0 ? { ok: true, value: null } : fail('invalid-content', tlv.start, 'a NULL must be empty');
};

const bitStringProblem = (der: Uint8Array, tlv: Tlv): DerError | null => {
  const at = tlv.start;
  if (tlv.length === 0)
    return { code: 'invalid-content', offset: at, message: 'a BIT STRING needs its byte of unused bits' };
  const unused = der[tlv.body]!;
  if (unused > 7)
    return { code: 'invalid-content', offset: at, message: `a BIT STRING declares ${unused} unused bits (at most 7)` };
  if (tlv.length === 1 && unused !== 0)
    return { code: 'invalid-content', offset: at, message: 'an empty BIT STRING cannot have unused bits' };
  if (unused > 0 && (der[tlv.end - 1]! & ((1 << unused) - 1)) !== 0)
    return {
      code: 'invalid-content',
      offset: at,
      message: 'the unused bits of a BIT STRING are not zero (BER, not DER)',
    };
  return null;
};

/** BIT STRING: the number of unused bits in the last byte (0–7) and the bytes. */
export const readBitString = (
  der: Uint8Array,
  tlv: Tlv,
  implicit = false,
): DerResult<{ unusedBits: number; bytes: Uint8Array }> => {
  const wrong = expect(tlv, UNIVERSAL.BIT_STRING, implicit);
  if (wrong) return { ok: false, error: wrong };
  const problem = bitStringProblem(der, tlv);
  if (problem) return { ok: false, error: problem };
  return { ok: true, value: { unusedBits: der[tlv.body]!, bytes: der.subarray(tlv.body + 1, tlv.end) } };
};

/** OCTET STRING: its bytes (a view). */
export const readOctetString = (der: Uint8Array, tlv: Tlv, implicit = false): DerResult<Uint8Array> => {
  const wrong = expect(tlv, UNIVERSAL.OCTET_STRING, implicit);
  return wrong ? { ok: false, error: wrong } : { ok: true, value: contentOf(der, tlv) };
};

/** One arc is at most this many bytes (2.25.<UUID> needs 19). Longer would make the decoding quadratic. */
const MAX_ARC_BYTES = 20;

const decodeOid = (der: Uint8Array, tlv: Tlv): DerResult<string> => {
  const at = tlv.start;
  if (tlv.length === 0) return fail('invalid-content', at, 'an OBJECT IDENTIFIER has no content bytes');
  if (der[tlv.end - 1]! & 0x80) return fail('invalid-content', at, 'the OBJECT IDENTIFIER’s last arc is cut off');
  const arcs: string[] = [];
  for (let i = tlv.body; i < tlv.end;) {
    if (der[i] === 0x80)
      return fail('invalid-content', at, 'an arc of the OBJECT IDENTIFIER is not in its shortest form');
    let j = i;
    while (der[j]! & 0x80) j++;
    const count = j - i + 1;
    if (count > MAX_ARC_BYTES)
      return fail('invalid-content', at, `an arc of the OBJECT IDENTIFIER is longer than ${MAX_ARC_BYTES} bytes`);
    let value: number | bigint;
    if (count <= 7) {
      let v = 0;
      for (let k = i; k <= j; k++) v = v * 128 + (der[k]! & 0x7f);
      value = v;
    } else {
      let v = 0n;
      for (let k = i; k <= j; k++) v = v * 128n + BigInt(der[k]! & 0x7f);
      value = v;
    }
    if (arcs.length === 0) {
      // The first sub-identifier holds two arcs (X.690 §8.19.4): 40·X + Y, X ∈ {0, 1, 2}.
      if (typeof value === 'number') {
        const x = value < 40 ? 0 : value < 80 ? 1 : 2;
        arcs.push(String(x), String(value - 40 * x));
      } else arcs.push('2', String(value - 80n));
    } else arcs.push(String(value));
    i = j + 1;
  }
  return { ok: true, value: arcs.join('.') };
};

/** OBJECT IDENTIFIER in dotted notation (X.690 §8.19); arcs of any size up to 20 bytes, exact. */
export const readOid = (der: Uint8Array, tlv: Tlv, implicit = false): DerResult<string> => {
  const wrong = expect(tlv, UNIVERSAL.OBJECT_IDENTIFIER, implicit);
  return wrong ? { ok: false, error: wrong } : decodeOid(der, tlv);
};

export type StringType =
  | 'UTF8String'
  | 'PrintableString'
  | 'IA5String'
  | 'VisibleString'
  | 'NumericString'
  | 'TeletexString'
  | 'BMPString'
  | 'UniversalString';

const STRING_TAGS: Record<number, StringType> = {
  12: 'UTF8String',
  18: 'NumericString',
  19: 'PrintableString',
  20: 'TeletexString',
  22: 'IA5String',
  26: 'VisibleString',
  28: 'UniversalString',
  30: 'BMPString',
};

/** Is it a universal string type `readString` decodes? */
export const isStringType = (tlv: Tlv): boolean => tlv.cls === 'universal' && tlv.tag in STRING_TAGS;

export interface DerString {
  text: string;
  type: StringType;
  /** Set when the bytes break the type's rule; the text then has U+FFFD (or the character as it is) there. */
  malformed?: string;
}

const PRINTABLE = /^[A-Za-z0-9 '()+,\-./:=?]*$/;
const CHUNK = 4096;

/** Code points to a string, in chunks (no spread of a huge array, no quadratic concatenation). */
const fromCodePoints = (points: number[]): string => {
  const parts: string[] = [];
  for (let i = 0; i < points.length; i += CHUNK) parts.push(String.fromCodePoint(...points.slice(i, i + CHUNK)));
  return parts.join('');
};

/** Bytes each standing for one code point; bytes above `max` become U+FFFD. */
const singleBytes = (bytes: Uint8Array, max: number): { text: string; bad: boolean } => {
  const points: number[] = new Array(bytes.length);
  let bad = false;
  for (let i = 0; i < bytes.length; i++) {
    const b = bytes[i]!;
    if (b > max) bad = true;
    points[i] = b > max ? 0xfffd : b;
  }
  return { text: fromCodePoints(points), bad };
};

/**
 * A string type by its own rule (RFC 5280 §4.1.2.4, X.680 §41): UTF8String — UTF-8, bad bytes become U+FFFD;
 * PrintableString, IA5String, VisibleString, NumericString — ASCII, each checked against its alphabet (a character
 * outside it is kept and noted; a byte above 0x7F becomes U+FFFD); TeletexString — read as Latin-1, which is what it
 * holds in practice; BMPString — UTF-16BE (an odd length is an error); UniversalString — UTF-32BE (a length that is not
 * a multiple of 4 is an error; a value that is not a code point becomes U+FFFD). `as` reads an implicitly tagged
 * element as that type.
 */
export const readString = (der: Uint8Array, tlv: Tlv, as?: StringType): DerResult<DerString> => {
  const type = as ?? (tlv.cls === 'universal' ? STRING_TAGS[tlv.tag] : undefined);
  if (!type) return fail('wrong-type', tlv.start, `expected a string, found ${describeTag(tlv)}`);
  if (tlv.constructed) return fail('constructed-string', tlv.start, `a constructed ${type} is BER, not DER`);
  const bytes = contentOf(der, tlv);
  switch (type) {
    case 'UTF8String': {
      const text = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes);
      let valid = true;
      try {
        new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
      } catch {
        valid = false;
      }
      return { ok: true, value: valid ? { text, type } : { text, type, malformed: 'bytes that are not UTF-8' } };
    }
    case 'TeletexString':
      return { ok: true, value: { text: singleBytes(bytes, 0xff).text, type } };
    case 'BMPString': {
      if (bytes.length % 2 !== 0) return fail('invalid-content', tlv.start, 'a BMPString has an odd number of bytes');
      // UTF-16BE: a surrogate pair is one code point; a lone surrogate becomes U+FFFD.
      const points: number[] = [];
      let bad = false;
      for (let i = 0; i < bytes.length; i += 2) {
        const unit = (bytes[i]! << 8) | bytes[i + 1]!;
        const next = i + 3 < bytes.length ? (bytes[i + 2]! << 8) | bytes[i + 3]! : -1;
        if (unit >= 0xd800 && unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
          points.push(0x10000 + ((unit - 0xd800) << 10) + (next - 0xdc00));
          i += 2;
        } else if (unit >= 0xd800 && unit <= 0xdfff) {
          bad = true;
          points.push(0xfffd);
        } else points.push(unit);
      }
      const text = fromCodePoints(points);
      return { ok: true, value: bad ? { text, type, malformed: 'lone surrogates' } : { text, type } };
    }
    case 'UniversalString': {
      if (bytes.length % 4 !== 0)
        return fail('invalid-content', tlv.start, 'a UniversalString’s length is not a multiple of 4 bytes');
      const points: number[] = new Array(bytes.length / 4);
      let bad = false;
      for (let i = 0; i < bytes.length; i += 4) {
        const cp = bytes[i]! * 0x1000000 + (bytes[i + 1]! << 16) + (bytes[i + 2]! << 8) + bytes[i + 3]!;
        const ok = cp <= 0x10ffff && (cp < 0xd800 || cp > 0xdfff);
        if (!ok) bad = true;
        points[i / 4] = ok ? cp : 0xfffd;
      }
      const text = fromCodePoints(points);
      return { ok: true, value: bad ? { text, type, malformed: 'values that are not code points' } : { text, type } };
    }
    default: {
      const { text, bad } = singleBytes(bytes, type === 'VisibleString' ? 0x7e : 0x7f);
      const alphabet =
        type === 'PrintableString'
          ? PRINTABLE.test(text)
          : type === 'NumericString'
            ? /^[0-9 ]*$/.test(text)
            : type === 'VisibleString'
              ? /^[\x20-\x7e]*$/.test(text)
              : true;
      return {
        ok: true,
        value:
          bad || !alphabet
            ? { text, type, malformed: bad ? 'bytes outside ASCII' : `characters outside the ${type} alphabet` }
            : { text, type },
      };
    }
  }
};

export interface DerTime {
  type: 'UTCTime' | 'GeneralizedTime';
  /** The characters as written. */
  raw: string;
  /** The instant, when `raw` is in RFC 5280's form; absent otherwise. */
  epochMs?: number;
  /** Why it is not RFC 5280's form. */
  problem?: string;
}

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;

/**
 * UTCTime or GeneralizedTime by RFC 5280 §4.1.2.5: UTCTime exactly `YYMMDDHHMMSSZ` (YY ≥ 50 is 19YY, else 20YY,
 * §4.1.2.5.1), GeneralizedTime exactly `YYYYMMDDHHMMSSZ` (no fraction, §4.1.2.5.2), a real date and time of day (no
 * leap second). Another form is not an error of DER: the text comes back with `problem` and no instant.
 */
export const readTime = (der: Uint8Array, tlv: Tlv): DerResult<DerTime> => {
  const type = isUniversal(tlv, UNIVERSAL.UTCTime)
    ? 'UTCTime'
    : isUniversal(tlv, UNIVERSAL.GeneralizedTime)
      ? 'GeneralizedTime'
      : undefined;
  if (!type) return fail('wrong-type', tlv.start, `expected UTCTime or GeneralizedTime, found ${describeTag(tlv)}`);
  if (tlv.constructed) return fail('constructed-string', tlv.start, `a constructed ${type} is BER, not DER`);
  const { text: raw, bad } = singleBytes(contentOf(der, tlv), 0x7e);
  const form = type === 'UTCTime' ? 'YYMMDDHHMMSSZ' : 'YYYYMMDDHHMMSSZ';
  const section = type === 'UTCTime' ? '§4.1.2.5.1' : '§4.1.2.5.2';
  const notForm: DerTime = { type, raw, problem: `a ${type} must be ${form} (RFC 5280 ${section})` };
  const pattern =
    type === 'UTCTime'
      ? /^(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/
      : /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})Z$/;
  const m = bad ? null : pattern.exec(raw);
  if (!m) return { ok: true, value: notForm };
  const [yy, mo, d, h, mi, s] = m.slice(1).map(Number) as [number, number, number, number, number, number];
  const year = type === 'UTCTime' ? (yy >= 50 ? 1900 + yy : 2000 + yy) : yy;
  const days = mo === 2 && isLeap(year) ? 29 : DAYS_IN_MONTH[mo - 1];
  if (days === undefined || d < 1 || d > days || h > 23 || mi > 59 || s > 59)
    return { ok: true, value: { type, raw, problem: `${raw} is not a date and time of day` } };
  return {
    ok: true,
    value: { type, raw, epochMs: daysFromCivil(year, mo, d) * 86_400_000 + (h * 3600 + mi * 60 + s) * 1000 },
  };
};
