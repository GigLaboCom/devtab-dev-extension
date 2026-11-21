/**
 * The Number Bases tool's logic (docs/tools/specs/number-base.md §5, §6, §9): one whole number of any size, read from a
 * field of base 2, 8, 10, 16 or N (2–36) and written in every base — with a minus sign, or as a two's complement
 * pattern of 8 to 64 bits read both signed and unsigned. Everything is `BigInt`: nothing is ever rounded. Pure: no
 * React, no DOM, no chrome. `detectNumberBase` lives in detect.ts.
 */
import { bytesToHex } from '@workspace/tools-shared/hex';

export type FieldBase = 2 | 8 | 10 | 16;
/** 2..36 for the Base field. */
export type Radix = number;
export type NegativeMode = 'sign' | 'twos';
export type Width = 8 | 16 | 32 | 64;

export interface NumberOptions {
  negative: NegativeMode;
  width: Width;
}

export interface FormatOptions extends NumberOptions {
  uppercase: boolean;
  grouped: boolean;
  prefixes: boolean;
  /**
   * The Base field (§5): digits only — no prefix, no groups, no padding to the width — whatever its N. An addition to
   * §9: the radix alone cannot tell the Base field at N = 16 from the Hexadecimal field.
   */
  plain?: boolean;
}

export interface FieldError {
  message: string;
  /** UTF-16 offset in the field's text (before trimming). */
  offset: number;
}

/** value: null for an empty field; in 'twos' mode the signed reading (BigInt.asIntN). */
export type ParseResult = { ok: true; value: bigint | null } | { ok: false; error: FieldError };

export interface Formatted {
  /** What the field shows (with groups when grouped). */
  shown: string;
  /** What its copy button copies (no group separators). */
  copy: string;
}

export interface Details {
  signed?: string;
  unsigned?: string;
  bitLength: number;
  byteLength: number;
  /** Null for a negative number in 'sign' mode. */
  bytesBigEndian: string | null;
  bytesLittleEndian: string | null;
}

/** Digits a field takes, not counting the sign, the prefix and the separators (§5, §12). */
export const MAX_DIGITS = 10_000;
/** Bytes a bytes row shows; the rest is `… (N bytes)`, and its copy button still copies all of them (§5). */
export const MAX_SHOWN_BYTES = 64;
export const MIN_RADIX = 2;
export const MAX_RADIX = 36;

export const WIDTHS: readonly Width[] = [8, 16, 32, 64];

/** The texts of §6, word for word. */
export const MESSAGES = {
  fraction: 'only whole numbers: fractions are not supported',
  exponent: 'only whole numbers: exponent notation (1e3) is not supported',
  noDigits: 'enter digits after the sign or prefix',
  commas: 'commas must separate groups of three digits, as in 1,000,000',
  comma: '"," is not allowed here; use _ or a space to group digits',
  tooLong: 'too long: up to 10,000 digits',
  radix: 'Base must be a whole number from 2 to 36',
} as const;

export const notADigit = (char: string, radix: Radix): string => `"${char}" is not a base-${radix} digit`;

export const doesNotFit = (width: Width): string => {
  const { min, max } = widthRange(width);
  return `does not fit in ${width} bits: the range is ${min} to ${max}`;
};

/** Values a pattern of `width` bits stands for: its signed and its unsigned readings together. */
export const widthRange = (width: Width): { min: bigint; max: bigint } => ({
  min: -(1n << BigInt(width - 1)),
  max: (1n << BigInt(width)) - 1n,
});

/** The prefix a field of this base takes and writes (§5 rule 3); the other bases have none. */
const PREFIX: Partial<Record<number, string>> = { 2: '0b', 8: '0o', 16: '0x' };
/** Where a number with this prefix letter goes (§5 rule 8). */
const PREFIX_FIELD: Record<string, { prefix: string; field: string; radix: number }> = {
  b: { prefix: '0b', field: 'Binary', radix: 2 },
  o: { prefix: '0o', field: 'Octal', radix: 8 },
  x: { prefix: '0x', field: 'Hexadecimal', radix: 16 },
};

/**
 * Group separators skipped anywhere after the sign and the prefix (§5 rule 6): `_`, a space, `'` — and the no-break
 * spaces locales group digits with (U+00A0, U+202F, U+2009), so `1 000 000` pasted from a French text reads too.
 */
const SEPARATORS = new Set(['_', ' ', "'", ' ', ' ', ' ']);

/** JavaScript's `\s`, as String.prototype.trim reads it. */
const SPACE = /\s/;

/** 0–35 for `0–9`, `a–z`, `A–Z`; -1 for anything else (digits of other scripts included). */
const digitValue = (code: number): number => {
  if (code >= 48 && code <= 57) return code - 48;
  if (code >= 97 && code <= 122) return code - 87;
  if (code >= 65 && code <= 90) return code - 55;
  return -1;
};

