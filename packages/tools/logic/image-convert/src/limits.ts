/**
 * The bounds of docs/tools/specs/image-convert.md §12 and where they come from: the canvas of Chrome for Testing 159
 * makes at most 65,535 px a side and 268,435,456 px in all (found by running, §5.1); the tool stays well under that so a
 * 50-megapixel photo and its canvas fit in a tab's memory.
 */

/** Files taken at once in Convert; more are dropped with a note. */
export const MAX_FILES = 20;
/** A file larger than this is refused by its size before it is read. */
export const MAX_FILE_BYTES = 256 * 1024 * 1024;
/** An SVG larger than this is refused before it is parsed. */
export const MAX_SVG_BYTES = 4 * 1024 * 1024;
/** Width × height a header may claim for the image to be decoded (a decompression bomb stops here). */
export const MAX_SOURCE_PIXELS = 100_000_000;
/** Width × height of a result. */
export const MAX_OUTPUT_PIXELS = 100_000_000;
/** The longest side of a canvas Chrome makes (measured: 65,536 fails). */
export const MAX_SIDE = 65_535;
/** How much of a file's start is read for its type and header facts. */
export const HEAD_BYTES = 256 * 1024;
/** Width and Height fields: whole numbers in this range. */
export const MIN_PX = 1;
export const MAX_PX = MAX_SIDE;
/** Percentage field. */
export const MIN_PERCENT = 1;
export const MAX_PERCENT = 1000;
/** Quality field (the encoder's quality is N / 100). */
export const MIN_QUALITY = 1;
export const MAX_QUALITY = 100;
/** What a browser draws an SVG with no size of its own at. */
export const DEFAULT_SVG_SIZE = { width: 300, height: 150 } as const;
