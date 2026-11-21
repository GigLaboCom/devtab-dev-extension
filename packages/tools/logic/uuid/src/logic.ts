/**
 * The UUID / ULID tool's logic (docs/tools/specs/uuid.md §5, §9): UUID v4, v7, v5, v3, nil and max and ULID generation,
 * the notations of a UUID, parsing of every UUID version and of ULID, and `detectUuid`. RFC 9562 (May 2024) for UUIDs,
 * github.com/ulid/spec for ULID. Pure: no React, no DOM, no chrome. Randomness comes in as a `RandomSource`
 * (@workspace/tools-shared/random), the clock as a parameter, ISO instants from @workspace/tools-shared/time.
 */
import { cryptoRandom } from '@workspace/tools-shared/random';
import { formatIsoUtc } from '@workspace/tools-shared/time';
import type { RandomSource } from '@workspace/tools-shared/random';

export type UuidFormat = 'standard' | 'no-hyphens' | 'braces' | 'urn';
export type GenerateType = 'v4' | 'v7' | 'ulid' | 'v5' | 'v3' | 'nil' | 'max';
export type NamespaceId = 'dns' | 'url' | 'oid' | 'x500';

/** RFC 9562 §6.6, Appendix A. */
export const NAMESPACES: Readonly<Record<NamespaceId, string>> = {
  dns: '6ba7b810-9dad-11d1-80b4-00c04fd430c8',
  url: '6ba7b811-9dad-11d1-80b4-00c04fd430c8',
  oid: '6ba7b812-9dad-11d1-80b4-00c04fd430c8',
  x500: '6ba7b814-9dad-11d1-80b4-00c04fd430c8',
};

/** The limits of §12: at most this many identifiers in one batch; a name for v3/v5 up to this many characters. */
export const MAX_COUNT = 1000;
export const MAX_NAME = 65_536;

export const ULID_OVERFLOW = 'ULID random part overflowed within one millisecond. Try again.';
export const CLOCK_RANGE = 'The clock is beyond what UUID v7 / ULID can store.';
export const COUNT_ERROR = 'How many must be a whole number from 1 to 1,000.';
export const NAMESPACE_ERROR = 'Namespace must be a UUID.';
export const ONE_ID = 'Paste one UUID or ULID.';

/** Thrown when a ULID's random part would pass 2^80 − 1 within one millisecond (§5.3). */
export class UlidOverflowError extends Error {
  constructor() {
    super(ULID_OVERFLOW);
    this.name = 'UlidOverflowError';
  }
}

/** Thrown when `now` does not fit the 48-bit millisecond field of UUID v7 and ULID (§5.4). */
export class ClockRangeError extends RangeError {
  constructor() {
    super(CLOCK_RANGE);
    this.name = 'ClockRangeError';
  }
}

// MARK: notations

const HEX = '0123456789abcdef';
const CROCKFORD = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
/** The largest millisecond a 48-bit field holds: 2^48 − 1 (year 10889). */
const MAX_MS = 2 ** 48 - 1;

const hex = (bytes: Uint8Array, from = 0, to = bytes.length): string => {
  let out = '';
  for (let i = from; i < to; i++) out += HEX[bytes[i]! >> 4]! + HEX[bytes[i]! & 15]!;
  return out;
};

const toBigInt = (bytes: Uint8Array, from = 0, to = bytes.length): bigint => {
  let value = 0n;
  for (let i = from; i < to; i++) value = (value << 8n) | BigInt(bytes[i]!);
  return value;
};

/** 16 bytes → text in the given notation (§5.5); `uppercase` changes the hex digits only, never `urn:uuid:`. */
export const formatUuid = (bytes: Uint8Array, format: UuidFormat, uppercase: boolean): string => {
  const plain = hex(bytes, 0, 16);
  const digits = uppercase ? plain.toUpperCase() : plain;
  if (format === 'no-hyphens') return digits;
  const standard = `${digits.slice(0, 8)}-${digits.slice(8, 12)}-${digits.slice(12, 16)}-${digits.slice(16, 20)}-${digits.slice(20)}`;
  return format === 'braces' ? `{${standard}}` : format === 'urn' ? `urn:uuid:${standard}` : standard;
};

/** 16 bytes → 26 characters of Crockford Base32, uppercase; the first character carries the top 3 bits (§5.3). */
export const encodeUlid = (bytes: Uint8Array): string => {
  let value = toBigInt(bytes, 0, 16);
  let out = '';
  for (let i = 0; i < 26; i++) {
    out = CROCKFORD[Number(value & 31n)]! + out;
    value >>= 5n;
  }
  return out;
};

const setVersion = (bytes: Uint8Array, version: number): Uint8Array => {
  bytes[6] = (bytes[6]! & 0x0f) | (version << 4);
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  return bytes;
};

// MARK: generation

