/**
 * Converts a large command off the page's thread (docs/tools/specs/curl-to-code.md §12, §15): Convert on 1 to 16 MiB
 * characters takes up to about 0.8 s (a body in $'…' or "…" in Node; measured in the specification's §15), which would
 * hold the page. Loaded from this file by `runner.ts` — never from `blob:` or `data:`. Cancelling is the page
 * terminating the worker.
 */
import { curlToCode } from '@workspace/tool-logic-curl-to-code';
import type { CodeResult, Target } from '@workspace/tool-logic-curl-to-code';

export interface ConvertRequest {
  id: number;
  text: string;
  target: Target;
}
export type ConvertReply = { id: number; result: CodeResult } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (reply: ConvertReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, result: curlToCode(data.text, data.target) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
