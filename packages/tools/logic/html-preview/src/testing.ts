/**
 * For the tests only (not exported by the package): what the checked document may hold at all, read independently of
 * the rules of sanitize.ts — a second statement of the promise, so that a rule left out shows as a violation here. The
 * e2e module states the same over the frame's document as Chrome built it.
 */
import { attributeLoads, cssLoads } from './css';
import { isOpenableHref } from './logic';
import type { SanitizedHtml } from './logic';

/** What an injected script would do: set a flag on the parent and the top window, post a message, write to storage. */
export const CANARY =
  "parent.__hpPwned=1;top.__hpPwned=1;window.__hpPwned=1;top.postMessage('hp-pwned','*');" +
  "try{chrome.storage.local.set({hpPwned:1})}catch(e){}try{localStorage.setItem('hpPwned','1')}catch(e){}";

const FORBIDDEN_ELEMENTS = new Set([
  'script',
  'style',
  'iframe',
  'frame',
  'frameset',
  'object',
  'embed',
  'applet',
  'portal',
  'fencedframe',
  'base',
  'meta',
  'link',
  'template',
  'noscript',
  'noembed',
  'noframes',
  'xmp',
  'plaintext',
  'source',
  'track',
  'img',
]);
const FORBIDDEN_ATTRIBUTES = new Set([
  'src',
  'srcset',
  'srcdoc',
  'poster',
  'background',
  'ping',
  'action',
  'formaction',
  'formtarget',
  'autofocus',
  'download',
  'style',
  'lowsrc',
  'dynsrc',
]);
/** Attributes a browser acts on (follows, loads, runs, applies): the canary must never be in one. */
const ACTING =
  /^(?:on.*|href|src|srcset|srcdoc|action|formaction|style|background|poster|ping|data|code|codebase|values|to|from|by)$/i;
const HTML = 'http://www.w3.org/1999/xhtml';
const SVG = 'http://www.w3.org/2000/svg';

/** Every element and attribute of the checked document that the promise does not allow; [] when it holds. */
export const violations = (result: SanitizedHtml): string[] => {
  const out: string[] = [];
  const { body } = result;
  for (const el of Array.from(body.querySelectorAll('*'))) {
    const name = el.localName.toLowerCase();
    const ns = el.namespaceURI;
    const at = `<${el.localName}>`;
    if (FORBIDDEN_ELEMENTS.has(name) || (name === 'title' && ns === HTML)) out.push(at);
    if (ns === HTML && name === 'input' && (el.getAttribute('type') ?? '').trim().toLowerCase() === 'image')
      out.push(`${at} type=image`);
    if (ns === SVG && /^(animate|set|animatemotion|animatetransform)$/.test(name)) {
      if (/href$|^on/i.test(el.getAttribute('attributeName') ?? ''))
        out.push(`${at} animates ${el.getAttribute('attributeName')}`);
    }
    for (const a of Array.from(el.attributes)) {
      const lower = a.name.toLowerCase();
      const value = a.value;
      if (/^on/i.test(a.localName)) out.push(`${at} ${a.name}`);
      else if (FORBIDDEN_ATTRIBUTES.has(lower)) out.push(`${at} ${a.name}`);
      else if (lower === 'data-preview-style' && !(/^\d+$/.test(value) && Number(value) < result.inline.length))
        out.push(`${at} data-preview-style=${value}`);
      else if (lower === 'target' && !(ns === HTML && (name === 'a' || name === 'area') && value === '_blank'))
        out.push(`${at} target=${value}`);
      else if (lower === 'name' && ns === HTML && name === 'form') out.push(`${at} name`);
      else if (a.localName === 'href') {
        if (ns === HTML && (name === 'a' || name === 'area')) {
          if (!isOpenableHref(value)) out.push(`${at} href=${value}`);
          if (el.getAttribute('target') !== '_blank' || el.getAttribute('rel') !== 'noopener noreferrer')
            out.push(`${at} opens without _blank, noopener, noreferrer`);
        } else if (!(ns === SVG && name !== 'a' && value.trim().startsWith('#'))) out.push(`${at} ${a.name}=${value}`);
      } else if (ns !== HTML && attributeLoads(value)) out.push(`${at} ${a.name} loads`);
      if (ACTING.test(a.localName) && value.includes('__hpPwned')) out.push(`${at} ${a.name} holds the canary`);
    }
  }
  for (const node of walk(body))
    if (node.nodeType !== 1 && node.nodeType !== 3 && node.nodeType !== 8) out.push(`node ${node.nodeType}`);
  for (const [name, value] of [...result.htmlAttrs, ...result.bodyAttrs])
    if (!/^(lang|dir|class|id|bgcolor|text|link|vlink|alink|data-preview-style)$/.test(name))
      out.push(`<html|body> ${name}=${value}`);
  for (const css of [...result.sheets, ...result.inline]) if (cssLoads(css)) out.push(`CSS loads: ${css.slice(0, 80)}`);
  return out;
};

const walk = (root: Node): Node[] => {
  const out: Node[] = [];
  const stack: Node[] = [...Array.from(root.childNodes)].reverse();
  while (stack.length > 0) {
    const node = stack.pop()!;
    out.push(node);
    for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]!);
  }
  return out;
};
