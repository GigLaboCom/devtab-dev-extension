/**
 * Starts the tool's worker from its own file of the package (docs/tools/specs/json-schema.md §11): the bundler emits
 * `json-schema.worker.ts` as a script of its own, loaded under the pages' `script-src 'self'`; never `blob:` or `data:`.
 */
import type { WorkerLike } from './runner';

export const startJsonSchemaWorker = (): WorkerLike =>
  new Worker(new URL('./json-schema.worker.ts', import.meta.url), {
    type: 'module',
    name: 'json-schema',
  }) as unknown as WorkerLike;
