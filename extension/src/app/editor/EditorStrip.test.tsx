/**
 * The strip of the editor's buttons on the page (./EditorStrip.tsx): a toolbar of real buttons in the strip's order,
 * each named, greyed ones still reachable and saying why, toggles pressed, the host's Save at the head; at a narrow
 * width the controls left off from the end go into the more menu — the same order and lines, greyed with the reason,
 * the key, a check on a toggle that is on — and a line pressed is its button pressed. jsdom lays nothing out: the
 * widths are given to the copy the strip measures.
 */
import { EditorStrip } from './EditorStrip';
import { EDITOR_TEXT } from './text';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { StripState } from './strip';

let stripWidth = 1000;
let resize: (() => void) | null = null;

beforeEach(() => {
  stripWidth = 1000;
  resize = null;
  globalThis.ResizeObserver = class {
    constructor(callback: () => void) {
      resize = callback;
    }
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver;
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockImplementation(function (this: HTMLElement) {
    const kind = this.dataset.measure;
    return kind === 'gap' ? 9 : kind === 'control' || kind === 'more' ? 24 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('kit-editor-strip') ? stripWidth : 0;
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const state = (patch: Partial<StripState> = {}): StripState => ({
  ready: true,
  standing: { editable: true, empty: false, selection: false },
  layout: 'file',
  view: { softWrap: false, whitespace: true },
  save: null,
  mac: true,
  ...patch,
});

const strip = () => screen.getByRole('toolbar', { name: EDITOR_TEXT.stripLabel });
const buttons = () => within(strip()).getAllByRole('button');
const names = () => buttons().map(b => b.getAttribute('aria-label'));

describe('EditorStrip', () => {
  it('a toolbar of named buttons in the strip’s order, Save at the head, toggles pressed', () => {
    const onSave = vi.fn();
    render(
      <EditorStrip
        label={EDITOR_TEXT.stripLabel}
        state={state({ save: { label: 'Save now', key: { key: 's', mod: true, shift: false }, unavailable: null } })}
        onCommand={vi.fn()}
        onView={vi.fn()}
        onSave={onSave}
      />,
    );
    expect(names()).toEqual([
      'Save now',
      EDITOR_TEXT.stripUndo,
      EDITOR_TEXT.stripRedo,
      EDITOR_TEXT.stripCut,
      EDITOR_TEXT.stripCopy,
      EDITOR_TEXT.stripCopyAll,
      EDITOR_TEXT.stripPaste,
      EDITOR_TEXT.stripSelectAll,
      EDITOR_TEXT.stripIndent,
      EDITOR_TEXT.stripOutdent,
      EDITOR_TEXT.stripFind,
      EDITOR_TEXT.stripWrap,
      EDITOR_TEXT.stripWhitespace,
    ]);
    expect(buttons().every(b => b.tagName === 'BUTTON')).toBe(true);
    expect(screen.getByRole('button', { name: EDITOR_TEXT.stripWrap }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: EDITOR_TEXT.stripWhitespace }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: EDITOR_TEXT.stripUndo }).getAttribute('aria-keyshortcuts')).toBe(
      'Meta+Z',
    );
    // Five lines between groups, the toggles' gap, and no more button: everything fits.
    expect(strip().querySelectorAll(':scope > .kit-editor-strip-line')).toHaveLength(5);
    expect(strip().querySelectorAll(':scope > .kit-editor-strip-spacer')).toHaveLength(1);
    expect(screen.queryByRole('button', { name: EDITOR_TEXT.stripMore })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Save now' }));
    expect(onSave).toHaveBeenCalledOnce();
  });

  it('greyed buttons stay in reach and do nothing; a press runs the command; a toggle asks for the other state', () => {
    const onCommand = vi.fn();
    const onView = vi.fn();
    render(
      <EditorStrip
        label={EDITOR_TEXT.stripLabel}
        state={state({ standing: { editable: false, empty: false, selection: false }, layout: 'diff' })}
        onCommand={onCommand}
        onView={onView}
      />,
    );
    const undo = screen.getByRole('button', { name: EDITOR_TEXT.stripUndo });
    expect(undo.getAttribute('aria-disabled')).toBe('true');
    expect(undo.hasAttribute('disabled')).toBe(false);
    fireEvent.click(undo);
    fireEvent.click(screen.getByRole('button', { name: EDITOR_TEXT.stripWrap }));
    expect(onCommand).not.toHaveBeenCalled();
    expect(onView).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: EDITOR_TEXT.stripCopyAll }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR_TEXT.stripFind }));
    fireEvent.click(screen.getByRole('button', { name: EDITOR_TEXT.stripWhitespace }));
    expect(onCommand.mock.calls).toEqual([['copyAll'], ['find']]);
    expect(onView).toHaveBeenCalledWith('whitespace', false);
    // Read only: only what makes sense stays live.
    const live = buttons()
      .filter(b => b.getAttribute('aria-disabled') !== 'true')
      .map(b => b.getAttribute('aria-label'));
    expect(live).toEqual([
      EDITOR_TEXT.stripCopyAll,
      EDITOR_TEXT.stripSelectAll,
      EDITOR_TEXT.stripFind,
      EDITOR_TEXT.stripWhitespace,
    ]);
  });

  it('at a narrow width the rest goes into the more menu: same order and lines, why, key, check; a line is its button', () => {
    stripWidth = 100;
    const onCommand = vi.fn();
    const onView = vi.fn();
    render(
      <EditorStrip
        label={EDITOR_TEXT.stripLabel}
        state={state({ standing: { editable: true, empty: true, selection: false } })}
        onCommand={onCommand}
        onView={onView}
      />,
    );
    // 24 px a button, 9 a line, 24 the more button: Undo and Redo fit in 100.
    expect(names()).toEqual([EDITOR_TEXT.stripUndo, EDITOR_TEXT.stripRedo, EDITOR_TEXT.stripMore]);
    const more = screen.getByRole('button', { name: EDITOR_TEXT.stripMore });
    act(() => {
      fireEvent.keyDown(more, { key: 'Enter' });
    });
    const menu = screen.getByRole('menu');
    const lines = [...menu.querySelectorAll<HTMLElement>('[role^="menuitem"]')];
    expect(lines.map(l => l.getAttribute('data-control'))).toEqual([
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
    // Lines between the stretches, as on the strip: before Select all, Indent, Find and the toggles.
    expect(within(menu).getAllByRole('separator')).toHaveLength(4);
    const line = (id: string) => lines.find(l => l.getAttribute('data-control') === id)!;
    expect(line('cut').hasAttribute('data-disabled')).toBe(true);
    expect(line('copyAll').hasAttribute('data-disabled')).toBe(true);
    expect(line('copyAll').textContent).toContain(EDITOR_TEXT.stripCopyAllEmpty);
    expect(line('paste').textContent).toContain('⌘V');
    expect(line('whitespace').getAttribute('aria-checked')).toBe('true');
    expect(line('softWrap').getAttribute('aria-checked')).toBe('false');
    fireEvent.click(line('find'));
    expect(onCommand).toHaveBeenCalledWith('find');
  });

  it('follows the width: wider again, the controls come back and the more button goes', () => {
    stripWidth = 200;
    render(<EditorStrip label={EDITOR_TEXT.stripLabel} state={state()} onCommand={vi.fn()} onView={vi.fn()} />);
    const narrow = names().length;
    expect(names().at(-1)).toBe(EDITOR_TEXT.stripMore);
    stripWidth = 2000;
    act(() => resize?.());
    expect(names()).toHaveLength(12);
    expect(narrow).toBeLessThan(12);
    expect(screen.queryByRole('button', { name: EDITOR_TEXT.stripMore })).toBeNull();
  });
});
