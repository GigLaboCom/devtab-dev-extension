/**
 * Where a large input is processed (docs/tools/specs/lines.md §12): in a module worker shipped in this package, so
 * sorting 200,000 lines never holds the page; where there are no workers (jsdom tests, a host without them), on the
 * page. A newer job replaces the one under way (the worker is terminated, the next job starts a new one); the replaced
 * job resolves with null. A worker that dies rejects its job with why.
 */
import { createShuffleTape, runPipeline } from '@workspace/tool-logic-lines';
import type { LinesReply, LinesRequest } from './lines.worker';
import type { Pipeline, PipelineResult } from '@workspace/tool-logic-lines';

export interface ComputeJob {
  text: string;
  pipeline: Pipeline;
  /** The shuffle tape's bytes so far. */
  tape: Uint8Array;
}

export interface Computed {
  result: PipelineResult;
  /** The grown tape, when Shuffle read past the bytes it was given. */
  tape: Uint8Array | null;
}

export interface Compute {
  run: (job: ComputeJob) => Promise<Computed | null>;
  cancel: () => void;
  dispose: () => void;
}

const inPage = (): Compute => {
  let latest = 0;
  return {
    run: async job => {
      const id = ++latest;
      await Promise.resolve();
      if (id !== latest) return null;
      const tape = createShuffleTape(undefined, job.tape);
      const result = runPipeline(job.text, job.pipeline, tape.reader());
      const bytes = tape.bytes();
      return { result, tape: bytes.length === job.tape.length ? null : bytes };
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
    const created = new Worker(new URL('./lines.worker.ts', import.meta.url), { type: 'module', name: 'lines' });
    created.onmessage = ({ data }: MessageEvent<LinesReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if ('failure' in data) done.reject(new Error(data.failure));
      else done.resolve({ result: data.result, tape: data.tape });
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
      const request: LinesRequest = { id, ...job };
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
