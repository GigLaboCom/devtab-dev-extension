/**
 * The promise of the tool, as a check: formatting changes white space and the case of keywords, nothing else
 * (docs/tools/specs/sql-format.md §5 п. 4–5, §15). A text is read as the sequence of its tokens that are not white
 * space — strings, quoted names and comments as written (a line comment without the spaces that end its line), numbers
 * as written, words, and every other character on its own — and two texts are the same query when the sequences are
 * equal, words compared without case when keywords may change case.
 *
 * The worker runs it on every result (format.ts): if the library ever changed the query, the person gets an error
 * instead of a different query. The property test runs it on generated queries of every dialect.
 */
import { scanSql } from './lexis';
import type { SqlDialect } from './logic';

export interface SqlToken {
  kind: 'quoted' | 'comment' | 'word' | 'number' | 'other';
  text: string;
  /** UTF-16 offset in its text. */
  offset: number;
}

const WORD_START = /[\p{Alphabetic}\p{Mark}_]/u;
const WORD_CHAR = /[\p{Alphabetic}\p{Mark}\p{Decimal_Number}_$#@]/u;
const DIGIT = /[0-9]/;
const NUMBER_CHAR = /[0-9A-Za-z_.]/;
const SPACE = /\s/;
const EXPONENT = /^[0-9]*\.?[0-9]*[eE]$/;

const codeTokens = (text: string, from: number, to: number, out: SqlToken[]): void => {
  let i = from;
  while (i < to) {
    const c = text[i]!;
    if (SPACE.test(c)) {
      i++;
      continue;
    }
    let end = i + 1;
    let kind: SqlToken['kind'] = 'other';
    if (DIGIT.test(c) || (c === '.' && DIGIT.test(text[i + 1] ?? ''))) {
      kind = 'number';
      // `1e-5` is one number; `0xe-1` is not (the sign follows an exponent only after decimal digits).
      while (
        end < to &&
        (NUMBER_CHAR.test(text[end]!) ||
          ((text[end] === '+' || text[end] === '-') && EXPONENT.test(text.slice(i, end))))
      )
        end++;
    } else if (WORD_START.test(c)) {
      kind = 'word';
      while (end < to && WORD_CHAR.test(text[end]!)) end++;
    } else if (c >= '\ud800' && c <= '\udbff') end = Math.min(i + 2, to);
    out.push({ kind, text: text.slice(i, end), offset: i });
    i = end;
  }
};

/** The tokens of `text` that are not white space, as the dialect quotes and comments (lexis.ts). */
export const sqlTokens = (text: string, dialect: SqlDialect): SqlToken[] => {
  const out: SqlToken[] = [];
  let at = 0;
  scanSql(text, dialect, span => {
    codeTokens(text, at, span.start, out);
    let written = text.slice(span.start, span.end);
    if (span.kind === 'line-comment') written = written.replace(/[ \t]+$/, '');
    out.push({
      kind: span.kind === 'string' || span.kind === 'identifier' ? 'quoted' : 'comment',
      text: written,
      offset: span.start,
    });
    at = span.end;
  });
  codeTokens(text, at, text.length, out);
  return out;
};

/**
 * Is `after` the same query as `before`? `null` when it is; otherwise the offset in `before` of the first token that
 * differs (its end when `after` has more). Words are compared without case unless `exactCase` (keyword case Preserve).
 */
export const firstChange = (before: string, after: string, dialect: SqlDialect, exactCase: boolean): number | null => {
  const a = sqlTokens(before, dialect);
  const b = sqlTokens(after, dialect);
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    const x = a[i]!;
    const y = b[i]!;
    const same =
      x.kind === y.kind &&
      (x.text === y.text || (!exactCase && x.kind === 'word' && x.text.toUpperCase() === y.text.toUpperCase()));
    if (!same) return x.offset;
  }
  return a.length === b.length ? null : (a[n]?.offset ?? before.length);
};
