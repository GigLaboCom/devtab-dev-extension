/**
 * Runs one Hash or Verify (docs/tools/specs/password-hash.md §5.9): a new module worker per piece of work, terminated
 * when it answers or when the signal aborts (Cancel, an edit) — the only way to stop wasm in the middle, and the way
 * its memory is given back. Without `Worker` (jsdom, a host without workers) the same function runs on the page,
 * imported only then, so the library never sits in the page's chunk.
 */
import { COULD_NOT } from '@workspace/tool-logic-password-hash';
import type { PasswordHashReply, PasswordHashRequest } from './password-hash.worker';

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');

export const runInWorker = (job: PasswordHashRequest, signal?: AbortSignal): Promise<PasswordHashReply> => {
  if (signal?.aborted) return Promise.reject(abortError());
  if (typeof Worker === 'undefined')
    return import('./inPage').then(({ runJob }) => {
      if (signal?.aborted) throw abortError();
      return runJob(job);
    });
  return new Promise<PasswordHashReply>((resolve, reject) => {
    const worker = new Worker(new URL('./password-hash.worker.ts', import.meta.url), {
      type: 'module',
      name: 'password-hash',
    });
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      stop();
      reject(abortError());
    };
    signal?.addEventListener('abort', aborted, { once: true });
    worker.onmessage = ({ data }: MessageEvent<PasswordHashReply>) => {
      stop();
      resolve(data);
    };
    worker.onerror = event => {
      event.preventDefault();
      stop();
      resolve({ ok: false, message: COULD_NOT });
    };
    worker.postMessage(job);
  });
};
