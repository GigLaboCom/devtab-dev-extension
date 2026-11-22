/**
 * Decode's input as bytes (docs/tools/specs/base64-image.md §3, §5 «Decode, разбор ввода»): a data: URI in any legal
 * spelling — upper-case scheme, parameters, `;base64` with spaces before it, a percent-encoded body, white space and
 * line breaks inside — or bare Base64 of either alphabet, and either of them pasted whole as a CSS `url(…)` or an
 * `<img src>`. An address (`https:`, `blob:`, `file:`, or `//` and what is not Base64) is refused in words: the tool never
 * fetches anything.
 *
 * Positions of a Base64 error are offsets into the text as typed (UTF-16), with line and column; a body with
 * percent-escapes has none (the escapes change the offsets). Base64 is read by the platform's forgiving-base64 (`atob`)
 * when the text is plainly well-formed — the case of every valid input, ten times faster than the shared reader on
 * 14 Mi characters — and by the shared `parseBase64` otherwise, which finds and places the error.
 */
import { parseBase64 } from '@workspace/tools-shared/base64';
import type { Base64Error, ParseBase64Result } from '@workspace/tools-shared/base64';

export type InputError = Pick<Base64Error, 'message'> & Partial<Base64Error>;

export type ParsedInput =
  { ok: true; bytes: Uint8Array; declaredMime: string | null; shape: InputShape } | { ok: false; error: InputError };

/** How the input was written: what Copy data URI and the history keep in mind. */
export type InputShape = 'base64' | 'data-uri' | 'css' | 'img';

export const NO_COMMA = 'a data URI needs a comma before the data';
export const NO_SRC = 'an <img> tag needs a src attribute with the image data';
export const ADDRESS =
  'This is an address, not image data: this tool never fetches anything. Save the image and choose it in Encode, or paste its data URI or Base64.';

const isAsciiWhite = (c: number): boolean => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;

/** Line and column (1-based, UTF-16) of an offset, lines split at `\n` — as the shared reader counts them. */
export const placeOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
};

const WELL_FORMED = /^[A-Za-z0-9+/_-]*={0,2}$/;

/** Base64 of either alphabet to bytes: `atob` when the text is plainly well-formed, the shared reader otherwise. */
export const decodeBase64 = (text: string): ParseBase64Result => {
  const compact = text.replace(/[\t\n\f\r ]+/g, '');
  if (WELL_FORMED.test(compact) && compact.length % 4 !== 1) {
    const standard = /[-_]/.test(compact) ? compact.replace(/-/g, '+').replace(/_/g, '/') : compact;
    try {
      const binary = atob(standard);
      const bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
      return { ok: true, bytes };
    } catch {
      // Padding in a place atob refuses: the shared reader says where.
    }
  }
  return parseBase64(text);
};

/** The URL standard's percent-decode over the UTF-8 bytes of the text (non-ASCII characters are UTF-8 first). */
export const percentDecode = (text: string): Uint8Array => {
  const input = new TextEncoder().encode(text);
  const out = new Uint8Array(input.length);
  const hex = (b: number): number =>
    b >= 0x30 && b <= 0x39 ? b - 0x30 : b >= 0x41 && b <= 0x46 ? b - 0x37 : b >= 0x61 && b <= 0x66 ? b - 0x57 : -1;
  let n = 0;
  for (let i = 0; i < input.length; i++) {
    const b = input[i]!;
    if (b === 0x25 && i + 2 < input.length) {
      const high = hex(input[i + 1]!);
      const low = hex(input[i + 2]!);
      if (high >= 0 && low >= 0) {
        out[n++] = (high << 4) | low;
        i += 2;
        continue;
      }
    }
    out[n++] = b;
  }
  return out.subarray(0, n);
};

/** Bytes as a string of the same code units (the Infra standard's isomorphic decode). */
const isomorphicDecode = (bytes: Uint8Array): string => {
  const parts: string[] = [];
  for (let i = 0; i < bytes.length; i += 8192)
    parts.push(String.fromCharCode(...bytes.subarray(i, Math.min(i + 8192, bytes.length))));
  return parts.join('');
};

/** A Base64 error at `offset` of the whole input, or without a place. */
const failure = (input: string, error: Base64Error, base: number | null): ParsedInput =>
  base === null
    ? { ok: false, error: { message: error.message } }
    : {
        ok: false,
        error: { message: error.message, offset: base + error.offset, ...placeOf(input, base + error.offset) },
      };

