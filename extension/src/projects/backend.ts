/**
 * Seam `ProjectBackend` (D13; the companion's specification §8.1) — where the Projects section's projects come from:
 * the companion on the developer's machine, or the demo that works without it. Asynchronous from the first day: every
 * method answers with a promise, a long one takes an `AbortSignal` and streams its parts. A part of the page imports
 * this interface, never an implementation; the composition root (./behaviors.ts) names one.
 *
 * Only the demo exists in this version: the companion's implementation comes with the companion (its stage 3), behind
 * the same interface and the same contract suite (./contract.ts).
 */
import type { CompanionEvent, Method, Params, ProjectId, Result, StreamOf } from './types';

/**
 * How the section stands with its backend (§8.5). The demo is `ready` at once; the others are the companion's, and
 * the page shows the demo's data beside each of them until the companion answers.
 */
export type ConnectionState =
  | 'no-permission'
  | 'not-installed'
  | 'not-running'
  | 'version-mismatch'
  | 'not-initialised'
  | 'ready-empty'
  | 'ready'
  | 'reconnecting'
  | 'paused';

export interface Connection {
  state: ConnectionState;
  /** The companion's version (absent for the demo). */
  companion?: string;
}

export interface Capabilities {
  /** The methods this backend answers (the companion's `welcome`; the demo answers all of them, writes in memory). */
  methods: readonly Method[];
  /** Whether what it shows is the demo's invented data. */
  demo: boolean;
}

export interface CallOptions<M extends Method> {
  /** Cancels a streaming call (search, commit, push); the call then rejects with `cancelled`. */
  signal?: AbortSignal;
  /** Each part of a streaming call, before its result. */
  onStream?: (part: StreamOf<M>) => void;
}

export interface ProjectBackend {
  readonly name: 'companion' | 'demo';
  connect(): Promise<Connection>;
  capabilities(): Capabilities;
  /** One method of the API; rejects with a `CompanionError` (./types.ts) in the API's form. */
  call<M extends Method>(method: M, params: Params<M>, options?: CallOptions<M>): Promise<Result<M>>;
  /** The events of one project; returns the undo. */
  subscribe(project: ProjectId, onEvent: (event: CompanionEvent) => void): () => void;
  /** Each change of the connection; returns the undo. */
  onState(listener: (state: ConnectionState) => void): () => void;
  /** Lets go of the connection (the page leaves the section). */
  dispose(): void;
}

/** Makes a backend for one page: each call gives a new one with its own state. */
export type ProjectBackendFactory = (() => ProjectBackend) & { readonly id: string };
