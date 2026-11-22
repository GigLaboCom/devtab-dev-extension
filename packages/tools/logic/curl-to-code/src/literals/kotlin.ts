/**
 * Kotlin literals (Kotlin language specification, «Syntax and grammar», §1.2.4 «String mode grammar» and «Literals»:
 * the escaped characters `\t \b \r \n \' \" \\ \$` and the Unicode escape `\uXXXX` with exactly four hex digits). A `$`
 * of the text starts a template (`$name`, `${…}`) unless escaped, so every `$` is written `\$`. Kotlin has no `\f`,
 * `\v`, `\0` or `\x`: other controls, DEL, C1, the line separators, the bidi controls and the BOM are `\uXXXX`; an unpaired
 * surrogate is U+FFFD, as in Java (javac misreads what follows an escaped one; Kotlin's own reading is not checked). Non-ASCII is written as it is (Kotlin sources are UTF-8).
 */
import { hex4, specialOf, write } from './common';

const SHORT: Readonly<Record<number, string>> = {
  8: '\\b',
  9: '\\t',
  10: '\\n',
  13: '\\r',
  0x22: '\\"',
  0x24: '\\$',
  0x5c: '\\\\',
};

export const kotlinString = (text: string): string =>
  `"${write(text, specialOf('"\\$'), (cp, lone) => (lone ? '\\uFFFD' : (SHORT[cp] ?? `\\u${hex4(cp).toUpperCase()}`)))}"`;

/** `byteArrayOf(…)`: integer literals that fit a Byte take that type, so 0x80–0xFF are negative numbers. */
export const kotlinBytes = (bytes: Uint8Array): string =>
  `byteArrayOf(${Array.from(bytes, b => String(b > 127 ? b - 256 : b)).join(', ')})`;
