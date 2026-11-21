/**
 * Hex to bytes by docs/tools/specs/hex-ascii.md §5 «Hex → байты»: this tool's own rule (`hash` reads hex by another
 * one and keeps its own reader). One pass over the characters, no regular expression over the whole input: a paste of
 * megabytes costs one linear scan. The only expressions are the two dump checks, run on the first non-empty line and
 * anchored at its start with fixed-length parts.
 */

export interface HexError {
  message: string;
  /** UTF-16 offset into the input. */
  offset: number;
  /** 1-based line, for people (`\n` ends a line). */
  line: number;
  /** 1-based UTF-16 column, for people. */
  column: number;
}

export type ParseHexResult = { ok: true; bytes: Uint8Array } | { ok: false; error: HexError };

export const DUMP_MESSAGE =
  'looks like a hex dump: offsets and the text column are not accepted. Paste only the hex bytes (xxd -p prints them)';

/** 1-based line and UTF-16 column of an offset; lines end at `\n` (a text area gives `\n` for every line break). */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
};

const fail = (text: string, message: string, offset: number): ParseHexResult => ({
  ok: false,
  error: { message, offset, ...positionOf(text, offset) },
});

/** JavaScript `\s` (WHATWG WhiteSpace and LineTerminator, U+00A0 and U+FEFF included). */
export const isSpace = (c: number): boolean =>
  c === 0x20 ||
  (c >= 0x09 && c <= 0x0d) ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

/** §5 step 2: whitespace and `,` `:` `;` `-` `{` `}` `[` `]` `(` `)` divide the input into chunks. */
export const isSeparator = (c: number): boolean =>
  isSpace(c) ||
  c === 0x2c || // ,
  c === 0x3a || // :
  c === 0x3b || // ;
  c === 0x2d || // -
  c === 0x7b || // {
  c === 0x7d || // }
  c === 0x5b || // [
  c === 0x5d || // ]
  c === 0x28 || // (
  c === 0x29; //   )

/** The value of a hex digit, or -1. */
export const hexValue = (c: number): number =>
  c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;

/** Invisible characters are named by code point (§5 step 5): controls, format characters, U+0085, lone surrogates. */
const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Cs}\u0085]$/u;

/** `"g" is not a hex digit`, or `U+200B is not a hex digit` for a character nobody could see. */
const notADigit = (text: string, at: number): string => {
  const cp = text.codePointAt(at)!;
  const ch = String.fromCodePoint(cp);
  const shown = INVISIBLE.test(ch) ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : `"${ch}"`;
  return `${shown} is not a hex digit`;
};

/** xxd: eight hex digits and ": " at the start of the line. */
const XXD = /^[0-9A-Fa-f]{8}: /;
/** hexdump -C: eight hex digits, two spaces and a byte — and a `|` later on the line (checked apart). */
const HEXDUMP = /^[0-9A-Fa-f]{8} {2}[0-9A-Fa-f]{2}/;

/** §5 step 1: where the offset of a dump's first line starts, or -1 when the first non-empty line is not a dump. */
export const dumpStart = (text: string): number => {
  let start = 0;
  for (;;) {
    let i = start;
    while (i < text.length && text.charCodeAt(i) !== 0x0a && isSpace(text.charCodeAt(i))) i++;
    if (i >= text.length) return -1;
    if (text.charCodeAt(i) === 0x0a) {
      start = i + 1;
      continue;
    }
    const end = text.indexOf('\n', i);
    // Only the first 80 characters matter to the two prefixes; the `|` may come anywhere on the line.
    const head = text.slice(i, i + 80);
    if (XXD.test(head)) return i;
    if (!HEXDUMP.test(head)) return -1;
    const bar = text.indexOf('|', i + 12);
    return bar !== -1 && (end === -1 || bar < end) ? i : -1;
  }
};

/**
 * Reads the hex digits of `text[from, to)` two by two into `out` at `at`. Returns the new write position, or an error
 * message with its offset: the first character that is not a digit, then an odd count.
 */
const readDigits = (
  text: string,
  from: number,
  to: number,
  out: Uint8Array,
  at: number,
  shown: number,
): { at: number } | { message: string; offset: number } => {
  for (let i = from; i < to; i++)
    if (hexValue(text.charCodeAt(i)) < 0) return { message: notADigit(text, i), offset: i };
  if ((to - from) % 2 !== 0)
    return { message: `odd number of hex digits in "${text.slice(shown, to)}"`, offset: shown };
  for (let i = from; i < to; i += 2) out[at++] = (hexValue(text.charCodeAt(i)) << 4) | hexValue(text.charCodeAt(i + 1));
  return { at };
};

/** Hex in any of the tool's forms, mixed (§5 «Hex → байты»); the first problem in reading order is the error. */
export const parseHex = (text: string): ParseHexResult => {
  const dump = dumpStart(text);
  if (dump !== -1) return fail(text, DUMP_MESSAGE, dump);
  const out = new Uint8Array(text.length >> 1);
  let at = 0;
  let i = 0;
  const n = text.length;
  while (i < n) {
    if (isSeparator(text.charCodeAt(i))) {
      i++;
      continue;
    }
    const start = i;
    let escaped = false;
    while (i < n && !isSeparator(text.charCodeAt(i))) {
      if (text.charCodeAt(i) === 0x5c) escaped = true;
      i++;
    }
    const end = i;
    if (escaped) {
      // One or more `\x` entries in a row; anything outside an entry is not a hex digit.
      let j = start;
      while (j < end) {
        const c = text.charCodeAt(j);
        const x = text.charCodeAt(j + 1);
        if (c !== 0x5c || j + 1 >= end || (x !== 0x78 && x !== 0x58)) return fail(text, notADigit(text, j), j);
        let k = j + 2;
        while (k < end && text.charCodeAt(k) !== 0x5c) k++;
        if (k === j + 2) return fail(text, '\\x without hex digits', j);
        const read = readDigits(text, j + 2, k, out, at, j);
        if ('message' in read) return fail(text, read.message, read.offset);
        at = read.at;
        j = k;
      }
      continue;
    }
    const prefixed =
      end - start >= 2 &&
      text.charCodeAt(start) === 0x30 &&
      (text.charCodeAt(start + 1) === 0x78 || text.charCodeAt(start + 1) === 0x58);
    if (prefixed && end - start === 2) return fail(text, '0x without hex digits', start);
    const read = readDigits(text, prefixed ? start + 2 : start, end, out, at, start);
    if ('message' in read) return fail(text, read.message, read.offset);
    at = read.at;
  }
  return { ok: true, bytes: out.slice(0, at) };
};
