/**
 * Starts the tool's worker from its own file of the package (docs/tools/specs/regexp.md §5 п. 25): the bundler emits
 * `regexp.worker.ts` as a script of its own, loaded under the pages' `script-src 'self'`; never `blob:` or `data:`.
 */
import type { WorkerLike } from './runner';

export const startRegexpWorker = (): WorkerLike =>
  new Worker(new URL('./regexp.worker.ts', import.meta.url), {
    type: 'module',
    name: 'regexp',
  }) as unknown as WorkerLike;
