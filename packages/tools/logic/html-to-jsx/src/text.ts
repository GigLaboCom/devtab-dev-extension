/**
 * Writing text and values so that JSX reads them back exactly (docs/tools/specs/html-to-jsx.md §5 «Текст и пробелы»,
 * «Атрибуты» п. 9): JSX text, JSX attribute strings, JavaScript strings and template literals. Every function here
 * escapes everything its context could misread, so no input can end the string, the text or the expression early.
 */

/**
 * What JSX would read as a character reference after an `&`: a decimal or hexadecimal number or a name, each with its
 * semicolon. Such an `&` is written `&amp;`; any other stays as it is (JSX leaves it alone).
 */
const REFERENCE_AFTER = /^(?:#\d+;|#[xX][0-9a-fA-F]+;|[A-Za-z][A-Za-z0-9]*;)/;

/**
 * Characters that JSX compilers treat as whitespace or as a line break although HTML does not: esbuild trims them at the
 * edges of a line of JSX text and turns U+2028 and U+2029 into a line break. They are written as character references,
 * which JSX decodes only after it has trimmed (U+00A0 has its own name, `&nbsp;`).
 */
const isJsOnlySpace = (c: number): boolean =>
  c === 0x0b ||
  c === 0xa0 ||
  c === 0x1680 ||
  (c >= 0x2000 && c <= 0x200a) ||
  c === 0x2028 ||
  c === 0x2029 ||
  c === 0x202f ||
  c === 0x205f ||
  c === 0x3000 ||
  c === 0xfeff;

const reference = (c: string): string =>
  c === '\u{A0}' ? '&nbsp;' : `&#x${c.codePointAt(0)!.toString(16).toUpperCase()};`;

const ampersand = (text: string, at: number): string =>
  REFERENCE_AFTER.test(text.slice(at + 1, at + 34)) ? '&amp;' : '&';

/**
 * JSX text: `{` `}` `<` `>` as expressions (`{'{'}`), an `&` that would start a reference as `&amp;`, U+00A0 as
 * `&nbsp;` and the other characters JSX trims or breaks on as references. The text has already had its HTML
 * whitespace collapsed; everything else (©, Cyrillic, emoji) stays as it is.
 */
export const escapeJsxText = (text: string): string => {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (c === '{' || c === '}' || c === '<' || c === '>') out += `{'${c}'}`;
    else if (c === '&') out += ampersand(text, i);
    else if (isJsOnlySpace(c.charCodeAt(0))) out += reference(c);
    else out += c;
  }
  return out;
};

/** The inside of a JSX attribute string `"…"`: `"` as `&quot;`, an `&` that would start a reference as `&amp;`. */
export const escapeJsxAttribute = (value: string): string => {
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '"') out += '&quot;';
    else if (c === '&') out += ampersand(value, i);
    else out += c;
  }
  return out;
};

/** A JavaScript string in single quotes: `\`, `'`, line breaks (also U+2028, U+2029) escaped. */
export const jsString = (value: string): string => {
  let out = "'";
  for (const c of value) {
    if (c === '\\') out += '\\\\';
    else if (c === "'") out += "\\'";
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\u{2028}') out += '\\u2028';
    else if (c === '\u{2029}') out += '\\u2029';
    else out += c;
  }
  return out + "'";
};

/** A JavaScript template literal holding `value` exactly: `\`, `` ` ``, `${` and a carriage return escaped. */
export const templateLiteral = (value: string): string => {
  let out = '`';
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!;
    if (c === '\\') out += '\\\\';
    else if (c === '`') out += '\\`';
    else if (c === '$' && value[i + 1] === '{') out += '\\$';
    else if (c === '\r') out += '\\r';
    else out += c;
  }
  return out + '`';
};

/** A line break JSX would see inside an attribute string: such a value is written as a JavaScript string instead. */
export const hasLineBreak = (value: string): boolean => /[\n\r\u{2028}\u{2029}]/u.test(value);

/** A JSX comment child: `*\/` inside becomes `* /`, so the text cannot end the comment early. */
export const jsxComment = (text: string): string => `{/*${text.replaceAll('*/', '* /')}*/}`;

/** `1`, `-2`, `0.5` written exactly as JavaScript writes the number (no `007`, `1.50`, `-0` or 21-digit integers). */
export const canonicalNumber = (value: string): number | null => {
  if (!/^-?\d+(?:\.\d+)?$/.test(value)) return null;
  const n = Number(value);
  return String(n) === value ? n : null;
};
