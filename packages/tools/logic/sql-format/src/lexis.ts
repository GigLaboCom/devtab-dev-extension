/**
 * How each dialect quotes and comments (docs/tools/specs/sql-format.md §5 п. 4–6, §15): strings, quoted identifiers,
 * line comments and block comments, as `sql-formatter` 15.9.0 reads them (its `tokenizerOptions`; lexis.test.ts holds
 * the two together). Nothing else of the library's grammar is here: the scanner only has to know where text that is not
 * SQL begins and ends, so that a `/*` inside a string is not a comment and a `'` inside a comment is not a string.
 *
 *   scanSql(text, dialect, visit)   one pass, linear: every string, quoted identifier and comment as a span, in order
 *
 * Used by the unclosed-comment check (§5 п. 6), by the guard that keeps multi-line block comments byte for byte, by the
 * dialect hint (§5 п. 9) and by the property test that formatting never changes the query.
 */
import type { SqlDialect } from './logic';

/** How a quoted text escapes its quote: doubled (`''`), backslash (`\'`), both, or not at all. */
type Escape = 'qq' | 'bs' | 'qq-bs' | 'raw';

interface QuoteRule {
  /** `'`, `"`, `` ` ``, `[`, `{`, `'''`, `"""`, `$$` (a dollar tag), `q'` (Oracle's q-quote). */
  quote: string;
  escape: Escape;
  /** Letters written right before the quote (`E'…'`, `N'…'`, `R'…'`), any case. */
  prefixes?: readonly string[];
  /** Only with one of the prefixes (`X'…'` is raw, `'…'` alone is not). */
  requirePrefix?: boolean;
}

interface Lexis {
  strings: readonly QuoteRule[];
  identifiers: readonly QuoteRule[];
  lineComments: readonly string[];
  /** `/* a /* b *\/ c *\/` is one comment (PostgreSQL, SQL Server, DuckDB). */
  nestedComments: boolean;
}

const rule = (quote: string, escape: Escape, prefixes?: readonly string[], requirePrefix?: boolean): QuoteRule => ({
  quote,
  escape,
  ...(prefixes ? { prefixes } : {}),
  ...(requirePrefix ? { requirePrefix } : {}),
});

const BQ = ['R', 'B', 'RB', 'BR'];

/** The library's `tokenizerOptions` for the 14 dialects the tool offers (§5 п. 1), as quoting rules. */
export const LEXIS: Record<SqlDialect, Lexis> = {
  sql: {
    strings: [rule("'", 'qq-bs', ['N', 'U&']), rule("'", 'raw', ['X'], true)],
    identifiers: [rule('"', 'qq'), rule('`', 'qq')],
    lineComments: ['--'],
    nestedComments: false,
  },
  postgresql: {
    strings: [
      rule('$$', 'raw'),
      rule("'", 'qq', ['U&']),
      rule("'", 'qq-bs', ['E'], true),
      rule("'", 'raw', ['B', 'X'], true),
    ],
    identifiers: [rule('"', 'qq', ['U&'])],
    lineComments: ['--', '\\restrict ', '\\unrestrict '],
    nestedComments: true,
  },
  mysql: {
    strings: [rule('"', 'qq-bs'), rule("'", 'qq-bs', ['N']), rule("'", 'raw', ['B', 'X'], true)],
    identifiers: [rule('`', 'qq')],
    lineComments: ['--', '#'],
    nestedComments: false,
  },
  mariadb: {
    strings: [rule('"', 'qq-bs'), rule("'", 'qq-bs'), rule("'", 'raw', ['B', 'X'], true)],
    identifiers: [rule('`', 'qq')],
    lineComments: ['--', '#'],
    nestedComments: false,
  },
  sqlite: {
    strings: [rule("'", 'qq'), rule("'", 'raw', ['X'], true)],
    identifiers: [rule('"', 'qq'), rule('`', 'qq'), rule('[', 'qq')],
    lineComments: ['--'],
    nestedComments: false,
  },
  transactsql: {
    strings: [rule("'", 'qq', ['N']), rule('{', 'raw')],
    identifiers: [rule('"', 'qq'), rule('[', 'qq')],
    lineComments: ['--'],
    nestedComments: true,
  },
  plsql: {
    strings: [rule("'", 'qq', ['N']), rule("q'", 'raw', ['N'])],
    identifiers: [rule('"', 'qq')],
    lineComments: ['--'],
    nestedComments: false,
  },
  bigquery: {
    strings: [
      rule('"""', 'bs', BQ),
      rule("'''", 'bs', BQ),
      rule('"', 'bs'),
      rule("'", 'bs'),
      rule('"', 'raw', BQ, true),
      rule("'", 'raw', BQ, true),
    ],
    identifiers: [rule('`', 'qq')],
    lineComments: ['--', '#'],
    nestedComments: false,
  },
  snowflake: {
    strings: [rule('$$', 'raw'), rule("'", 'qq-bs')],
    identifiers: [rule('"', 'qq')],
    lineComments: ['--', '//'],
    nestedComments: false,
  },
  redshift: {
    strings: [rule("'", 'qq')],
    identifiers: [rule('"', 'qq')],
    lineComments: ['--'],
    nestedComments: false,
  },
  spark: {
    strings: [rule("'", 'bs'), rule('"', 'bs'), rule("'", 'raw', ['R', 'X'], true), rule('"', 'raw', ['R', 'X'], true)],
    // `${name}` — a variable, read like a string by the library.
    identifiers: [rule('`', 'qq'), rule('{', 'raw', ['$'], true)],
    lineComments: ['--'],
    nestedComments: false,
  },
  trino: {
    strings: [rule("'", 'qq', ['U&']), rule("'", 'raw', ['X'], true)],
    identifiers: [rule('"', 'qq')],
    lineComments: ['--'],
    nestedComments: false,
  },
  duckdb: {
    strings: [rule('$$', 'raw'), rule("'", 'qq'), rule("'", 'qq-bs', ['E'], true), rule("'", 'raw', ['B', 'X'], true)],
    identifiers: [rule('"', 'qq')],
    lineComments: ['--'],
    nestedComments: true,
  },
  clickhouse: {
    strings: [rule('$$', 'raw'), rule("'", 'qq-bs')],
    identifiers: [rule('"', 'qq-bs'), rule('`', 'qq')],
    lineComments: ['#', '--'],
    nestedComments: false,
  },
};

