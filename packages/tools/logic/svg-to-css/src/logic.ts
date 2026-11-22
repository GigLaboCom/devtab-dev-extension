/**
 * The SVG to CSS tool's logic (docs/tools/specs/svg-to-css.md §5, §9): an SVG checked by the XML parser of a Document
 * passed in (`ParseXml`), cleaned without changing what it shows (`minifySvg`), given the namespaces a data: URI needs
 * (`ensureNamespaces`), encoded as a data: URI — minimal percent-encoding with attribute quotes made single, or Base64
 * of its UTF-8 — and wrapped in the chosen CSS form. Pure: the DOM only through the parameter; the text is read by one
 * linear scanner (markup.ts), never by a regular expression over the whole input.
 */
import { localName, readTag, scanMarkup } from './markup';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { Piece } from './markup';

export type ParseXml = (text: string) => Document; // (s) => new DOMParser().parseFromString(s, 'image/svg+xml')

export type Output = 'background-image' | 'mask-image' | 'url' | 'data-uri';
export type Encoding = 'url' | 'base64';
export interface SvgOptions {
  output: Output;
  encoding: Encoding;
  minify: boolean;
}

export type SvgNote = { kind: 'added'; attribute: 'xmlns' | 'xmlns:xlink' } | { kind: 'active-content' };
export interface SvgErrorInfo {
  message: string;
  line?: number;
  column?: number;
}
export type SvgResult =
  | {
      ok: true;
      text: string;
      dataUri: string;
      /** The prepared text (after Minify and the namespaces): the bytes of the preview Blob and of the data: URI. */
      svg: string;
      sizes: { url: number; base64: number };
      notes: SvgNote[];
    }
  | { ok: false; error: SvgErrorInfo };

/**
 * Up to this many characters the result follows every edit, on the page; above, 300 ms after the last one, converted in
 * a worker (§12, §15: the specification's 1 MiB froze the page for 0.2 s on every keystroke in Chrome — measured).
 */
export const LIVE_INPUT = 256 * 1024;
/** Above this many characters (or bytes of a file) the input is refused (§6, §12). */
export const MAX_INPUT = 4 * 1024 * 1024;
export const SETTLE_MS = 300;
/** A result longer than this many characters is shown in the field by its first SHOWN_RESULT_CHARS; Copy takes all. */
export const SHOW_RESULT_CHARS = 1024 * 1024;
export const SHOWN_RESULT_CHARS = 65_536;
export const shownNote = (length: number): string =>
  `Showing the first ${SHOWN_RESULT_CHARS.toLocaleString('en-US')} of ${length.toLocaleString('en-US')} characters. Copy takes all of them.`;
export const TOO_LARGE = 'SVG is larger than 4 MB.';
export const DEFAULT_OPTIONS: SvgOptions = { output: 'background-image', encoding: 'url', minify: true };

export const SVG_NS = 'http://www.w3.org/2000/svg';
export const XLINK_NS = 'http://www.w3.org/1999/xlink';
export const URL_PREFIX = 'data:image/svg+xml,';
export const BASE64_PREFIX = 'data:image/svg+xml;base64,';

const EMPTY: SvgResult = { ok: true, text: '', dataUri: '', svg: '', sizes: { url: 0, base64: 0 }, notes: [] };

// ---- The input as the tool reads it (§5 «Проверка», step 1)

/** The input without a leading U+FEFF and surrounding white space, and where that text starts in the input. */
export const trimInput = (text: string): { body: string; offset: number } => {
  const bom = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  let start = bom;
  while (start < text.length && isXmlSpace(text.charCodeAt(start))) start++;
  let end = text.length;
  while (end > start && isXmlSpace(text.charCodeAt(end - 1))) end--;
  return { body: text.slice(start, end), offset: start };
};

/** XML's white space: space, tab, line feed, carriage return. */
const isXmlSpace = (c: number): boolean => c === 0x20 || c === 0x09 || c === 0x0a || c === 0x0d;
const isBlank = (text: string, start: number, end: number): boolean => {
  for (let i = start; i < end; i++) if (!isXmlSpace(text.charCodeAt(i))) return false;
  return true;
};

// ---- Namespaces (§5 «Пространства имён»)

interface Insertion {
  at: number;
  text: string;
}

/** The first start tag of the text (the root element when the text is a document), read past the prolog only. */
const rootTag = (svg: string): { start: number; end: number } | null => {
  for (const piece of scanMarkup(svg, true)) if (piece.kind === 'start') return piece;
  return null;
};

