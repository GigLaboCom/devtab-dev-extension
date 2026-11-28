/**
 * The client over a fake port: the handshake's outcomes, calls correlated by id, streams in order, cancellation, long
 * answers in pieces, events, a lost port, malformed frames — and every vector of the contract parsed as the companion
 * sends it.
 */
import { openClient } from './client';
import { VECTORS, fakeCompanion } from './fakeLink';
import { serverFrame } from './link';
import { isCompanionError } from '../types';
import { describe, expect, it } from 'vitest';
import type { CompanionClient, Timers } from './client';
import type { Link, LinkEvents, OpenLink } from './link';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 5; i++) await new Promise(resolve => setTimeout(resolve, 0));
};
const codeOf = (promise: Promise<unknown>): Promise<unknown> =>
  promise.then(
    () => 'resolved',
    (e: unknown) => (isCompanionError(e) ? e.code : e),
  );

/** A port the test drives by hand. */
const manualPort = () => {
  const sent: Record<string, unknown>[] = [];
  let events: LinkEvents | null = null;
  let closed = false;
  const openLink: OpenLink = e => {
    events = e;
    const link: Link = {
      send: frame => void sent.push(frame as unknown as Record<string, unknown>),
      close: () => void (closed = true),
    };
    return link;
  };
  return {
    sent,
    openLink,
    get closed() {
      return closed;
    },
    reply: (message: unknown) => events!.onMessage(message),
    lose: (message = 'Native host has exited.') => events!.onClose({ kind: 'exited', message }),
  };
};

const welcomeOf = (VECTORS['hello.json'] as { response: unknown }[])[0]!.response;
const connected = async (): Promise<{ client: CompanionClient; port: ReturnType<typeof manualPort> }> => {
  const port = manualPort();
  const opened = openClient({ openLink: port.openLink, extension: '1.0.0' });
  port.reply(welcomeOf);
  const { client } = await opened;
  return { client: client!, port };
};

describe('the handshake', () => {
  it('says hello with the extension’s version and API versions; a welcome gives a client', async () => {
    const fake = fakeCompanion();
    const { handshake, client } = await openClient({ openLink: fake.openLink, extension: '1.4.0' });
    expect(fake.ports[0]!.sent[0]).toEqual({ type: 'hello', extension: '1.4.0', api: [1] });
    expect(handshake.kind).toBe('welcome');
    expect(client?.welcome.methods).toContain('tree.list');
    client!.close();
  });

  it('no version in common: `unsupported` with what the companion speaks', async () => {
    const fake = fakeCompanion({ mode: 'version' });
    const { handshake, client } = await openClient({ openLink: fake.openLink, extension: '1.4.0' });
    expect(handshake).toMatchObject({ kind: 'unsupported', supported: [2] });
    expect(client).toBeNull();
  });

  it('the relay could not reach the supervisor: `refused` with `not-running`', async () => {
    const fake = fakeCompanion({ mode: 'not-running' });
    const { handshake } = await openClient({ openLink: fake.openLink, extension: '1.4.0' });
    expect(handshake).toMatchObject({ kind: 'refused', code: 'not-running' });
  });

  it('no host: `closed` with Chrome’s reason', async () => {
    const fake = fakeCompanion();
    fake.next = 'not-found';
    const { handshake } = await openClient({ openLink: fake.openLink, extension: '1.4.0' });
    expect(handshake).toMatchObject({ kind: 'closed', reason: { kind: 'not-found' } });
  });

  it('a welcome with an API version the page did not offer is no welcome', async () => {
    const port = manualPort();
    const opened = openClient({ openLink: port.openLink, extension: '1' });
    port.reply({ ...(welcomeOf as object), api: 7 });
    expect((await opened).handshake).toMatchObject({ kind: 'unsupported', supported: [7] });
    expect(port.closed).toBe(true);
  });

  it('no answer in time: `closed`, the port let go', async () => {
    const port = manualPort();
    let fire: () => void = () => undefined;
    const timers: Timers = { set: run => ((fire = run), 1), clear: () => undefined };
    const opened = openClient({ openLink: port.openLink, extension: '1', timers });
    fire();
    expect((await opened).handshake.kind).toBe('closed');
    expect(port.closed).toBe(true);
  });

  it('malformed frames before the welcome are dropped and counted', async () => {
    const port = manualPort();
    const opened = openClient({ openLink: port.openLink, extension: '1' });
    port.reply('nonsense');
    port.reply({ type: 'welcome' });
    port.reply({ type: 'result', id: 'x', result: 1 });
    port.reply(welcomeOf);
    const { client } = await opened;
    expect(client!.malformed).toBe(3);
  });
});

