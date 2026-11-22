/**
 * Normalized paths (RFC 9535 §2.7; docs/tools/specs/json-query.md §5 п. 24–25): `$` and, per step, `['name']` or
 * `[index]`. A name is in single quotes; `'` and `\` are escaped, U+0000–U+001F are `\b \f \n \r \t` or `\u00xx`
 * (lowercase hex), everything else is written as it is. A lone surrogate (only `"\ud800"` in a document makes one) has
 * no form in the RFC's grammar: it is written `\ud800` and the path is marked, since it does not parse back.
 */
import type { Located } from './evaluate';

const SHORT: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r', 39: "\\'", 92: '\\\\' };

export interface Quoted {
  text: string;
  /** The name holds a lone surrogate: the path cannot be a query. */
  lone: boolean;
}

/** A member name as a normalized name selector: `'a'`, `'\''`, `'\u000b'`. */
export const quoteName = (name: string): string => quote(name).text;

export const quote = (name: string): Quoted => {
  let text = "'";
  let lone = false;
  let from = 0;
  for (let k = 0; k < name.length; k++) {
    const c = name.charCodeAt(k);
    let escaped: string | undefined;
    if (c < 0x20 || c === 39 || c === 92) escaped = SHORT[c] ?? `\\u00${c.toString(16).padStart(2, '0')}`;
    else if (c >= 0xd800 && c <= 0xdfff) {
      const pair = c <= 0xdbff && name.charCodeAt(k + 1) >= 0xdc00 && name.charCodeAt(k + 1) <= 0xdfff;
      if (pair) {
        k++;
        continue;
      }
      escaped = `\\u${c.toString(16)}`;
      lone = true;
    }
    if (escaped === undefined) continue;
    text += name.slice(from, k) + escaped;
    from = k + 1;
  }
  return { text: `${text}${name.slice(from)}'`, lone };
};

/** The steps of a node's place, from the root. */
const steps = (node: Located): Array<string | number> => {
  const out: Array<string | number> = [];
  for (let at: Located | null = node; at && at.parent; at = at.parent) out.push(at.step);
  return out.reverse();
};

/** The normalized path of a node, and whether it holds a lone surrogate. */
export const writePath = (node: Located): Quoted => {
  let text = '$';
  let lone = false;
  for (const step of steps(node)) {
    if (typeof step === 'number') text += `[${step}]`;
    else {
      const q = quote(step);
      text += `[${q.text}]`;
      lone ||= q.lone;
    }
  }
  return { text, lone };
};

export const normalizedPath = (node: Located): string => writePath(node).text;
