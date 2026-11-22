/**
 * Python literals (The Python Language Reference, §2.4.1 «String and Bytes literals»): single quotes as `repr` writes
 * them — `\'` `\\`, `\t \n \r`, `\xHH` for other controls, DEL and C1, `\uXXXX` above U+00FF; an unpaired surrogate is
 * U+FFFD (a UTF-8 source cannot hold it, and `requests` would fail to encode it). Bytes: `b'…'`.
 */
import { byteLiteral, hex2, hex4, needsEscape, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = { 9: '\\t', 10: '\\n', 13: '\\r' };

export const pyString = (text: string): string => {
  if (!needsEscape(text)) return `'${text}'`;
  return `'${write(text, specialOf("'\\"), (cp, lone) => {
    if (lone) return '\\ufffd';
    if (cp === 0x27) return "\\'";
    if (cp === 0x5c) return '\\\\';
    if (cp > 0xff) return `\\u${hex4(cp)}`;
    return SHORT[cp] ?? `\\x${hex2(cp)}`;
  })}'`;
};

export const pyBytes = (bytes: Uint8Array): string =>
  `b'${byteLiteral(bytes, { ...SHORT, 0x27: "\\'", 0x5c: '\\\\' })}'`;
