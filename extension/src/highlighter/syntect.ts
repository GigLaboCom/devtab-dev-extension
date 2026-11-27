import { startReview } from '@extension/review-wasm/host';
import type { Highlighter } from './highlighter';

/** gpui-kit's `syntect` in one module with every language inside (packages/review-wasm/pkg). */
export const syntect: Highlighter = {
  id: 'syntect',
  start: (options, hooks) => startReview(options, hooks),
};
