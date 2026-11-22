/**
 * One module worker per dialect, each a file of its own in this package (docs/tools/specs/sql-format.md §9, §11, §15).
 * The bundler builds a worker as one file and cannot split it, so a worker that chose its dialect at run time would
 * carry all 14; instead every dialect has its worker — the library's core and that dialect — and the page starts the
 * one the person chose. Loaded from the package's files under the pages' `script-src 'self'`, never `blob:` or `data:`;
 * the URLs are written out one by one because the bundler finds workers only by a literal `new URL(…)`.
 */
import type { WorkerLike } from './runner';
import type { SqlDialect } from '@workspace/tool-logic-sql-format';

const WORKERS: Record<SqlDialect, () => Worker> = {
  sql: () =>
    new Worker(new URL('./dialects/sql.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-sql',
    }),
  postgresql: () =>
    new Worker(new URL('./dialects/postgresql.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-postgresql',
    }),
  mysql: () =>
    new Worker(new URL('./dialects/mysql.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-mysql',
    }),
  mariadb: () =>
    new Worker(new URL('./dialects/mariadb.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-mariadb',
    }),
  sqlite: () =>
    new Worker(new URL('./dialects/sqlite.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-sqlite',
    }),
  transactsql: () =>
    new Worker(new URL('./dialects/transactsql.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-transactsql',
    }),
  plsql: () =>
    new Worker(new URL('./dialects/plsql.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-plsql',
    }),
  bigquery: () =>
    new Worker(new URL('./dialects/bigquery.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-bigquery',
    }),
  snowflake: () =>
    new Worker(new URL('./dialects/snowflake.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-snowflake',
    }),
  redshift: () =>
    new Worker(new URL('./dialects/redshift.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-redshift',
    }),
  spark: () =>
    new Worker(new URL('./dialects/spark.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-spark',
    }),
  trino: () =>
    new Worker(new URL('./dialects/trino.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-trino',
    }),
  duckdb: () =>
    new Worker(new URL('./dialects/duckdb.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-duckdb',
    }),
  clickhouse: () =>
    new Worker(new URL('./dialects/clickhouse.worker.ts', import.meta.url), {
      type: 'module',
      name: 'sql-format-clickhouse',
    }),
};

export const startSqlWorker = (dialect: SqlDialect): WorkerLike => WORKERS[dialect]() as unknown as WorkerLike;
