/**
 * What is read from an SVG's text (docs/tools/specs/image-convert.md §5.6): whether a text is an SVG at all (its root
 * element), its own size from `width`, `height` and `viewBox`, and what the page should say about it. The text is never
 * shown or parsed as markup in the page; every check is a forward scan or an expression without nested repetition, so a
 * 4 MiB SVG costs a linear pass.
 */
import { DEFAULT_SVG_SIZE } from './limits';
import type { Size } from './types';

const isSpace = (c: string | undefined): boolean => c === ' ' || c === '\t' || c === '\n' || c === '\r';

/** Where the root element starts after a BOM, white space, the XML declaration, comments, DOCTYPE and PIs; -1 if not. */
const rootStart = (text: string, limit = 65_536): number => {
  let at = text.charCodeAt(0) === 0xfeff ? 1 : 0;
  const end = Math.min(text.length, limit);
  while (at < end) {
    while (at < end && isSpace(text[at])) at++;
    if (text.startsWith('<?', at)) {
      const close = text.indexOf('?>', at + 2);
      if (close === -1) return -1;
      at = close + 2;
    } else if (text.startsWith('<!--', at)) {
      const close = text.indexOf('-->', at + 4);
      if (close === -1) return -1;
      at = close + 3;
    } else if (text.slice(at, at + 9).toUpperCase() === '<!DOCTYPE') {
      // To the '>' that ends it, past an internal subset in brackets.
      let i = at + 9;
      let inSubset = false;
      for (; i < text.length; i++) {
        const c = text[i];
        if (c === '[') inSubset = true;
        else if (c === ']') inSubset = false;
        else if (c === '>' && !inSubset) break;
      }
      if (i >= text.length) return -1;
      at = i + 1;
    } else break;
  }
  return at < end ? at : -1;
};

/** The text's root element is `<svg>`. */
export const looksLikeSvgText = (text: string): boolean => {
  const at = rootStart(text);
  if (at === -1 || !text.startsWith('<svg', at)) return false;
  const next = text[at + 4];
  return next === '>' || next === '/' || isSpace(next);
};

/** The root `<svg …>` start tag's attributes (names lowercased), or null when there is no root svg. */
export const rootAttributes = (text: string): Map<string, string> | null => {
  const at = rootStart(text);
  if (at === -1 || !looksLikeSvgText(text)) return null;
  const attributes = new Map<string, string>();
  let i = at + 4;
  while (i < text.length) {
    while (i < text.length && isSpace(text[i])) i++;
    const c = text[i];
    if (c === undefined || c === '>' || c === '/') break;
    const nameStart = i;
    while (i < text.length && !isSpace(text[i]) && text[i] !== '=' && text[i] !== '>' && text[i] !== '/') i++;
    const name = text.slice(nameStart, i).toLowerCase();
    while (i < text.length && isSpace(text[i])) i++;
    if (text[i] !== '=') {
      if (name) attributes.set(name, '');
      if (i === nameStart) i++;
      continue;
    }
    i++;
    while (i < text.length && isSpace(text[i])) i++;
    const quote = text[i];
    let value: string;
    if (quote === '"' || quote === "'") {
      const close = text.indexOf(quote, i + 1);
      if (close === -1) break;
      value = text.slice(i + 1, close);
      i = close + 1;
    } else {
      const start = i;
      while (i < text.length && !isSpace(text[i]) && text[i] !== '>') i++;
      value = text.slice(start, i);
    }
    if (name && !attributes.has(name)) attributes.set(name, value);
  }
  return attributes;
};

/** CSS absolute units in px at 96 px to the inch. */
const UNITS: Record<string, number> = {
  '': 1,
  px: 1,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
  pt: 96 / 72,
  pc: 16,
};
const LENGTH = /^\s*\+?((?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)\s*([a-z]*)\s*$/i;

/** A `width` or `height` usable as pixels: a number without a unit, in px or an absolute unit; else null. */
export const svgLength = (value: string | undefined): number | null => {
  if (value === undefined || value.length > 64) return null;
  const match = LENGTH.exec(value);
  if (!match) return null;
  const unit = UNITS[match[2]!.toLowerCase()];
  const n = Number(match[1]) * (unit ?? NaN);
  return Number.isFinite(n) && n > 0 ? n : null;
};

/** `viewBox`'s width and height: four numbers by spaces and/or commas, both sizes above zero; else null. */
export const viewBoxSize = (value: string | undefined): Size | null => {
  if (value === undefined || value.length > 256) return null;
  const parts = value.trim().split(/[\s,]+/);
  if (parts.length !== 4) return null;
  const numbers = parts.map(Number);
  if (!numbers.every(Number.isFinite)) return null;
  const [, , width, height] = numbers as [number, number, number, number];
  return width > 0 && height > 0 ? { width, height } : null;
};

export interface SvgSize {
  size: Size;
  source: 'attributes' | 'viewBox' | 'default';
  viewBox: Size | null;
}

const whole = (n: number): number => Math.max(1, Math.round(n));

/** The SVG's own size (§5.6): its attributes, else its viewBox, else what a browser gives it (300 × 150). */
export const svgSize = (text: string): SvgSize => {
  const attributes = rootAttributes(text);
  const width = svgLength(attributes?.get('width'));
  const height = svgLength(attributes?.get('height'));
  const viewBox = viewBoxSize(attributes?.get('viewbox'));
  const ratio = viewBox ? viewBox.width / viewBox.height : null;
  if (width !== null && height !== null)
    return { size: { width: whole(width), height: whole(height) }, source: 'attributes', viewBox };
  if (width !== null)
    return {
      size: { width: whole(width), height: whole(ratio ? width / ratio : DEFAULT_SVG_SIZE.height) },
      source: 'attributes',
      viewBox,
    };
  if (height !== null)
    return {
      size: { width: whole(ratio ? height * ratio : DEFAULT_SVG_SIZE.width), height: whole(height) },
      source: 'attributes',
      viewBox,
    };
  if (viewBox)
    return { size: { width: whole(viewBox.width), height: whole(viewBox.height) }, source: 'viewBox', viewBox };
  return { size: { ...DEFAULT_SVG_SIZE }, source: 'default', viewBox: null };
};

const FOREIGN_OBJECT = /<(?:[a-z0-9_.-]+:)?foreignobject[\s/>]/;
const REFERENCE = /(?:href|src)\s*=\s*(["'])([^"']*)/g;
const CSS_URL = /url\(\s*["']?([^)"']*)/g;
const EVENT_ATTRIBUTE = /\son[a-z]+\s*=/;

const external = (value: string): boolean => {
  const v = value.trim().toLowerCase();
  return v !== '' && !v.startsWith('#') && !v.startsWith('data:');
};

/** A `foreignObject` element: drawing it taints the canvas (§5.1), so such an SVG cannot be rasterised. */
export const svgHasForeignObject = (text: string): boolean => FOREIGN_OBJECT.test(text.toLowerCase());

/** Scripts, event attributes, references to anything but `#…` and `data:`, `@import`, `foreignObject`. */
export const svgActiveContent = (text: string): boolean => {
  const lower = text.toLowerCase();
  if (lower.includes('<script') || lower.includes('@import') || EVENT_ATTRIBUTE.test(lower)) return true;
  if (FOREIGN_OBJECT.test(lower)) return true;
  for (const match of lower.matchAll(REFERENCE)) if (external(match[2]!)) return true;
  for (const match of lower.matchAll(CSS_URL)) if (external(match[1]!)) return true;
  return false;
};
