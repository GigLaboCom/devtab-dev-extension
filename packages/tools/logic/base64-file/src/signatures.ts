/**
 * Binary formats by their first bytes (docs/tools/specs/base64-file.md §5.2, «Двоичные сигнатуры»), and whether the
 * first bytes are text. No JSON scanner and no DER reader here: `detect` imports this module and stays light.
 *
 * A signature made only of printable characters (`%PDF-`, `GIF8`, `BM`, `RIFF`, `OTTO`, `true`, `wOFF`, `BZh`…) counts only
 * when the bytes are not text: text that happens to start with those letters is text (§5.2 п. 3).
 */
import type { TypeId } from './types';

export type TextEncoding = 'utf-8' | 'utf-16le' | 'utf-16be';

/** The bytes the tool looks at: the head (first 64 KiB), the size, and when known the tail and the ZIP directory. */
export interface ByteSample {
  size: number;
  head: Uint8Array;
  /** The last bytes (up to TAIL_BYTES): the end of a PDF, the end record of a ZIP. Absent when the head is the whole. */
  tail?: Uint8Array;
  /** The central directory of a ZIP, when the tail pointed at one (up to DIRECTORY_MAX_BYTES). */
  directory?: Uint8Array;
  /** All the bytes, when small enough to be read whole (DER, JSON): up to WHOLE_MAX_BYTES. */
  whole?: Uint8Array;
}

export const HEAD_BYTES = 64 * 1024;
/** An end-of-central-directory record is 22 bytes and may be followed by a comment of up to 65,535. */
export const TAIL_BYTES = 22 + 65_535;
export const DIRECTORY_MAX_BYTES = 1024 * 1024;
export const DIRECTORY_MAX_ENTRIES = 10_000;
/** DER and JSON are checked whole up to this size; above it neither is claimed (JSON is then plain text). */
export const WHOLE_MAX_BYTES = 4 * 1024 * 1024;

const ascii = (bytes: Uint8Array, at: number, text: string): boolean => {
  if (at + text.length > bytes.length) return false;
  for (let i = 0; i < text.length; i++) if (bytes[at + i] !== text.charCodeAt(i)) return false;
  return true;
};
const hex = (bytes: Uint8Array, at: number, values: readonly number[]): boolean =>
  at + values.length <= bytes.length && values.every((v, i) => bytes[at + i] === v);
const u16le = (b: Uint8Array, at: number): number => (at + 2 <= b.length ? b[at]! | (b[at + 1]! << 8) : -1);
const u16be = (b: Uint8Array, at: number): number => (at + 2 <= b.length ? (b[at]! << 8) | b[at + 1]! : -1);
const u32le = (b: Uint8Array, at: number): number =>
  at + 4 <= b.length ? (b[at]! | (b[at + 1]! << 8) | (b[at + 2]! << 16) | (b[at + 3]! << 24)) >>> 0 : -1;
const u32be = (b: Uint8Array, at: number): number =>
  at + 4 <= b.length ? ((b[at]! << 24) | (b[at + 1]! << 16) | (b[at + 2]! << 8) | b[at + 3]!) >>> 0 : -1;
const latin1 = (b: Uint8Array, from: number, to: number): string => {
  let s = '';
  for (let i = from; i < Math.min(to, b.length); i++) s += String.fromCharCode(b[i]!);
  return s;
};

export { ascii, latin1, u16be, u16le, u32be, u32le };

/**
 * Is the head text (§5.2 п. 2)? Strict UTF-8 (RFC 3629 table: no overlong forms, no surrogates, nothing above
 * U+10FFFF), a sequence cut by the end of the head allowed when the file goes on; no C0 control except TAB, LF, FF, CR,
 * and no DEL; a UTF-8 byte order mark allowed. `FF FE` / `FE FF` with an even size: UTF-16, not looked at further.
 */
export const textEncodingOf = (head: Uint8Array, size: number): TextEncoding | null => {
  if (head.length === 0) return null;
  if (size % 2 === 0 && head.length >= 2) {
    if (head[0] === 0xff && head[1] === 0xfe) return 'utf-16le';
    if (head[0] === 0xfe && head[1] === 0xff) return 'utf-16be';
  }
  const complete = head.length >= size;
  const n = head.length;
  let i = hex(head, 0, [0xef, 0xbb, 0xbf]) ? 3 : 0;
  while (i < n) {
    const b = head[i]!;
    if (b < 0x80) {
      if ((b < 0x20 && b !== 9 && b !== 10 && b !== 12 && b !== 13) || b === 0x7f) return null;
      i++;
      continue;
    }
    let len: number;
    let lo = 0x80;
    let hi = 0xbf;
    if (b >= 0xc2 && b <= 0xdf) len = 2;
    else if (b >= 0xe0 && b <= 0xef) {
      len = 3;
      if (b === 0xe0) lo = 0xa0;
      else if (b === 0xed) hi = 0x9f;
    } else if (b >= 0xf0 && b <= 0xf4) {
      len = 4;
      if (b === 0xf0) lo = 0x90;
      else if (b === 0xf4) hi = 0x8f;
    } else return null;
    for (let k = 1; k < len; k++) {
      if (i + k >= n) return complete ? null : 'utf-8';
      const c = head[i + k]!;
      if (k === 1 ? c < lo || c > hi : c < 0x80 || c > 0xbf) return null;
    }
    i += len;
  }
  return 'utf-8';
};

