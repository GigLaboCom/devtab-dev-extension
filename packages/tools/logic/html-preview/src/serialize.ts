/**
 * Copy HTML (docs/tools/specs/html-preview.md §5.6): the checked document as one HTML document — `<!doctype html>`, the
 * kept attributes of `<html>` and `<body>`, one `<style>` with the input's sheets, the checked body with each
 * `data-preview-style` number written back as `style="…"`. What the preview shows, minus the frame's own sheet.
 *
 * Its own serializer (the HTML fragment serialization algorithm), iterative, so that what is copied cannot read
 * differently anywhere it is pasted: every attribute value escapes `&`, `"`, `<`, `>` and no-break spaces; every text
 * is escaped (the raw-text elements are gone by then: script, style, xmp, plaintext, noembed, noframes, iframe); a
 * comment that holds markup — a conditional comment that Outlook or an old Internet Explorer would read as HTML — is
 * left out (§15); `</style` cannot end the style element early.
 */
import { attributes, childNodes, localName, prop } from './dom';
import type { SanitizedHtml } from './logic';

const VOID = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);
const XML_NS = 'http://www.w3.org/XML/1998/namespace';
const XMLNS_NS = 'http://www.w3.org/2000/xmlns/';
const XLINK_NS = 'http://www.w3.org/1999/xlink';

const escapeText = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/\u00a0/g, '&nbsp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
const escapeAttribute = (s: string): string => escapeText(s).replace(/"/g, '&quot;');

/** A comment that a mail program or an old browser might read as markup (`<!--[if mso]>…<![endif]-->`). */
const MARKUP_COMMENT = /[<>]|\[if\b|\bendif\]/i;

const attributeName = (a: Attr): string => {
  if (a.namespaceURI === XML_NS) return `xml:${a.localName}`;
  if (a.namespaceURI === XMLNS_NS) return a.localName === 'xmlns' ? 'xmlns' : `xmlns:${a.localName}`;
  if (a.namespaceURI === XLINK_NS) return `xlink:${a.localName}`;
  return a.name;
};

const attributeList = (list: Array<[string, string]>, inline: string[]): string =>
  list
    .map(([name, value]) =>
      name === 'data-preview-style'
        ? ` style="${escapeAttribute(inline[Number(value)] ?? '')}"`
        : ` ${name}="${escapeAttribute(value)}"`,
    )
    .join('');

/** The children of `root`, serialized. */
const serializeChildren = (root: Node, inline: string[]): string => {
  const out: string[] = [];
  // Each entry: the nodes still to write at one level, and the end tag to write after them.
  const stack: Array<{ nodes: ChildNode[]; at: number; close: string }> = [
    { nodes: childNodes(root), at: 0, close: '' },
  ];
  while (stack.length > 0) {
    const top = stack[stack.length - 1]!;
    if (top.at >= top.nodes.length) {
      out.push(top.close);
      stack.pop();
      continue;
    }
    const node = top.nodes[top.at++]!;
    const type = prop<number>(node, 'nodeType');
    if (type === 3) out.push(escapeText(prop<string>(node, 'data')));
    else if (type === 8) {
      const data = prop<string>(node, 'data');
      if (!MARKUP_COMMENT.test(data)) out.push(`<!--${data}-->`);
    } else if (type === 1) {
      const el = node as Element;
      const name = localName(el);
      let tag = `<${name}`;
      for (const a of attributes(el)) {
        tag +=
          a.name === 'data-preview-style'
            ? ` style="${escapeAttribute(inline[Number(a.value)] ?? '')}"`
            : ` ${attributeName(a)}="${escapeAttribute(a.value)}"`;
      }
      out.push(`${tag}>`);
      const html = prop<string | null>(el, 'namespaceURI') === 'http://www.w3.org/1999/xhtml';
      if (html && VOID.has(name)) continue;
      stack.push({ nodes: childNodes(el), at: 0, close: `</${name}>` });
    }
  }
  return out.join('');
};

/** §5.6 */
export const serializeSanitized = (result: SanitizedHtml): string => {
  const style =
    result.sheets.length === 0 ? '' : `<style>${result.sheets.join('\n').replace(/<\/(style)/gi, '<\\/$1')}</style>`;
  return (
    '<!doctype html>\n' +
    `<html${attributeList(result.htmlAttrs, result.inline)}><head>${style}</head>` +
    `<body${attributeList(result.bodyAttrs, result.inline)}>${serializeChildren(result.body, result.inline)}</body></html>`
  );
};
