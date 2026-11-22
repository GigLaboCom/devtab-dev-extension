/**
 * The body of every formatter worker (dialects/<id>.worker.ts): it receives a job, formats it with the dialect its file
 * imported and answers (docs/tools/specs/sql-format.md §9). It says `ready` once the library and the dialect are
 * loaded, so the page can tell a first load from a run. An exception inside a job — a stack overflow of the parser,
 * anything — is answered as an error, never thrown at the page.
 */
import { formatSql, mapLibraryError } from '@workspace/tool-logic-sql-format';
import type { DialectOptions, SqlOptions, SqlResult } from '@workspace/tool-logic-sql-format';

export interface FormatRequest {
  id: number;
  text: string;
  options: SqlOptions;
}

export type FormatReply = { type: 'ready' } | { type: 'result'; id: number; result: SqlResult };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
export interface WorkerScope {
  onmessage: ((event: { data: FormatRequest }) => void) | null;
  postMessage: (reply: FormatReply) => void;
}

export const serve = (dialect: DialectOptions, scope: WorkerScope = self as unknown as WorkerScope): void => {
  scope.onmessage = ({ data }) => {
    let result: SqlResult;
    try {
      result = formatSql(data.text, data.options, dialect);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      result = { ok: false, error: mapLibraryError(data.text, message, data.options.dialect) };
    }
    scope.postMessage({ type: 'result', id: data.id, result });
  };
  scope.postMessage({ type: 'ready' });
};
