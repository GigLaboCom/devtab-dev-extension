import { EDITOR_KEYED_COMMANDS, editorKeyOf, parseEditorKey } from './editorKeys';
import table from '../../../crates/review-view/src/editor_keys.json';
import { describe, expect, it } from 'vitest';

describe('the editor commands’ keys (the module’s one table)', () => {
  it('names exactly the commands the page knows, each on both platforms', () => {
    expect(Object.keys(table).sort()).toEqual([...EDITOR_KEYED_COMMANDS].sort());
    for (const command of EDITOR_KEYED_COMMANDS) {
      expect(editorKeyOf(command, true).mod).toBe(true);
      expect(editorKeyOf(command, false).mod).toBe(true);
    }
  });

  it('reads gpui’s notation as a page’s chord', () => {
    expect(parseEditorKey('cmd-shift-z')).toEqual({ key: 'z', mod: true, shift: true });
    expect(parseEditorKey('ctrl-y')).toEqual({ key: 'y', mod: true, shift: false });
    expect(parseEditorKey('cmd-[')).toEqual({ key: '[', mod: true, shift: false });
    expect(editorKeyOf('redo', true)).toEqual({ key: 'z', mod: true, shift: true });
    expect(editorKeyOf('redo', false)).toEqual({ key: 'y', mod: true, shift: false });
    expect(editorKeyOf('find', false)).toEqual({ key: 'f', mod: true, shift: false });
  });
});
