/**
 * Inspects a large text off the page's thread (docs/tools/specs/string-inspector.md §12, §15): above 64 Ki characters
 * the passes over the whole text — graphemes, words, the four normalisation forms, the scan for invisible and
 * look-alike characters — take from 40 ms (ASCII) to 300 ms (Chinese, the word dictionary) and up to half a second
 * (combining marks) on a megabyte in Chrome 159, which would hold the page. The request is the text; the reply is the
 * inspection. The logic is bundled into this worker (a worker is built as one file). Loaded from this file by
 * `runner.ts` — never from `blob:` or `data:`. Cancelling is the page terminating the worker.
 */
import { inspect } from '@workspace/tool-logic-string-inspector';
import type { Inspection } from '@workspace/tool-logic-string-inspector';

export type InspectRequest = { id: number; text: string };
export type InspectReply = { id: number; inspection: Inspection } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<InspectRequest>) => void) | null;
  postMessage: (reply: InspectReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, inspection: inspect(data.text) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
