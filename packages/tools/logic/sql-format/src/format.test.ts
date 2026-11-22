/**
 * Every row of docs/tools/specs/sql-format.md §10 with the library (`sql-formatter` 15.9.0, the version taken — §15):
 * the result word for word, or the error with its line and column. Defaults: Standard SQL, UPPER, 2 spaces, Standard.
 * And what §5 and §6 state that §10 leaves out: every dialect formats, comments and quoted text come out as written,
 * multi-line comments byte for byte, parameters per dialect, several statements, CRLF.
 */
import { DEFAULT_OPTIONS, DIALECTS, MAX_NESTING, describeError, formatSql } from './index';
import { bracketsDeeperThan } from './lexis';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import * as library from 'sql-formatter';
import { describe, expect, it } from 'vitest';
import type { DialectOptions, SqlOptions, SqlResult } from './index';

const dialectObject = (id: string): DialectOptions => (library as unknown as Record<string, DialectOptions>)[id]!;
const run = (text: string, options: Partial<SqlOptions> = {}): SqlResult => {
  const o = { ...DEFAULT_OPTIONS, ...options };
  return formatSql(text, o, dialectObject(o.dialect));
};
const fmt = (text: string, options: Partial<SqlOptions> = {}): string => {
  const result = run(text, options);
  if (!result.ok) throw new Error(`expected a result, got: ${describeError(result.error)}`);
  return result.text;
};
const err = (text: string, options: Partial<SqlOptions> = {}): string => {
  const result = run(text, options);
  if (result.ok) throw new Error(`expected an error, got: ${JSON.stringify(result.text)}`);
  return describeError(result.error);
};
const lines = (...rows: string[]): string => rows.join('\n');

