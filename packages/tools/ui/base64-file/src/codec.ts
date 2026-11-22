/**
 * The page's side of the worker (docs/tools/specs/base64-file.md §5.6): one job at a time per codec — a newer job, or
 * Cancel, terminates the worker and the job under way resolves with null. Where there are no workers (jsdom tests, a
 * host without them), the same jobs run on the page (jobs.ts), after a frame so the page can say it is working.
 */
import { runJob } from './jobs';
import type { CodecReply, CodecRequest } from './codec.worker';

type Request = CodecRequest extends infer R ? (R extends CodecRequest ? Omit<R, 'id'> : never) : never;
/** The final reply of a job (not a progress report). */
export type Result = Exclude<CodecReply, { type: 'progress' }>;

export interface Codec {
  run: (request: Request, onProgress?: (done: number, total: number) => void) => Promise<Result | null>;
  cancel: () => void;
}

export const createCodec = (): Codec => {
  let worker: Worker | null = null;
  let serial = 0;
  let pending: { id: number; resolve: (r: Result | null) => void; progress?: (d: number, t: number) => void } | null =
    null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };

  const start = (): Worker => {
    const created = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module', name: 'base64-file' });
    created.onmessage = ({ data }: MessageEvent<CodecReply>) => {
      if (!pending || data.id !== pending.id) return;
      if (data.type === 'progress') return pending.progress?.(data.done, data.total);
      const done = pending;
      pending = null;
      done.resolve(data);
    };
    created.onerror = event => {
      event.preventDefault();
      const failed = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      failed?.resolve({ id: failed.id, type: 'error', message: event.message || 'The worker stopped.' });
    };
    return created;
  };

  const run: Codec['run'] = async (request, onProgress) => {
    if (pending) stop();
    const id = ++serial;
    if (typeof Worker === 'undefined') {
      await new Promise(resolve => setTimeout(resolve, 0));
      if (id !== serial) return null;
      let result: Result | null = null;
      await runJob({ ...request, id } as CodecRequest, reply => {
        if (reply.type === 'progress') onProgress?.(reply.done, reply.total);
        else result = reply;
      });
      return id === serial ? result : null;
    }
    worker ??= start();
    return new Promise(resolve => {
      pending = { id, resolve, ...(onProgress ? { progress: onProgress } : {}) };
      worker!.postMessage({ ...request, id });
    });
  };

  return {
    run,
    cancel: () => {
      ++serial;
      stop();
    },
  };
};
