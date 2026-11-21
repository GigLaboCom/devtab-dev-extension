/**
 * `detectYaml` (docs/tools/specs/yaml-json.md §7) in a module of its own: the ui package's `./detect` re-exports
 * it, and a host loads every tool's `detect` together, lazily, when pasted text needs them. The shape of the lines only — no
 * library, no parsing. Nearly any text is YAML, so the rule is strict: at least two structural lines (`key:` or
 * `- item`), every looked-at line one of YAML's line shapes, and nothing that starts like JSON (which is YAML too, and
 * the JSON tool's input).
 */

const MAX_DETECT = 1024 * 1024;
const LINES = 100;

/** `key:` with a plain name (`[A-Za-z_][\w.\-/]*`) or a quoted one, then a space or the end of the line. */
const KEY = /^[ \t]*(?:[A-Za-z_][\w.\-/]*|"[^"\\\n]*"|'[^'\n]*'):(?:[ \t]|$)/;
const ITEM = /^[ \t]*-(?:[ \t]|$)/;
const DOCUMENT_START = /^---(?:[ \t]|$)/;
const DOCUMENT_END = /^\.\.\.[ \t]*$/;
const DIRECTIVE = /^%YAML[ \t]/;
const INDENTED = /^[ \t]+\S/;

/** Does pasted text look like YAML (§7)? */
export const detectYaml = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_DETECT) return false;
  const c = t[0];
  if (c === '{' || c === '[' || c === '"') return false;

  let looked = 0;
  let structural = 0;
  let from = 0;
  while (from <= t.length && looked < LINES) {
    let to = t.indexOf('\n', from);
    if (to === -1) to = t.length;
    const line = t.slice(from, t.charCodeAt(to - 1) === 13 ? to - 1 : to);
    from = to + 1;
    const content = line.trimStart();
    if (content === '' || content.startsWith('#')) continue;
    const key = KEY.test(line);
    const item = ITEM.test(line);
    if (looked === 0) {
      // The first line starts at the left edge (the text is trimmed): a document start, a directive, an item, a key.
      if (!(DOCUMENT_START.test(line) || DIRECTIVE.test(line) || item || key)) return false;
    } else if (!(DOCUMENT_START.test(line) || DOCUMENT_END.test(line) || item || key || INDENTED.test(line)))
      return false;
    if (key || item) structural++;
    looked++;
  }
  return looked >= 2 && structural >= 2;
};
