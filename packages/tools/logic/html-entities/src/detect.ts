/**
 * `detectHtmlEntities` (docs/tools/specs/html-entities.md §7) in a module of its own: the ui package's `./detect`
 * re-exports it, and a host loads every tool's `detect` together, lazily, when pasted text needs them. It never loads the
 * table of names (table.ts): numbers decode by rule, and names are looked up in a short list of names only — the 106
 * that also work without a semicolon and the rest of HTML 4.01's (detectNames.generated.ts, about 2 KB). A text whose
 * only references are names HTML 4 did not have (`&NotEqualTilde;`) is decoded by the tool but not recognised here.
 */
import { COMMON, LEGACY } from './detectNames.generated.ts';

/** §7.1: longer pasted text is not looked at. */
const MAX_DETECT = 65_536;
/** §7.2: markup — `<` before a letter, `!` or `/`. */
const MARKUP = /<[A-Za-z!/]/;
/** §7.3: a reference with its semicolon; bounded repetitions, so the search stays linear. */
const REFERENCE = /&(?:#[0-9]{1,7}|#[xX][0-9a-fA-F]{1,6}|([A-Za-z][A-Za-z0-9]{1,31}));/g;

let names: { legacy: ReadonlySet<string>; common: ReadonlySet<string> } | null = null;
const known = (): NonNullable<typeof names> =>
  (names ??= { legacy: new Set(LEGACY.split(' ')), common: new Set(COMMON.split(' ')) });

/** §7.4: does this name decode — a known name, or a word that starts with a legacy name (`&ampx;` reads `&x;`)? */
const decodes = (name: string): boolean => {
  const { legacy, common } = known();
  if (legacy.has(name) || common.has(name)) return true;
  for (let len = Math.min(name.length - 1, 6); len >= 2; len--) if (legacy.has(name.slice(0, len))) return true;
  return false;
};

/**
 * Does pasted text look like text with HTML references (§7)? After trimming: at most 64 Ki, no markup, and at least
 * one reference with its semicolon that decodes — a number, or a name of the list above. `AT&T`, `&copy 2024`, a URL
 * with a query and `&unknown;` are not recognised.
 */
export const detectHtmlEntities = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_DETECT || !t.includes('&') || MARKUP.test(t)) return false;
  const reference = new RegExp(REFERENCE.source, 'g');
  for (let m = reference.exec(t); m !== null; m = reference.exec(t))
    if (m[1] === undefined || decodes(m[1])) return true;
  return false;
};
