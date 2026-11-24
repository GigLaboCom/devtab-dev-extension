/**
 * The plans list in the worker over a fake storage and a fake server: requests that come together share one, an
 * accepted answer replaces the record whole and clears the failure, a refused one keeps the list and notes why, a build
 * without an origin answers `unavailable` and never calls the server.
 */
import { plansWorker } from './worker';
import { SAMPLE_CATALOG, SAMPLE_RULES } from '@src/plans/sample';
import { fakeStorage } from '@src/test/fakes';
import { describe, expect, it, vi } from 'vitest';
import type { PlansServer } from './fetchPlans';
import type { PlansRecord } from '@src/shared/plansRecord';

const NOW = Date.UTC(2026, 10, 24, 12);
type Reply = Awaited<ReturnType<PlansServer['get']>>;

const setup = (replies: Array<() => Promise<Reply>>, options: { origin?: boolean; licence?: boolean } = {}) => {
  const storage = fakeStorage();
  const get = vi.fn(() => (replies.shift() ?? (() => Promise.resolve<Reply>({ kind: 'unreached', why: 'offline' })))());
  const worker = plansWorker({
    area: storage.area,
    server: options.origin === false ? undefined : { get },
    rules: SAMPLE_RULES,
    now: () => NOW,
    hasLicence: () => Promise.resolve(options.licence ?? false),
  });
  return { storage, get, worker, record: () => storage.rows.get('plans') as PlansRecord | undefined };
};
const reply = (value: Reply) => () => Promise.resolve(value);

describe('plansWorker', () => {
  it('two requests together share one request; the accepted answer is the record, whole', async () => {
    let release: (value: Reply) => void = () => undefined;
    const { worker, get, record } = setup([() => new Promise(resolve => (release = resolve))]);
    const one = worker.refresh({ reason: 'person' });
    const two = worker.refresh({ reason: 'person' });
    await vi.waitFor(() => expect(get).toHaveBeenCalled());
    release({ kind: 'ok', body: SAMPLE_CATALOG });
    expect(await one).toEqual({ ok: true });
    expect(await two).toEqual({ ok: true });
    expect(get).toHaveBeenCalledTimes(1);
    expect(record()).toEqual({ v: 1, fetchedAt: NOW, body: SAMPLE_CATALOG, attempts: { last: NOW, failures: 0 } });
  });

  it('an answer that is not a catalog keeps the stored list and notes the failure', async () => {
    const { worker, storage, record } = setup([
      reply({ kind: 'ok', body: { v: 2 } }),
      reply({ kind: 'ok', body: { v: 1, plans: [] } }),
    ]);
    storage.rows.set('plans', {
      v: 1,
      fetchedAt: NOW - 2 * 86_400_000,
      body: SAMPLE_CATALOG,
      attempts: { failures: 0 },
    });
    expect(await worker.refresh({ reason: 'person' })).toEqual({ ok: false, error: 'unsupported' });
    expect(record()).toMatchObject({
      body: SAMPLE_CATALOG,
      failure: { at: NOW, why: 'unsupported' },
      attempts: { failures: 1 },
    });
    storage.rows.set('plans', { ...record(), attempts: { failures: 1 } });
    expect(await worker.refresh({ reason: 'person' })).toEqual({ ok: false, error: 'bad-answer' });
    expect(record()).toMatchObject({ body: SAMPLE_CATALOG, failure: { why: 'bad-answer' }, attempts: { failures: 2 } });
  });

  it.each([
    [
      { kind: 'unreached', why: 'offline' },
      { ok: false, error: 'offline' },
    ],
    [
      { kind: 'unreached', why: 'timeout' },
      { ok: false, error: 'offline' },
    ],
    [
      { kind: 'unreached', why: 'server' },
      { ok: false, error: 'server' },
    ],
    [
      { kind: 'rate-limited', retryAt: NOW + 120_000 },
      { ok: false, error: 'rate-limited', retryAt: NOW + 120_000 },
    ],
    [
      { kind: 'busy', retryAt: NOW + 300_000 },
      { ok: false, error: 'server-busy', retryAt: NOW + 300_000 },
    ],
  ] as const)('%o → %o, and nothing is replaced', async (answer, outcome) => {
    const { worker, record } = setup([reply(answer)]);
    expect(await worker.refresh({ reason: 'person' })).toEqual(outcome);
    expect(record()?.body).toBeUndefined();
    expect(record()?.failure?.why).toBe(outcome.error);
  });

  it('a Retry-After answers the next press without a request', async () => {
    const { worker, get } = setup([reply({ kind: 'busy', retryAt: NOW + 300_000 })]);
    await worker.refresh({ reason: 'person' });
    expect(await worker.refresh({ reason: 'person' })).toEqual({
      ok: false,
      error: 'server-busy',
      retryAt: NOW + 300_000,
    });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('`opened` without a licence: ok, and no request — the worker keeps the promise too', async () => {
    const { worker, get, storage } = setup([]);
    expect(await worker.refresh({ reason: 'opened' })).toEqual({ ok: true });
    expect(get).not.toHaveBeenCalled();
    expect(storage.rows.size).toBe(0);
  });

  it('`opened` with a licence and a stale list asks', async () => {
    const { worker, get } = setup([reply({ kind: 'ok', body: SAMPLE_CATALOG })], { licence: true });
    expect(await worker.refresh({ reason: 'opened' })).toEqual({ ok: true });
    expect(get).toHaveBeenCalledTimes(1);
  });

  it('without an origin: unavailable, nothing sent, nothing written', async () => {
    const { worker, get, storage } = setup([], { origin: false });
    expect(await worker.refresh({ reason: 'person' })).toEqual({ ok: false, error: 'unavailable' });
    expect(get).not.toHaveBeenCalled();
    expect(storage.rows.size).toBe(0);
  });
});
