/** zstd both ways (§5.9): libzstd's wasm is built into this worker's file, loaded only when zstd is chosen. */
import { serve } from './workers/serve';
import { zstdBytes } from './workers/zstdModule';

serve({ zstd: zstdBytes });
