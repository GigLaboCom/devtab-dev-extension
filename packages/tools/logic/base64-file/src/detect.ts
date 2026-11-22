/**
 * `detectBase64File` (docs/tools/specs/base64-file.md §7), in a module of its own: the ui package's `./detect`
 * re-exports it and a host loads every tool's `detect` together, lazily. Two cases, both strict and linear:
 *
 * 1. a data: URI whose declared type is not an image (`data:image/…` is Base64 Image's, № 27) — with a comma in its
 *    first 1,024 characters and something after it;
 * 2. bare Base64 (16 characters to 16 Mi, either alphabet, `=` only at the end, ASCII white space between) whose first
 *    bytes are a binary format that is neither an image nor text — or a DER certificate, request, CRL or key, when the
 *    text is short enough (64 Ki) to decode whole. Base64 of text is the Base64 tool's (№ 2), of images Base64 Image's;
 *    TIFF and HEIF are here, because Base64 Image refuses them.
 */
import { derForm } from './derForms';
import { binarySignature, pdfHeader, textEncodingOf } from './signatures';
import { parseBase64 } from '@workspace/tools-shared/base64';
import type { TypeId } from './types';

const DETECT_MAX_CHARS = 16 * 1024 * 1024;
const DER_MAX_CHARS = 64 * 1024;
const META_MAX = 1024;

const CLAIMED = new Set<TypeId>([
  'zip',
  'gzip',
  'bzip2',
  'xz',
  'zstd',
  '7z',
  'tar',
  'tiff',
  'heic',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'ttc',
  'wasm',
  'sqlite',
  'mp3',
  'ogg',
  'wav',
  'flac',
  'mp4',
  'm4a',
  'mov',
  'webm',
  'mkv',
  'openssh-private',
  'ssh-public',
]);

const isWhite = (c: number): boolean => c === 9 || c === 10 || c === 12 || c === 13 || c === 32;
const isAlphabet = (c: number): boolean =>
  (c >= 0x41 && c <= 0x5a) ||
  (c >= 0x61 && c <= 0x7a) ||
  (c >= 0x30 && c <= 0x39) ||
  c === 0x2b ||
  c === 0x2f ||
  c === 0x2d ||
  c === 0x5f;

const MIME = /^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i;

const dataUri = (t: string): boolean => {
  const comma = t.indexOf(',');
  if (comma < 0 || comma > 5 + META_MAX || comma === t.length - 1) return false;
  const meta = t
    .slice(5, comma)
    .replace(/;[ ]*base64$/i, '')
    .trim();
  const type = meta.split(';')[0]!.trim();
  if (type && !MIME.test(type)) return false;
  return !/^image\//i.test(type);
};

/** Bare Base64 only: the alphabets, ASCII white space, `=` only at the end. */
const base64Only = (t: string): boolean => {
  let padding = false;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    if (isWhite(c)) continue;
    if (c === 0x3d) padding = true;
    else if (padding || !isAlphabet(c)) return false;
  }
  return true;
};

/** The first `count` non-white characters (a multiple of 4), as a string. */
const firstChars = (t: string, count: number): string => {
  let out = '';
  for (let i = 0; i < t.length && out.length < count; i++) if (!isWhite(t.charCodeAt(i))) out += t[i];
  return out.slice(0, out.length - (out.length % 4));
};

/** The last bytes of the Base64 (from a multiple of 4 non-white characters) contain `%%EOF`. */
const pdfTail = (t: string): boolean => {
  const compact = t.replace(/[\t\n\f\r ]+/g, '');
  const from = Math.max(0, compact.length - 1368);
  const tail = parseBase64(compact.slice(from - (from % 4)));
  return tail.ok && String.fromCharCode(...tail.bytes).includes('%%EOF');
};

export const detectBase64File = (text: string): boolean => {
  let start = 0;
  let end = text.length;
  while (start < end && isWhite(text.charCodeAt(start))) start++;
  while (end > start && isWhite(text.charCodeAt(end - 1))) end--;
  const t = text.slice(start, end);
  if (/^data:/i.test(t)) return dataUri(t);
  if (t.length < 16 || t.length > DETECT_MAX_CHARS || !base64Only(t)) return false;
  const head = parseBase64(firstChars(t, 64));
  if (!head.ok || head.bytes.length === 0) return false;
  const bytes = head.bytes;
  // A head this short is not judged as text by its last characters: a cut sequence is allowed.
  const isText = textEncodingOf(bytes, Number.MAX_SAFE_INTEGER) !== null;
  // A PDF whose start is text is a PDF when its end has `%%EOF` (§5.2 п. 3): the last 1,368 characters are decoded.
  if (pdfHeader(bytes)) return !isText || pdfTail(t);
  const { id } = binarySignature(bytes, Number.MAX_SAFE_INTEGER, isText);
  if (id) return CLAIMED.has(id);
  if (bytes[0] !== 0x30 || t.length > DER_MAX_CHARS) return false;
  const whole = parseBase64(t);
  if (!whole.ok) return false;
  const form = derForm(whole.bytes, whole.bytes.length);
  return form !== null && form !== 'der';
};
