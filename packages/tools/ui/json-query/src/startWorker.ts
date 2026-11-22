/**
 * Starts the tool's worker from its own file of the package (docs/tools/specs/json-query.md §11): the bundler emits
 * `json-query.worker.ts` as a script of its own, loaded under the pages' `script-src 'self'`; never `blob:` or `data:`.
 */
import type { WorkerLike } from './runner';

export const startJsonQueryWorker = (): WorkerLike =>
  new Worker(new URL('./json-query.worker.ts', import.meta.url), {
    type: 'module',
    name: 'json-query',
  }) as unknown as WorkerLike;
