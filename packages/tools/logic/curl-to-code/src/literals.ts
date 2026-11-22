/**
 * String literals of the four languages (docs/tools/specs/curl-to-code.md §5, «Код»), written by the tool's own rules
 * and checked against the languages themselves (literals.test.ts): whatever the text — quotes, backslashes, line breaks,
 * `${`, backticks, `%`, non-ASCII, U+2028 — the literal reads back as exactly that text and cannot end early.
 *
 * Besides the specification's rules every language escapes the invisible characters that change how code reads or
 * compiles: U+2028 and U+2029 (line terminators in JavaScript), the bidirectional controls U+202A–U+202E and
 * U+2066–U+2069 (Rust refuses them in literals; elsewhere they hide what the code says) and U+FEFF (Go refuses it in a
 * file). An unpaired surrogate, which Go, Rust and Python source cannot hold, becomes U+FFFD there.
 */

const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
const hex4 = (n: number): string => n.toString(16).padStart(4, '0');

/** A character every language writes as an escape: controls, DEL, C1, line separators, bidi controls, the BOM. */
const isInvisible = (cp: number): boolean =>
  cp < 0x20 ||
  (cp >= 0x7f && cp <= 0x9f) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069) ||
  cp === 0xfeff;

/** Does a text need any escape in a quoted literal (an invisible character, a surrogate, a quote, a backslash)? */
const needsEscape = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (isInvisible(u) || (u >= 0xd800 && u <= 0xdfff) || u === 0x22 || u === 0x27 || u === 0x5c) return true;
  }
  return false;
};

/**
 * Walks `text` by code point, writing ordinary runs as they are and each special code point through `escape`
 * (`lone` — an unpaired surrogate).
 */
const write = (
  text: string,
  special: (unit: number) => boolean,
  escape: (cp: number, lone: boolean, next: number) => string,
): string => {
  let out = '';
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdfff) {
      const next = text.charCodeAt(i + 1);
      if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      out += text.slice(run, i) + escape(unit, true, text.charCodeAt(i + 1));
      run = i + 1;
      continue;
    }
    if (!special(unit)) continue;
    out += text.slice(run, i) + escape(unit, false, i + 1 < text.length ? text.charCodeAt(i + 1) : -1);
    run = i + 1;
  }
  return out + text.slice(run);
};

const quoteOrInvisible =
  (quote: number) =>
  (unit: number): boolean =>
    unit === quote || unit === 0x5c || isInvisible(unit);

// ----------------------------------------------------------------------------------------------------------------------

const JS_SHORT: Readonly<Record<number, string>> = { 8: '\\b', 9: '\\t', 10: '\\n', 11: '\\v', 12: '\\f', 13: '\\r' };

/**
 * JavaScript, in single quotes (backslash-escape's JavaScript dialect): `\0` (`\x00` before a digit), the short
 * escapes, `\xHH` for other controls, `\uXXXX` for the line separators, the bidi controls, the BOM and an unpaired
 * surrogate. `${` and backticks need nothing in single quotes.
 */
export const jsString = (text: string): string => {
  if (!needsEscape(text)) return `'${text}'`;
  return `'${write(text, quoteOrInvisible(0x27), (cp, lone, next) => {
    if (lone || cp > 0xff) return `\\u${hex4(cp).toUpperCase()}`;
    if (cp === 0x27) return "\\'";
    if (cp === 0x5c) return '\\\\';
    if (cp === 0) return next >= 0x30 && next <= 0x39 ? '\\x00' : '\\0';
    return JS_SHORT[cp] ?? `\\x${hex2(cp).toUpperCase()}`;
  })}'`;
};

const PY_SHORT: Readonly<Record<number, string>> = { 9: '\\t', 10: '\\n', 13: '\\r' };

/** Python, in single quotes (as repr): `\t \n \r`, `\xHH` for other controls, `\uXXXX` above U+00FF. */
export const pyString = (text: string): string => {
  if (!needsEscape(text)) return `'${text}'`;
  return `'${write(text, quoteOrInvisible(0x27), (cp, lone) => {
    if (lone) return '\\ufffd';
    if (cp === 0x27) return "\\'";
    if (cp === 0x5c) return '\\\\';
    if (cp > 0xff) return `\\u${hex4(cp)}`;
    return PY_SHORT[cp] ?? `\\x${hex2(cp)}`;
  })}'`;
};

const GO_SHORT: Readonly<Record<number, string>> = {
  7: '\\a',
  8: '\\b',
  9: '\\t',
  10: '\\n',
  11: '\\v',
  12: '\\f',
  13: '\\r',
};

