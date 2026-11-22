/**
 * The pure functions of docs/tools/specs/sql-format.md §9, without the library: the options object (§5 п. 2), the
 * unclosed-comment check (§5 п. 6), the library's errors in words (§5 п. 8), the dialect hint (§5 п. 9), `detectSql`
 * (§7 — its table, the other tools' inputs, prose) and what makes a query a secret for the history (§15).
 */
import {
  firstChange,
  sqlTokens,
  DEFAULT_OPTIONS,
  DIALECTS,
  DIALECT_LABELS,
  LIVE_INPUT,
  MAX_INPUT,
  dialectHint,
  describeError,
  detectSql,
  findUnclosedComment,
  holdsCredentials,
  libraryOptions,
  mapLibraryError,
} from './index';
import { describe, expect, it } from 'vitest';

describe('dialects and defaults (§4)', () => {
  it('14 dialects in the order of the list, Standard SQL first and by default', () => {
    expect(DIALECTS.map(d => DIALECT_LABELS[d])).toEqual([
      'Standard SQL',
      'PostgreSQL',
      'MySQL',
      'MariaDB',
      'SQLite',
      'SQL Server',
      'Oracle PL/SQL',
      'BigQuery',
      'Snowflake',
      'Redshift',
      'Spark',
      'Trino',
      'DuckDB',
      'ClickHouse',
    ]);
    expect(DEFAULT_OPTIONS).toEqual({ dialect: 'sql', keywordCase: 'upper', indent: 2, layout: 'standard' });
    expect([LIVE_INPUT, MAX_INPUT]).toEqual([32 * 1024, 2 * 1024 * 1024]);
  });
});

describe('libraryOptions (§5 п. 2)', () => {
  it('fixes everything but the four choices; one case for keywords and data types', () => {
    expect(libraryOptions(DEFAULT_OPTIONS)).toEqual({
      keywordCase: 'upper',
      dataTypeCase: 'upper',
      functionCase: 'preserve',
      identifierCase: 'preserve',
      tabWidth: 2,
      useTabs: false,
      indentStyle: 'standard',
      logicalOperatorNewline: 'before',
      expressionWidth: 50,
      linesBetweenQueries: 1,
      denseOperators: false,
      newlineBeforeSemicolon: false,
    });
    expect(libraryOptions({ dialect: 'mysql', keywordCase: 'lower', indent: 4, layout: 'tabularRight' })).toMatchObject(
      {
        keywordCase: 'lower',
        dataTypeCase: 'lower',
        tabWidth: 4,
        useTabs: false,
        indentStyle: 'tabularRight',
      },
    );
    expect(libraryOptions({ ...DEFAULT_OPTIONS, indent: 'tab' })).toMatchObject({ useTabs: true });
    // Tabular aligns with spaces: Tab is not offered with it (§5 п. 3).
    expect(libraryOptions({ ...DEFAULT_OPTIONS, indent: 'tab', layout: 'tabularLeft' })).toMatchObject({
      useTabs: false,
    });
    expect(libraryOptions(DEFAULT_OPTIONS)).not.toHaveProperty('paramTypes');
  });
});

