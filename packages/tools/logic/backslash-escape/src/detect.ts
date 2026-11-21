/**
 * `detectBackslashEscape` (docs/tools/specs/backslash-escape.md §7) in a module of its own: the ui package's `./detect`
 * re-exports it, and a host loads every tool's `detect` together, lazily, when pasted text needs them. Cheap and strict:
 * a length check first, then one anchored expression without nested repetition and one walk from backslash to backslash.
 */

const MAX_DETECT = 65_536;

/** A Windows path: a drive (`C:\`) or a network name (`\\server`, `\\server\share`). */
const WINDOWS_PATH = /^(?:[A-Za-z]:\\|\\\\[^\\\s"'/]+(?:\\|$))/;

const isHexUnit = (unit: number): boolean =>
  (unit >= 0x30 && unit <= 0x39) || ((unit | 0x20) >= 0x61 && (unit | 0x20) <= 0x66);

/**
 * Does pasted text look like the contents of an escaped string (§7)? One line of 1 to 65,536 characters, not JSON, not
 * a Windows path, with at least two of `\n`, `\r`, `\t`, `\"`, `\\`, `\uXXXX` — one is too weak a sign, and the
 * escapes of regular expressions (`\d`, `\s`, `\w`) do not count.
 */
export const detectBackslashEscape = (text: string): boolean => {
  const t = text.trim();
  if (t.length === 0 || t.length > MAX_DETECT) return false;
  if (t.includes('\n') || t.includes('\r')) return false;
  if (t[0] === '{' || t[0] === '[' || WINDOWS_PATH.test(t)) return false;
  let found = 0;
  for (let i = t.indexOf('\\'); i !== -1 && i + 1 < t.length; i = t.indexOf('\\', i)) {
    const next = t[i + 1];
    if (next === 'n' || next === 'r' || next === 't' || next === '"' || next === '\\') {
      found++;
      i += 2;
    } else if (
      next === 'u' &&
      i + 5 < t.length &&
      isHexUnit(t.charCodeAt(i + 2)) &&
      isHexUnit(t.charCodeAt(i + 3)) &&
      isHexUnit(t.charCodeAt(i + 4)) &&
      isHexUnit(t.charCodeAt(i + 5))
    ) {
      found++;
      i += 6;
    } else i += 2;
    if (found >= 2) return true;
  }
  return false;
};
