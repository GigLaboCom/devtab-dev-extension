/**
 * The RegExp tool's worker (docs/tools/specs/regexp.md §5 п. 24–28): runs a job off the page's thread, so a pattern
 * that backtracks for ever freezes nothing but this worker, which the page terminates at the limit (runner.ts). Wiring
 * only: the matching is the logic's `runRegexp`. Loaded from this file of the package (startWorker.ts) — never from
 * `blob:` or `data:`. An exception inside a job (a RangeError, anything) is answered as `{ ok: false, message }`.
 */
import { runRegexp } from '@workspace/tool-logic-regexp';
import type { JobMessage, JobReply } from './runner';
import type { RunResult } from '@workspace/tool-logic-regexp';

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: { data: JobMessage }) => void) | null;
  postMessage: (reply: JobReply) => void;
};

scope.onmessage = ({ data }) => {
  let result: RunResult;
  try {
    result = runRegexp(data.request);
  } catch (error) {
    result = { ok: false, message: error instanceof Error ? `${error.name}: ${error.message}` : String(error) };
  }
  scope.postMessage({ id: data.id, result });
};