describe('findUnclosedComment (§5 п. 6)', () => {
  it('finds a /* without */ and skips strings, quoted names and line comments of the dialect', () => {
    expect(findUnclosedComment('select 1 /* abc', 'sql')).toBe(9);
    expect(findUnclosedComment('select 1 /* a */', 'sql')).toBeNull();
    expect(findUnclosedComment("select '/* x' from t", 'sql')).toBeNull();
    expect(findUnclosedComment("select 'it''s /* x' from t", 'sql')).toBeNull();
    expect(findUnclosedComment('select "a /* b" from t', 'sql')).toBeNull();
    expect(findUnclosedComment('select `a /* b` from t', 'mysql')).toBeNull();
    expect(findUnclosedComment('select [a /* b] from t', 'transactsql')).toBeNull();
    expect(findUnclosedComment('select [a /* b] from t', 'sql')).toBe(10);
    expect(findUnclosedComment('select 1 -- /* x\n', 'sql')).toBeNull();
    expect(findUnclosedComment('select 1 # /* x\n', 'mysql')).toBeNull();
    expect(findUnclosedComment('select 1 # /* x\n', 'sql')).toBe(11);
    expect(findUnclosedComment('select 1 // /* x\n', 'snowflake')).toBeNull();
  });

  it('dollar quotes where the library reads them (PostgreSQL, Snowflake, DuckDB, ClickHouse — not Redshift)', () => {
    for (const d of ['postgresql', 'snowflake', 'duckdb', 'clickhouse'] as const)
      expect(findUnclosedComment('select $tag$ /* $tag$ from t', d), d).toBeNull();
    expect(findUnclosedComment('select $$ /* $$ from t', 'redshift')).toBe(10);
    // A parameter is not a dollar tag.
    expect(findUnclosedComment('select $1 /* x', 'postgresql')).toBe(10);
  });

  it('escapes of each dialect: backslash in MySQL, E-strings in PostgreSQL, raw strings in BigQuery, q-quotes in Oracle', () => {
    expect(findUnclosedComment("select 'a\\' /* b' from t", 'mysql')).toBeNull();
    expect(findUnclosedComment("select 'a\\' /* b' from t", 'postgresql')).toBe(12);
    expect(findUnclosedComment("select E'a\\' /* b' from t", 'postgresql')).toBeNull();
    expect(findUnclosedComment("select r'a\\' /* b", 'bigquery')).toBe(13);
    expect(findUnclosedComment("select q'[it's /* x]' from dual", 'plsql')).toBeNull();
    expect(findUnclosedComment("select q'!a /* b!' from dual", 'plsql')).toBeNull();
    expect(findUnclosedComment("select '''a /* b''' as s", 'bigquery')).toBeNull();
  });

  it('nested comments where the dialect nests them; elsewhere the first */ closes', () => {
    expect(findUnclosedComment('select 1 /* a /* b */', 'postgresql')).toBe(9);
    expect(findUnclosedComment('select 1 /* a /* b */ */', 'postgresql')).toBeNull();
    expect(findUnclosedComment('select 1 /* a /* b */', 'sql')).toBeNull();
    expect(findUnclosedComment('select 1 /* a /* b */', 'transactsql')).toBe(9);
  });

  it('an unclosed string hides what follows it, as in the library (its error is the string’s)', () => {
    expect(findUnclosedComment("select 'abc /* x", 'sql')).toBeNull();
  });

  it('the library’s disable comments: what is between is not read', () => {
    expect(findUnclosedComment('/* sql-formatter-disable */ /* x', 'sql')).toBeNull();
  });

  it('is linear: a megabyte of strings and comments', () => {
    const text = "select 'a''b', /* c */ \"d\" -- e\n".repeat(32 * 1024);
    expect(findUnclosedComment(text, 'sql')).toBeNull();
    expect(findUnclosedComment(text + '/*', 'sql')).toBe(text.length);
  });
});

