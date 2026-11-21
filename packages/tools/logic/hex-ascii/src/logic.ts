/**
 * The Hex and Text tool's logic (docs/tools/specs/hex-ascii.md §5, §9): text to bytes in a chosen encoding and back,
 * bytes to hex in the tool's formats and the dump view, the display of control characters and the texts of the notes.
 * Bytes to hex is the shared `bytesToHex` (@workspace/tools-shared/hex) — its options are exactly §5's six formats; the
 * dump view and the reader of hex (./parse) are this tool's own. Pure: no React, no DOM, no chrome. Size limits are the
 * component's: these functions take any input.
 */
import { positionOf } from './parse';
import { bytesToHex } from '@workspace/tools-shared/hex';
import type { HexError } from './parse';
import type { HexFormat, HexOptions } from '@workspace/tools-shared/hex';

export type { HexFormat, HexOptions } from '@workspace/tools-shared/hex';

export type TextEncodingId = 'utf-8' | 'utf-16le' | 'utf-16be' | 'iso-8859-1';

/** §4 Format: the six layouts of `bytesToHex` and the read-only dump view. */
export type OutputFormat = HexFormat | 'dump';

export type TextToBytesResult =
  { ok: true; bytes: Uint8Array; replacedSurrogates: boolean } | { ok: false; error: HexError };

export interface BytesToTextResult {
  text: string;
  /** 1-based number of the first byte of the first invalid sequence, or null. */
  firstInvalidByte: number | null;
  bom: boolean;
  /** C0 except TAB and LF, DEL, C1. */
  controlCount: number;
  /** Of those, C1 (U+0080–U+009F): they have no Control Pictures and stay invisible. */
  c1Count: number;
}

/** Text to hex refuses above this many UTF-16 code units (§12); exactly this many is still worked on. */
export const MAX_TEXT_INPUT = 1024 * 1024;
/** Hex to text refuses above this many characters (§12). */
export const MAX_HEX_INPUT = 5 * 1024 * 1024;
/** Up to this many characters the result follows every edit; above it, SETTLE_MS after the last one (§12). */
export const LIVE_INPUT = 256 * 1024;
/** How long the result waits after the last edit of a large input (§12). */
export const SETTLE_MS = 300;

const utf8 = new TextEncoder();
/** In Unicode mode a pair is one code point, so this matches only a lone surrogate. */
const LONE_SURROGATE = /[\uD800-\uDFFF]/u;
const INVISIBLE = /^[\p{Cc}\p{Cf}\p{Cs}\u0085]$/u;

/** A character as an error names it: in quotes, or as U+XXXX when it cannot be seen. */
const shownChar = (cp: number): string => {
  const ch = String.fromCodePoint(cp);
  return INVISIBLE.test(ch) ? `U+${cp.toString(16).toUpperCase().padStart(4, '0')}` : `"${ch}"`;
};

/** §5 «Текст → байты»: UTF-8 (TextEncoder), UTF-16 code units two bytes each with no BOM, ISO-8859-1 byte = code point. */
export const textToBytes = (text: string, encoding: TextEncodingId): TextToBytesResult => {
  if (encoding === 'utf-8')
    return { ok: true, bytes: utf8.encode(text), replacedSurrogates: LONE_SURROGATE.test(text) };
  const n = text.length;
  if (encoding === 'iso-8859-1') {
    const bytes = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      const c = text.charCodeAt(i);
      if (c > 0xff) {
        const message = `${shownChar(text.codePointAt(i)!)} is not in ISO-8859-1`;
        return { ok: false, error: { message, offset: i, ...positionOf(text, i) } };
      }
      bytes[i] = c;
    }
    return { ok: true, bytes, replacedSurrogates: false };
  }
  const bytes = new Uint8Array(n * 2);
  const [hi, lo] = encoding === 'utf-16le' ? [1, 0] : [0, 1];
  for (let i = 0; i < n; i++) {
    const c = text.charCodeAt(i);
    bytes[2 * i + hi] = c >> 8;
    bytes[2 * i + lo] = c & 0xff;
  }
  return { ok: true, bytes, replacedSurrogates: false };
};

/** WHATWG Encoding «UTF-8 decoder»: the 1-based number of the first byte of the first invalid sequence, or null. */
export const firstInvalidUtf8 = (bytes: Uint8Array): number | null => {
  const n = bytes.length;
  let i = 0;
  while (i < n) {
    const b = bytes[i]!;
    if (b < 0x80) {
      i++;
      continue;
    }
    let need: number;
    let lower = 0x80;
    let upper = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) need = 1;
    else if (b >= 0xe0 && b <= 0xef) {
      need = 2;
      if (b === 0xe0) lower = 0xa0;
      if (b === 0xed) upper = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      need = 3;
      if (b === 0xf0) lower = 0x90;
      if (b === 0xf4) upper = 0x8f;
    } else return i + 1;
    for (let k = 1; k <= need; k++) {
      const c = bytes[i + k];
      if (c === undefined || c < lower || c > upper) return i + 1;
      lower = 0x80;
      upper = 0xbf;
    }
    i += need + 1;
  }
  return null;
};

