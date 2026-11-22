/**
 * What the literal writers of every language share (docs/tools/specs/curl-to-code.md §5, «Код»): the walk over a text by
 * code point and the set of characters every language writes as an escape.
 *
 * Besides each language's own rules every writer escapes the invisible characters that change how code reads or
 * compiles: the C0 controls, DEL and C1, U+2028 and U+2029 (line terminators in JavaScript and C#), the bidirectional
 * controls U+202A–U+202E and U+2066–U+2069 (Rust refuses them in literals; elsewhere they hide what the code says) and
 * U+FEFF (Go refuses it in a file). An unpaired surrogate, which a UTF-8 source cannot hold, becomes U+FFFD everywhere
 * but JavaScript, whose strings hold one (`\uD800`).
 */

export const hex2 = (n: number): string => n.toString(16).padStart(2, '0');
export const hex4 = (n: number): string => n.toString(16).padStart(4, '0');

/** A character every language writes as an escape: controls, DEL, C1, line separators, bidi controls, the BOM. */
export const isInvisible = (cp: number): boolean =>
  cp < 0x20 ||
  (cp >= 0x7f && cp <= 0x9f) ||
  cp === 0x2028 ||
  cp === 0x2029 ||
  (cp >= 0x202a && cp <= 0x202e) ||
  (cp >= 0x2066 && cp <= 0x2069) ||
  cp === 0xfeff;

const isSurrogate = (u: number): boolean => u >= 0xd800 && u <= 0xdfff;

/** Does a text have an invisible character or an unpaired surrogate (needs an escape in any language)? */
export const hasInvisible = (text: string): boolean => {
  for (let i = 0; i < text.length; i++) {
    const u = text.charCodeAt(i);
    if (isInvisible(u)) return true;
    if (isSurrogate(u)) {
      const next = text.charCodeAt(i + 1);
      if (u <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) i++;
      else return true;
    }
  }
  return false;
};

/** Does a text need any escape in a quoted literal (an invisible character, a surrogate, a quote, a backslash)? */
export const needsEscape = (text: string): boolean => /["'\\]/.test(text) || hasInvisible(text);

/**
 * Walks `text` by code point, writing ordinary runs as they are and each special code point through `escape`
 * (`lone` — an unpaired surrogate; `next` — the next UTF-16 unit, or -1 at the end).
 */
export const write = (
  text: string,
  special: (unit: number) => boolean,
  escape: (cp: number, lone: boolean, next: number) => string,
): string => {
  let out = '';
  let run = 0;
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (isSurrogate(unit)) {
      const next = text.charCodeAt(i + 1);
      if (unit <= 0xdbff && next >= 0xdc00 && next <= 0xdfff) {
        i++;
        continue;
      }
      out += text.slice(run, i) + escape(unit, true, i + 1 < text.length ? text.charCodeAt(i + 1) : -1);
      run = i + 1;
      continue;
    }
    if (!special(unit)) continue;
    out += text.slice(run, i) + escape(unit, false, i + 1 < text.length ? text.charCodeAt(i + 1) : -1);
    run = i + 1;
  }
  return out + text.slice(run);
};

/** Special: one of the given ASCII characters, or an invisible one. */
export const specialOf =
  (chars: string) =>
  (unit: number): boolean =>
    isInvisible(unit) || (unit < 0x80 && chars.includes(String.fromCharCode(unit)));

/** The text with unpaired surrogates as U+FFFD: what a UTF-8 language holds and sends. */
export const wellFormed = (text: string): string =>
  text.replace(/[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/g, '\ufffd');

export const isAscii = (text: string): boolean => !/[^\0-\x7f]/.test(text);

/** A byte string written as printable ASCII and escapes: `escapes` for some bytes, `\xHH` for the other unprintable. */
export const byteLiteral = (bytes: Uint8Array, escapes: Readonly<Record<number, string>>): string => {
  let out = '';
  for (const b of bytes) {
    const e = escapes[b];
    if (e !== undefined) out += e;
    else if (b >= 0x20 && b < 0x7f) out += String.fromCharCode(b);
    else out += `\\x${hex2(b)}`;
  }
  return out;
};
