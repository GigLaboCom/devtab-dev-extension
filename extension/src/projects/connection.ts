/**
 * The page's connection to the companion and its states (the companion's specification §8.2, §8.3, §8.5). The page of
 * the Projects section holds the one port (opened on entering the section, closed on leaving it and with the tab); the
 * service worker takes no part.
 *
 *   no-permission     `nativeMessaging` is not granted: the demo, and «Connect the companion» (a click asks Chrome;
 *                     granted but no `connectNative` on this page yet → the page reloads, finding 8)
 *   not-installed     Chrome finds no host (no manifest, no program — finding 6), or the host does not allow this
 *                     extension
 *   not-running       the relay could not reach the supervisor (its `not-running` before it exits, finding 7), or the
 *                     supervisor is full: tried again every 5 s by itself
 *   version-mismatch  no API version in common (`unsupported-version`), with which side to update
 *   ready-empty       connected; `projects.list` is empty
 *   ready             connected, with projects
 *   reconnecting      the port was lost, or the companion's server restarted: tried again at once, then after a pause;
 *                     the page reads everything again once it is back
 * `not-initialised` and `paused` are typed but not reached in this stage (the companion captures no environment and
 * does not write). The permission removed in chrome://extensions → `no-permission`, and the page closes its port
 * itself: Chrome does not close an open one (finding 8).
 */
import { API_VERSIONS, openClient, realTimers } from './companion/client';
import { CompanionError } from './types';
import type { ConnectionStatus } from './backend';
import type { CompanionClient, CompanionEventFrame, Handshake, Timers, Welcome } from './companion/client';
import type { OpenLink } from './companion/link';
import type { PermissionGate } from './permission';

/** How often `not-running` tries again (§8.5). */
export const RETRY_MS = 5_000;
/** The pauses before each new try after the port was lost; the last one repeats until `not-running` takes over. */
export const RECONNECT_MS: readonly number[] = [0, 1_000, 2_000];

export interface ConnectionDeps {
  permission: PermissionGate;
  openLink: OpenLink;
  /** The extension's version, said in `hello`. */
  extension: string;
  /** Reloads the section's page (after a grant, when `connectNative` has not appeared). */
  reload(): void;
  retryMs?: number;
  reconnectMs?: readonly number[];
  timers?: Timers;
  now?: () => number;
}

export interface CompanionConnection {
  status(): ConnectionStatus;
  onStatus(listener: (status: ConnectionStatus) => void): () => void;
  /** Checks the permission and connects; once. */
  start(): Promise<ConnectionStatus>;
  /** Tries again now. */
  retry(): void;
  /** Asks for the permission (from a click) and connects. */
  grant(): Promise<boolean>;
  /** The connected client: at once when ready, after the handshake under way, else a `CompanionError`. */
  client(): Promise<CompanionClient>;
  /** The companion's `welcome` of the current connection. */
  welcome(): Welcome | null;
  /** The events of every connection, the ones after a reconnect included. */
  onEvent(listener: (event: CompanionEventFrame) => void): () => void;
  dispose(): void;
}

const CONNECTED = new Set(['ready', 'ready-empty']);

