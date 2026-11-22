/**
 * Starts the tool's worker from its own file of the package (docs/tools/specs/subnet.md §11): the bundler emits
 * `subnet.worker.ts` as a script of its own, loaded under the pages' `script-src 'self'`; never `blob:` or `data:`.
 */
import type { WorkerLike } from './runner';

export const startSubnetWorker = (): WorkerLike =>
  new Worker(new URL('./subnet.worker.ts', import.meta.url), {
    type: 'module',
    name: 'subnet',
  }) as unknown as WorkerLike;
