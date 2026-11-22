/**
 * The failures of a piece of work in words (docs/tools/specs/password-hash.md §6), apart from job.ts so the page can name
 * them without importing the hashes (and the library) the worker runs.
 */
export const COULD_NOT = 'The hash could not be computed.';
export const NO_MEMORY = 'The hash could not be computed: the browser did not give it enough memory.';

/** A failure in words: the browser refusing wasm memory (a RangeError from `memory.grow`) is said apart (§6). */
export const failureMessage = (error: unknown): string =>
  error instanceof RangeError || (error instanceof Error && /memory/i.test(error.message)) ? NO_MEMORY : COULD_NOT;
