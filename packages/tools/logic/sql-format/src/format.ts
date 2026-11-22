/*! @license MIT
sql-formatter — Copyright (c) 2016-2020 ZeroTurnaround LLC; Copyright (c) 2020-2021 George Leslie-Waksman and other
contributors; Copyright (c) 2021-Present inferrinizzard and other contributors.
nearley — Copyright (c) 2014, 2015, 2016, 2017, 2018, 2019 Kartik Chandra, Tim Radvan.

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated
documentation files (the "Software"), to deal in the Software without restriction, including without limitation the
rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit
persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the
Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE
WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR
COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
*/
/**
 * Formatting itself (docs/tools/specs/sql-format.md §5, §9): `formatDialect` of `sql-formatter` 15.9.0 with the
 * dialect object the caller brings — the worker of that dialect imports exactly one (ui package, `dialects/`), so this
 * module never names a dialect and the bundle of each worker holds the core and its own dialect only.
 *
 * Around the library, three guards of the promise that a query comes out as it went in:
 * 1. a `/*` that never closes is an error before the library (§5 п. 6: it would print `/ *`);
 * 2. a comment the library would change goes through it as a placeholder and comes back byte for byte (§15: the
 *    library re-indents every line of a block comment over several lines, and breaks a line comment at U+2028);
 * 3. the result is compared with the input token by token (tokens.ts); a difference is an error, never a result.
 */
import { LEXIS, bracketsDeeperThan, scanSql } from './lexis';
import {
  MAX_NESTING,
  NESTED_TOO_DEEP,
  UNCLOSED_COMMENT,
  findUnclosedComment,
  libraryOptions,
  mapLibraryError,
} from './logic';
import { firstChange } from './tokens';
import { errorAt } from '@workspace/tools-shared/json-scan';
import { formatDialect } from 'sql-formatter';
import type { SqlDialect, SqlError, SqlOptions, SqlResult } from './logic';
import type { DialectOptions } from 'sql-formatter';

export type { DialectOptions } from 'sql-formatter';

/** A placeholder in the guarded text: where it starts there, its length, and the comment it stands for. */
interface Placeholder {
  at: number;
  length: number;
  comment: string;
}

const LINE_SEPARATORS = /[\u2028\u2029]/;

/** A marker the text does not contain, so a placeholder is never mistaken for the person's own comment. */
const markerFor = (text: string): string => {
  let marker = 'sql-format-guard-';
  while (text.includes(marker)) marker += '~';
  return marker;
};

/** The opener a line comment starts with (`--`, `#`, `//`, …), as the dialect writes them. */
const lineOpener = (comment: string, dialect: SqlDialect): string =>
  LEXIS[dialect].lineComments.find(open => comment.startsWith(open)) ?? '--';

/**
 * The text with every comment the library would change replaced by a placeholder of the same kind, and how to put them
 * back (§15): a block comment over several lines becomes `/*<marker><n>*\/` on a line of its own (where the library
 * places such a comment), and a line comment with U+2028 or U+2029 in it becomes `--<marker><n>.` (the library's line
 * comment stops before those characters and prints the rest of the comment as code).
 */
const guardComments = (text: string, dialect: SqlDialect): { guarded: string; placeholders: Placeholder[] } => {
  const placeholders: Placeholder[] = [];
  const marker = markerFor(text);
  let guarded = '';
  let at = 0;
  scanSql(text, dialect, span => {
    const comment = text.slice(span.start, span.end);
    let placeholder: string;
    if (span.kind === 'block-comment' && span.closed && comment.includes('\n'))
      placeholder = `\n/*${marker}${placeholders.length}*/`;
    else if (span.kind === 'line-comment' && LINE_SEPARATORS.test(comment))
      placeholder = `${lineOpener(comment, dialect)}${marker}${placeholders.length}.`;
    else return;
    guarded += text.slice(at, span.start);
    const leading = placeholder.startsWith('\n') ? 1 : 0;
    placeholders.push({ at: guarded.length + leading, length: placeholder.length - leading, comment });
    guarded += placeholder;
    at = span.end;
  });
  return { guarded: guarded + text.slice(at), placeholders };
};

const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/**
 * The library's error in the person's terms (§5 п. 8). Placeholders shift the places of the guarded text, so with any
 * of them the input itself is run once more for the error and its place (the comments' white space changes nothing of
 * the grammar).
 */
const libraryError = (
  text: string,
  guarded: string,
  placeholders: readonly Placeholder[],
  error: unknown,
  options: SqlOptions,
  dialect: DialectOptions,
): SqlError => {
  if (placeholders.length === 0) return mapLibraryError(guarded, messageOf(error), options.dialect);
  try {
    formatDialect(text, { ...libraryOptions(options), dialect });
  } catch (again) {
    return mapLibraryError(text, messageOf(again), options.dialect);
  }
  return mapLibraryError(guarded, messageOf(error), options.dialect);
};

const CHANGED = 'the formatter would change the query here, so nothing is shown';

/** §5: formats `text` with the person's options and the dialect's library object; errors are values (§6). */
export const formatSql = (text: string, options: SqlOptions, dialect: DialectOptions): SqlResult => {
  if (text.trim() === '') return { ok: true, text: '' };
  const unclosed = findUnclosedComment(text, options.dialect);
  if (unclosed !== null) return { ok: false, error: errorAt(text, UNCLOSED_COMMENT, unclosed) };
  const deep = bracketsDeeperThan(text, options.dialect, MAX_NESTING);
  if (deep !== null) return { ok: false, error: errorAt(text, NESTED_TOO_DEEP, deep) };

  const { guarded, placeholders } = guardComments(text, options.dialect);
  let printed: string;
  try {
    printed = formatDialect(guarded, { ...libraryOptions(options), dialect });
  } catch (error) {
    return { ok: false, error: libraryError(text, guarded, placeholders, error, options, dialect) };
  }

  let result = printed;
  for (let k = placeholders.length - 1; k >= 0; k--) {
    const tag = guarded.slice(placeholders[k]!.at, placeholders[k]!.at + placeholders[k]!.length);
    const found = result.lastIndexOf(tag);
    if (found === -1) return { ok: false, error: { message: CHANGED } };
    result = result.slice(0, found) + placeholders[k]!.comment + result.slice(found + tag.length);
  }

  const changed = firstChange(text, result, options.dialect, options.keywordCase === 'preserve');
  if (changed !== null) return { ok: false, error: errorAt(text, CHANGED, changed) };
  return { ok: true, text: result };
};
