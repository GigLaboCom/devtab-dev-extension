/**
 * Seam `ProjectBackend` (D13; the companion's specification §8.1) — where the Projects section's projects come from:
 * the companion on the developer's machine, or the demo that works without it. Asynchronous from the first day: every
 * method answers with a promise, a long one takes an `AbortSignal` and streams its parts. A part of the page imports
 * this interface, never an implementation; the composition root (./behaviors.ts) names one.
 *
 * Two implementations behind the same contract suite (./contract.ts): the companion's client (./companion/) and the
 * demo (./demo/). The root hands the page one backend that follows the connection: the demo while there is no
 * permission or no companion, the companion once it answers.
 */
import type { CompanionEvent, Method, Params, ProjectId, Result, StreamOf } from './types';

/**
 * How the section stands with the companion (§8.5). The demo alone is `ready` at once. `not-initialised` and `paused`
 * are typed but not reached yet: the companion of this stage captures no environment and does not write.
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

/** What the connection part shows (§8.5): the state, and what goes with it. */
export interface ConnectionStatus extends Connection {
  /** A handshake is under way. */
  connecting: boolean;
  /** What Chrome, the relay or the companion said (English, never with a path outside a project). */
  detail?: string;
  /** For `version-mismatch`: which side is older. */
  update?: 'companion' | 'extension';
  /** For `not-running`: when the next try starts (ms since the epoch). */
  retryAt?: number;
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
  /** The events of one project (and the companion's own, which name no project); returns the undo. */
  subscribe(project: ProjectId, onEvent: (event: CompanionEvent) => void): () => void;
  /** Each change of the connection; returns the undo. */
  onState(listener: (state: ConnectionState) => void): () => void;
  /** The connection as the page shows it. */
  status(): ConnectionStatus;
  /** Asks Chrome for the permission — only from a click handler; true when granted. */
  requestPermission(): Promise<boolean>;
  /** Tries the companion again now («Check again»). */
  retry(): void;
  /** Lets go of the connection (the page leaves the section). */
  dispose(): void;
}

/** Makes a backend for one page: each call gives a new one with its own state. */
export type ProjectBackendFactory = (() => ProjectBackend) & { readonly id: string };
