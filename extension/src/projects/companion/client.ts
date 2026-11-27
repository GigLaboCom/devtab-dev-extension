/**
 * One connection to the companion (the companion's specification §4.2, §4.4, §4.9): the handshake — `hello` with the
 * API versions the page speaks, answered by `welcome` or by `unsupported-version` —, then calls correlated by the
 * page's own ids, the parts of a streaming call in `seq` order, cancellation, events and long answers joined from
 * their pieces (./chunks.ts). When the port closes every call still waiting fails with `not-running`; opening a new
 * connection is the caller's (../connection.ts).
 *
 * A frame that is not in the envelope's shape, a result for no call, a broken chunk: dropped and counted
 * (`malformed`), never thrown into the page.
 */
import { ChunkError, Chunks } from './chunks';
import { errorCode, serverFrame } from './link';
import { CompanionError } from '../types';
import type { AnnouncedLimits, ErrorCode, ServerFrame } from '../api/types.gen';
import type { LinkClosed, OpenLink } from './link';

/** The API versions this page speaks. */
export const API_VERSIONS: readonly number[] = [1];

/** How long the handshake may take: the relay itself waits up to 5 s for the supervisor to start. */
export const HANDSHAKE_MS = 15_000;

export interface Welcome {
  companion: string;
  api: number;
  server: string;
  platform: string;
  methods: string[];
  limits: AnnouncedLimits;
}

export type Handshake =
  | { kind: 'welcome'; welcome: Welcome }
  /** No API version in common; `supported` is what the companion speaks. */
  | { kind: 'unsupported'; supported: number[]; message: string }
  /** The relay or the supervisor said no before the welcome (`not-running`, `peer-not-allowed`, …). */
  | { kind: 'refused'; code: ErrorCode; message: string }
  /** The port closed without a word, or the handshake took too long. */
  | { kind: 'closed'; reason: LinkClosed };

export interface CompanionEventFrame {
  name: string;
  project: string | null;
  data: unknown;
}

export interface CallOptions {
  signal?: AbortSignal;
  onStream?: (part: unknown) => void;
}

export interface CompanionClient {
  readonly welcome: Welcome;
  call(method: string, params: unknown, options?: CallOptions): Promise<unknown>;
  onEvent(listener: (event: CompanionEventFrame) => void): () => void;
  /** The connection ended: Chrome's reason, or the companion's last word (an `error` without an id). */
  onClose(listener: (reason: LinkClosed, said: { code: ErrorCode; message: string } | null) => void): () => void;
  close(): void;
  readonly closed: boolean;
  /** Frames dropped because they made no sense. */
  readonly malformed: number;
}

export interface Timers {
  set(run: () => void, ms: number): unknown;
  clear(handle: unknown): void;
}

export const realTimers: Timers = {
  set: (run, ms) => setTimeout(run, ms),
  clear: handle => clearTimeout(handle as ReturnType<typeof setTimeout>),
};

export interface ClientOptions {
  openLink: OpenLink;
  /** The extension's version, for `hello`. */
  extension: string;
  api?: readonly number[];
  handshakeMs?: number;
  timers?: Timers;
}

interface Pending {
  resolve(result: unknown): void;
  reject(error: CompanionError): void;
  onStream?: (part: unknown) => void;
  next: number;
  early: Map<number, unknown>;
  stop?: () => void;
}

const dataOf = (data: unknown): Record<string, unknown> | undefined =>
  typeof data === 'object' && data !== null && !Array.isArray(data) ? (data as Record<string, unknown>) : undefined;

