/**
 * The strip of the editor's buttons as data (./strip.ts): the set and its order, the stretches and the gap before the
 * toggles, what each control is in each state (greyed, why, the key the module binds, a toggle's state), how many fit a
 * width, and the clipboard's paths — Copy, Cut and Copy all written from the page, Paste read through the seam, refused
 * or allowed.
 */
import { controlId, fitCount, gapBefore, runStripCommand, standingOf, stripControls, viewChoice } from './strip';
import { EDITOR_TEXT } from './text';
import { REFUSED_READ } from '@src/compare/clipboard';
import { describe, expect, it, vi } from 'vitest';
import type { StripPort, StripState } from './strip';
import type { Clipboard } from '@src/compare/clipboard';

const editable = { editable: true, empty: false, selection: false };
const state = (patch: Partial<StripState> = {}): StripState => ({
  ready: true,
  standing: editable,
  layout: 'file',
  view: { softWrap: false, whitespace: false },
  save: null,
  mac: true,
  ...patch,
});
const standing = (id: string, s: StripState) => {
  const control = stripControls(!!s.save).find(c => controlId(c) === id);
  if (!control) throw new Error(`no ${id}`);
  return standingOf(control, s);
};

describe('the strip’s set, order and stretches', () => {
  it('Save first and apart (only when offered), the operations in their groups, the two toggles at the far end', () => {
    expect(stripControls(true).map(controlId)).toEqual([
      'save',
      'undo',
      'redo',
      'cut',
      'copy',
      'copyAll',
      'paste',
      'selectAll',
      'indent',
      'outdent',
      'find',
      'softWrap',
      'whitespace',
    ]);
    expect(stripControls(false).map(controlId)[0]).toBe('undo');
    const controls = stripControls(true);
    const gaps = controls.map((_, i) => gapBefore(controls, i));
    // A line before Undo (after Save), Cut, Select all, Indent and Find; the toggles' gap before Wrap.
    expect(controls.map((c, i) => (gaps[i] ? `${gaps[i]}:${controlId(c)}` : null)).filter(Boolean)).toEqual([
      'line:undo',
      'line:cut',
      'line:selectAll',
      'line:indent',
      'line:find',
      'spacer:softWrap',
    ]);
  });
});

describe('what each control is', () => {
  it('an editable side: everything but Cut and Copy, which wait for a selection', () => {
    const s = state();
    const enabled = stripControls(false)
      .filter(c => standingOf(c, s).enabled)
      .map(controlId);
    expect(enabled).toEqual([
      'undo',
      'redo',
      'copyAll',
      'paste',
      'selectAll',
      'indent',
      'outdent',
      'find',
      'softWrap',
      'whitespace',
    ]);
    const selected = state({ standing: { ...editable, selection: true } });
    expect(standing('cut', selected).enabled).toBe(true);
    expect(standing('copy', selected).enabled).toBe(true);
  });

  it('read only: Copy (with a selection), Copy all, Select all, Find and the toggles stay; the rest greyed without a word', () => {
    const s = state({ standing: { editable: false, empty: false, selection: true } });
    const all = stripControls(false).map(c => standingOf(c, s));
    expect(all.filter(c => c.enabled).map(c => c.id)).toEqual([
      'copy',
      'copyAll',
      'selectAll',
      'find',
      'softWrap',
      'whitespace',
    ]);
    expect(all.filter(c => !c.enabled).every(c => c.why === null)).toBe(true);
  });

  it('nothing before the editor has drawn', () => {
    const s = state({ ready: false });
    expect(stripControls(false).some(c => standingOf(c, s).enabled)).toBe(false);
  });

  it('Copy all over an empty text and Wrap side by side say why instead of their key', () => {
    const empty = standing('copyAll', state({ standing: { ...editable, empty: true } }));
    expect(empty).toMatchObject({ enabled: false, why: EDITOR_TEXT.stripCopyAllEmpty });
    const wrap = standing('softWrap', state({ layout: 'diff' }));
    expect(wrap).toMatchObject({ enabled: false, why: EDITOR_TEXT.stripWrapSideBySide });
    expect(standing('whitespace', state({ layout: 'diff' })).enabled).toBe(true);
  });

  it('Save is the host’s: its words, its key, and its reason while it does nothing', () => {
    const key = { key: 's', mod: true, shift: false };
    const offered = standing('save', state({ save: { label: 'Save now', key, unavailable: null } }));
    expect(offered).toMatchObject({ label: 'Save now', enabled: true, why: null, key });
    const greyed = standing('save', state({ save: { label: 'Save now', key, unavailable: 'Read only.' } }));
    expect(greyed).toMatchObject({ enabled: false, why: 'Read only.' });
  });

  it('the key is the module’s, for the platform; Copy all and the toggles have none', () => {
    expect(standing('redo', state()).key).toEqual({ key: 'z', mod: true, shift: true });
    expect(standing('redo', state({ mac: false })).key).toEqual({ key: 'y', mod: true, shift: false });
    expect(standing('indent', state()).key).toEqual({ key: ']', mod: true, shift: false });
    expect(standing('find', state({ mac: false })).key).toEqual({ key: 'f', mod: true, shift: false });
    expect(standing('copyAll', state()).key).toBeNull();
    expect(standing('softWrap', state()).key).toBeNull();
  });

  it('a toggle says its state; pressed, it is a choice over the saved setting', () => {
    const s = state({ view: { softWrap: true, whitespace: false } });
    expect(standing('softWrap', s).on).toBe(true);
    expect(standing('whitespace', s).on).toBe(false);
    expect(standing('undo', s).on).toBeNull();
    expect(viewChoice('softWrap', false)).toEqual({ softWrap: false });
    expect(viewChoice('whitespace', true)).toEqual({ whitespace: true });
  });
});

