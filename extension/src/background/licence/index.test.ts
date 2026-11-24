/**
 * The licence assembled in the worker, over a fake chrome: one listener that answers only licence messages, only our
 * main page, through sendResponse with `return true`; the storage closed to anything but trusted contexts; the
 * occasions registered; and the store build's configuration, which has no origin, sends nothing at all.
 */
import { startLicence } from './index';
import { FAKE_SERVER_KEY } from './scriptedFetch';
import { production } from '@src/licence/production';
import { test as testConfig } from '@src/licence/test';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { LicenceConfig } from '@src/licence/config';

type Listener = (message: unknown, sender: chrome.runtime.MessageSender, respond: (answer: unknown) => void) => unknown;

const MAIN = 'chrome-extension://ours/src/app/index.html';

const start = (config: LicenceConfig) => {
  const storage = fakeStorage();
  const setAccessLevel = vi.fn(() => Promise.resolve());
  let listener: Listener | undefined;
  const occasions: string[] = [];
  const runtime = {
    id: 'ours',
    getURL: (path: string) => `chrome-extension://ours/${path}`,
    onMessage: { addListener: (l: Listener) => (listener = l) },
    onStartup: { addListener: () => occasions.push('startup') },
    onInstalled: { addListener: () => occasions.push('installed') },
  };
  startLicence({
    chrome: { runtime, storage: { local: { ...storage.area, setAccessLevel } } } as never,
    config,
    now: () => Date.UTC(2026, 10, 24),
  });
  /** Sends `message` from `url`; the listener's return and the answer, if any. */
  const send = async (message: unknown, url = MAIN) => {
    let respond: (answer: unknown) => void = () => undefined;
    const answered = new Promise<unknown>(resolve => (respond = resolve));
    const returned = listener!(message, { id: 'ours', url }, respond);
    return { returned, answer: returned === undefined ? undefined : await answered };
  };
  return { storage, setAccessLevel, occasions, send };
};

const browserFetch = vi.fn(() => Promise.reject(new Error('the network')));
afterEach(() => {
  vi.unstubAllGlobals();
  browserFetch.mockClear();
});

describe('startLicence', () => {
  it('closes the storage to untrusted contexts and listens to the profile’s start and the install', () => {
    const { setAccessLevel, occasions } = start(production);
    expect(setAccessLevel).toHaveBeenCalledWith({ accessLevel: 'TRUSTED_CONTEXTS' });
    expect(occasions).toEqual(['startup', 'installed']);
  });

  it('a message that is not a licence message gets no answer at all (the listener returns undefined)', async () => {
    const { send } = start(production);
    expect(await send({ type: 'viewer/ready' })).toEqual({ returned: undefined, answer: undefined });
    expect(await send('licence/check')).toEqual({ returned: undefined, answer: undefined });
  });

  it('another version is `version`; a sender that is not our main page is `refused`', async () => {
    const { send } = start(production);
    expect(await send({ type: 'licence/check', v: 2 })).toEqual({
      returned: false,
      answer: { v: 1, ok: false, error: 'version' },
    });
    expect(await send({ type: 'licence/check', v: 1 }, 'chrome-extension://ours/src/viewer/index.html')).toEqual({
      returned: false,
      answer: { v: 1, ok: false, error: 'refused' },
    });
    expect(await send({ type: 'plans/refresh', v: 1, reason: 'person' }, 'https://example.com/')).toEqual({
      returned: false,
      answer: { v: 1, ok: false, error: 'refused' },
    });
  });

  it('the store build: answers through sendResponse, cannot activate, has no plans, and never calls fetch', async () => {
    vi.stubGlobal('fetch', browserFetch);
    const { send, storage } = start(production);
    expect(await send({ type: 'licence/opened', v: 1 })).toEqual({ returned: true, answer: { v: 1, ok: true } });
    expect(await send({ type: 'licence/check', v: 1 })).toEqual({ returned: true, answer: { v: 1, ok: true } });
    expect(await send({ type: 'licence/activate', v: 1, key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD' })).toEqual({
      returned: true,
      answer: { v: 1, ok: false, error: 'unavailable' },
    });
    expect(await send({ type: 'plans/refresh', v: 1, reason: 'person' })).toEqual({
      returned: true,
      answer: { v: 1, ok: false, error: 'unavailable' },
    });
    expect(browserFetch).not.toHaveBeenCalled();
    expect(storage.rows.size).toBe(0);
  });

  it('the e2e build: requests go to the scripted server in storage, never to the browser’s fetch', async () => {
    vi.stubGlobal('fetch', browserFetch);
    const { send, storage } = start(testConfig);
    storage.rows.set(FAKE_SERVER_KEY, {
      replies: [{ endpoint: 'plans', status: 503, headers: { 'Retry-After': '120' }, body: '{"error":"unavailable"}' }],
      calls: [],
    });
    expect(await send({ type: 'plans/refresh', v: 1, reason: 'person' })).toEqual({
      returned: true,
      answer: { v: 1, ok: false, error: 'server-busy', retryAt: Date.UTC(2026, 10, 24) + 120_000 },
    });
    expect((storage.rows.get(FAKE_SERVER_KEY) as { calls: unknown[] }).calls).toHaveLength(1);
    expect(browserFetch).not.toHaveBeenCalled();
  });
});