/** UUID v4 (RFC 9562 §5.4): 16 bytes from the source, then the version and the variant — 122 random bits. */
export const v4 = (source: RandomSource = cryptoRandom): Uint8Array => {
  const bytes = new Uint8Array(16);
  source(bytes);
  return setVersion(bytes, 4);
};

/** Keeps lastMs / counter between calls (§5.2, §5.3); one per page. */
export interface TimeOrderedGenerator {
  v7(now: number): Uint8Array;
  ulid(now: number): Uint8Array; // throws UlidOverflowError
}

const checkClock = (ms: number): void => {
  if (!Number.isFinite(ms) || ms > MAX_MS) throw new ClockRangeError();
};

const writeMs = (bytes: Uint8Array, ms: number): void => {
  // 48 bits do not fit the 32-bit bitwise operators: the top 16 and the low 32 apart.
  const high = Math.floor(ms / 2 ** 32);
  const low = ms % 2 ** 32;
  bytes[0] = high >>> 8;
  bytes[1] = high & 0xff;
  bytes[2] = low >>> 24;
  bytes[3] = (low >>> 16) & 0xff;
  bytes[4] = (low >>> 8) & 0xff;
  bytes[5] = low & 0xff;
};

const TWO_80 = 1n << 80n;

/**
 * UUID v7 by RFC 9562 §6.2 «Method 1» (a 12-bit counter in rand_a, seeded at random with its top bit 0 — «Counter
 * Rollover Guards» — and the time moved on by 1 ms when it rolls over) and ULID by the ULID specification's
 * «Monotonicity» (the 80-bit random part plus one within a millisecond; overflow is refused). A clock that went back
 * counts as the last millisecond seen, so the order holds.
 */
export const createTimeOrderedGenerator = (source: RandomSource = cryptoRandom): TimeOrderedGenerator => {
  let v7Ms = -1;
  let counter = 0;
  let ulidMs = -1;
  let random = 0n;
  const two = new Uint8Array(2);
  const seed = (): number => {
    source(two);
    return ((two[0]! << 8) | two[1]!) & 0x07ff;
  };

  return {
    v7(now) {
      checkClock(now);
      let ms = Math.max(now, v7Ms);
      let next: number;
      if (ms > v7Ms) next = seed();
      else {
        next = counter + 1;
        if (next > 0xfff) {
          ms = v7Ms + 1;
          checkClock(ms);
          next = seed();
        }
      }
      v7Ms = ms;
      counter = next;
      const bytes = new Uint8Array(16);
      source(bytes.subarray(8));
      writeMs(bytes, ms);
      bytes[6] = 0x70 | (counter >> 8);
      bytes[7] = counter & 0xff;
      bytes[8] = (bytes[8]! & 0x3f) | 0x80;
      return bytes;
    },
    ulid(now) {
      checkClock(now);
      const ms = Math.max(now, ulidMs);
      let next: bigint;
      if (ms > ulidMs) {
        const ten = new Uint8Array(10);
        source(ten);
        next = toBigInt(ten);
      } else {
        next = random + 1n;
        if (next >= TWO_80) throw new UlidOverflowError();
      }
      ulidMs = ms;
      random = next;
      const bytes = new Uint8Array(16);
      writeMs(bytes, ms);
      for (let i = 15, r = random; i >= 6; i--, r >>= 8n) bytes[i] = Number(r & 0xffn);
      return bytes;
    },
  };
};

/** The library is loaded with the first v3: it stays out of every chunk that only lists or detects the tool. */
let md5: Promise<(data: Uint8Array) => Uint8Array> | undefined;

/**
 * Name-based UUID (RFC 9562 §5.3 v3 with MD5, §5.5 v5 with SHA-1): the hash of the namespace's 16 bytes followed by
 * the name in UTF-8, its first 16 bytes, then the version and the variant. SHA-1 is WebCrypto's, MD5 @noble/hashes'.
 */
export const nameBased = async (version: 3 | 5, namespace: Uint8Array, name: string): Promise<Uint8Array> => {
  const text = new TextEncoder().encode(name);
  const data = new Uint8Array(16 + text.length);
  data.set(namespace.subarray(0, 16));
  data.set(text, 16);
  let digest: Uint8Array;
  if (version === 5) digest = new Uint8Array(await crypto.subtle.digest('SHA-1', data));
  else {
    md5 ??= import('@noble/hashes/legacy.js').then(m => m.md5);
    digest = (await md5)(data);
  }
  return setVersion(digest.slice(0, 16), version);
};

/** The bytes of a namespace typed as a UUID in any accepted notation (§5.6), or null: "Namespace must be a UUID." */
export const namespaceBytes = (text: string): Uint8Array | null => {
  const parsed = parseId(text);
  return parsed.ok && parsed.value.kind === 'uuid' ? parsed.value.bytes : null;
};

