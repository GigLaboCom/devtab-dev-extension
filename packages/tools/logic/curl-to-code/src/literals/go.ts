/**
 * Go literals (The Go Programming Language Specification, «String literals»): a raw string `…` when the text has `"` or
 * `\` and fits one (no backquote, no CR, no invisible character other than \t and \n); otherwise double quotes as
 * strconv.Quote writes them — `\\ \" \a \b \f \n \r \t \v`, `\xHH` for other ASCII controls, `\u00HH` for C1 (a `\x85`
 * would be one byte, not U+0085), non-ASCII as it is. Bytes: an interpreted string holds bytes as they are (`\xff` is
 * the byte 0xFF).
 */
import { byteLiteral, hex2, hex4, isInvisible, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  7: '\\a',
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
};

/** Can a Go raw string hold the text: no backquote, no CR, no invisible character other than \t and \n, no lone half. */
const rawFits = (text: string): boolean =>
  !write(
    text,
    u => u === 0x60 || (isInvisible(u) && u !== 9 && u !== 10),
    () => '\0',
  ).includes('\0') && !/[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''));

export const goString = (text: string): string => {
  if (/["\\]/.test(text) && rawFits(text)) return `\`${text}\``;
  return `"${write(text, specialOf('"\\'), (cp, lone) => {
    if (lone) return '\\ufffd';
    if (cp === 0x22) return '\\"';
    if (cp === 0x5c) return '\\\\';
    if (cp < 0x80) return SHORT[cp] ?? `\\x${hex2(cp)}`;
    return `\\u${hex4(cp)}`;
  })}"`;
};

export const goBytes = (bytes: Uint8Array): string =>
  `"${byteLiteral(bytes, { 9: '\\t', 10: '\\n', 13: '\\r', 0x22: '\\"', 0x5c: '\\\\' })}"`;
