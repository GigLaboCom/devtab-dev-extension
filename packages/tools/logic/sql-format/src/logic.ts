/**
 * The SQL Formatter tool's logic (docs/tools/specs/sql-format.md §9): the dialects and options, the library's option
 * object, the unclosed-comment check, the translation of the library's errors, the dialect hint and `detectSql`. Pure
 * and without the library: these functions and their tests never load `sql-formatter` (format.ts does, in the worker).
 */
import { scanSql } from './lexis';
import { positionOf } from '@workspace/tools-shared/json-scan';
import type { JsonErrorInfo } from '@workspace/tools-shared/json-scan';

export type SqlDialect =
  | 'sql'
  | 'postgresql'
  | 'mysql'
  | 'mariadb'
  | 'sqlite'
  | 'transactsql'
  | 'plsql'
  | 'bigquery'
  | 'snowflake'
  | 'redshift'
  | 'spark'
  | 'trino'
  | 'duckdb'
  | 'clickhouse';

export type KeywordCase = 'upper' | 'lower' | 'preserve';
export type SqlIndent = 2 | 4 | 'tab';
export type SqlLayout = 'standard' | 'tabularLeft' | 'tabularRight';

export interface SqlOptions {
  dialect: SqlDialect;
  keywordCase: KeywordCase;
  indent: SqlIndent;
  layout: SqlLayout;
}

/** An error with its place in the input, or one the library gave without a place (§5 п. 8). */
export type SqlError = JsonErrorInfo | { message: string };

export type SqlResult = { ok: true; text: string } | { ok: false; error: SqlError };

/** §12: up to this many characters the result follows the input (150 ms after the last edit), above — by Run. */
export const LIVE_INPUT = 32 * 1024;
/** §12: the largest input the tool formats; a larger one is refused (§6). */
export const MAX_INPUT = 2 * 1024 * 1024;
/** §9: the pause after the last edit before a live run. */
export const SETTLE_MS = 150;
/**
 * How long one run may take in the worker before it is stopped (§15: not in the specification). 2 MiB is about 3 s in
 * Node (§12) and a little more in Chrome; a run past this limit is a pathological input, not a slow machine.
 */
export const TIME_LIMIT_MS = 15_000;

/** The dialects in the order of the Dialect list (§4); the first is the default. */
export const DIALECTS: readonly SqlDialect[] = [
  'sql',
  'postgresql',
  'mysql',
  'mariadb',
  'sqlite',
  'transactsql',
  'plsql',
  'bigquery',
  'snowflake',
  'redshift',
  'spark',
  'trino',
  'duckdb',
  'clickhouse',
];

export const DIALECT_LABELS: Record<SqlDialect, string> = {
  sql: 'Standard SQL',
  postgresql: 'PostgreSQL',
  mysql: 'MySQL',
  mariadb: 'MariaDB',
  sqlite: 'SQLite',
  transactsql: 'SQL Server',
  plsql: 'Oracle PL/SQL',
  bigquery: 'BigQuery',
  snowflake: 'Snowflake',
  redshift: 'Redshift',
  spark: 'Spark',
  trino: 'Trino',
  duckdb: 'DuckDB',
  clickhouse: 'ClickHouse',
};

/** The state the page opens in (§4). */
export const DEFAULT_OPTIONS: SqlOptions = { dialect: 'sql', keywordCase: 'upper', indent: 2, layout: 'standard' };

export const isDialect = (value: unknown): value is SqlDialect =>
  typeof value === 'string' && (DIALECTS as readonly string[]).includes(value);
export const isKeywordCase = (value: unknown): value is KeywordCase =>
  value === 'upper' || value === 'lower' || value === 'preserve';
export const isIndent = (value: unknown): value is SqlIndent => value === 2 || value === 4 || value === 'tab';
export const isLayout = (value: unknown): value is SqlLayout =>
  value === 'standard' || value === 'tabularLeft' || value === 'tabularRight';

/**
 * §5 п. 2: the full option object for `formatDialect`, minus the dialect. Only the four choices of the page vary; the
 * library's parameters (`?`, `$1`, `:name`, `@name`) are left to the dialect — no `paramTypes`.
 */
export const libraryOptions = (options: SqlOptions): Record<string, unknown> => ({
  keywordCase: options.keywordCase,
  dataTypeCase: options.keywordCase,
  functionCase: 'preserve',
  identifierCase: 'preserve',
  // §5 п. 3: Tabular lays out with spaces whatever `useTabs` says; the page does not offer Tab with it.
  tabWidth: options.indent === 4 ? 4 : 2,
  useTabs: options.indent === 'tab' && options.layout === 'standard',
  indentStyle: options.layout,
  logicalOperatorNewline: 'before',
  expressionWidth: 50,
  linesBetweenQueries: 1,
  denseOperators: false,
  newlineBeforeSemicolon: false,
});

