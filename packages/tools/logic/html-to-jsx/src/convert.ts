/**
 * HTML to JSX (docs/tools/specs/html-to-jsx.md §5, §9). The browser parses the markup — `parseFromString` of a whole
 * document, which runs nothing, loads nothing and reports no policy violation — and this module walks the tree it
 * built and writes JSX text. The walk and the layout are loops over explicit stacks, never recursion, so a tree as deep
 * as a parser builds cannot overflow the call stack; each element is turned into text once, and its one-line form is
 * built only while it is at most a line wide.
 */
import {
  CDATA,
  COMMENT,
  ELEMENT,
  SVG_NS,
  TEXT,
  attributesOf,
  bodyOf,
  dataOf,
  documentElementOf,
  firstChild,
  localName,
  namespaceOf,
  nextSibling,
  nodeType,
  templateContent,
  textContentOf,
} from './dom.ts';
import { handlerValue } from './handler.ts';
import { INDENT, LINE_WIDTH, MAX_INDENT_LEVEL } from './limits.ts';
import { styleToObject } from './style.ts';
import { BLOCK_ELEMENTS, BOOLEAN_PROPS, EVENT_PROPS, FORM_FIELDS, NOT_CUSTOM, NUMERIC_PROPS } from './tables.ts';
import {
  canonicalNumber,
  escapeJsxAttribute,
  escapeJsxText,
  hasLineBreak,
  jsString,
  jsxComment,
  templateLiteral,
} from './text.ts';
import type { AttributeNames } from './names.ts';

/** Parses markup as a whole HTML document: `(s) => new DOMParser().parseFromString(s, 'text/html')`. */
export type ParseHtml = (markup: string) => Document;

export interface JsxOptions {
  /** Wrap the result in `export default function Component() { return (…); }`. */
  component: boolean;
}

export type JsxNote =
  | { kind: 'document' }
  | { kind: 'handlers'; count: number }
  | { kind: 'unknownEvents'; names: string[] }
  | { kind: 'unreadableHandlers'; names: string[] }
  | { kind: 'unwritable'; names: string[] }
  | { kind: 'important' }
  | { kind: 'selected' }
  | { kind: 'script' };

/** The JSX (ending with one line break, or empty) and the notes, in the order they are shown. Never fails. */
export interface JsxResult {
  text: string;
  notes: JsxNote[];
}

// ---- Parsing (§5 «Разбор»)

const DOCUMENT_START = /^[ \t\n\f\r]*<(?:!doctype|html(?=[ \t\n\f\r/>]|$))/i;
/** What a fragment starting with a part of a table is parsed inside, so that the parser keeps it (§5 «Разбор» п. 2). */
const WRAPPERS: Readonly<Record<string, readonly string[]>> = {
  tr: ['table', 'tbody'],
  td: ['table', 'tbody', 'tr'],
  th: ['table', 'tbody', 'tr'],
  tbody: ['table'],
  thead: ['table'],
  tfoot: ['table'],
  caption: ['table'],
  colgroup: ['table'],
  col: ['table', 'colgroup'],
};

const isHtmlSpace = (c: string | undefined): boolean =>
  c === ' ' || c === '\t' || c === '\n' || c === '\f' || c === '\r';

/** The name of the first tag, past leading whitespace and comments; null when the input starts with text. */
const firstTagName = (markup: string): string | null => {
  let i = 0;
  const skipSpace = (): void => {
    while (isHtmlSpace(markup[i])) i++;
  };
  skipSpace();
  while (markup.startsWith('<!--', i)) {
    const end = markup.indexOf('-->', i + 4);
    if (end === -1) return null;
    i = end + 3;
    skipSpace();
  }
  const m = /^<([a-zA-Z][^\s/>]*)/.exec(markup.slice(i, i + 64));
  return m ? m[1]!.toLowerCase() : null;
};

const firstElementNamed = (parent: Node, name: string): Element | null => {
  for (let node = firstChild(parent); node; node = nextSibling(node))
    if (nodeType(node) === ELEMENT && localName(node as Element) === name) return node as Element;
  return null;
};