/** Does any element or attribute of the text use the `xlink:` prefix? */
const usesXlink = (svg: string): boolean => {
  if (!svg.includes('xlink:')) return false;
  for (const piece of scanMarkup(svg)) {
    if (piece.kind !== 'start') continue;
    if (piece.name.startsWith('xlink:')) return true;
    const tag = readTag(svg, piece.start, piece.end);
    if (tag?.attributes.some(a => a.name.startsWith('xlink:'))) return true;
  }
  return false;
};

const namespaceInsertions = (svg: string): { insertions: Insertion[]; added: Array<'xmlns' | 'xmlns:xlink'> } => {
  const root = rootTag(svg);
  const tag = root && readTag(svg, root.start, root.end);
  if (!root || !tag || localName(tag.name) !== 'svg') return { insertions: [], added: [] };
  const insertions: Insertion[] = [];
  const added: Array<'xmlns' | 'xmlns:xlink'> = [];
  // First: right after the root's name.
  if (!tag.attributes.some(a => a.name === 'xmlns')) {
    insertions.push({ at: root.start + 1 + tag.name.length, text: ` xmlns="${SVG_NS}"` });
    added.push('xmlns');
  }
  // Last: after the root's last attribute, before its white space, `/` or `>`.
  if (!tag.attributes.some(a => a.name === 'xmlns:xlink') && usesXlink(svg)) {
    insertions.push({ at: tag.attributesEnd, text: ` xmlns:xlink="${XLINK_NS}"` });
    added.push('xmlns:xlink');
  }
  return { insertions, added };
};

const insert = (svg: string, insertions: readonly Insertion[]): string => {
  let out = '';
  let from = 0;
  for (const { at, text } of insertions) {
    out += svg.slice(from, at) + text;
    from = at;
  }
  return out + svg.slice(from);
};

/**
 * Adds `xmlns="http://www.w3.org/2000/svg"` to the root `<svg>` start tag when it has no `xmlns` attribute (first), and
 * `xmlns:xlink="http://www.w3.org/1999/xlink"` when the text uses the `xlink:` prefix and the root does not declare it
 * (last). A data: URI is read as XML: without the first the root is not an SVG element, without the second the
 * prefix is unbound and the document is not well-formed — either way nothing is drawn.
 */
export const ensureNamespaces = (svg: string): { svg: string; added: Array<'xmlns' | 'xmlns:xlink'> } => {
  const { insertions, added } = namespaceInsertions(svg);
  return { svg: insert(svg, insertions), added };
};

// ---- The check (§5 «Проверка»)

/**
 * The parser's error element: Chrome puts one in the XHTML namespace, Firefox and jsdom in Mozilla's — never the SVG
 * namespace, which every element of the parsed text is in (`xmlns` is added first), so an SVG's own `<parsererror>`
 * is not taken for one.
 */
const parserError = (doc: Document): Element | null =>
  Array.from(doc.getElementsByTagName('parsererror')).find(e => e.namespaceURI !== SVG_NS) ?? null;

/** Line and column of the parser's message: Chrome `line L at column C`, jsdom `L:C:` first, Firefox `Line Number L, Column C`. */
const placeOf = (message: string): { line: number; column: number } | null => {
  const m =
    /line (\d+) at column (\d+)/.exec(message) ??
    /^\s*(\d+):(\d+):/.exec(message) ??
    /Line Number (\d+), Column (\d+)/.exec(message);
  return m ? { line: Number(m[1]), column: Number(m[2]) } : null;
};

/** The offset of a 1-based line and column (lines split at `\n`), kept inside its line. */
const offsetOf = (text: string, line: number, column: number): number => {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', start);
    if (next < 0) break;
    start = next + 1;
  }
  const lineEnd = text.indexOf('\n', start);
  return Math.min(start + Math.max(0, column - 1), lineEnd < 0 ? text.length : lineEnd);
};

/** The 1-based line and column (UTF-16) of an offset, lines split at `\n`. */
export const positionOf = (text: string, offset: number): { line: number; column: number } => {
  let line = 1;
  let lineStart = 0;
  for (let i = text.indexOf('\n'); i >= 0 && i < offset; i = text.indexOf('\n', i + 1)) {
    line++;
    lineStart = i + 1;
  }
  return { line, column: offset - lineStart + 1 };
};

const notWellFormed = (place?: { line: number; column: number }): SvgErrorInfo =>
  place
    ? { message: `Line ${place.line}, column ${place.column}: the SVG is not well-formed XML.`, ...place }
    : { message: 'The SVG is not well-formed XML.' };

