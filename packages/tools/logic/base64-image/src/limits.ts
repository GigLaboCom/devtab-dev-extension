/** The tool's limits (docs/tools/specs/base64-image.md §12): numbers only, so `detect` takes them without the logic. */

/** A file larger than this is refused before it is read (§12). */
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
/** Decode's input larger than this is refused without parsing; a paste of it never reaches the field (§12). */
export const MAX_INPUT_CHARS = 14 * 1024 * 1024;
/** What a long output shows of itself (§12). */
export const SHOWN_OUTPUT_CHARS = 65_536;
/** An output longer than this is shown cut to SHOWN_OUTPUT_CHARS; Copy and Save take it all (§12). */
export const TRUNCATE_OUTPUT_ABOVE = 1024 * 1024;
/** Decode follows every edit up to this many characters, and 300 ms after the last one above (§12). */
export const LIVE_INPUT_CHARS = 1024 * 1024;
export const SETTLE_MS = 300;
/** Pixels (width × height, as the header claims them) a preview or Copy image may decode (§15). */
export const MAX_PREVIEW_PIXELS = 100_000_000;
