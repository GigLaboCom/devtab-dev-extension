// @vitest-environment node
import examples from './examples.json' with { type: 'json' };
import { htmlToJsx, loadAttributeNames, parseMarkup } from '@workspace/tool-logic-html-to-jsx';
import { transformSync } from 'esbuild';
import { JSDOM } from 'jsdom';
import { createElement } from 'react';
import * as jsxRuntime from 'react/jsx-runtime';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { runInNewContext } from 'node:vm';
import type { AttributeNames } from '@workspace/tool-logic-html-to-jsx';
import type { ComponentType, ReactElement } from 'react';

// docs/tools/specs/html-to-jsx.md §10 «render»: every example's result compiles (esbuild, as JSX and as TSX, with no
// warning), and rendered by the workspace's React gives the markup the input parses to. Equality is judged on a
// canonical form written here independently of the tool's rules: elements and attributes (names in lower case, sorted;
// `style` as its declarations), comments left out, and text whitespace as CSS shows it — runs collapse, across inline
// element boundaries too, and whitespace at the edges of block elements and of inline boxes (button, svg…) does not
// show. A row's `allow` names the differences that are expected (examples.json). Then the hostile inputs, and a seeded
// set of generated documents.

type Allowance =
  | 'preload' // React 19 puts <link rel="preload"> before an <img> it renders
  | 'important' // a React style object cannot carry !important
  | 'repeated-style' // a repeated declaration: the last one is the one CSS applies
  | 'handlers' // React attaches handlers as listeners, never as attributes; unknown ones are left out
  | 'flag-value' // a flag's value: disabled="disabled", disabled="false" and disabled="" are one thing in HTML
  | 'contenteditable' // contenteditable="" means "true"
  | 'invalid-names'; // React drops attributes whose names it cannot set (@click, a"b), with a warning

interface Example {
  input: string;
  component?: boolean;
  allow?: Allowance[];
}

let names: AttributeNames;
const errors: string[] = [];
beforeAll(async () => {
  names = await loadAttributeNames();
  // React's development warnings (invalid attribute names, contentEditable with children): kept, not printed.
  vi.spyOn(console, 'error').mockImplementation((...args: unknown[]) => void errors.push(args.map(String).join(' ')));
});
afterAll(() => vi.restoreAllMocks());

// esbuild needs Node's own TextEncoder, which the jsdom environment replaces: this file runs in Node, with jsdom's
// parser from a window of its own.
const { DOMParser } = new JSDOM('').window;
const parse = (markup: string): Document => new DOMParser().parseFromString(markup, 'text/html');

// ---- The canonical form

const BLOCKS = new Set(
  (
    'address article aside blockquote body details dialog dd div dl dt fieldset figcaption figure footer form h1 h2 h3 ' +
    'h4 h5 h6 head header hgroup hr html li main menu nav ol p pre section summary table tbody td tfoot th thead tr ul ' +
    'option select optgroup br caption colgroup col textarea title meta link style script template'
  ).split(' '),
);
const BOXES = new Set(['button', 'video', 'audio', 'iframe', 'object', 'canvas', 'svg', 'math']);
const FLAGS = new Set(
  (
    'allowfullscreen async autofocus autoplay checked controls default defer disabled formnovalidate hidden inert ' +
    'itemscope loop multiple muted nomodule novalidate open playsinline readonly required reversed selected'
  ).split(' '),
);
/** React's attribute-name check (`isAttributeNameSafe`), close enough here: a letter, `_` or `:` first, then `-` `.` too. */
const REACT_ATTRIBUTE = /^[:A-Z_a-z\u{C0}-\u{2FF}\u{370}-\u{1FFF}][:A-Z_a-z\u{C0}-\u{2FF}\u{370}-\u{1FFF}\-.0-9]*$/u;
const SVG_NS = 'http://www.w3.org/2000/svg';
const SVG_TEXT = new Set(['text', 'tspan', 'textPath', 'a', 'title', 'desc']);
const RAW_TEXT = new Set(['pre', 'textarea', 'script', 'style', 'listing']);