/**
 * Is the input one well-formed XML document whose root is `<svg>`? Judged by the parser the caller passes (the page's
 * `DOMParser`, which parses and neither runs nor loads anything), on the text the tool will encode: without U+FEFF and
 * surrounding white space, with the namespaces of `ensureNamespaces` (an `xlink:` prefix it declares is not an error).
 * The error's place is the input's own — the parser's line and column carried back over what was trimmed and added.
 * Empty input is not an error.
 */
export const checkSvg = (text: string, parse: ParseXml): SvgErrorInfo | null => {
  const { body, offset } = trimInput(text);
  if (body === '') return null;
  const { insertions } = namespaceInsertions(body);
  const parsed = insert(body, insertions);
  const doc = parse(parsed);
  const error = parserError(doc);
  if (error || !doc.documentElement) {
    const place = placeOf(error?.textContent ?? '');
    if (!place) return notWellFormed();
    // Back to the input: the parser's place in the parsed text, less what was inserted before it, plus what was trimmed.
    const at = offsetOf(parsed, place.line, place.column);
    let inBody = at;
    let added = 0;
    for (const i of insertions) {
      if (at < i.at + added) break;
      if (at < i.at + added + i.text.length) {
        inBody = i.at + added;
        break;
      }
      added += i.text.length;
    }
    return notWellFormed(positionOf(text, inBody - added + offset));
  }
  const root = doc.documentElement;
  if (root.localName !== 'svg') return { message: `The root element is <${root.nodeName}>, not <svg>.` };
  return null;
};

// ---- The cleanup (§5 «Чистка»)

/** Elements whose text is drawn or read (and everything inside them): their white space is never touched. */
const KEEP_SPACE = new Set(['text', 'foreignObject', 'style', 'script']);

/** A DOCTYPE whose internal subset declares entities or attribute defaults changes the document: it stays. */
const doctypeMatters = (declaration: string): boolean => {
  const subset = declaration.indexOf('[');
  return subset >= 0 && /<!(?:ENTITY|ATTLIST)\s/.test(declaration.slice(subset));
};

/**
 * Line breaks and tabs in an attribute value as the parser reads them: XML normalises each to a space (CR LF counts
 * once: XML 1.0 §2.11, §3.3.3), so writing a space instead changes nothing in the document.
 */
const normaliseValue = (value: string): string =>
  /[\t\n\r]/.test(value) ? value.replace(/\r\n|[\t\n\r]/g, ' ') : value;

/** A start or empty tag with single spaces between its attributes and none before `>` or `/>`. */
const compactTag = (svg: string, piece: Extract<Piece, { kind: 'start' }>): string => {
  const tag = readTag(svg, piece.start, piece.end);
  if (!tag) return svg.slice(piece.start, piece.end);
  let out = `<${tag.name}`;
  for (const a of tag.attributes) out += ` ${a.name}=${a.quote}${normaliseValue(a.value)}${a.quote}`;
  return out + (tag.empty ? '/>' : '>');
};

/**
 * The safe cleanup, over the text: the XML declaration, comments and the DOCTYPE go (a DOCTYPE stays when its internal
 * subset declares entities or attribute defaults, which the document may use); white space between tags goes — when
 * the whole run of character data there is white space (a run with text or CDATA stays whole) — except inside
 * `<text>`, `<foreignObject>`, `<style>` and `<script>`, where it can be drawn or read; inside tags, single
 * spaces between attributes and none before `>` or `/>`, line breaks and tabs in values as the spaces the parser makes
 * of them. Never touched: text that is not only white space, CDATA sections, other processing instructions, attribute
 * values beyond that, names, the order of attributes, `viewBox`, `width`, `height`. White space between elements
 * outside text is not drawn whatever `xml:space` says (only text content elements draw text), so `xml:space` does not
 * keep it.
 */
