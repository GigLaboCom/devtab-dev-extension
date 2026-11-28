/**
 * An `.editorconfig` file read line by line (specification 0.17.2, "File Format"; docs/research/editor-settings.md
 * §2.1, §3.4) — our own small parser, no dependency:
 *
 *   - each line is trimmed; a blank line, and a line starting with `#` or `;`, is nothing (a `#` or `;` later in a line
 *     is part of the value: no inline comments);
 *   - `[name]` starts a section (its name a glob, ./glob.ts); `key = value` splits at the first `=`, both trimmed; the
 *     key is lower-cased, and so is the value of a property the specification defines (its values are not
 *     case-sensitive) and the word `unset`; any other line is invalid and skipped;
 *   - before the first section (the preamble) only `root` means anything.
 *
 * Limits against a hostile file (§3.4): a file larger than `FILE_MAX_BYTES`, with more than `SECTIONS_MAX` sections or
 * more than `LINES_MAX` lines is over the limits as a whole (`ok: false` — the caller uses none of it); a section name
 * longer than `NAME_MAX`, a key longer than `KEY_MAX` or a value longer than `VALUE_MAX` (the specification's minimums)
 * skips that line — a skipped section's pairs then belong to no section.
 */
import { compileGlob } from './glob';
import type { Glob } from './glob';

export const FILE_MAX_BYTES = 65_536;
export const SECTIONS_MAX = 1000;
export const LINES_MAX = 10_000;
export const NAME_MAX = 1024;
export const KEY_MAX = 1024;
export const VALUE_MAX = 4096;

/** The properties the specification defines: their values are read without case. */
const KNOWN = new Set([
  'indent_style',
  'indent_size',
  'tab_width',
  'end_of_line',
  'charset',
  'trim_trailing_whitespace',
  'insert_final_newline',
  'root',
  'max_line_length',
]);

export interface EditorConfigSection {
  /** The section's glob as written. */
  readonly name: string;
  readonly glob: Glob;
  /** Its pairs in order: key (lower-case) and value. */
  readonly pairs: ReadonlyArray<readonly [string, string]>;
}

export interface EditorConfigFile {
  /** `root = true` in the preamble: no file above this one is read. */
  readonly root: boolean;
  readonly sections: readonly EditorConfigSection[];
}

export type ParseResult =
  { ok: true; file: EditorConfigFile } | { ok: false; problem: 'too-large' | 'too-many-sections' | 'too-many-lines' };

/** The file's size in UTF-8 bytes, counted only as far as the limit. */
const tooLarge = (text: string): boolean =>
  text.length > FILE_MAX_BYTES ||
  (text.length * 3 > FILE_MAX_BYTES && new TextEncoder().encode(text).length > FILE_MAX_BYTES);

export const parseEditorConfig = (input: string): ParseResult => {
  if (tooLarge(input)) return { ok: false, problem: 'too-large' };
  const text = input.startsWith('\ufeff') ? input.slice(1) : input;
  const lines = text.split(/\r\n|\n|\r/);
  if (lines.length > LINES_MAX) return { ok: false, problem: 'too-many-lines' };
  let root = false;
  const sections: Array<{ name: string; glob: Glob; pairs: Array<[string, string]> }> = [];
  // The section the next pairs belong to; null in the preamble, undefined after a section that was skipped.
  let section: { pairs: Array<[string, string]> } | null | undefined = null;
  for (const raw of lines) {
    const line = raw.trim();
    if (!line || line.startsWith('#') || line.startsWith(';')) continue;
    if (line.startsWith('[') && line.endsWith(']')) {
      const name = line.slice(1, -1);
      if (name.length > NAME_MAX) {
        section = undefined;
        continue;
      }
      if (sections.length >= SECTIONS_MAX) return { ok: false, problem: 'too-many-sections' };
      const made = { name, glob: compileGlob(name), pairs: [] as Array<[string, string]> };
      sections.push(made);
      section = made;
      continue;
    }
    const eq = line.indexOf('=');
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim().toLowerCase();
    let value = line.slice(eq + 1).trim();
    if (!key || key.length > KEY_MAX || value.length > VALUE_MAX) continue;
    if (KNOWN.has(key) || value.toLowerCase() === 'unset') value = value.toLowerCase();
    if (section === null) {
      if (key === 'root') root = value === 'true';
    } else if (section) section.pairs.push([key, value]);
  }
  return { ok: true, file: { root, sections } };
};
