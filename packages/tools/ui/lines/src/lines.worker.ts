/**
 * Runs the steps off the page's thread for a large input (docs/tools/specs/lines.md §12: up to 200,000 lines and 8 Mi
 * characters, where sorting takes up to half a second): the request is the text, the pipeline and the shuffle tape's
 * bytes so far; the reply is the result and, when Shuffle had to read past them, the grown tape — the page keeps it, so
 * the next run draws the same order (§5.9.6). The logic is bundled into this worker (a worker is built as one file).
 * Loaded from this file by `compute.ts` — never from `blob:` or `data:`. Cancelling is the page terminating the worker.
 */
import { createShuffleTape, runPipeline } from '@workspace/tool-logic-lines';
import type { Pipeline, PipelineResult } from '@workspace/tool-logic-lines';

export interface LinesRequest {
  id: number;
  text: string;
  pipeline: Pipeline;
  tape: Uint8Array;
}
export type LinesReply =
  { id: number; result: PipelineResult; tape: Uint8Array | null } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<LinesRequest>) => void) | null;
  postMessage: (reply: LinesReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    const tape = createShuffleTape(undefined, data.tape);
    const result = runPipeline(data.text, data.pipeline, tape.reader());
    const bytes = tape.bytes();
    scope.postMessage({ id: data.id, result, tape: bytes.length === data.tape.length ? null : bytes });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