describe('calls', () => {
  it('correlates answers by id, whatever their order', async () => {
    const { client, port } = await connected();
    const a = client.call('projects.list', {});
    const b = client.call('companion.state', {});
    const [first, second] = port.sent.slice(1) as { id: number }[];
    expect(first!.id).not.toBe(second!.id);
    port.reply({ type: 'result', id: second!.id, result: 'B' });
    port.reply({ type: 'result', id: first!.id, result: 'A' });
    expect(await Promise.all([a, b])).toEqual(['A', 'B']);
  });

  it('an error frame rejects its call with the contract’s code and data; an unknown code is `internal`', async () => {
    const { client, port } = await connected();
    const a = client.call('file.read', { project: 'p', path: 'x' });
    const b = client.call('file.read', { project: 'p', path: 'y' });
    const [first, second] = port.sent.slice(1) as { id: number }[];
    port.reply({
      type: 'error',
      id: first!.id,
      error: { code: 'too-large', message: 'big', data: { size: 9, limit: 1 } },
    });
    port.reply({ type: 'error', id: second!.id, error: { code: 'from-the-future', message: 'new' } });
    const error = await a.catch((e: unknown) => e);
    expect(isCompanionError(error, 'too-large') && error.data).toEqual({ size: 9, limit: 1 });
    expect(await codeOf(b)).toBe('internal');
  });

  it('streams the parts in seq order before the result', async () => {
    const { client, port } = await connected();
    const parts: unknown[] = [];
    const done = client.call('search.start', { project: 'p', pattern: 'x' }, { onStream: d => parts.push(d) });
    const { id } = port.sent[1] as { id: number };
    port.reply({ type: 'stream', id, seq: 1, data: 'second' });
    port.reply({ type: 'stream', id, seq: 0, data: 'first' });
    port.reply({ type: 'stream', id, seq: 1, data: 'again' });
    port.reply({ type: 'result', id, result: { files: 2 } });
    expect(await done).toEqual({ files: 2 });
    expect(parts).toEqual(['first', 'second']);
    expect(client.malformed).toBe(1);
  });

  it('cancels: a `cancel` frame goes, the call rejects with `cancelled` at once, late frames are dropped', async () => {
    const { client, port } = await connected();
    const controller = new AbortController();
    const done = client.call('search.start', { project: 'p', pattern: 'x' }, { signal: controller.signal });
    const { id } = port.sent[1] as { id: number };
    controller.abort();
    expect(await codeOf(done)).toBe('cancelled');
    expect(port.sent[2]).toEqual({ type: 'cancel', id });
    port.reply({ type: 'error', id, error: { code: 'cancelled', message: 'cancelled' } });
    expect(client.malformed).toBe(1);
    const before = new AbortController();
    before.abort();
    expect(await codeOf(client.call('search.start', {}, { signal: before.signal }))).toBe('cancelled');
    expect(port.sent).toHaveLength(3);
  });

  it('joins an answer sent in pieces', async () => {
    const fake = fakeCompanion({ big: true, maxFrameBytes: 4096 });
    const { client } = await openClient({ openLink: fake.openLink, extension: '1' });
    const file = (await client!.call('file.read', { project: 'p_hostile001', path: 'large.txt' })) as { text: string };
    expect(file.text.length).toBeGreaterThan(2 * 1024 * 1024 * 0.5);
    expect(file.text.endsWith('backslash\n')).toBe(true);
    const sent = fake.ports[0]!.sent;
    expect(sent.at(-1)).toMatchObject({ method: 'file.read' });
    client!.close();
  });

  it('a lost port fails every waiting call with `not-running`; the client says so once', async () => {
    const { client, port } = await connected();
    const reasons: string[] = [];
    client.onClose(reason => reasons.push(reason.kind));
    const waiting = client.call('projects.list', {});
    port.lose();
    expect(await codeOf(waiting)).toBe('not-running');
    expect(reasons).toEqual(['exited']);
    expect(client.closed).toBe(true);
    expect(await codeOf(client.call('projects.list', {}))).toBe('not-running');
  });

  it('the companion’s last word before it closes is the waiting calls’ error', async () => {
    const { client, port } = await connected();
    const waiting = client.call('projects.list', {});
    port.reply({ type: 'error', id: null, error: { code: 'too-many-connections', message: 'full' } });
    port.lose();
    expect(await codeOf(waiting)).toBe('too-many-connections');
  });

  it('events reach the listeners; a listener that throws spoils no other', async () => {
    const { client, port } = await connected();
    const heard: unknown[] = [];
    client.onEvent(() => {
      throw new Error('mine');
    });
    client.onEvent(e => heard.push(e));
    port.reply({ type: 'event', name: 'files.changed', project: 'p', data: { paths: ['a'], more: false } });
    port.reply({ type: 'event', name: 'server.restarted', data: {} });
    expect(heard).toEqual([
      { name: 'files.changed', project: 'p', data: { paths: ['a'], more: false } },
      { name: 'server.restarted', project: null, data: {} },
    ]);
  });

  it('refuses a request larger than the companion takes, without sending it', async () => {
    const { client, port } = await connected();
    const huge = 'x'.repeat((welcomeOf as { limits: { maxRequestBytes: number } }).limits.maxRequestBytes);
    expect(await codeOf(client.call('file.read', { project: 'p', path: huge }))).toBe('invalid-params');
    expect(port.sent).toHaveLength(1);
  });
});

