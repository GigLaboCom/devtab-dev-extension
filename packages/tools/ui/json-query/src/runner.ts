/**
 * Waiting for the worker with a time limit (docs/tools/specs/json-query.md §5 п. 27), as the RegExp tool waits for its
 * own: a query has no timeout and no cancel, so the only way to stop one that runs too long is to terminate the worker
 * running it — a job past its limit, or one a newer job replaces, takes its worker with it, and the next job starts a
 * new one. One job at a time; every job has its own id, and an answer to an older one is dropped.
 *
 * Unlike RegExp's, the runner remembers which document its worker holds (the worker keeps the tree of the last one it
 * read): a job over the same document sends only the query, so editing the query of a 16 MB document does not send
 * and read the document again. A new worker holds nothing.
 */
import { TIMEOUT_MS } from '@workspace/tool-logic-json-query';
import type { JsonErrorInfo, RunResult } from '@workspace/tool-logic-json-query';

/** As much of a `Worker` as the runner uses — a real one, or a fake in a test. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

/** What the page asks for: a query over a document (the id says which; the text goes only when the worker lacks it). */
export interface QueryRequest {
  docId: number;
  document: string;
  query: string;
}

/** What goes to the worker (json-query.worker.ts). */
export interface JobMessage {
  id: number;
  request: { docId: number; document?: string; query: string };
}

/** The run's result, and with a successful one the notes about the document. */
export type JobResult =
  | (Extract<RunResult, { ok: true }> & { notes: string[] })
  | { ok: false; where: 'document'; error: JsonErrorInfo }
  | { ok: false; where: 'query'; message: string };

export interface JobReply {
  id: number;
  result: JobResult;
}

export type RunOutcome =
  | { kind: 'done'; result: JobResult; ms: number }
  | { kind: 'timeout'; ms: number }
  | { kind: 'cancelled' }
  | { kind: 'crashed'; message: string };

interface Pending {
  id: number;
  started: number;
  timer: ReturnType<typeof setTimeout>;
  resolve: (outcome: RunOutcome) => void;
}

export class QueryRunner {
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private lastId = 0;
  /** The document the current worker holds (it was sent to it), or null. */
  private held: number | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Cancels a job in progress (terminates its worker), then runs this one. */
  run(request: QueryRequest, timeoutMs: number = TIMEOUT_MS): Promise<RunOutcome> {
    this.cancel();
    let worker: WorkerLike;
    try {
      worker = this.worker ?? this.start();
    } catch (error) {
      // No worker here (a host without them, a refused script): the query is never run on the page instead.
      return Promise.resolve({ kind: 'crashed', message: error instanceof Error ? error.message : String(error) });
    }
    const id = ++this.lastId;
    const message: JobMessage = {
      id,
      request:
        this.held === request.docId
          ? { docId: request.docId, query: request.query }
          : { docId: request.docId, document: request.document, query: request.query },
    };
    this.held = request.docId;
    return new Promise<RunOutcome>(resolve => {
      const started = this.now();
      const timer = setTimeout(() => {
        if (this.pending?.id !== id) return;
        this.pending = null;
        this.stop();
        resolve({ kind: 'timeout', ms: this.now() - started });
      }, timeoutMs);
      this.pending = { id, started, timer, resolve };
      worker.postMessage(message);
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

  private start(): WorkerLike {
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => {
      const reply = data as Partial<JobReply> | null;
      if (worker !== this.worker || !reply || reply.id !== this.pending?.id || !reply.result) return;
      const pending = this.settle()!;
      pending.resolve({ kind: 'done', result: reply.result, ms: this.now() - pending.started });
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
    this.held = null;
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
    this.worker = null;
    this.held = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}
