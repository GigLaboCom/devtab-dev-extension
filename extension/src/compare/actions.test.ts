/**
 * Seam `CompareAction` (actions.ts): the shared contract every action passes, and what each default does with the
 * page's operations and the browser seams (fakes here; the page itself — ComparePage.test.tsx, the real browser —
 * scripts/e2e-check.mjs).
 */
import { compareActions } from './actions';
import { initialState, reduce } from './state';
import { describe, expect, it, vi } from 'vitest';
import type { ActionBehaviors, ActionContext, CompareAction, ComparePort } from './actions';
import type { CompareState, Side } from './state';

const ready = (over: (state: CompareState) => CompareState = s => s): CompareState =>
  over(reduce(initialState('rust'), { type: 'viewer', viewer: 'ready' }));
const withText = (state: CompareState): CompareState =>
  reduce(state, {
    type: 'arrived',
    arrivals: [
      { side: 'old', text: { text: 'a\n', fileName: 'a.rs', handle: null, bom: false }, origin: 'file' },
      { side: 'new', text: { text: 'b\nc\n', fileName: null, handle: null, bom: true }, origin: 'clipboard' },
    ],
    language: 'rust',
  });

const harness = (state: CompareState) => {
  const page: ComparePort = {
    load: vi.fn(() => Promise.resolve()),
    read: vi.fn((side: Side) => Promise.resolve(side === 'old' ? 'a\n' : 'b\nc\n')),
    setEditable: vi.fn(),
    clear: vi.fn(() => Promise.resolve()),
    swap: vi.fn(),
    saved: vi.fn(),
    say: vi.fn(),
  };
  const behaviors: ActionBehaviors = {
    texts: { pick: vi.fn(() => Promise.resolve(null)), drop: vi.fn() },
    clipboard: { read: vi.fn(() => Promise.resolve({ text: 'pasted' })), write: vi.fn(() => Promise.resolve()) },
    saver: {
      name: 'fake',
      save: vi.fn(() =>
        Promise.resolve({ status: 'saved' as const, fileName: 'b.rs', handle: null, how: 'file' as const }),
      ),
      saveAs: vi.fn(() => Promise.resolve({ status: 'cancelled' as const })),
    },
    examples: { load: vi.fn() },
  };
  const run = (id: string, side: Side | null) => {
    const action = compareActions.find(a => a.id === id)!;
    const context: ActionContext = { side, state, page, behaviors };
    return action.run(context);
  };
  return { page, behaviors, run };
};

describe.each(compareActions.map(a => [a.id, a] as const))(
  'CompareAction contract: %s',
  (_id, action: CompareAction) => {
    it('has an id, a title, a place and an icon; a shortcut uses the command modifier', () => {
      expect(action.id).toMatch(/^[a-z][A-Za-z]*$/);
      expect(action.title.length).toBeGreaterThan(2);
      expect(['side', 'common']).toContain(action.scope);
      expect(action.icon).toBeTruthy();
      if (action.shortcut) expect(action.shortcut.mod).toBe(true);
    });
    it('waits for the editor where it needs the text, never throws on a fresh page', () => {
      const fresh = initialState('rust');
      const side = action.scope === 'side' ? 'new' : null;
      expect(() => action.enabled(fresh, side)).not.toThrow();
      expect(typeof action.enabled(ready(withText), side)).toBe('boolean');
    });
  },
);

