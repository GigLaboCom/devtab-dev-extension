/**
 * The conversion off the page's thread for a large SVG (docs/tools/specs/svg-to-css.md §12, §15): above 256 Ki characters
 * the cleanup, the quotes, the encoding and the sizes take a few hundred milliseconds in Chrome (4 Mi: about 0.2 s
 * URL-encoded, 0.35 s Base64) — time the page would stand still. The page has already checked the SVG with its own
 * `DOMParser` (a worker has none); this runs the rest. The logic is bundled into this worker (a worker is built as one
 * file); loaded from this file by `converter.ts` — never from `blob:` or `data:`. Cancelling is terminating it.
 */
import { convertSvg } from '@workspace/tool-logic-svg-to-css';
import type { SvgOptions, SvgResult } from '@workspace/tool-logic-svg-to-css';

export interface ConvertRequest {
  id: number;
  text: string;
  options: SvgOptions;
}
export type ConvertReply = { id: number; result: SvgResult } | { id: number; failure: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ConvertRequest>) => void) | null;
  postMessage: (reply: ConvertReply) => void;
};

scope.onmessage = ({ data }) => {
  try {
    scope.postMessage({ id: data.id, result: convertSvg(data.text, data.options) });
  } catch (error) {
    scope.postMessage({ id: data.id, failure: error instanceof Error ? error.message : String(error) });
  }
};
