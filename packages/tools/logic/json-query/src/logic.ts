/**
 * The JSON Query tool's logic (docs/tools/specs/json-query.md §9), what its component and its worker use: the parser
 * (parse.ts), the evaluator (evaluate.ts) with exact numbers (decimal.ts) and I-Regexp (iregexp.ts), normalized paths
 * (paths.ts), printing (print.ts), notes (notes.ts), the worker's run (run.ts) and `detectJsonQuery` (detect.ts).
 * Pure: no React, no DOM, no chrome. JSON is read only by the shared scanner, never by JSON.parse.
 */
import type { QueryError } from './parse';

/** The query around an error, for the echo line under the field: a window of ±30 characters. */
export interface Excerpt {
  before: string;
  /** The characters of the error's range ('' for a place without width), cut to 60 with «…». */
  marked: string;
  after: string;
  /** Text was left out before `before` / after `after`. */
  cutStart: boolean;
  cutEnd: boolean;
}

const AROUND = 30;
const MARKED = 60;

const isLow = (c: number): boolean => c >= 0xdc00 && c <= 0xdfff;

/** The echo of a query with its error's range marked (§8); never cuts a pair of surrogates in two. */
export const errorExcerpt = (query: string, error: QueryError): Excerpt => {
  const start = Math.max(0, Math.min(error.start, query.length));
  const end = Math.max(start, Math.min(error.end, query.length));
  let from = Math.max(0, start - AROUND);
  if (from > 0 && isLow(query.charCodeAt(from))) from--;
  let to = Math.min(query.length, end + AROUND);
  if (to < query.length && isLow(query.charCodeAt(to))) to++;
  let marked = query.slice(start, end);
  if (marked.length > MARKED) {
    let cut = MARKED - 1;
    if (isLow(marked.charCodeAt(cut))) cut--;
    marked = `${marked.slice(0, cut)}…`;
  }
  return {
    before: query.slice(from, start),
    marked,
    after: query.slice(end, to),
    cutStart: from > 0,
    cutEnd: to < query.length,
  };
};

/** `Position 7: …` — the place of a query error for people: 1-based, in UTF-16 units. */
export const errorText = (error: QueryError): string =>
  error.start < 0 ? error.message : `Position ${error.start + 1}: ${error.message}`;

/** A query cut to 60 characters with «…», for the status line. */
export const shortQuery = (query: string): string => (query.length > 60 ? `${query.slice(0, 59)}…` : query);