/** The value a CSS `url(…)` holds (quoted or not), and where it starts; null when the text is not one. */
const urlValue = (text: string, start: number): { value: string; at: number } | null => {
  const m = /^(?:[a-z-]+\s*:\s*)?url\(/i.exec(text.slice(start, start + 64));
  if (!m) return null;
  let i = start + m[0].length;
  while (i < text.length && isAsciiWhite(text.charCodeAt(i))) i++;
  const quote = text[i];
  if (quote === '"' || quote === "'") {
    const end = text.indexOf(quote, i + 1);
    return { value: text.slice(i + 1, end < 0 ? text.length : end), at: i + 1 };
  }
  const end = text.indexOf(')', i);
  return { value: text.slice(i, end < 0 ? text.length : end).trimEnd(), at: i };
};

/** The `src` of an `<img …>` tag (quoted or not), and where it starts. */
const srcValue = (text: string, start: number): { value: string; at: number } | null => {
  const m = /\ssrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>"']+))/i.exec(text.slice(start));
  if (!m) return null;
  const value = m[1] ?? m[2] ?? m[3] ?? '';
  const quoted = m[3] === undefined ? 1 : 0;
  return { value, at: start + m.index + m[0].length - value.length - quoted };
};

/**
 * An address by its scheme (Base64 has no `:`). A network-path reference (`//host/a.png`) is told by what follows:
 * `//79` is valid Base64 (bytes ff fe fd) and is decoded; `//` followed by what is not Base64 is an address.
 */
const ADDRESS_START = /^(?:https?:|ftp:|file:|blob:|chrome-extension:)/i;

/** A data: URI at `at` of the input, by the Fetch standard's «data: URL processor» (§5 step 2). */
const dataUri = (input: string, uri: string, at: number, shape: InputShape): ParsedInput => {
  const comma = uri.indexOf(',');
  if (comma < 0) return { ok: false, error: { message: NO_COMMA } };
  // Tabs and line breaks in the type are dropped (the URL standard); the type is stripped of white space at its ends.
  let meta = uri
    .slice(5, comma)
    .replace(/[\t\n\r]/g, '')
    .replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/g, '');
  const base64 = /;[ ]*base64$/i.exec(meta);
  if (base64) meta = meta.slice(0, base64.index);
  const declaredMime = meta.split(';')[0]!.trim().toLowerCase() || null;
  const body = uri.slice(comma + 1);
  // A body that is not Base64 keeps its tabs and line breaks, as Chrome's own data: URL loader does (§15): an SVG
  // pasted with a line break between two attributes stays well-formed.
  if (!base64) return { ok: true, bytes: percentDecode(body), declaredMime, shape };
  const escaped = body.includes('%');
  const text = escaped ? isomorphicDecode(percentDecode(body.replace(/[\t\n\r]/g, ''))) : body;
  const parsed = decodeBase64(text);
  if (!parsed.ok) return failure(input, parsed.error, escaped ? null : at + comma + 1);
  return { ok: true, bytes: parsed.bytes, declaredMime, shape };
};

/**
 * The bytes Decode's input holds, the type a data: URI declared and how the input was written; empty bytes for an
 * empty input (or an empty body). Errors: a data: URI without a comma, Base64 that is not (with its place), an address.
 */
export const parseImageInput = (input: string): ParsedInput => {
  let start = 0;
  let end = input.length;
  while (start < end && /\s/.test(input[start]!)) start++;
  while (end > start && /\s/.test(input[end - 1]!)) end--;
  if (start === end) return { ok: true, bytes: new Uint8Array(0), declaredMime: null, shape: 'base64' };

  let value = input.slice(start, end);
  let at = start;
  let shape: InputShape = 'base64';
  if (/^<img[\s>/]/i.test(value)) {
    const src = srcValue(input.slice(0, end), start);
    if (!src) return { ok: false, error: { message: NO_SRC } };
    ({ value, at } = src);
    shape = 'img';
  } else {
    const url = urlValue(input.slice(0, end), start);
    if (url) {
      ({ value, at } = url);
      shape = 'css';
    }
  }
  // Inside a wrapper, white space at the value's ends goes too.
  const lead = value.length - value.trimStart().length;
  value = value.trim();
  at += lead;

  if (ADDRESS_START.test(value)) return { ok: false, error: { message: ADDRESS } };
  if (/^data:/i.test(value)) return dataUri(input, value, at, shape === 'base64' ? 'data-uri' : shape);
  const parsed = decodeBase64(value);
  if (!parsed.ok)
    return value.startsWith('//') ? { ok: false, error: { message: ADDRESS } } : failure(input, parsed.error, at);
  return { ok: true, bytes: parsed.bytes, declaredMime: null, shape };
};
