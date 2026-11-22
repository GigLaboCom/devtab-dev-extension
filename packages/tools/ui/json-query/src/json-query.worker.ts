/**
 * The JSON Query tool's worker (docs/tools/specs/json-query.md §5 п. 27): reads the document with the shared scanner
 * and runs queries over it off the page's thread, so a query that takes long (a descendant query inside a filter on a
 * large array, a pattern that backtracks) freezes nothing but this worker, which the page terminates at the limit
 * (runner.ts). It keeps the last document's tree: a new query over the same document is not read again. Wiring only —
 * the work is the logic's `readDocument` and `runQuery`. Loaded from this file of the package (startWorker.ts), never
 * from `blob:` or `data:`. An exception inside a job is answered as `{ ok: false, where: 'query', message }`.
 */
import { documentNotes, readDocument, runQuery } from '@workspace/tool-logic-json-query';
import type { JobMessage, JobReply, JobResult } from './runner';
import type { DocumentResult } from '@workspace/tool-logic-json-query';

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: { data: JobMessage }) => void) | null;
  postMessage: (reply: JobReply) => void;
};

let held: { docId: number; read: DocumentResult; notes: string[] } | null = null;

const work = ({ request }: JobMessage): JobResult => {
  if (request.document !== undefined) {
    const read = readDocument(request.document);
    held = { docId: request.docId, read, notes: read.ok ? documentNotes(read.notes) : [] };
  }
  if (!held || held.docId !== request.docId)
    return { ok: false, where: 'query', message: 'the document did not reach the worker' };
  if (!held.read.ok) return { ok: false, where: 'document', error: held.read.error };
  const result = runQuery(request.query, held.read.root);
  return result.ok ? { ...result, notes: held.notes } : result;
};

scope.onmessage = ({ data }) => {
  let result: JobResult;
  try {
    result = work(data);
  } catch (error) {
    result = {
      ok: false,
      where: 'query',
      message: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  }
  scope.postMessage({ id: data.id, result });
};
