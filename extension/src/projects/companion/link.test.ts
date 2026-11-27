/** Chrome's port as the link sees it (a fake `chrome.runtime`), and which messages count as frames. */
import { HOST_NAME, nativeLink, serverFrame } from './link';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LinkClosed } from './link';

type Listener = (message?: unknown) => void;

const fakeChrome = (options: { connect?: boolean; throws?: string } = {}) => {
  const message: Listener[] = [];
  const disconnect: Listener[] = [];
  const posted: unknown[] = [];
  const runtime: Record<string, unknown> = { lastError: undefined };
  let disconnected = false;
  if (options.connect !== false)
    runtime.connectNative = vi.fn((name: string) => {
      if (options.throws) throw new Error(options.throws);
      expect(name).toBe(HOST_NAME);
      return {
        onMessage: { addListener: (l: Listener) => message.push(l) },
        onDisconnect: { addListener: (l: Listener) => disconnect.push(l) },
        postMessage: (m: unknown) => posted.push(m),
        disconnect: () => void (disconnected = true),
      };
    });
  vi.stubGlobal('chrome', { runtime });
  return {
    posted,
    get disconnected() {
      return disconnected;
    },
    message: (m: unknown) => message.forEach(l => l(m)),
    close: (lastError: string) => {
      runtime.lastError = { message: lastError };
      disconnect.forEach(l => l());
      runtime.lastError = undefined;
    },
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('nativeLink', () => {
  const open = () => {
    const got: unknown[] = [];
    const closed: LinkClosed[] = [];
    const link = nativeLink({ onMessage: m => got.push(m), onClose: r => closed.push(r) });
    return { link, got, closed };
  };

  it('opens the host’s port, passes frames both ways, and closes it', () => {
    const chrome = fakeChrome();
    const { link, got } = open();
    link.send({ type: 'hello', extension: '1', api: [1] });
    chrome.message({ type: 'welcome' });
    expect(chrome.posted).toEqual([{ type: 'hello', extension: '1', api: [1] }]);
    expect(got).toEqual([{ type: 'welcome' }]);
    link.close();
    expect(chrome.disconnected).toBe(true);
  });

  it.each([
    ['Specified native messaging host not found.', 'not-found'],
    ['Access to the specified native messaging host is forbidden.', 'forbidden'],
    ['Native host has exited.', 'exited'],
    ['Error when communicating with the native messaging host.', 'closed'],
  ])('reads why the port closed from lastError: %s → %s', (lastError, kind) => {
    const chrome = fakeChrome();
    const { closed, got } = open();
    chrome.close(lastError);
    chrome.message({ late: true });
    expect(closed).toEqual([{ kind, message: lastError }]);
    expect(got).toEqual([]);
  });

  it('without connectNative (no permission on this page) it closes as `unavailable`, later', async () => {
    fakeChrome({ connect: false });
    const { closed } = open();
    expect(closed).toEqual([]);
    await Promise.resolve();
    expect(closed[0]?.kind).toBe('unavailable');
  });

  it('connectNative throwing (`not available in this context`) closes too', async () => {
    fakeChrome({ throws: "'runtime.connectNative' is not available in this context." });
    const { closed } = open();
    await Promise.resolve();
    expect(closed[0]?.kind).toBe('unavailable');
  });
});

describe('serverFrame', () => {
  it.each([
    null,
    'text',
    [],
    { type: 'nope' },
    { type: 'result', id: -1, result: 1 },
    { type: 'result', id: 1 },
    { type: 'error', id: 1, error: { code: 'x' } },
    { type: 'error', id: 1, error: { code: 1, message: 'm' } },
    { type: 'error', id: 1, error: { code: 'x', message: 'm', data: 'not an object' } },
    { type: 'stream', id: 1, data: 1 },
    { type: 'event', data: {} },
    { type: 'event', name: 'x', project: 5, data: {} },
    { type: 'chunk', id: 1, seq: 0, last: 'no', data: '' },
    { type: 'chunk', id: 1, seq: 0, last: true, data: 5 },
    { type: 'welcome', companion: '1', api: 1, server: 's', platform: 'macos', methods: [1], limits: {} },
  ])('refuses %j', message => {
    expect(serverFrame(message)).toBeNull();
  });

  it('an error with a code the contract does not have becomes `internal`, its message kept', () => {
    expect(serverFrame({ type: 'error', id: 2, error: { code: 'new-one', message: 'm' } })).toEqual({
      type: 'error',
      id: 2,
      error: { code: 'internal', message: 'm' },
    });
  });
});
