/** The limits of docs/tools/specs/string-inspector.md §12; the component checks the size, the functions take any text. */

/** Up to this many UTF-16 code units the results follow every edit. */
export const LIVE_INPUT = 64 * 1024;
/** Above this many UTF-16 code units (1 Mi) the tool refuses the text. */
export const MAX_INPUT = 1024 * 1024;
/** Between LIVE_INPUT and MAX_INPUT the results come this long after the last edit. */
export const SETTLE_MS = 300;
/** The visible text shows the first this many code points. */
export const MAX_VISIBLE = 10_000;
/** The table has a row for each of the first this many code points. */
export const MAX_ROWS = 1_000;
/** A word quoted in a warning shows at most this many code points, then `…`. */
export const MAX_WORD_SHOWN = 40;
/**
 * A run of more combining marks than this (code points of `\p{M}`) is not normalised: the time grows with the square of
 * the run (inspect.ts, longestMarkRun). Spec §15.
 */
export const MAX_MARK_RUN = 256;
