/**
 * Converts a large input off the page's thread (docs/tools/specs/json-csv.md §12, §15): Run on 256 Ki to 32 Mi
 * characters takes up to about a second (most of it reading 20 MB of JSON exactly), which would hold the page. The
 * request is the job; the reply is the result and its size, counted here rather than on the page. The logic is bundled
 * into this worker (a worker is built as one file). Loaded from this file by `runner.ts` — never from `blob:` or
 * `data:`. Cancelling is the page terminating the worker.
 */
import { convertWithSize } from './conversion';
import type { ConvertJob, Done } from './conversion';

export type ConvertRequest = ConvertJob & { id: number };
export type ConvertReply = ({ id: number } & Done) | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (reply: ConvertReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, ...convertWithSize(data) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
