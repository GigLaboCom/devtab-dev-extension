/**
 * The promise that matters (docs/tools/specs/sql-format.md §5 п. 4–5, §15): formatting never changes the query. On
 * generated queries of every dialect — strings, quoted names, comments of every kind (several lines, a doc comment, a
 * line comment with U+2028), numbers, parameters, nested queries, several statements, CRLF — with random options:
 *
 * - a result keeps every string, quoted name and comment byte for byte and in order (found in the result one after
 *   another — a check that does not use the tool's own tokenizer), and its tokens equal the input's (tokens.ts);
 * - the tool never answers "would change the query": the guards of format.ts leave the library nothing to change;
 * - the library alone changes a query only in the two ways the guards are for (a block comment over several lines,
 *   a line comment with U+2028/U+2029) — anything else it changed would fail here.
 *
 * Seeded (mulberry32), so a failure repeats; the seed and the case are in the message.
 */
import { DIALECTS, firstChange, formatSql, libraryOptions } from './index';
import * as library from 'sql-formatter';
import { describe, expect, it } from 'vitest';
import type { DialectOptions, SqlDialect, SqlOptions } from './index';

const mulberry32 = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

interface Pieces {
  names: string[];
  strings: string[];
  params: string[];
  lineComments: string[];
}

const BLOCK_COMMENTS = ['/* c */', "/* it's */", '/* -- not a line */', '/**/'];
const MULTILINE_COMMENTS = ['/* first\n     second */', '/**\n * doc\n */', '/* a\r\n\t  b\r\n*/'];
const COMMON_STRINGS = ["'abc'", "''", "'select from where'", "'привет 🙂'", "'/* not */ -- not'"];

const pieces = (d: SqlDialect): Pieces => {
  const doubleQuotedName = !['mysql', 'mariadb', 'bigquery', 'spark'].includes(d);
  const names = ['id', 'user_id', 'Total', 't.amount', 'имя'];
  if (doubleQuotedName) names.push('"Mixed Case"', '"Order"');
  if (['sql', 'mysql', 'mariadb', 'sqlite', 'bigquery', 'spark', 'clickhouse'].includes(d)) names.push('`order`');
  if (['sqlite', 'transactsql'].includes(d)) names.push('[Order Id]');
  const backslash = ['mysql', 'mariadb', 'bigquery', 'spark', 'snowflake', 'clickhouse', 'sql'].includes(d);
  const doubled = !['bigquery', 'spark'].includes(d);
  const strings = [...COMMON_STRINGS];
  if (doubled) strings.push("'it''s'");
  if (backslash) strings.push("'it\\'s'");
  if (['postgresql', 'snowflake', 'duckdb', 'clickhouse'].includes(d)) strings.push('$$a /* b $$', '$fn$ x $fn$');
  if (['postgresql', 'duckdb'].includes(d)) strings.push("E'a\\'b'");
  if (d === 'plsql') strings.push("q'[it's /* x]'", "N'x'");
  if (d === 'bigquery') strings.push("'''a\nb'''", "r'\\d+'");
  const params: Record<SqlDialect, string[]> = {
    sql: ['?'],
    postgresql: ['$1', '$12'],
    mysql: ['?'],
    mariadb: ['?'],
    sqlite: ['?', '?1', ':name', '@name', '$name'],
    transactsql: ['@name'],
    plsql: [':1', ':name'],
    bigquery: ['?', '@name'],
    snowflake: [],
    redshift: ['$1'],
    spark: [],
    trino: ['?'],
    duckdb: ['?', '$1'],
    clickhouse: ['{id:UInt32}'],
  };
  // U+2028 in a line comment is rare in life: one line comment in ten here.
  const lineComments = ['-- c', "-- it's /* x", '--', '-- c', "-- it's", '-- 1', '-- c', '--x', '-- c', '-- c\u2028d'];
  if (['mysql', 'mariadb', 'bigquery', 'clickhouse'].includes(d)) lineComments.push('# hash', '#');
  if (d === 'snowflake') lineComments.push('// slashes');
  return { names, strings, params: params[d], lineComments };
};

interface Generated {
  text: string;
  /** Strings, quoted names and comments in the order they were written. */
  kept: string[];
}