/** The 1-based number of the first byte of a lone surrogate or of an odd last byte, or null. */
export const firstInvalidUtf16 = (bytes: Uint8Array, littleEndian: boolean): number | null => {
  const units = bytes.length >> 1;
  const unit = (u: number): number =>
    littleEndian ? bytes[2 * u]! | (bytes[2 * u + 1]! << 8) : (bytes[2 * u]! << 8) | bytes[2 * u + 1]!;
  for (let u = 0; u < units; u++) {
    const v = unit(u);
    if (v >= 0xd800 && v <= 0xdbff) {
      if (u + 1 < units) {
        const next = unit(u + 1);
        if (next >= 0xdc00 && next <= 0xdfff) {
          u++;
          continue;
        }
      }
      return 2 * u + 1;
    }
    if (v >= 0xdc00 && v <= 0xdfff) return 2 * u + 1;
  }
  return bytes.length % 2 === 1 ? bytes.length : null;
};

/** ISO-8859-1 itself: byte = code point, 0x80–0x9F included (not windows-1252, which `latin1` means to TextDecoder). */
const latin1 = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 0x2000)
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + 0x2000, bytes.length))));
  return parts.join('');
};

const DECODERS: Record<Exclude<TextEncodingId, 'iso-8859-1'>, { decode: (bytes: Uint8Array) => string }> = {
  'utf-8': new TextDecoder('utf-8', { ignoreBOM: true }),
  'utf-16le': new TextDecoder('utf-16le', { ignoreBOM: true }),
  'utf-16be': new TextDecoder('utf-16be', { ignoreBOM: true }),
};

/** C0 except TAB and LF, DEL, C1 — what §5 counts as control characters. */
const isControl = (c: number): boolean =>
  (c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f || (c >= 0x80 && c <= 0x9f);

/** §5 «Байты → текст»: invalid bytes become U+FFFD and are reported, not refused; a byte order mark stays. */
export const bytesToText = (bytes: Uint8Array, encoding: TextEncodingId): BytesToTextResult => {
  const text = encoding === 'iso-8859-1' ? latin1(bytes) : DECODERS[encoding].decode(bytes);
  const firstInvalidByte =
    encoding === 'utf-8'
      ? firstInvalidUtf8(bytes)
      : encoding === 'iso-8859-1'
        ? null
        : firstInvalidUtf16(bytes, encoding === 'utf-16le');
  let controlCount = 0;
  let c1Count = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (isControl(c)) {
      controlCount++;
      if (c >= 0x80) c1Count++;
    }
  }
  return { text, firstInvalidByte, bom: text.charCodeAt(0) === 0xfeff, controlCount, c1Count };
};

/** Display only: Control Pictures for C0 (except TAB, LF) and DEL; C1 has none and stays as it is. */
export const showControls = (text: string): string => {
  const parts: string[] = [];
  let from = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if ((c < 0x20 && c !== 0x09 && c !== 0x0a) || c === 0x7f) {
      if (i > from) parts.push(text.slice(from, i));
      parts.push(String.fromCharCode(c === 0x7f ? 0x2421 : 0x2400 + c));
      from = i + 1;
    }
  }
  if (from === 0) return text;
  parts.push(text.slice(from));
  return parts.join('');
};

const DIGITS = Array.from({ length: 256 }, (_, b) => b.toString(16).padStart(2, '0'));
const DIGITS_UPPER = DIGITS.map(d => d.toUpperCase());
/** Byte → the dump's text column: ASCII 0x20–0x7E as itself, everything else `.`. */
const SHOWN = Array.from({ length: 256 }, (_, b) => (b >= 0x20 && b <= 0x7e ? String.fromCharCode(b) : '.'));

/**
 * The view of `hexdump -C` (§5 «Dump»): 16 bytes a line, an 8-digit offset and two spaces, the bytes with one more space
 * after the eighth, a short last line padded to the same width, two spaces and the text column between `|`. Lines are
 * joined with `\n`; there is no closing offset line.
 */
export const hexDump = (bytes: Uint8Array, options: { uppercase?: boolean } = {}): string => {
  const digits = options.uppercase ? DIGITS_UPPER : DIGITS;
  const lines: string[] = [];
  for (let offset = 0; offset < bytes.length; offset += 16) {
    const end = Math.min(offset + 16, bytes.length);
    let hex = '';
    let shown = '';
    for (let i = offset; i < offset + 16; i++) {
      if (i < end) {
        hex += `${digits[bytes[i]!]} `;
        shown += SHOWN[bytes[i]!];
      } else hex += '   ';
      if (i === offset + 7) hex += ' ';
    }
    const at = offset.toString(16).padStart(8, '0');
    lines.push(`${options.uppercase ? at.toUpperCase() : at}  ${hex} |${shown}|`);
  }
  return lines.join('\n');
};

/** The result of Text to hex: the dump view, or bytesToHex in one of its formats. */
export const formatBytes = (
  bytes: Uint8Array,
  options: { format: OutputFormat; uppercase: boolean; bytesPerLine: HexOptions['bytesPerLine'] },
): string =>
  options.format === 'dump'
    ? hexDump(bytes, { uppercase: options.uppercase })
    : bytesToHex(bytes, { format: options.format, uppercase: options.uppercase, bytesPerLine: options.bytesPerLine });
