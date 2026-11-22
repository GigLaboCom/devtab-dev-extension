/**
 * The runner (runner.ts) against fake workers it controls: the answer to the newest job only, Cancel and a newer job
 * terminate the worker running a job, the time limit stops a run that never answers, a job of another dialect starts
 * that dialect's worker, "loading" only the first time a dialect's worker starts, a crash is an outcome. And the table
 * of workers (workers.ts): one module file per dialect.
 */
import { SqlRunner } from './runner';
import { startSqlWorker } from './workers';
import { DEFAULT_OPTIONS, DIALECTS } from '@workspace/tool-logic-sql-format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkerLike } from './runner';
import type { FormatRequest } from './serve';
import type { SqlDialect } from '@workspace/tool-logic-sql-format';

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null;
  onerror: WorkerLike['onerror'] = null;
  readonly received: FormatRequest[] = [];
  terminated = false;
  constructor(readonly dialect: SqlDialect) {}
  postMessage(message: unknown): void {
    this.received.push(message as FormatRequest);
  }
  terminate(): void {
    this.terminated = true;
  }
  ready(): void {
    this.onmessage?.({ data: { type: 'ready' } });
  }
  answer(id: number, text = 'OK'): void {
    this.onmessage?.({ data: { type: 'result', id, result: { ok: true, text } } });
  }
}