describe('§10: results', () => {
  it('row 1: the log query of §2.1', () => {
    expect(fmt('select id, name from users where active = 1 and age > 18 order by name')).toBe(
      lines(
        'SELECT',
        '  id,',
        '  name',
        'FROM',
        '  users',
        'WHERE',
        '  active = 1',
        '  AND age > 18',
        'ORDER BY',
        '  name',
      ),
    );
  });
  it('row 2: Keyword case lower', () => {
    expect(fmt('SELECT id FROM users WHERE x = 1', { keywordCase: 'lower' })).toBe(
      lines('select', '  id', 'from', '  users', 'where', '  x = 1'),
    );
  });
  it('row 3: Keyword case Preserve', () => {
    expect(fmt('Select id From users', { keywordCase: 'preserve' })).toBe(lines('Select', '  id', 'From', '  users'));
  });
  it('row 4: 4 spaces', () => {
    expect(fmt('select a, b from t where x = 1', { indent: 4 })).toBe(
      lines('SELECT', '    a,', '    b', 'FROM', '    t', 'WHERE', '    x = 1'),
    );
  });
  it('row 5: Tab', () => {
    expect(fmt('select a from t where x = 1', { indent: 'tab' })).toBe(
      lines('SELECT', '\ta', 'FROM', '\tt', 'WHERE', '\tx = 1'),
    );
  });
  it('row 6: Tabular left', () => {
    expect(fmt('select a, b from t where x = 1 and y = 2', { layout: 'tabularLeft' })).toBe(
      lines('SELECT    a,', '          b', 'FROM      t', 'WHERE     x = 1', 'AND       y = 2'),
    );
  });
  it('row 7: Tabular right', () => {
    expect(fmt('select a, b from t where x = 1 and y = 2', { layout: 'tabularRight' })).toBe(
      lines('   SELECT a,', '          b', '     FROM t', '    WHERE x = 1', '      AND y = 2'),
    );
  });
  it('row 8: a join', () => {
    expect(fmt('select u.id, o.total from users u left join orders o on o.user_id = u.id where o.total > 100')).toBe(
      lines(
        'SELECT',
        '  u.id,',
        '  o.total',
        'FROM',
        '  users u',
        '  LEFT JOIN orders o ON o.user_id = u.id',
        'WHERE',
        '  o.total > 100',
      ),
    );
  });
  it('row 9: WITH', () => {
    expect(fmt('with a as (select 1 as x) select * from a')).toBe(
      lines('WITH', '  a AS (', '    SELECT', '      1 AS x', '  )', 'SELECT', '  *', 'FROM', '  a'),
    );
  });
  it('row 10: INSERT', () => {
    expect(fmt("insert into t (a, b) values (1, 'x'), (2, 'y')")).toBe(
      lines('INSERT INTO', '  t (a, b)', 'VALUES', "  (1, 'x'),", "  (2, 'y')"),
    );
  });
  it('row 11: UPDATE', () => {
    expect(fmt("update t set a = 1, b = 'x' where id = 5")).toBe(
      lines('UPDATE t', 'SET', '  a = 1,', "  b = 'x'", 'WHERE', '  id = 5'),
    );
  });
  it('row 12: CREATE TABLE (`key` stays lower case — so the library does)', () => {
    expect(fmt('create table t (id int primary key, name varchar(100) not null)')).toBe(
      'CREATE TABLE t (id INT PRIMARY key, name VARCHAR(100) NOT NULL)',
    );
  });
  it('row 13: data types follow Keyword case', () => {
    expect(fmt('create table t (a INT, b VARCHAR(10))', { keywordCase: 'lower' })).toBe(
      'create table t (a int, b varchar(10))',
    );
  });
  it('row 14: CASE', () => {
    expect(fmt("select case when a = 1 then 'one' else 'many' end as n from t")).toBe(
      lines('SELECT', '  CASE', "    WHEN a = 1 THEN 'one'", "    ELSE 'many'", '  END AS n', 'FROM', '  t'),
    );
  });
  it('row 15: comments stay where they were (§2.4)', () => {
    expect(fmt('-- leading comment\nselect a, -- trailing\n /* block */ b from t /* end */')).toBe(
      lines('-- leading comment', 'SELECT', '  a, -- trailing', '  /* block */', '  b', 'FROM', '  t /* end */'),
    );
  });
  it('row 16: two statements, one empty line between', () => {
    expect(fmt('select 1; select 2;')).toBe(lines('SELECT', '  1;', '', 'SELECT', '  2;'));
  });
  it('row 17: strings and quoted names as written', () => {
    expect(fmt('select \'select from where\' as s, "Order" from t')).toBe(
      lines('SELECT', "  'select from where' AS s,", '  "Order"', 'FROM', '  t'),
    );
  });
  it('row 18: PostgreSQL ->>, ::, $1', () => {
    expect(fmt("select data->>'name', created::date from t where id = $1", { dialect: 'postgresql' })).toBe(
      lines('SELECT', "  data ->> 'name',", '  created::date', 'FROM', '  t', 'WHERE', '  id = $1'),
    );
  });
  it('row 19: SQL Server TOP and [names]', () => {
    expect(fmt('select top 10 [Order Id] from [dbo].[Orders]', { dialect: 'transactsql' })).toBe(
      lines('SELECT', '  TOP 10 [Order Id]', 'FROM', '  [dbo].[Orders]'),
    );
  });
  it('row 20: MySQL backticks', () => {
    expect(fmt('select `order`, count(*) from `t` group by `order`', { dialect: 'mysql' })).toBe(
      lines('SELECT', '  `order`,', '  count(*)', 'FROM', '  `t`', 'GROUP BY', '  `order`'),
    );
  });
  it('row 21: Standard SQL takes backticks itself', () => {
    expect(fmt('select `order` from t')).toBe(lines('SELECT', '  `order`', 'FROM', '  t'));
  });
  it('row 22: MySQL # comment', () => {
    expect(fmt('# c\nselect 1', { dialect: 'mysql' })).toBe(lines('# c', 'SELECT', '  1'));
  });
  it('row 31: a /* inside a string is not a comment', () => {
    expect(fmt("select '/* not a comment' from t")).toBe(lines('SELECT', "  '/* not a comment'", 'FROM', '  t'));
  });
  it('row 32: nor inside a PostgreSQL dollar-quoted string', () => {
    expect(fmt('select $$a /* b$$ from t', { dialect: 'postgresql' })).toBe(
      lines('SELECT', '  $$a /* b$$', 'FROM', '  t'),
    );
  });
  it('row 33: the formatter does not check (§5 п. 7)', () => {
    expect(fmt('this is not sql at all')).toBe('this IS NOT SQL AT ALL');
  });
  it('row 34: a doubled comma', () => {
    expect(fmt('select a,, b from t')).toBe(lines('SELECT', '  a,', ',', '  b', 'FROM', '  t'));
  });
  it('row 37: Cyrillic and emoji in strings and names', () => {
    expect(fmt('select \'привет 🙂\' as "имя" from t')).toBe(
      lines('SELECT', '  \'привет 🙂\' AS "имя"', 'FROM', '  t'),
    );
  });
  it('row 38: CRLF in the input, LF in the result', () => {
    expect(fmt('select a\r\nfrom t')).toBe(lines('SELECT', '  a', 'FROM', '  t'));
  });
  it('row 39: empty input and a comment alone', () => {
    expect(fmt('')).toBe('');
    expect(fmt('  \n\t ')).toBe('');
    expect(fmt('-- nothing')).toBe('-- nothing');
  });
  it('row 40: Oracle PL/SQL — procedural code as separate statements', () => {
    expect(fmt('begin update t set a = 1; commit; end;', { dialect: 'plsql' })).toBe(
      lines('BEGIN', 'UPDATE t', 'SET', '  a = 1;', '', 'COMMIT;', '', 'END;'),
    );
  });
});