/** §5 п. 6: the offset of a `/*` that never closes, or null. Strings, quoted names and line comments are skipped. */
export const findUnclosedComment = (text: string, dialect: SqlDialect): number | null => {
  let found: number | null = null;
  scanSql(text, dialect, span => {
    if (span.kind === 'block-comment' && !span.closed) found = span.start;
  });
  return found;
};

export const UNCLOSED_COMMENT = 'unclosed comment: /* without */';
export const ENDS_TOO_EARLY = 'the query ends too early (an unclosed parenthesis or CASE?)';

/** The library counts lines by `\n` alone and columns in UTF-16 units from 1 (§5 п. 8); the offset in the text. */
const offsetOf = (text: string, line: number, column: number): number => {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', start);
    if (next === -1) return text.length;
    start = next + 1;
  }
  return Math.min(start + column - 1, text.length);
};

/** Up to 10 characters from `offset`, up to the first line break, never half of a surrogate pair (§5 п. 8). */
const pieceAt = (text: string, offset: number): string => {
  let piece = text.slice(offset, offset + 10);
  const lineBreak = piece.search(/[\r\n]/);
  if (lineBreak !== -1) piece = piece.slice(0, lineBreak);
  const last = piece.charCodeAt(piece.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) piece = piece.slice(0, -1);
  return piece;
};

/** A token the parser did not expect, as the person reads it: its first line, at most 40 characters (§15). */
const tokenText = (token: string): string => {
  const line = token.split(/[\r\n]/)[0]!;
  return line.length > 40 || line.length < token.length ? `${line.slice(0, 40)}…` : line;
};

const LEXER_ERROR = /^Parse error: Unexpected "[\s\S]*?" at line (\d+) column (\d+)/;
const PARSER_ERROR = /^Parse error at token: ([\s\S]*?) at line (\d+) column (\d+)/;
export const TOO_DEEP = 'the query is nested too deeply to lay out';

/** §5 п. 9: the dialects to try for what the text shows of another syntax, outside its strings and comments. */
const HINTS: ReadonlyArray<[RegExp, string]> = [
  [/`/, 'MySQL, MariaDB, BigQuery, Spark, ClickHouse'],
  [/::/, 'PostgreSQL, Redshift, DuckDB, Snowflake'],
  [/\[[^\]\r\n]{0,256}\]/, 'SQL Server'],
  [/(?:^|[\r\n])[ \t]*#/, 'MySQL, MariaDB'],
  [/\$\d/, 'PostgreSQL, DuckDB'],
];

/** The code of a Standard SQL text with its strings, double-quoted names and comments blanked out (same length). */
const codeOf = (text: string): string => {
  let code = '';
  let at = 0;
  scanSql(text, 'sql', span => {
    // A backtick name stays: it is the first sign of §5 п. 9 itself.
    if (span.kind === 'identifier' && text[span.start] === '`') return;
    code += text.slice(at, span.start) + ' '.repeat(span.end - span.start);
    at = span.end;
  });
  return code + text.slice(at);
};

/** §5 п. 9: `. Standard SQL doesn't have this syntax; try …` — only for Standard SQL and a sign of another syntax. */
export const dialectHint = (text: string, dialect: SqlDialect): string => {
  if (dialect !== 'sql') return '';
  const code = codeOf(text);
  const found = HINTS.find(([sign]) => sign.test(code));
  return found ? `. Standard SQL doesn't have this syntax; try ${found[1]}.` : '';
};

/** §5 п. 8–9: a library error message to our text and place (the place is the input's, `positionOf` of json-scan). */
export const mapLibraryError = (text: string, message: string, dialect: SqlDialect): SqlError => {
  const hint = dialectHint(text, dialect);
  const at = (line: string, column: string, what: (offset: number) => string): JsonErrorInfo => {
    const offset = offsetOf(text, Number(line), Number(column));
    return { message: what(offset) + hint, offset, ...positionOf(text, offset) };
  };
  const lexer = LEXER_ERROR.exec(message);
  if (lexer) return at(lexer[1]!, lexer[2]!, offset => `unexpected "${pieceAt(text, offset)}"`);
  const parser = PARSER_ERROR.exec(message);
  if (parser)
    return at(parser[2]!, parser[3]!, () =>
      parser[1] === '«EOF»' ? ENDS_TOO_EARLY : `unexpected "${tokenText(parser[1]!)}"`,
    );
  // §15: the parser recurses; thousands of nested parentheses or CASEs run out of stack.
  if (/^Maximum call stack size exceeded/.test(message)) return { message: TOO_DEEP };
  return { message: (message.split('\n')[0] ?? '') + hint };
};

/** `Line L, column C: message`, or the message alone when it has no place. */
export const describeError = (error: SqlError): string =>
  'line' in error ? `Line ${error.line}, column ${error.column}: ${error.message}` : error.message;

