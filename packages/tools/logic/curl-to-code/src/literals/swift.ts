/**
 * Swift literals (The Swift Programming Language, «Strings and Characters» → «Special Characters in String Literals»,
 * and the Lexical Structure reference, «String Literals»). Double quotes with `\0 \\ \t \n \r \"` and `\u{n}` for
 * everything else that needs an escape; a backslash of the text is `\\`, so `\(` can never start an interpolation.
 * A Swift string holds Unicode scalars: an unpaired surrogate is U+FFFD. Bytes: `Data([0x…])`.
 */
import { needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  0: '\\0',
  9: '\\t',
  10: '\\n',
  13: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

export const swiftString = (text: string): string => {
  if (!needsEscape(text)) return `"${text}"`;
  return `"${write(text, specialOf('"\\'), (cp, lone) => (lone ? '\\u{FFFD}' : (SHORT[cp] ?? `\\u{${cp.toString(16).toUpperCase()}}`)))}"`;
};

export const swiftBytes = (bytes: Uint8Array): string =>
  `Data([${Array.from(bytes, b => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`).join(', ')}])`;
