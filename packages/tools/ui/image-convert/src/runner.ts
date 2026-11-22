/**
 * The page's side of the worker (docs/tools/specs/image-convert.md §5.3, §12): one worker, made on the first job and
 * loaded from its file in this package; one job at a time. `cancel()` terminates it — the job under way rejects with
 * `Cancelled` — and the next job makes a fresh one. A host without workers gets a refusal in words.
 */
import type { ConvertOptions, Converted, IconResult, IconsOptions, WorkerReply, WorkerRequest } from './convert.worker';

export class Cancelled extends Error {
  constructor() {
    super('Cancelled.');
  }
}

export interface Runner {
  convert(file: Blob, options: ConvertOptions): Promise<Converted>;
  encode(bitmap: ImageBitmap, options: ConvertOptions, mayHaveAlpha: boolean): Promise<Converted>;
  icons(
    source: { file: Blob } | { bitmaps: Array<{ size: number; bitmap: ImageBitmap }> },
    options: IconsOptions,
  ): Promise<{ files: IconResult[]; notes: string[] }>;
  zip(files: Array<{ name: string; blob: Blob }>): Promise<Blob>;
  cancel(): void;
}

type Pending = { id: number; resolve: (reply: WorkerReply) => void; reject: (error: Error) => void };
type Job = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export const createRunner = (): Runner => {
  let worker: Worker | null = null;
  let pending: Pending | null = null;
  let serial = 0;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    const was = pending;
    pending = null;
    was?.reject(new Cancelled());
  };

  const start = (): Worker => {
    const made = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module', name: 'image-convert' });
    made.onmessage = ({ data }: MessageEvent<WorkerReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if (data.type === 'failed') done.reject(new Error(data.message));
      else done.resolve(data);
    };
    made.onerror = event => {
      event.preventDefault();
      const failed = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      failed?.reject(new Error(event.message || 'The worker stopped.'));
    };
    return made;
  };

  const run = (job: Job, transfer: Transferable[] = []): Promise<WorkerReply> => {
    if (pending) stop();
    if (typeof Worker === 'undefined') return Promise.reject(new Error('This browser cannot run the converter.'));
    worker ??= start();
    const id = ++serial;
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject };
      worker!.postMessage({ ...job, id } as WorkerRequest, transfer);
    });
  };

  const converted = (reply: WorkerReply): Converted => {
    if (reply.type !== 'converted') throw new Error('The worker answered something else.');
    return { blob: reply.blob, size: reply.size, source: reply.source, notes: reply.notes };
  };

  return {
    convert: (file, options) => run({ type: 'convert', file, options }).then(converted),
    encode: (bitmap, options, mayHaveAlpha) =>
      run({ type: 'encode', bitmap, options, mayHaveAlpha }, [bitmap]).then(converted),
    icons: (source, options) =>
      run(
        'file' in source
          ? { type: 'icons', file: source.file, options }
          : { type: 'icons', bitmaps: source.bitmaps, options },
        'file' in source ? [] : source.bitmaps.map(b => b.bitmap),
      ).then(reply => {
        if (reply.type !== 'icons') throw new Error('The worker answered something else.');
        return { files: reply.files, notes: reply.notes };
      }),
    zip: files =>
      run({ type: 'zip', files }).then(reply => {
        if (reply.type !== 'zip') throw new Error('The worker answered something else.');
        return reply.blob;
      }),
    cancel: stop,
  };
};