// §7. `name` — `[\w."`[\]]+`; every form is anchored at the start of the text after its leading comments.
const NAME = '[\\w."`[\\]]+';
const PRIVILEGES =
  'select|insert|update|delete|all|usage|execute|references|trigger|create|connect|temporary|temp|truncate|alter|drop|index|maintain';
const SQL_FORMS: readonly RegExp[] = [
  new RegExp(
    `^select\\s+(?:(?:distinct|top\\s+\\d+)\\s+)?(?:\\*|${NAME}(?:\\s*[,(]|\\s+(?:from|as)\\b|[ \\t]*(?:\\r?\\n|\\r|$)))`,
    'i',
  ),
  new RegExp(`^with\\s+(?:recursive\\s+)?${NAME}\\s+as\\s*\\(`, 'i'),
  new RegExp(`^insert\\s+(?:into\\s+)?${NAME}\\s*(?:\\(|values\\b|select\\b)`, 'i'),
  new RegExp(`^update\\s+${NAME}(?:\\s+${NAME})?\\s+set\\b`, 'i'),
  new RegExp(`^delete\\s+from\\s+${NAME}\\s*(?:where\\b|;|$)`, 'i'),
  /^(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:(?:temporary|temp|unique)\s+)?(?:table|view|index|schema|database|function|procedure|trigger|sequence|type)\b/i,
  /^merge\s+into\b/i,
  /^explain\s+(?:analyze\s+)?(?:select|with|insert|update|delete)\b/i,
  new RegExp(`^truncate\\s+(?:table\\s+)?${NAME}[ \\t]*;?[ \\t]*(?:\\r?\\n|\\r|$)`, 'i'),
  // `GRANT | REVOKE … ON` — narrowed to a privilege first (§15): "Grant him access on Monday" is prose.
  new RegExp(
    `^(?:grant|revoke)\\s+(?:grant\\s+option\\s+for\\s+)?(?:${PRIVILEGES})\\b[^;\\r\\n]*?\\son\\s+${NAME}`,
    'i',
  ),
];
const DETECT_MAX = 1024 * 1024;
const DETECT_HEAD = 4 * 1024;

/** The text after its leading line and block comments and white space; null when a block comment never closes. */
const afterLeadingComments = (text: string): string | null => {
  let at = 0;
  for (;;) {
    while (at < text.length && /\s/.test(text[at]!)) at++;
    if (text.startsWith('--', at)) {
      const end = text.slice(at).search(/[\r\n]/);
      if (end === -1) return '';
      at += end;
    } else if (text.startsWith('/*', at)) {
      const end = text.indexOf('*/', at + 2);
      if (end === -1) return null;
      at = end + 2;
    } else return text.slice(at);
  }
};

/**
 * §7: does pasted text look like SQL? Cheap and strict — it decides whether the tool opens without asking: one of the
 * statement forms at the start of the first 4 Ki characters. Prose that begins with "Select", "Update" or "Delete" is
 * told apart by what follows the first words.
 */
export const detectSql = (text: string): boolean => {
  const trimmed = text.trim();
  if (trimmed.length < 1 || trimmed.length > DETECT_MAX) return false;
  const head = afterLeadingComments(trimmed.slice(0, DETECT_HEAD));
  return head !== null && head !== '' && SQL_FORMS.some(form => form.test(head));
};

/**
 * What makes a query a secret for the history (docs/tools/history.md §10 row 21, the cautious reading of §15): a
 * password or a secret key written by the statement's own syntax — `IDENTIFIED BY`, `PASSWORD '…'`, `SECRET '…'`,
 * `CREDENTIALS '…'`, a connection string with `user:password@`. A column named `password` in a SELECT is not one.
 */
// Bounded repetitions only: the input can be 2 MiB, and every sign must stay linear on it (adding-a-tool.md §7).
const SECRET_SIGNS: readonly RegExp[] = [
  /\bset[ \t\r\n]{1,64}password\b/i,
  /\bidentified[ \t\r\n]{1,64}(?:with[ \t\r\n]{1,64}[\w$]{1,64}[ \t\r\n]{1,64})?(?:by|as)\b/i,
  /\b(?:password|passwd|pwd|secret|secret_key|\w{0,32}secret_access_key|aws_secret_key|credentials|access_token|api_key)[ \t\r\n]{0,64}(?:=[ \t\r\n]{0,64})?(?:\([ \t\r\n]{0,64})?(?:'|"|\$\w{0,64}\$)/i,
  /\b[a-z][a-z0-9+.-]{0,31}:\/\/[^\s/@'"]{0,256}:[^\s/@'"]{1,256}@/i,
];

export const holdsCredentials = (text: string): boolean => SECRET_SIGNS.some(sign => sign.test(text));
