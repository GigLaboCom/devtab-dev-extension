/**
 * Encoding (docs/tools/specs/html-entities.md §5, «Кодирование»): the input is text, not HTML. `& < > " '` always
 * become references — enough for text and for an attribute value in either quotes; with scope `nonAscii` every code
 * point above U+007F becomes a numeric reference too, one per code point (never two halves of a surrogate pair). C1
 * controls stay (a reference to them reads as Windows-1252), a lone surrogate becomes U+FFFD's reference, and no name
 * other than the five is ever written: a character often has several, and a number is read by HTML and XML alike.
 */

export type EncodeScope = 'special' | 'nonAscii';
export type NumericFormat = 'decimal' | 'hex';

export interface EncodeOptions {
  scope: EncodeScope;
  format: NumericFormat;
}

export interface EncodeResult {
  text: string;
  /** C1 controls (U+0080–U+009F) left as is under scope 'nonAscii'. */
  keptC1: number;
}

/** §5.1: `'` as `&#39;`, not `&apos;` — HTML 4 has no `&apos;`; every HTML and XML reads `&#39;`. */
const SPECIAL: Readonly<Record<string, string>> = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
};

const SPECIAL_CHARS = /[&<>"']/g;

/** §5.2: `&#233;` or `&#xE9;` — no leading zeros, hexadecimal in capitals. */
const numeric = (codePoint: number, format: NumericFormat): string =>
  format === 'hex' ? `&#x${codePoint.toString(16).toUpperCase()};` : `&#${codePoint};`;

export const encodeHtml = (text: string, options: EncodeOptions): EncodeResult => {
  if (options.scope === 'special') return { text: text.replace(SPECIAL_CHARS, c => SPECIAL[c]!), keptC1: 0 };
  const parts: string[] = [];
  let keptC1 = 0;
  let last = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) {
      const special = c === 0x26 || c === 0x3c || c === 0x3e || c === 0x22 || c === 0x27;
      if (!special) continue;
      parts.push(text.slice(last, i), SPECIAL[text[i]!]!);
      last = i + 1;
      continue;
    }
    if (c <= 0x9f) {
      keptC1++; // §5.3: left as is
      continue;
    }
    let codePoint = c;
    let width = 1;
    if (c >= 0xd800 && c <= 0xdbff) {
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        codePoint = (c - 0xd800) * 0x400 + (low - 0xdc00) + 0x10000;
        width = 2;
      } else codePoint = 0xfffd; // §5.4: a lone high surrogate
    } else if (c >= 0xdc00 && c <= 0xdfff) codePoint = 0xfffd; // a lone low surrogate
    parts.push(text.slice(last, i), numeric(codePoint, options.format));
    i += width - 1;
    last = i + 1;
  }
  if (last === 0) return { text, keptC1 };
  parts.push(text.slice(last));
  return { text: parts.join(''), keptC1 };
};