export const minifySvg = (svg: string): string => {
  const out: string[] = [];
  // How many open elements keep their white space (one counts for all inside it).
  const keeping: boolean[] = [];
  let kept = 0;
  // Character data between two tags — text and CDATA, joined across comments — is one run: the parser makes one text
  // of it, so white space in it goes only when the whole run is white space.
  let run: Piece[] = [];
  let runMatters = false;
  const flush = (): void => {
    for (const p of run) if (p.kind === 'cdata' || kept > 0 || runMatters) out.push(svg.slice(p.start, p.end));
    run = [];
    runMatters = false;
  };
  for (const piece of scanMarkup(svg)) {
    switch (piece.kind) {
      case 'comment':
        break;
      case 'text':
        run.push(piece);
        if (!isBlank(svg, piece.start, piece.end)) runMatters = true;
        break;
      case 'cdata':
        run.push(piece);
        runMatters = true;
        break;
      case 'declaration':
        flush();
        break;
      case 'doctype': {
        flush();
        const text = svg.slice(piece.start, piece.end);
        if (doctypeMatters(text)) out.push(text);
        break;
      }
      case 'start': {
        flush();
        out.push(compactTag(svg, piece));
        if (!piece.empty) {
          const keeps = kept > 0 || KEEP_SPACE.has(localName(piece.name));
          keeping.push(keeps);
          if (keeps) kept++;
        }
        break;
      }
      case 'end':
        flush();
        out.push(`</${piece.name}>`);
        if (keeping.pop()) kept--;
        break;
      default:
        flush();
        out.push(svg.slice(piece.start, piece.end));
    }
  }
  flush();
  return out.join('').trim();
};

// ---- Quotes and encoding (§5 «Кодирование»)

const swapQuotes = (svg: string, pieces: readonly Piece[]): string => {
  const out: string[] = [];
  let from = 0;
  for (const piece of pieces) {
    if (piece.kind !== 'start') continue;
    const tag = readTag(svg, piece.start, piece.end);
    if (!tag) continue;
    for (const a of tag.attributes) {
      if (a.quote !== '"' || a.value.includes("'")) continue;
      const open = a.end - a.value.length - 2;
      out.push(svg.slice(from, open), `'${a.value}'`);
      from = a.end;
    }
  }
  out.push(svg.slice(from));
  return out.join('');
};

/**
 * Attribute values in `"…"` without a `'` become `'…'` in tags (not in `<!…>` or `<?…?>`), so the URI goes into
 * `url("…")` with no `"` to encode; a value holding `'` stays as it is, and its `"` are encoded.
 */
export const swapAttributeQuotes = (svg: string): string => swapQuotes(svg, scanMarkup(svg));

/**
 * The ASCII characters encoded (§5 «Кодирование», step 2), with why:
 *   `%`          starts a percent sequence (RFC 3986 §2.1)
 *   `#`          starts the fragment: the rest of the URI would be cut off (RFC 3986 §3.5)
 *   `"`          ends the string of `url("…")` and of an HTML attribute `src="…"`
 *   `\`          starts an escape in a CSS string (CSS Syntax 3 §4.3.5)
 *   `&`          starts a character reference when the URI is put into an HTML attribute (the Data URI form)
 *   `<`, `>`     not allowed in a URI (RFC 3986 §2); browsers take them raw — encoded for the RFC and strict tools
 *   U+0000–U+001F, U+007F   control characters: a URL parser drops tab and line feed, a CSS string ends at a line break
 * and every character above U+007F, as the bytes of its UTF-8 (independent of the CSS file's encoding). Everything else
 * — space, `'`, `(`, `)`, `{`, `}`, `=`, `:`, `/` … — stays: safe inside `url("…")`, and the URI stays readable.
 */
const ENCODE = new Uint8Array(128);
for (let c = 0; c < 0x20; c++) ENCODE[c] = 1;
for (const c of '%#"\\&<>') ENCODE[c.charCodeAt(0)] = 1;
ENCODE[0x7f] = 1;

const HEX = '0123456789ABCDEF';
const percent = (byte: number): string => `%${HEX[byte >> 4]}${HEX[byte & 15]}`;
const utf8 = new TextEncoder();

/**
 * The percent-encoded payload of a data: URI (§5 «Кодирование», step 2): the characters above and every character
 * above U+007F as `%HH` of its UTF-8 bytes (hex in capitals, RFC 3986 §2.1). An unpaired surrogate is encoded as
 * U+FFFD, `%EF%BF%BD` — what `TextEncoder` and a `Blob` of the same text write, so the preview's bytes are the URI's.
 */
export const encodeSvgPayload = (svg: string): string => {
  const out: string[] = [];
  let from = 0;
  let i = 0;
  while (i < svg.length) {
    const c = svg.charCodeAt(i);
    if (c < 0x80) {
      if (ENCODE[c]) {
        if (from < i) out.push(svg.slice(from, i));
        out.push(percent(c));
        from = i + 1;
      }
      i++;
      continue;
    }
    if (from < i) out.push(svg.slice(from, i));
    let end = i + 1;
    while (end < svg.length && svg.charCodeAt(end) >= 0x80) end++;
    let run = '';
    for (const byte of utf8.encode(svg.slice(i, end))) run += percent(byte);
    out.push(run);
    from = i = end;
  }
  if (from < svg.length) out.push(svg.slice(from));
  return out.join('');
};