/** Is the N of the Base field a whole number from 2 to 36? Surrounding spaces are allowed, nothing else. */
export const isValidRadix = (text: string): boolean => {
  const t = text.trim();
  if (!/^\d{1,3}$/.test(t)) return false;
  const n = Number(t);
  return n >= MIN_RADIX && n <= MAX_RADIX;
};

/** The N of a valid radix text (isValidRadix), else null. */
export const radixOf = (text: string): Radix | null => (isValidRadix(text) ? Number(text.trim()) : null);

/** How many digits of `radix` one Number holds exactly (radix^k ≤ 2^53 − 1). */
const chunkDigits = (radix: Radix): number => {
  let k = 1;
  while (radix ** (k + 1) <= Number.MAX_SAFE_INTEGER) k++;
  return k;
};

/**
 * Digits of any base 2–36 (already checked) as a BigInt. Bases 2, 8, 10 and 16 go to the engine's own parser; any other
 * is split into chunks a Number holds and joined pairwise — divide and conquer, so the large multiplications are few
 * and balanced instead of one per digit.
 */
export const digitsToBigInt = (digits: string, radix: Radix): bigint => {
  if (digits === '') return 0n;
  if (radix === 10) return BigInt(digits);
  const prefix = PREFIX[radix];
  if (prefix) return BigInt(prefix + digits);
  const k = chunkDigits(radix);
  let parts: bigint[] = [];
  const head = digits.length % k;
  if (head > 0) parts.push(BigInt(parseInt(digits.slice(0, head), radix)));
  for (let i = head; i < digits.length; i += k) parts.push(BigInt(parseInt(digits.slice(i, i + k), radix)));
  // Every part but the first is exactly `width` digits wide; pair them from the right so it stays that way.
  let scale = BigInt(radix) ** BigInt(k);
  while (parts.length > 1) {
    const next: bigint[] = [];
    let i = parts.length;
    for (; i >= 2; i -= 2) next.push(parts[i - 2]! * scale + parts[i - 1]!);
    if (i === 1) next.push(parts[0]!);
    parts = next.reverse();
    scale *= scale;
  }
  return parts[0]!;
};

const fail = (message: string, offset: number): ParseResult => ({ ok: false, error: { message, offset } });

/**
 * One field's text as a number (§5 «Разбор поля», §6). A field of base 2, 8 or 16 takes its own prefix (`0b`, `0o`,
 * `0x`, any case); 10 and any other base take none. The scan is one pass and stops at the first error or at digit
 * 10,001, so a text of any length costs no more than reading 10,000 digits.
 */
export const parseNumber = (text: string, radix: Radix, options: NumberOptions): ParseResult => {
  let start = 0;
  let end = text.length;
  while (start < end && SPACE.test(text[start]!)) start++;
  while (end > start && SPACE.test(text[end - 1]!)) end--;
  if (start === end) return { ok: true, value: null };

  let i = start;
  let negative = false;
  if (text[i] === '-' || text[i] === '+') {
    negative = text[i] === '-';
    i++;
  }
  const own = PREFIX[radix];
  let prefixed = false;
  if (own && text[i] === '0' && text[i + 1]?.toLowerCase() === own[1]) {
    i += 2;
    prefixed = true;
  }
  const body = i;

  // §5 rule 8: another base's prefix letter right after a leading 0 — a hint where the number goes.
  if (!prefixed && text[i] === '0' && i + 1 < end) {
    const letter = text[i + 1]!;
    const foreign = PREFIX_FIELD[letter.toLowerCase()];
    if (foreign && foreign.radix !== radix && digitValue(letter.charCodeAt(0)) >= radix)
      return fail(`${notADigit(letter, radix)}; ${foreign.prefix}… numbers go in the ${foreign.field} field`, i + 1);
  }

  const digits: string[] = [];
  // Thousands commas (Decimal only): digits since the last comma, the last comma, the last digit.
  let commas = 0;
  let group = 0;
  let lastComma = -1;
  let lastDigit = -1;
  for (; i < end; i++) {
    const char = text[i]!;
    if (SEPARATORS.has(char)) continue;
    if (char === ',') {
      if (radix !== 10) return fail(MESSAGES.comma, i);
      if (commas === 0 ? group < 1 || group > 3 : group !== 3) return fail(MESSAGES.commas, i);
      commas++;
      group = 0;
      lastComma = i;
      continue;
    }
    if (char === '.') return fail(MESSAGES.fraction, i);
    const code = text.charCodeAt(i);
    const value = digitValue(code);
    if (value >= 0 && value < radix) {
      if (digits.length === MAX_DIGITS) return fail(MESSAGES.tooLong, i);
      digits.push(char);
      group++;
      lastDigit = i;
      continue;
    }
    if ((char === 'e' || char === 'E') && radix <= 14 && digits.length > 0) return fail(MESSAGES.exponent, i);
    return fail(notADigit(String.fromCodePoint(text.codePointAt(i)!), radix), i);
  }
  if (digits.length === 0) return fail(MESSAGES.noDigits, end);
  if (commas > 0 && group !== 3) return fail(MESSAGES.commas, group > 0 ? lastDigit : lastComma);

  let value = digitsToBigInt(digits.join(''), radix);
  if (negative) value = -value;
  if (options.negative === 'twos') {
    const { min, max } = widthRange(options.width);
    if (value < min || value > max) return fail(doesNotFit(options.width), body);
    value = BigInt.asIntN(options.width, value);
  }
  return { ok: true, value };
};

