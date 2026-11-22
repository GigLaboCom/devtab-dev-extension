/**
 * Java literals (The Java Language Specification, SE 21: §3.10.5 «String Literals», §3.10.7 «Escape Sequences»,
 * §3.3 «Unicode Escapes»). Double quotes with `\\ \" \b \t \n \f \r`; other C0 controls, DEL and C1 as three-digit
 * octal escapes (`\000`–`\377`: an octal escape takes at most three digits, so a digit after it stays a digit).
 * A Unicode escape `\uXXXX` is replaced before the source is even split into tokens (§3.3), so it may never stand for
 * a character that ends or breaks the literal (the quote, the backslash, a line feed); it is used only for U+2028,
 * U+2029, the bidi controls and the BOM, none of which is a line terminator in Java (§3.4). An unpaired surrogate is
 * U+FFFD: javac pairs an escaped high surrogate with the next code unit and then misreads a backslash after it
 * (checked with javac 25: "illegal escape character"), and `getBytes(UTF_8)` would send `?` for it anyway. A backslash of
 * the text is written `\\`, and a `\` preceded by an odd number of backslashes cannot start a Unicode escape (§3.3),
 * so the text's own `\u` stays text. Non-ASCII is written as it is (javac reads UTF-8 by default since JDK 18, JEP 400).
 */
import { hex4, needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  12: '\\f',
  13: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

export const javaString = (text: string): string => {
  if (!needsEscape(text)) return `"${text}"`;
  return `"${write(text, specialOf('"\\'), (cp, lone) => {
    if (lone) return '\\uFFFD';
    if (cp > 0xff) return `\\u${hex4(cp).toUpperCase()}`;
    return SHORT[cp] ?? `\\${cp.toString(8).padStart(3, '0')}`;
  })}"`;
};

/** A byte array: Java's byte is signed, so 0x80–0xFF are written as negative numbers. */
export const javaBytes = (bytes: Uint8Array): string =>
  `new byte[] {${Array.from(bytes, b => ` ${b > 127 ? b - 256 : b}`).join(',')} }`;
