/** The tool's limits (docs/tools/specs/html-to-jsx.md §12) and its layout's constants (§5 «Раскладка»). */

/** Up to this many characters the result follows every edit; above it, Convert (or Ctrl+Enter). */
export const LIVE_INPUT = 256 * 1024;
/** Above this many characters the input is refused. */
export const MAX_INPUT = 4 * 1024 * 1024;

/** A line of the result: an element that fits in this width, with its indentation, is written on one line. */
export const LINE_WIDTH = 80;
/** Spaces per level. */
export const INDENT = 2;
/**
 * Indentation stops growing at this depth (80 columns, the line width): deeper markup is still nested correctly, but a
 * tree 10,000 levels deep would otherwise make a result of tens of megabytes made of spaces.
 */
export const MAX_INDENT_LEVEL = 40;