describe('the toolbar list', () => {
  it('ids and shortcuts are unique; the side actions come in the order of the bars', () => {
    const ids = compareActions.map(a => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const chords = compareActions.flatMap(a => (a.shortcut ? [JSON.stringify(a.shortcut)] : []));
    expect(new Set(chords).size).toBe(chords.length);
    expect(compareActions.filter(a => a.scope === 'side').map(a => a.id)).toEqual([
      'open',
      'paste',
      'copy',
      'save',
      'saveAs',
      'edit',
      'clear',
    ]);
    expect(compareActions.filter(a => a.scope === 'common').map(a => a.id)).toEqual(['swap']);
  });
});

describe('what each action does', () => {
  it('Open: picked files go to the page, which places them; problems are said, nothing loaded', async () => {
    const h = harness(ready());
    const texts = [{ text: 'x', fileName: 'x.rs', handle: null, bom: false }];
    vi.mocked(h.behaviors.texts.pick).mockResolvedValueOnce({ texts, problems: [] });
    await h.run('open', 'old');
    expect(h.page.load).toHaveBeenCalledWith(texts, 'old', 'file');
    vi.mocked(h.behaviors.texts.pick).mockResolvedValueOnce({
      texts: [],
      problems: ['x.bin looks like a binary file'],
    });
    await h.run('open', 'old');
    expect(h.page.say).toHaveBeenLastCalledWith('x.bin looks like a binary file.', 'error');
    expect(h.page.load).toHaveBeenCalledTimes(1);
  });
  it('Paste: the clipboard text replaces the side; a refused read is said', async () => {
    const h = harness(ready());
    await h.run('paste', 'new');
    expect(h.page.load).toHaveBeenCalledWith(
      [{ text: 'pasted', fileName: null, handle: null, bom: false }],
      'new',
      'clipboard',
    );
    vi.mocked(h.behaviors.clipboard.read).mockResolvedValueOnce({ refused: 'no' });
    await h.run('paste', 'new');
    expect(h.page.say).toHaveBeenLastCalledWith('no', 'error');
  });
  it('Copy: the side’s text as the editor holds it', async () => {
    const h = harness(ready(withText));
    await h.run('copy', 'new');
    expect(h.behaviors.clipboard.write).toHaveBeenCalledWith('b\nc\n');
    expect(h.page.say).toHaveBeenLastCalledWith('Copied 3 lines of the changed side.', 'success');
  });
  it('Save: the text, the byte-order mark, a name to suggest; the page learns where it went', async () => {
    const h = harness(ready(withText));
    await h.run('save', 'new');
    expect(h.behaviors.saver.save).toHaveBeenCalledWith({
      text: 'b\nc\n',
      bom: true,
      suggestedName: 'changed.rs',
      handle: null,
    });
    expect(h.page.saved).toHaveBeenCalledWith('new', 'b\nc\n', 'b.rs', null);
    expect(h.page.say).toHaveBeenLastCalledWith('Saved b.rs.', 'success');
  });
  it('Save as: a closed "where" saves nothing', async () => {
    const h = harness(ready(withText));
    await h.run('saveAs', 'old');
    expect(vi.mocked(h.behaviors.saver.saveAs).mock.calls[0]![0].suggestedName).toBe('a.rs');
    expect(h.page.saved).not.toHaveBeenCalled();
    expect(h.page.say).toHaveBeenLastCalledWith('Not saved.');
  });
  it('Edit switches the side; Clear and Swap go to the page', async () => {
    const h = harness(ready(withText));
    await h.run('edit', 'old');
    expect(h.page.setEditable).toHaveBeenCalledWith('old', true);
    await h.run('clear', 'old');
    expect(h.page.clear).toHaveBeenCalledWith('old');
    await h.run('swap', null);
    expect(h.page.swap).toHaveBeenCalled();
  });
  it('what needs the editor waits for it; Clear has nothing to do on an empty side', () => {
    const byId = (id: string) => compareActions.find(a => a.id === id)!;
    const fresh = initialState('rust');
    for (const id of ['copy', 'save', 'saveAs', 'edit', 'swap']) expect(byId(id).enabled(fresh, 'new'), id).toBe(false);
    for (const id of ['open', 'paste']) expect(byId(id).enabled(fresh, 'new'), id).toBe(true);
    expect(byId('clear').enabled(ready(), 'old')).toBe(false);
    expect(byId('clear').enabled(ready(withText), 'old')).toBe(true);
    expect(byId('edit').pressed!(reduce(ready(), { type: 'editable', side: 'old', editable: true }), 'old')).toBe(true);
  });
});
