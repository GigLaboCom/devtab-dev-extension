/**
 * One linear pass over SVG markup as text (docs/tools/specs/svg-to-css.md §5): the pieces an XML document is written
 * in — the XML declaration, processing instructions, comments, the DOCTYPE (with its internal subset), CDATA sections,
 * start, end and empty tags, text — with their places in the text. No entity is expanded and nothing is loaded; every
 * piece is found with `indexOf` or one walk over its characters, so the pass is linear in the input. The cleanup, the
 * namespaces, the quotes and the notes all read the text through it; the parser of the page (`checkSvg`) has already
 * said the document is well-formed, but a broken one never makes this loop or throw: an unclosed piece runs to the end.
 */

export type Piece =
  | { kind: 'declaration' | 'instruction' | 'comment' | 'cdata' | 'text'; start: number; end: number }
  | { kind: 'doctype'; start: number; end: number }
  | { kind: 'start'; start: number; end: number; name: string; empty: boolean }
  | { kind: 'end'; start: number; end: number; name: string };

const isSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;

/** End (exclusive) of a piece closed by `close`, or the end of the text when it is never closed. */
const through = (text: string, from: number, close: string): number => {
  const at = text.indexOf(close, from);
  return at < 0 ? text.length : at + close.length;
};

/** End of a tag: the first `>` outside a quoted attribute value. */
const tagEnd = (text: string, from: number): number => {
  let quote = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (quote) {
      if (c === quote) quote = 0;
    } else if (c === 0x22 || c === 0x27) quote = c;
    else if (c === 0x3e) return i + 1;
  }
  return text.length;
};

/** End of `<!DOCTYPE …>`: its internal subset `[…]` may hold quoted strings, comments and instructions with `>`. */
const doctypeEnd = (text: string, from: number): number => {
  let depth = 0;
  for (let i = from; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 0x22 || c === 0x27) {
      const close = text.indexOf(text[i]!, i + 1);
      if (close < 0) return text.length;
      i = close;
    } else if (c === 0x5b) depth++;
    else if (c === 0x5d) depth = Math.max(0, depth - 1);
    else if (depth > 0 && text.startsWith('<!--', i)) i = through(text, i + 4, '-->') - 1;
    else if (depth > 0 && text.startsWith('<?', i)) i = through(text, i + 2, '?>') - 1;
    else if (c === 0x3e && depth === 0) return i + 1;
  }
  return text.length;
};

/** A name at `from`: up to white space, `/`, `>` or the end. */
const nameAt = (text: string, from: number, end: number): string => {
  let i = from;
  while (i < end) {
    const c = text.charCodeAt(i);
    if (isSpace(c) || c === 0x2f || c === 0x3e) break;
    i++;
  }
  return text.slice(from, i);
};

/** The pieces of `text` in order; together they cover it exactly. `untilRoot`: stop after the first start tag. */
export const scanMarkup = (text: string, untilRoot = false): Piece[] => {
  const pieces: Piece[] = [];
  let i = 0;
  while (i < text.length) {
    if (text.charCodeAt(i) !== 0x3c) {
      const next = text.indexOf('<', i);
      const end = next < 0 ? text.length : next;
      pieces.push({ kind: 'text', start: i, end });
      i = end;
      continue;
    }
    const start = i;
    let end: number;
    if (text.startsWith('<!--', i)) {
      end = through(text, i + 4, '-->');
      pieces.push({ kind: 'comment', start, end });
    } else if (text.startsWith('<![CDATA[', i)) {
      end = through(text, i + 9, ']]>');
      pieces.push({ kind: 'cdata', start, end });
    } else if (text.startsWith('<!', i)) {
      end = doctypeEnd(text, i + 2);
      pieces.push({ kind: 'doctype', start, end });
    } else if (text.startsWith('<?', i)) {
      end = through(text, i + 2, '?>');
      const target = nameAt(text, i + 2, end);
      pieces.push({ kind: target === 'xml' ? 'declaration' : 'instruction', start, end });
    } else if (text.startsWith('</', i)) {
      end = through(text, i + 2, '>');
      pieces.push({ kind: 'end', start, end, name: nameAt(text, i + 2, end).trim() });
    } else {
      end = tagEnd(text, i + 1);
      let back = end - 2;
      while (back > start && isSpace(text.charCodeAt(back))) back--;
      const empty = text.charCodeAt(end - 1) === 0x3e && text.charCodeAt(back) === 0x2f;
      pieces.push({ kind: 'start', start, end, name: nameAt(text, i + 1, end), empty });
      if (untilRoot) break;
    }
    i = end;
  }
  return pieces;
};

export interface Attribute {
  name: string;
  value: string;
  /** `"` or `'`. */
  quote: string;
  /** Where the attribute's name starts, and where its closing quote ends. */
  start: number;
  end: number;
}

export interface Tag {
  name: string;
  attributes: Attribute[];
  /** Where the attributes end: after the last one's closing quote (or the name) — before white space, `/` and `>`. */
  attributesEnd: number;
  empty: boolean;
}

/**
 * The name and attributes of a start or empty tag between `start` and `end`; null when it is not written as XML
 * allows (an attribute without a quoted value): the caller leaves such a tag as it is.
 */
export const readTag = (text: string, start: number, end: number): Tag | null => {
  const name = nameAt(text, start + 1, end);
  let i = start + 1 + name.length;
  let attributesEnd = i;
  const attributes: Attribute[] = [];
  const close = text.charCodeAt(end - 1) === 0x3e ? end - 1 : end;
  for (;;) {
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    if (i >= close) return { name, attributes, attributesEnd, empty: false };
    if (text.charCodeAt(i) === 0x2f) {
      let j = i + 1;
      while (j < close && isSpace(text.charCodeAt(j))) j++;
      return j === close ? { name, attributes, attributesEnd, empty: true } : null;
    }
    const nameStart = i;
    while (i < close) {
      const c = text.charCodeAt(i);
      if (isSpace(c) || c === 0x3d || c === 0x2f || c === 0x22 || c === 0x27) break;
      i++;
    }
    const attribute = text.slice(nameStart, i);
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    if (attribute === '' || text.charCodeAt(i) !== 0x3d) return null;
    i++;
    while (i < close && isSpace(text.charCodeAt(i))) i++;
    const quote = text[i];
    if (quote !== '"' && quote !== "'") return null;
    const valueEnd = text.indexOf(quote, i + 1);
    if (valueEnd < 0 || valueEnd >= close) return null;
    attributes.push({
      name: attribute,
      value: text.slice(i + 1, valueEnd),
      quote,
      start: nameStart,
      end: valueEnd + 1,
    });
    i = valueEnd + 1;
    attributesEnd = i;
  }
};

/** The local part of a qualified name: `svg:text` → `text`. */
export const localName = (name: string): string => name.slice(name.indexOf(':') + 1);