/** The length of `encodeSvgPayload(svg)` without building it. */
const encodedLength = (svg: string): number => {
  let n = 0;
  for (let i = 0; i < svg.length; i++) {
    const c = svg.charCodeAt(i);
    if (c < 0x80) n += ENCODE[c] ? 3 : 1;
    else if (c < 0x800) n += 6;
    else if (c >= 0xd800 && c <= 0xdbff && (svg.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 12;
      i++;
    } else n += 9;
  }
  return n;
};

/** The number of UTF-8 bytes of a string (unpaired surrogates as U+FFFD, three bytes). */
const utf8Length = (svg: string): number => {
  let n = 0;
  for (let i = 0; i < svg.length; i++) {
    const c = svg.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && (svg.charCodeAt(i + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      i++;
    } else n += 3;
  }
  return n;
};

const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4;

// ---- What the notes say (§5 «Предпросмотр», step 3)

/** A reference that stays inside the file: empty, a fragment (`#id`) or a `data:` URI. Anything else reaches out. */
const isOwn = (value: string): boolean => {
  let v = '';
  for (const c of value) if (c.charCodeAt(0) > 0x20) v += c;
  v = v.toLowerCase();
  return v === '' || v.startsWith('#') || v.startsWith('data:');
};

/** `url(…)` targets of a piece of CSS (a `style` or presentation attribute, a `<style>` element): linear. */
const reachesOut = (css: string): boolean => {
  const lower = css.toLowerCase();
  if (lower.includes('@import')) return true;
  for (let at = lower.indexOf('url('); at >= 0; at = lower.indexOf('url(', at + 4)) {
    let i = at + 4;
    while (i < css.length && isXmlSpace(css.charCodeAt(i))) i++;
    const quote = css[i] === '"' || css[i] === "'" ? css[i]! : '';
    const end = quote ? css.indexOf(quote, i + 1) : css.indexOf(')', i);
    const target = css.slice(quote ? i + 1 : i, end < 0 ? css.length : end);
    if (!isOwn(target.replaceAll('&quot;', '').replaceAll('&apos;', ''))) return true;
  }
  return false;
};

const REFERENCES = new Set(['href', 'src', 'action', 'formaction', 'poster']);

/**
 * Does the SVG hold something that would run or load outside a CSS image — a `<script>`, an event attribute
 * (`on…="…"`), a reference that is not `#…` or `data:` (`href`, `xlink:href`, `src`, CSS `url()` and `@import`, an
 * `xml-stylesheet` instruction, an external entity)? Read from the tags and the CSS of the markup, not its text.
 */
const hasActiveContent = (svg: string, pieces: readonly Piece[]): boolean => {
  let inStyle = 0;
  for (const piece of pieces) {
    switch (piece.kind) {
      case 'start': {
        const local = localName(piece.name);
        if (local === 'script') return true;
        const tag = readTag(svg, piece.start, piece.end);
        for (const a of tag?.attributes ?? []) {
          const name = localName(a.name);
          if (/^on[a-z]+$/i.test(name)) return true;
          if (REFERENCES.has(name) && !isOwn(a.value)) return true;
          if (a.value.includes('url(') && reachesOut(a.value)) return true;
          if (name === 'style' && reachesOut(a.value)) return true;
        }
        if (local === 'style' && !piece.empty) inStyle++;
        break;
      }
      case 'end':
        if (localName(piece.name) === 'style' && inStyle > 0) inStyle--;
        break;
      case 'text':
      case 'cdata':
        if (inStyle > 0 && reachesOut(svg.slice(piece.start, piece.end))) return true;
        break;
      case 'instruction':
        if (svg.startsWith('<?xml-stylesheet', piece.start)) return true;
        break;
      case 'doctype':
        if (/<!ENTITY[^>]*\s(?:SYSTEM|PUBLIC)\s/.test(svg.slice(piece.start, piece.end))) return true;
        break;
      default:
    }
  }
  return false;
};

// ---- The result

const wrap = (output: Output, uri: string): string =>
  output === 'background-image'
    ? `background-image: url("${uri}");`
    : output === 'mask-image'
      ? `mask-image: url("${uri}");`
      : output === 'url'
        ? `url("${uri}")`
        : uri;

/**
 * Everything after the check, for an input `checkSvg` has passed: the cleanup (when `minify`), the namespaces, the
 * data: URI in the chosen encoding, the CSS form, both sizes and the notes. Needs no parser, so a worker can run it.
 */
export const convertSvg = (text: string, options: SvgOptions): SvgResult => {
  const { body } = trimInput(text);
  if (body === '') return EMPTY;
  const { svg, added } = ensureNamespaces(options.minify ? minifySvg(body) : body);
  const pieces = scanMarkup(svg);
  const notes: SvgNote[] = added.map(attribute => ({ kind: 'added', attribute }));
  if (hasActiveContent(svg, pieces)) notes.push({ kind: 'active-content' });
  const swapped = swapQuotes(svg, pieces);
  let dataUri: string;
  let sizes: { url: number; base64: number };
  if (options.encoding === 'url') {
    dataUri = URL_PREFIX + encodeSvgPayload(swapped);
    sizes = { url: dataUri.length, base64: BASE64_PREFIX.length + base64Length(utf8Length(svg)) };
  } else {
    dataUri = BASE64_PREFIX + bytesToBase64(utf8.encode(svg));
    sizes = { url: URL_PREFIX.length + encodedLength(swapped), base64: dataUri.length };
  }
  return { ok: true, text: wrap(options.output, dataUri), dataUri, svg, sizes, notes };
};

/** The tool's whole work for one input and its options: the check, then `convertSvg`. Empty input: the empty result. */
export const svgToCss = (text: string, options: SvgOptions, parse: ParseXml): SvgResult => {
  if (trimInput(text).body === '') return EMPTY;
  const error = checkSvg(text, parse);
  return error ? { ok: false, error } : convertSvg(text, options);
};

export const ADDED_XMLNS = `Added xmlns="${SVG_NS}": without it a data URI does not render as SVG.`;
export const ADDED_XLINK = `Added xmlns:xlink="${XLINK_NS}": without it the xlink: prefix is not declared and the SVG does not render.`;
export const ACTIVE_CONTENT =
  'This SVG contains scripts or external references. They do not run in a CSS image, and external files do not load.';

export const describeNotes = (notes: SvgNote[]): string[] =>
  notes.map(n => (n.kind === 'active-content' ? ACTIVE_CONTENT : n.attribute === 'xmlns' ? ADDED_XMLNS : ADDED_XLINK));

const count = (n: number): string => n.toLocaleString('en-US');

/** `<N> characters · Base64: <M>` (or the other way round), ` (shorter)` after the smaller when it is not the current. */
export const formatSizes = (sizes: { url: number; base64: number }, encoding: Encoding): string => {
  const [mine, other, otherName] =
    encoding === 'url' ? [sizes.url, sizes.base64, 'Base64'] : [sizes.base64, sizes.url, 'URL-encoded'];
  return `${count(mine)} characters · ${otherName}: ${count(other)}${other < mine ? ' (shorter)' : ''}`;
};

// ---- Detection (§7)

const DETECT_CHARS = 4096;

/**
 * Does pasted text look like one SVG document? After U+FEFF and white space, and past a leading `<?xml …?>`, comments
 * and `<!DOCTYPE svg…>`, it starts with `<svg` and white space, `>` or `/`, and it ends with `</svg>` or `/>`. Reads the
 * first and the last 4 KiB only.
 */
export const detectSvg = (text: string): boolean => {
  const head = text.slice(0, DETECT_CHARS);
  let i = head.charCodeAt(0) === 0xfeff ? 1 : 0;
  for (;;) {
    while (i < head.length && isXmlSpace(head.charCodeAt(i))) i++;
    let close = '';
    if (head.startsWith('<?xml', i)) close = '?>';
    else if (head.startsWith('<!--', i)) close = '-->';
    else if (head.startsWith('<!DOCTYPE svg', i)) close = '>';
    else break;
    if (close === '>') {
      const end = scanMarkup(head.slice(i), true)[0]!.end;
      if (end <= 0 || head[i + end - 1] !== '>') return false;
      i += end;
    } else {
      const end = head.indexOf(close, i + 2);
      if (end < 0) return false;
      i = end + close.length;
    }
  }
  if (!head.startsWith('<svg', i)) return false;
  const next = head.charCodeAt(i + 4);
  if (!(isXmlSpace(next) || next === 0x3e || next === 0x2f)) return false;
  const tail = text.slice(-DETECT_CHARS).trimEnd();
  return tail.endsWith('</svg>') || tail.endsWith('/>');
};
