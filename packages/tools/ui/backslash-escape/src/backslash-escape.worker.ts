/**
 * Runs the tool off the page's thread for a large input (docs/tools/specs/backslash-escape.md §12: above 1 Mi
 * characters, up to 5 Mi, where a walk over text dense with escapes takes a few hundred milliseconds). The request is
 * the job; the reply is the logic's answer. The logic is bundled into this worker (a worker is built as one file).
 * Loaded from this file by `compute.ts` — never from `blob:` or `data:`. Cancelling is the page terminating the worker.
 */
import { runJob } from './work';
import type { Computed, Job } from './work';

export interface BackslashEscapeRequest extends Job {
  id: number;
}
export type BackslashEscapeReply = { id: number; computed: Computed } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<BackslashEscapeRequest>) => void) | null;
  postMessage: (reply: BackslashEscapeReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, computed: runJob(data) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
