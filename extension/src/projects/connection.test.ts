/**
 * The connection's states (§8.5) with a fake `chrome.permissions` and a fake port: no permission, the click that asks,
 * the reload after a grant, not installed, not running and its retry every 5 s, another version, empty, ready, a lost
 * port won back, a restarted server, the permission removed — and the port closed by the page itself.
 */
import { companionBackend } from './companion/backend';
import { fakeCompanion } from './companion/fakeLink';
import { RETRY_MS, createConnection } from './connection';
import { isCompanionError } from './types';
import { describe, expect, it, vi } from 'vitest';
import type { Timers } from './companion/client';
import type { ConnectionDeps } from './connection';
import type { PermissionGate } from './permission';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await new Promise(resolve => setTimeout(resolve, 0));
};

/** Chrome's permission, held by the test. */
const fakePermission = (granted: boolean, answer = true) => {
  const added = new Set<() => void>();
  const removed = new Set<() => void>();
  const state = { granted, usable: granted, asked: 0 };
  const gate: PermissionGate = {
    contains: () => Promise.resolve(state.granted),
    request: () => {
      state.asked++;
      if (answer) state.granted = true;
      return Promise.resolve(answer);
    },
    usable: () => state.usable,
    onAdded: l => (added.add(l), () => added.delete(l)),
    onRemoved: l => (removed.add(l), () => removed.delete(l)),
  };
  return {
    gate,
    state,
    remove() {
      state.granted = false;
      for (const l of removed) l();
    },
    listeners: () => added.size + removed.size,
  };
};

/** Timers the test runs by hand; the handshake's own timer never fires. */
const manualTimers = () => {
  const pending = new Map<number, { run: () => void; ms: number }>();
  let next = 1;
  const timers: Timers = {
    set: (run, ms) => (pending.set(next, { run, ms }), next++),
    clear: handle => void pending.delete(handle as number),
  };
  return {
    timers,
    /** Runs the earliest timer shorter than the handshake's, with its delay. */
    fire(): number | null {
      const [id, timer] = [...pending].filter(([, t]) => t.ms < 15_000).sort((a, b) => a[1].ms - b[1].ms)[0] ?? [];
      if (!timer) return null;
      pending.delete(id!);
      timer.run();
      return timer.ms;
    },
    delays: () => [...pending.values()].map(t => t.ms).filter(ms => ms < 15_000),
  };
};

const setup = (
  options: { granted?: boolean; answer?: boolean; mode?: 'normal' | 'empty' | 'version' | 'not-running' } = {},
) => {
  const permission = fakePermission(options.granted ?? true, options.answer ?? true);
  const fake = fakeCompanion({ mode: options.mode ?? 'normal' });
  const clock = manualTimers();
  const reload = vi.fn();
  const links = { open: fake.openLink };
  const deps: ConnectionDeps = {
    permission: permission.gate,
    openLink: events => links.open(events),
    extension: '1.2.3',
    reload,
    timers: clock.timers,
  };
  const connection = createConnection(deps);
  const states: string[] = [];
  connection.onStatus(s => states.push(s.connecting ? `${s.state}…` : s.state));
  return { permission, fake, clock, reload, connection, states, links };
};

