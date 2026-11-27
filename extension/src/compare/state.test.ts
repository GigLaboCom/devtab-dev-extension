/**
 * The page's rules for the two sides (state.ts): the example as a pair, where texts go, read-only by default, what a
 * side's bar names.
 */
import { initialState, isEmptyComparison, languageAfter, place, reduce, sideName, suggestedName } from './state';
import { describe, expect, it } from 'vitest';
import type { SideText } from './files';
import type { CompareEvent, CompareState } from './state';
import type { DiffShown } from '@extension/review-wasm';

const text = (body: string, fileName: string | null = null): SideText => ({
  text: body,
  fileName,
  handle: null,
  bom: false,
});
const run = (state: CompareState, ...events: CompareEvent[]): CompareState => events.reduce(reduce, state);
const example: CompareEvent = {
  type: 'example',
  language: 'rust',
  names: { old: 'before.rs', new: 'after.rs' },
  empty: { old: false, new: false },
};
const shown = (modified: [boolean, boolean], empty: [boolean, boolean] = [false, false]): DiffShown => ({
  path: 'p',
  changes: 2,
  added: 3,
  removed: 1,
  lineDiffer: 'histogram',
  compareMs: 0.1,
  updateMs: 0.2,
  cause: 'request',
  sides: {
    old: { editable: false, modified: modified[0], empty: empty[0] },
    new: { editable: false, modified: modified[1], empty: empty[1] },
  },
  mode: 'diff',
});

describe('where texts go', () => {
  it('two texts: the first is the original, the second the changed text, wherever they were dropped', () => {
    for (const side of ['old', 'new', null] as const) {
      const placed = place([text('a', 'a.rs'), text('b', 'b.rs')], side, 'file');
      expect('arrivals' in placed && placed.arrivals.map(a => [a.side, a.text.fileName])).toEqual([
        ['old', 'a.rs'],
        ['new', 'b.rs'],
      ]);
    }
  });
  it('one text: the side it was dropped on; beside both it goes nowhere and the page says where to drop it', () => {
    const placed = place([text('a', 'a.rs')], 'new', 'file');
    expect('arrivals' in placed && placed.arrivals.map(a => a.side)).toEqual(['new']);
    const nowhere = place([text('a', 'a.rs')], null, 'file');
    expect('problem' in nowhere && nowhere.problem).toMatch(
      /drop it on the left \(original\) or the right \(changed\)/,
    );
  });
});

describe('the example is a pair', () => {
  it('both sides show it, marked as the example; another language switches it while neither is edited', () => {
    const state = run(initialState('rust'), example);
    expect(state.example).toBe('rust');
    expect([sideName(state.sides.old), sideName(state.sides.new)]).toEqual(['before.rs', 'after.rs']);
    expect(state.sides.old.origin).toBe('example');
    expect(run(state, { type: 'shown', shown: shown([false, false]) }).example).toBe('rust');
    // Edited: the example is the user's text now.
    expect(run(state, { type: 'shown', shown: shown([false, true]) }).example).toBeNull();
  });
  it('the first real text replaces it on its side and empties the other', () => {
    const state = run(initialState('rust'), example, {
      type: 'arrived',
      arrivals: [{ side: 'new', text: text('x', 'x.py'), origin: 'file' }],
      language: 'python',
    });
    expect(state.example).toBeNull();
    expect(state.sides.new).toMatchObject({ origin: 'file', fileName: 'x.py', empty: false });
    expect(state.sides.old).toMatchObject({ origin: 'empty', fileName: null, empty: true });
    expect(state.language).toBe('python');
  });
  it('Clear takes it off both sides too', () => {
    const state = run(initialState('rust'), example, { type: 'cleared', side: 'old' });
    expect(state.example).toBeNull();
    expect([state.sides.old.origin, state.sides.new.origin]).toEqual(['empty', 'empty']);
    expect(isEmptyComparison(state)).toBe(true);
  });
  it('a side being edited is not the empty comparison, even when empty', () => {
    const state = run(initialState('rust'), { type: 'editable', side: 'new', editable: true });
    expect(isEmptyComparison(state)).toBe(false);
  });
});

describe('read-only by default, modified as the editor says', () => {
  it('new text makes a side read-only and unmodified', () => {
    const state = run(
      initialState('text'),
      { type: 'editable', side: 'old', editable: true },
      { type: 'shown', shown: shown([true, false]) },
      { type: 'arrived', arrivals: [{ side: 'old', text: text('fresh'), origin: 'clipboard' }], language: 'text' },
    );
    expect(state.sides.old).toMatchObject({ editable: false, modified: false, origin: 'clipboard' });
    expect(sideName(state.sides.old)).toBe('Pasted text');
  });
  it('a swap carries everything a side is to the other side', () => {
    const state = run(
      initialState('text'),
      { type: 'arrived', arrivals: [{ side: 'old', text: text('a', 'a.txt'), origin: 'file' }], language: 'text' },
      { type: 'editable', side: 'old', editable: true },
      { type: 'swapped' },
    );
    expect(state.sides.new).toMatchObject({ fileName: 'a.txt', editable: true });
    expect(state.sides.old.origin).toBe('empty');
  });
  it('Save as gives a side its file name; a later Save keeps it', () => {
    const state = run(
      initialState('rust'),
      { type: 'arrived', arrivals: [{ side: 'new', text: text('a'), origin: 'clipboard' }], language: 'rust' },
      { type: 'saved', side: 'new', fileName: 'fixed.rs', handle: null },
    );
    expect(state.sides.new).toMatchObject({ origin: 'file', fileName: 'fixed.rs' });
    expect(suggestedName(state.sides.new, 'new', 'rs')).toBe('fixed.rs');
    expect(suggestedName(state.sides.old, 'old', 'rs')).toBe('original.rs');
  });
  it('names what a side holds when it has no file', () => {
    const base = initialState('text').sides.old;
    expect(sideName(base)).toBe('Empty');
    expect(sideName({ ...base, origin: 'dropped', empty: false })).toBe('Dropped text');
    expect(sideName({ ...base, empty: false, modified: true })).toBe('Typed text');
  });
});

describe('the language after texts arrive', () => {
  const detect = (name: string): string | undefined => (name.endsWith('.go') ? 'go' : undefined);
  const arrivals = (name: string | null) => [{ side: 'new' as const, text: text('x', name), origin: 'file' as const }];
  it('the file’s, when its name tells it', () => {
    expect(languageAfter(initialState('rust'), arrivals('main.go'), detect)).toBe('go');
  });
  it('plain text when the example goes and nothing tells; otherwise the selection stays', () => {
    const withExample = run(initialState('rust'), example);
    expect(languageAfter(withExample, arrivals('Makefile'), detect)).toBe('text');
    expect(languageAfter(initialState('python'), arrivals(null), detect)).toBe('python');
  });
});