describe('mapLibraryError (§5 п. 8)', () => {
  it('lexer errors: the piece is ours, up to 10 characters and the first line break', () => {
    const text = 'select created::date from t';
    expect(
      mapLibraryError(
        text,
        'Parse error: Unexpected "::date fro" at line 1 column 15.\nThis likely happens…',
        'postgresql',
      ),
    ).toEqual({ message: 'unexpected "::date fro"', offset: 14, line: 1, column: 15 });
    expect(
      mapLibraryError('# c\nselect 1', 'Parse error: Unexpected "# c\nselect" at line 1 column 1.', 'sqlite'),
    ).toEqual({ message: 'unexpected "# c"', offset: 0, line: 1, column: 1 });
  });

  it('parser errors: «EOF» is a query that ends too early, any other token is unexpected', () => {
    expect(
      mapLibraryError(
        'select (a from t',
        'Parse error at token: «EOF» at line 1 column 17\nUnexpected EOF token…',
        'trino',
      ),
    ).toEqual({
      message: 'the query ends too early (an unclosed parenthesis or CASE?)',
      offset: 16,
      line: 1,
      column: 17,
    });
    expect(mapLibraryError('select a)', 'Parse error at token: ) at line 1 column 9\n…', 'trino')).toEqual({
      message: 'unexpected ")"',
      offset: 8,
      line: 1,
      column: 9,
    });
  });

  it('a long or multi-line token: its first line, at most 40 characters', () => {
    const text = `select a b '${'x'.repeat(50)}'`;
    expect(mapLibraryError(text, `Parse error at token: '${'x'.repeat(50)}' at line 1 column 12`, 'sql')).toMatchObject(
      {
        message: `unexpected "'${'x'.repeat(39)}…"`,
      },
    );
    expect(mapLibraryError("a 'b\nc'", "Parse error at token: 'b\nc' at line 1 column 3", 'sql')).toMatchObject({
      message: 'unexpected "\'b…"',
      column: 3,
    });
  });

  it('a stack overflow of the parser: nested too deeply, without a place (§15)', () => {
    expect(mapLibraryError('select ((((1))))', 'Maximum call stack size exceeded', 'sql')).toEqual({
      message: 'the query is nested too deeply to lay out',
    });
  });

  it('other messages: the first line as it is, without a place', () => {
    expect(mapLibraryError('x', 'Parse error: Invalid SQL\nmore', 'mysql')).toEqual({
      message: 'Parse error: Invalid SQL',
    });
    expect(describeError({ message: 'Parse error: Invalid SQL' })).toBe('Parse error: Invalid SQL');
  });

  it('the library counts lines by \\n; our place counts \\r\\n as one break and a lone \\r too', () => {
    // The library's "line 2 column 3" in `a\r\nbc)`: its line 1 is `a\r`, so column 3 of line 2 is the `)`.
    expect(mapLibraryError('a\r\nbc)', 'Parse error at token: ) at line 2 column 3', 'mysql')).toEqual({
      message: 'unexpected ")"',
      offset: 5,
      line: 2,
      column: 3,
    });
    // A lone \r is no line break to the library (line 1, column 5) and one to the person (line 2, column 1).
    expect(mapLibraryError('abc\r)', 'Parse error at token: ) at line 1 column 5', 'mysql')).toMatchObject({
      offset: 4,
      line: 2,
      column: 1,
    });
  });

  it('never cuts a surrogate pair in the piece', () => {
    const text = "select 'abcdefghi🙂' x";
    const error = mapLibraryError(text, 'Parse error: Unexpected "\'" at line 1 column 8.', 'sql');
    expect(error).toMatchObject({ message: 'unexpected "\'abcdefghi"' });
  });
});

describe('dialectHint (§5 п. 9)', () => {
  const hint = (text: string) => dialectHint(text, 'sql');
  it('the first sign in order: backtick, ::, […], # at a line start, $1', () => {
    expect(hint('select `a`::int')).toBe(
      ". Standard SQL doesn't have this syntax; try MySQL, MariaDB, BigQuery, Spark, ClickHouse.",
    );
    expect(hint('select a::int')).toBe(
      ". Standard SQL doesn't have this syntax; try PostgreSQL, Redshift, DuckDB, Snowflake.",
    );
    expect(hint('select [a b] from t')).toBe(". Standard SQL doesn't have this syntax; try SQL Server.");
    expect(hint('  # c\nselect 1')).toBe(". Standard SQL doesn't have this syntax; try MySQL, MariaDB.");
    expect(hint('select a from t where id = $1')).toBe(
      ". Standard SQL doesn't have this syntax; try PostgreSQL, DuckDB.",
    );
  });
  it('none without a sign, none inside strings and comments, none for another dialect', () => {
    expect(hint('select (a from t')).toBe('');
    expect(hint("select '::' as a, '[x]', 'a # b' -- $1\n")).toBe('');
    expect(hint('select a /* `x` */ from t')).toBe('');
    expect(hint('select a # b')).toBe('');
    expect(dialectHint('select a::int', 'postgresql')).toBe('');
  });
});

