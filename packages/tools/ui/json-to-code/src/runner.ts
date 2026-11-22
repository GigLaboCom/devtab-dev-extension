/**
 * Where Generate works on a large sample (docs/tools/specs/json-to-code.md §12, §15): in a module worker shipped in this
 * package, so 16 MB never hold the page; where there are no workers (jsdom tests, a host without them), on the page
 * after a frame. A newer job replaces the one under way (the worker is terminated, the next job starts a new one); the
 * replaced job resolves with null. A worker that dies rejects its job with why.
 */
import { jsonToCode } from '@workspace/tool-logic-json-to-code';
import type { GenerateReply, GenerateRequest } from './json-to-code.worker';
import type { CodeOptions, CodeResult } from '@workspace/tool-logic-json-to-code';

export interface GenerateJob {
  text: string;
  options: CodeOptions;
}

export interface Runner {
  run: (job: GenerateJob) => Promise<CodeResult | null>;
  cancel: () => void;
  dispose: () => void;
}

const inPage = (): Runner => {
  let latest = 0;
  return {
    run: async job => {
      const id = ++latest;
      // One frame for `Working…` to be painted before the page is busy.
      await new Promise(resolve => setTimeout(resolve, 0));
      return id === latest ? jsonToCode(job.text, job.options) : null;
    },
    cancel: () => void ++latest,
    dispose: () => void ++latest,
  };
};

const inWorker = (): Runner => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (done: CodeResult | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./json-to-code.worker.ts', import.meta.url), {
      type: 'module',
      name: 'json-to-code',
    });
    created.onmessage = ({ data }: MessageEvent<GenerateReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if ('failure' in data) done.reject(new Error(data.failure));
      else done.resolve(data.result);
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
      const request: GenerateRequest = { id, ...job };
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

export const createRunner = (): Runner => (typeof Worker === 'undefined' ? inPage() : inWorker());
