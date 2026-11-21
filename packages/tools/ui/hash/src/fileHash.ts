/**
 * The digests of a file without freezing the page or holding the file (docs/tools/specs/hash.md §12): the File goes to
 * workers as a handle, each reads it a chunk at a time (freed after use) and feeds a wasm stream (the `Digester` of the
 * logic), so memory stays flat whatever the size — 5 GiB measured. One worker per algorithm: they run side by side and
 * the file takes about as long as its slowest digest, SHA-256 (docs/research/hash-in-wasm.md: five workers ~265 MiB/s,
 * three ~200, one ~100; each reads the file itself — from the page cache on a local disk that costs nothing measurable,
 * on a slow disk it is five reads). Where there are no workers (jsdom tests, a host without them), the same
 * reading runs on the page.
 */
import { ALGORITHMS, hashBlob } from '@workspace/tool-logic-hash';
import type { HashReply, HashRequest } from './hash.worker';
import type { Algorithm, Digests } from '@workspace/tool-logic-hash';

/** One worker per algorithm (measured fastest; see above). */
export const WORKER_GROUPS: ReadonlyArray<readonly Algorithm[]> = ALGORITHMS.map(a => [a]);

export interface FileHashOptions {
  key?: Uint8Array;
  /** 0…1: the share of the file the slowest worker has digested (what the finish waits for). */
  onProgress?: (fraction: number) => void;
  signal?: AbortSignal;
}

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');

const inPage = async (file: Blob, { key, onProgress, signal }: FileHashOptions): Promise<Digests> =>
  (await hashBlob(file, {
    ...(key ? { key } : {}),
    ...(onProgress ? { onProgress } : {}),
    ...(signal ? { signal } : {}),
  })) as Digests;

/** All five digests of `file`. Rejects with an AbortError when `signal` aborts, with an Error when it cannot be read. */
export const hashFile = (file: Blob, options: FileHashOptions = {}): Promise<Digests> => {
  if (typeof Worker === 'undefined') return inPage(file, options);
  const { key, onProgress, signal } = options;
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise<Digests>((resolve, reject) => {
    const read = WORKER_GROUPS.map(() => 0);
    const found: Partial<Digests> = {};
    let left = WORKER_GROUPS.length;
    const workers = WORKER_GROUPS.map(
      () => new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module', name: 'hash' }),
    );
    const stop = () => {
      for (const worker of workers) worker.terminate();
      signal?.removeEventListener('abort', aborted);
    };
    const fail = (error: unknown) => {
      stop();
      reject(error);
    };
    const aborted = () => fail(abortError());
    signal?.addEventListener('abort', aborted, { once: true });
    workers.forEach((worker, i) => {
      worker.onmessage = ({ data }: MessageEvent<HashReply>) => {
        if (data.type === 'progress') {
          read[i] = data.bytes;
          if (file.size > 0) onProgress?.(Math.min(...read) / file.size);
        } else if (data.type === 'error') fail(new Error(data.message));
        else {
          Object.assign(found, data.digests);
          if (--left === 0) {
            stop();
            onProgress?.(1);
            resolve(Object.fromEntries(ALGORITHMS.map(a => [a, found[a]])) as Digests);
          }
        }
      };
      worker.onerror = event => {
        event.preventDefault();
        fail(new Error(event.message || 'The worker failed.'));
      };
      const request: HashRequest = { file, algorithms: WORKER_GROUPS[i]!, ...(key ? { key } : {}) };
      worker.postMessage(request);
    });
  });
};
