/**
 * Reading the text field (docs/tools/specs/compress.md §3): Base64 by the shared `parseBase64` (both alphabets, padding,
 * ASCII whitespace anywhere — its messages and places as they are), hex by the rules of hex-ascii §5 «Hex → байты»
 * (pairs of digits, separators, `0x` and `\x`, an even count in every chunk; the shared hex module only writes hex, so
 * the reader is this tool's own, written to those rules), text as its UTF-8 bytes exactly as typed.
 */
import { recogniseFormat } from './formats';
import { BASE64_HINT, HEX_HINT, placed } from './messages';
import { parseBase64 } from '@workspace/tools-shared/base64';

export interface PlaceError {
  message: string;
  /** UTF-16 offset in the field. */
  offset: number;
  /** 1-based, for people. */
  line: number;
  column: number;
}

export type ParsedInput = { ok: true; bytes: Uint8Array } | { ok: false; error: PlaceError; hint?: string };

const ENCODER = new TextEncoder();

/** §3, Text: UTF-8 exactly as typed — no trimming, no line break added; a lone surrogate becomes `ef bf bd`. */
export const textBytes = (text: string): Uint8Array => ENCODER.encode(text);

const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i !== -1 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
};

const isSpace = (c: number): boolean =>
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

/** Whitespace and `,` `:` `;` `-` `{` `}` `[` `]` `(` `)` divide hex into chunks. */
const SEPARATORS = new Set([0x2c, 0x3a, 0x3b, 0x2d, 0x7b, 0x7d, 0x5b, 0x5d, 0x28, 0x29]);
const isSeparator = (c: number): boolean => isSpace(c) || SEPARATORS.has(c);

const hexValue = (c: number): number =>
  c >= 0x30 && c <= 0x39 ? c - 0x30 : c >= 0x61 && c <= 0x66 ? c - 0x57 : c >= 0x41 && c <= 0x46 ? c - 0x37 : -1;

const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Cs}\u0085]$/u;

const notADigit = (text: string, at: number): string => {
  const cp = text.codePointAt(at)!;
  const ch = String.fromCodePoint(cp);
  const shown = INVISIBLE.test(ch) ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : `"${ch}"`;
  return `${shown} is not a hex digit`;
};

type HexRead = { ok: true; bytes: Uint8Array } | { ok: false; message: string; offset: number };

/** Hex in the forms of hex-ascii §5, mixed; the first problem in reading order is the error. */
export const parseHexBytes = (text: string): HexRead => {
  const out = new Uint8Array(text.length >> 1);
  let at = 0;
  const digits = (from: number, to: number, shown: number): { message: string; offset: number } | null => {
    for (let i = from; i < to; i++)
      if (hexValue(text.charCodeAt(i)) < 0) return { message: notADigit(text, i), offset: i };
    if ((to - from) % 2 !== 0)
      return { message: `odd number of hex digits in "${text.slice(shown, to)}"`, offset: shown };
    for (let i = from; i < to; i += 2)
      out[at++] = (hexValue(text.charCodeAt(i)) << 4) | hexValue(text.charCodeAt(i + 1));
    return null;
  };
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
      for (let j = start; j < end;) {
        const x = text.charCodeAt(j + 1);
        if (text.charCodeAt(j) !== 0x5c || j + 1 >= end || (x !== 0x78 && x !== 0x58))
          return { ok: false, message: notADigit(text, j), offset: j };
        let k = j + 2;
        while (k < end && text.charCodeAt(k) !== 0x5c) k++;
        if (k === j + 2) return { ok: false, message: '\\x without hex digits', offset: j };
        const bad = digits(j + 2, k, j);
        if (bad) return { ok: false, ...bad };
        j = k;
      }
      continue;
    }
    const prefixed =
      end - start >= 2 && text.charCodeAt(start) === 0x30 && (text.charCodeAt(start + 1) | 0x20) === 0x78;
    if (prefixed && end - start === 2) return { ok: false, message: '0x without hex digits', offset: start };
    const bad = digits(prefixed ? start + 2 : start, end, start);
    if (bad) return { ok: false, ...bad };
  }
  return { ok: true, bytes: out.slice(0, at) };
};

const BASE64_TEXT = /^[A-Za-z0-9+/_=\s-]+$/;
const HEX_TEXT = /^(?:\s*(?:0x)?[0-9a-fA-F]{2})+\s*$/;

/** §6: hex that failed may be Base64; the hint only when Base64 reads the same text without an error. */
const base64Hint = (text: string): string | undefined =>
  text.length <= 1024 * 1024 && BASE64_TEXT.test(text) && parseBase64(text).ok ? BASE64_HINT : undefined;

/** The field's bytes, or the error with its place (and a hint when the other encoding fits). */
export const parseInput = (text: string, kind: 'base64' | 'hex'): ParsedInput => {
  if (kind === 'base64') {
    const parsed = parseBase64(text);
    if (parsed.ok) return parsed;
    const hex = text.length <= 1024 * 1024 && HEX_TEXT.test(text);
    return { ok: false, error: { ...parsed.error, message: placed(parsed.error) }, ...(hex ? { hint: HEX_HINT } : {}) };
  }
  const read = parseHexBytes(text);
  if (read.ok) return read;
  const at = positionOf(text, read.offset);
  const error = { message: read.message, offset: read.offset, ...at };
  const hint = base64Hint(text);
  return { ok: false, error: { ...error, message: placed(error) }, ...(hint ? { hint } : {}) };
};

/**
 * §6: Base64 that reads but does not start like a known format, yet is all hex digits whose bytes do — the person
 * pasted hex under Base64.
 */
export const hexInsteadOfBase64 = (text: string): boolean => {
  if (text.length > 1024 * 1024 || !HEX_TEXT.test(text)) return false;
  const read = parseHexBytes(text);
  return read.ok && recogniseFormat(read.bytes.subarray(0, 4)) !== null;
};

/** §5.6: hints under the Text field — the bytes compressed are exactly what is typed. */
export const textHints = (text: string): Array<'trailing-newline' | 'edge-space'> => {
  const hints: Array<'trailing-newline' | 'edge-space'> = [];
  if (text.endsWith('\n')) hints.push('trailing-newline');
  if (/^[ \t]|[ \t]$/.test(text)) hints.push('edge-space');
  return hints;
};
