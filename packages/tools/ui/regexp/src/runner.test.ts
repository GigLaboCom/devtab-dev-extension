import { RegexpRunner } from './runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage, WorkerLike } from './runner';
import type { RunRequest, RunResult } from '@workspace/tool-logic-regexp';

/** A worker that answers only when told to. */
class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  posted: JobMessage[] = [];
  terminated = false;
  postMessage(message: unknown): void {
    this.posted.push(message as JobMessage);
  }
  terminate(): void {
    this.terminated = true;
  }
  answer(id: number, result: RunResult = RESULT): void {
    this.onmessage?.({ data: { id, result } });
  }
}

const REQUEST: RunRequest = { pattern: 'a', flags: 'g', text: 'aa', replacement: null };
const RESULT: RunResult = {
  ok: true,
  flags: 'g',
  literal: '/a/g',
  matches: [],
  truncated: false,
  splitsPair: false,
  replaced: null,
  replacedTooLarge: false,
};

let workers: FakeWorker[];
let clock: number;
const runner = () =>
  new RegexpRunner(
    () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
    () => clock,
  );

beforeEach(() => {
  vi.useFakeTimers();
  workers = [];
  clock = 0;
});
afterEach(() => vi.useRealTimers());

describe('RegexpRunner (§9)', () => {
  it('an answer before the limit is done', async () => {
    const r = runner();
    const outcome = r.run(REQUEST);
    expect(workers).toHaveLength(1);
    expect(workers[0]!.posted).toEqual([{ id: 1, request: REQUEST }]);
    clock = 7;
    workers[0]!.answer(1);
    expect(await outcome).toEqual({ kind: 'done', result: RESULT, ms: 7 });
    expect(r.busy).toBe(false);
    // The worker stays for the next job.
    void r.run(REQUEST);
    expect(workers).toHaveLength(1);
  });

  it('no answer is a timeout exactly at the limit, and the worker is terminated', async () => {
    const r = runner();
    let settled = false;
    const outcome = r.run(REQUEST, 1_000).then(o => ((settled = true), o));
    await vi.advanceTimersByTimeAsync(999);
    expect(settled).toBe(false);
    expect(workers[0]!.terminated).toBe(false);
    clock = 1_000;
    await vi.advanceTimersByTimeAsync(1);
    expect(await outcome).toEqual({ kind: 'timeout', ms: 1_000 });
    expect(workers[0]!.terminated).toBe(true);
    // The next run starts a new worker.
    void r.run(REQUEST);
    expect(workers).toHaveLength(2);
  });

  it('the long limit is the one asked for', async () => {
    const r = runner();
    const outcome = r.run(REQUEST, 10_000);
    await vi.advanceTimersByTimeAsync(9_999);
    expect(r.busy).toBe(true);
    clock = 10_000;
    await vi.advanceTimersByTimeAsync(1);
    expect((await outcome).kind).toBe('timeout');
  });

  it('a second run during the first cancels it, terminates the old worker and starts a new one', async () => {
    const r = runner();
    const first = r.run(REQUEST);
    const second = r.run({ ...REQUEST, text: 'aaa' });
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[0]!.onmessage).toBeNull();
    expect(workers[1]!.posted).toEqual([{ id: 2, request: { ...REQUEST, text: 'aaa' } }]);
    workers[1]!.answer(2);
    expect((await second).kind).toBe('done');
  });

  it('an answer with an old id after a cancel is dropped', async () => {
    const r = runner();
    void r.run(REQUEST);
    const second = r.run(REQUEST);
    let settled = false;
    void second.then(() => (settled = true));
    workers[1]!.answer(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(settled).toBe(false);
    workers[1]!.answer(2);
    expect((await second).kind).toBe('done');
  });

  it('a worker error is crashed, and the next run creates a new worker', async () => {
    const r = runner();
    const outcome = r.run(REQUEST);
    const preventDefault = vi.fn();
    workers[0]!.onerror?.({ message: 'Out of memory', preventDefault });
    expect(await outcome).toEqual({ kind: 'crashed', message: 'Out of memory' });
    expect(preventDefault).toHaveBeenCalled();
    expect(workers[0]!.terminated).toBe(true);
    void r.run(REQUEST);
    expect(workers).toHaveLength(2);
  });

  it('a worker that cannot be started is crashed, and nothing runs on the page', async () => {
    const r = new RegexpRunner(() => {
      throw new ReferenceError('Worker is not defined');
    });
    expect(await r.run(REQUEST)).toEqual({ kind: 'crashed', message: 'Worker is not defined' });
    expect(r.busy).toBe(false);
  });

  it('cancel stops a job in flight and keeps an idle worker; dispose terminates it', async () => {
    const r = runner();
    r.cancel();
    expect(workers).toHaveLength(0);
    const job = r.run(REQUEST);
    r.cancel();
    expect(await job).toEqual({ kind: 'cancelled' });
    expect(workers[0]!.terminated).toBe(true);
    const next = r.run(REQUEST);
    workers[1]!.answer(2);
    await next;
    r.cancel();
    expect(workers[1]!.terminated).toBe(false);
    r.dispose();
    expect(workers[1]!.terminated).toBe(true);
  });
});
