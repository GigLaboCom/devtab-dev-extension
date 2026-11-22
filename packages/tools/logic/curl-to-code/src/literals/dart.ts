/**
 * Dart literals (Dart Programming Language Specification, 6th edition draft: §17.7 «Strings», the escape sequences
 * `\n \r \f \b \t \v`, `\xHH` — exactly two hex digits —, `\uXXXX`, `\u{…}`, and `\k` for any other `k`; §17.7.1
 * «String Interpolation»: `$name` and `${…}`). Single quotes; `\\ \' \$` (every `$` is escaped, so nothing of the text
 * interpolates), `\xHH` for other controls, DEL and C1, `\u{…}` for the line separators, the bidi controls and the BOM.
 * An unpaired surrogate is U+FFFD: `utf8.encode` would send U+FFFD for it anyway. Bytes: a `List<int>`.
 */
import { hex2, needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
  0x24: '\\$',
  0x27: "\\'",
  0x5c: '\\\\',
};

export const dartString = (text: string): string => {
  if (!needsEscape(text) && !text.includes('$')) return `'${text}'`;
  return `'${write(text, specialOf("'\\$"), (cp, lone) => {
    if (lone) return '\\u{FFFD}';
    if (cp <= 0xff) return SHORT[cp] ?? `\\x${hex2(cp).toUpperCase()}`;
    return `\\u{${cp.toString(16).toUpperCase()}}`;
  })}'`;
};

export const dartBytes = (bytes: Uint8Array): string => `[${Array.from(bytes, b => `0x${hex2(b)}`).join(', ')}]`;
