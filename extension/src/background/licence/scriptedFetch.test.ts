/**
 * The e2e build's fake server: replies taken one by one from the script in storage, every request written to `calls`,
 * a reply for another address is a test's mistake, an empty script is offline — and the browser's fetch is never used.
 */
import { FAKE_SERVER_KEY, scriptedFetch } from './scriptedFetch';
import { httpLicenceServer } from './server';
import { httpPlansServer } from '../plans/fetchPlans';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FakeServerScript } from './scriptedFetch';

const ORIGIN = 'https://licence-fake.invalid';
const INST = 'q3V2mZ0bTEST0000000000';

const setup = (replies: FakeServerScript['replies']) => {
  const storage = fakeStorage();
  storage.rows.set(FAKE_SERVER_KEY, { replies, calls: [] });
  const fetchImpl = scriptedFetch(storage.area, () => 1_000);
  return {
    storage,
    fetchImpl,
    licence: httpLicenceServer(ORIGIN, fetchImpl, () => 1_000),
    plans: httpPlansServer(ORIGIN, fetchImpl, () => 1_000),
    script: () => storage.rows.get(FAKE_SERVER_KEY) as FakeServerScript,
  };
};

afterEach(() => vi.unstubAllGlobals());

describe('scriptedFetch', () => {
  it('answers each address with its reply, in order, and writes down what was sent', async () => {
    const browserFetch = vi.fn(() => Promise.reject(new Error('the network')));
    vi.stubGlobal('fetch', browserFetch);
    const { licence, plans, script } = setup([
      { endpoint: 'activate', status: 200, body: JSON.stringify({ token: 'a.b.c', secret: 's'.repeat(43) }) },
      { endpoint: 'plans', status: 200, body: JSON.stringify({ v: 1 }) },
      { endpoint: 'deactivate', status: 204, body: '' },
    ]);
    expect(await licence.activate({ key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD', inst: INST })).toEqual({
      kind: 'ok',
      body: { token: 'a.b.c', secret: 's'.repeat(43) },
    });
    expect(await plans.get()).toEqual({ kind: 'ok', body: { v: 1 } });
    expect(await licence.deactivate({ lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) })).toEqual({
      kind: 'ok',
      body: undefined,
    });
    expect(script()).toEqual({
      replies: [],
      calls: [
        {
          endpoint: 'activate',
          method: 'POST',
          path: '/v1/activate',
          body: { key: 'DTD-TEST-AAAA-BBBB-CCCC-DDDD', inst: INST },
          at: 1_000,
        },
        { endpoint: 'plans', method: 'GET', path: '/v1/plans', body: null, at: 1_000 },
        {
          endpoint: 'deactivate',
          method: 'POST',
          path: '/v1/deactivate',
          body: { lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) },
          at: 1_000,
        },
      ],
    });
    expect(browserFetch).not.toHaveBeenCalled();
  });

  it('a reply marked offline, no reply left, or no script at all: as if offline', async () => {
    const { licence, script } = setup([{ endpoint: 'refresh', offline: true }]);
    const request = { lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) };
    expect(await licence.refresh(request)).toEqual({ kind: 'unreached', why: 'offline' });
    expect(await licence.refresh(request)).toEqual({ kind: 'unreached', why: 'offline' });
    expect(script().calls.map(c => c.endpoint)).toEqual(['refresh', 'refresh']);
    const bare = httpLicenceServer(ORIGIN, scriptedFetch(fakeStorage().area), () => 0);
    expect(await bare.refresh(request)).toEqual({ kind: 'unreached', why: 'offline' });
  });

  it('a reply for another address is the test’s mistake: written as `mismatch`, answered as offline', async () => {
    const { licence, script } = setup([{ endpoint: 'activate', status: 200, body: '{}' }]);
    expect(await licence.refresh({ lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) })).toEqual({
      kind: 'unreached',
      why: 'offline',
    });
    expect(script().calls[0].endpoint).toBe('mismatch');
  });

  it('statuses, headers and bodies as scripted (a portal’s HTML, a 503 with Retry-After)', async () => {
    const { licence } = setup([
      { endpoint: 'refresh', status: 200, headers: { 'Content-Type': 'text/html' }, body: '<!doctype html>' },
      { endpoint: 'refresh', status: 503, headers: { 'Retry-After': '120' }, body: '{"error":"unavailable"}' },
    ]);
    const request = { lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) };
    expect(await licence.refresh(request)).toEqual({ kind: 'unreached', why: 'not-json' });
    expect(await licence.refresh(request)).toEqual({ kind: 'busy', retryAt: 121_000 });
  });

  it('requests sent together each get their own reply and their own line in `calls`', async () => {
    const { licence, script } = setup([
      { endpoint: 'refresh', status: 200, body: '{"token":"one"}' },
      { endpoint: 'refresh', status: 200, body: '{"token":"two"}' },
    ]);
    const request = { lid: 'lic_TEST0000000001', inst: INST, secret: 's'.repeat(43) };
    const answers = await Promise.all([licence.refresh(request), licence.refresh(request)]);
    expect(answers).toEqual([
      { kind: 'ok', body: { token: 'one' } },
      { kind: 'ok', body: { token: 'two' } },
    ]);
    expect(script().calls).toHaveLength(2);
  });
});
