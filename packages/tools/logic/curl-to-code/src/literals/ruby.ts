/**
 * Ruby literals (Ruby documentation, «Literals»: «Strings», «Backslash Notation», «Interpolation»). A text without
 * invisible characters is in single quotes, where only `\\` and `\'` are escapes. Otherwise double quotes, where `#{`,
 * `#$` and `#@` would interpolate: `\\ \" \#`, `\n \r \t`, `\xHH` for other ASCII controls and DEL, `\uXXXX` for C1,
 * the line separators, the bidi controls and the BOM (in a UTF-8 string `\x85` would be a lone byte, not U+0085);
 * an unpaired surrogate, which Ruby refuses in a UTF-8 string, is U+FFFD. Bytes: `"\xHH…".b` (only `\x` escapes, so the
 * literal is bytes and `.b` makes it binary).
 */
import { byteLiteral, hasInvisible, hex4, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  9: '\\t',
  10: '\\n',
  13: '\\r',
  0x22: '\\"',
  0x23: '\\#',
  0x5c: '\\\\',
};

export const rubyString = (text: string): string => {
  if (!hasInvisible(text)) return `'${text.replace(/[\\']/g, c => `\\${c}`)}'`;
  return `"${write(text, specialOf('"\\#'), (cp, lone) => {
    if (lone) return '\\uFFFD';
    if (cp < 0x80) return SHORT[cp] ?? `\\x${cp.toString(16).padStart(2, '0')}`;
    return `\\u${hex4(cp).toUpperCase()}`;
  })}"`;
};

export const rubyBytes = (bytes: Uint8Array): string => `"${byteLiteral(bytes, SHORT)}".b`;
