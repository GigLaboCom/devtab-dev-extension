/**
 * PHP literals (PHP Manual, «Strings»: «Single quoted», «Double quoted»). A text without invisible characters is in
 * single quotes, where only `\'` and `\\` are escapes (every backslash of the text is doubled, so none can pair with
 * the next character). Otherwise double quotes, where `$` and `{$` would interpolate: `\\ \" \$`, `\n \r \t`, `\xHH`
 * for other ASCII controls and DEL (`\x` takes at most two hex digits), `\u{…}` for C1, the line separators, the bidi
 * controls and the BOM (PHP 7.0+); an unpaired surrogate, which a PHP string of UTF-8 bytes cannot hold, is U+FFFD.
 * Bytes: double quotes with `\xHH`.
 */
import { byteLiteral, hasInvisible, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  9: '\\t',
  10: '\\n',
  13: '\\r',
  0x22: '\\"',
  0x24: '\\$',
  0x5c: '\\\\',
};

export const phpString = (text: string): string => {
  if (!hasInvisible(text)) return `'${text.replace(/[\\']/g, c => `\\${c}`)}'`;
  return `"${write(text, specialOf('"\\$'), (cp, lone) => {
    if (lone) return '\\u{fffd}';
    if (cp < 0x80) return SHORT[cp] ?? `\\x${cp.toString(16).padStart(2, '0')}`;
    return `\\u{${cp.toString(16)}}`;
  })}"`;
};

export const phpBytes = (bytes: Uint8Array): string => `"${byteLiteral(bytes, SHORT)}"`;
