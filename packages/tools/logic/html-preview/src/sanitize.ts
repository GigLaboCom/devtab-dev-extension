/**
 * The check of the pasted document (docs/tools/specs/html-preview.md §5.2, §15). The input is parsed as a whole document
 * by the DOMParser of the window of the Document passed in (a document without a window of its own: nothing in it loads
 * or runs); then, in document order:
 *
 *   - the `<style>` texts become the sheets (their CSS made to load nothing, css.ts);
 *   - removed with all they hold: script, frames and objects, base, meta, link, template, title, noembed, noframes;
 *   - `<noscript>` gives way to its content (a browser without scripts shows that; and its markup can never read
 *     differently in a page that runs scripts — mutation XSS); `<xmp>` and `<plaintext>` become `<pre>`;
 *   - images become frames with their alternative text; sources and tracks of media go;
 *   - every attribute that runs (`on…`), loads or sends (`src`, `srcset`, `srcdoc`, `poster`, `background`, `ping`,
 *     `action`, `formaction`, `xlink:href`, an SVG's or MathML's `href` other than `#id`, an SVG attribute with a
 *     `url()`), targets, focuses or downloads goes; `style` becomes a number into `inline`; a form's `name` goes (it
 *     would shadow the document's own properties);
 *   - a link opens (`http:`, `https:`, `mailto:`) in a new tab without opener and referrer, or becomes text with
 *     `Not opened: …`.
 *
 * Every read and write of the parsed document goes through dom.ts: the pasted markup cannot shadow what this code uses.
 */
import { attributeLoads, cleanCss } from './css';
import {
  HTML_NS,
  SVG_NS,
  attr,
  attributes,
  call,
  childNodes,
  isConnected,
  localName,
  namespace,
  parentOf,
  prop,
  remove,
  removeAttr,
  setAttr,
  textOf,
} from './dom';
import { emptyCounts, isOpenableHref, openedHref } from './logic';
import type { RemovedCounts, SanitizedHtml } from './logic';

/**
 * `<base>` would make the parser of a document that keeps the page's policy report `base-uri 'none'` in the console
 * (§6). It is parsed as a `<link>` instead — the same tree: both are void elements the parser treats alike in head and
 * body — with this mark, and removed like every link; a text that held the word gets it back.
 */
const BASE_MARK = '<link data-html-preview-base';
const BASE_TAG = /<base(?=[\t\n\f\r />])/gi;

