/**
 * The worker's two licence records over a fake chrome.storage: every operation, the licence key in no record, the
 * clock mark written at most hourly and only upwards (but set to `iat` by an accepted refresh, even downwards), both
 * records in one write where the specification says so.
 */
import { licenceStore } from './store';
import { fakeStorage } from '@src/test/fakes';
import { describe, expect, it } from 'vitest';

const HOUR = 3_600_000;
const INST = 'q3V2mZ0bTEST0000000000';
const KEY = 'DTD-TEST-AAAA-BBBB-CCCC-DDDD';

const setup = () => {
  const storage = fakeStorage();
  const writes: string[][] = [];
  storage.listeners.add(changes => writes.push(Object.keys(changes).sort()));
  return { storage, store: licenceStore(storage.area as never), writes };
};

describe('licenceStore', () => {
  it('reads nothing from an empty storage, and ignores records of another shape', async () => {
    const { storage, store } = setup();
    expect(await store.read()).toEqual({});
    storage.rows.set('licence', { v: 2, inst: INST });
    storage.rows.set('entitlement', 'token');
    expect(await store.read()).toEqual({});
  });

  it('an activation: pending before it is sent, then the secret, the token and `seen = iat` in one write', async () => {
    const { storage, store, writes } = setup();
    await store.beginActivation(INST, 1_000);
    expect(storage.rows.get('licence')).toEqual({
      v: 1,
      inst: INST,
      pending: { since: 1_000 },
      attempts: { failures: 0 },
    });
    writes.length = 0;
    await store.activated({ inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), token: 'a.b.c', iat: 900 });
    expect(writes).toEqual([['entitlement', 'licence']]);
    expect(await store.read()).toEqual({
      licence: { v: 1, inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), attempts: { failures: 0 } },
      entitlement: { v: 1, inst: INST, token: 'a.b.c', seen: 900 },
    });
  });

  it('a second activation keeps the installation’s number and what it had; an ended one drops only `pending`', async () => {
    const { store } = setup();
    await store.activated({ inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), token: 'a.b.c', iat: 900 });
    await store.attempting(2_000);
    await store.beginActivation(INST, 3_000);
    expect((await store.read()).licence).toEqual({
      v: 1,
      inst: INST,
      lid: 'lic_TEST0000000001',
      secret: 's'.repeat(43),
      pending: { since: 3_000 },
      attempts: { failures: 1, last: 2_000 },
    });
    await store.endActivation();
    expect((await store.read()).licence).toEqual({
      v: 1,
      inst: INST,
      lid: 'lic_TEST0000000001',
      secret: 's'.repeat(43),
      attempts: { failures: 1, last: 2_000 },
    });
  });

  it('the licence key is in no record, whatever happened', async () => {
    const { storage, store } = setup();
    await store.beginActivation(INST, 1);
    await store.activated({ inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), token: 'a.b.c', iat: 1 });
    await store.failed({ at: 5, cause: 'rate-limited' });
    expect(JSON.stringify([...storage.rows])).not.toContain(KEY);
    expect(JSON.stringify([...storage.rows])).not.toContain('DTD-');
  });

  it('attempts: a request begun counts until a refresh resets it; a failure notes its Retry-After and cause', async () => {
    const { store } = setup();
    await store.activated({ inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), token: 'a.b.c', iat: 1 });
    await store.attempting(10);
    await store.failed();
    await store.attempting(20);
    await store.failed({ at: 500, cause: 'server-busy' });
    expect((await store.read()).licence?.attempts).toEqual({
      last: 20,
      failures: 2,
      retryAfter: 500,
      retryCause: 'server-busy',
    });
    await store.failed();
    expect((await store.read()).licence?.attempts).toEqual({ last: 20, failures: 2 });
    await store.refreshed('d.e.f', 30);
    expect(await store.read()).toMatchObject({
      licence: { attempts: { last: 20, failures: 0 } },
      entitlement: { token: 'd.e.f', seen: 30 },
    });
  });

  it('without a record `licence`, counting and refreshing write nothing', async () => {
    const { storage, store } = setup();
    await store.attempting(1);
    await store.failed();
    await store.refreshed('a.b.c', 1);
    await store.endActivation();
    expect(storage.rows.size).toBe(0);
  });

  it('the clock mark: at most hourly and only upwards; an accepted refresh sets it to `iat`, downwards too', async () => {
    const { storage, store } = setup();
    await store.activated({
      inst: INST,
      lid: 'lic_TEST0000000001',
      secret: 's'.repeat(43),
      token: 'a.b.c',
      iat: 10 * HOUR,
    });
    const seen = () => (storage.rows.get('entitlement') as { seen: number }).seen;
    await store.touchSeen(10 * HOUR + HOUR - 1);
    expect(seen()).toBe(10 * HOUR);
    await store.touchSeen(11 * HOUR);
    expect(seen()).toBe(11 * HOUR);
    await store.touchSeen(5 * HOUR);
    expect(seen()).toBe(11 * HOUR);
    await store.refreshed('d.e.f', 2 * HOUR);
    expect(seen()).toBe(2 * HOUR);
  });

  it('touchSeen without a token writes nothing', async () => {
    const { storage, store } = setup();
    await store.touchSeen(100 * HOUR);
    expect(storage.rows.size).toBe(0);
  });

  it('erase removes both records', async () => {
    const { storage, store } = setup();
    await store.activated({ inst: INST, lid: 'lic_TEST0000000001', secret: 's'.repeat(43), token: 'a.b.c', iat: 1 });
    storage.rows.set('toolSettings', { v: 1 });
    await store.erase();
    expect([...storage.rows.keys()]).toEqual(['toolSettings']);
  });
});