/**
 * The two tags Chrome reports even in a document no one sees (measured on an extension page with our policy): a
 * `<base href>` sets the document's base address, which `base-uri 'none'` refuses with a violation and a console error,
 * and the contents of a `<template>` go to a document of their own where every `style` attribute is a `style-src-attr`
 * violation and a console error. So before parsing, these tag names get a sentinel character appended (`<base` →
 * `<base\u{FDD0}`): the parser builds ordinary unknown elements instead, which the walk names back (and writes `base`
 * as the void element it is). The sentinel is the first noncharacter U+FDD0–U+FDEF the input does not hold, and it is
 * removed from every text, comment, attribute and name read back, so the input's own characters are untouched. A
 * template's children are then parsed as in the body, not in a template's own mode: table rows directly inside a
 * `<template>` are dropped by the parser, as anywhere outside a table.
 */
const SHIELDED = /<(\/?)(base|template)(?=[\t\n\f\r />]|$)/gi;

const shield = (markup: string): { text: string; sentinel: string | null } => {
  if (!new RegExp(SHIELDED.source, 'i').test(markup)) return { text: markup, sentinel: null };
  for (let code = 0xfdd0; code <= 0xfdef; code++) {
    const sentinel = String.fromCharCode(code);
    if (markup.includes(sentinel)) continue;
    const text = markup.replace(SHIELDED, (tag: string, slash: string, name: string) =>
      slash && name.toLowerCase() === 'base' ? tag : tag + sentinel,
    );
    return { text, sentinel };
  }
  return { text: markup, sentinel: null };
};

/**
 * Picks what is converted (§5 «Разбор»): a whole document (the input starts with `<!doctype` or `<html`) — its body;
 * otherwise the markup is parsed after `<!doctype html><body>` (so `<meta>`, `<title>`, `<style>`, `<script>` stay where
 * they are instead of moving to `<head>`, in standards mode) and inside a table when it starts with a part of one.
 * `sentinel` is the character appended to `base` and `template` tags before parsing (`shield`), null when none was.
 */
export const parseMarkup = (
  markup: string,
  parse: ParseHtml,
): { container: ParentNode; document: boolean; sentinel: string | null } => {
  const { text, sentinel } = shield(markup);
  if (DOCUMENT_START.test(markup)) {
    const document = parse(text);
    return { container: bodyOf(document) ?? documentElementOf(document) ?? document, document: true, sentinel };
  }
  const wrappers = WRAPPERS[firstTagName(markup) ?? ''] ?? [];
  const document = parse(`<!doctype html><body>${wrappers.map(w => `<${w}>`).join('')}${text}`);
  let container: ParentNode = bodyOf(document) ?? document;
  for (const name of wrappers) {
    const next = firstElementNamed(container, name);
    if (!next) break;
    container = next;
  }
  return { container, document: false, sentinel };
};

// ---- Attributes (§5 «Атрибуты»)

/** A name JSX writes as an attribute (others go into a spread object, so no name can break the tag). */
const JSX_ATTRIBUTE = /^[A-Za-z_$][\w$-]*$/;
/** A name JSX writes as an intrinsic element and React accepts as a tag. */
const JSX_ELEMENT = /^[a-z][\w-]*$/;

const isCustomName = (element: string): boolean => element.includes('-') && !NOT_CUSTOM.has(element);

/**
 * The React property for an attribute (§5 «Атрибуты» п. 4): its lower-case name looked up in the table, or the name as
 * written (`id`, `role`, `hx-get`). A custom element keeps every name as written but `class` — React passes props to
 * it as attributes, and writes `className` there as `class`.
 */
export const reactAttributeName = (
  name: string,
  element: string,
  names: AttributeNames,
  custom: boolean = isCustomName(element),
): string => {
  const lower = name.toLowerCase();
  if (custom) return lower === 'class' ? 'className' : name;
  return names.get(lower) ?? name;
};

