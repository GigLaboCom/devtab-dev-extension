/**
 * The start page's `detectColor` (docs/tools/specs/color.md §7), in a module of its own: the tool's `./detect` takes
 * only this and the syntax check, never the colour library — every tool's `detect` loads together when pasted text
 * needs them. Strict: `#` with 3, 4, 6 or 8 hex digits, or one colour function with valid arguments. A name (`red`)
 * and hex without `#` (`ff8800`, `deadbeef`) are words and hex strings of other tools, not colours here.
 */
import { isColorFunction } from './syntax';

/** The longest colour the tool reads (§5.1). */
export const MAX_INPUT = 200;

const HASH_HEX = /^#(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Does pasted text look like this tool's input (§7)? Agrees with `parseColor` on everything it recognises. */
export const detectColor = (text: string): boolean => {
  const t = text.trim();
  if (t === '' || t.length > MAX_INPUT) return false;
  if (t.startsWith('#')) return HASH_HEX.test(t);
  return isColorFunction(t.toLowerCase());
};