describe('detectSql (§7)', () => {
  it('says yes to the queries of the table', () => {
    for (const text of [
      'select * from t',
      'SELECT id, name FROM users',
      'select count(*) from t',
      'with a as (select 1) select * from a',
      'insert into t values (1)',
      'update t set a = 1',
      'delete from t where id = 1',
      'create table t (id int)',
      '-- c\nselect a from t',
      'drop table users;',
    ])
      expect(detectSql(text), text).toBe(true);
  });

  it('says no to prose that starts like a statement', () => {
    for (const text of [
      'Select the file from the list',
      'select a file',
      'Update the docs, then set a reminder',
      'Delete from the list everything old',
      'create a new branch',
    ])
      expect(detectSql(text), text).toBe(false);
  });

  it('says no to one word, to CSV and to JSON', () => {
    for (const text of ['SELECT', 'a,b\n1,2\n3,4', '{"a":1}']) expect(detectSql(text), text).toBe(false);
  });

  it('the other forms of §7', () => {
    for (const text of [
      'SELECT DISTINCT * FROM t',
      'select top 10 * from t',
      'select a as b from t',
      'select id\nfrom users',
      'WITH RECURSIVE r AS (select 1) select * from r',
      'insert t (a) values (1)',
      'insert into t select * from s',
      'update users u set a = 1',
      'delete from t;',
      'delete from t',
      'create or replace view v as select 1',
      'create unique index i on t (a)',
      'alter table t add column c int',
      'drop temporary table t',
      'create function f() returns int',
      'MERGE INTO t USING s ON (t.id = s.id)',
      'explain analyze select 1',
      'explain select 1',
      'truncate table t;',
      'TRUNCATE t',
      'grant select on t to r',
      'revoke all on schema s from r',
      'GRANT USAGE, SELECT ON SEQUENCE s TO app',
      '/* header */\n-- and a line\nselect a from t',
      'select [OrderId] from t',
      'select "Order", `x` from t',
    ])
      expect(detectSql(text), text).toBe(true);
  });

  it('says no to what other tools recognise and to ordinary text', () => {
    for (const text of [
      '{"select": "from"}',
      '[1, 2, 3]',
      'key: value\nlist:\n  - select',
      'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abc',
      'SGVsbG8gd29ybGQ=',
      'https://example.com/select?from=1',
      '550e8400-e29b-41d4-a716-446655440000',
      '0 9 * * 1-5',
      '1700000000',
      '#ff8800',
      '# Select a dialect\n\nThen paste the query.',
      '<select name="a"><option>1</option></select>',
      'curl -X DELETE https://example.com/items/1',
      'Select all the rows you need and press Delete.',
      'Update: the build is green.',
      'Drop me a line when you are back.',
      'Create the table in the kitchen.',
      'truncate the log file before the release',
      'Grant him access on Monday.',
      '/* only a comment',
      '-- only a comment',
      '',
      '   ',
    ])
      expect(detectSql(text), text).toBe(false);
  });

  it('looks at the first 4 Ki characters only, and refuses more than 1 Mi', () => {
    expect(detectSql(`${' '.repeat(10)}select * from t ${'x'.repeat(4 * 1024)}`)).toBe(true);
    expect(detectSql(`-- ${'c'.repeat(5000)}\nselect * from t`)).toBe(false);
    expect(detectSql(`select * from t ${'x'.repeat(1024 * 1024)}`)).toBe(false);
  });

  it('is cheap on the worst input it can get (a shape bound, not milliseconds)', () => {
    const worst = `update ${'a.'.repeat(500_000)}`;
    const started = performance.now();
    for (let i = 0; i < 3; i++) detectSql(worst);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});

describe('sqlTokens and firstChange: the token check of the promise', () => {
  it('tokens that are not white space; strings, names and comments whole; line comments without trailing spaces', () => {
    expect(sqlTokens("select a1,'x y' /* c */ -- d  \n 1e-5>=.5", 'sql').map(t => [t.kind, t.text])).toEqual([
      ['word', 'select'],
      ['word', 'a1'],
      ['other', ','],
      ['quoted', "'x y'"],
      ['comment', '/* c */'],
      ['comment', '-- d'],
      ['number', '1e-5'],
      ['other', '>'],
      ['other', '='],
      ['number', '.5'],
    ]);
  });

  it('white space and keyword case are no change; anything else is, at its place in the input', () => {
    expect(firstChange('select a from t', 'SELECT\n  a\nFROM\n  t', 'sql', false)).toBeNull();
    expect(firstChange('select a from t', 'SELECT\n  a\nFROM\n  t', 'sql', true)).toBe(0);
    expect(firstChange("select 'a  b'", "SELECT 'a b'", 'sql', false)).toBe(7);
    expect(firstChange('select 1 /* x', 'SELECT 1 / * x', 'sql', false)).toBe(9);
    expect(firstChange('select a - -1', 'select a --1', 'sql', false)).toBe(9);
    expect(firstChange('select 1e10', 'select 1E10', 'sql', false)).toBe(7);
    expect(firstChange('select ab', 'select a b', 'sql', false)).toBe(7);
    expect(firstChange('select a', 'select a, b', 'sql', false)).toBe(8);
  });

  it('is linear: a megabyte compared with itself', () => {
    const text = "select a, 'b''c', /* d */ 1.5 -- e\n".repeat(30_000);
    const started = performance.now();
    expect(
      firstChange(
        text,
        text.toUpperCase().replaceAll("'B''C'", "'b''c'").replaceAll('/* D */', '/* d */').replaceAll('-- E', '-- e'),
        'sql',
        false,
      ),
    ).toBeNull();
    expect(performance.now() - started).toBeLessThan(5_000);
  });
});

describe('holdsCredentials: what the history keeps only encrypted (§15)', () => {
  it('a password or a secret by the statement’s syntax', () => {
    for (const text of [
      "CREATE USER app IDENTIFIED BY 's3cret'",
      "create user 'app'@'%' identified with mysql_native_password by 'x'",
      "ALTER ROLE app WITH PASSWORD 'x'",
      "alter user app password = 'x'",
      "CREATE LOGIN app WITH PASSWORD = 'x'",
      "create secret s (type s3, key_id 'k', secret 'v')",
      "copy t from 's3://b/k' credentials 'aws_access_key_id=A;aws_secret_access_key=B'",
      "copy t from 's3://b/k' access_key_id 'A' secret_access_key 'B'",
      "create server s options (dsn 'postgres://app:pw@db.example.com/x')",
      "SET PASSWORD FOR app = 'x'",
    ])
      expect(holdsCredentials(text), text).toBe(true);
  });

  it('a column or a table named password is not a secret', () => {
    for (const text of [
      'select password, password_hash from users',
      'update users set password_hash = ? where id = ?',
      'create table secrets (id int, secret_value text)',
      "select * from t where name = 'identified'",
    ])
      expect(holdsCredentials(text), text).toBe(false);
  });

  it('stays linear on 2 MiB of the worst kind (bounded repetitions)', () => {
    const worst = `${'a'.repeat(1024 * 1024)}${'password '.repeat(100_000)}`;
    const started = performance.now();
    expect(holdsCredentials(worst)).toBe(false);
    expect(performance.now() - started).toBeLessThan(2_000);
  });
});
