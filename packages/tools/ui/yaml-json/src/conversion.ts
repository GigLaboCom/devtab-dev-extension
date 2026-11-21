/**
 * Where a conversion runs (docs/tools/specs/yaml-json.md §9): in a module worker shipped in this package, so a large or
 * hostile input never holds the page; where there are no workers (jsdom tests, a host without them), on the page. A
 * reply to a job that was replaced or cancelled is dropped; `cancel` terminates the worker, the next job starts a new
 * one.
 */
import { loadConverter } from '@workspace/tool-logic-yaml-json';
import type { ConvertReply, ConvertRequest } from './convert.worker';
import type { ConvertResult, Direction, Layout, YamlVersion } from '@workspace/tool-logic-yaml-json';

export interface ConvertJob {
  direction: Direction;
  text: string;
  version: YamlVersion;
  layout: Layout;
  indent: 2 | 4;
}

export interface Conversion {
  /** Resolves with the result, or with null when the job was replaced or cancelled first. */
  run: (job: ConvertJob) => Promise<ConvertResult | null>;
  /** Stops the job under way (the worker is terminated). */
  cancel: () => void;
  dispose: () => void;
}

const inPage = (): Conversion => {
  let latest = 0;
  return {
    run: async job => {
      const id = ++latest;
      const converter = await loadConverter();
      if (id !== latest) return null;
      return job.direction === 'yaml-to-json'
        ? converter.yamlToJson(job.text, { version: job.version, layout: job.layout })
        : converter.jsonToYaml(job.text, { indent: job.indent });
    },
    cancel: () => void ++latest,
    dispose: () => void ++latest,
  };
};

const inWorker = (): Conversion => {
  let worker: Worker | null = null;
  let latest = 0;
  let pending: { id: number; resolve: (result: ConvertResult | null) => void; reject: (e: Error) => void } | null =
    null;

  const settle = (result: ConvertResult | null): void => {
    pending?.resolve(result);
    pending = null;
  };
  const stop = (): void => {
    worker?.terminate();
    worker = null;
    settle(null);
  };
  const start = (): Worker => {
    const created = new Worker(new URL('./convert.worker.ts', import.meta.url), { type: 'module', name: 'yaml-json' });
    created.onmessage = ({ data }: MessageEvent<ConvertReply>) => {
      if (!pending || data.id !== pending.id) return;
      if ('failure' in data) {
        pending.reject(new Error(data.failure));
        pending = null;
      } else settle(data.result);
    };
    // A worker that dies (out of memory, a crash) is replaced on the next job; the page is told why.
    created.onerror = event => {
      event.preventDefault();
      const failed = pending;
      pending = null;
      worker?.terminate();
      worker = null;
      failed?.reject(new Error(event.message || 'The conversion stopped.'));
    };
    return created;
  };

  return {
    run: job => {
      settle(null);
      const id = ++latest;
      worker ??= start();
      const request: ConvertRequest = { id, ...job };
      return new Promise((resolve, reject) => {
        pending = { id, resolve, reject };
        worker!.postMessage(request);
      });
    },
    cancel: stop,
    dispose: stop,
  };
};

export const createConversion = (): Conversion => (typeof Worker === 'undefined' ? inPage() : inWorker());
