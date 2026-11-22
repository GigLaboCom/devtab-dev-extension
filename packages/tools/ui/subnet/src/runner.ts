/**
 * The lists of Match and Summarize above the page's limit go to the package's worker (docs/tools/specs/subnet.md §12):
 * one job at a time; a newer job, or an edit, terminates the worker in the middle of the old one (its answer would be
 * stale), and the next job starts a new worker. The work is linear and bounded by the list's limits, so there is no
 * time limit — only cancelling.
 */
import type { MatchResult, SummarizeResult } from '@workspace/tool-logic-subnet';

/** As much of a `Worker` as the runner uses — a real one, or a fake in a test. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

export type ListJob = { task: 'match'; addresses: string; blocks: string } | { task: 'summarize'; list: string };

export type ListAnswer = { task: 'match'; result: MatchResult } | { task: 'summarize'; result: SummarizeResult };

export interface JobMessage {
  id: number;
  job: ListJob;
}

export type JobReply = { id: number; ok: true; answer: ListAnswer } | { id: number; ok: false; message: string };

export type RunOutcome =
  { kind: 'done'; answer: ListAnswer; ms: number } | { kind: 'cancelled' } | { kind: 'crashed'; message: string };

export class ListRunner {
  private worker: WorkerLike | null = null;
  private pending: { id: number; started: number; resolve: (o: RunOutcome) => void } | null = null;
  private lastId = 0;

  constructor(
    private readonly createWorker: () => WorkerLike,
    private readonly now: () => number = () => performance.now(),
  ) {}

  run(job: ListJob): Promise<RunOutcome> {
    this.cancel();
    let worker: WorkerLike;
    try {
      worker = this.worker ?? this.start();
    } catch (error) {
      return Promise.resolve({ kind: 'crashed', message: error instanceof Error ? error.message : String(error) });
    }
    const id = ++this.lastId;
    return new Promise<RunOutcome>(resolve => {
      this.pending = { id, started: this.now(), resolve };
      const message: JobMessage = { id, job };
      worker.postMessage(message);
    });
  }

  get busy(): boolean {
    return this.pending !== null;
  }

  /** Stops the job in progress (its worker is terminated); an idle worker is kept. */
  cancel(): void {
    const pending = this.pending;
    if (!pending) return;
    this.pending = null;
    this.stop();
    pending.resolve({ kind: 'cancelled' });
  }

  dispose(): void {
    this.cancel();
    this.stop();
  }

  private start(): WorkerLike {
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => {
      const reply = data as Partial<JobReply> | null;
      const pending = this.pending;
      if (worker !== this.worker || !reply || !pending || reply.id !== pending.id) return;
      this.pending = null;
      pending.resolve(
        reply.ok === true && reply.answer
          ? { kind: 'done', answer: reply.answer, ms: this.now() - pending.started }
          : { kind: 'crashed', message: (reply.ok === false && reply.message) || 'no answer' },
      );
    };
    worker.onerror = event => {
      event.preventDefault?.();
      if (worker !== this.worker) return;
      this.stop();
      const pending = this.pending;
      this.pending = null;
      pending?.resolve({ kind: 'crashed', message: event.message || 'the worker stopped' });
    };
    this.worker = worker;
    return worker;
  }

  private stop(): void {
    const worker = this.worker;
    this.worker = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}
