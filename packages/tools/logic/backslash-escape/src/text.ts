/** Small text helpers shared by Escape and Unescape: hex digits, positions for people, line breaks after a backslash. */

/** The value of one hex digit (a UTF-16 code unit), or -1. */
export const hexDigit = (unit: number): number => {
  if (unit >= 0x30 && unit <= 0x39) return unit - 0x30;
  const lower = unit | 0x20;
  return lower >= 0x61 && lower <= 0x66 ? lower - 0x61 + 10 : -1;
};

/** Exactly `count` hex digits at `from` (all before `end`) as a number, or -1. */
export const hexAt = (text: string, from: number, count: number, end: number): number => {
  if (from + count > end) return -1;
  let value = 0;
  for (let i = from; i < from + count; i++) {
    const digit = hexDigit(text.charCodeAt(i));
    if (digit < 0) return -1;
    value = value * 16 + digit;
  }
  return value;
};

export const isOctalDigit = (unit: number): boolean => unit >= 0x30 && unit <= 0x37;
export const isDecimalDigit = (unit: number): boolean => unit >= 0x30 && unit <= 0x39;
export const isSurrogate = (unit: number): boolean => unit >= 0xd800 && unit <= 0xdfff;

/** Lowercase hex, padded to `width` digits (§5: hex digits are lowercase in every dialect). */
export const hex = (n: number, width: number): string => n.toString(16).padStart(width, '0');

/**
 * How many code units a line break at `i` takes (CR LF counts as one break), or 0 when there is none. `unicode` also
 * counts U+2028 and U+2029, which JavaScript treats as line terminators.
 */
export const lineBreakAt = (text: string, i: number, end: number, unicode: boolean): number => {
  if (i >= end) return 0;
  const unit = text.charCodeAt(i);
  if (unit === 0x0a) return 1;
  if (unit === 0x0d) return i + 1 < end && text.charCodeAt(i + 1) === 0x0a ? 2 : 1;
  return unicode && (unit === 0x2028 || unit === 0x2029) ? 1 : 0;
};

/** Line and column (both from 1; the column in UTF-16 units) of `offset`, as the JSON tool counts them: lines end at LF. */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
};

/** The first unpaired surrogate of `text` at or after `from`, as [index, unit], or null. */
export const nextLoneSurrogate = (text: string, from = 0): [number, number] | null => {
  for (let i = from; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit < 0xd800 || unit > 0xdfff) continue;
    if (unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
    }
    return [i, unit];
  }
  return null;
};

const ANY_SURROGATE = /[\uD800-\uDFFF]/;

/** How many unpaired surrogates `text` holds, and the first of them. One native scan when there are none. */
export const countLoneSurrogates = (text: string): { count: number; first: number | null } => {
  if (!ANY_SURROGATE.test(text)) return { count: 0, first: null };
  let count = 0;
  let first: number | null = null;
  for (let found = nextLoneSurrogate(text); found; found = nextLoneSurrogate(text, found[0] + 1)) {
    if (first === null) first = found[1];
    count++;
  }
  return { count, first };
};