/** Groups counted from the right (§5 «Group digits»): 2 and 16 by 4 with a space, 8 by 3 with a space, 10 by 3 with a comma. */
const GROUPS: Partial<Record<number, { size: number; separator: string }>> = {
  2: { size: 4, separator: ' ' },
  8: { size: 3, separator: ' ' },
  10: { size: 3, separator: ',' },
  16: { size: 4, separator: ' ' },
};

const group = (digits: string, size: number, separator: string): string => {
  const head = digits.length % size || size;
  const parts = [digits.slice(0, head)];
  for (let i = head; i < digits.length; i += size) parts.push(digits.slice(i, i + size));
  return parts.join(separator);
};

/**
 * A number as one field writes it (§5 «Вывод»): no leading zeros but the padding of Binary and Hexadecimal to the width
 * in two's complement; Decimal shows the signed reading there, the other bases the bit pattern. `copy` is `shown`
 * without group separators. A value outside the width (never one parseNumber gave) wraps to it.
 */
export const formatNumber = (value: bigint | null, radix: Radix, options: FormatOptions): Formatted => {
  if (value === null) return { shown: '', copy: '' };
  const plain = options.plain === true;
  let negative = false;
  let digits: string;
  if (options.negative === 'twos') {
    if (radix === 10 && !plain) {
      const signed = BigInt.asIntN(options.width, value);
      negative = signed < 0n;
      digits = (negative ? -signed : signed).toString(10);
    } else {
      digits = BigInt.asUintN(options.width, value).toString(radix);
      if (!plain && (radix === 2 || radix === 16))
        digits = digits.padStart(radix === 2 ? options.width : options.width / 4, '0');
    }
  } else {
    negative = value < 0n;
    digits = (negative ? -value : value).toString(radix);
  }
  if (options.uppercase) digits = digits.toUpperCase();
  const head = (negative ? '-' : '') + (!plain && options.prefixes ? (PREFIX[radix] ?? '') : '');
  const grouping = options.grouped && !plain ? GROUPS[radix] : undefined;
  return {
    shown: head + (grouping ? group(digits, grouping.size, grouping.separator) : digits),
    copy: head + digits,
  };
};

/** The magnitude's (or the pattern's) bytes, most significant first, `count` of them at least. */
const bytesOf = (value: bigint, count: number): Uint8Array => {
  let hex = value.toString(16);
  hex = hex.padStart(Math.max(count * 2, hex.length + (hex.length % 2)), '0');
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
};

/** Binary digits of a non-negative value without leading zeros; 0 for 0 (Python's int.bit_length()). */
export const bitLengthOf = (value: bigint): number => {
  if (value === 0n) return 0;
  const hex = value.toString(16);
  return (hex.length - 1) * 4 + parseInt(hex[0]!, 16).toString(2).length;
};

/** The rows under the fields (§5 «Подробности»). */
export const numberDetails = (value: bigint, options: NumberOptions & { uppercase: boolean }): Details => {
  const hex = (bytes: Uint8Array): string => bytesToHex(bytes, { format: 'spaced', uppercase: options.uppercase });
  if (options.negative === 'twos') {
    const unsigned = BigInt.asUintN(options.width, value);
    const bytes = bytesOf(unsigned, options.width / 8);
    return {
      signed: BigInt.asIntN(options.width, value).toString(),
      unsigned: unsigned.toString(),
      bitLength: options.width,
      byteLength: options.width / 8,
      bytesBigEndian: hex(bytes),
      bytesLittleEndian: hex(bytes.slice().reverse()),
    };
  }
  const magnitude = value < 0n ? -value : value;
  const bitLength = bitLengthOf(magnitude);
  const byteLength = Math.max(1, Math.ceil(bitLength / 8));
  if (value < 0n) return { bitLength, byteLength, bytesBigEndian: null, bytesLittleEndian: null };
  const bytes = bytesOf(magnitude, byteLength);
  return {
    bitLength,
    byteLength,
    bytesBigEndian: hex(bytes),
    bytesLittleEndian: hex(bytes.slice().reverse()),
  };
};

/** A bytes row as shown: the first 64 bytes, then `… (N bytes)` (§5); the copy button takes the whole text. */
export const clipBytes = (bytes: string): string => {
  const count = (bytes.length + 1) / 3;
  if (count <= MAX_SHOWN_BYTES) return bytes;
  return `${bytes.slice(0, MAX_SHOWN_BYTES * 3 - 1)} … (${count.toLocaleString('en-US')} bytes)`;
};
