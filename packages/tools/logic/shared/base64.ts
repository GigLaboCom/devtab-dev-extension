/**
 * Bytes to Base64 and back (docs/tools/specs/base64.md §5, §9; also base64-image and hash's Base64 output). Encoding:
 * RFC 4648 §4 or §5, padding by RFC 4648 §3.2, wrapping at 64 (PEM) or 76 (MIME) characters with `\n`. Decoding: the
 * WHATWG Infra «forgiving-base64 decode» with both alphabets accepted, and the place of an error in the input as
 * typed. Not `Uint8Array.prototype.toBase64` / `fromBase64`: Chrome 140+, the extension declares Chrome 116.
 *
 * A data URL is not looked at here (base64's own logic answers it), and neither is the text inside the bytes.
 */

export type Base64Alphabet = 'standard' | 'url';

export interface Base64Options {
  alphabet: Base64Alphabet;
  padding: boolean;
  /** 0 = no wrapping. */
  lineLength: 0 | 64 | 76;
}

export interface Base64Error {
  message: string;
  /** UTF-16 offset in the input. */
  offset: number;
  /** 1-based, for people. */
  line: number;
  /** 1-based UTF-16 column. */
  column: number;
}

export type ParseBase64Result = { ok: true; bytes: Uint8Array } | { ok: false; error: Base64Error };

const STANDARD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const URL_SAFE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** Steps 2–4 of «Кодирование»; without options: standard alphabet, padded, no wrapping. */
export const bytesToBase64 = (bytes: Uint8Array, options: Partial<Base64Options> = {}): string => {
  const { alphabet = 'standard', padding = true, lineLength = 0 } = options;
  const table = alphabet === 'url' ? URL_SAFE : STANDARD;
  const out: string[] = [];
  let i = 0;
  for (; i + 2 < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!, table[(n >> 6) & 63]!, table[n & 63]!);
  }
  const rest = bytes.length - i;
  if (rest === 1) {
    const n = bytes[i]! << 16;
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!);
    if (padding) out.push('==');
  } else if (rest === 2) {
    const n = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out.push(table[n >> 18]!, table[(n >> 12) & 63]!, table[(n >> 6) & 63]!);
    if (padding) out.push('=');
  }
  const text = out.join('');
  if (lineLength === 0 || text.length <= lineLength) return text;
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += lineLength) lines.push(text.slice(at, at + lineLength));
  return lines.join('\n');
};

/** ASCII whitespace of the WHATWG Infra standard: TAB, LF, FF, CR, SPACE. */
const ASCII_WHITESPACE = new Set(['\t', '\n', '\f', '\r', ' ']);

/** Value of a character of either alphabet (`+` and `-` are 62, `/` and `_` are 63). */
const VALUE = new Map<string, number>([...[...STANDARD].map((c, i) => [c, i] as const), ['-', 62], ['_', 63]]);

/** An invisible character is named by its code point; any other is quoted whole. */
const describe = (char: string): string =>
  /^[\p{White_Space}\p{Cc}\p{Cf}]$/u.test(char)
    ? `U+${char.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`
    : `"${char}"`;

/** Line and column (1-based, UTF-16) of an offset, lines split at `\n` — as the `json` tool counts them. */
const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = 0; i < offset && i < text.length; i++) {
    if (text[i] === '\n') {
      line++;
      lineStart = i + 1;
    }
  }
  return { line, column: offset - lineStart + 1 };
};

const failure = (text: string, offset: number, message: string): ParseBase64Result => ({
  ok: false,
  error: { message, offset, ...positionOf(text, offset) },
});

/** Steps 1–5 of «Декодирование»: whitespace, padding, both alphabets, the place of an error. */
export const parseBase64 = (text: string): ParseBase64Result => {
  // Characters (code points, so an emoji is one) that are not ASCII whitespace, with their UTF-16 offsets.
  const chars: string[] = [];
  const offsets: number[] = [];
  let offset = 0;
  for (const char of text) {
    if (!ASCII_WHITESPACE.has(char)) {
      chars.push(char);
      offsets.push(offset);
    }
    offset += char.length;
  }
  // A length that divides by 4 may end in one or two `=`.
  let length = chars.length;
  if (length % 4 === 0) {
    if (chars[length - 1] === '=') length--;
    if (chars[length - 1] === '=') length--;
  }
  for (let i = 0; i < length; i++) {
    const char = chars[i]!;
    if (VALUE.has(char)) continue;
    return failure(text, offsets[i]!, char === '=' ? 'misplaced padding "="' : `invalid character ${describe(char)}`);
  }
  if (length % 4 === 1) return failure(text, offsets[length - 1]!, 'one character too many at the end');

  // Six bits a character; the bits left over at the end are not checked (RFC 4648 §3.5, as WHATWG and atob).
  const bytes = new Uint8Array(Math.floor((length * 6) / 8));
  let buffer = 0;
  let bits = 0;
  let at = 0;
  for (let i = 0; i < length; i++) {
    buffer = ((buffer << 6) | VALUE.get(chars[i]!)!) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes[at++] = (buffer >> bits) & 0xff;
    }
  }
  return { ok: true, bytes };
};
