/**
 * Generates the types of a large sample off the page's thread (docs/tools/specs/json-to-code.md §12, §15): Generate on
 * 1 to 16 MiB characters reads the whole sample with the exact scanner, which would hold the page for a noticeable
 * moment. The request is the text and the options; the reply is the result. The logic is bundled into this worker (a
 * worker is built as one file). Loaded from this file by `runner.ts` — never from `blob:` or `data:`. Cancelling is the
 * page terminating the worker.
 */
import { jsonToCode } from '@workspace/tool-logic-json-to-code';
import type { CodeOptions, CodeResult } from '@workspace/tool-logic-json-to-code';

export type GenerateRequest = { id: number; text: string; options: CodeOptions };
export type GenerateReply = { id: number; result: CodeResult } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<GenerateRequest>) => void) | null;
  postMessage: (reply: GenerateReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, result: jsonToCode(data.text, data.options) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
