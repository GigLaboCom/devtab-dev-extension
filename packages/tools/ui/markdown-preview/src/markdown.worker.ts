/**
 * Renders a large input off the page's thread (docs/tools/specs/markdown-preview.md §12, §15): markdown-it on a
 * megabyte of the pathological shapes (`![` repeated, nested brackets) runs for seconds, which would hold the page. The
 * request is the Markdown; the reply is markdown-it's HTML string, which the page still rebuilds through the allowlist
 * (a worker has no DOM). The logic and markdown-it are bundled into this worker (a worker is built as one file). Loaded
 * from this file by `renderer.ts` — never from `blob:` or `data:`. Cancelling is the page terminating the worker.
 */
import { renderMarkdown } from '@workspace/tool-logic-markdown-preview';

export type RenderRequest = { id: number; source: string };
export type RenderReply = { id: number; html: string } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<RenderRequest>) => void) | null;
  postMessage: (reply: RenderReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, html: renderMarkdown(data.source) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
