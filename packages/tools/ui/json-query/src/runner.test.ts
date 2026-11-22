import { QueryRunner } from './runner';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { JobMessage, JobResult, QueryRequest, WorkerLike } from './runner';

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
  answer(id: number, result: JobResult = RESULT): void {
    this.onmessage?.({ data: { id, result } });
  }
}

const REQUEST: QueryRequest = { docId: 1, document: '[1]', query: '$[0]' };
const RESULT: JobResult = {
  ok: true,
  count: 1,
  rows: [{ path: '$[0]', preview: '1', at: [4, 5] }],
  values: '[\n  1\n]',
  valuesComplete: true,
  paths: '$[0]',
  lonePath: false,
  notes: [],
};

let workers: FakeWorker[];
let clock: number;
const runner = () =>
  new QueryRunner(
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

describe('QueryRunner', () => {
  it('an answer before the limit is done', async () => {
    const r = runner();
    const outcome = r.run(REQUEST);
    expect(workers[0]!.posted).toEqual([{ id: 1, request: { docId: 1, document: '[1]', query: '$[0]' } }]);
    clock = 7;
    workers[0]!.answer(1);
    await expect(outcome).resolves.toEqual({ kind: 'done', result: RESULT, ms: 7 });
    expect(r.busy).toBe(false);
  });

  it('sends a document once to a worker; a new document, or a new worker, gets it again', async () => {
    const r = runner();
    const first = r.run(REQUEST);
    workers[0]!.answer(1);
    await first;
    const second = r.run({ ...REQUEST, query: '$[*]' });
    expect(workers[0]!.posted[1]).toEqual({ id: 2, request: { docId: 1, query: '$[*]' } });
    workers[0]!.answer(2);
    await second;
    const third = r.run({ docId: 2, document: '[2]', query: '$[*]' });
    expect(workers[0]!.posted[2]!.request.document).toBe('[2]');
    // Cancelled: its worker is terminated, and the next one is sent the document again.
    const fourth = r.run({ docId: 2, document: '[2]', query: '$[0]' });
    await expect(third).resolves.toEqual({ kind: 'cancelled' });
    expect(workers[0]!.terminated).toBe(true);
    expect(workers[1]!.posted[0]!.request.document).toBe('[2]');
    workers[1]!.answer(4);
    await expect(fourth).resolves.toMatchObject({ kind: 'done' });
  });

  it('no answer: timeout exactly at the limit, and the worker is terminated', async () => {
    const r = runner();
    const outcome = r.run(REQUEST, 1_000);
    vi.advanceTimersByTime(999);
    expect(workers[0]!.terminated).toBe(false);
    clock = 1_000;
    vi.advanceTimersByTime(1);
    await expect(outcome).resolves.toEqual({ kind: 'timeout', ms: 1_000 });
    expect(workers[0]!.terminated).toBe(true);
    const next = r.run(REQUEST);
    expect(workers).toHaveLength(2);
    expect(workers[1]!.posted[0]!.request.document).toBe('[1]');
    workers[1]!.answer(2);
    await expect(next).resolves.toMatchObject({ kind: 'done' });
  });

  it('an answer to an older job is dropped', async () => {
    const r = runner();
    void r.run(REQUEST);
    const second = r.run(REQUEST);
    workers[0]!.answer(1);
    workers[1]!.answer(1);
    expect(r.busy).toBe(true);
    workers[1]!.answer(2);
    await expect(second).resolves.toMatchObject({ kind: 'done' });
  });

  it('a worker that fails: crashed, and the next run starts a new one', async () => {
    const r = runner();
    const outcome = r.run(REQUEST);
    const prevent = vi.fn();
    workers[0]!.onerror?.({ message: 'out of memory', preventDefault: prevent });
    await expect(outcome).resolves.toEqual({ kind: 'crashed', message: 'out of memory' });
    expect(prevent).toHaveBeenCalled();
    void r.run(REQUEST);
    expect(workers).toHaveLength(2);
  });

  it('no worker at all: crashed, nothing runs on the page', async () => {
    const r = new QueryRunner(() => {
      throw new Error('Worker is not defined');
    });
    await expect(r.run(REQUEST)).resolves.toEqual({ kind: 'crashed', message: 'Worker is not defined' });
  });
});