/** "How many" as typed (§4, §6): a whole number 1–1,000, or null. */
export const parseCount = (text: string): number | null => {
  if (text.trim() === '') return null;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= MAX_COUNT ? n : null;
};

/** A batch of random or time-ordered identifiers with one `now` for the whole batch (§9). */
export const generateBatch = (
  type: 'v4' | 'v7' | 'ulid',
  count: number,
  generator: TimeOrderedGenerator,
  now: number,
  source: RandomSource = cryptoRandom,
): Uint8Array[] => {
  const out: Uint8Array[] = [];
  for (let i = 0; i < count; i++)
    out.push(type === 'v4' ? v4(source) : type === 'v7' ? generator.v7(now) : generator.ulid(now));
  return out;
};

/** Nil (RFC 9562 §5.9) and Max (§5.10). */
export const NIL = new Uint8Array(16);
export const MAX = new Uint8Array(16).fill(0xff);

// MARK: parsing

export type Variant = 'ncs' | 'rfc9562' | 'microsoft' | 'future';

export type UuidFields =
  | { type: 'gregorian'; time100ns: bigint; iso: string; clockSeq: number; node: string; multicast: boolean } // v1, v6
  | { type: 'unix'; timeMs: number; randA: string; randB: string } // v7
  | { type: 'none' }; // other versions

export type Parsed =
  | {
      kind: 'uuid';
      bytes: Uint8Array;
      special?: 'nil' | 'max';
      variant: Variant;
      version?: number;
      fields: UuidFields;
    }
  | { kind: 'ulid'; bytes: Uint8Array; timeMs: number; random: string };

export type ParseResult = { ok: true; value: Parsed } | { ok: false; message: string; position?: number };

/** Version names of RFC 9562 §4.2 (table 2). */
export const VERSION_NAMES: Readonly<Record<number, string>> = {
  1: 'Gregorian time-based',
  2: 'DCE Security',
  3: 'Name-based (MD5)',
  4: 'Random',
  5: 'Name-based (SHA-1)',
  6: 'Reordered Gregorian time-based',
  7: 'Unix time-based',
  8: 'Custom',
};
export const UNKNOWN_VERSION = 'Unknown (not defined by RFC 9562)';

/** Variant names of RFC 9562 §4.1 (table 1). */
export const VARIANT_NAMES: Readonly<Record<Variant, string>> = {
  ncs: 'NCS (reserved)',
  rfc9562: 'RFC 9562',
  microsoft: 'Microsoft (reserved)',
  future: 'Reserved for future use',
};

/** 100-ns intervals from 1582-10-15T00:00:00Z to the Unix epoch (RFC 9562 §5.1). */
export const GREGORIAN_OFFSET = 0x01b21dd213814000n;

const variantOf = (b8: number): Variant =>
  b8 >> 7 === 0 ? 'ncs' : b8 >> 6 === 2 ? 'rfc9562' : b8 >> 5 === 6 ? 'microsoft' : 'future';

/** ISO 8601 UTC of a Unix millisecond, by the shared formatter (fraction 0, 3, 6 or 9 digits). */
export const isoFromMs = (ms: number): string => formatIsoUtc(BigInt(ms) * 1_000_000n);

const gregorian = (bytes: Uint8Array, time100ns: bigint): UuidFields => ({
  type: 'gregorian',
  time100ns,
  iso: formatIsoUtc((time100ns - GREGORIAN_OFFSET) * 100n),
  clockSeq: ((bytes[8]! & 0x3f) << 8) | bytes[9]!,
  node: Array.from(bytes.subarray(10, 16), b => HEX[b >> 4]! + HEX[b & 15]!).join(':'),
  multicast: (bytes[10]! & 1) === 1,
});

/** Unix milliseconds of a v1 or v6 time (100-ns intervals since 1582), rounded down. */
export const gregorianToMs = (time100ns: bigint): number => {
  const ticks = time100ns - GREGORIAN_OFFSET;
  const ms = ticks / 10_000n;
  return Number(ticks < 0n && ms * 10_000n !== ticks ? ms - 1n : ms);
};