/** `name="value"`, or `name={'…'}` for a value with a line break, or a spread for a name JSX cannot write. */
const stringProp = (prop: string, value: string): string => {
  if (!JSX_ATTRIBUTE.test(prop)) return `{...{ ${jsString(prop)}: ${jsString(value)} }}`;
  return hasLineBreak(value) ? `${prop}={${jsString(value)}}` : `${prop}="${escapeJsxAttribute(value)}"`;
};

const collapse = (text: string): string => text.replace(/[ \t\n\f\r]+/g, ' ');

/** An option's value as HTML reads it: its `value` attribute, else its text with whitespace stripped and collapsed. */
const optionValue = (attributes: Array<[string, string]>, option: Element, clean: (text: string) => string): string => {
  const value = attributes.find(([name]) => name.toLowerCase() === 'value');
  return value ? value[1] : collapse(clean(textContentOf(option))).trim();
};

// ---- The tree being written

/** Whitespace that waits for its neighbours to decide whether it shows (one space, or nothing). */
interface Gap {
  newline: boolean;
  /** It touches text (the end of a text before it). */
  fromText: boolean;
}

interface ElementItem {
  kind: 'element';
  name: string;
  attributes: string[];
  children: Item[];
  block: boolean;
  /** `<name attr …` — the opening tag without its end. */
  open: string;
  /** The whole element on one line when that is at most LINE_WIDTH and allowed (§5 «Раскладка» п. 2), else null. */
  inline: string | null;
  /** An inline element's whitespace at the start and the end of its children, handed to its parent (see arrange). */
  lead: Gap | null;
  trail: Gap | null;
}
type Item =
  | ElementItem
  /** JSX text: escaped, collapsed, no whitespace at its edges. */
  | { kind: 'text'; text: string }
  /** A significant space: ` ` inside a line, `{' '}` on a line of its own. */
  | { kind: 'space' }
  /** A comment or an expression child (a template literal): written as it is. */
  | { kind: 'code'; text: string };
/** A child before whitespace is decided: text as parsed. */
type Raw = Item | { kind: 'raw'; data: string };

const SPACE: Item = { kind: 'space' };

/**
 * Inline elements whose inside is a box of its own (inline-block, replaced): whitespace at the edges of their children
 * is at the edge of a line and does not show, as inside a block element.
 */
const INLINE_BOXES: ReadonlySet<string> = new Set([
  'button',
  'video',
  'audio',
  'iframe',
  'object',
  'canvas',
  'svg',
  'math',
]);
/** SVG elements that hold text; in the others whitespace between children is formatting and is left out. */
const SVG_TEXT: ReadonlySet<string> = new Set(['text', 'tspan', 'textPath', 'a', 'title', 'desc']);
/** SVG elements whose children's edge whitespace belongs to the surrounding text. */
const SVG_INLINE: ReadonlySet<string> = new Set(['tspan', 'textPath', 'a']);

interface SelectState {
  multiple: boolean;
  values: string[];
}

interface Frame {
  next: Node | null;
  raw: Raw[];
  pre: boolean;
  /** Whitespace-only text here is formatting (inside SVG, outside its text elements): left out. */
  svgSpace: boolean;
  /** Whitespace at the edges of the children is handed to the parent (an inline element). */
  edgesOut: boolean;
  select: SelectState | null;
  /** null for the container and for an element JSX cannot name (its children go to its parent). */
  element: ElementItem | null;
  ownSelect: SelectState | null;
  /** Props written so far on this element (the first of a repeated one is kept). */
  props: Set<string> | null;
}

interface Context {
  names: AttributeNames;
  /** Removes the sentinel of `shield` from what the parser read. */
  clean: (text: string) => string;
  handlers: number;
  unknownEvents: Set<string>;
  unreadableHandlers: Set<string>;
  unwritable: Set<string>;
  important: boolean;
  selected: boolean;
  script: boolean;
}

const merge = (a: Gap | null, b: Gap): Gap =>
  a === null ? b : { newline: a.newline || b.newline, fromText: a.fromText || b.fromText };
const hasNewline = (text: string): boolean => text.includes('\n') || text.includes('\r');

