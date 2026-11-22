/**
 * JavaScript literals (ECMA-262 §12.9.4 «String Literals»; backslash-escape.md, JavaScript dialect): single quotes,
 * `\'` `\\`, `\0` (`\x00` before a digit: `\01` would be a legacy octal escape), `\b \t \n \v \f \r`, `\xHH` for other
 * controls, DEL and C1, `\uXXXX` for the line separators, the bidi controls, the BOM and an unpaired surrogate. `${` and
 * backticks need nothing in single quotes.
 */
import { hex2, hex4, needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = { 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' };

export const jsString = (text: string): string => {
  if (!needsEscape(text)) return `'${text}'`;
  return `'${write(text, specialOf("'\\"), (cp, lone, next) => {
    if (lone || cp > 0xff) return `\\u${hex4(cp).toUpperCase()}`;
    if (cp === 0x27) return "\\'";
    if (cp === 0x5c) return '\\\\';
    if (cp === 0) return next >= 0x30 && next <= 0x39 ? '\\x00' : '\\0';
    return SHORT[cp] ?? `\\x${hex2(cp).toUpperCase()}`;
  })}'`;
};

/** A Uint8Array of the bytes. */
export const jsBytes = (bytes: Uint8Array): string =>
  `new Uint8Array([${Array.from(bytes, b => `0x${hex2(b)}`).join(', ')}])`;

/** The UTF-8 bytes of a text as Latin-1 characters — what fetch and Node send for a header value is its bytes. */
export const jsLatin1 = (text: string): string => {
  let latin1 = '';
  for (const b of new TextEncoder().encode(text)) latin1 += String.fromCharCode(b);
  return jsString(latin1).replace(/[\x80-\xff]/g, c => `\\x${hex2(c.charCodeAt(0)).toUpperCase()}`);
};
