/**
 * Words of a POSIX shell command line (IEEE Std 1003.1-2024, Shell Command Language: §2.2.2 «Single-Quotes», §2.2.4
 * «Dollar-Single-Quotes»), for the command-line clients (HTTPie, wget). A text without invisible characters is in
 * single quotes, where nothing is special and a quote is written `'\''` (end, an escaped quote, start again).
 * Otherwise `$'…'`, where `\\` and `\'` are escapes and every invisible character is its UTF-8 bytes as `\xHH` (two
 * hex digits; bash, zsh and ksh read `$'…'` too). A command-line argument cannot hold NUL: `shellWord` gives null, and
 * the writer says what it left out. An unpaired surrogate is U+FFFD.
 */
import { hasInvisible, hex2, specialOf, write } from './common';

const utf8 = new TextEncoder();

export const shellWord = (text: string): string | null => {
  if (text.includes('\0')) return null;
  if (!hasInvisible(text)) return `'${text.replaceAll("'", "'\\''")}'`;
  return `$'${write(text, specialOf("'\\"), (cp, lone) => {
    if (lone) return '\\xef\\xbf\\xbd';
    if (cp === 0x27) return "\\'";
    if (cp === 0x5c) return '\\\\';
    if (cp < 0x80) return `\\x${hex2(cp)}`;
    return Array.from(utf8.encode(String.fromCharCode(cp)), b => `\\x${hex2(b)}`).join('');
  })}'`;
};

/** Bytes as one `$'…'` word (`\xHH` for every byte that is not printable ASCII), or null when they hold a NUL. */
export const shellBytes = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) return null;
  let out = '';
  for (const b of bytes) {
    if (b === 0x27) out += "\\'";
    else if (b === 0x5c) out += '\\\\';
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${hex2(b)}`;
  }
  return `$'${out}'`;
};

/**
 * A `printf` format that prints exactly these bytes (POSIX `printf`: `\ddd` is one to three octal digits, `%%` a
 * percent sign, `\\` a backslash), already a shell word.
 */
export const printfFormat = (bytes: Uint8Array): string => {
  let out = '';
  for (const b of bytes) {
    if (b === 0x25) out += '%%';
    else if (b === 0x5c) out += '\\\\';
    else if (b === 0x27) out += "'\\''";
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\${b.toString(8).padStart(3, '0')}`;
  }
  return `'${out}'`;
};