/** Opens a connection and shakes hands; `client` is there only after a welcome. */
export const openClient = (options: ClientOptions): Promise<{ handshake: Handshake; client: CompanionClient | null }> =>
  new Promise(settle => {
    const timers = options.timers ?? realTimers;
    const pending = new Map<number, Pending>();
    const eventListeners = new Set<(event: CompanionEventFrame) => void>();
    const closeListeners = new Set<Parameters<CompanionClient['onClose']>[0]>();
    const chunks = new Chunks();
    let welcome: Welcome | null = null;
    let settled = false;
    let closed = false;
    let malformed = 0;
    let nextId = 1;
    let lastWord: { code: ErrorCode; message: string } | null = null;
    let lastData: unknown;
    let timer: unknown = undefined;

    const finish = (handshake: Handshake, client: CompanionClient | null): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) timers.clear(timer);
      settle({ handshake, client });
    };

    const refusedOrUnsupported = (said: { code: ErrorCode; message: string }): Handshake => {
      if (said.code === 'unsupported-version') {
        const supported = dataOf(lastData)?.supported;
        return {
          kind: 'unsupported',
          supported: Array.isArray(supported) ? supported.filter((v): v is number => Number.isSafeInteger(v)) : [],
          message: said.message,
        };
      }
      return { kind: 'refused', code: said.code, message: said.message };
    };

    const end = (reason: LinkClosed): void => {
      if (closed) return;
      closed = true;
      chunks.clear();
      const lost = new CompanionError(
        lastWord?.code ?? 'not-running',
        lastWord?.message ?? 'the connection to the companion closed',
      );
      for (const call of pending.values()) {
        call.stop?.();
        call.reject(lost);
      }
      pending.clear();
      if (!settled) finish(lastWord ? refusedOrUnsupported(lastWord) : { kind: 'closed', reason }, null);
      else for (const listener of [...closeListeners]) listener(reason, lastWord);
    };

    const handle = (frame: ServerFrame): void => {
      switch (frame.type) {
        case 'welcome': {
          if (welcome) return void malformed++;
          welcome = {
            companion: frame.companion,
            api: frame.api,
            server: frame.server,
            platform: frame.platform,
            methods: frame.methods,
            limits: frame.limits,
          };
          if (!(options.api ?? API_VERSIONS).includes(frame.api)) {
            finish(
              { kind: 'unsupported', supported: [frame.api], message: 'the companion chose another version' },
              null,
            );
            link.close();
            closed = true;
            return;
          }
          finish({ kind: 'welcome', welcome }, client);
          return;
        }
        case 'chunk': {
          let joined: string | null;
          try {
            joined = chunks.add(frame);
          } catch (error) {
            if (!(error instanceof ChunkError)) throw error;
            malformed++;
            if (typeof frame.id === 'number') fail(frame.id, new CompanionError('internal', 'a long answer broke'));
            return;
          }
          if (joined === null) return;
          let inner: ServerFrame | null = null;
          try {
            inner = serverFrame(JSON.parse(joined));
          } catch {
            inner = null;
          }
          if (!inner || inner.type === 'chunk') return void malformed++;
          handle(inner);
          return;
        }
        case 'error': {
          const error = frame.error;
          if (frame.id === null || frame.id === undefined) {
            // A word about the connection, not a call: the relay's or the supervisor's last one before it closes.
            lastWord = { code: error.code, message: error.message };
            lastData = error.data;
            if (!settled) finish(refusedOrUnsupported(lastWord), null);
            return;
          }
          fail(frame.id, new CompanionError(errorCode(error.code), error.message, dataOf(error.data)));
          return;
        }
        case 'result': {
          const call = pending.get(frame.id);
          if (!call) return void malformed++;
          pending.delete(frame.id);
          call.stop?.();
          call.resolve(frame.result);
          return;
        }
        case 'stream': {
          const call = pending.get(frame.id);
          if (!call) return void malformed++;
          if (frame.seq < call.next || call.early.has(frame.seq)) return void malformed++;
          call.early.set(frame.seq, frame.data);
          while (call.early.has(call.next)) {
            const part = call.early.get(call.next);
            call.early.delete(call.next);
            call.next++;
            try {
              call.onStream?.(part);
            } catch {
              // The page's listener failing spoils no frame.
            }
          }
          return;
        }
        case 'event': {
          if (!welcome) return void malformed++;
          const event = { name: frame.name, project: frame.project ?? null, data: frame.data };
          for (const listener of [...eventListeners])
            try {
              listener(event);
            } catch {
              // One listener's failure spoils no other.
            }
          return;
        }
      }
    };

    const fail = (id: number, error: CompanionError): void => {
      const call = pending.get(id);
      if (!call) return void malformed++;
      pending.delete(id);
      call.stop?.();
      call.reject(error);
    };

    const link = options.openLink({
      onMessage(message) {
        if (closed) return;
        const frame = serverFrame(message);
        if (!frame) return void malformed++;
        handle(frame);
      },
      onClose: end,
    });

    const client: CompanionClient = {
      get welcome() {
        return welcome!;
      },
      get closed() {
        return closed;
      },
      get malformed() {
        return malformed;
      },
      call(method, params, { signal, onStream } = {}) {
        if (closed) return Promise.reject(new CompanionError('not-running', 'the connection to the companion closed'));
        if (signal?.aborted) return Promise.reject(new CompanionError('cancelled', 'the call was cancelled'));
        const id = nextId++;
        const frame = { type: 'call' as const, id, method, params };
        const limit = welcome?.limits.maxRequestBytes;
        if (limit !== undefined && new TextEncoder().encode(JSON.stringify(frame)).length > limit)
          return Promise.reject(
            new CompanionError('invalid-params', 'the request is larger than the companion takes', { field: 'params' }),
          );
        return new Promise((resolve, reject) => {
          const call: Pending = { resolve, reject, next: 0, early: new Map(), ...(onStream && { onStream }) };
          if (signal) {
            const abort = (): void => {
              if (!pending.has(id)) return;
              pending.delete(id);
              chunks.drop(id);
              link.send({ type: 'cancel', id });
              reject(new CompanionError('cancelled', 'the call was cancelled'));
            };
            signal.addEventListener('abort', abort, { once: true });
            call.stop = () => signal.removeEventListener('abort', abort);
          }
          pending.set(id, call);
          link.send(frame);
        });
      },
      onEvent(listener) {
        eventListeners.add(listener);
        return () => eventListeners.delete(listener);
      },
      onClose(listener) {
        closeListeners.add(listener);
        return () => closeListeners.delete(listener);
      },
      close() {
        if (closed) return;
        link.close();
        end({ kind: 'closed', message: 'closed by the page' });
      },
    };

    timer = timers.set(() => {
      if (settled) return;
      link.close();
      closed = true;
      finish({ kind: 'closed', reason: { kind: 'closed', message: 'the companion did not answer in time' } }, null);
    }, options.handshakeMs ?? HANDSHAKE_MS);

    link.send({ type: 'hello', extension: options.extension, api: [...(options.api ?? API_VERSIONS)] });
  });
