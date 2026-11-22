/**
 * Bytes to Base64 and back (docs/tools/specs/base64.md §5, §9; also base64-image and hash's Base64 output). Encoding:
 * RFC 4648 §4 or §5, padding by RFC 4648 §3.2, wrapping at 64 (PEM) or 76 (MIME) characters with `\n`. Decoding: the
 * WHATWG Infra «forgiving-base64 decode» with both alphabets accepted, and the place of an error in the input as
 * typed.
 *
 * Speed: both directions go through lookup tables over char codes and byte arrays (no string or array per
 * character). `Uint8Array.prototype.toBase64` / `Uint8Array.fromBase64` (Chrome 140+; the extension declares Chrome
 * 116) are used where they exist and pass a known-answer probe, and only for what they answer the same by definition:
 * encoding always; decoding only when they accept the input (they accept a subset of what this module accepts). Every
 * refusal — its message and its place — comes from `locateError`, the original character-by-character reading, so a
 * fast path never words an error. The tests compare both paths with the module as it was, on 60,000 inputs.
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

/** The platform's Base64 (TC39 «Uint8Array to/from Base64», Chrome 140+), looked up at each call: absent before. */
interface PlatformBase64 {
  fromBase64?: (text: string, options: { alphabet: 'base64' | 'base64url'; lastChunkHandling: 'loose' }) => Uint8Array;
  prototype: {
    toBase64?: (this: Uint8Array, options: { alphabet: 'base64' | 'base64url'; omitPadding: boolean }) => string;
  };
}
const platform = Uint8Array as unknown as PlatformBase64;
type ToBase64 = NonNullable<PlatformBase64['prototype']['toBase64']>;
type FromBase64 = NonNullable<PlatformBase64['fromBase64']>;

/**
 * A built-in is used only when it is there and gives known answers: an array that is a view into a larger buffer,
 * both alphabets, padding left out (an early implementation behind a flag encoded a view from the buffer's start).
 * Probed once per function, so hiding or replacing it — as the tests do — is noticed.
 */
const probed = new WeakMap<object, boolean>();
const trusted = <F extends object>(fn: F | undefined, probe: (fn: F) => boolean): fn is F => {
  if (typeof fn !== 'function') return false;
  let ok = probed.get(fn);
  if (ok === undefined) {
    try {
      ok = probe(fn);
    } catch {
      ok = false;
    }
    probed.set(fn, ok);
  }
  return ok;
};
const sameBytes = (bytes: Uint8Array, expected: number[]): boolean =>
  bytes.length === expected.length && expected.every((b, i) => bytes[i] === b);
const probeTo = (toBase64: ToBase64): boolean => {
  const view = new Uint8Array([9, 0xfb, 0xff, 0xbf]).subarray(1);
  return (
    toBase64.call(view, { alphabet: 'base64url', omitPadding: true }) === '-_-_' &&
    toBase64.call(view.subarray(0, 2), { alphabet: 'base64', omitPadding: false }) === '+/8=' &&
    toBase64.call(view.subarray(0, 2), { alphabet: 'base64url', omitPadding: true }) === '-_8'
  );
};
const probeFrom = (fromBase64: FromBase64): boolean =>
  sameBytes(fromBase64(' -_ 8\n', { alphabet: 'base64url', lastChunkHandling: 'loose' }), [0xfb, 0xff]) &&
  sameBytes(fromBase64('+/+/+/8=', { alphabet: 'base64', lastChunkHandling: 'loose' }), [0xfb, 0xff, 0xbf, 0xfb, 0xff]);

/** Which way each direction goes in this runtime now — for tests and measurements; the answers are the same. */
export const base64Engine = (): { encode: 'platform' | 'tables'; decode: 'platform' | 'tables' } => ({
  encode: trusted(platform.prototype.toBase64, probeTo) ? 'platform' : 'tables',
  decode: trusted(platform.fromBase64, probeFrom) ? 'platform' : 'tables',
});

