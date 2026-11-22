/**
 * Where a large text is inspected (docs/tools/specs/string-inspector.md §12, §15): in a module worker shipped in this
 * package, so a megabyte never holds the page; where there are no workers (jsdom tests, a host without them), on the
 * page after a frame. A newer job replaces the one under way (the worker is terminated, the next job starts a new one);
 * the replaced job resolves with null. A worker that dies rejects its job with why.
 */
import { inspect } from '@workspace/tool-logic-string-inspector';
import type { InspectReply, InspectRequest } from './inspect.worker';
import type { Inspection } from '@workspace/tool-logic-string-inspector';

export interface Runner {
  run: (text: string) => Promise<Inspection | null>;
  dispose: () => void;
}

const inPage = (): Runner => {
  let latest = 0;
  return {
    run: async text => {
      const id = ++latest;
      // One frame for the page to be painted before it is busy.
      await new Promise(resolve => setTimeout(resolve, 0));
      return id === latest ? inspect(text) : null;
    },
    dispose: () => void ++latest,
  };
};

const inWorker = (): Runner => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (done: Inspection | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./inspect.worker.ts', import.meta.url), {
      type: 'module',
      name: 'string-inspector',
    });
    created.onmessage = ({ data }: MessageEvent<InspectReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if ('failure' in data) done.reject(new Error(data.failure));
      else done.resolve(data.inspection);
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
    run: text => {
      // A job under way is out of date: stop it rather than wait for it.
      if (pending) stop();
      const id = ++latest;
      worker ??= start();
      const request: InspectRequest = { id, text };
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage(request);
      });
    },
    dispose: stop,
  };
};

export const createRunner = (): Runner => (typeof Worker === 'undefined' ? inPage() : inWorker());
