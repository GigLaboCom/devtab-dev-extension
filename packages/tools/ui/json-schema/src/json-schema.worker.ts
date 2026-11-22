/**
 * The JSON Schema tool's worker (docs/tools/specs/json-schema.md §5 п. 40): reads the schemas and the document with the
 * shared scanner and checks the document off the page's thread, so a check that takes long (a pattern that
 * backtracks, a huge document) freezes nothing but this worker, which the page terminates at the limit (runner.ts).
 * Its session keeps the last schema and document read. Wiring only — the work is the logic's `Session` and
 * `runInference`. Loaded from this file of the package (startWorker.ts), never from `blob:` or `data:`; it fetches
 * nothing. An exception inside a job is answered as `{ id, error }`.
 */
import { runInference, Session } from '@workspace/tool-logic-json-schema';
import type { JobMessage, JobReply, JobResult } from './runner';

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: { data: JobMessage }) => void) | null;
  postMessage: (reply: JobReply) => void;
};

const session = new Session();

scope.onmessage = ({ data }) => {
  let result: JobResult;
  try {
    result =
      data.kind === 'validate'
        ? { kind: 'validate', reply: session.validate(data.request) }
        : { kind: 'infer', reply: runInference(data.samples, data.options) };
  } catch (error) {
    scope.postMessage({
      id: data.id,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    });
    return;
  }
  scope.postMessage({ id: data.id, result });
};