/** Two characters for every 12 bits, as two char codes in one entry: 4,096 entries per alphabet. */
const pairsOf = (table: string): Uint16Array => {
  const pairs = new Uint16Array(4096);
  for (let i = 0; i < 4096; i++) pairs[i] = (table.charCodeAt(i >> 6) << 8) | table.charCodeAt(i & 63);
  return pairs;
};
let pairsCache: { standard: Uint16Array; url: Uint16Array } | null = null;
const pairs = (alphabet: Base64Alphabet): Uint16Array =>
  (pairsCache ??= { standard: pairsOf(STANDARD), url: pairsOf(URL_SAFE) })[alphabet === 'url' ? 'url' : 'standard'];

/** ASCII bytes to a string in one call (ASCII reads the same in latin1). */
let latin1: { decode: (bytes: Uint8Array) => string } | null = null;
const asciiText = (bytes: Uint8Array): string => (latin1 ??= new TextDecoder('latin1')).decode(bytes);

const NEWLINE = 10;
const PAD = 61;

/** Four ASCII bytes for every three bytes, then the last one or two, padded or not. */
const encodeTable = (bytes: Uint8Array, alphabet: Base64Alphabet, padding: boolean): Uint8Array => {
  const table = alphabet === 'url' ? URL_SAFE : STANDARD;
  const pair = pairs(alphabet);
  const n = bytes.length;
  const out = new Uint8Array(Math.floor(n / 3) * 4 + (n % 3 === 0 ? 0 : padding ? 4 : (n % 3) + 1));
  let at = 0;
  let i = 0;
  for (; i + 2 < n; i += 3) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8) | bytes[i + 2]!;
    const hi = pair[v >> 12]!;
    const lo = pair[v & 4095]!;
    out[at] = hi >> 8;
    out[at + 1] = hi & 255;
    out[at + 2] = lo >> 8;
    out[at + 3] = lo & 255;
    at += 4;
  }
  const rest = n - i;
  if (rest === 1) {
    const v = bytes[i]! << 16;
    out[at++] = table.charCodeAt(v >> 18);
    out[at++] = table.charCodeAt((v >> 12) & 63);
    if (padding) {
      out[at++] = PAD;
      out[at++] = PAD;
    }
  } else if (rest === 2) {
    const v = (bytes[i]! << 16) | (bytes[i + 1]! << 8);
    out[at++] = table.charCodeAt(v >> 18);
    out[at++] = table.charCodeAt((v >> 12) & 63);
    out[at++] = table.charCodeAt((v >> 6) & 63);
    if (padding) out[at++] = PAD;
  }
  return out;
};

/** `\n` after every `lineLength` characters, none at the end. */
const wrapAscii = (ascii: Uint8Array, lineLength: number): Uint8Array => {
  if (lineLength === 0 || ascii.length <= lineLength) return ascii;
  const out = new Uint8Array(ascii.length + Math.floor((ascii.length - 1) / lineLength));
  let at = 0;
  for (let from = 0; from < ascii.length; from += lineLength) {
    if (from > 0) out[at++] = NEWLINE;
    const line = ascii.subarray(from, from + lineLength);
    out.set(line, at);
    at += line.length;
  }
  return out;
};

const wrapText = (text: string, lineLength: number): string => {
  if (lineLength === 0 || text.length <= lineLength) return text;
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += lineLength) lines.push(text.slice(at, at + lineLength));
  return lines.join('\n');
};

/** Steps 2–4 of «Кодирование»; without options: standard alphabet, padded, no wrapping. */
export const bytesToBase64 = (bytes: Uint8Array, options: Partial<Base64Options> = {}): string => {
  const { alphabet = 'standard', padding = true, lineLength = 0 } = options;
  const toBase64 = platform.prototype.toBase64;
  if (trusted(toBase64, probeTo))
    return wrapText(
      toBase64.call(bytes, { alphabet: alphabet === 'url' ? 'base64url' : 'base64', omitPadding: !padding }),
      lineLength,
    );
  return asciiText(wrapAscii(encodeTable(bytes, alphabet, padding), lineLength));
};

/** ASCII whitespace of the WHATWG Infra standard: TAB, LF, FF, CR, SPACE. */
const ASCII_WHITESPACE = new Set(['\t', '\n', '\f', '\r', ' ']);

