/** The tool's limits (docs/tools/specs/compress.md §5.8, §12); the component checks sizes, the work enforces the output. */

/** Characters of the text field (Text, Hex, Base64): larger is refused — a file has no limit. */
export const MAX_TEXT_INPUT = 16 * 1024 * 1024;
/** Characters: the result follows every change up to this; above, SETTLE_MS after the last change. */
export const LIVE_INPUT = 256 * 1024;
export const SETTLE_MS = 300;
/** Bytes of decompressed output: past this the work stops (a decompression bomb, or data too large for the tool). */
export const MAX_OUTPUT = 1024 * 1024 * 1024;
/** Bytes of a result the page keeps: Copy and Save use them; a larger result is counted, not kept, and Save makes it again. */
export const HOLD_BYTES = 64 * 1024 * 1024;
/** A result up to this many bytes is shown and copied; a larger one is previewed and saved. */
export const SHOW_BYTES = 1024 * 1024;
/**
 * What each view shows in full: about a million characters in the field — more is slow to lay out (1 MiB in spaced hex,
 * 3 Mi characters, held the page for 0.4 s). Text: 1 MiB; Base64: 768 KiB (1 Mi characters); spaced hex (three
 * characters a byte): 256 KiB; plain hex (two): 512 KiB.
 */
export const SHOW_LIMITS: Readonly<Record<'text' | 'base64' | 'base64url' | 'hex' | 'plain-hex', number>> = {
  text: SHOW_BYTES,
  base64: 768 * 1024,
  base64url: 768 * 1024,
  hex: 256 * 1024,
  'plain-hex': 512 * 1024,
};
/** The preview of a result too large to show. */
export const PREVIEW_BYTES = 4096;
/** A file is read this much at a time (slice().arrayBuffer(), as the hash tool measured). */
export const CHUNK_BYTES = 1024 * 1024;
/** Brotli compression takes the whole input at once (the library has no stream). */
export const BROTLI_COMPRESS_MAX = 16 * 1024 * 1024;
/** Bytes of an input the history keeps; a larger input is not recorded at all. */
export const MAX_KEPT_INPUT = 1024 * 1024;
/** A job that has run this long shows its progress and Cancel. */
export const PROGRESS_AFTER_MS = 300;

export const ZSTD_LEVELS: readonly number[] = Array.from({ length: 19 }, (_, i) => i + 1);
export const DEFAULT_ZSTD_LEVEL = 3;
export const BROTLI_QUALITIES: readonly number[] = Array.from({ length: 12 }, (_, i) => i);
export const DEFAULT_BROTLI_QUALITY = 11;