describe('§10: errors (§6)', () => {
  it('row 23: :: in Standard SQL, with the hint', () => {
    expect(err('select created::date from t')).toBe(
      'Line 1, column 15: unexpected "::date fro". Standard SQL doesn\'t have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.',
    );
  });
  it('row 24: [names] in Standard SQL', () => {
    expect(err('select [Order Id] from t')).toBe(
      'Line 1, column 8: unexpected "[Order Id]". Standard SQL doesn\'t have this syntax; try SQL Server.',
    );
  });
  it('row 25: # in Standard SQL (the piece stops at the line break)', () => {
    expect(err('# c\nselect 1')).toBe(
      'Line 1, column 1: unexpected "# c". Standard SQL doesn\'t have this syntax; try MySQL, MariaDB.',
    );
  });
  it('row 26: an unclosed parenthesis', () => {
    expect(err('select (a from t')).toBe(
      'Line 1, column 17: the query ends too early (an unclosed parenthesis or CASE?)',
    );
  });
  it('row 27: a closing parenthesis too many', () => {
    expect(err('select a from t where x = 1)')).toBe('Line 1, column 28: unexpected ")"');
  });
  it('row 28: CASE without END', () => {
    expect(err('select case when a then b from t')).toBe('Line 1, column 27: unexpected "FROM"');
  });
  it('row 29: an unclosed string', () => {
    expect(err("select 'abc from t")).toBe('Line 1, column 8: unexpected "\'abc from "');
  });
  it('row 30: an unclosed block comment — our check, before the library', () => {
    expect(err('select 1 /* abc')).toBe('Line 1, column 10: unclosed comment: /* without */');
  });
  it('row 35: JSON is not SQL', () => {
    expect(err('{"a": 1}')).toBe('Line 1, column 1: unexpected "{"a": 1}"');
  });
  it('row 36: columns are UTF-16 units (an emoji is two)', () => {
    expect(err("select '🙂🙂' as a, created::date from t")).toMatch(/^Line 1, column 28: /);
    expect(err("select 'ab' as a, created::date from t")).toMatch(/^Line 1, column 26: /);
  });
});