describe('fitCount', () => {
  const widths = [24, 24, 24, 24];
  it('everything when it fits, no room kept for the more button', () => {
    expect(fitCount(widths, [], 96, 24)).toBe(4);
  });
  it('from the start, leaving room for the more button', () => {
    expect(fitCount(widths, [], 95, 24)).toBe(2);
    expect(fitCount(widths, [], 72, 24)).toBe(2);
    expect(fitCount(widths, [], 71, 24)).toBe(1);
    expect(fitCount(widths, [], 10, 24)).toBe(0);
  });
  it('a gap goes with the control after it, never alone at the end', () => {
    expect(fitCount(widths, [0, 0, 9, 0], 81, 24)).toBe(2);
    expect(fitCount(widths, [0, 0, 9, 0], 105, 24)).toBe(4);
  });
});

describe('runStripCommand: the clipboard’s paths', () => {
  const port = (copied?: string): StripPort & { calls: string[] } => {
    const calls: string[] = [];
    return {
      calls,
      command: async (side, command, text) => {
        calls.push(`${side} ${command}${text === undefined ? '' : ` ${JSON.stringify(text)}`}`);
        return copied === undefined ? {} : { copied };
      },
      read: async side => {
        calls.push(`read ${side}`);
        return 'whole text\n';
      },
    };
  };
  const clipboard = (read: Awaited<ReturnType<Clipboard['read']>>, write = vi.fn(async () => undefined)) => ({
    read: vi.fn(async () => read),
    write,
  });

  it('Copy and Cut run in the editor; what they took is written from the page', async () => {
    const p = port('selected');
    const c = clipboard({ text: '' });
    const say = vi.fn();
    await runStripCommand('copy', 'new', p, c, say);
    await runStripCommand('cut', 'old', p, c, say);
    expect(p.calls).toEqual(['new copy', 'old cut']);
    expect(c.write.mock.calls).toEqual([['selected'], ['selected']]);
    expect(say).not.toHaveBeenCalled();
  });

  it('Copy all reads the side and writes it; a refused write is said', async () => {
    const p = port();
    const c = clipboard(
      { text: '' },
      vi.fn(async () => Promise.reject(new Error('Document is not focused.'))),
    );
    const say = vi.fn();
    await runStripCommand('copyAll', 'new', p, c, say);
    expect(p.calls).toEqual(['read new']);
    expect(c.write).toHaveBeenCalledWith('whole text\n');
    expect(say).toHaveBeenCalledWith(EDITOR_TEXT.stripNotCopied('Document is not focused.'), 'error');
  });

  it('Paste allowed: the seam’s text goes to the editor, inserted there', async () => {
    const p = port();
    const say = vi.fn();
    await runStripCommand('paste', 'new', p, clipboard({ text: 'from the clipboard' }), say);
    expect(p.calls).toEqual(['new paste "from the clipboard"']);
    expect(say).not.toHaveBeenCalled();
  });

  it('Paste refused by Chrome: the seam’s sentence, quietly, and nothing reaches the editor; no permission is asked', async () => {
    const p = port();
    const say = vi.fn();
    const c = clipboard({ refused: REFUSED_READ });
    await runStripCommand('paste', 'new', p, c, say);
    expect(p.calls).toEqual([]);
    expect(say).toHaveBeenCalledWith(REFUSED_READ, 'info');
    // An empty clipboard: nothing, and nothing said.
    await runStripCommand('paste', 'new', p, clipboard({ text: '' }), say);
    expect(p.calls).toEqual([]);
    expect(say).toHaveBeenCalledTimes(1);
  });

  it('the editor’s other commands only run there', async () => {
    const p = port();
    const c = clipboard({ text: 'x' });
    for (const command of ['undo', 'redo', 'selectAll', 'indent', 'outdent', 'find'] as const)
      await runStripCommand(command, 'new', p, c, vi.fn());
    expect(p.calls).toEqual(['new undo', 'new redo', 'new selectAll', 'new indent', 'new outdent', 'new find']);
    expect(c.read).not.toHaveBeenCalled();
    expect(c.write).not.toHaveBeenCalled();
  });
});
