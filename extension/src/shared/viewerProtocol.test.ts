import { chordOf, isFromViewer, isMac, isToViewer, sameChord } from './viewerProtocol';
import { describe, expect, it } from 'vitest';

const texts = { path: 'a.rs', language: 'rust', oldText: 'a\n', newText: 'b\n' };
const shown = {
  path: 'a.rs',
  changes: 1,
  added: 1,
  removed: 1,
  lineDiffer: 'histogram',
  compareMs: 0.1,
  updateMs: 0.2,
  cause: 'request',
  sides: {
    old: { editable: false, modified: false, empty: false },
    new: { editable: true, modified: true, empty: false },
  },
};

describe('viewer protocol', () => {
  it('the editor page takes texts, a side, the language, a swap, edit mode and reads — each with what it needs', () => {
    expect(isToViewer({ type: 'viewer/compare', id: 1, request: texts })).toBe(true);
    expect(isToViewer({ type: 'viewer/compare', id: 2, request: { ...texts, options: { lineDiffer: 'myers' } } })).toBe(
      true,
    );
    expect(isToViewer({ type: 'viewer/compare', request: texts })).toBe(false);
    expect(isToViewer({ type: 'viewer/compare', id: 1, request: { path: 'a.rs' } })).toBe(false);
    expect(isToViewer({ type: 'viewer/set-side', id: 3, request: { side: 'new', text: 'x' } })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-side', id: 3, request: { side: 'right', text: 'x' } })).toBe(false);
    expect(isToViewer({ type: 'viewer/set-language', id: 4, language: 'go' })).toBe(true);
    expect(isToViewer({ type: 'viewer/swap', id: 5 })).toBe(true);
    expect(isToViewer({ type: 'viewer/swap' })).toBe(false);
    expect(isToViewer({ type: 'viewer/mark-saved', id: 6, side: 'old', text: 'a' })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-editable', side: 'old', editable: true, focus: false })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-editable', side: 'old', editable: 'yes', focus: false })).toBe(false);
    expect(isToViewer({ type: 'viewer/focus', side: 'new' })).toBe(true);
    expect(isToViewer({ type: 'viewer/read', id: 7, side: 'new' })).toBe(true);
    expect(isToViewer({ type: 'viewer/keys', keys: [{ key: 's', mod: true, shift: false }] })).toBe(true);
    expect(isToViewer({ type: 'viewer/keys', keys: [{ key: 's' }] })).toBe(false);
    // Ready hunks come only as a request, with its id.
    expect(isToViewer({ type: 'viewer/show-diff', payload: { ...texts, hunks: [] } })).toBe(false);
    expect(isToViewer(null)).toBe(false);
  });

  it('the Projects section shows ready hunks, one file, the file or its diff, and brings a line or a hunk into view', () => {
    expect(isToViewer({ type: 'viewer/show-diff', id: 8, payload: { ...texts, hunks: [] } })).toBe(true);
    expect(isToViewer({ type: 'viewer/show-diff', id: 8, payload: texts })).toBe(false);
    const file = { path: 'src/main.rs', language: 'rust', text: 'fn main() {}\n', readOnly: false };
    expect(isToViewer({ type: 'viewer/show-file', id: 9, request: file })).toBe(true);
    expect(isToViewer({ type: 'viewer/show-file', id: 9, request: { ...file, readOnly: 'no' } })).toBe(false);
    expect(isToViewer({ type: 'viewer/show-file', request: file })).toBe(false);
    expect(isToViewer({ type: 'viewer/set-mode', id: 10, mode: 'file' })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-mode', id: 10, mode: 'split' })).toBe(false);
    expect(isToViewer({ type: 'viewer/reveal-line', line: 4 })).toBe(true);
    expect(isToViewer({ type: 'viewer/reveal-line', line: 4, column: 2 })).toBe(true);
    expect(isToViewer({ type: 'viewer/reveal-line', line: -1 })).toBe(false);
    expect(isToViewer({ type: 'viewer/reveal-line', line: 1.5 })).toBe(false);
    expect(isToViewer({ type: 'viewer/reveal-hunk', index: 0 })).toBe(true);
    expect(isToViewer({ type: 'viewer/reveal-hunk', index: '0' })).toBe(false);
  });

  it('editor settings travel inside a replacing request and as their own message (D39)', () => {
    const file = { path: 'main.go', language: 'go', text: '\tx\n', readOnly: false };
    const editor = { indentStyle: 'tab', indentSize: 4 };
    expect(isToViewer({ type: 'viewer/show-file', id: 1, request: { ...file, editor } })).toBe(true);
    expect(isToViewer({ type: 'viewer/show-file', id: 1, request: { ...file, editor: 'tabs' } })).toBe(false);
    expect(isToViewer({ type: 'viewer/compare', id: 2, request: { ...texts, editor: { old: editor } } })).toBe(true);
    expect(isToViewer({ type: 'viewer/compare', id: 2, request: { ...texts, editor: { old: 4 } } })).toBe(false);
    const payload = { ...texts, hunks: [], editor: { new: editor } };
    expect(isToViewer({ type: 'viewer/show-diff', id: 3, payload })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-editor-settings', settings: editor })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-editor-settings', side: 'old', settings: { softWrap: true } })).toBe(true);
    expect(isToViewer({ type: 'viewer/set-editor-settings', side: 'left', settings: editor })).toBe(false);
    expect(isToViewer({ type: 'viewer/set-editor-settings' })).toBe(false);
  });

  it('the main page takes ready, results (of a request, or of an edit without an id), texts, errors and the canvas’s events', () => {
    expect(isFromViewer({ type: 'viewer/ready' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/shown', id: 3, shown })).toBe(true);
    expect(isFromViewer({ type: 'viewer/shown', shown: { ...shown, cause: 'edit' } })).toBe(true);
    expect(isFromViewer({ type: 'viewer/shown', path: 'a.rs' })).toBe(false);
    expect(isFromViewer({ type: 'viewer/error', id: 3, message: 'unknown lineDiffer' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/error', message: 'could not start' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/error', id: '3', message: 'x' })).toBe(false);
    expect(isFromViewer({ type: 'viewer/text', id: 8, side: 'old', text: 'a' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/drag' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/drop', side: 'new', entries: [] })).toBe(true);
    expect(isFromViewer({ type: 'viewer/key', chord: { key: 's', mod: true, shift: false }, side: null })).toBe(true);
    expect(isFromViewer({ type: 'viewer/leave', backwards: true })).toBe(true);
  });

  it('a grammar file of the mixed highlighter: arrived (and whether it repainted) or failed, as a note', () => {
    expect(isFromViewer({ type: 'viewer/grammar', language: 'go', state: 'loaded', repainted: true, ms: 9 })).toBe(
      true,
    );
    expect(isFromViewer({ type: 'viewer/grammar', language: 'go', state: 'failed', message: 'HTTP 404' })).toBe(true);
    expect(isFromViewer({ type: 'viewer/grammar', language: 'go', state: 'loaded' })).toBe(false);
    expect(isFromViewer({ type: 'viewer/grammar', language: 'go', state: 'failed' })).toBe(false);
    expect(isFromViewer({ type: 'viewer/grammar', state: 'failed', message: 'x' })).toBe(false);
  });

  it('a chord takes ⌘ on a Mac and Ctrl elsewhere', () => {
    const event = { key: 'S', metaKey: true, ctrlKey: false, shiftKey: true };
    expect(chordOf(event, true)).toEqual({ key: 's', mod: true, shift: true });
    // ⌘ off a Mac is the Windows / Super key: the other modifier, never the command one.
    expect(chordOf(event, false)).toEqual({ key: 's', mod: false, shift: true, other: true });
    expect(sameChord(chordOf(event, true), { key: 's', mod: true, shift: true })).toBe(true);
    expect(isMac({ platform: 'MacIntel', userAgent: '' })).toBe(true);
    expect(isMac({ platform: 'Win32', userAgent: '' })).toBe(false);
  });
});
