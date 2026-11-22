/**
 * Recognising a pasted JSONPath query (docs/tools/specs/json-query.md §7). Pasted JSON is not this tool's — it keeps
 * opening the JSON tool; a pasted query is: at most DETECT_MAX characters on one line, `$` followed at once by `.`,
 * `..` or `[`, and the whole text a valid RFC 9535 query. Imports the parser only (not the evaluator).
 */
import { parseQuery } from './parse';

export const DETECT_MAX = 1_000;

const START = /^\$[.[]/;

export const detectJsonQuery = (text: string): boolean =>
  text.length <= DETECT_MAX && START.test(text) && !/[\n\r]/.test(text) && parseQuery(text).ok;
