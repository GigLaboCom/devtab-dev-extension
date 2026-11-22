/** brotli decompression (§5.9): Google's decoder as wasm, built into this worker's file, loaded only when chosen. */
import { brotliBytes } from './workers/brotliModule';
import { serve } from './workers/serve';

serve({ brotliDecoder: brotliBytes });
