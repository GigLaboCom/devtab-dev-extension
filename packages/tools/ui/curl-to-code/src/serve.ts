/**
 * The body of every Convert worker (families/<family>.worker.ts; docs/tools/specs/curl-to-code.md §12, §15): it receives
 * a large command and a target, converts it with the writers its file imported and answers. An exception inside a job
 * is answered as a failure, never thrown at the page.
 */
import { curlToCode } from '@workspace/tool-logic-curl-to-code';
import type { Clients, CodeResult, Target } from '@workspace/tool-logic-curl-to-code';

export interface ConvertRequest {
  id: number;
  text: string;
  target: Target;
}
export type ConvertReply = { id: number; result: CodeResult } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
export interface WorkerScope {
  onmessage: ((event: { data: ConvertRequest }) => void) | null;
  postMessage: (reply: ConvertReply) => void;
}

export const serve = (clients: Clients, scope: WorkerScope = self as unknown as WorkerScope): void => {
  scope.onmessage = ({ data }) => {
    try {
      const writer = clients[data.target];
      if (!writer) throw new Error(`no writer for ${data.target} in this worker`);
      scope.postMessage({ id: data.id, result: curlToCode(data.text, writer) });
    } catch (error) {
      scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
    }
  };
};
