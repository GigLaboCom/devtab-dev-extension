/** Every text of docs/tools/specs/compress.md §3, §5 and §6, word for word. */
import { formatCount, formatRatio, formatShortSize } from './sizes';
import type { Format } from './formats';

/** `Line L, column C: message` — as base64 and hex-ascii place their errors. */
export const placed = (e: { message: string; line: number; column: number }): string =>
  `Line ${e.line}, column ${e.column}: ${e.message}`;

export const BASE64_HINT = 'This looks like Base64: choose Base64.';
export const HEX_HINT = 'This looks like hex: choose Hex.';
export const NOT_RECOGNISED =
  'The format is not recognised: the data does not start like gzip (1f 8b), zlib (78 9c, 78 da, …) or zstd (28 b5 2f fd). Raw deflate and brotli have no signature: choose the format.';
export const EMPTY_FILE = 'The file is empty: there is nothing to decompress.';
export const NOT_GZIP = 'This is not gzip data: it does not start with 1f 8b.';
export const gzipMethod = (cm: number): string =>
  `This gzip member uses compression method ${cm}; only deflate (8) exists.`;
export const gzipFlags = (flg: number): string =>
  `The gzip header has reserved flag bits set (FLG 0x${flg.toString(16).padStart(2, '0')}): the data is damaged.`;
export const GZIP_HEADER_CUT = 'The data ends inside the gzip header.';
export const notZlib = (cmf: number, flg: number): string =>
  `This is not zlib data: the header check fails (CMF 0x${cmf.toString(16).padStart(2, '0')}, FLG 0x${flg.toString(16).padStart(2, '0')}).`;
export const zlibDictionary = (id: number): string =>
  `This zlib stream needs a preset dictionary (id 0x${id.toString(16).padStart(8, '0')}), which is not part of the data.`;
export const TRUNCATED = 'The data ends before the end of the compressed stream: it was cut off.';
export const GZIP_CRC = 'The CRC-32 in the gzip trailer does not match the data: the data is damaged.';
export const GZIP_LENGTH = 'The length in the gzip trailer does not match the data: the data is damaged.';
export const ZLIB_ADLER = 'The Adler-32 checksum at the end does not match the data: the data is damaged.';
export const damaged = (browserMessage: string): string =>
  `The compressed data is damaged: ${browserMessage.replace(/\.\s*$/, '')}.`;
export const NOT_ZSTD = 'This is not zstd data: it does not start with 28 b5 2f fd.';
export const ZSTD_TRUNCATED = 'The data ends before the end of the zstd frame: it was cut off.';
export const ZSTD_CHECKSUM = 'The checksum of the zstd frame does not match the data: the data is damaged.';
export const ZSTD_WINDOW =
  'This zstd frame needs a window over 128 MiB; the tool, like zstd without --memory, refuses it.';
export const zstdDamaged = (name: string): string => `The zstd data is damaged (${name}).`;
export const BROTLI_TRUNCATED = 'The data ends before the end of the brotli stream: it was cut off.';
export const notBrotli = (code: string): string => `This is not valid brotli data (${code}).`;
export const READ_FAILED = 'Could not read the file.';
export const CANCELLED = 'Cancelled.';
export const TEXT_TOO_LARGE = 'Input is larger than 16 MB. Use File for large inputs.';
export const BROTLI_TOO_LARGE =
  'Brotli compression works with up to 16 MiB: the encoder needs the whole input in memory.';
export const BROTLI_ENCODER_BROKE =
  'The brotli encoder failed on this input: its output did not decompress back to the input, so it is not shown. Try another quality.';
export const libraryFailed = (format: 'zstd' | 'brotli', side: 'decoder' | 'encoder'): string =>
  `The ${format} ${side} could not be loaded.`;
export const SAVE_NEEDS_FILES = 'Saving a result over 64 MiB needs a browser that can write files.';
export const NOT_SAVED = 'Not saved: the file could not be written.';

/** §5.8: the work stopped at the output limit. */
export const stoppedAt = (limit: number, input: number): string =>
  `Stopped at ${limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GiB` : formatShortSize(limit)} of output from ${formatCount(input)} bytes of input (ratio over ${formatRatio(limit, input)}): the tool decompresses at most ${limit >= 1024 ** 3 ? `${limit / 1024 ** 3} GiB` : formatShortSize(limit)}. This may be a decompression bomb.`;

/** §5.3, the notes after the result. */
export const gzipTrailing = (bytes: number, at: number): string =>
  `After the end of the gzip data: ${bytes === 1 ? '1 byte' : `${formatCount(bytes)} bytes`} at byte ${formatCount(at)} ${bytes === 1 ? 'is' : 'are'} not gzip and ${bytes === 1 ? 'was' : 'were'} ignored.`;
export const streamTrailing = (bytes: number, at: number): string =>
  `After the end of the compressed stream: ${bytes === 1 ? '1 byte' : `${formatCount(bytes)} bytes`} at byte ${formatCount(at)} ${bytes === 1 ? 'was' : 'were'} ignored.`;
export const gzipMembers = (n: number): string =>
  `${formatCount(n)} gzip members, decompressed one after another (as gunzip does).`;
export const alsoCompressed = (format: Format): string =>
  `The result is ${format === 'deflate-raw' ? 'deflate' : format} data too.`;

/** §5.6, about the result as text. */
export const BOM_NOTE = 'Starts with a byte order mark (U+FEFF).';
export const notUtf8 = (byte: number): string => `Not text: not valid UTF-8 from byte ${formatCount(byte)}.`;
export const nulByte = (byte: number): string => `Not text: a NUL byte at byte ${formatCount(byte)}.`;
export const controlsNote = (n: number): string =>
  n === 1
    ? '1 control character, shown as a symbol. Copy copies the real characters.'
    : `Contains ${formatCount(n)} control characters, shown as symbols. Copy copies the real characters.`;
export const TRAILING_NEWLINE = 'The text ends with a line break. It is part of the compressed bytes.';
export const EDGE_SPACE = 'The text starts or ends with a space. It is part of the compressed bytes.';
export const tooLargeToShow = (bytes: number): string =>
  `The result is ${formatShortSize(bytes)}: too large to show here. Save it as a file.`;
export const previewLabel = (shown: number): string => `First ${formatShortSize(shown)}:`;
export const NOT_KEPT = 'This input is over 1 MiB: it is not kept in the history.';
