/**
 * A load that ends because the editor page is going away is not the editor's failure (./pageLife.ts): the start's
 * failure and a grammar's are reported only while the page stays.
 */
import { ABORT_GRACE_MS, isAbort, reportUnlessLeaving, watchPageLife } from './pageLife';
import { describe, expect, it, vi } from 'vitest';

/** A window with what the watcher listens to. */
const fakeWindow = () => {
  const listeners: Record<string, Array<(event: { persisted?: boolean }) => void>> = {};
  const win = {
    parent: {} as unknown,
    addEventListener: (type: string, listener: (event: { persisted?: boolean }) => void) => {
      (listeners[type] ??= []).push(listener);
    },
  };
  const fire = (type: string, event: { persisted?: boolean } = {}) => listeners[type]?.forEach(l => l(event));
  return { win, fire };
};

/** What Chrome rejects with when a reload interrupts the module's download. */
const ABORTED = new TypeError('WebAssembly compilation aborted: Network error: Response body loading was aborted');

describe('watchPageLife', () => {
  it('here until pagehide; back from the back/forward cache, here again', () => {
    const { win, fire } = fakeWindow();
    const life = watchPageLife(win);
    expect(life.leaving()).toBe(false);
    fire('pagehide');
    expect(life.leaving()).toBe(true);
    fire('pageshow', { persisted: false });
    expect(life.leaving()).toBe(true);
    fire('pageshow', { persisted: true });
    expect(life.leaving()).toBe(false);
  });

  it('a frame already detached from its page is going away', () => {
    const { win } = fakeWindow();
    const life = watchPageLife(win);
    win.parent = null;
    expect(life.leaving()).toBe(true);
  });
});

describe('isAbort', () => {
  it.each([
    [ABORTED, true],
    [new DOMException('The operation was aborted.', 'AbortError'), true],
    [new TypeError('Failed to fetch: the request was aborted'), true],
    [new Error('the editor module does not export calloc (function)'), false],
    ['run: missing field `dark`', false],
    [new Error('grammars/go.wasm: HTTP 404'), false],
  ])('%s → %s', (error, abort) => {
    expect(isAbort(error)).toBe(abort);
  });
});

describe('reportUnlessLeaving', () => {
  it('a failure of a page that stays is reported at once', () => {
    const report = vi.fn();
    const later = vi.fn();
    reportUnlessLeaving(new Error('broken'), { leaving: () => false }, report, later);
    expect(report).toHaveBeenCalledOnce();
    expect(later).not.toHaveBeenCalled();
  });

  it('nothing at all once the page is going away — an abort or not', () => {
    const report = vi.fn();
    const later = vi.fn();
    for (const error of [ABORTED, new Error('broken')])
      reportUnlessLeaving(error, { leaving: () => true }, report, later);
    expect(report).not.toHaveBeenCalled();
    expect(later).not.toHaveBeenCalled();
  });

  it('an abort before pagehide waits: reported if the page stayed, dropped if it left meanwhile', () => {
    const report = vi.fn();
    let leaving = false;
    const timers: Array<[() => void, number]> = [];
    const later = (run: () => void, ms: number) => timers.push([run, ms]);
    reportUnlessLeaving(ABORTED, { leaving: () => leaving }, report, later);
    reportUnlessLeaving(ABORTED, { leaving: () => leaving }, report, later);
    expect(report).not.toHaveBeenCalled();
    expect(timers.map(([, ms]) => ms)).toEqual([ABORT_GRACE_MS, ABORT_GRACE_MS]);
    timers[0][0]();
    expect(report).toHaveBeenCalledOnce();
    leaving = true;
    timers[1][0]();
    expect(report).toHaveBeenCalledOnce();
  });
});