const fakes = () => {
  const workers: FakeWorker[] = [];
  const start = (dialect: SqlDialect): WorkerLike => {
    const w = new FakeWorker(dialect);
    workers.push(w);
    return w;
  };
  return { workers, start };
};

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('SqlRunner', () => {
  it('answers the newest job; a newer job terminates the worker of the one under way', async () => {
    const { workers, start } = fakes();
    const runner = new SqlRunner(start);
    const first = runner.run('select 1', DEFAULT_OPTIONS);
    const second = runner.run('select 2', DEFAULT_OPTIONS);
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    // A late answer of the terminated worker reaches nobody.
    workers[0]!.answer(1, 'stale');
    workers[1]!.answer(workers[1]!.received[0]!.id, 'fresh');
    expect(await second).toMatchObject({ kind: 'done', result: { ok: true, text: 'fresh' } });
    expect(runner.busy).toBe(false);
  });

  it('a live job waits in the same worker after the one under way; the older answer is not used', async () => {
    const { workers, start } = fakes();
    const runner = new SqlRunner(start);
    const first = runner.run('select 1', DEFAULT_OPTIONS, { restart: false });
    const second = runner.run('select 2', DEFAULT_OPTIONS, { restart: false });
    expect(await first).toEqual({ kind: 'cancelled' });
    expect(workers).toHaveLength(1);
    expect(workers[0]!.terminated).toBe(false);
    expect(workers[0]!.received.map(r => r.text)).toEqual(['select 1', 'select 2']);
    workers[0]!.answer(workers[0]!.received[0]!.id, 'old');
    expect(runner.busy).toBe(true);
    workers[0]!.answer(workers[0]!.received[1]!.id, 'new');
    expect(await second).toMatchObject({ kind: 'done', result: { ok: true, text: 'new' } });
  });

  it('a live job does not wait behind one that has run for over a second: that worker is terminated', async () => {
    let now = 0;
    const { workers, start } = fakes();
    const runner = new SqlRunner(start, { now: () => now });
    const slow = runner.run('select ((((1))))', DEFAULT_OPTIONS, { restart: false });
    now = 1500;
    void runner.run('select 2', DEFAULT_OPTIONS, { restart: false });
    expect(await slow).toEqual({ kind: 'cancelled' });
    expect(workers).toHaveLength(2);
    expect(workers[0]!.terminated).toBe(true);
    runner.dispose();
  });

  it('keeps an idle worker for the next job of the same dialect; another dialect gets its own worker', async () => {
    const { workers, start } = fakes();
    const runner = new SqlRunner(start);
    const a = runner.run('select 1', DEFAULT_OPTIONS);
    workers[0]!.answer(workers[0]!.received[0]!.id);
    await a;
    const b = runner.run('select 2', DEFAULT_OPTIONS);
    expect(workers).toHaveLength(1);
    workers[0]!.answer(workers[0]!.received[1]!.id);
    await b;
    void runner.run('select 3', { ...DEFAULT_OPTIONS, dialect: 'postgresql' });
    expect(workers.map(w => w.dialect)).toEqual(['sql', 'postgresql']);
    expect(workers[0]!.terminated).toBe(true);
    runner.dispose();
    expect(workers[1]!.terminated).toBe(true);
  });

  it('Cancel terminates the worker and resolves the job as cancelled', async () => {
    const { workers, start } = fakes();
    const runner = new SqlRunner(start);
    const job = runner.run('select 1', DEFAULT_OPTIONS);
    expect(runner.busy).toBe(true);
    runner.cancel();
    expect(await job).toEqual({ kind: 'cancelled' });
    expect(workers[0]!.terminated).toBe(true);
    expect(runner.busy).toBe(false);
  });

  it('stops a run past the time limit and terminates its worker', async () => {
    vi.useFakeTimers();
    let now = 0;
    const { workers, start } = fakes();
    const runner = new SqlRunner(start, { timeoutMs: 1000, now: () => now });
    const job = runner.run('select 1', DEFAULT_OPTIONS);
    now = 1000;
    vi.advanceTimersByTime(1000);
    expect(await job).toEqual({ kind: 'timeout', ms: 1000 });
    expect(workers[0]!.terminated).toBe(true);
  });

  it('tells the page a dialect is loading the first time only, until the worker is ready', async () => {
    const { workers, start } = fakes();
    const loading: Array<SqlDialect | null> = [];
    const runner = new SqlRunner(start, { onLoading: d => loading.push(d) });
    const a = runner.run('select 1', DEFAULT_OPTIONS);
    expect(loading).toEqual(['sql']);
    workers[0]!.ready();
    expect(loading).toEqual(['sql', null]);
    workers[0]!.answer(workers[0]!.received[0]!.id);
    await a;
    // A new worker of the same dialect (after a cancel) is not "loading" again.
    void runner.run('select 2', DEFAULT_OPTIONS);
    runner.cancel();
    void runner.run('select 3', DEFAULT_OPTIONS);
    expect(workers).toHaveLength(2);
    expect(loading).toEqual(['sql', null]);
    // A dialect stopped before it was ready ends its loading too.
    void runner.run('select 4', { ...DEFAULT_OPTIONS, dialect: 'mysql' });
    runner.cancel();
    expect(loading).toEqual(['sql', null, 'mysql', null]);
  });

  it('a worker that fails is an outcome with its message; one that cannot start too', async () => {
    const { workers, start } = fakes();
    const runner = new SqlRunner(start);
    const job = runner.run('select 1', DEFAULT_OPTIONS);
    const preventDefault = vi.fn();
    workers[0]!.onerror?.({ message: 'out of memory', preventDefault });
    expect(await job).toEqual({ kind: 'crashed', message: 'out of memory' });
    expect(preventDefault).toHaveBeenCalled();
    const broken = new SqlRunner(() => {
      throw new Error('Worker is not defined');
    });
    expect(await broken.run('select 1', DEFAULT_OPTIONS)).toEqual({
      kind: 'crashed',
      message: 'Worker is not defined',
    });
  });
});

describe('the workers of the dialects', () => {
  it('one module worker per dialect, from its own file of the package', () => {
    const made: Array<{ url: string; options: WorkerOptions }> = [];
    vi.stubGlobal(
      'Worker',
      class {
        constructor(url: URL, options: WorkerOptions) {
          made.push({ url: String(url), options });
        }
      },
    );
    for (const dialect of DIALECTS) startSqlWorker(dialect);
    expect(made).toHaveLength(14);
    made.forEach(({ url, options }, i) => {
      expect(url).toMatch(new RegExp(`/dialects/${DIALECTS[i]}\\.worker\\.ts(\\?|$)`));
      expect(url.startsWith('blob:') || url.startsWith('data:')).toBe(false);
      expect(options).toEqual({ type: 'module', name: `sql-format-${DIALECTS[i]}` });
    });
  });
});
