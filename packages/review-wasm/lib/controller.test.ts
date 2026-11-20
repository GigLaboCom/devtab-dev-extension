import { createReviewController } from './controller';
import { describe, expect, it, vi } from 'vitest';
import type { CompareRequest, DiffPayload, ReviewEvent, ReviewModule } from './types';

const request = (path: string, options?: CompareRequest['options']): CompareRequest => ({
  path,
  language: 'text',
  oldText: 'a\n',
  newText: 'b\n',
  ...(options ? { options } : {}),
});
const payload = (path: string): DiffPayload => ({ path, language: 'text', oldText: 'a\n', newText: 'b\n', hunks: [] });

const fakeModule = () => {
  const calls: string[] = [];
  const module: ReviewModule = {
    run: vi.fn(),
    set_theme: vi.fn(),
    compare_texts: json => void calls.push(`compare ${(JSON.parse(json) as CompareRequest).path}`),
    show_diff: json => void calls.push(`diff ${(JSON.parse(json) as DiffPayload).path}`),
  };
  return { module, calls };
};

const shownDetail = JSON.stringify({
  path: 'src/lib.rs',
  changes: 4,
  added: 17,
  removed: 6,
  lineDiffer: 'histogram',
  compareMs: 0.4,
});

describe('createReviewController', () => {
  it('holds the last request until the first frame, then sends it once', () => {
    const { module, calls } = fakeModule();
    const c = createReviewController(module);
    c.compare(request('one'));
    c.showDiff(payload('two'));
    c.compare(request('three'));
    expect(calls).toEqual([]);
    expect(c.ready).toBe(false);
    c.onModuleEvent('first-frame', '');
    expect(c.ready).toBe(true);
    expect(calls).toEqual(['compare three']);
    c.onModuleEvent('first-frame', '');
    expect(calls).toEqual(['compare three']);
  });

  it('lets a request made while the first frame is reported win over the one that waited', () => {
    const { module, calls } = fakeModule();
    const c: ReturnType<typeof createReviewController> = createReviewController(module, {
      onEvent: event => {
        if (event.name === 'first-frame') c.compare(request('newer'));
      },
    });
    c.compare(request('older'));
    c.onModuleEvent('first-frame', '');
    expect(calls).toEqual(['compare newer']);
  });

  it('sends straight away once ready: two texts with their options, or ready hunks', () => {
    const { module, calls } = fakeModule();
    const sent = vi.spyOn(module, 'compare_texts');
    const c = createReviewController(module);
    c.onModuleEvent('first-frame', '');
    c.compare(request('four', { lineDiffer: 'myers' }));
    c.showDiff(payload('five'));
    expect(calls).toEqual(['compare four', 'diff five']);
    expect(JSON.parse(sent.mock.calls[0][0])).toEqual({
      path: 'four',
      language: 'text',
      oldText: 'a\n',
      newText: 'b\n',
      options: { lineDiffer: 'myers' },
    });
  });

  it('passes the counts of a shown comparison on', () => {
    const events: ReviewEvent[] = [];
    const c = createReviewController(fakeModule().module, { onEvent: e => events.push(e) });
    c.onModuleEvent('first-frame', '');
    c.onModuleEvent('shown', shownDetail);
    c.onModuleEvent('shown', JSON.stringify({ path: 'p', changes: 0, added: 0, removed: 0 }));
    expect(events).toEqual([
      { name: 'first-frame' },
      {
        name: 'shown',
        shown: { path: 'src/lib.rs', changes: 4, added: 17, removed: 6, lineDiffer: 'histogram', compareMs: 0.4 },
      },
      { name: 'shown', shown: { path: 'p', changes: 0, added: 0, removed: 0, lineDiffer: null, compareMs: null } },
    ]);
  });

  it('reports what the module refuses instead of throwing, and ignores unknown events', () => {
    const onError = vi.fn();
    const events: ReviewEvent[] = [];
    const module: ReviewModule = {
      run: vi.fn(),
      set_theme: vi.fn(),
      compare_texts: () => {
        throw 'compare_texts: unknown lineDiffer "nope"; built in: histogram, myers';
      },
      show_diff: () => {
        throw new Error('show_diff: invalid type');
      },
    };
    const c = createReviewController(module, { onError, onEvent: e => events.push(e) });
    c.setTheme({ dark: true });
    expect(module.set_theme).toHaveBeenCalledWith(true, undefined, undefined);
    c.onModuleEvent('first-frame', '');
    c.compare(request('bad', { lineDiffer: 'nope' }));
    c.showDiff(payload('bad'));
    expect(onError.mock.calls.map(([e]) => String(e))).toEqual([
      'compare_texts: unknown lineDiffer "nope"; built in: histogram, myers',
      'Error: show_diff: invalid type',
    ]);
    c.onModuleEvent('shown', 'not json');
    expect(onError).toHaveBeenCalledTimes(3);
    c.onModuleEvent('error', 'theme json: expected value');
    c.onModuleEvent('unknown', '');
    expect(events).toEqual([{ name: 'first-frame' }, { name: 'error', message: 'theme json: expected value' }]);
  });
});
