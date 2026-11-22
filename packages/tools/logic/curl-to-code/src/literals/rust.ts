/**
 * Rust literals (The Rust Reference, «Tokens», string and raw string literals): a raw string `r#"…"#` (the fewest `#`
 * that the text does not close) when the text has `"` or `\` and no invisible character other than \t and \n;
 * otherwise double quotes with `\\ \" \n \r \t \0` and `\u{…}`. Rust refuses the bidi controls in any literal, so they
 * are always escapes. Bytes: `b"…"`.
 */
import { byteLiteral, isInvisible, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  0: '\\0',
  9: '\\t',
  10: '\\n',
  13: '\\r',
  0x22: '\\"',
  0x5c: '\\\\',
};

export const rustString = (text: string): string => {
  const special = (u: number): boolean => (isInvisible(u) && u !== 9 && u !== 10) || (u >= 0xd800 && u <= 0xdfff);
  const fitsRaw = !write(text, special, () => '\0').includes('\0') && !text.includes('\0');
  if (/["\\]/.test(text) && fitsRaw) {
    let hashes = '';
    while (text.includes(`"${hashes}`)) hashes += '#';
    return `r${hashes}"${text}"${hashes}`;
  }
  return `"${write(text, specialOf('"\\'), (cp, lone) => (lone ? '\\u{fffd}' : (SHORT[cp] ?? `\\u{${cp.toString(16)}}`)))}"`;
};

export const rustBytes = (bytes: Uint8Array): string => `b"${byteLiteral(bytes, SHORT)}"`;