/**
 * Whitespace between children (§5 «Текст и пробелы»), as a browser shows it: runs collapse to one space; whitespace
 * at the start or the end of a block's children goes; between two neighbours it stays as one space unless a neighbour
 * is a block element and the run either held a line break or touches text. Comments are transparent: whitespace on
 * both sides of one is one run. An inline element's own edge whitespace (`<a> link </a>`) is not dropped but handed to
 * its parent (`edgesOut`), where it joins the whitespace around the element: `x<a> link </a>y` → `x <a>link</a> y`.
 */
const arrange = (raw: Raw[], edgesOut: boolean): { items: Item[]; lead: Gap | null; trail: Gap | null } => {
  const out: Item[] = [];
  let prevBlock: boolean | null = null; // null: nothing visible yet
  let pending: Gap | null = null;
  let lead: Gap | null = null;
  const gap = (newline: boolean, fromText: boolean): void => {
    if (prevBlock === null) {
      if (edgesOut) lead = merge(lead, { newline, fromText });
    } else pending = merge(pending, { newline, fromText });
  };
  const spaceBefore = (nextBlock: boolean, nextIsText: boolean): void => {
    if (pending !== null && prevBlock !== null) {
      const blockSide = prevBlock || nextBlock;
      if (!blockSide || (!pending.newline && !pending.fromText && !nextIsText)) out.push(SPACE);
    }
    pending = null;
  };
  for (const entry of raw) {
    if (entry.kind === 'code') {
      out.push(entry);
      continue;
    }
    if (entry.kind === 'element') {
      // The element's own edge whitespace touches its content, as whitespace touches text.
      if (entry.lead) gap(entry.lead.newline, entry.lead.fromText || entry.children.length > 0);
      spaceBefore(entry.block, false);
      out.push(entry);
      prevBlock = entry.block;
      if (entry.trail) gap(entry.trail.newline, true);
      continue;
    }
    if (entry.kind !== 'raw') continue;
    const data = entry.data;
    let start = 0;
    while (start < data.length && isHtmlSpace(data[start])) start++;
    if (start === data.length) {
      gap(hasNewline(data), false);
      continue;
    }
    if (start > 0) gap(hasNewline(data.slice(0, start)), false);
    spaceBefore(false, true);
    let end = data.length;
    while (end > start && isHtmlSpace(data[end - 1])) end--;
    out.push({ kind: 'text', text: escapeJsxText(collapse(data.slice(start, end))) });
    prevBlock = false;
    if (end < data.length) gap(hasNewline(data.slice(end)), true);
  }
  return { items: out, lead, trail: edgesOut ? pending : null };
};

/** The element on one line, or null (§5 «Раскладка» п. 2): no line break, no block child, at most LINE_WIDTH. */
const inlineOf = (element: ElementItem): string | null => {
  const { open, name, children } = element;
  if (open.length > LINE_WIDTH || open.includes('\n')) return null;
  if (children.length === 0) {
    const line = `${open} />`;
    return line.length <= LINE_WIDTH ? line : null;
  }
  let line = `${open}>`;
  for (const child of children) {
    let piece: string;
    if (child.kind === 'element') {
      if (child.block || child.inline === null) return null;
      piece = child.inline;
    } else if (child.kind === 'space') piece = ' ';
    else {
      piece = child.text;
      if (piece.length > LINE_WIDTH || piece.includes('\n')) return null;
    }
    line += piece;
    if (line.length > LINE_WIDTH) return null;
  }
  line += `</${name}>`;
  return line.length <= LINE_WIDTH ? line : null;
};

const finishElement = (element: ElementItem): ElementItem => {
  element.open =
    element.attributes.length === 0 ? `<${element.name}` : `<${element.name} ${element.attributes.join(' ')}`;
  element.inline = inlineOf(element);
  return element;
};

