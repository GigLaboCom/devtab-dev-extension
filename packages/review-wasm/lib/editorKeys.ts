/**
 * The keys of the editor's own commands — the module's one table (crates/review-view/src/editor_keys.json), read here
 * so a tooltip names the key the module actually binds. In gpui's notation (`cmd-shift-z`): on a Mac the module binds
 * the `mac` column itself (gpui-kit is never compiled for macOS in a browser), elsewhere gpui-kit binds the `other`
 * one; Paste's key is the browser's own paste on both. The view's tests check that each key resolves to its command.
 */
import table from '../../../crates/review-view/src/editor_keys.json';
import type { EditorCommand } from './types';

/** A command of the table: the editor's commands and Paste. */
export type KeyedCommand = EditorCommand | 'paste';

/** A key as a page's shortcut is shown: a letter or symbol, with the platform's command modifier and Shift. */
export interface EditorKey {
  key: string;
  mod: boolean;
  shift: boolean;
}

const COMMANDS: readonly KeyedCommand[] = [
  'undo',
  'redo',
  'cut',
  'copy',
  'paste',
  'selectAll',
  'indent',
  'outdent',
  'find',
];

/** `cmd-shift-z` → ⌘ (or Ctrl), Shift, `z`. Only the command modifier and Shift occur in the table. */
export const parseEditorKey = (source: string): EditorKey => {
  const parts = source.split('-');
  // A key that is itself `-` would leave an empty last part; the table has none, and this keeps it whole.
  const key = parts.pop() || '-';
  return { key, mod: parts.includes('cmd') || parts.includes('ctrl'), shift: parts.includes('shift') };
};

/** The key of a command on this platform (`mac`), as the module binds it. */
export const editorKeyOf = (command: KeyedCommand, mac: boolean): EditorKey => {
  const entry = (table as Record<string, { mac: string; other: string }>)[command];
  if (!entry) throw new Error(`the editor's key table has no ${command}`);
  return parseEditorKey(mac ? entry.mac : entry.other);
};

/** Every command of the table, in the order a toolbar shows them. */
export const EDITOR_KEYED_COMMANDS = COMMANDS;