describe('the connection', () => {
  it('no permission: `no-permission`, no port opened', async () => {
    const { connection, fake } = setup({ granted: false });
    expect((await connection.start()).state).toBe('no-permission');
    expect(fake.ports).toHaveLength(0);
  });

  it('the click asks Chrome; granted with connectNative already there → connects', async () => {
    const { connection, permission, fake } = setup({ granted: false });
    await connection.start();
    permission.state.usable = true;
    expect(await connection.grant()).toBe(true);
    expect(permission.state.asked).toBe(1);
    expect(connection.status().state).toBe('ready');
    expect(fake.ports).toHaveLength(1);
  });

  it('granted but connectNative not on this page yet → the page reloads instead (finding 8)', async () => {
    const { connection, permission, reload, fake } = setup({ granted: false });
    await connection.start();
    expect(await connection.grant()).toBe(true);
    expect(permission.state.usable).toBe(false);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(fake.ports).toHaveLength(0);
  });

  it('refused in Chrome’s prompt: stays `no-permission`', async () => {
    const { connection } = setup({ granted: false, answer: false });
    await connection.start();
    expect(await connection.grant()).toBe(false);
    expect(connection.status().state).toBe('no-permission');
  });

  it('no host: `not-installed`, with Chrome’s words; «Check again» tries once more', async () => {
    const { connection, fake } = setup();
    fake.next = 'not-found';
    expect(await connection.start()).toMatchObject({
      state: 'not-installed',
      detail: 'Specified native messaging host not found.',
    });
    fake.next = 'answer';
    connection.retry();
    await settle();
    expect(connection.status().state).toBe('ready');
  });

  it('`not-running`: says so and tries again every 5 s by itself', async () => {
    const { connection, fake, clock } = setup({ mode: 'not-running' });
    expect((await connection.start()).state).toBe('not-running');
    expect(connection.status().retryAt).toBeGreaterThan(Date.now());
    expect(clock.delays()).toEqual([RETRY_MS]);
    expect(clock.fire()).toBe(RETRY_MS);
    await settle();
    expect(fake.ports).toHaveLength(2);
    expect(connection.status().state).toBe('not-running');
    expect(clock.delays()).toEqual([RETRY_MS]);
  });

  it('another API version: `version-mismatch`, the companion is newer → update the extension', async () => {
    const { connection } = setup({ mode: 'version' });
    expect(await connection.start()).toMatchObject({ state: 'version-mismatch', update: 'extension' });
  });

  it('connected without projects: `ready-empty`; with them: `ready`', async () => {
    expect((await setup({ mode: 'empty' }).connection.start()).state).toBe('ready-empty');
    const { connection, states } = setup();
    expect(await connection.start()).toMatchObject({ state: 'ready', companion: '0.1.0' });
    expect(states).toEqual(['no-permission…', 'ready']);
  });

  it('a lost port: `reconnecting`, a new port at once, `ready` again; calls made meanwhile wait for it', async () => {
    const { connection, fake, clock, states } = setup();
    await connection.start();
    fake.ports[0]!.lose();
    await settle();
    expect(connection.status().state).toBe('reconnecting');
    const waiting = connection.client();
    expect(clock.fire()).toBe(0);
    await settle();
    expect(connection.status().state).toBe('ready');
    expect(fake.ports).toHaveLength(2);
    expect((await waiting).closed).toBe(false);
    expect(states.slice(-3)).toEqual(['reconnecting', 'reconnecting…', 'ready']);
  });

  it('a lost port that does not come back: a few tries, then `not-running` with its retry', async () => {
    const { connection, fake, clock, links } = setup();
    await connection.start();
    // From now on the supervisor is gone: the relay says so and exits.
    links.open = fakeCompanion({ mode: 'not-running' }).openLink;
    fake.ports[0]!.lose();
    await settle();
    let tries = 0;
    while (connection.status().state === 'reconnecting' && tries < 10) {
      clock.fire();
      await settle();
      tries++;
    }
    expect(connection.status().state).toBe('not-running');
  });

  it('the server restarted: `reconnecting` while the list is read again, then `ready`', async () => {
    const { connection, fake, states } = setup();
    await connection.start();
    fake.emit('server.restarted', null, {});
    await settle();
    expect(states.slice(-2)).toEqual(['reconnecting', 'ready']);
  });

  it('the permission removed: `no-permission`, and the page closes its port itself', async () => {
    const { connection, fake, permission } = setup();
    await connection.start();
    permission.remove();
    expect(connection.status().state).toBe('no-permission');
    expect(fake.ports[0]!.closedByPage).toBe(true);
    const error = await connection.client().catch((e: unknown) => e);
    expect(isCompanionError(error, 'not-running')).toBe(true);
  });

  it('leaving the section closes the port and forgets Chrome’s listeners', async () => {
    const { connection, fake, permission } = setup();
    await connection.start();
    connection.dispose();
    expect(fake.ports[0]!.closedByPage).toBe(true);
    expect(permission.listeners()).toBe(0);
  });
});

describe('the companion’s backend', () => {
  it('offers what the welcome lists; a write it does not list is refused here and never sent', async () => {
    const { connection, fake } = setup();
    const backend = companionBackend(connection);
    await backend.connect();
    expect(backend.capabilities()).toMatchObject({ demo: false });
    expect(backend.capabilities().methods).toContain('search.start');
    expect(backend.capabilities().methods).not.toContain('file.save');
    const error = await backend
      .call('file.save', { project: 'p_abcdefgh23', path: 'x', baseHash: 'h', text: 't' })
      .catch((e: unknown) => e);
    expect(isCompanionError(error, 'unknown-method')).toBe(true);
    expect(fake.ports[0]!.sent.some(f => (f as { method?: string }).method === 'file.save')).toBe(false);
  });

  it('routes events by project (the companion’s own to every listener) and says the subscriptions again after a reconnect', async () => {
    const { connection, fake, clock } = setup();
    const backend = companionBackend(connection);
    await backend.connect();
    const heard: string[] = [];
    backend.subscribe('p_abcdefgh23', e => heard.push(`${e.name}:${e.project}`));
    await backend.call('events.subscribe', { project: 'p_abcdefgh23' });
    fake.emit('files.changed', 'p_abcdefgh23', { paths: ['a'], more: false });
    fake.emit('server.restarted', null, {});
    await settle();
    expect(heard).toEqual(['files.changed:p_abcdefgh23', 'server.restarted:null']);
    fake.ports[0]!.lose();
    await settle();
    clock.fire();
    await settle();
    await backend.call('projects.list', {});
    await settle();
    const resent = fake.ports[1]!.sent.filter(f => (f as { method?: string }).method === 'events.subscribe');
    expect(resent).toHaveLength(1);
  });
});