/** Converts one element's attributes (§5 «Атрибуты», in its order) into `frame.element.attributes`. */
const convertAttributes = (
  node: Element,
  name: string,
  attributes: Array<[string, string]>,
  element: ElementItem,
  props: Set<string>,
  parent: Frame,
  context: Context,
): void => {
  const custom = isCustomName(name) || attributes.some(([n]) => n.toLowerCase() === 'is');
  const field = FORM_FIELDS.has(name) && !custom;
  const add = (prop: string, text: string): void => {
    if (props.has(prop)) return;
    props.add(prop);
    element.attributes.push(text);
  };
  for (const [attribute, raw] of attributes) {
    let value = raw;
    const lower = attribute.toLowerCase();
    if (lower === 'style') {
      const style = styleToObject(value);
      if (style.important) context.important = true;
      if (style.text !== null) add('style', `style={${style.text}}`);
      continue;
    }
    if (lower.length > 2 && lower.startsWith('on')) {
      const prop = EVENT_PROPS.get(lower);
      if (prop === undefined) {
        context.unknownEvents.add(attribute);
        continue;
      }
      const code = handlerValue(value);
      if (code === null) {
        context.unreadableHandlers.add(attribute);
        continue;
      }
      if (props.has(prop)) continue;
      context.handlers++;
      add(prop, `${prop}=${code}`);
      continue;
    }
    if (lower.startsWith('data-') || lower.startsWith('aria-')) {
      add(attribute, stringProp(attribute, value));
      continue;
    }
    let prop = reactAttributeName(attribute, name, context.names, custom);
    if (custom) {
      add(prop, stringProp(prop, value));
      continue;
    }
    if (field && prop === 'value') prop = 'defaultValue';
    else if (field && prop === 'checked') prop = 'defaultChecked';
    if (name === 'option' && prop === 'selected' && parent.select) {
      parent.select.values.push(optionValue(attributes, node, context.clean));
      context.selected = true;
      continue;
    }
    if (BOOLEAN_PROPS.has(prop)) {
      add(prop, prop);
      continue;
    }
    if (NUMERIC_PROPS.has(prop)) {
      const n = canonicalNumber(value);
      if (n !== null) {
        add(prop, `${prop}={${n}}`);
        continue;
      }
    }
    if (prop === 'contentEditable' && value === '') value = 'true';
    add(prop, stringProp(prop, value));
  }
};

