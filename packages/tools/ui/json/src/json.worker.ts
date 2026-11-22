/**
 * Prints a large input off the page's thread (docs/tools/specs/json.md §12, §15): Run on 256 Ki to 32 Mi characters
 * takes up to about a second, which would hold the page. The request is the text and the options; the reply is the
 * result and its size, counted here rather than on the page. The logic is bundled into this worker (a worker is built
 * as one file). Loaded from this file by `runner.ts` — never from `blob:` or `data:`. Cancelling is the page terminating
 * the worker.
 */
import { printWithSize } from './printing';
import type { Printed, PrintJob } from './printing';

export type PrintRequest = PrintJob & { id: number };
export type PrintReply = ({ id: number } & Printed) | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<PrintRequest>) => void) | null;
  postMessage: (reply: PrintReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, ...printWithSize(data) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
