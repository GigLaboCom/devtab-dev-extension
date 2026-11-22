/**
 * Where a large SVG is converted (docs/tools/specs/svg-to-css.md §12, §15): in the module worker shipped in this
 * package (svg.worker.ts), or on the page after a frame where there are no workers (jsdom tests, a host without them).
 * The check stays on the page — it needs the page's `DOMParser` — and comes first. One job at a time: a newer one stops
 * the one under way (the worker is terminated), which then resolves with null.
 */
import { convertSvg } from '@workspace/tool-logic-svg-to-css';
import type { ConvertReply, ConvertRequest } from './svg.worker';
import type { SvgOptions, SvgResult } from '@workspace/tool-logic-svg-to-css';

export interface Converter {
  convert: (text: string, options: SvgOptions) => Promise<SvgResult | null>;
  dispose: () => void;
}

export const createConverter = (): Converter => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (r: SvgResult | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./svg.worker.ts', import.meta.url), { type: 'module', name: 'svg-to-css' });
    created.onmessage = ({ data }: MessageEvent<ConvertReply>) => {
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
    convert: async (text, options) => {
      if (pending) stop();
      const id = ++latest;
      if (typeof Worker === 'undefined') {
        await new Promise(resolve => setTimeout(resolve, 0));
        return id === latest ? convertSvg(text, options) : null;
      }
      worker ??= start();
      const request: ConvertRequest = { id, text, options };
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage(request);
      });
    },
    dispose: () => {
      ++latest;
      stop();
    },
  };
};