/** Value of a character of either alphabet (`+` and `-` are 62, `/` and `_` are 63). */
const VALUE = new Map<string, number>([...[...STANDARD].map((c, i) => [c, i] as const), ['-', 62], ['_', 63]]);

/** By char code: the value of either alphabet, or one of the classes below. */
const WHITESPACE = -2;
const PADDING = -3;
const INVALID = -1;
const CODES = new Int8Array(128).fill(INVALID);
for (let i = 0; i < 64; i++) CODES[STANDARD.charCodeAt(i)] = i;
CODES[45] = 62; // '-'
CODES[95] = 63; // '_'
for (const c of [9, 10, 12, 13, 32]) CODES[c] = WHITESPACE;
CODES[PAD] = PADDING;

/**
 * One pass by char code straight into the output, for the input `parseBase64` accepts: data characters of either
 * alphabet, ASCII whitespace anywhere, and one or two `=` at the end only when the data and the `=` together divide by
 * 4; data that leaves one character over is refused. Null for anything else — then `locateError` reads the input and
 * words the refusal.
 */
const decodeTable = (text: string): Uint8Array | null => {
  const n = text.length;
  const out = new Uint8Array(Math.ceil((n * 3) / 4));
  let buffer = 0;
  let count = 0;
  let at = 0;
  let i = 0;
  for (; i < n; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? CODES[c]! : INVALID;
    if (v >= 0) {
      buffer = (buffer << 6) | v;
      if ((++count & 3) === 0) {
        out[at] = (buffer >> 16) & 0xff;
        out[at + 1] = (buffer >> 8) & 0xff;
        out[at + 2] = buffer & 0xff;
        at += 3;
        buffer = 0;
      }
    } else if (v === PADDING) break;
    else if (v !== WHITESPACE) return null;
  }
  let pads = 0;
  for (; i < n; i++) {
    const c = text.charCodeAt(i);
    const v = c < 128 ? CODES[c]! : INVALID;
    if (v === PADDING) pads++;
    else if (v !== WHITESPACE) return null;
  }
  const rest = count & 3;
  if (pads === 0 ? rest === 1 : pads > 2 || (count + pads) % 4 !== 0) return null;
  // The bits left over at the end are not checked (RFC 4648 §3.5, as WHATWG and atob).
  if (rest === 2) out[at++] = (buffer >> 4) & 0xff;
  else if (rest === 3) {
    out[at++] = (buffer >> 10) & 0xff;
    out[at++] = (buffer >> 2) & 0xff;
  }
  // An array of its own, exact size: callers hand `bytes.buffer` on (a transfer to a worker, a Blob).
  return at === out.length ? out : out.slice(0, at);
};

/**
 * The platform's decoder, where it gives the same answer by definition. `fromBase64` in the `loose` mode accepts a
 * subset of what `parseBase64` accepts — one alphabet at a time, the same five whitespace characters anywhere, the same
 * rules on `=` and on a last group of two or three characters, the bits left over unchecked — and gives the same bytes;
 * anything it refuses (another alphabet in the input, a character outside both, a misplaced `=`) comes back as null and
 * goes to the module's own reading. Its error is never shown.
 */
const decodePlatform = (text: string, fromBase64: FromBase64): Uint8Array | null => {
  for (const alphabet of ['base64', 'base64url'] as const) {
    try {
      return fromBase64(text, { alphabet, lastChunkHandling: 'loose' });
    } catch {
      // the other alphabet, then the module's own reading
    }
  }
  return null;
};

/** An invisible character (a lone surrogate included) is named by its code point; any other is quoted whole. */
const describe = (char: string): string =>
  /^[\p{White_Space}\p{Cc}\p{Cf}\p{Cs}]$/u.test(char)
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
  const fromBase64 = platform.fromBase64;
  const bytes = (trusted(fromBase64, probeFrom) ? decodePlatform(text, fromBase64) : null) ?? decodeTable(text);
  return bytes === null ? locateError(text) : { ok: true, bytes };
};

/**
 * The original reading, character by character (code points, so an emoji is one): what `parseBase64` answers for
 * every input `check` does not accept — a refusal with its message and place, or the bytes.
 */
const locateError = (text: string): ParseBase64Result => {
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
