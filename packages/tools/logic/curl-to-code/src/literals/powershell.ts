/**
 * PowerShell literals (about_Quoting_Rules, about_Special_Characters; the language specification, §2.3.5.2 «String
 * literals»). PowerShell takes the typographic quotes as quotes too: single-quote characters are U+0027, U+2018,
 * U+2019, U+201A and U+201B; double-quote characters are U+0022, U+201C, U+201D and U+201E.
 *
 * A text without invisible characters is in single quotes, where nothing is special but a single-quote character,
 * written twice (`''`, `’’`). Otherwise double quotes, where `$` interpolates and the backtick escapes: ``` `` ``` for a
 * backtick, a backtick before `$` and before every double-quote character, `` `0 `a `b `e `f `n `r `t `v `` and
 * `` `u{…} `` (PowerShell 6+) for the rest; an unpaired surrogate, which `` `u{} `` refuses, is U+FFFD.
 * Bytes: `[byte[]](0x…, …)`.
 */
import { hasInvisible, specialOf, write } from './common';

const SINGLE = /['\u{2018}\u{2019}\u{201a}\u{201b}]/gu;
const DOUBLE = '"\u{201c}\u{201d}\u{201e}';

const SHORT: Readonly<Record<number, string>> = {
  0: '`0',
  7: '`a',
  8: '`b',
  9: '`t',
  10: '`n',
  11: '`v',
  12: '`f',
  13: '`r',
  27: '`e',
};

export const psString = (text: string): string => {
  if (!hasInvisible(text)) return `'${text.replace(SINGLE, q => q + q)}'`;
  const special = (u: number): boolean => specialOf('`$"')(u) || DOUBLE.includes(String.fromCharCode(u));
  return `"${write(text, special, (cp, lone) => {
    if (lone) return '`u{FFFD}';
    const c = String.fromCharCode(cp);
    if (c === '`' || c === '$' || DOUBLE.includes(c)) return `\`${c}`;
    return SHORT[cp] ?? `\`u{${cp.toString(16).toUpperCase()}}`;
  })}"`;
};

export const psBytes = (bytes: Uint8Array): string =>
  `[byte[]](${Array.from(bytes, b => `0x${b.toString(16).padStart(2, '0').toUpperCase()}`).join(', ')})`;