const describeUuid = (bytes: Uint8Array): Parsed => {
  if (bytes.every(b => b === 0))
    return { kind: 'uuid', bytes, special: 'nil', variant: 'ncs', fields: { type: 'none' } };
  if (bytes.every(b => b === 0xff))
    return { kind: 'uuid', bytes, special: 'max', variant: 'future', fields: { type: 'none' } };
  const variant = variantOf(bytes[8]!);
  if (variant !== 'rfc9562') return { kind: 'uuid', bytes, variant, fields: { type: 'none' } };
  const version = bytes[6]! >> 4;
  let fields: UuidFields = { type: 'none' };
  if (version === 1) {
    const hi = BigInt(((bytes[6]! & 0x0f) << 8) | bytes[7]!);
    fields = gregorian(bytes, (hi << 48n) | (toBigInt(bytes, 4, 6) << 32n) | toBigInt(bytes, 0, 4));
  } else if (version === 6) {
    const low = BigInt(((bytes[6]! & 0x0f) << 8) | bytes[7]!);
    fields = gregorian(bytes, (toBigInt(bytes, 0, 4) << 28n) | (toBigInt(bytes, 4, 6) << 12n) | low);
  } else if (version === 7) {
    fields = {
      type: 'unix',
      timeMs: Number(toBigInt(bytes, 0, 6)),
      randA: (((bytes[6]! & 0x0f) << 8) | bytes[7]!).toString(16).padStart(3, '0'),
      randB: (bytes[8]! & 0x3f).toString(16).padStart(2, '0') + hex(bytes, 9, 16),
    };
  }
  return { kind: 'uuid', bytes, variant, version, fields };
};

const isHex = (c: string): boolean => (c >= '0' && c <= '9') || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F');
const HYPHENS = new Set([8, 13, 18, 23]);

/** The character at `i` as shown in a message: a whole code point, so an emoji is not cut in half. */
const charAt = (s: string, i: number): string => String.fromCodePoint(s.codePointAt(i)!);

const lengthError = (n: number): ParseResult => ({
  ok: false,
  message: `Not a UUID or ULID: ${n > 100 ? 'more than 100 characters' : n === 1 ? '1 character' : `${n} characters`}; a UUID has 36 with hyphens or 32 without, a ULID has 26.`,
});

/**
 * One UUID or ULID (§5.6): edges trimmed; `urn:uuid:` (any case) or a pair of braces taken off; then 36 characters
 * with hyphens at 9, 14, 19 and 24 or 32 hex digits is a UUID, 26 Crockford characters (I, L, O, U excluded, the first
 * 0–7, any case) a ULID. A message says what is wrong and where — positions from 1, in UTF-16 units of the text as
 * given. Empty or blank text is not an error: `{ ok: false, message: '' }`.
 */
export const parseId = (text: string): ParseResult => {
  const trimmed = text.trim();
  if (trimmed === '') return { ok: false, message: '' };
  if (/[\r\n]/.test(trimmed)) return { ok: false, message: ONE_ID };
  let body = trimmed;
  let at = text.length - text.trimStart().length + 1; // position (from 1) of body[0] in the text as given
  if (body.slice(0, 9).toLowerCase() === 'urn:uuid:') {
    body = body.slice(9);
    at += 9;
  } else if (body.length >= 2 && body.startsWith('{') && body.endsWith('}')) {
    body = body.slice(1, -1);
    at += 1;
  }

  if (body.length === 36 || body.length === 32) {
    const hyphens = body.length === 36;
    let digits = '';
    for (let i = 0; i < body.length; i++) {
      const c = body[i]!;
      if (hyphens && HYPHENS.has(i)) {
        if (c !== '-')
          return { ok: false, message: `Not a UUID: expected "-" at position ${at + i}.`, position: at + i };
      } else if (!isHex(c)) {
        const shown = charAt(body, i);
        return {
          ok: false,
          message: `Not a UUID: "${shown}" at position ${at + i} is not a hex digit.`,
          position: at + i,
        };
      } else digits += c;
    }
    const bytes = new Uint8Array(16);
    for (let i = 0; i < 16; i++) bytes[i] = parseInt(digits.slice(i * 2, i * 2 + 2), 16);
    return { ok: true, value: describeUuid(bytes) };
  }

  if (body.length === 26) {
    let value = 0n;
    for (let i = 0; i < 26; i++) {
      const c = body[i]!.toUpperCase();
      const digit = CROCKFORD.indexOf(c);
      if (digit < 0) {
        const shown = charAt(body, i);
        const message = 'ILOU'.includes(c)
          ? `Not a ULID: "${shown}" at position ${at + i} is not used in ULIDs (I, L, O and U are excluded).`
          : `Not a ULID: "${shown}" at position ${at + i} is not a Crockford Base32 character.`;
        return { ok: false, message, position: at + i };
      }
      if (i === 0 && digit > 7)
        return {
          ok: false,
          message: `Not a ULID: the first character must be 0–7; larger values don't fit in 128 bits.`,
          position: at,
        };
      value = (value << 5n) | BigInt(digit);
    }
    const bytes = new Uint8Array(16);
    for (let i = 15, v = value; i >= 0; i--, v >>= 8n) bytes[i] = Number(v & 0xffn);
    return {
      ok: true,
      value: {
        kind: 'ulid',
        bytes,
        timeMs: Number(value >> 80n),
        random: (value & (TWO_80 - 1n)).toString(16).padStart(20, '0'),
      },
    };
  }

  return lengthError(body.length);
};
