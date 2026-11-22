/**
 * The gzip member header (RFC 1952 §2.3): read to show its fields as data and to check it before the browser sees the
 * stream; written when Compress keeps a file's name and time (docs/tools/specs/compress.md §5.4, §5.5).
 */
import { GZIP_HEADER_CUT, NOT_GZIP, gzipFlags, gzipMethod } from './messages';
import { formatIsoUtc } from '@workspace/tools-shared/time';

export interface GzipHeader {
  /** FNAME and FCOMMENT as text (UTF-8 when valid, else ISO 8859-1). */
  name?: string;
  comment?: string;
  /** Seconds since 1970, 0 when not set. */
  mtime: number;
  os: number;
  xfl: number;
  /** FEXTRA's length, when present. */
  extraBytes?: number;
  headerCrc: boolean;
  /** Bytes the header takes, from the magic to the first byte of deflate data. */
  length: number;
}

export type HeaderResult = { ok: true; header: GzipHeader } | { ok: false; message: string } | { ok: 'more' };

const FHCRC = 2;
const FEXTRA = 4;
const FNAME = 8;
const FCOMMENT = 16;

const UTF8 = new TextDecoder('utf-8', { fatal: true });

/** A zero-terminated field's bytes as text: UTF-8 when valid (what gzip writes today), else ISO 8859-1 (RFC 1952). */
export const fieldText = (bytes: Uint8Array): string => {
  try {
    return UTF8.decode(bytes);
  } catch {
    return String.fromCharCode(...bytes);
  }
};

/**
 * Reads the header at the start of `bytes`. `more` when `bytes` ends inside it and `final` is false; with `final`,
 * an incomplete header is the error of §6.
 */
export const readGzipHeader = (bytes: Uint8Array, final = true): HeaderResult => {
  const cut: HeaderResult = final ? { ok: false, message: GZIP_HEADER_CUT } : { ok: 'more' };
  if (bytes.length >= 1 && bytes[0] !== 0x1f) return { ok: false, message: NOT_GZIP };
  if (bytes.length >= 2 && bytes[1] !== 0x8b) return { ok: false, message: NOT_GZIP };
  if (bytes.length < 10) return bytes.length < 2 && final ? { ok: false, message: NOT_GZIP } : cut;
  const cm = bytes[2]!;
  const flg = bytes[3]!;
  if (cm !== 8) return { ok: false, message: gzipMethod(cm) };
  if (flg & 0xe0) return { ok: false, message: gzipFlags(flg) };
  const header: GzipHeader = {
    mtime: (bytes[4]! | (bytes[5]! << 8) | (bytes[6]! << 16) | (bytes[7]! << 24)) >>> 0,
    xfl: bytes[8]!,
    os: bytes[9]!,
    headerCrc: (flg & FHCRC) !== 0,
    length: 10,
  };
  let at = 10;
  if (flg & FEXTRA) {
    if (at + 2 > bytes.length) return cut;
    const xlen = bytes[at]! | (bytes[at + 1]! << 8);
    at += 2 + xlen;
    if (at > bytes.length) return cut;
    header.extraBytes = xlen;
  }
  const zeroTerminated = (): string | null => {
    const end = bytes.indexOf(0, at);
    if (end === -1) return null;
    const text = fieldText(bytes.subarray(at, end));
    at = end + 1;
    return text;
  };
  if (flg & FNAME) {
    const name = zeroTerminated();
    if (name === null) return cut;
    header.name = name;
  }
  if (flg & FCOMMENT) {
    const comment = zeroTerminated();
    if (comment === null) return cut;
    header.comment = comment;
  }
  if (flg & FHCRC) at += 2;
  if (at > bytes.length) return cut;
  header.length = at;
  return { ok: true, header };
};

/** RFC 1952 §2.3.1 OS values, and 19 — what zlib writes on macOS. */
const OS_NAMES: Readonly<Record<number, string>> = {
  0: 'FAT',
  1: 'Amiga',
  2: 'VMS',
  3: 'Unix',
  4: 'VM/CMS',
  5: 'Atari TOS',
  6: 'HPFS',
  7: 'Macintosh',
  8: 'Z-System',
  9: 'CP/M',
  10: 'TOPS-20',
  11: 'NTFS',
  12: 'QDOS',
  13: 'Acorn RISCOS',
};

export const osName = (os: number): string =>
  os === 19 ? 'macOS (19, written by zlib)' : OS_NAMES[os] ? `${OS_NAMES[os]} (${os})` : `unknown (${os})`;

/** An invisible character of a name or comment is shown as U+XXXX: the field is data, not text to lay out. */
export const showField = (text: string): string =>
  text.replace(
    /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu,
    c => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`,
  );

/** §5.5: the rows the page shows, in order; fields that are absent are left out. */
export const headerRows = (h: GzipHeader): Array<{ label: string; value: string }> => {
  const rows: Array<{ label: string; value: string }> = [];
  if (h.name !== undefined) rows.push({ label: 'Name', value: showField(h.name) });
  rows.push({ label: 'Modified', value: h.mtime === 0 ? 'not set' : formatIsoUtc(BigInt(h.mtime) * 1_000_000_000n) });
  if (h.comment !== undefined) rows.push({ label: 'Comment', value: showField(h.comment) });
  rows.push({ label: 'Operating system', value: osName(h.os) });
  if (h.xfl !== 0)
    rows.push({
      label: 'Extra flags',
      value: h.xfl === 2 ? 'maximum compression (2)' : h.xfl === 4 ? 'fastest (4)' : String(h.xfl),
    });
  if (h.extraBytes !== undefined)
    rows.push({ label: 'Extra field', value: h.extraBytes === 1 ? '1 byte' : `${h.extraBytes} bytes` });
  if (h.headerCrc) rows.push({ label: 'Header CRC', value: 'present' });
  return rows;
};

/** What Compress writes for a gzip header: OS 255 always (§5.4); FNAME (UTF-8) and MTIME when the file's are kept. */
export const UNKNOWN_OS = 255;
export const gzipHeaderBytes = (keep?: { name: string; mtime: number }): Uint8Array => {
  const name = keep ? new TextEncoder().encode(keep.name.replace(/\0/g, '')) : new Uint8Array(0);
  const out = new Uint8Array(10 + (keep ? name.length + 1 : 0));
  const mtime = keep ? Math.max(0, Math.min(0xffffffff, Math.floor(keep.mtime))) : 0;
  out.set([
    0x1f,
    0x8b,
    8,
    keep ? FNAME : 0,
    mtime & 0xff,
    (mtime >>> 8) & 0xff,
    (mtime >>> 16) & 0xff,
    mtime >>> 24,
    0,
    UNKNOWN_OS,
  ]);
  if (keep) out.set(name, 10);
  return out;
};
