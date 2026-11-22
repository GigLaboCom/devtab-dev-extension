/**
 * Where a large input becomes markdown-it's HTML (docs/tools/specs/markdown-preview.md §12, §15). The page renders up to
 * LIVE_INPUT characters itself, at once; above that, a module worker shipped in this package does, so a megabyte — and
 * the pathological shapes that take markdown-it seconds — never hold the page. Where there are no workers (jsdom tests,
 * a host without them), on the page. A newer job replaces the one under way (the worker is terminated, the next job
 * starts a new one); the replaced job resolves with null. A worker that dies rejects its job.
 */
import { renderMarkdown } from '@workspace/tool-logic-markdown-preview';
import type { RenderReply, RenderRequest } from './markdown.worker';

export interface Renderer {
  /** markdown-it's HTML for `source`, or null when a newer job replaced this one (or the renderer was disposed). */
  render: (source: string) => Promise<string | null>;
  dispose: () => void;
}

const inPage = (): Renderer => {
  let latest = 0;
  return {
    render: async source => {
      const id = ++latest;
      // One frame first, as the worker would take: a newer edit in it replaces this job.
      await new Promise(resolve => setTimeout(resolve, 0));
      return id === latest ? renderMarkdown(source) : null;
    },
    dispose: () => void ++latest,
  };
};

const inWorker = (): Renderer => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (html: string | null) => void; reject: (e: Error) => void } | null = null;

  const stop = (): void => {
    worker?.terminate();
    worker = null;
    pending?.resolve(null);
    pending = null;
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./markdown.worker.ts', import.meta.url), {
      type: 'module',
      name: 'markdown-preview',
    });
    created.onmessage = ({ data }: MessageEvent<RenderReply>) => {
      if (!pending || data.id !== pending.id) return;
      const done = pending;
      pending = null;
      if ('failure' in data) done.reject(new Error(data.failure));
      else done.resolve(data.html);
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
    render: source => {
      // A job under way is out of date: stop it rather than wait for it.
      if (pending) stop();
      const id = ++latest;
      worker ??= start();
      const request: RenderRequest = { id, source };
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage(request);
      });
    },
    dispose: stop,
  };
};

export const createLargeRenderer = (): Renderer => (typeof Worker === 'undefined' ? inPage() : inWorker());