/** A style attribute's declarations: `name:value` in order, names in lower case, values with whitespace collapsed. */
const canonicalStyle = (style: string, allow: Set<Allowance>): string => {
  const parts: string[] = [];
  let depth = 0;
  let quote = '';
  let current = '';
  let escaped = false;
  for (const c of style) {
    if (escaped) escaped = false;
    else if (c === '\\') escaped = true;
    else if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") quote = c;
    else if (c === '(') depth++;
    else if (c === ')') depth--;
    else if (c === ';' && depth === 0) {
      parts.push(current);
      current = '';
      continue;
    }
    current += c;
  }
  parts.push(current);
  const declarations = new Map<string, string>();
  const list: string[] = [];
  for (const part of parts) {
    const colon = part.indexOf(':');
    if (colon === -1) continue;
    const name = part.slice(0, colon).trim();
    let value = part
      .slice(colon + 1)
      .trim()
      .replace(/\s+/g, ' ');
    if (allow.has('important')) value = value.replace(/\s*!\s*important$/i, '');
    if (!name || !value) continue;
    const key = name.startsWith('--') ? name : name.toLowerCase();
    if (allow.has('repeated-style')) declarations.delete(key);
    declarations.set(key, value);
    list.push(`${key}:${value}`);
  }
  return allow.has('repeated-style') ? [...declarations].map(([k, v]) => `${k}:${v}`).join(';') : list.join(';');
};

type Token = { kind: 'text'; value: string } | { kind: 'open' | 'close'; box: 'block' | 'box' | 'inline'; tag: string };

const attributesOf = (element: Element, allow: Set<Allowance>): string => {
  const out: Array<[string, string]> = [];
  for (const attribute of Array.from(element.attributes)) {
    const name = attribute.name.toLowerCase();
    let value = attribute.value;
    if (allow.has('handlers') && name.startsWith('on')) continue;
    if (allow.has('invalid-names') && !REACT_ATTRIBUTE.test(attribute.name)) continue;
    if (name === 'style') {
      value = canonicalStyle(value, allow);
      if (value === '') continue;
    }
    if (allow.has('flag-value') && FLAGS.has(name)) value = '';
    if (allow.has('contenteditable') && name === 'contenteditable' && value === '') value = 'true';
    out.push([name, value]);
  }
  out.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return out.map(([n, v]) => ` ${n}=${JSON.stringify(v)}`).join('');
};

const tokens = (node: ParentNode, allow: Set<Allowance>, raw: boolean, svgSpace: boolean, out: Token[]): Token[] => {
  for (const child of Array.from(node.childNodes)) {
    if (child.nodeType === 3) {
      const data = (child as Text).data;
      if (svgSpace && /^[ \t\n\f\r]*$/.test(data)) continue;
      out.push({ kind: 'text', value: raw ? data : data.replace(/[ \t\n\f\r]+/g, ' ') });
    } else if (child.nodeType === 1) {
      const element = child as Element;
      const tag = element.localName;
      if (allow.has('preload') && tag === 'link' && element.getAttribute('rel') === 'preload') continue;
      const box = BLOCKS.has(tag) ? 'block' : BOXES.has(tag) ? 'box' : 'inline';
      const svg = element.namespaceURI === SVG_NS;
      out.push({ kind: 'open', box, tag: `<${tag}${attributesOf(element, allow)}>` });
      const inner = tag === 'template' ? (element as HTMLTemplateElement).content : element;
      tokens(inner, allow, raw || RAW_TEXT.has(tag), svg && !SVG_TEXT.has(tag), out);
      out.push({ kind: 'close', box, tag: `</${tag}>` });
    }
  }
  return out;
};