export const createConnection = (deps: ConnectionDeps): CompanionConnection => {
  const timers = deps.timers ?? realTimers;
  const now = deps.now ?? Date.now;
  const retryMs = deps.retryMs ?? RETRY_MS;
  const reconnectMs = deps.reconnectMs ?? RECONNECT_MS;
  const statusListeners = new Set<(status: ConnectionStatus) => void>();
  const eventListeners = new Set<(event: CompanionEventFrame) => void>();
  let current: ConnectionStatus = { state: 'no-permission', connecting: true };
  let client: CompanionClient | null = null;
  let attempt: Promise<void> | null = null;
  let started: Promise<ConnectionStatus> | null = null;
  let timer: unknown;
  let lost = 0;
  let disposed = false;
  let generation = 0;
  let waiters: { resolve(client: CompanionClient): void; reject(error: CompanionError): void }[] = [];

  const set = (next: ConnectionStatus): void => {
    if (disposed) return;
    current = next;
    // A call waits while a handshake is under way or the port is being won back; it fails once the outcome is not one.
    if (!next.connecting && next.state !== 'reconnecting') {
      const ready = CONNECTED.has(next.state) && client && !client.closed ? client : null;
      const settled = waiters;
      waiters = [];
      for (const w of settled)
        if (ready) w.resolve(ready);
        else w.reject(new CompanionError('not-running', `the companion is not connected (${next.state})`));
    }
    for (const listener of [...statusListeners]) listener(next);
  };

  const later = (run: () => void, ms: number): void => {
    if (timer !== undefined) timers.clear(timer);
    timer = timers.set(() => {
      timer = undefined;
      run();
    }, ms);
  };
  const stopTimer = (): void => {
    if (timer !== undefined) timers.clear(timer);
    timer = undefined;
  };

  const drop = (): void => {
    const old = client;
    client = null;
    old?.close();
  };

  /** What a failed handshake means (the welcome is handled by `connect`). */
  const failed = (handshake: Exclude<Handshake, { kind: 'welcome' }>): ConnectionStatus => {
    if (handshake.kind === 'unsupported') {
      const theirs = Math.max(...handshake.supported, 0);
      return {
        state: 'version-mismatch',
        connecting: false,
        detail: handshake.message,
        update: theirs > Math.max(...API_VERSIONS) ? 'extension' : 'companion',
      };
    }
    if (handshake.kind === 'refused') {
      if (handshake.code === 'peer-not-allowed')
        return { state: 'not-installed', connecting: false, detail: handshake.message };
      return { state: 'not-running', connecting: false, detail: handshake.message, retryAt: now() + retryMs };
    }
    const { reason } = handshake;
    if (reason.kind === 'not-found' || reason.kind === 'forbidden')
      return { state: 'not-installed', connecting: false, detail: reason.message };
    if (reason.kind === 'unavailable') return { state: 'no-permission', connecting: false };
    return { state: 'not-running', connecting: false, detail: reason.message, retryAt: now() + retryMs };
  };

  const connect = (): Promise<void> => {
    if (attempt) return attempt;
    stopTimer();
    const mine = ++generation;
    set({ ...current, connecting: true });
    attempt = (async () => {
      const { handshake, client: next } = await openClient({
        openLink: deps.openLink,
        extension: deps.extension,
        timers,
      });
      if (disposed || mine !== generation) {
        next?.close();
        return;
      }
      if (handshake.kind !== 'welcome' || !next) {
        const status = failed(handshake as Exclude<Handshake, { kind: 'welcome' }>);
        const wasLost = current.state === 'reconnecting';
        if (wasLost && status.state === 'not-running' && lost < reconnectMs.length) {
          // Lost a moment ago: try again a few times before saying the companion is not running.
          set({ state: 'reconnecting', connecting: false });
          later(() => void connect(), reconnectMs[lost++]!);
          return;
        }
        set(status);
        if (status.state === 'not-running') later(() => void connect(), retryMs);
        return;
      }
      client = next;
      lost = 0;
      next.onEvent(event => {
        if (event.name === 'server.restarted') void relist(next);
        for (const listener of [...eventListeners]) listener(event);
      });
      next.onClose(() => {
        if (client !== next || disposed) return;
        client = null;
        set({ state: 'reconnecting', connecting: false, companion: next.welcome.companion });
        later(() => void connect(), reconnectMs[lost++] ?? retryMs);
      });
      await relist(next, true);
    })().finally(() => {
      attempt = null;
    });
    return attempt;
  };

  /** `ready` or `ready-empty` by the projects the companion has; `reconnecting` while it reads them again. */
  const relist = async (of: CompanionClient, first = false): Promise<void> => {
    if (!first) set({ state: 'reconnecting', connecting: false, companion: of.welcome.companion });
    let empty = false;
    try {
      empty = ((await of.call('projects.list', {})) as unknown[]).length === 0;
    } catch {
      // The list's own error is the page's to show; the connection stands.
    }
    if (client !== of || disposed) return;
    set({ state: empty ? 'ready-empty' : 'ready', connecting: false, companion: of.welcome.companion });
  };

  const removed = (): void => {
    stopTimer();
    generation++;
    drop();
    set({ state: 'no-permission', connecting: false });
  };

  const undoRemoved = deps.permission.onRemoved(removed);
  const undoAdded = deps.permission.onAdded(() => {
    if (current.state === 'no-permission' && !current.connecting && deps.permission.usable()) void connect();
  });

  return {
    status: () => current,
    onStatus(listener) {
      statusListeners.add(listener);
      return () => statusListeners.delete(listener);
    },
    start() {
      started ??= (async () => {
        if (!(await deps.permission.contains())) set({ state: 'no-permission', connecting: false });
        else await connect();
        return current;
      })();
      return started;
    },
    retry() {
      if (disposed) return;
      void (async () => {
        if (!(await deps.permission.contains())) return set({ state: 'no-permission', connecting: false });
        if (client && !client.closed) return relist(client);
        return connect();
      })();
    },
    async grant() {
      // First thing in the click: Chrome takes a request only inside the user's gesture.
      const granted = await deps.permission.request();
      if (!granted || disposed) return false;
      if (!deps.permission.usable()) deps.reload();
      else await connect();
      return true;
    },
    client() {
      if (client && !client.closed && CONNECTED.has(current.state)) return Promise.resolve(client);
      if (current.connecting || current.state === 'reconnecting')
        return new Promise((resolve, reject) => waiters.push({ resolve, reject }));
      return Promise.reject(new CompanionError('not-running', `the companion is not connected (${current.state})`));
    },
    welcome: () => client?.welcome ?? null,
    onEvent(listener) {
      eventListeners.add(listener);
      return () => eventListeners.delete(listener);
    },
    dispose() {
      if (disposed) return;
      stopTimer();
      undoRemoved();
      undoAdded();
      drop();
      const settled = waiters;
      waiters = [];
      for (const w of settled) w.reject(new CompanionError('not-running', 'the page left the section'));
      disposed = true;
      statusListeners.clear();
      eventListeners.clear();
    },
  };
};
