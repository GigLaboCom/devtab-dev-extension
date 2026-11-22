/**
 * brotli compression (§5.9): the brotli package's encoder (JavaScript, 1.3 MB), loaded only when chosen — with the
 * reference decoder's wasm beside it, which checks every output before it leaves the worker (§15).
 */
import { brotliCompress } from './workers/brotliEncoder';
import { brotliBytes } from './workers/brotliModule';
import { serve } from './workers/serve';

serve({ brotliCompress, brotliDecoder: brotliBytes });