/** Walks the container's children into items — a loop over a stack of frames, one per open element. */
const walk = (container: ParentNode, sentinel: string | null, context: Context): Item[] => {
  context.clean = text => (sentinel === null ? text : text.replaceAll(sentinel, ''));
  const clean = context.clean;
  const root: Frame = {
    next: firstChild(container),
    raw: [],
    pre: false,
    svgSpace: false,
    edgesOut: false,
    select: null,
    element: null,
    ownSelect: null,
    props: null,
  };
  const stack: Frame[] = [root];
  const push = (frame: Frame, entry: Raw): void => {
    if (entry.kind === 'raw' && frame.pre) frame.raw.push({ kind: 'code', text: `{${templateLiteral(entry.data)}}` });
    else if (entry.kind === 'raw' && frame.svgSpace && /^[ \t\n\f\r]*$/.test(entry.data)) return;
    else frame.raw.push(entry);
  };
  for (;;) {
    const frame = stack.at(-1)!;
    const node = frame.next;
    if (node === null) {
      if (frame === root) break;
      stack.pop();
      const parent = stack.at(-1)!;
      const element = frame.element;
      if (element === null) {
        for (const entry of frame.raw) push(parent, entry); // a name JSX cannot write: its children stay
        continue;
      }
      if (frame.pre) element.children = frame.raw as Item[];
      else {
        const arranged = arrange(frame.raw, frame.edgesOut);
        element.children = arranged.items;
        element.lead = arranged.lead;
        element.trail = arranged.trail;
      }
      const select = frame.ownSelect;
      if (select && select.values.length > 0 && !frame.props!.has('defaultValue')) {
        // A single select shows the last option marked selected (the HTML Standard's selectedness setting algorithm).
        element.attributes.push(
          select.multiple
            ? `defaultValue={[${select.values.map(jsString).join(', ')}]}`
            : stringProp('defaultValue', select.values.at(-1)!),
        );
      }
      push(parent, finishElement(element));
      continue;
    }
    frame.next = nextSibling(node);
    const type = nodeType(node);
    if (type === TEXT || type === CDATA) {
      push(frame, { kind: 'raw', data: clean(dataOf(node)) });
      continue;
    }
    if (type === COMMENT) {
      push(frame, { kind: 'code', text: jsxComment(clean(dataOf(node))) });
      continue;
    }
    if (type !== ELEMENT) continue;
    const el = node as Element;
    const parsedName = localName(el);
    const shielded = sentinel !== null && parsedName.endsWith(sentinel);
    const name = clean(parsedName);
    if (!JSX_ELEMENT.test(name)) {
      context.unwritable.add(name);
      stack.push({ ...frame, next: firstChild(el), raw: [], element: null, ownSelect: null, props: null });
      continue;
    }
    const attributes = attributesOf(el).map(([n, v]): [string, string] => [clean(n), clean(v)]);
    const element: ElementItem = {
      kind: 'element',
      name,
      attributes: [],
      children: [],
      block: BLOCK_ELEMENTS.has(name),
      open: '',
      inline: null,
      lead: null,
      trail: null,
    };
    const svg = namespaceOf(el) === SVG_NS;
    const props = new Set<string>();
    if (shielded && name === 'base' && !svg) {
      // Parsed as an unknown element, it took what followed as its children: they are its siblings.
      convertAttributes(el, name, attributes, element, props, frame, context);
      push(frame, finishElement(element));
      stack.push({ ...frame, next: firstChild(el), raw: [], element: null, ownSelect: null, props: null });
      continue;
    }
    if (name === 'textarea') {
      const content = clean(textContentOf(el));
      if (content !== '') props.add('defaultValue');
      convertAttributes(el, name, attributes, element, props, frame, context);
      if (content !== '') element.attributes.push(stringProp('defaultValue', content));
      push(frame, finishElement(element));
      continue;
    }
    convertAttributes(el, name, attributes, element, props, frame, context);
    if (name === 'script' || name === 'style') {
      if (name === 'script') context.script = true;
      const content = clean(textContentOf(el));
      if (content !== '') element.children = [{ kind: 'code', text: `{${templateLiteral(content)}}` }];
      push(frame, finishElement(element));
      continue;
    }
    const ownSelect =
      name === 'select' ? { multiple: attributes.some(([n]) => n.toLowerCase() === 'multiple'), values: [] } : null;
    stack.push({
      next: firstChild(name === 'template' ? (templateContent(el) ?? el) : el),
      raw: [],
      pre: frame.pre || name === 'pre',
      svgSpace: svg && !SVG_TEXT.has(name),
      edgesOut: svg ? SVG_INLINE.has(name) : !element.block && !INLINE_BOXES.has(name),
      select: ownSelect ?? frame.select,
      element,
      ownSelect,
      props,
    });
  }
  return arrange(root.raw, false).items;
};

// ---- Layout (§5 «Раскладка»)

const indents: string[] = [];
const indent = (level: number): string => {
  const capped = Math.min(level, MAX_INDENT_LEVEL);
  return (indents[capped] ??= ' '.repeat(capped * INDENT));
};

type Task = { item: Item; level: number } | { line: string };

/** Writes items one per line from `level`, elements on one line where they fit; a loop over a stack of tasks. */
const layout = (items: Item[], level: number, lines: string[]): void => {
  const tasks: Task[] = [];
  for (let i = items.length - 1; i >= 0; i--) tasks.push({ item: items[i]!, level });
  while (tasks.length > 0) {
    const task = tasks.pop()!;
    if ('line' in task) {
      lines.push(task.line);
      continue;
    }
    const { item, level: at } = task;
    const pad = indent(at);
    if (item.kind === 'text' || item.kind === 'code') {
      lines.push(pad + item.text);
      continue;
    }
    if (item.kind === 'space') {
      lines.push(`${pad}{' '}`);
      continue;
    }
    if (item.inline !== null && pad.length + item.inline.length <= LINE_WIDTH) {
      lines.push(pad + item.inline);
      continue;
    }
    const empty = item.children.length === 0;
    const end = empty ? ' />' : '>';
    const split =
      item.attributes.length > 0 &&
      (pad.length + item.open.length + end.length > LINE_WIDTH || item.open.includes('\n'));
    if (split) {
      lines.push(`${pad}<${item.name}`);
      const inner = indent(at + 1);
      for (const attribute of item.attributes) lines.push(inner + attribute);
      lines.push(pad + end.trim());
    } else lines.push(pad + item.open + end);
    if (empty) continue;
    tasks.push({ line: `${pad}</${item.name}>` });
    for (let i = item.children.length - 1; i >= 0; i--) tasks.push({ item: item.children[i]!, level: at + 1 });
  }
};

