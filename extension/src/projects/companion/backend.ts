/**
 * `companionBackend` — the seam `ProjectBackend` (../backend.ts) over the companion (../connection.ts): every call goes
 * to the companion as it is, and the answer comes back in the contract's shape. What the companion can do is what its
 * `welcome` lists: a method it does not list (every write of this stage) is refused here with `unknown-method` and
 * never sent, so the page shows it inactive instead of meeting a failing call.
 *
 * The page subscribes to a project's events through `events.subscribe`; the subscriptions are said again to a new
 * connection after a reconnect, since the companion forgets them with the old one.
 */
import { CompanionError } from '../types';
import type { CallOptions, Capabilities, ConnectionState, ProjectBackend } from '../backend';
import type { CompanionConnection } from '../connection';
import type { CompanionEvent, Method, Params, ProjectId, Result } from '../types';
import type { CompanionClient } from './client';

export const companionBackend = (connection: CompanionConnection): ProjectBackend => {
  const listeners = new Map<ProjectId | null, Set<(event: CompanionEvent) => void>>();
  const subscribed = new Set<ProjectId>();
  let told: CompanionClient | null = null;

  const methods = (): readonly Method[] => (connection.welcome()?.methods ?? []) as Method[];

  const undoEvents = connection.onEvent(frame => {
    const event = frame as CompanionEvent;
    const heard =
      event.project === null
        ? [...listeners.values()].flatMap(set => [...set])
        : [...(listeners.get(event.project) ?? [])];
    for (const listener of heard)
      try {
        listener(event);
      } catch {
        // One listener's failure spoils no other.
      }
  });

  /** A new connection hears the page's subscriptions again. */
  const resubscribe = (client: CompanionClient): void => {
    if (told === client) return;
    const first = told === null;
    told = client;
    if (first) return;
    for (const project of subscribed) void client.call('events.subscribe', { project }).catch(() => undefined);
  };

  return {
    name: 'companion',
    connect: () => connection.start().then(({ state, companion }) => ({ state, ...(companion && { companion }) })),
    capabilities: (): Capabilities => ({ methods: methods(), demo: false }),
    async call<M extends Method>(method: M, params: Params<M>, options: CallOptions<M> = {}): Promise<Result<M>> {
      const client = await connection.client();
      resubscribe(client);
      if (!methods().includes(method))
        throw new CompanionError('unknown-method', `this companion does not offer ${String(method)}`, {
          method: String(method),
        });
      if (method === 'events.subscribe') subscribed.add((params as { project: ProjectId }).project);
      if (method === 'events.unsubscribe') subscribed.delete((params as { project: ProjectId }).project);
      return (await client.call(method, params, {
        ...(options.signal && { signal: options.signal }),
        ...(options.onStream && { onStream: options.onStream as (part: unknown) => void }),
      })) as Result<M>;
    },
    subscribe(project, onEvent) {
      const set = listeners.get(project) ?? new Set();
      set.add(onEvent);
      listeners.set(project, set);
      return () => set.delete(onEvent);
    },
    onState: (listener: (state: ConnectionState) => void) => connection.onStatus(status => listener(status.state)),
    status: () => connection.status(),
    requestPermission: () => connection.grant(),
    retry: () => connection.retry(),
    dispose() {
      undoEvents();
      listeners.clear();
      connection.dispose();
    },
  };
};
