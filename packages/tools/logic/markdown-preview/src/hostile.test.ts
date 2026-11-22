// @vitest-environment jsdom
// The hostile corpus (hostile-corpus.json — the same entries the e2e module types into the built extension): script
// elements and handlers in raw HTML, `javascript:` / `vbscript:` / `data:` links in every spelling, elements and CSS with
// remote sources, markup imitating the extension's interface. Every remote address is a reserved name (`*.invalid`) or
// a local port where nothing listens. Each entry is checked at both layers the logic owns:
//   1. markdown-it with this tool's options and rules — its HTML string has no tag, attribute or address it should not;
//   2. the allowlist (§5.6) — on markdown-it's output, and again on the entry's raw HTML handed to it directly, as if
//      the first layer had failed.
// The layers after these (the sandboxed frame, its own policy, the page's policy) are the e2e module's.
import { isOpenableHref, renderMarkdown, toSafeFragment } from '.';
import corpus from './hostile-corpus.json';
import { describe, expect, it } from 'vitest';

interface Entry {
  name: string;
  markdown: string;
  /** How the entry is neutralised: shown as text, kept as its source, an inactive link, a link, an image frame, code. */
  expect: 'text' | 'source' | 'inactive' | 'link' | 'image' | 'code';
}
const ENTRIES = corpus as Entry[];

/** What may be in the preview at all: element → attribute → allowed value. */
const ALLOWED: Record<string, Record<string, RegExp>> = {
  ...Object.fromEntries(
    'p h1 h2 h3 h4 h5 h6 blockquote ul pre em strong s table thead tbody tr hr br'.split(' ').map(n => [n, {}]),
  ),
  ol: { start: /^\d{1,9}$/ },
  li: { class: /^task-list-item$/ },
  th: { class: /^md-align-(left|center|right)$/ },
  td: { class: /^md-align-(left|center|right)$/ },
  code: { class: /^language-[\p{L}\p{N}_+#-]{1,32}$/u },
  a: { href: /^(https?|mailto):/i, target: /^_blank$/, rel: /^noopener noreferrer$/, title: /[^]*/ },
  input: { type: /^checkbox$/, disabled: /^$/, checked: /^$/ },
  span: { class: /^(md-image|md-link-inactive)$/, title: /^(Image not loaded|Not opened): / },
};

/** Every node under `root`, depth first. */
const walk = (root: Node): Node[] => [...root.childNodes].flatMap(n => [n, ...walk(n)]);

/** Every element, attribute and value of the fragment that the allowlist would not have built. */
const violations = (fragment: DocumentFragment): string[] => {
  const out: string[] = [];
  for (const el of fragment.querySelectorAll('*')) {
    const rules = ALLOWED[el.localName];
    if (!rules || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      out.push(`<${el.localName}>`);
      continue;
    }
    for (const { name, value } of el.attributes)
      if (!rules[name]?.test(value)) out.push(`<${el.localName} ${name}="${value}">`);
    if (el.localName === 'a' && !isOpenableHref(el.getAttribute('href') ?? '')) out.push(`<a href> not openable`);
    if (el.localName === 'input' && !el.hasAttribute('disabled')) out.push('<input> enabled');
  }
  for (const node of walk(fragment)) if (node.nodeType !== 1 && node.nodeType !== 3) out.push(`node ${node.nodeType}`);
  return out;
};

/** What markdown-it's string itself must never carry, whatever the allowlist does after it. */
const RAW_DANGER = [
  /<(script|style|iframe|object|embed|link|meta|base|form|img|svg|video|audio|picture|source|template)\b/i,
  /<[a-z][^>]*\son[a-z]+\s*=/i,
  /<[a-z][^>]*\s(style|srcset|ping|action|formaction|background|poster|srcdoc)\s*=/i,
  /(href|src)\s*=\s*"\s*(javascript|vbscript|data|file):/i,
];

/** The first that applies: an image frame; Markdown link syntax left as written; a tag shown as text (its addresses
 * may be links); a link; an inactive link; code. */
const outcome = (fragment: DocumentFragment): Entry['expect'] => {
  const text = fragment.textContent ?? '';
  if (fragment.querySelector('span.md-image')) return 'image';
  if (!fragment.querySelector('a, span') && /\]\(|\]:/.test(text)) return 'source';
  if (/<[a-z!?/]/i.test(text)) return 'text';
  if (fragment.querySelector('a')) return 'link';
  if (fragment.querySelector('span.md-link-inactive')) return 'inactive';
  if (fragment.querySelector('pre > code')) return 'code';
  return 'source';
};

describe('the hostile corpus', () => {
  it('has its size, every remote address on a reserved name or a dead local port', () => {
    expect(ENTRIES.length).toBe(63);
    for (const { markdown } of ENTRIES)
      for (const [, host] of markdown.matchAll(/(?<![/:])(?:https?:)?\/\/([^/\s"')>]+)/g))
        expect(host, markdown).toMatch(/(\.invalid|^127\.0\.0\.1:9)$/);
  });

  it.each(ENTRIES.map(e => [e.name, e] as const))('%s: markdown-it’s string carries nothing dangerous', (_, e) => {
    const html = renderMarkdown(e.markdown);
    for (const danger of RAW_DANGER) expect(html, html).not.toMatch(danger);
  });

  it.each(ENTRIES.map(e => [e.name, e] as const))('%s: the preview is built from the allowlist only', (_, e) => {
    const fragment = toSafeFragment(renderMarkdown(e.markdown), document);
    expect(violations(fragment)).toEqual([]);
    expect(outcome(fragment)).toBe(e.expect);
  });

  it.each(ENTRIES.map(e => [e.name, e] as const))('%s: the allowlist alone, on the raw HTML', (_, e) => {
    expect(violations(toSafeFragment(e.markdown, document))).toEqual([]);
  });

  it('the canary is only ever text or a title — never in an attribute the browser acts on', () => {
    for (const { markdown } of ENTRIES) {
      const holder = document.createElement('div');
      holder.append(toSafeFragment(renderMarkdown(markdown), document));
      for (const el of holder.querySelectorAll('*'))
        for (const { name, value } of el.attributes)
          if (name !== 'title') expect(value, `${el.localName} ${name}`).not.toMatch(/__mdPwned|alert\(|msgbox/);
    }
  });
});