export type SpanKind = 'string' | 'identifier' | 'line-comment' | 'block-comment' | 'disabled';

/** A run of text that is not SQL code: [start, end) in UTF-16 units; `closed` is false when the text ran out first. */
export interface Span {
  kind: SpanKind;
  start: number;
  end: number;
  closed: boolean;
}

const CLOSE: Record<string, string> = { '[': ']', '{': '}', '(': ')', '<': '>' };
const IDENT_CHAR = /[\p{Alphabetic}\p{Mark}\p{Decimal_Number}_$#@]/u;
// The library's `/* sql-formatter-disable */ … /* sql-formatter-enable */`: the text between is printed as it stands.
const DISABLE = /\/\* *sql-formatter-disable *\*\//y;
const ENABLE = /\/\* *sql-formatter-enable *\*\//g;
const DOLLAR_TAG = /\$\w*\$/y;
// The first character of every quote above: `'`, `"`, `` ` ``, `[`, `{`, `$` (a dollar tag), `q` (Oracle's q-quote).
const QUOTE_START = '\'"`[{$qQ';

const isIdentChar = (text: string, at: number): boolean => at >= 0 && IDENT_CHAR.test(text[at]!);

/** Does the quote of `r` open at `at`? (The q of `q'…'` is part of its quote; a prefix is checked apart.) */
const opensAt = (text: string, at: number, r: QuoteRule): boolean => {
  if (r.quote === '$$') {
    DOLLAR_TAG.lastIndex = at;
    return DOLLAR_TAG.test(text);
  }
  if (r.quote === "q'") return (text[at] === 'q' || text[at] === 'Q') && text[at + 1] === "'";
  return text.startsWith(r.quote, at);
};

/** Is `prefix` written right before `at`, as the start of a word (not the end of a longer name)? */
const prefixedBy = (text: string, at: number, prefix: string): boolean => {
  const from = at - prefix.length;
  return from >= 0 && text.slice(from, at).toUpperCase() === prefix && !isIdentChar(text, from - 1);
};

/**
 * The rule a quote at `at` opens: one whose prefix is written right before it wins (`E'…'` escapes with backslashes in
 * PostgreSQL, `'…'` does not); otherwise the first rule that needs no prefix. A `q'` must start a word (or follow `N`).
 */
const ruleAt = (text: string, at: number, rules: readonly QuoteRule[]): QuoteRule | null => {
  let plain: QuoteRule | null = null;
  for (const r of rules) {
    if (!opensAt(text, at, r)) continue;
    if ((r.prefixes ?? []).some(p => prefixedBy(text, at, p))) return r;
    const free = r.quote === "q'" ? !isIdentChar(text, at - 1) : true;
    if (!r.requirePrefix && free && plain === null) plain = r;
  }
  return plain;
};

/** End (exclusive) of a quoted text opened at `at` by `r`, and whether its closing quote was found. */
const quotedEnd = (text: string, at: number, r: QuoteRule): { end: number; closed: boolean } => {
  const n = text.length;
  if (r.quote === '$$') {
    DOLLAR_TAG.lastIndex = at;
    const tag = DOLLAR_TAG.exec(text)![0];
    const close = text.indexOf(tag, at + tag.length);
    return close === -1 ? { end: n, closed: false } : { end: close + tag.length, closed: true };
  }
  if (r.quote === "q'") {
    // q'<…>' q'[…]' q'(…)' q'{…}', or q'X…X' with any other character.
    const open = text[at + 2];
    if (open === undefined) return { end: n, closed: false };
    const close = (CLOSE[open] ?? open) + "'";
    const found = text.indexOf(close, at + 3);
    return found === -1 ? { end: n, closed: false } : { end: found + 2, closed: true };
  }
  if (r.quote === "'''" || r.quote === '"""') {
    for (let i = at + 3; i < n; i++) {
      if (text[i] === '\\') i++;
      else if (text.startsWith(r.quote, i)) return { end: i + 3, closed: true };
    }
    return { end: n, closed: false };
  }
  const close = CLOSE[r.quote] ?? r.quote;
  const doubled = r.escape === 'qq' || r.escape === 'qq-bs';
  const backslash = r.escape === 'bs' || r.escape === 'qq-bs';
  for (let i = at + 1; i < n; i++) {
    const c = text[i];
    if (backslash && c === '\\') i++;
    else if (c === close) {
      if (doubled && text[i + 1] === close) i++;
      else return { end: i + 1, closed: true };
    }
  }
  return { end: n, closed: false };
};

/** End of a block comment opened at `at` (nested where the dialect nests them). */
const commentEnd = (text: string, at: number, nested: boolean): { end: number; closed: boolean } => {
  if (!nested) {
    const close = text.indexOf('*/', at + 2);
    return close === -1 ? { end: text.length, closed: false } : { end: close + 2, closed: true };
  }
  let depth = 0;
  for (let i = at; i < text.length - 1; i++) {
    if (text[i] === '/' && text[i + 1] === '*') {
      depth++;
      i++;
    } else if (text[i] === '*' && text[i + 1] === '/') {
      depth--;
      i++;
      if (depth === 0) return { end: i + 1, closed: true };
    }
  }
  return { end: text.length, closed: false };
};

const lineEnd = (text: string, at: number): number => {
  for (let i = at; i < text.length; i++) if (text[i] === '\n' || text[i] === '\r') return i;
  return text.length;
};

/**
 * Walks the text once and reports every span that is not SQL code, in order. Quote openers are found by their first
 * character; an unclosed string or comment runs to the end of the text (`closed: false`) and is the last span.
 */
export const scanSql = (text: string, dialect: SqlDialect, visit: (span: Span) => void): void => {
  const lexis = LEXIS[dialect];
  const n = text.length;
  let i = 0;
  while (i < n) {
    const c = text[i]!;
    if (c === '/' && text[i + 1] === '*') {
      DISABLE.lastIndex = i;
      if (DISABLE.test(text)) {
        ENABLE.lastIndex = DISABLE.lastIndex;
        const enable = ENABLE.exec(text);
        const end = enable ? enable.index + enable[0].length : n;
        visit({ kind: 'disabled', start: i, end, closed: true });
        i = end;
        continue;
      }
      const { end, closed } = commentEnd(text, i, lexis.nestedComments);
      visit({ kind: 'block-comment', start: i, end, closed });
      i = end;
      continue;
    }
    const line = lexis.lineComments.find(open => text.startsWith(open, i));
    if (line) {
      const end = lineEnd(text, i);
      visit({ kind: 'line-comment', start: i, end, closed: true });
      i = end;
      continue;
    }
    if (QUOTE_START.includes(c)) {
      const id = ruleAt(text, i, lexis.identifiers);
      const r = id ?? ruleAt(text, i, lexis.strings);
      if (r) {
        const { end, closed } = quotedEnd(text, i, r);
        visit({ kind: id ? 'identifier' : 'string', start: i, end, closed });
        i = end;
        continue;
      }
    }
    i++;
  }
};
