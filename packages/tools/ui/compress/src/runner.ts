/**
 * Where the work runs (docs/tools/specs/compress.md §5.8, §12): in a module worker of this package — one per family, so
 * a format's library loads only when that format is chosen: the browser's formats (no library), zstd, brotli
 * decompression, brotli compression. One job at a time: `submit` waits for the job under way and then runs only the
 * latest one asked for (typing never kills a worker); `replace` terminates the job under way first (a new file, another
 * direction or format, Cancel). Where there are no workers (jsdom tests, a host without them) the same work runs on the
 * page.
 */
import { handle } from './workers/serve';
import type { WorkInput, WorkReply, WorkRequest, WorkSink } from './workers/protocol';
import type { Codecs, Collected, Format, Job, RunOutcome } from '@workspace/tool-logic-compress';

export type Family = 'browser' | 'zstd' | 'brotli' | 'brotli-encode';

export const familyOf = (format: Format, direction: Job['direction']): Family =>
  format === 'zstd'
    ? 'zstd'
    : format === 'brotli'
      ? direction === 'compress'
        ? 'brotli-encode'
        : 'brotli'
      : 'browser';

const start = (family: Family): Worker => {
  switch (family) {
    case 'zstd':
      return new Worker(new URL('./zstd.worker.ts', import.meta.url), { type: 'module', name: 'compress-zstd' });
    case 'brotli':
      return new Worker(new URL('./brotli.worker.ts', import.meta.url), { type: 'module', name: 'compress-brotli' });
    case 'brotli-encode':
      return new Worker(new URL('./brotli-encode.worker.ts', import.meta.url), {
        type: 'module',
        name: 'compress-brotli-encode',
      });
    default:
      return new Worker(new URL('./compress.worker.ts', import.meta.url), { type: 'module', name: 'compress' });
  }
};

/**
 * The codecs of the page, where there are no workers: none by default — zstd and brotli live only in their workers'
 * files (a second copy of 2.3 MB for hosts without workers is not worth it; the work says their library could not be
 * loaded). The component's tests (jsdom) load them here.
 */
export const pageCodecs: { load: (family: Family) => Promise<Codecs> } = { load: async () => ({}) };

export interface Work {
  family: Family;
  job: Job;
  input: WorkInput;
  sink: WorkSink;
  limit?: number;
}

export type WorkResult =
  | { type: 'done'; outcome: RunOutcome; collected: Collected | null }
  | { type: 'failure'; message: string }
  /** Superseded by a newer job, or stopped by `replace` / `cancel`. */
  | { type: 'dropped' };

export interface Runner {
  submit(work: Work, onProgress?: (read: number, total: number) => void): Promise<WorkResult>;
  replace(work: Work, onProgress?: (read: number, total: number) => void): Promise<WorkResult>;
  cancel(): void;
  dispose(): void;
}

interface Pending {
  work: Work;
  onProgress?: (read: number, total: number) => void;
  resolve: (result: WorkResult) => void;
}

export const createRunner = (): Runner => {
  const workers = new Map<Family, Worker>();
  let serial = 0;
  let current: (Pending & { id: number; family: Family }) | null = null;
  let waiting: Pending | null = null;

  const finish = (result: WorkResult): void => {
    const done = current;
    current = null;
    done?.resolve(result);
    const next = waiting;
    waiting = null;
    if (next) begin(next);
  };

  const kill = (family: Family): void => {
    workers.get(family)?.terminate();
    workers.delete(family);
  };

  const begin = (pending: Pending): void => {
    const id = ++serial;
    const { work } = pending;
    current = { ...pending, id, family: work.family };
    const request: WorkRequest = {
      id,
      job: work.job,
      input: work.input,
      sink: work.sink,
      ...(work.limit ? { limit: work.limit } : {}),
    };
    const reply = (data: WorkReply): void => {
      if (!current || data.id !== current.id) return;
      if (data.type === 'progress') current.onProgress?.(data.read, data.total);
      else if (data.type === 'done') finish({ type: 'done', outcome: data.outcome, collected: data.collected });
      else finish({ type: 'failure', message: data.message });
    };
    if (typeof Worker === 'undefined') {
      // One task for the page to show that it is working, then the work on the page.
      void new Promise(resolve => setTimeout(resolve, 0))
        .then(() => pageCodecs.load(work.family))
        .then(codecs => handle(request, codecs, reply));
      return;
    }
    let worker = workers.get(work.family);
    if (!worker) {
      worker = start(work.family);
      worker.onmessage = ({ data }: MessageEvent<WorkReply>) => reply(data);
      worker.onerror = event => {
        event.preventDefault();
        kill(work.family);
        if (current?.family === work.family)
          finish({ type: 'failure', message: event.message || 'The worker stopped.' });
      };
      workers.set(work.family, worker);
    }
    const transfer = work.input.kind === 'bytes' ? [work.input.bytes.buffer] : [];
    worker.postMessage(request, transfer);
  };

  const stop = (): void => {
    if (current) {
      const family = current.family;
      const done = current;
      current = null;
      kill(family);
      done.resolve({ type: 'dropped' });
    }
    waiting?.resolve({ type: 'dropped' });
    waiting = null;
  };

  return {
    submit(work, onProgress) {
      return new Promise(resolve => {
        const pending: Pending = { work, resolve, ...(onProgress ? { onProgress } : {}) };
        if (!current) return begin(pending);
        waiting?.resolve({ type: 'dropped' });
        waiting = pending;
      });
    },
    replace(work, onProgress) {
      stop();
      return this.submit(work, onProgress);
    },
    cancel: stop,
    dispose() {
      stop();
      for (const family of [...workers.keys()]) kill(family);
    },
  };
};
