/**
 * Decoding: the HTML tokenizer's character reference states (HTML Standard §13.2.5: character reference, named
 * character reference, ambiguous ampersand, numeric character reference with its hexadecimal and decimal states, and
 * numeric character reference end) applied to plain text, with the input stream's newline normalisation (§13.2.3.5). Pure: no DOM, the table of names is a parameter (table.ts). Every
 * other character stays as it is — U+0000 included (docs/tools/specs/html-entities.md §5, «Раскодирование» 8).
 *
 * Linear in the input: one native search for the next `&` or CR, and at each `&` at most 32 characters of a name are
 * looked at (the longest name has 31) before the scan moves on.
 */
import { MAX_UNKNOWN_CHECKED } from './limits.ts';
import type { ReferenceTable } from './table.ts';

/**
 * Where the decoded text stands. `text` — text of a page (the tool's Decode). `attribute` — an attribute value, where a
 * name without its semicolon followed by `=` or a letter or digit is not decoded (`?a=1&copy=2` keeps `&copy`).
 */
export type DecodeContext = 'text' | 'attribute';

export interface DecodeOptions {
  /** `text` when absent. */
  context?: DecodeContext;
}

export interface DecodeResult {
  text: string;
  /** Distinct `&name;` pieces the table does not know, in order of first appearance (§5); at most MAX_UNKNOWN_CHECKED. */
  unknown: string[];
}

/** Numeric character reference end state: what a numeric reference to 0x80–0x9F stands for — the Windows-1252 reading; absent ones stay. */
const C1_REPLACEMENTS: Readonly<Record<number, number>> = {
  0x80: 0x20ac,
  0x82: 0x201a,
  0x83: 0x0192,
  0x84: 0x201e,
  0x85: 0x2026,
  0x86: 0x2020,
  0x87: 0x2021,
  0x88: 0x02c6,
  0x89: 0x2030,
  0x8a: 0x0160,
  0x8b: 0x2039,
  0x8c: 0x0152,
  0x8e: 0x017d,
  0x91: 0x2018,
  0x92: 0x2019,
  0x93: 0x201c,
  0x94: 0x201d,
  0x95: 0x2022,
  0x96: 0x2013,
  0x97: 0x2014,
  0x98: 0x02dc,
  0x99: 0x2122,
  0x9a: 0x0161,
  0x9b: 0x203a,
  0x9c: 0x0153,
  0x9e: 0x017e,
  0x9f: 0x0178,
};

/** The longest name of the table, without `&` and `;` (CounterClockwiseContourIntegral). */
const LONGEST_NAME = 31;

const isDigit = (c: number): boolean => c >= 0x30 && c <= 0x39;
const isLetter = (c: number): boolean => (c >= 0x41 && c <= 0x5a) || (c >= 0x61 && c <= 0x7a);
const isAlphanumeric = (c: number): boolean => isDigit(c) || isLetter(c);
const hexValue = (c: number): number =>
  isDigit(c) ? c - 0x30 : c >= 0x41 && c <= 0x46 ? c - 0x37 : c >= 0x61 && c <= 0x66 ? c - 0x57 : -1;

const SEMICOLON = 0x3b;
const EQUALS = 0x3d;
const HASH = 0x23;

/** The numeric character reference end state: what a number stands for. */
const numericValue = (n: number): string => {
  if (n === 0 || n > 0x10ffff || (n >= 0xd800 && n <= 0xdfff)) return '�';
  return String.fromCodePoint(C1_REPLACEMENTS[n] ?? n);
};

interface Reference {
  /** Index just past the reference. */
  end: number;
  value: string;
}

/**
 * The reference that starts at `p`, just after an `&`, or null when the characters there stay as they are. `onUnknown`
 * hears a `&name;` the table does not know (with its index range).
 */