/** The JSX of the roots: one element as it is, anything else in a fragment; in a component when asked (п. 5–7). */
const render = (roots: Item[], options: JsxOptions): string => {
  if (roots.length === 0) return '';
  const lines: string[] = [];
  const base = options.component ? 2 : 0;
  if (options.component) lines.push('export default function Component() {', `${indent(1)}return (`);
  if (roots.length === 1 && roots[0]!.kind === 'element') layout(roots, base, lines);
  else {
    lines.push(`${indent(base)}<>`);
    layout(roots, base + 1, lines);
    lines.push(`${indent(base)}</>`);
  }
  if (options.component) lines.push(`${indent(1)});`, '}');
  return `${lines.join('\n')}\n`;
};

/**
 * Converts markup to JSX (§5). `parse` is the caller's HTML parser (a page passes its DOMParser, tests jsdom's);
 * `names` is the table of attribute names (loadAttributeNames).
 */
export const htmlToJsx = (markup: string, options: JsxOptions, parse: ParseHtml, names: AttributeNames): JsxResult => {
  const { container, document, sentinel } = parseMarkup(markup, parse);
  const context: Context = {
    names,
    clean: text => text,
    handlers: 0,
    unknownEvents: new Set(),
    unreadableHandlers: new Set(),
    unwritable: new Set(),
    important: false,
    selected: false,
    script: false,
  };
  const roots = walk(container, sentinel, context);
  const notes: JsxNote[] = [];
  if (document) notes.push({ kind: 'document' });
  if (context.handlers > 0) notes.push({ kind: 'handlers', count: context.handlers });
  if (context.unknownEvents.size > 0) notes.push({ kind: 'unknownEvents', names: [...context.unknownEvents] });
  if (context.unreadableHandlers.size > 0)
    notes.push({ kind: 'unreadableHandlers', names: [...context.unreadableHandlers] });
  if (context.unwritable.size > 0) notes.push({ kind: 'unwritable', names: [...context.unwritable] });
  if (context.important) notes.push({ kind: 'important' });
  if (context.selected) notes.push({ kind: 'selected' });
  if (context.script) notes.push({ kind: 'script' });
  return { text: render(roots, options), notes };
};

/** The notes' words, one line each (§5 «Заметки»). */
export const describeNotes = (notes: JsxNote[]): string[] =>
  notes.map(note => {
    switch (note.kind) {
      case 'document':
        return 'Converted the contents of <body>; <head> and the doctype were left out.';
      case 'handlers':
        return note.count === 1
          ? '1 inline event handler became an arrow function with the same code: check it.'
          : `${note.count} inline event handlers became arrow functions with the same code: check them.`;
      case 'unknownEvents':
        return `Unknown event attributes left out: ${note.names.join(', ')}.`;
      case 'unreadableHandlers':
        return `Event attributes whose code does not balance left out: ${note.names.join(', ')}.`;
      case 'unwritable':
        return `Elements JSX cannot name left out, their contents kept: ${note.names.join(', ')}.`;
      case 'important':
        return '!important was dropped from inline styles: React style objects cannot carry it.';
      case 'selected':
        return 'selected on <option> became defaultValue on its <select>.';
      case 'script':
        return 'A <script> rendered by React on the client does not run.';
    }
  });
