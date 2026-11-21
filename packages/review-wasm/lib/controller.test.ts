import { createReviewController } from './controller';
import { describe, expect, it, vi } from 'vitest';
import type { CompareRequest, DiffPayload, ReviewEvent, ReviewModule, SideRequest } from './types';

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
  const texts = { old: 'left\n', new: 'right\n' };
  let focused: string | undefined;
  const module: ReviewModule = {
    run: vi.fn(),
    set_theme: vi.fn(),
    compare_texts: json => void calls.push(`compare ${(JSON.parse(json) as CompareRequest).path}`),
    show_diff: json => void calls.push(`diff ${(JSON.parse(json) as DiffPayload).path}`),
    set_side: json => {
      const { side, text } = JSON.parse(json) as SideRequest;
      texts[side] = text;
      calls.push(`side ${side}`);
    },
    set_language: language => void calls.push(`language ${language}`),
    swap_sides: () => void calls.push('swap'),
    set_editable: (side, editable, focus) => {
      if (focus) focused = side;
      calls.push(`editable ${side} ${editable}${focus ? ' focus' : ''}`);
    },
    side_text: side => texts[side],
    mark_saved: side => void calls.push(`saved ${side}`),
    focused_side: () => focused,
    focus_side: side => void (focused = side),
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
  updateMs: 1.2,
  cause: 'edit',
  sides: {
    old: { editable: false, modified: false, empty: false },
    new: { editable: true, modified: true, empty: false },
  },
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

  it('keeps the calls made before the first frame in order; a full comparison drops what waited before it', () => {
    const { module, calls } = fakeModule();
    const c = createReviewController(module);
    c.setLanguage('python');
    c.compare(request('texts'));
    c.setSide({ side: 'new', text: 'x\n' });
    c.setEditable('new', true, true);
    c.swap();
    c.setLanguage('rust');
    expect(calls).toEqual([]);
    expect(() => c.sideText('old')).toThrow('side_text: the editor has not drawn its first frame yet');
    expect(c.focusedSide()).toBeNull();
    c.onModuleEvent('first-frame', '');
    expect(calls).toEqual(['compare texts', 'side new', 'editable new true focus', 'swap', 'language rust']);
    expect(c.sideText('new')).toBe('x\n');
    expect(c.focusedSide()).toBe('new');
    c.markSaved('new', 'x\n');
    c.focusSide('old');
    expect(calls.at(-1)).toBe('saved new');
    expect(c.focusedSide()).toBe('old');
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

  it('passes the counts of a shown comparison on, with each side and what caused it', () => {
    const events: ReviewEvent[] = [];
    const c = createReviewController(fakeModule().module, { onEvent: e => events.push(e) });
    c.onModuleEvent('first-frame', '');
    c.onModuleEvent('shown', shownDetail);
    c.onModuleEvent('shown', JSON.stringify({ path: 'p', changes: 0, added: 0, removed: 0 }));
    const unmodified = { editable: false, modified: false, empty: false };
    expect(events).toEqual([
      { name: 'first-frame' },
      {
        name: 'shown',
        shown: {
          path: 'src/lib.rs',
          changes: 4,
          added: 17,
          removed: 6,
          lineDiffer: 'histogram',
          compareMs: 0.4,
          updateMs: 1.2,
          cause: 'edit',
          sides: { old: unmodified, new: { editable: true, modified: true, empty: false } },
        },
      },
      {
        name: 'shown',
        shown: {
          path: 'p',
          changes: 0,
          added: 0,
          removed: 0,
          lineDiffer: null,
          compareMs: null,
          updateMs: null,
          cause: 'request',
          sides: { old: unmodified, new: unmodified },
        },
      },
    ]);
  });

  it('reports what the module refuses instead of throwing, and ignores unknown events', () => {
    const onError = vi.fn();
    const events: ReviewEvent[] = [];
    const module: ReviewModule = {
      ...fakeModule().module,
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