const referenceAt = (
  text: string,
  p: number,
  table: ReferenceTable,
  attribute: boolean,
  onUnknown?: (start: number, end: number) => void,
): Reference | null => {
  const c = text.charCodeAt(p);
  if (c === HASH) {
    let q = p + 1;
    const hex = text.charCodeAt(q) === 0x78 || text.charCodeAt(q) === 0x58; // x X
    if (hex) q++;
    const digits = q;
    let n = 0;
    for (;;) {
      const d = hex ? hexValue(text.charCodeAt(q)) : isDigit(text.charCodeAt(q)) ? text.charCodeAt(q) - 0x30 : -1;
      if (d < 0) break;
      // Past U+10FFFF the value only has to stay past it (numeric end state); capping keeps it a small integer.
      if (n <= 0x10ffff) n = n * (hex ? 16 : 10) + d;
      q++;
    }
    if (q === digits) return null; // `&#` or `&#x` with no digit: absence-of-digits, left as is
    if (text.charCodeAt(q) === SEMICOLON) q++;
    return { end: q, value: numericValue(n) };
  }
  if (!isAlphanumeric(c)) return null;
  // The name: as many letters and digits as a name of the table can have, and one more to know if it is longer.
  let k = p + 1;
  while (k <= p + LONGEST_NAME && isAlphanumeric(text.charCodeAt(k))) k++;
  if (k - p <= LONGEST_NAME && text.charCodeAt(k) === SEMICOLON) {
    const value = table.get(text.slice(p, k + 1));
    if (value !== undefined) return { end: k + 1, value };
  }
  // A name without its semicolon: the longest prefix that is a legacy name (`&notit;` reads `&not` then `it;`).
  for (let len = Math.min(k - p, LONGEST_NAME); len > 0; len--) {
    const value = table.get(text.slice(p, p + len));
    if (value === undefined) continue;
    const next = text.charCodeAt(p + len);
    // Named character reference state: in an attribute value, before `=` or a letter or digit, it is not a reference.
    if (attribute && (next === EQUALS || isAlphanumeric(next))) break;
    return { end: p + len, value };
  }
  if (onUnknown && isLetter(c)) {
    let end = k;
    while (isAlphanumeric(text.charCodeAt(end))) end++;
    if (text.charCodeAt(end) === SEMICOLON) onUnknown(p - 1, end + 1);
  }
  return null;
};

const NEXT = /[&\r]/g;

/**
 * Decodes every character reference the way the HTML tokenizer does in `context` (text of a page by default), turns
 * CR and CR LF into LF, and lists the `&name;` pieces the table does not know.
 */
export const decodeHtml = (text: string, table: ReferenceTable, options: DecodeOptions = {}): DecodeResult => {
  const attribute = options.context === 'attribute';
  const unknown: string[] = [];
  const seen = new Set<string>();
  const onUnknown = (start: number, end: number): void => {
    if (seen.size >= MAX_UNKNOWN_CHECKED) return;
    const piece = text.slice(start, end);
    if (seen.has(piece)) return;
    seen.add(piece);
    unknown.push(piece);
  };
  const parts: string[] = [];
  let last = 0;
  const next = new RegExp(NEXT.source, 'g');
  for (let m = next.exec(text); m !== null; m = next.exec(text)) {
    const at = m.index;
    if (text.charCodeAt(at) === 0x0d) {
      parts.push(text.slice(last, at), '\n');
      last = text.charCodeAt(at + 1) === 0x0a ? at + 2 : at + 1;
      next.lastIndex = last;
      continue;
    }
    const ref = referenceAt(text, at + 1, table, attribute, onUnknown);
    if (ref === null) continue;
    parts.push(text.slice(last, at), ref.value);
    last = ref.end;
    next.lastIndex = last;
  }
  if (last === 0) return { text, unknown };
  parts.push(text.slice(last));
  return { text: parts.join(''), unknown };
};

/**
 * Is there at least one reference in `text` that decoding would turn into something else (§5, «containsReferences»)?
 * `Tom &amp; Jerry` and `&copy 2024` — yes; `AT&T` — no. Stops at the first one.
 */
export const containsReferences = (text: string, table: ReferenceTable): boolean => {
  for (let at = text.indexOf('&'); at !== -1; at = text.indexOf('&', at + 1))
    if (referenceAt(text, at + 1, table, false) !== null) return true;
  return false;
};

/** Does `text` contain an `&` followed by a letter — a place where a name may stand, so the table is needed? */
export const mayContainNames = (text: string): boolean => {
  for (let at = text.indexOf('&'); at !== -1; at = text.indexOf('&', at + 1))
    if (isLetter(text.charCodeAt(at + 1))) return true;
  return false;
};