/** Whitespace as CSS shows it, over the token stream: moved out of inline edges, collapsed, gone at line edges. */
const normalise = (list: Token[]): string => {
  let t = list.filter(x => x.kind !== 'text' || x.value !== '');
  for (let changed = true; changed;) {
    changed = false;
    const next: Token[] = [];
    for (let i = 0; i < t.length; i++) {
      const x = t[i]!;
      const y = t[i + 1];
      if (x.kind === 'text' && y?.kind === 'text') {
        // Adjacent text: one, with a run of spaces across the seam collapsed.
        t[i + 1] = { kind: 'text', value: (x.value + y.value).replace(/ {2,}/g, ' ') };
        changed = true;
        continue;
      }
      if (x.kind === 'open' && x.box === 'inline' && y?.kind === 'text' && y.value.startsWith(' ')) {
        next.push({ kind: 'text', value: ' ' }, x);
        t[i + 1] = { kind: 'text', value: y.value.slice(1) };
        changed = true;
        continue;
      }
      if (x.kind === 'text' && x.value.endsWith(' ') && y?.kind === 'close' && y.box === 'inline') {
        next.push({ kind: 'text', value: x.value.slice(0, -1) }, y, { kind: 'text', value: ' ' });
        i++;
        changed = true;
        continue;
      }
      next.push(x);
    }
    t = next.filter(x => x.kind !== 'text' || x.value !== '');
    // Line edges: the start and the end, block boundaries, the inside of an inline box.
    for (let i = 0; i < t.length; i++) {
      const x = t[i]!;
      if (x.kind !== 'text') continue;
      const before = t[i - 1];
      const after = t[i + 1];
      const edgeBefore =
        !before ||
        (before.kind !== 'text' && (before.box === 'block' || (before.box === 'box' && before.kind === 'open')));
      const edgeAfter =
        !after || (after.kind !== 'text' && (after.box === 'block' || (after.box === 'box' && after.kind === 'close')));
      let value = x.value;
      if (edgeBefore && value.startsWith(' ')) value = value.slice(1);
      if (edgeAfter && value.endsWith(' ')) value = value.slice(0, -1);
      if (value !== x.value) {
        t[i] = { kind: 'text', value };
        changed = true;
      }
    }
    t = t.filter(x => x.kind !== 'text' || x.value !== '');
  }
  return t.map(x => (x.kind === 'text' ? x.value : x.tag)).join('');
};

const canonical = (markup: string, allow: Set<Allowance>): string =>
  normalise(tokens(parseMarkup(markup, parse).container, allow, false, false, []));

// ---- Compiling and rendering

/** Compiles the JSX with esbuild (as JSX and as TSX) and renders it with React; the warnings of both compilers. */
const compileAndRender = (jsx: string, component: boolean): { markup: string; warnings: string[] } => {
  const source = component ? jsx : `export default (\n${jsx});\n`;
  const warnings: string[] = [];
  transformSync(source, { loader: 'tsx', jsx: 'automatic' }).warnings.forEach(w => warnings.push(w.text));
  const built = transformSync(source, { loader: 'jsx', jsx: 'automatic', format: 'cjs' });
  built.warnings.forEach(w => warnings.push(w.text));
  const module = { exports: {} as { default?: ReactElement | ComponentType } };
  runInNewContext(built.code, {
    module,
    exports: module.exports,
    require: (id: string) => {
      if (id === 'react/jsx-runtime') return jsxRuntime;
      throw new Error(`unexpected import ${id}`);
    },
  });
  const made = module.exports.default!;
  const element = component ? createElement(made as ComponentType) : (made as ReactElement);
  return { markup: renderToStaticMarkup(element), warnings };
};

const check = (example: Example): { jsx: string; markup: string; input: string; rendered: string } => {
  const allow = new Set(example.allow ?? []);
  const { text } = htmlToJsx(example.input, { component: example.component ?? false }, parse, names);
  if (text === '') return { jsx: text, markup: '', input: canonical(example.input, allow), rendered: '' };
  const { markup, warnings } = compileAndRender(text, example.component ?? false);
  expect(warnings, text).toEqual([]);
  return { jsx: text, markup, input: canonical(example.input, allow), rendered: canonical(markup, allow) };
};

describe('every §10 example compiles and renders to the markup it came from', () => {
  it.each((examples.spec as Example[]).map(e => [e.input.slice(0, 70), e] as const))('%s', (_, example) => {
    const { input, rendered, jsx } = check(example);
    expect(rendered, jsx).toBe(input);
  });

  it('an allowance is needed only where it is named: without it the row differs', () => {
    for (const example of (examples.spec as Example[]).filter(e => e.allow?.length)) {
      for (const allowance of example.allow!) {
        const { input, rendered } = check({ ...example, allow: example.allow!.filter(a => a !== allowance) });
        expect(rendered, `${example.input} without ${allowance}`).not.toBe(input);
      }
    }
  });
});