/** ISO base media `ftyp` brands → AVIF, HEIF, MP4 audio, QuickTime or MP4 (§5.2 table: avif, heic, mp4). */
const ftypType = (head: Uint8Array): TypeId | null => {
  if (!ascii(head, 4, 'ftyp')) return null;
  const boxSize = u32be(head, 0);
  if (boxSize < 16 || boxSize > 4096) return null;
  const major = latin1(head, 8, 12);
  const brands: string[] = [];
  for (let at = 16; at + 4 <= Math.min(boxSize, head.length); at += 4) brands.push(latin1(head, at, at + 4));
  if (major === 'avif' || major === 'avis') return 'avif';
  if ((major === 'mif1' || major === 'msf1') && (brands.includes('avif') || brands.includes('avis'))) return 'avif';
  if (['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'hevm', 'hevs', 'mif1', 'msf1'].includes(major)) return 'heic';
  if (major === 'M4A ' || major === 'M4B ') return 'm4a';
  if (major === 'qt  ') return 'mov';
  return 'mp4';
};

/** Matroska / WebM: the EBML header's DocType (element 0x4282) within the first 4 KiB. */
const ebmlType = (head: Uint8Array): TypeId | null => {
  if (!hex(head, 0, [0x1a, 0x45, 0xdf, 0xa3])) return null;
  const end = Math.min(head.length, 4096);
  for (let i = 4; i + 3 < end; i++) {
    if (head[i] !== 0x42 || head[i + 1] !== 0x82) continue;
    const sizeByte = head[i + 2]!;
    if ((sizeByte & 0x80) === 0) continue;
    const length = sizeByte & 0x7f;
    const docType = latin1(head, i + 3, i + 3 + length);
    if (docType === 'webm') return 'webm';
    if (docType === 'matroska') return 'mkv';
  }
  return null;
};

/** The sfnt table directory fits the file and its first tag is four printable characters (§5.2: ttf, otf). */
const sfnt = (head: Uint8Array, size: number): boolean => {
  const tables = u16be(head, 4);
  if (tables < 1 || tables > 512 || 12 + 16 * tables > size) return false;
  if (head.length < 16) return true;
  for (let i = 12; i < 16; i++) if (head[i]! < 0x20 || head[i]! > 0x7e) return false;
  return true;
};

/** A ustar header's checksum (bytes 148–155, octal): the sum of the 512 header bytes with those eight as spaces. */
const tarChecksum = (head: Uint8Array): boolean => {
  if (head.length < 512) return false;
  const field = latin1(head, 148, 156)
    .replace(/[\0 ]+$/, '')
    .trim();
  if (!/^[0-7]+$/.test(field)) return false;
  let sum = 0;
  for (let i = 0; i < 512; i++) sum += i >= 148 && i < 156 ? 32 : head[i]!;
  return sum === parseInt(field, 8);
};

interface Signature {
  /** Only printable characters: counts only when the bytes are not text. */
  printable: boolean;
  test: (head: Uint8Array, size: number) => TypeId | null;
}

const BMP_HEADERS = new Set([12, 40, 52, 56, 64, 108, 124]);

/**
 * In the order of the specification's table; the first that matches decides. PDF is looked at by `recogniseBytes`
 * itself (a PDF may be all text) and the ZIP family is narrowed there (it needs the directory).
 */
const SIGNATURES: readonly Signature[] = [
  {
    printable: false,
    test: h => (hex(h, 0, [0x50, 0x4b, 0x03, 0x04]) || hex(h, 0, [0x50, 0x4b, 0x05, 0x06]) ? 'zip' : null),
  },
  {
    printable: false,
    test: h => (hex(h, 0, [0x1f, 0x8b, 0x08]) && h.length > 3 && (h[3]! & 0xe0) === 0 ? 'gzip' : null),
  },
  {
    printable: true,
    test: h =>
      ascii(h, 0, 'BZh') &&
      h[3]! >= 0x31 &&
      h[3]! <= 0x39 &&
      (hex(h, 4, [0x31, 0x41, 0x59, 0x26, 0x53, 0x59]) || hex(h, 4, [0x17, 0x72, 0x45, 0x38, 0x50, 0x90]))
        ? 'bzip2'
        : null,
  },
  { printable: false, test: h => (hex(h, 0, [0xfd, 0x37, 0x7a, 0x58, 0x5a, 0x00]) ? 'xz' : null) },
  { printable: false, test: h => (hex(h, 0, [0x28, 0xb5, 0x2f, 0xfd]) ? 'zstd' : null) },
  { printable: false, test: h => (hex(h, 0, [0x37, 0x7a, 0xbc, 0xaf, 0x27, 0x1c]) ? '7z' : null) },
  {
    printable: false,
    test: h => ((ascii(h, 257, 'ustar\0') || ascii(h, 257, 'ustar  \0')) && tarChecksum(h) ? 'tar' : null),
  },
  { printable: false, test: h => (hex(h, 0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]) ? 'png' : null) },
  { printable: false, test: h => (hex(h, 0, [0xff, 0xd8, 0xff]) ? 'jpeg' : null) },
  { printable: true, test: h => (ascii(h, 0, 'GIF87a') || ascii(h, 0, 'GIF89a') ? 'gif' : null) },
  { printable: true, test: h => (ascii(h, 0, 'RIFF') && ascii(h, 8, 'WEBPVP') ? 'webp' : null) },
  { printable: false, test: ftypType },
  { printable: true, test: h => (ascii(h, 0, 'BM') && BMP_HEADERS.has(u32le(h, 14)) ? 'bmp' : null) },
  {
    printable: false,
    test: h => ((hex(h, 0, [0, 0, 1, 0]) || hex(h, 0, [0, 0, 2, 0])) && u16le(h, 4) > 0 ? 'ico' : null),
  },
  {
    printable: false,
    test: h => (hex(h, 0, [0x49, 0x49, 0x2a, 0x00]) || hex(h, 0, [0x4d, 0x4d, 0x00, 0x2a]) ? 'tiff' : null),
  },
  { printable: true, test: h => (ascii(h, 0, 'wOFF') ? 'woff' : null) },
  { printable: true, test: h => (ascii(h, 0, 'wOF2') ? 'woff2' : null) },
  { printable: false, test: (h, size) => (hex(h, 0, [0, 1, 0, 0]) && sfnt(h, size) ? 'ttf' : null) },
  { printable: true, test: (h, size) => (ascii(h, 0, 'true') && sfnt(h, size) ? 'ttf' : null) },
  { printable: true, test: (h, size) => (ascii(h, 0, 'OTTO') && sfnt(h, size) ? 'otf' : null) },
  { printable: true, test: h => (ascii(h, 0, 'ttcf') && [1, 2].includes(u16be(h, 4)) ? 'ttc' : null) },
  { printable: false, test: h => (hex(h, 0, [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00]) ? 'wasm' : null) },
  { printable: false, test: h => (ascii(h, 0, 'SQLite format 3\0') ? 'sqlite' : null) },
  { printable: true, test: h => (ascii(h, 0, 'ID3') && h[3]! >= 2 && h[3]! <= 4 ? 'mp3' : null) },
  { printable: false, test: h => (ascii(h, 0, 'OggS\0') ? 'ogg' : null) },
  { printable: true, test: h => (ascii(h, 0, 'RIFF') && ascii(h, 8, 'WAVE') ? 'wav' : null) },
  { printable: true, test: h => (ascii(h, 0, 'fLaC') ? 'flac' : null) },
  { printable: false, test: ebmlType },
  { printable: false, test: h => (ascii(h, 0, 'openssh-key-v1\0') ? 'openssh-private' : null) },
  {
    printable: false,
    test: (h, size) => {
      const length = u32be(h, 0);
      if (length < 7 || length > 64 || 4 + length + 4 > size || 4 + length > h.length) return null;
      return /^(?:ssh-|ecdsa-sha2-|sk-ssh-|sk-ecdsa-)[a-z0-9@.-]+$/.test(latin1(h, 4, 4 + length))
        ? 'ssh-public'
        : null;
    },
  },
];

/** `%PDF-` with a version `d.d` (ISO 32000-2 §7.5.2). */
export const pdfHeader = (head: Uint8Array): boolean =>
  ascii(head, 0, '%PDF-') &&
  head.length >= 8 &&
  head[5]! >= 0x30 &&
  head[5]! <= 0x39 &&
  head[6] === 0x2e &&
  head[7]! >= 0x30 &&
  head[7]! <= 0x39;

/**
 * The binary format the first bytes name, or null. `text`: the head is text — then a printable signature does not count
 * (`startsLike` tells which one it would have been). PDF is not here (see `pdfHeader`).
 */
export const binarySignature = (
  head: Uint8Array,
  size: number,
  text: boolean,
): { id: TypeId | null; startsLike: TypeId | null } => {
  let startsLike: TypeId | null = null;
  for (const s of SIGNATURES) {
    const id = s.test(head, size);
    if (!id) continue;
    if (s.printable && text) {
      startsLike ??= id;
      continue;
    }
    return { id, startsLike };
  }
  return { id: null, startsLike };
};
