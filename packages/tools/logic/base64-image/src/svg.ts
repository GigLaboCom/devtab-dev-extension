/**
 * What is read from an SVG's text without running or loading anything (docs/tools/specs/base64-image.md §5): the root
 * element's size, and whether the file carries active content — something that runs or loads when the saved file is
 * opened as a document, although it never does in the tool's `<img>`. Text scans only, linear in the input: no XML
 * parser, no entity is expanded, so an entity bomb costs this module one pass over its bytes.
 */
import { rootElementStart } from './sniff';

export interface Dimensions {
  width: number;
  height: number;
}

/** The SVG's text: UTF-8, a broken sequence replaced (an SVG that is not UTF-8 is not recognised in the first place). */
export const svgText = (bytes: Uint8Array): string => new TextDecoder('utf-8').decode(bytes);

/** The root `<svg …>` start tag's attributes, lower-cased names; null when there is no root svg element. */
export const rootAttributes = (text: string): Map<string, string> | null => {
  const start = rootElementStart(text);
  if (start < 0 || !text.startsWith('<svg', start)) return null;
  // The tag ends at the first `>` outside quotes.
  let end = start + 4;
  let quote = '';
  for (; end < text.length; end++) {
    const c = text[end]!;
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '>') break;
  }
  // A root tag longer than this is not read for its size (names are bounded too: the pattern stays linear).
  const tag = text.slice(start + 4, Math.min(end, start + 4 + MAX_ROOT_TAG));
  const attributes = new Map<string, string>();
  for (const m of tag.matchAll(/([^\s=/>"']{1,128})\s*=\s*(?:"([^"]*)"|'([^']*)')/g))
    attributes.set(m[1]!.toLowerCase(), m[2] ?? m[3] ?? '');
  return attributes;
};

const MAX_ROOT_TAG = 65_536;

const NUMBER = /^\s*\+?(\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*(px)?\s*$/i;

/** A length of the root element in CSS pixels: a number without a unit or with `px`; anything else is unknown. */
const pixels = (value: string | undefined): number | null => {
  if (value === undefined || !NUMBER.test(value)) return null;
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n > 0 ? n : null;
};

const whole = (n: number): number => Math.max(1, Math.round(n));

/** §5 «Размеры», SVG: `width` and `height` of the root, else the third and fourth numbers of `viewBox`, else unknown. */
export const svgDimensions = (text: string): Dimensions | null => {
  const attributes = rootAttributes(text);
  if (!attributes) return null;
  const width = pixels(attributes.get('width'));
  const height = pixels(attributes.get('height'));
  if (width !== null && height !== null) return { width: whole(width), height: whole(height) };
  const box = attributes.get('viewbox');
  if (box === undefined) return null;
  const numbers = box
    .trim()
    .split(/[\s,]+/)
    .map(Number);
  if (numbers.length !== 4 || numbers.some(n => !Number.isFinite(n))) return null;
  const [, , w, h] = numbers as [number, number, number, number];
  return w > 0 && h > 0 ? { width: whole(w), height: whole(h) } : null;
};

/** A reference that stays inside the file: a fragment (`#id`) or a `data:` URI. Anything else reaches out. */
const isOwn = (value: string): boolean => {
  // White space and control characters inside an address are dropped by URL parsers.
  const v = Array.from(value)
    .filter(c => c.charCodeAt(0) > 0x20)
    .join('')
    .toLowerCase();
  return v === '' || v.startsWith('#') || v.startsWith('data:');
};

const SCRIPT = /<script[\s>/]/i;
/** An event attribute: ` onload=`, `\nonclick =`. */
const EVENT = /\son[a-z]+\s*=/i;
/** Elements that embed a document or a plugin, or run their content as HTML. */
const EMBEDS = /<(?:[a-z][\w.-]*:)?(?:foreignObject|iframe|embed|object|frame|frameset)[\s>/]/i;
/** An entity read from elsewhere: `<!ENTITY x SYSTEM "…">`, `PUBLIC "…" "…"` — each declaration looked at once. */
const externalEntity = (text: string): boolean => {
  for (let i = text.indexOf('<!ENTITY'); i >= 0;) {
    const end = text.indexOf('>', i);
    if (/\s(?:SYSTEM|PUBLIC)\s/i.test(text.slice(i, end < 0 ? text.length : end))) return true;
    if (end < 0) return false;
    i = text.indexOf('<!ENTITY', end);
  }
  return false;
};
const IMPORT = /@import/i;
const JAVASCRIPT = /javascript\s*:/i;
/** `href`, `xlink:href`, `src`, `action` with a quoted value. */
const REFERENCE = /(?:^|[\s"'])(?:[a-z][\w.-]*:)?(?:href|src|action|formaction)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
/** `url(…)` in a style attribute, a `<style>` element or a presentation attribute. */
const URL_FUNCTION = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)"']*))/gi;
/** An animation that sets an address: `<set attributeName="href" to="…">`, `<animate attributeName="xlink:href" …>`. */
const ANIMATED_ADDRESS = /attributeName\s*=\s*["']\s*(?:[a-z][\w.-]*:)?(?:href|src)\s*["']/i;

/**
 * §5 «Превью»: does the SVG hold a script, an event attribute or a reference outside itself? The specification names
 * `<script`, `on…=` and `href` / `xlink:href` / `url(` to `http:`, `https:` or `//`; this also counts what reaches out
 * or runs when the saved file is opened as a document (§15): any address that is not `#…` or `data:` (a relative path
 * or `file:` resolves next to the saved file, `chrome-extension:` to an extension), embedded documents
 * (`<foreignObject>`, frames, objects), `@import`, `javascript:`, external entities and animations that set an address.
 */
export const svgActiveIn = (text: string): boolean => {
  if (SCRIPT.test(text) || EVENT.test(text) || EMBEDS.test(text) || externalEntity(text)) return true;
  if (IMPORT.test(text) || JAVASCRIPT.test(text) || ANIMATED_ADDRESS.test(text)) return true;
  for (const m of text.matchAll(REFERENCE)) if (!isOwn(m[1] ?? m[2] ?? '')) return true;
  for (const m of text.matchAll(URL_FUNCTION)) if (!isOwn(m[1] ?? m[2] ?? m[3] ?? '')) return true;
  return false;
};

export const svgHasActiveContent = (bytes: Uint8Array): boolean => svgActiveIn(svgText(bytes));