/** Removed with everything inside, whatever their namespace. */
const EMBEDS = new Set(['iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'portal', 'fencedframe']);
const SILENT = new Set(['base', 'meta', 'template', 'noembed', 'noframes']);
/** HTML's names in an SVG or MathML (inert there, unknown elements): removed, so no copy can ever read them as HTML. */
const HTML_NAMED = new Set(['noscript', 'source', 'track', 'img', 'input', 'xmp', 'plaintext', 'textarea', 'select']);
/** Attributes that load, send, target, focus or download: removed from every element. */
const REMOVED_ATTRIBUTES = new Set([
  'srcdoc',
  'srcset',
  'ping',
  'formaction',
  'action',
  'background',
  'poster',
  'xlink:href',
  'lowsrc',
  'dynsrc',
  'target',
  'formtarget',
  'autofocus',
  'download',
  'data-preview-style',
]);
const MEDIA = new Set(['video', 'audio', 'source', 'track']);
const SVG_ANIMATION = new Set(['animate', 'set', 'animatemotion', 'animatetransform']);
const HTML_KEEPS = new Set(['lang', 'dir', 'class', 'id']);
const BODY_KEEPS = new Set(['lang', 'dir', 'class', 'id', 'bgcolor', 'text', 'link', 'vlink', 'alink']);
const MATHML_NS = 'http://www.w3.org/1998/Math/MathML';
const DIMENSION = /^\d{1,5}$/;
/** The address on an image frame's hover: a `data:` image can be megabytes. */
const TITLE_ADDRESS = 300;

const insideForm = (el: Element): boolean => {
  const parent = prop<Element | null>(el, 'parentElement');
  return parent !== null && call<Element | null>(parent, 'closest', 'form') !== null;
};

const short = (s: string): string => (s.length > TITLE_ADDRESS ? `${s.slice(0, TITLE_ADDRESS)}…` : s);

export const sanitizeHtml = (input: string, doc: Document): SanitizedHtml => {
  const view = prop<(Window & typeof globalThis) | null>(doc, 'defaultView');
  if (!view?.DOMParser) throw new TypeError('sanitizeHtml needs a document with a window (its DOMParser parses)');
  const masked = input.replace(BASE_TAG, BASE_MARK);
  const unmask = masked === input ? (s: string) => s : (s: string) => s.split(BASE_MARK).join('<base');
  const parsed = new view.DOMParser().parseFromString(masked, 'text/html');

  const counts: RemovedCounts = emptyCounts();
  const sheets: string[] = [];
  const inline: string[] = [];
  const create = (name: string): HTMLElement => call<HTMLElement>(parsed, 'createElement', name);
  const html = prop<HTMLElement>(parsed, 'documentElement');
  let body = prop<HTMLElement | null>(parsed, 'body');
  if (!body || localName(body) !== 'body') {
    // A frameset document: its frames go; an empty body takes their place.
    body = create('body');
    call(html, 'append', body);
  }

  /** The element's `style`, made to load nothing, as a number into `inline` (or nothing when it is empty). */
  const numberStyle = (el: Element, css: string): void => {
    const clean = cleanCss(css, 'declarations');
    counts.styleUrls += clean.removed;
    if (clean.css.trim() === '') return;
    setAttr(el, 'data-preview-style', String(inline.length));
    inline.push(clean.css);
  };

  /** §5.2 step 4: an image becomes a frame with its alternative text, its style and its size. */
  const imageFrame = (img: Element): void => {
    const src = attr(img, 'src') ?? attr(img, 'srcset') ?? '';
    const alt = attr(img, 'alt') ?? '';
    const frame = create('span');
    setAttr(frame, 'class', 'html-preview-image');
    setAttr(frame, 'title', `Image not loaded: ${short(unmask(src))}`);
    call(frame, 'append', unmask(alt) === '' ? 'image' : unmask(alt));
    let style = attr(img, 'style') ?? '';
    for (const side of ['width', 'height']) {
      const value = (attr(img, side) ?? '').trim();
      if (DIMENSION.test(value)) style += `;${side}:${value}px`;
    }
    if (style !== '') numberStyle(frame, style);
    call(img, 'replaceWith', frame);
    counts.images++;
  };

  /** §5.2 steps 5–7 on one element that stays. */
  const cleanAttributes = (el: Element, name: string, ns: string | null): void => {
    for (const a of attributes(el)) {
      const lower = a.name.toLowerCase();
      if (/^on/i.test(a.localName)) {
        removeAttr(el, a.name);
        counts.handlers++;
      } else if (lower === 'style') {
        const value = a.value;
        removeAttr(el, a.name);
        numberStyle(el, unmask(value));
      } else if (ns !== HTML_NS && a.localName === 'href') {
        // An SVG may point into the document (`<use href="#icon">`, a gradient's template); nothing else stays.
        const local = ns === SVG_NS && name !== 'a' && a.value.trim().startsWith('#');
        if (!local) {
          removeAttr(el, a.name);
          // A link of an SVG, or a MathML element's link (MathML Core leaves it out; other browsers follow it).
          if (name === 'a' || ns === MATHML_NS) counts.inactiveLinks++;
        }
      } else if (REMOVED_ATTRIBUTES.has(lower) || (lower === 'name' && name === 'form' && ns === HTML_NS)) {
        removeAttr(el, a.name);
      } else if (lower === 'href' && ns === HTML_NS && name !== 'a' && name !== 'area') {
        removeAttr(el, a.name); // an address on an element that does nothing with it: not copied either
      } else if (lower === 'src') {
        removeAttr(el, a.name);
        if (MEDIA.has(name)) counts.media++;
      } else if (ns !== HTML_NS && attributeLoads(a.value)) {
        removeAttr(el, a.name);
        counts.styleUrls++;
      } else if (a.value.includes(BASE_MARK)) setAttr(el, a.name, unmask(a.value));
    }
    if (ns === HTML_NS && (name === 'a' || name === 'area')) {
      const href = attr(el, 'href');
      if (href === null) return;
      if (isOpenableHref(href)) {
        // In this order, after every other attribute: the same markup however often it is checked.
        setAttr(el, 'href', openedHref(href));
        removeAttr(el, 'rel');
        setAttr(el, 'target', '_blank');
        setAttr(el, 'rel', 'noopener noreferrer');
      } else {
        removeAttr(el, 'href');
        setAttr(el, 'title', `Not opened: ${href}`);
        counts.inactiveLinks++;
      }
    }
  };

  // <html> and <body>: what the frame's own elements take (§5.2 step 9, §15) — first, so theirs are the first numbers.
  const keep = (el: Element, allowed: Set<string>): Array<[string, string]> => {
    const out: Array<[string, string]> = [];
    for (const a of attributes(el)) {
      const lower = a.name.toLowerCase();
      if (/^on/i.test(lower)) counts.handlers++;
      else if (lower === 'style') {
        const before = inline.length;
        numberStyle(el, unmask(a.value));
        if (inline.length > before) out.push(['data-preview-style', String(before)]);
      } else if (allowed.has(lower)) out.push([lower, unmask(a.value)]);
    }
    return out;
  };
  const htmlAttrs = keep(html, HTML_KEEPS);
  const bodyAttrs = keep(body, BODY_KEEPS);
  // What the frame's own elements take is in the lists; the parsed ones keep nothing (a body's `onload` would otherwise
  // travel with it into the frame's document, where the sandbox refuses it with an error in the console).
  for (const el of [html, body]) for (const a of attributes(el)) removeAttr(el, a.name);

  // The document's elements in order: a static list (an element removed takes its descendants out of the document;
  // they are skipped as no longer connected).
  for (const el of Array.from(call<NodeListOf<Element>>(parsed, 'querySelectorAll', '*'))) {
    if (!isConnected(el) || el === html || el === body) continue;
    const name = localName(el).toLowerCase();
    const ns = namespace(el);
    if (name === 'head' && ns === HTML_NS) continue;
    if (name === 'style') {
      if (ns === HTML_NS || ns === SVG_NS) {
        const clean = cleanCss(unmask(textOf(el)), 'sheet');
        counts.imports += clean.imports;
        counts.styleUrls += clean.removed;
        sheets.push(clean.css);
      }
      remove(el);
    } else if (name === 'script') {
      counts.scripts++;
      remove(el);
    } else if (EMBEDS.has(name)) {
      counts.frames++;
      remove(el);
    } else if (name === 'link') {
      const rel = (attr(el, 'rel') ?? '').toLowerCase().split(/[\t\n\f\r ]+/);
      if (attr(el, 'data-html-preview-base') === null && rel.includes('stylesheet')) counts.stylesheets++;
      remove(el);
    } else if (SILENT.has(name) || (name === 'title' && ns === HTML_NS) || (ns !== HTML_NS && HTML_NAMED.has(name)))
      remove(el);
    else if (ns === HTML_NS && name === 'noscript') {
      call(el, 'replaceWith', ...childNodes(el));
    } else if (ns === HTML_NS && name === 'form' && insideForm(el)) {
      // A form in a form: the parser makes one only by a quirk, and never again from the markup (a known mutation XSS
      // shape); it gives way to its content, so Copy HTML reads the same when parsed again.
      call(el, 'replaceWith', ...childNodes(el));
    } else if (
      ns === HTML_NS &&
      (name === 'img' || (name === 'input' && (attr(el, 'type') ?? '').trim().toLowerCase() === 'image'))
    ) {
      imageFrame(el);
    } else if (ns === HTML_NS && (name === 'source' || name === 'track')) {
      const parent = parentOf(el);
      if (!parent || prop<string | undefined>(parent, 'localName') !== 'picture') counts.media++;
      remove(el);
    } else if (ns === SVG_NS && SVG_ANIMATION.has(name) && /href$|^on/i.test(attr(el, 'attributeName') ?? '')) {
      remove(el);
    } else {
      if (ns === SVG_NS && (name === 'image' || name === 'feimage')) {
        const href = attr(el, 'href') ?? attr(el, 'xlink:href');
        if (href !== null && !href.trim().startsWith('#')) counts.images++;
      }
      let target = el;
      if (ns === HTML_NS && (name === 'xmp' || name === 'plaintext')) {
        // Raw text shown as it is: the same look as <pre>, and its text escaped when serialized.
        const pre = create('pre');
        for (const a of attributes(el)) setAttr(pre, a.name, a.value);
        call(pre, 'append', ...childNodes(el));
        call(el, 'replaceWith', pre);
        target = pre;
      }
      cleanAttributes(target, name === 'xmp' || name === 'plaintext' ? 'pre' : name, ns);
    }
  }

  if (masked !== input) {
    // A text or a comment that held `<base` gets it back.
    const walker = call<TreeWalker>(parsed, 'createTreeWalker', body, 0x84 /* SHOW_TEXT | SHOW_COMMENT */);
    for (let node = call<Node | null>(walker, 'nextNode'); node; node = call<Node | null>(walker, 'nextNode')) {
      const data = prop<string>(node, 'data');
      if (data.includes(BASE_MARK)) node.textContent = unmask(data);
    }
  }

  return { body, htmlAttrs, bodyAttrs, sheets, inline, counts };
};