const generate = (d: SqlDialect, random: () => number): Generated => {
  const p = pieces(d);
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(random() * xs.length)]!;
  const chance = (x: number): boolean => random() < x;
  const atoms: string[] = [];
  const kept: string[] = [];
  const quoted = (piece: string): void => {
    if (/^['"`[$qNEr]/.test(piece) && !/^\$\d|^\$name/.test(piece)) kept.push(piece);
    atoms.push(piece);
  };
  const name = (): void => quoted(pick(p.names));
  const value = (): void => {
    const r = random();
    if (r < 0.3) name();
    else if (r < 0.5) atoms.push(pick(['1', '2.5', '.5', '1e3', '0x1F', '42']));
    else if (r < 0.75) quoted(pick(p.strings));
    else if (p.params.length > 0) atoms.push(pick(p.params));
    else name();
  };
  const expr = (depth: number): void => {
    const r = random();
    if (depth > 2 || r < 0.35) value();
    else if (r < 0.5) {
      expr(depth + 1);
      atoms.push(pick(['+', '-', '*', '/', '=', '<>', '<', '>=', 'and', 'or']));
      expr(depth + 1);
    } else if (r < 0.6) {
      atoms.push(pick(['coalesce', 'lower', 'count', 'max']), '(');
      expr(depth + 1);
      atoms.push(',');
      expr(depth + 1);
      atoms.push(')');
    } else if (r < 0.7) {
      atoms.push('case', 'when');
      expr(depth + 1);
      atoms.push('then');
      value();
      atoms.push('else');
      value();
      atoms.push('end');
    } else if (r < 0.8) {
      name();
      atoms.push('in', '(');
      value();
      atoms.push(',');
      value();
      atoms.push(')');
    } else if (r < 0.88) {
      name();
      atoms.push('is', 'not', 'null');
    } else {
      atoms.push('(');
      select(depth + 1);
      atoms.push(')');
    }
  };
  const condition = (): void => {
    name();
    atoms.push(pick(['=', '<>', '<', '>']));
    expr(1);
    if (chance(0.4)) {
      atoms.push(pick(['and', 'or']));
      name();
      atoms.push('is', 'null');
    }
  };
  const select = (depth: number): void => {
    atoms.push('select');
    if (chance(0.15)) atoms.push('distinct');
    const n = 1 + Math.floor(random() * 3);
    for (let i = 0; i < n; i++) {
      if (i > 0) atoms.push(',');
      expr(depth);
      if (chance(0.3)) atoms.push('as', 'alias' + i);
    }
    atoms.push('from');
    name();
    if (chance(0.3)) {
      atoms.push(pick(['join', 'left join']));
      name();
      atoms.push('x', 'on');
      condition();
    }
    if (chance(0.6)) {
      atoms.push('where');
      condition();
    }
    if (chance(0.25)) {
      atoms.push('group', 'by');
      name();
    }
    if (chance(0.25)) {
      atoms.push('order', 'by');
      name();
      if (chance(0.5)) atoms.push('desc');
    }
  };
  const statement = (): void => {
    const r = random();
    if (r < 0.5) select(0);
    else if (r < 0.62) {
      atoms.push('insert', 'into', 'items', '(', 'a', ',', 'b', ')', 'values', '(');
      value();
      atoms.push(',');
      value();
      atoms.push(')');
    } else if (r < 0.74) {
      atoms.push('update', 'items', 'set', 'a', '=');
      expr(1);
      atoms.push('where');
      condition();
    } else if (r < 0.84) {
      atoms.push('delete', 'from', 'items', 'where');
      condition();
    } else {
      atoms.push('with', 'w', 'as', '(');
      select(1);
      atoms.push(')');
      select(0);
    }
  };
  const statements = 1 + Math.floor(random() * 3);
  for (let s = 0; s < statements; s++) {
    statement();
    if (s < statements - 1 || chance(0.5)) atoms.push(';');
  }

  // White space and comments between the atoms.
  const comments: Array<string | null> = atoms.map(() => {
    if (!chance(0.08)) return null;
    const r = random();
    return r < 0.45 ? pick(p.lineComments) : r < 0.9 ? pick(BLOCK_COMMENTS) : pick(MULTILINE_COMMENTS);
  });
  let text = '';
  const keptInOrder: string[] = [];
  let k = 0;
  atoms.forEach((atom, i) => {
    if (k < kept.length && atom === kept[k]) {
      keptInOrder.push(atom);
      k++;
    }
    text += atom;
    const comment = comments[i];
    const space = pick([' ', ' ', ' ', '  ', '\n', '\r\n', '\t', '\n\n']);
    if (comment) {
      keptInOrder.push(comment);
      const lineComment = !comment.startsWith('/*');
      // Glued to the atom only after a word: `/` + `/**` would be Snowflake's `//` line comment, `-` + `--` another one.
      text +=
        pick(/\w$/.test(atom) ? [' ', '\n', ''] : [' ', '\n']) + comment + (lineComment ? pick(['\n', '\r\n']) : space);
    } else text += space;
  });
  return { text, kept: keptInOrder };
};

const dialectObject = (id: SqlDialect): DialectOptions => (library as unknown as Record<string, DialectOptions>)[id]!;

const randomOptions = (dialect: SqlDialect, random: () => number): SqlOptions => {
  const layout = (['standard', 'standard', 'tabularLeft', 'tabularRight'] as const)[Math.floor(random() * 4)]!;
  const indents = layout === 'standard' ? ([2, 4, 'tab'] as const) : ([2, 4] as const);
  return {
    dialect,
    keywordCase: (['upper', 'lower', 'preserve'] as const)[Math.floor(random() * 3)]!,
    indent: indents[Math.floor(random() * indents.length)]!,
    layout,
  };
};

/** Every piece found in `text`, one after another (each after the previous one). */
const keptInOrder = (text: string, kept: readonly string[]): string | null => {
  let at = 0;
  for (const piece of kept) {
    const found = text.indexOf(piece, at);
    if (found === -1) return piece;
    at = found + piece.length;
  }
  return null;
};

const CASES = 250;

describe('formatting never changes the query (generated queries, every dialect)', () => {
  it.each(DIALECTS)(
    '%s',
    dialect => {
      const seed = 0x5eed + DIALECTS.indexOf(dialect);
      const random = mulberry32(seed);
      let formatted = 0;
      let libraryAloneChanged = 0;
      let plain = 0;
      for (let n = 0; n < CASES; n++) {
        const { text, kept } = generate(dialect, random);
        const options = randomOptions(dialect, random);
        const where = `${dialect}, seed ${seed}, case ${n}, ${JSON.stringify(options)}:\n${text}`;
        const result = formatSql(text, options, dialectObject(dialect));
        if (result.ok) {
          formatted++;
          expect(keptInOrder(result.text, kept), where).toBeNull();
          expect(firstChange(text, result.text, dialect, options.keywordCase === 'preserve'), where).toBeNull();
          expect(result.text.endsWith('\n'), where).toBe(false);
        } else {
          // An error is the library's (with its place) — never "would change the query".
          expect(result.error.message, where).not.toMatch(/would change the query/);
          expect('line' in result.error, where).toBe(true);
        }

        let alone: string | null = null;
        try {
          alone = library.formatDialect(text, { ...libraryOptions(options), dialect: dialectObject(dialect) });
        } catch {
          // The same error as above.
        }
        const guarded = MULTILINE_COMMENTS.some(c => text.includes(c)) || /[\u2028\u2029]/.test(text);
        if (!guarded) plain++;
        if (alone !== null && firstChange(text, alone, dialect, options.keywordCase === 'preserve') !== null) {
          libraryAloneChanged++;
          expect(guarded, `the library alone changed a query in a way the guards do not cover — ${where}`).toBe(true);
        }
      }
      // Enough queries without the two guarded kinds of comment, on which the library alone is held to the promise.
      expect(plain / CASES, dialect).toBeGreaterThan(0.3);
      // The generator writes queries the library reads: most of them format.
      expect(formatted / CASES, dialect).toBeGreaterThan(0.6);
      // And the guards are needed: the library alone changes some of them (multi-line comments, U+2028).
      expect(libraryAloneChanged, dialect).toBeGreaterThan(0);
    },
    120_000,
  );
});
