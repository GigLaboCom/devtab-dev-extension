/**
 * @workspace/tool-logic-sql-format — the SQL Formatter tool's logic: the pure functions of its specification's §9
 * (logic.ts), the dialects' quoting (lexis.ts), the token check of the promise (tokens.ts) and formatting with the
 * library (format.ts, which only a worker of the tool calls; the page never reaches `sql-formatter`).
 */
export * from './logic';
// What the component takes from the shared JSON scanner (docs/tools/README.md, «Общий сканер JSON»): strict UTF-8 for
// files and the limits of showing a result (json §12).
export { decodeTextFile, SHOW_RESULT_CHARS, SHOW_RESULT_LINES } from '@workspace/tools-shared/json-scan';
export { sqlTokens, firstChange } from './tokens';
export type { SqlToken } from './tokens';
export { formatSql } from './format';
export type { DialectOptions } from './format';
