/**
 * `detectHex` (docs/tools/specs/hex-ascii.md §7) in a module of its own: the ui package's `./detect` re-exports it, and a
 * host loads every tool's `detect` together, lazily, when pasted text needs them. It needs the tool's reader of hex and
 * strict UTF-8, nothing of the formatting.
 */
import { hexValue, isSpace, parseHex } from './parse';

/** §7 rule 1. */
export const MAX_DETECT = 65_536;

/** Control characters other than TAB, LF and CR. */
const CONTROL = /[^\P{Cc}\t\n\r]/u;
const LETTER = /\p{L}/u;

/** `\s` and `,` `:` `;` `-`: the separators §7 allows between pairs (no brackets: a bare paste, not a C declaration). */
const isDetectSeparator = (c: number): boolean => isSpace(c) || c === 0x2c || c === 0x3a || c === 0x3b || c === 0x2d;

/**
 * §7 rule 2, one pass: groups of hex-digit pairs, each optionally after `0x`, or `\x` entries of pairs in a row; groups
 * are divided by runs of separators, with none at the ends (the text is trimmed before).
 */
const hasShape = (t: string): boolean => {
  let i = 0;
  const n = t.length;
  while (i < n) {
    if (t.charCodeAt(i) === 0x5c) {
      // `\x` + pairs, repeated without separators.
      while (i < n && t.charCodeAt(i) === 0x5c) {
        const x = t.charCodeAt(i + 1);
        if (x !== 0x78 && x !== 0x58) return false;
        i += 2;
        const start = i;
        while (i < n && hexValue(t.charCodeAt(i)) >= 0) i++;
        if (i === start || (i - start) % 2 !== 0) return false;
      }
    } else {
      if (t.charCodeAt(i) === 0x30 && (t.charCodeAt(i + 1) === 0x78 || t.charCodeAt(i + 1) === 0x58)) i += 2;
      const start = i;
      while (i < n && hexValue(t.charCodeAt(i)) >= 0) i++;
      if (i === start || (i - start) % 2 !== 0) return false;
    }
    if (i === n) return true;
    if (!isDetectSeparator(t.charCodeAt(i))) return false;
    while (i < n && isDetectSeparator(t.charCodeAt(i))) i++;
  }
  return false;
};

/**
 * Does pasted text look like hex of readable text (§7)? Length first, then the shape in one pass, then the bytes: at
 * least four, strict UTF-8, no control characters but TAB, LF and CR, at least one letter. Hashes, UUIDs without
 * hyphens and random numbers fail the last rule; hex of binary data is not recognised, on purpose.
 */
export const detectHex = (text: string): boolean => {
  const t = text.trim();
  if (t.length < 8 || t.length > MAX_DETECT || !hasShape(t)) return false;
  const parsed = parseHex(t);
  if (!parsed.ok || parsed.bytes.length < 4) return false;
  let decoded: string;
  try {
    decoded = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(parsed.bytes);
  } catch {
    return false;
  }
  return !CONTROL.test(decoded) && LETTER.test(decoded);
};
