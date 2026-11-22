/**
 * The page's side of the workers (formatter.ts) against a stand-in Worker: which worker a language goes to, the loading
 * notice, a replaced job dropped, Cancel and the time limit terminating the worker (and the next job starting a new one).
 */
import { createFormatter, NO_WORKERS } from './formatter';
import { DEFAULT_SETTINGS } from '@workspace/tool-logic-code-format';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { FormatReply } from './formatter';

class FakeWorker {
  static all: FakeWorker[] = [];
  onmessage: ((event: MessageEvent<FormatReply>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: Array<{ id: number; language: string }> = [];
  terminated = false;
  constructor(
    readonly url: URL,
    readonly options: WorkerOptions,
  ) {
    FakeWorker.all.push(this);
  }
  postMessage(message: { id: number; language: string }): void {
    this.posted.push(message);
  }
  terminate(): void {
    this.terminated = true;
  }
  reply(data: FormatReply): void {
    this.onmessage?.({ data } as MessageEvent<FormatReply>);
  }
}

const job = (language: 'css' | 'xml', text = 'a{}') => ({ language, text, settings: DEFAULT_SETTINGS });

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  FakeWorker.all = [];
});

describe('createFormatter', () => {
  it('sends Prettier’s languages to one worker and XML to another, both module workers from files', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const formatter = createFormatter();
    const loading: string[] = [];
    const css = formatter.run(job('css'), l => loading.push(l));
    const [prettier] = FakeWorker.all;
    expect(prettier!.options).toEqual({ type: 'module', name: 'code-format' });
    expect(prettier!.url.pathname).toMatch(/format\.worker\.ts$/);
    prettier!.reply({ id: 1, loading: 'css' });
    prettier!.reply({ id: 1, result: { ok: true, text: 'a {\n}\n' }, ms: 2 });
    expect(await css).toEqual({ result: { ok: true, text: 'a {\n}\n' }, ms: 2 });
    expect(loading).toEqual(['css']);

    const xml = formatter.run(job('xml', '<a/>'));
    const xmlWorker = FakeWorker.all[1]!;
    expect(xmlWorker.options).toEqual({ type: 'module', name: 'code-format-xml' });
    expect(xmlWorker.url.pathname).toMatch(/xml\.worker\.ts$/);
    xmlWorker.reply({ id: 2, result: { ok: true, text: '<a/>\n' }, ms: 1 });
    expect(await xml).toEqual({ result: { ok: true, text: '<a/>\n' }, ms: 1 });
    // The Prettier worker is kept: its modules stay loaded.
    formatter.run(job('css'));
    expect(FakeWorker.all).toHaveLength(2);
    expect(prettier!.posted.map(p => p.id)).toEqual([1, 3]);
  });

  it('drops the reply to a replaced job', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const formatter = createFormatter();
    const first = formatter.run(job('css', 'a{}'));
    const second = formatter.run(job('css', 'b{}'));
    expect(await first).toBeNull();
    const [worker] = FakeWorker.all;
    worker!.reply({ id: 1, result: { ok: true, text: 'old' }, ms: 1 });
    worker!.reply({ id: 2, result: { ok: true, text: 'new' }, ms: 1 });
    expect(await second).toEqual({ result: { ok: true, text: 'new' }, ms: 1 });
  });

  it('Cancel terminates the worker; the next job starts a new one', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const formatter = createFormatter();
    const running = formatter.run(job('css'));
    formatter.cancel();
    expect(await running).toBeNull();
    expect(FakeWorker.all[0]!.terminated).toBe(true);
    void formatter.run(job('css'));
    expect(FakeWorker.all).toHaveLength(2);
    expect(FakeWorker.all[1]!.terminated).toBe(false);
  });

  it('stops a job that outruns the time limit', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('Worker', FakeWorker);
    const formatter = createFormatter(1_000);
    const running = formatter.run(job('css'));
    vi.advanceTimersByTime(1_001);
    expect(await running).toEqual({ timedOut: true });
    expect(FakeWorker.all[0]!.terminated).toBe(true);
  });

  it('a worker failure is said; a dead worker is replaced', async () => {
    vi.stubGlobal('Worker', FakeWorker);
    const formatter = createFormatter();
    const failed = formatter.run(job('css'));
    FakeWorker.all[0]!.reply({ id: 1, failure: 'Failed to fetch dynamically imported module' });
    expect(await failed).toEqual({ failure: 'Failed to fetch dynamically imported module' });
    const crashed = formatter.run(job('css'));
    FakeWorker.all[0]!.onerror?.({ message: 'out of memory', preventDefault: () => undefined } as ErrorEvent);
    expect(await crashed).toEqual({ failure: 'out of memory' });
    void formatter.run(job('css'));
    expect(FakeWorker.all).toHaveLength(2);
  });

  it('without workers, says why', async () => {
    vi.stubGlobal('Worker', undefined);
    expect(await createFormatter().run(job('css'))).toEqual({ failure: NO_WORKERS });
  });
});
