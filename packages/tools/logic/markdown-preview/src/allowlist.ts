/**
 * The allowlist (docs/tools/specs/markdown-preview.md §5.6): markdown-it's HTML is never inserted as markup. It is
 * parsed as a whole document by a DOMParser (a document without a window: nothing in it loads or runs), and new nodes
 * are built from that tree — only the elements and attributes of the table below, every other attribute dropped. The
 * DOM comes in as a parameter (D14): the nodes belong to the document passed in (the preview frame's), and the parser is
 * that document's window's.
 */

/** §5.4: may this href become a link? `http:`, `https:` or `mailto:` at the very start, any case, nothing hidden. */
export const isOpenableHref = (href: string): boolean =>
  // eslint-disable-next-line no-control-regex -- a control character or a space anywhere: not a link we open
  /^(?:https?|mailto):/i.test(href) && !/[\u0000- \u007f]/.test(href);

/** Elements that keep no attribute at all. */
const BARE = new Set([
  'p',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'blockquote',
  'ul',
  'pre',
  'em',
  'strong',
  's',
  'table',
  'thead',
  'tbody',
  'tr',
  'hr',
  'br',
]);

/**
 * Dropped with everything inside: §5.6's list, plus the elements whose content the HTML parser reads as raw text or
 * that only exist to embed or describe something else (their text would show as stray words).
 */
const DROPPED = new Set([
  'script',
  'style',
  'template',
  'iframe',
  'object',
  'embed',
  'svg',
  'math',
  'noscript',
  'textarea',
  'select',
  'title',
  // beyond §5.6 (§15 of the specification): raw-text and embedding elements
  'frame',
  'frameset',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'head',
  'meta',
  'link',
  'base',
]);

const ALIGN_CLASS = /^md-align-(?:left|center|right)$/;
const LANGUAGE_CLASS = /^language-[\p{L}\p{N}_+#-]{1,32}$/u;
const START = /^\d{1,9}$/;

const classes = (el: Element): string[] => (el.getAttribute('class') ?? '').split(/[\t\n\f\r ]+/).filter(Boolean);

/** The new element for `el`, or `null` to unwrap it (its children go on), or `'drop'` to leave it out entirely. */
const rebuild = (el: Element, doc: Document): Element | null | 'drop' => {
  const name = el.localName;
  // Only HTML elements: an element of another namespace (SVG, MathML) never counts as one of ours.
  if (el.namespaceURI !== 'http://www.w3.org/1999/xhtml') return DROPPED.has(name) ? 'drop' : null;
  if (DROPPED.has(name)) return 'drop';
  if (BARE.has(name)) return doc.createElement(name);
  switch (name) {
    case 'ol': {
      const out = doc.createElement('ol');
      const start = el.getAttribute('start');
      if (start !== null && START.test(start)) out.setAttribute('start', start);
      return out;
    }
    case 'li': {
      const out = doc.createElement('li');
      if (classes(el).includes('task-list-item')) out.setAttribute('class', 'task-list-item');
      return out;
    }
    case 'th':
    case 'td': {
      const out = doc.createElement(name);
      const align = classes(el).find(c => ALIGN_CLASS.test(c));
      if (align) out.setAttribute('class', align);
      return out;
    }
    case 'code': {
      const out = doc.createElement('code');
      const language = classes(el).find(c => LANGUAGE_CLASS.test(c));
      if (language) out.setAttribute('class', language);
      return out;
    }
    case 'a': {
      const href = el.getAttribute('href');
      if (href === null) return null;
      const title = el.getAttribute('title');
      if (!isOpenableHref(href)) {
        const out = doc.createElement('span');
        out.setAttribute('class', 'md-link-inactive');
        out.setAttribute('title', `Not opened: ${href}`);
        return out;
      }
      const out = doc.createElement('a');
      out.setAttribute('href', href);
      out.setAttribute('target', '_blank');
      out.setAttribute('rel', 'noopener noreferrer');
      if (title !== null) out.setAttribute('title', title);
      return out;
    }
    case 'input': {
      if ((el.getAttribute('type') ?? '').toLowerCase() !== 'checkbox') return 'drop';
      const out = doc.createElement('input');
      out.setAttribute('type', 'checkbox');
      out.setAttribute('disabled', '');
      if (el.hasAttribute('checked')) out.setAttribute('checked', '');
      return out;
    }
    case 'span': {
      if (!classes(el).includes('md-image')) return null;
      const out = doc.createElement('span');
      out.setAttribute('class', 'md-image');
      out.setAttribute('title', el.getAttribute('title') ?? 'Image not loaded');
      return out;
    }
    default:
      return null;
  }
};

const ELEMENT_NODE = 1;
const TEXT_NODE = 3;

/**
 * §5.6: parses `html` with DOMParser and builds only allowed nodes into `doc`. The walk is iterative: a deeply nested
 * input does not grow the call stack.
 */
export const toSafeFragment = (html: string, doc: Document): DocumentFragment => {
  const Parser = doc.defaultView?.DOMParser;
  if (!Parser) throw new TypeError('toSafeFragment needs a document with a window (its DOMParser parses the input)');
  const parsed = new Parser().parseFromString(html, 'text/html');
  const out = doc.createDocumentFragment();
  // Each entry: the next source child still to copy, and where the copies go.
  const stack: Array<{ into: Node; next: ChildNode | null }> = [{ into: out, next: parsed.body.firstChild }];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    const node = top.next;
    if (node === null) {
      stack.pop();
      continue;
    }
    top.next = node.nextSibling;
    if (node.nodeType === TEXT_NODE) {
      top.into.appendChild(doc.createTextNode((node as Text).data));
      continue;
    }
    if (node.nodeType !== ELEMENT_NODE) continue; // comments, processing instructions
    const built = rebuild(node as Element, doc);
    if (built === 'drop') continue;
    const into = built ?? top.into;
    if (built) top.into.appendChild(built);
    // An element that keeps no children of its own (input, br, hr) gets none.
    if (built && (built.localName === 'input' || built.localName === 'br' || built.localName === 'hr')) continue;
    stack.push({ into, next: node.firstChild });
  }
  return out;
};
