/** The formats, how they are recognised by their first bytes and named (docs/tools/specs/compress.md §5.1, §5.2, §5.10). */

export type Format = 'gzip' | 'zlib' | 'deflate-raw' | 'zstd' | 'brotli';
export type FormatChoice = Format | 'auto';
export type Direction = 'decompress' | 'compress';
export type DecompressInput = 'base64' | 'hex' | 'file';
export type CompressInput = 'text' | 'hex' | 'base64' | 'file';
export type InputKind = DecompressInput | CompressInput;
/** How Decompress shows its result. */
export type ResultView = 'text' | 'hex' | 'base64';
/** How Compress shows its result. */
export type OutputEncoding = 'base64' | 'base64url' | 'hex';

export const FORMATS: readonly Format[] = ['gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'];

export const FORMAT_LABELS: Readonly<Record<FormatChoice, string>> = {
  auto: 'Auto — from the first bytes',
  gzip: 'gzip',
  zlib: 'zlib',
  'deflate-raw': 'Raw deflate',
  zstd: 'zstd',
  brotli: 'brotli',
};

/** What the facts line says about a recognised format. */
export const SIGNATURES: Readonly<Record<Format, string>> = {
  gzip: '1f 8b',
  zlib: 'its zlib header',
  'deflate-raw': '',
  zstd: '28 b5 2f fd',
  brotli: '',
};

/** The extension a compressed file gets (§5.10). */
export const EXTENSIONS: Readonly<Record<Format, string>> = {
  gzip: '.gz',
  zlib: '.zz',
  'deflate-raw': '.deflate',
  zstd: '.zst',
  brotli: '.br',
};

const STRIPPED = ['.gz', '.gzip', '.tgz', '.z', '.zz', '.zlib', '.deflate', '.zst', '.zstd', '.br'];

/** RFC 1950 §2.2: deflate (CM 8), a window of at most 32 KiB (CINFO ≤ 7), and the check bits. */
export const isZlibHeader = (cmf: number, flg: number): boolean =>
  (cmf & 0x0f) === 8 && cmf >> 4 <= 7 && ((cmf << 8) | flg) % 31 === 0;

/** §5.2: gzip, zstd (a frame or a skippable frame), zlib — in this order — or null. */
export const recogniseFormat = (head: Uint8Array): Format | null => {
  if (head.length >= 2 && head[0] === 0x1f && head[1] === 0x8b) return 'gzip';
  if (head.length >= 4 && head[0] === 0x28 && head[1] === 0xb5 && head[2] === 0x2f && head[3] === 0xfd) return 'zstd';
  if (head.length >= 4 && (head[0]! & 0xf0) === 0x50 && head[1] === 0x2a && head[2] === 0x4d && head[3] === 0x18)
    return 'zstd';
  if (head.length >= 2 && isZlibHeader(head[0]!, head[1]!)) return 'zlib';
  return null;
};

/** §5.10: the name Save suggests for a decompressed result. */
export const decompressedName = (fileName: string | null, headerName: string | undefined, text: boolean): string => {
  const fromHeader = headerName?.split(/[/\\]/).pop();
  if (fromHeader) return fromHeader;
  if (fileName) {
    const lower = fileName.toLowerCase();
    const ext = STRIPPED.find(e => lower.endsWith(e) && lower.length > e.length);
    if (ext === '.tgz') return `${fileName.slice(0, -4)}.tar`;
    if (ext) return fileName.slice(0, -ext.length);
  }
  return text ? 'decompressed.txt' : 'decompressed.bin';
};

/** §5.10: the name Save suggests for a compressed result. */
export const compressedName = (fileName: string | null, format: Format, input: CompressInput): string =>
  `${fileName ?? (input === 'text' ? 'text' : 'data')}${EXTENSIONS[format]}`;
