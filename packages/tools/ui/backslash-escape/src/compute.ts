/**
 * Where a large input is worked on (docs/tools/specs/backslash-escape.md §12): in a module worker shipped in this
 * package, so 5 Mi of text dense with escapes never holds the page; where there are no workers (jsdom tests, a host
 * without them), on the page. A newer job replaces the one under way (the worker is terminated, the next job starts a
 * new one); the replaced job resolves with null. A worker that dies rejects its job with why.
 */
import { runJob } from './work';
import type { BackslashEscapeReply, BackslashEscapeRequest } from './backslash-escape.worker';
import type { Computed, Job } from './work';

export interface Compute {
  run: (job: Job) => Promise<Computed | null>;
  cancel: () => void;
  dispose: () => void;
}

const inPage = (): Compute => {
  let latest = 0;
  return {
    run: async job => {
      const id = ++latest;
      await Promise.resolve();
      return id === latest ? runJob(job) : null;
    },
    cancel: () => void ++latest,
    dispose: () => void ++latest,
  };
};

const inWorker = (): Compute => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (done: Computed | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./backslash-escape.worker.ts', import.meta.url), {
      type: 'module',
      name: 'backslash-escape',
    });
    created.onmessage = ({ data }: MessageEvent<BackslashEscapeReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if ('failure' in data) done.reject(new Error(data.failure));
      else done.resolve(data.computed);
    };
    created.onerror = event => {
      event.preventDefault();
      const failed = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      failed?.reject(new Error(event.message || 'The worker stopped.'));
    };
    return created;
  };

  return {
    run: job => {
      // A job under way is out of date: stop it rather than wait for it.
      if (pending) stop();
      const id = ++latest;
      worker ??= start();
      const request: BackslashEscapeRequest = { id, ...job };
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage(request);
      });
    },
    cancel: () => {
      if (pending) stop();
    },
    dispose: stop,
  };
};

export const createCompute = (): Compute => (typeof Worker === 'undefined' ? inPage() : inWorker());
