/**
 * Where an image is encoded and a text decoded (docs/tools/specs/base64-image.md §12, §15): on the page while it is
 * small (a file up to 768 KiB, a text up to 1 Mi characters — a few milliseconds), in the module worker shipped in this
 * package above that, and on the page after a frame where there are no workers (jsdom tests, a host without them). One
 * job at a time: a newer one stops the one under way (the worker is terminated), which then resolves with null.
 */
import { LIVE_INPUT_CHARS, decodeImageInput, encodeImage } from '@workspace/tool-logic-base64-image';
import type { CodecReply, CodecRequest, Encoded } from './codec.worker';
import type { DecodeImageResult } from '@workspace/tool-logic-base64-image';

/** A file this small is encoded on the page: its Base64 is at most LIVE_INPUT_CHARS characters. */
export const LIVE_FILE_BYTES = (LIVE_INPUT_CHARS / 4) * 3;

export interface Codec {
  encode: (bytes: Uint8Array) => Promise<Encoded | null>;
  decode: (text: string) => Promise<DecodeImageResult | null>;
  dispose: () => void;
}

type Job = { type: 'encode'; bytes: Uint8Array } | { type: 'decode'; text: string };
type Done = Encoded | DecodeImageResult;

const onPage = (job: Job): Done => (job.type === 'encode' ? encodeImage(job.bytes) : decodeImageInput(job.text));
const small = (job: Job): boolean =>
  job.type === 'encode' ? job.bytes.length <= LIVE_FILE_BYTES : job.text.length <= LIVE_INPUT_CHARS;

export const createCodec = (): Codec => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (done: Done | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./codec.worker.ts', import.meta.url), { type: 'module', name: 'base64-image' });
    created.onmessage = ({ data }: MessageEvent<CodecReply>) => {
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

  const run = async (job: Job): Promise<Done | null> => {
    if (pending) stop();
    const id = ++latest;
    if (small(job)) return onPage(job);
    if (typeof Worker === 'undefined') {
      // One frame for the page to say it is working before it is busy.
      await new Promise(resolve => setTimeout(resolve, 0));
      return id === latest ? onPage(job) : null;
    }
    worker ??= start();
    const request: CodecRequest = { id, ...job };
    return new Promise((resolve, reject) => {
      pending = { id, resolve, reject };
      worker!.postMessage(request, job.type === 'encode' ? [job.bytes.buffer] : []);
    });
  };

  return {
    encode: bytes => run({ type: 'encode', bytes }) as Promise<Encoded | null>,
    decode: text => run({ type: 'decode', text }) as Promise<DecodeImageResult | null>,
    dispose: () => {
      ++latest;
      stop();
    },
  };
};
