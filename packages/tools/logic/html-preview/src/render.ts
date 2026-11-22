/**
 * The page's half of the preview (docs/tools/specs/html-preview.md §5.3): it puts the checked document into the frame's
 * — the sandboxed srcdoc frame of @workspace/ui/framed-document, whose own policy lets nothing load. The nodes are
 * imported (never markup), the sheets are constructed in the frame's window and adopted, each inline style is set
 * through CSSOM: a policy governs neither, so the pasted look is shown under `style-src 'none'` (verified in the built
 * extension, §11). Every read and write goes through dom.ts: the imported content cannot shadow what this code uses.
 */
import { assign, attributes, call, prop, removeAttr, setAttr } from './dom';
import type { SanitizedHtml } from './logic';

/**
 * The frame's own sheet, first — the pasted sheets after it override it (§5.3): a light page whatever the extension's
 * theme (dark text of a mail on a dark page would be unreadable), the font a page has without styles (Chrome gives an
 * extension's pages — this document keeps the extension's origin — its own `body { font-family: system-ui; font-size:
 * 75% }`; `inherit` takes the browser's defaults from <html> back), an image's frame, a link that does not open.
 */
export const BASE_CSS = [
  ':root { color-scheme: light; background: Canvas; color: CanvasText; }',
  'body { font-family: inherit; font-size: inherit; }',
  '.html-preview-image { display: inline-block; box-sizing: border-box; max-width: 100%; overflow: hidden;' +
    ' padding: 0 4px; border: 1px dashed GrayText; color: GrayText; font: 12px/1.4 sans-serif;' +
    ' vertical-align: middle; text-align: center; }',
  'a:not([href])[title^="Not opened: "] { cursor: help; }',
].join('\n');

/**
 * A table with more columns than this (cells by their span, or column groups) gets separate borders whatever its CSS
 * says (§12, §15): Chrome lays out a table with collapsed borders in time that grows faster than its columns — one row
 * of 131 072 cells took 50.8 s with collapsed borders and 0.18 s with separate ones (Chrome for Testing 159, the built
 * extension); a mail's layout table has a few dozen.
 */
export const WIDE_TABLE_COLUMNS = 1000;

/** The documents whose forms are already held back. */
const guarded = new WeakSet<Document>();

/** Is the event's target (or what it is in) a control that would submit its form: a submit button or a field's Enter? */
const submits = (event: Event): boolean => {
  const target = event.target as Element | null;
  if (!target || typeof (target as Partial<Element>).closest !== 'function') return false;
  const control = call<Element | null>(target, 'closest', 'button, input');
  if (!control) return false;
  const type = (call<string | null>(control, 'getAttribute', 'type') ?? '').trim().toLowerCase();
  const form = prop<HTMLFormElement | null>(control, 'form');
  if (!form) return false;
  if (event.type === 'keydown')
    return (event as KeyboardEvent).key === 'Enter' && prop<string>(control, 'localName') === 'input';
  return prop<string>(control, 'localName') === 'button'
    ? type === '' || type === 'submit'
    : type === 'submit' || type === 'image';
};

/**
 * §5.2 step 8: fields can be filled, a form is never sent. The sandbox refuses every submission (no `allow-forms`) but
 * writes an error to the page's console each time; the page holds the press back before it becomes a submission —
 * listeners of the page on the frame's document (nothing runs in the frame). Once per document.
 */
const holdForms = (doc: Document): void => {
  if (guarded.has(doc)) return;
  guarded.add(doc);
  const stop = (event: Event): void => {
    if (event.type === 'submit' || submits(event)) event.preventDefault();
  };
  for (const type of ['click', 'keydown', 'submit']) call(doc, 'addEventListener', type, stop, true);
};

/** How many columns the table has: its widest row (each cell by its span) or its column groups, whichever is more. */
const columnsOf = (table: HTMLTableElement): number => {
  let widest = 0;
  for (const row of Array.from(prop<HTMLCollectionOf<HTMLTableRowElement>>(table, 'rows'))) {
    let width = 0;
    for (const cell of Array.from(prop<HTMLCollectionOf<HTMLTableCellElement>>(row, 'cells')))
      width += prop<number>(cell, 'colSpan');
    widest = Math.max(widest, width);
  }
  let groups = 0;
  for (const group of Array.from(
    call<NodeListOf<Element>>(table, 'querySelectorAll', ':scope > colgroup, :scope > col'),
  )) {
    const cols = Array.from(call<NodeListOf<HTMLTableColElement>>(group, 'querySelectorAll', ':scope > col'));
    groups +=
      cols.length === 0 ? prop<number>(group, 'span') : cols.reduce((n, col) => n + prop<number>(col, 'span'), 0);
  }
  return Math.max(widest, groups);
};

const applyStyle = (el: Element, css: string): void => {
  assign(prop<CSSStyleDeclaration>(el, 'style'), 'cssText', css);
};

/** The data-preview-style numbers of an element's attributes as the frame's element takes them (§5.3 step 4). */
const setAttributes = (el: Element, list: Array<[string, string]>, inline: string[]): void => {
  for (const a of attributes(el)) removeAttr(el, a.name);
  for (const [name, value] of list) {
    if (name === 'data-preview-style') applyStyle(el, inline[Number(value)] ?? '');
    else setAttr(el, name, value);
  }
};

/** §5.3: the checked document into the frame's (its <html>, <body> and adopted sheets). */
export const renderInto = (doc: Document, result: SanitizedHtml): void => {
  const view = prop<(Window & typeof globalThis) | null>(doc, 'defaultView');
  if (!view) throw new TypeError('renderInto needs the frame’s document, with its window');
  const root = prop<HTMLElement>(doc, 'documentElement');
  const body = prop<HTMLElement>(doc, 'body');
  const scroller = prop<Element | null>(doc, 'scrollingElement');
  const scroll = scroller ? [prop<number>(scroller, 'scrollLeft'), prop<number>(scroller, 'scrollTop')] : null;

  setAttributes(root, result.htmlAttrs, result.inline);
  setAttributes(body, result.bodyAttrs, result.inline);
  const copy = call<HTMLElement>(doc, 'importNode', result.body, true);
  call(body, 'replaceChildren', ...Array.from(prop<NodeListOf<ChildNode>>(copy, 'childNodes')));

  assign(
    doc,
    'adoptedStyleSheets',
    [BASE_CSS, ...result.sheets].map(text => {
      const sheet = new view.CSSStyleSheet();
      sheet.replaceSync(text);
      return sheet;
    }),
  );

  for (const el of Array.from(call<NodeListOf<Element>>(body, 'querySelectorAll', '[data-preview-style]'))) {
    const n = Number(call<string>(el, 'getAttribute', 'data-preview-style'));
    removeAttr(el, 'data-preview-style');
    applyStyle(el, result.inline[n] ?? '');
  }

  for (const table of Array.from(call<NodeListOf<HTMLTableElement>>(body, 'querySelectorAll', 'table')))
    if (columnsOf(table) > WIDE_TABLE_COLUMNS)
      call(prop<CSSStyleDeclaration>(table, 'style'), 'setProperty', 'border-collapse', 'separate', 'important');

  holdForms(doc);

  if (scroller && scroll) {
    assign(scroller, 'scrollLeft', scroll[0]);
    assign(scroller, 'scrollTop', scroll[1]);
  }
};
