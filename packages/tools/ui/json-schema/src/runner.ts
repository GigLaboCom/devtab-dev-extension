/**
 * Waiting for the worker with a time limit (docs/tools/specs/json-schema.md §5 п. 40), as JSON Query and RegExp wait
 * for theirs: a check has no timeout of its own, so the only way to stop one that runs too long (a pattern such as
 * `(a+)+$` on a long string) is to terminate the worker running it — a job past its limit, or one a newer job replaces,
 * takes its worker with it, and the next job starts a new one. One job at a time; an answer to an older job is dropped.
 *
 * The runner remembers which schema and which document its worker holds (the worker's session keeps what it read):
 * a job over the same schema sends only the document, and the other way round. A new worker holds nothing.
 */
import { TIMEOUT_MS } from '@workspace/tool-logic-json-schema';
import type {
  InferenceReply,
  InferOptions,
  ValidationReply,
  ValidationRequest,
} from '@workspace/tool-logic-json-schema';

/** As much of a `Worker` as the runner uses — a real one, or a fake in a test. */
export interface WorkerLike {
  postMessage(message: unknown): void;
  terminate(): void;
  onmessage: ((event: { data: unknown }) => void) | null;
  onerror: ((event: { message?: string; preventDefault?: () => void }) => void) | null;
}

/** What the page asks for. The texts are always given; the runner leaves out what the worker already holds. */
export type Job =
  | {
      kind: 'validate';
      schemaKey: number;
      schema: string;
      referenced: string[];
      fallback: ValidationRequest['fallback'];
      documentKey: number;
      document: string;
      formats: boolean;
    }
  | { kind: 'infer'; key: number; samples: string; options: InferOptions };

/** What goes to the worker (json-schema.worker.ts). */
export type JobMessage =
  | { id: number; kind: 'validate'; request: ValidationRequest }
  | { id: number; kind: 'infer'; samples: string; options: InferOptions };

export type JobResult = { kind: 'validate'; reply: ValidationReply } | { kind: 'infer'; reply: InferenceReply };

export type JobReply = { id: number; result: JobResult } | { id: number; error: string };

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

export class SchemaRunner {
  private worker: WorkerLike | null = null;
  private pending: Pending | null = null;
  private lastId = 0;
  private heldSchema: number | null = null;
  private heldDocument: number | null = null;

  constructor(
    private readonly createWorker: () => WorkerLike,
    private readonly now: () => number = () => performance.now(),
  ) {}

  /** Cancels a job in progress (terminates its worker), then runs this one. */
  run(job: Job, timeoutMs: number = TIMEOUT_MS): Promise<RunOutcome> {
    this.cancel();
    let worker: WorkerLike;
    try {
      worker = this.worker ?? this.start();
    } catch (error) {
      return Promise.resolve({ kind: 'crashed', message: error instanceof Error ? error.message : String(error) });
    }
    const id = ++this.lastId;
    let message: JobMessage;
    if (job.kind === 'infer') message = { id, kind: 'infer', samples: job.samples, options: job.options };
    else {
      const request: ValidationRequest = {
        schemaKey: job.schemaKey,
        fallback: job.fallback,
        documentKey: job.documentKey,
        formats: job.formats,
      };
      if (this.heldSchema !== job.schemaKey) {
        request.schema = job.schema;
        request.referenced = job.referenced;
      }
      if (this.heldDocument !== job.documentKey) request.document = job.document;
      this.heldSchema = job.schemaKey;
      this.heldDocument = job.documentKey;
      message = { id, kind: 'validate', request };
    }
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

  dispose(): void {
    this.cancel();
    this.stop();
  }

  private start(): WorkerLike {
    const worker = this.createWorker();
    worker.onmessage = ({ data }) => {
      const reply = data as Partial<JobReply> | null;
      if (worker !== this.worker || !reply || reply.id !== this.pending?.id) return;
      const pending = this.settle()!;
      if ('error' in reply && typeof reply.error === 'string') {
        // The worker's session may be half-updated: the next job sends everything again.
        this.heldSchema = null;
        this.heldDocument = null;
        pending.resolve({ kind: 'crashed', message: reply.error });
      } else if ('result' in reply && reply.result)
        pending.resolve({ kind: 'done', result: reply.result, ms: this.now() - pending.started });
    };
    worker.onerror = event => {
      event.preventDefault?.();
      if (worker !== this.worker) return;
      this.stop();
      const pending = this.settle();
      pending?.resolve({ kind: 'crashed', message: event.message || 'the worker stopped' });
    };
    this.worker = worker;
    this.heldSchema = null;
    this.heldDocument = null;
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
    this.heldSchema = null;
    this.heldDocument = null;
    if (!worker) return;
    worker.onmessage = null;
    worker.onerror = null;
    worker.terminate();
  }
}
