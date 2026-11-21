/**
 * The String Escape tool's types and limits (docs/tools/specs/backslash-escape.md §9, §12). `firstLoneSurrogate` is the
 * one field beyond §9: the note under the result names the first unpaired surrogate (§8), and in Python that is a fact of
 * the escapes, not of the text (two surrogate escapes stay two code points there — §5, «Суррогаты»).
 */

export type Dialect = 'json' | 'js' | 'python' | 'c';
export type Quote = '"' | "'" | '`';

export interface EscapeOptions {
  dialect: Dialect;
  /** Used by 'js' (all three) and 'python' (" and '); 'json' and 'c' always use ". */
  quote: Quote;
  nonAscii: boolean;
  withQuotes: boolean;
}

export interface UnescapeOptions {
  dialect: Dialect;
  withQuotes: boolean;
}

export interface EscapeError {
  message: string;
  /** UTF-16 offset of the backslash (or of the first non-space character for a quotes error). */
  offset: number;
  line: number;
  column: number;
}

export type UnescapeResult =
  | {
      ok: true;
      text: string;
      /** Python only: distinct unknown escapes kept with their backslash, in order of appearance. */
      keptUnknown: string[];
      /** Unpaired surrogates in `text` (in Python: surrogate code points, paired or not — Python does not pair them). */
      loneSurrogates: number;
      /** The first of them (a UTF-16 code unit, U+D800–U+DFFF), or null when there is none. */
      firstLoneSurrogate: number | null;
      /** C only: bytes that are not UTF-8, shown as U+FFFD. */
      invalidUtf8: boolean;
    }
  | { ok: false; error: EscapeError };

/** Above this many UTF-16 code units the tool refuses (§12); exactly this many is still worked on. */
export const MAX_INPUT = 5 * 1024 * 1024;
/** Up to this many the result follows every edit; above it, SETTLE_MS after the last one (§12). */
export const LIVE_INPUT = 1024 * 1024;
/** How long the result waits after the last edit of a large input (§12). */
export const SETTLE_MS = 300;

/** The dialects in the order the interface lists them (§4), with their names as people read them. */
export const DIALECTS: readonly Dialect[] = ['json', 'js', 'python', 'c'];
export const DIALECT_NAMES: Readonly<Record<Dialect, string>> = {
  json: 'JSON',
  js: 'JavaScript',
  python: 'Python',
  c: 'C / C++',
};