describe('hostile input cannot break out of the generated code', () => {
  it.each((examples.hostile as Example[]).map(e => [e.input.slice(0, 70), e] as const))('%s', (_, example) => {
    const { input, rendered, jsx } = check(example);
    expect(rendered, jsx).toBe(input);
  });
});

// ---- Generated documents (seeded: the same 400 every run, so the false-failure rate is 0)

const mulberry32 = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const CHARS = [
  'a',
  'b',
  'Z',
  'é',
  'Ж',
  '🙂',
  ' ',
  ' ',
  '  ',
  '\n',
  '\t',
  '{',
  '}',
  '<',
  '>',
  '&',
  '&amp;',
  '"',
  "'",
  '`',
  '\\',
  '${',
  '*/',
  '/*',
  '//',
  '\u{2028}',
  '\u{A0}',
  '\u{3000}',
  '&copy;',
  '&#65;',
];
const BLOCK_TAGS = ['div', 'p', 'section', 'blockquote', 'ul', 'pre'];
const INLINE_TAGS = ['span', 'b', 'i', 'em', 'code', 'a', 'button', 'small'];
const ATTRIBUTES = ['class', 'title', 'id', 'data-x', 'aria-label', 'href', 'lang', 'style'];

const generate = (random: () => number): string => {
  const pick = <T>(list: readonly T[]): T => list[Math.floor(random() * list.length)]!;
  const text = (): string => {
    let s = '';
    for (let n = Math.floor(random() * 6); n >= 0; n--) s += pick(CHARS);
    // A text in markup: a bare < or & would start a tag or a reference; write them as the input would hold them.
    return s.replace(/<(?=[a-zA-Z/!?]|$)/g, '&lt;').replace(/&(?![a-z]+;|#\d+;)/g, '&amp;');
  };
  const value = (name: string): string => {
    if (name === 'style') return pick(['color: red', 'margin-top: 4px; opacity: 0.5', "content: '&quot;}{'", '--x: 1']);
    let s = '';
    for (let n = Math.floor(random() * 5); n >= 0; n--) s += pick(CHARS);
    return s.replace(/&(?![a-z]+;|#\d+;)/g, '&amp;').replace(/"/g, '&quot;');
  };
  const element = (depth: number, inline: boolean): string => {
    const tag = inline || depth > 2 ? pick(INLINE_TAGS) : pick([...BLOCK_TAGS, ...INLINE_TAGS]);
    const childInline = inline || INLINE_TAGS.includes(tag) || tag === 'p';
    const attrs = Array.from(new Set(Array.from({ length: Math.floor(random() * 3) }, () => pick(ATTRIBUTES))))
      .map(a => ` ${a}="${value(a)}"`)
      .join('');
    let inner = '';
    for (let n = Math.floor(random() * 4); n > 0; n--) {
      const r = random();
      if (tag === 'ul') inner += `<li>${text()}</li>${pick(['', '\n  '])}`;
      else if (r < 0.45 || depth > 3) inner += text();
      else if (r < 0.55) inner += `<!--${text().replace(/-/g, '')}-->`;
      else inner += element(depth + 1, childInline || tag === 'button' || tag === 'a' || tag === 'pre');
    }
    return `<${tag}${attrs}>${inner}</${tag}>`;
  };
  let doc = '';
  for (let n = 1 + Math.floor(random() * 3); n > 0; n--) doc += element(0, false) + pick(['', ' ', '\n']);
  return doc;
};

describe('generated documents', () => {
  it('400 seeded documents: each result compiles and renders to the markup it came from', () => {
    const random = mulberry32(20261122);
    for (let i = 0; i < 400; i++) {
      const input = generate(random);
      const { input: expected, rendered, jsx } = check({ input });
      expect(rendered, `#${i}\n${input}\n---\n${jsx}`).toBe(expected);
    }
  }, 120_000);
});
