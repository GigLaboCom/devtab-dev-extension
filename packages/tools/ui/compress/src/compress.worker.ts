/**
 * gzip, zlib and raw deflate off the page's thread (docs/tools/specs/compress.md §5.8): the browser's streams, no
 * library. Loaded from this file by runner.ts — never from `blob:` or `data:`; cancelling is the page terminating it.
 */
import { serve } from './workers/serve';

serve({});