describe('what §5 and §6 state beyond §10', () => {
  it('every dialect of the list formats the same plain query', () => {
    for (const dialect of DIALECTS)
      expect(fmt('select id, title from users where id = 1', { dialect }), dialect).toBe(
        lines('SELECT', '  id,', '  title', 'FROM', '  users', 'WHERE', '  id = 1'),
      );
    // What a dialect counts as a keyword follows Keyword case even as a column name: NAME in Oracle PL/SQL.
    expect(fmt('select name from users', { dialect: 'plsql' })).toBe(lines('SELECT', '  NAME', 'FROM', '  users'));
  });

  it('a block comment over several lines comes out byte for byte (the library alone re-indents it — §15)', () => {
    const text = 'select a,\n    /* first line\n       second line\r\n   */ b from t';
    expect(fmt(text)).toBe(
      lines('SELECT', '  a,', '  /* first line\n       second line\r\n   */', '  b', 'FROM', '  t'),
    );
    expect(library.formatDialect(text, { dialect: library.sql })).toContain('/* first line\n  second line');
    // A doc comment too, inside a nested query.
    const doc = 'select x from (\n/**\n * doc\n */\nselect 1 as x) q';
    expect(fmt(doc)).toContain('/**\n * doc\n */');
  });

  it('an unclosed comment after a closed one, after a line comment, in a nested comment of PostgreSQL', () => {
    expect(err('select 1 /* a */ /* b')).toBe('Line 1, column 18: unclosed comment: /* without */');
    expect(err('select 1 -- /* fine\n, 2 /* not')).toBe('Line 2, column 5: unclosed comment: /* without */');
    expect(err('select 1 /* a /* b */', { dialect: 'postgresql' })).toBe(
      'Line 1, column 10: unclosed comment: /* without */',
    );
    // Standard SQL does not nest: the first */ closes.
    expect(fmt('select 1 /* a /* b */')).toBe(lines('SELECT', '  1 /* a /* b */'));
  });

  it('strings with escapes of their dialect hide a /* (MySQL backslash, Oracle q-quote, BigQuery triple quotes)', () => {
    expect(fmt("select 'it\\'s /* x' from t", { dialect: 'mysql' })).toBe(
      lines('SELECT', "  'it\\'s /* x'", 'FROM', '  t'),
    );
    expect(fmt("select q'[a /* b]' from dual", { dialect: 'plsql' })).toBe(
      lines('SELECT', "  q'[a /* b]'", 'FROM', '  dual'),
    );
    expect(fmt("select '''a /* b''' as s", { dialect: 'bigquery' })).toBe(lines('SELECT', "  '''a /* b''' AS s"));
  });

  it('parameters of each dialect stay as written (§5 п. 2)', () => {
    expect(fmt('select a from t where id = ?', { dialect: 'mysql' })).toBe(
      lines('SELECT', '  a', 'FROM', '  t', 'WHERE', '  id = ?'),
    );
    expect(fmt('select a from t where n = :name', { dialect: 'sqlite' })).toContain('n = :name');
    expect(fmt('select a from t where n = @name', { dialect: 'transactsql' })).toContain('n = @name');
    expect(fmt('select a from t where n = @name', { dialect: 'bigquery' })).toContain('n = @name');
    expect(fmt('select a from t where n = :1 and m = :name', { dialect: 'plsql' })).toContain('n = :1');
    expect(fmt('select a from t where n = $1', { dialect: 'duckdb' })).toContain('n = $1');
    expect(fmt('select {id:UInt32} as a', { dialect: 'clickhouse' })).toContain('{id:UInt32}');
  });

  it('numbers as written', () => {
    expect(fmt('select 1e10, 0x1F, .5, 1.50, -2 from t')).toBe(
      lines('SELECT', '  1e10,', '  0x1F,', '  .5,', '  1.50,', '  -2', 'FROM', '  t'),
    );
  });

  it('a string with a line break keeps its own CRLF; the layout is LF', () => {
    expect(fmt("select 'a\r\nb' from t")).toBe("SELECT\n  'a\r\nb'\nFROM\n  t");
  });

  it('# is a comment in MySQL, MariaDB, BigQuery and ClickHouse, an operator in PostgreSQL, SQL Server and Redshift, an error elsewhere', () => {
    for (const dialect of ['mysql', 'mariadb', 'bigquery', 'clickhouse'] as const)
      expect(fmt('select 1 # c\nfrom t', { dialect }), dialect).toBe(lines('SELECT', '  1 # c', 'FROM', '  t'));
    for (const dialect of ['postgresql', 'transactsql', 'redshift'] as const)
      expect(fmt('select 1 # c\nfrom t', { dialect }), dialect).toBe(lines('SELECT', '  1 # c', 'FROM', '  t'));
    for (const dialect of ['sql', 'sqlite', 'plsql', 'snowflake', 'spark', 'trino', 'duckdb'] as const)
      expect(err('select 1 # c\nfrom t', { dialect }), dialect).toMatch(/^Line 1, column 10: unexpected "# c"/);
  });

  it('a line comment with U+2028 in it stays a comment (the library alone prints its rest as code — §15)', () => {
    const text = 'select a -- c\u2028d\nfrom t';
    expect(library.formatDialect(text, { dialect: library.sql })).toBe('select\n  a - - c d\nfrom\n  t');
    expect(fmt(text)).toBe(lines('SELECT', '  a -- c\u2028d', 'FROM', '  t'));
    expect(fmt('select a # x\u2029y\nfrom t', { dialect: 'mysql' })).toBe(
      lines('SELECT', '  a # x\u2029y', 'FROM', '  t'),
    );
  });

  it('no hint outside Standard SQL, and none without a sign of another syntax', () => {
    expect(err('select (a from t', { dialect: 'postgresql' })).toBe(
      'Line 1, column 17: the query ends too early (an unclosed parenthesis or CASE?)',
    );
    // `::` inside a string is not a sign.
    expect(err("select '::' as a, (b from t")).toBe(
      'Line 1, column 28: the query ends too early (an unclosed parenthesis or CASE?)',
    );
  });

  it('the error place counts CRLF as one line break', () => {
    expect(err('select 1\r\nfrom t\r\nwhere x = 1)')).toBe('Line 3, column 12: unexpected ")"');
  });

  it('the result never ends with a line break', () => {
    expect(fmt('select 1;\n\n')).toBe(lines('SELECT', '  1;'));
    expect(fmt('select 1 -- c\n')).toBe(lines('SELECT', '  1 -- c'));
  });

  it('thousands of nested parentheses: refused at the bracket past MAX_NESTING, before the library (§15)', () => {
    expect(err(`select ${'('.repeat(5000)}1${')'.repeat(5000)}`)).toBe(
      'Line 1, column 208: brackets nest more than 200 levels deep: the formatter would take too long',
    );
  });

  it('MAX_NESTING: 200 nested subqueries format (§12), 201 brackets are refused at the 201st', () => {
    const subqueries = (n: number) => `${'select * from ('.repeat(n)}select 1${') x'.repeat(n)}`;
    expect(MAX_NESTING).toBe(200);
    expect(fmt(subqueries(200)).split('\n').length).toBeGreaterThan(200);
    expect(err(subqueries(201))).toBe(
      `Line 1, column ${15 * 201}: brackets nest more than 200 levels deep: the formatter would take too long`,
    );
    // Two siblings of 150 levels each are 150 deep, not 300.
    expect(fmt(`select ${'('.repeat(150)}1${')'.repeat(150)} + ${'('.repeat(150)}2${')'.repeat(150)}`)).toContain('2');
  });

  it('brackets in strings, quoted names and comments do not count; square brackets in code do', () => {
    const deepText = `'${'('.repeat(300)}'`;
    expect(fmt(`select ${deepText}`)).toBe(lines('SELECT', `  ${deepText}`));
    expect(fmt(`select 1 -- ${'('.repeat(300)}`)).toBe(lines('SELECT', `  1 -- ${'('.repeat(300)}`));
    expect(fmt(`select 1 /* ${'['.repeat(300)} */`)).toContain('/* [[[');
    expect(fmt(`select "${'('.repeat(300)}" from t`, { dialect: 'postgresql' })).toContain('"(((');
    expect(bracketsDeeperThan(`select [${'('.repeat(300)}] from t`, 'transactsql', 200)).toBeNull();
    expect(bracketsDeeperThan(`select a${'['.repeat(201)}`, 'postgresql', 200)).toBe(208);
    // A closing bracket without an opening one does not make room for more.
    expect(bracketsDeeperThan(`${')'.repeat(50)}${'('.repeat(201)}`, 'sql', 200)).toBe(250);
  });

  it('the bracket scan is linear in the text', () => {
    const make = (n: number) =>
      `select ${'(1 + '.repeat(100)}'${'('.repeat(n)}'${')'.repeat(100)} -- ${'['.repeat(n)}\n`;
    expect(growth(text => bracketsDeeperThan(text, 'postgresql', MAX_NESTING), make, 64 * 1024)).toBeLessThan(
      GROWTH_BOUND,
    );
  });

  it('the library’s own disable comments print the text between as it stands', () => {
    expect(fmt('/* sql-formatter-disable */select   1 /* x\n/* sql-formatter-enable */')).toBe(
      '/* sql-formatter-disable */select   1 /* x\n/* sql-formatter-enable */',
    );
  });
});
