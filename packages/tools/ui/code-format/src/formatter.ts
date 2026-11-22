/**
 * Where formatting runs (docs/tools/specs/code-format.md §9, §12): in a module worker shipped in this package — Prettier's
 * for eight languages, the XML worker for XML — so a large or hostile input never holds the page. A worker is started on
 * the first job of its kind and kept; a reply to a job that was replaced is dropped; `cancel` terminates the worker
 * (the next job starts a new one, whose modules load again from the package); a job that outruns TIME_LIMIT_MS is
 * stopped the same way. Without workers (a host that has none) nothing is formatted and the page says why.
 */
import { TIME_LIMIT_MS } from '@workspace/tool-logic-code-format';
import type { FormatRequest } from './format.worker';
import type { XmlRequest } from './xml.worker';
import type { CodeLanguage, FormatResult, FormatSettings } from '@workspace/tool-logic-code-format';

export interface FormatJob {
  language: CodeLanguage;
  text: string;
  settings: FormatSettings;
}

/** What a worker answers: first, maybe, that the language's modules are loading; then the result or why there is none. */
export type FormatReply =
  | { id: number; loading: CodeLanguage }
  | { id: number; result: FormatResult; ms: number }
  | { id: number; failure: string };

export type FormatOutcome = { result: FormatResult; ms: number } | { timedOut: true } | { failure: string };

export interface Formatter {
  /** Resolves with the outcome, or with null when the job was replaced or cancelled first. */
  run: (job: FormatJob, onLoading?: (language: CodeLanguage) => void) => Promise<FormatOutcome | null>;
  /** Stops the job under way (its worker is terminated). */
  cancel: () => void;
  dispose: () => void;
}

export const NO_WORKERS = 'This page cannot start the formatter: workers are not available here.';

type Engine = 'prettier' | 'xml';

const startWorker = (engine: Engine): Worker =>
  engine === 'xml'
    ? new Worker(new URL('./xml.worker.ts', import.meta.url), { type: 'module', name: 'code-format-xml' })
    : new Worker(new URL('./format.worker.ts', import.meta.url), { type: 'module', name: 'code-format' });

export const createFormatter = (limitMs: number = TIME_LIMIT_MS): Formatter => {
  const workers: Partial<Record<Engine, Worker>> = {};
  let latest = 0;
  let pending: {
    id: number;
    engine: Engine;
    timer: ReturnType<typeof setTimeout>;
    onLoading?: (language: CodeLanguage) => void;
    resolve: (outcome: FormatOutcome | null) => void;
  } | null = null;

  const settle = (outcome: FormatOutcome | null): void => {
    if (!pending) return;
    clearTimeout(pending.timer);
    const { resolve } = pending;
    pending = null;
    resolve(outcome);
  };
  const stop = (engine: Engine): void => {
    workers[engine]?.terminate();
    delete workers[engine];
  };
  const workerFor = (engine: Engine): Worker => {
    const existing = workers[engine];
    if (existing) return existing;
    const worker = startWorker(engine);
    worker.onmessage = ({ data }: MessageEvent<FormatReply>) => {
      if (!pending || data.id !== pending.id) return;
      if ('loading' in data) pending.onLoading?.(data.loading);
      else if ('failure' in data) settle({ failure: data.failure });
      else settle({ result: data.result, ms: data.ms });
    };
    // A worker that dies (out of memory, a module that did not load) is replaced on the next job; the page says why.
    worker.onerror = event => {
      event.preventDefault();
      stop(engine);
      settle({ failure: event.message || 'The formatter stopped.' });
    };
    workers[engine] = worker;
    return worker;
  };

  return {
    run: (job, onLoading) => {
      settle(null);
      const id = ++latest;
      if (typeof Worker === 'undefined') return Promise.resolve({ failure: NO_WORKERS });
      const engine: Engine = job.language === 'xml' ? 'xml' : 'prettier';
      const worker = workerFor(engine);
      return new Promise(resolve => {
        // Pathological input: the worker is stopped, the page says so (§12).
        const timer = setTimeout(() => {
          if (pending?.id !== id) return;
          stop(engine);
          settle({ timedOut: true });
        }, limitMs);
        pending = { id, engine, timer, onLoading, resolve };
        const request: FormatRequest | XmlRequest = { id, ...job } as FormatRequest;
        worker.postMessage(request);
      });
    },
    cancel: () => {
      if (pending) stop(pending.engine);
      settle(null);
    },
    dispose: () => {
      settle(null);
      stop('prettier');
      stop('xml');
    },
  };
};
