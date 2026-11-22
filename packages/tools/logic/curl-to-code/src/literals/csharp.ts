/**
 * C# literals (C# language specification, ECMA-334 7th edition: §6.4.5.6 «String literals», §6.4.5.5 «Character
 * literals» for the simple escapes, §6.4.2 «Unicode character escape sequences»). A regular string literal in double
 * quotes with `\\ \" \0 \a \b \f \n \r \t \v`; everything else that needs an escape is `\uXXXX` (exactly four hex
 * digits — never the variable-length `\x`, which would swallow a hex digit after it). A Unicode escape in a regular
 * string literal is an escape of that literal (unlike Java, not a step before tokens), so the escape of a quote would be a quote of
 * the text; it is still used only for the characters that need it. U+0085, U+2028 and U+2029 are new-line characters
 * in C# (§6.3.2) and may not appear raw in a regular string literal. An unpaired surrogate is U+FFFD — what
 * `Encoding.UTF8` sends for one anyway. Non-ASCII is written as it is.
 */
import { hex4, needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  0: '\\0',
  7: '\\a',
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

export const csharpString = (text: string): string => {
  if (!needsEscape(text)) return `"${text}"`;
  return `"${write(text, specialOf('"\\'), (cp, lone) => (lone ? '\\uFFFD' : (SHORT[cp] ?? `\\u${hex4(cp).toUpperCase()}`)))}"`;
};

/** `new byte[] { … }`: constants 0–255 convert to byte. */
export const csharpBytes = (bytes: Uint8Array): string =>
  `new byte[] { ${Array.from(bytes, b => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`).join(', ')} }`;