/** Can a Go raw string (`…`) hold the text: no backquote, no CR, no invisible character other than \t and \n. */
const goRawFits = (text: string): boolean =>
  !write(
    text,
    u => u === 0x60 || (isInvisible(u) && u !== 9 && u !== 10),
    () => '\0',
  ).includes('\0') && !/[\ud800-\udfff]/.test(text.replace(/[\ud800-\udbff][\udc00-\udfff]/g, ''));

/**
 * Go: a raw string when the text has `"` or `\` and fits one; otherwise double quotes as strconv.Quote writes them
 * (`\\ \" \a \b \f \n \r \t \v`, `\xHH` for other ASCII controls, `\u00HH` for C1 — a `\x85` would be one byte, not
 * U+0085), non-ASCII as it is.
 */
export const goString = (text: string): string => {
  if (/["\\]/.test(text) && goRawFits(text)) return `\`${text}\``;
  return `"${write(text, quoteOrInvisible(0x22), (cp, lone) => {
    if (lone) return '\\ufffd';
    if (cp === 0x22) return '\\"';
    if (cp === 0x5c) return '\\\\';
    if (cp < 0x80) return GO_SHORT[cp] ?? `\\x${hex2(cp)}`;
    return `\\u${hex4(cp)}`;
  })}"`;
};

/**
 * Rust: a raw string `r#"…"#` (the fewest `#` that the text does not close) when the text has `"` or `\` and no
 * invisible character other than \t and \n; otherwise double quotes with `\\ \" \n \r \t \0` and `\u{…}`.
 */
export const rustString = (text: string): string => {
  const special = (u: number): boolean => (isInvisible(u) && u !== 9 && u !== 10) || (u >= 0xd800 && u <= 0xdfff);
  const fitsRaw = !write(text, special, () => '\0').includes('\0') && !text.includes('\0');
  if (/["\\]/.test(text) && fitsRaw) {
    let hashes = '';
    while (text.includes(`"${hashes}`)) hashes += '#';
    return `r${hashes}"${text}"${hashes}`;
  }
  const short: Readonly<Record<number, string>> = {
    0: '\\0',
    9: '\\t',
    10: '\\n',
    13: '\\r',
    0x22: '\\"',
    0x5c: '\\\\',
  };
  return `"${write(text, quoteOrInvisible(0x22), (cp, lone) => (lone ? '\\u{fffd}' : (short[cp] ?? `\\u{${cp.toString(16)}}`)))}"`;
};

// ----------------------------------------------------------------------------------------------------------------------
// Byte strings, for a body that is not UTF-8 text.

const byteLiteral = (bytes: Uint8Array, quote: number, short: Readonly<Record<number, string>>): string => {
  let out = '';
  for (const b of bytes) {
    if (b === quote || b === 0x5c) out += `\\${String.fromCharCode(b)}`;
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += short[b] ?? `\\x${hex2(b)}`;
  }
  return out;
};

/** Python bytes: `b'…'`. */
export const pyBytes = (bytes: Uint8Array): string => `b'${byteLiteral(bytes, 0x27, PY_SHORT)}'`;
/** Go: an interpreted string holds bytes as they are (`\xff` is the byte 0xFF). */
export const goBytes = (bytes: Uint8Array): string =>
  `"${byteLiteral(bytes, 0x22, { 9: '\\t', 10: '\\n', 13: '\\r' })}"`;
/** Rust: a byte string `b"…"`. */
export const rustBytes = (bytes: Uint8Array): string =>
  `b"${byteLiteral(bytes, 0x22, { 0: '\\0', 9: '\\t', 10: '\\n', 13: '\\r' })}"`;
/** JavaScript: a Uint8Array of the bytes. */
export const jsBytes = (bytes: Uint8Array): string =>
  `new Uint8Array([${Array.from(bytes, b => `0x${hex2(b)}`).join(', ')}])`;

/** JavaScript: the UTF-8 bytes of a text as Latin-1 characters — what fetch sends for a header value is its bytes. */
export const jsLatin1 = (text: string): string => {
  let latin1 = '';
  for (const b of new TextEncoder().encode(text)) latin1 += String.fromCharCode(b);
  return jsString(latin1).replace(/[\x80-\xff]/g, c => `\\x${hex2(c.charCodeAt(0)).toUpperCase()}`);
};

export const isAscii = (text: string): boolean => !/[^\0-\x7f]/.test(text);
