/**
 * Formatting off the page's thread, with a time limit and cancel (docs/tools/specs/sql-format.md §9, §12). One job at
 * a time, in the worker of the job's dialect (workers.ts). Every job has its id; an answer to an older one is dropped.
 * A live job (an edit of a small input) goes to the same worker after the one under way, unless that one has run for
 * over a second (a pathological input — thousands of nested parentheses); a Run, Cancel and the time limit terminate
 * the worker running a job (the parser has no cancel of its own), and the next job starts a new one —
 * a worker is the library's core and one dialect, loaded from the extension's own files in milliseconds. A worker of
 * another dialect is terminated when a job needs a different one.
 *
 * The first time a dialect's worker starts, the page is told it is loading until the worker says `ready` (§8:
 * `Loading the PostgreSQL formatter…`).
 */
import { TIME_LIMIT_MS } from '@workspace/tool-logic-sql-format';
import type { FormatReply, FormatRequest } from './serve';
import type { SqlDialect, SqlOptions, SqlResult } from '@workspace/tool-logic-sql-format';

/** As much of a `Worker` as the runner uses — a real one, or a fake in a test. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

export type FormatOutcome =
  | { kind: 'done'; result: SqlResult; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'cancelled' }
  | { kind: 'crashed'; message: string };

interface Pending {
  id: number;
  started: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: FormatOutcome) => void;
}

/** How long a live job may hold the worker before a newer edit terminates it instead of waiting behind it. */
export const LIVE_PATIENCE_MS = 1000;

export interface RunnerOptions {
  /** Called with the dialect whose worker loads for the first time, and with null once it is ready (or stopped). */
  onLoading?: (dialect: SqlDialect | null) => void;
  timeoutMs?: number;
  now?: () => number;
}

export class SqlRunner {
  private worker: WorkerLike | null = null;
  private dialect: SqlDialect | null = null;
  private pending: Pending | null = null;
  private lastId = 0;
  private readonly ready = new Set<SqlDialect>();

  constructor(
    private readonly startWorker: (dialect: SqlDialect) => WorkerLike,
    private readonly options: RunnerOptions = {},
  ) {}

  /**
   * Runs this job in the worker of its dialect. A job in progress is dropped: with `restart` (a Run) its worker is
   * terminated; without (a live edit, §9) the new job waits in the same worker and the old answer is not used.
   */
  run(text: string, options: SqlOptions, { restart = true }: { restart?: boolean } = {}): Promise<FormatOutcome> {
    const now = this.options.now ?? (() => performance.now());
    // A job that has run for a while is a pathological one: a live edit does not wait behind it.
    const stuck = this.pending !== null && now() - this.pending.started > LIVE_PATIENCE_MS;
    if (restart || stuck || this.dialect !== options.dialect) this.cancel();
    else this.settle()?.resolve({ kind: 'cancelled' });
    if (this.dialect !== options.dialect) this.stop();
    let worker: WorkerLike;
    try {
      worker = this.worker ?? this.start(options.dialect);
    } catch (error) {
      // No worker here (a host without them, a refused script): the query is never formatted on the page instead.
      return Promise.resolve({ kind: 'crashed', message: error instanceof Error ? error.message : String(error) });
    }
    const id = ++this.lastId;
    return new Promise<FormatOutcome>(resolve => {
      const started = now();
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.stop();
        resolve({ kind: 'timeout', ms: now() - started });
      }, this.options.timeoutMs ?? TIME_LIMIT_MS);
      this.pending = { id, started, timer, resolve };
      const request: FormatRequest = { id, text, options };
      worker.postMessage(request);
    });
  }

  /** Is a job waiting for its answer? */
  get busy(): boolean {
    return this.pending !== null;
  }

  /** Stops the job in progress, if any (its worker is terminated); an idle worker is kept for the next job. */
  cancel(): void {
    const pending = this.settle();
    if (!pending) return;
    this.stop();
    pending.resolve({ kind: 'cancelled' });
  }

  /** Terminates the worker; the next run creates a new one. */
  dispose(): void {
    this.cancel();
    this.stop();
  }

  private start(dialect: SqlDialect): WorkerLike {
    const worker = this.startWorker(dialect);
    const now = this.options.now ?? (() => performance.now());
    if (!this.ready.has(dialect)) this.options.onLoading?.(dialect);
    worker.onmessage = ({ data }) => {
      if (worker !== this.worker) return;
      const reply = data as FormatReply | null;
      if (reply?.type === 'ready') {
        if (!this.ready.has(dialect)) {
          this.ready.add(dialect);
          this.options.onLoading?.(null);
        }
        return;
      }
      if (reply?.type !== 'result' || reply.id !== this.pending?.id) return;
      const pending = this.settle()!;
      pending.resolve({ kind: 'done', result: reply.result, ms: now() - pending.started });
    };
    worker.onerror = event => {
      // Handled here: the page's own error handler (and its console) is not told.
      event.preventDefault?.();
      if (worker !== this.worker) return;
      this.stop();
      const pending = this.settle();
      pending?.resolve({ kind: 'crashed', message: event.message || 'the worker stopped' });
    };
    this.worker = worker;
    this.dialect = dialect;
    return worker;
  }

  private settle(): Pending | null {
    const pending = this.pending;
    if (pending) clearTimeout(pending.timer);
    this.pending = null;
    return pending;
  }

  private stop(): void {
    const worker = this.worker;
    const dialect = this.dialect;
    this.worker = null;
    this.dialect = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
    if (dialect && !this.ready.has(dialect)) this.options.onLoading?.(null);
  }
}