describe('the contract’s vectors', () => {
  /** A vector of an event (`open.requested.json`): no request, the frame the companion sends by itself. */
  const isEventVector = (list: unknown): boolean =>
    Array.isArray(list) && list.every(v => typeof v === 'object' && v !== null && 'event' in v && !('request' in v));
  const calls = Object.entries(VECTORS).flatMap(([file, list]) =>
    file === 'hello.json' || file === 'chunking.json' || isEventVector(list)
      ? []
      : (
          list as {
            request: { method: string; params: unknown };
            response: Record<string, unknown>;
            stream?: unknown[];
          }[]
        ).map((v, i) => [`${file} #${i}`, v] as const),
  );

  it.each(calls)('%s: the companion’s frames are in the envelope’s shape', (_name, v) => {
    expect(serverFrame(v.response)).not.toBeNull();
    for (const part of v.stream ?? []) expect(serverFrame(part)).not.toBeNull();
  });

  // A vector file is a sequence (a project made writable, then asked again; a commit, then undone): each file's calls
  // go to one companion that plays them in order.
  const files = Object.entries(VECTORS).filter(
    ([file, list]) => file !== 'hello.json' && file !== 'chunking.json' && !isEventVector(list),
  );
  const events = Object.entries(VECTORS).filter(([, list]) => isEventVector(list));

  it.each(events)(
    '%s: the event the companion sends is in the envelope’s shape and reaches the page',
    async (_f, list) => {
      const fake = fakeCompanion({});
      const { client } = await openClient({ openLink: fake.openLink, extension: '1' });
      const heard: unknown[] = [];
      client!.onEvent(event => heard.push(event));
      for (const v of list as { event: { name: string; project: string | null; data: unknown } }[]) {
        expect(serverFrame(v.event)).not.toBeNull();
        fake.emit(v.event.name, v.event.project, v.event.data);
      }
      await settle();
      expect(heard).toEqual(
        (list as { event: { name: string; project: string | null; data: unknown } }[]).map(v => ({
          name: v.event.name,
          project: v.event.project,
          data: v.event.data,
        })),
      );
      client!.close();
      await settle();
    },
  );
  it.each(files)('%s: the client gives the page what the companion answered, call after call', async (_file, list) => {
    const fake = fakeCompanion({ replay: true });
    const { client } = await openClient({ openLink: fake.openLink, extension: '1' });
    for (const v of list as {
      request: { method: string; params: unknown };
      response: Record<string, unknown>;
      stream?: unknown[];
    }[]) {
      const parts: unknown[] = [];
      const outcome = await client!.call(v.request.method, v.request.params, { onStream: p => parts.push(p) }).then(
        result => ({ result }),
        (e: unknown) => ({ code: isCompanionError(e) ? e.code : String(e) }),
      );
      if (v.response.type === 'error') expect(outcome).toEqual({ code: (v.response.error as { code: string }).code });
      else expect(outcome).toEqual({ result: v.response.result });
      expect(parts).toEqual((v.stream ?? []).map(s => (s as { data: unknown }).data));
    }
    client!.close();
    await settle();
  });
});
