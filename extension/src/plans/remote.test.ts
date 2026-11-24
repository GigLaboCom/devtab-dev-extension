/**
 * `remotePlans` over a fake chrome.storage and a fake runtime whose `plans/refresh` is answered by the real plans
 * worker with a fake server (no network): the seam's contract, a build without a server, a worker that does not answer.
 */
import { planSourceContract } from './contract';
import { remotePlans, remotePlansSource } from './remote';
import { SAMPLE_RULES } from './sample';
import { plansWorker } from '@src/background/plans/worker';
import { fakeStorage } from '@src/test/fakes';
import { catalogNamed, recordFor } from '@src/test/plansRecords';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PlansServer } from '@src/background/plans/fetchPlans';

const T0 = Date.UTC(2026, 10, 24, 12);
type Reply = Awaited<ReturnType<PlansServer['get']>>;

/** A place: the storage, and the worker behind the runtime. */
const place = () => {
  const storage = fakeStorage();
  const replies: Reply[] = [];
  const worker = plansWorker({
    area: storage.area,
    server: { get: () => Promise.resolve(replies.shift() ?? { kind: 'unreached', why: 'offline' }) },
    rules: SAMPLE_RULES,
    now: () => Date.now(),
    hasLicence: () => Promise.resolve(false),
  });
  const runtime = {
    sendMessage: vi.fn((message: { reason: 'person' | 'opened' }) =>
      worker.refresh({ reason: message.reason }).then(outcome => ({ v: 1, ...outcome })),
    ),
  };
  const open = () =>
    remotePlansSource({
      chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
      now: () => Date.now(),
      rules: SAMPLE_RULES,
      origin: 'https://licence-fake.invalid',
    });
  return { storage, replies, runtime, open };
};

describe('with the clock and timers of the test', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] });
    vi.setSystemTime(T0);
  });
  afterEach(() => vi.useRealTimers());

  planSourceContract('remotePlans', () => {
    const { storage, replies, open } = place();
    return {
      open,
      put: async (view, options) => {
        const record = recordFor(view, Date.now(), options);
        await (record ? storage.area.set({ plans: record }) : storage.area.remove('plans'));
      },
      answerNext: outcome => {
        if ('body' in outcome) replies.push({ kind: 'ok', body: outcome.body });
        else if (outcome.fail === 'rate-limited' || outcome.fail === 'server-busy')
          replies.push({
            kind: outcome.fail === 'server-busy' ? 'busy' : 'rate-limited',
            retryAt: Date.now() + 120_000,
          });
        else replies.push({ kind: 'unreached', why: outcome.fail });
      },
      advance: ms => vi.advanceTimersByTime(ms),
      settle: async () => {
        for (let i = 0; i < 10; i++) await Promise.resolve();
      },
      catalog: catalogNamed,
    };
  });
});

describe('remotePlans', () => {
  it('a build without a server shows no plans and asks nothing', async () => {
    const sendMessage = vi.fn();
    const source = remotePlansSource({
      chrome: {
        storage: { local: fakeStorage().area, onChanged: fakeStorage().onChanged },
        runtime: { sendMessage } as never,
      },
      rules: SAMPLE_RULES,
      origin: undefined,
    });
    expect(await source.ready).toEqual({ kind: 'absent' });
    await source.refresh('person');
    expect(source.current()).toEqual({ kind: 'absent' });
    expect(sendMessage).not.toHaveBeenCalled();
  });

  it('the build’s root: the store build’s licence configuration has no server, so `absent`', async () => {
    expect(remotePlans.id).toBe('remotePlans');
    const source = remotePlans({
      chrome: {
        storage: { local: fakeStorage().area, onChanged: fakeStorage().onChanged },
        runtime: { sendMessage: vi.fn() } as never,
      },
    });
    expect(await source.ready).toEqual({ kind: 'absent' });
  });

  it('a worker that does not answer: `unavailable: worker` while nothing usable is stored; a stale list stays', async () => {
    const storage = fakeStorage();
    const runtime = { sendMessage: vi.fn(() => Promise.reject(new Error('Could not establish connection'))) };
    const source = remotePlansSource({
      chrome: { storage: { local: storage.area, onChanged: storage.onChanged }, runtime: runtime as never },
      now: () => T0,
      rules: SAMPLE_RULES,
      origin: 'https://licence-fake.invalid',
    });
    await source.ready;
    await source.refresh('person');
    expect(source.current()).toEqual({ kind: 'unavailable', why: 'worker' });
    await storage.area.set({ plans: recordFor('stale', T0) });
    await vi.waitFor(() => expect(source.current().kind).toBe('stale'));
    await source.refresh('person');
    expect(source.current().kind).toBe('stale');
    source.dispose();
  });

  it('`unavailable` names when `Try again` may come: 60 s after the attempt, or the Retry-After', async () => {
    const { open, replies } = place();
    const source = open();
    await source.ready;
    replies.push({ kind: 'unreached', why: 'offline' });
    // The clock here is the real one: the attempt was made somewhere between these two readings.
    const before = Date.now();
    await source.refresh('person');
    const after = Date.now();
    const view = source.current();
    expect(view).toMatchObject({ kind: 'unavailable', why: 'offline' });
    const retryAt = view.kind === 'unavailable' ? view.retryAt : undefined;
    expect(retryAt).toBeGreaterThanOrEqual(before + 60_000);
    expect(retryAt).toBeLessThanOrEqual(after + 60_000);
    source.dispose();
  });
});
