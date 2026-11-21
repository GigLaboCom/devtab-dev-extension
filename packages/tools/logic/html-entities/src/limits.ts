/** The tool's limits (docs/tools/specs/html-entities.md §12). The component checks sizes; the functions take any input. */

/** Above this many UTF-16 code units the tool refuses; exactly this many is still worked on. */
export const MAX_INPUT = 5 * 1024 * 1024;
/** Up to this many the result follows every edit; above it, SETTLE_MS after the last one. */
export const LIVE_INPUT = 1024 * 1024;
/** How long the result of a large input waits after the last edit. */
export const SETTLE_MS = 300;
/** At most this many distinct unknown `&name;` pieces are collected for the note under Decode's result (§5). */
export const MAX_UNKNOWN_CHECKED = 1000;
