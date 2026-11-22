// @vitest-environment jsdom
// The tool's promise as properties, on generated documents (a fixed seed, so a failure repeats): whatever the markup —
// pieces of tags, attributes, CSS and the corpus thrown together — the checked document holds nothing the promise does
// not allow (testing.ts), and Copy HTML is a fixed point (parsed and checked again it reads the same); then the large
// inputs of §12 — deep nesting, a huge table, thousands of styled elements, a megabyte of CSS — are checked in time
// that grows with their size, not its square. Bounds are on the shape of the cost, never on milliseconds.
import { nestingDepth, removedText, sanitizeHtml, serializeSanitized } from '.';
import corpus from './hostile-corpus.json';
import { CANARY, violations } from './testing';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';

/** xorshift32: the test's own reproducible sequence (randomness for the product comes from tools-shared only). */
const sequence = (seed: number) => {
  let x = seed >>> 0 || 1;
  return (n: number): number => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    return (x >>> 0) % n;
  };
};

const TAGS = [
  'div',
  'p',
  'a',
  'img',
  'svg',
  'math',
  'table',
  'tr',
  'td',
  'form',
  'input',
  'style',
  'script',
  'noscript',
  'template',
  'iframe',
  'object',
  'select',
  'option',
  'textarea',
  'title',
  'xmp',
  'plaintext',
  'mglyph',
  'mtext',
  'foreignObject',
  'desc',
  'use',
  'image',
  'animate',
  'set',
  'video',
  'source',
  'link',
  'base',
  'meta',
  'button',
  'area',
  'map',
  'picture',
  'frameset',
  'body',
  'html',
  'head',
  'annotation-xml',
  'noembed',
  'b',
  'li',
  'ul',
  'span',
];
const ATTRIBUTES = [
  'href',
  'src',
  'srcset',
  'style',
  'onclick',
  'onerror',
  'xlink:href',
  'action',
  'formaction',
  'name',
  'id',
  'target',
  'background',
  'poster',
  'srcdoc',
  'autofocus',
  'rel',
  'type',
  'attributeName',
  'fill',
  'title',
  'data-preview-style',
  'encoding',
  'width',
  'height',
  'ping',
  'download',
  'class',
];
const VALUES = [
  'javascript:alert(1)',
  'http://v.invalid/x',
  '#x',
  'image',
  'stylesheet',
  'url(http://v.invalid/u)',
  'url(#g)',
  'background:url(http://v.invalid/b)',
  'color:red',
  '0',
  'body',
  'style',
  '_top',
  'text/html',
  '"><img src=x onerror=alert(1)>',
  '</style><img src=x onerror=alert(1)>',
  '120',
  CANARY,
];
const TEXTS = [
  'x',
  '<!--',
  '-->',
  '<![CDATA[',
  ']]>',
  '</',
  '&lt;',
  '&#x6a;',
  '\u0000',
  ' ',
  '\n',
  '@import url(http://v.invalid/i);',
  'p{background:url(http://v.invalid/p)}',
  '"',
  "'",
  '>',
  '/',
];
const CORPUS = (corpus as Array<{ html: string }>).map(e => e.html.replaceAll('{{CANARY}}', CANARY));

const generate = (pick: (n: number) => number, size: number): string => {
  let out = '';
  while (out.length < size) {
    const kind = pick(10);
    if (kind < 4) {
      let tag = `<${TAGS[pick(TAGS.length)]}`;
      for (let i = pick(3); i > 0; i--)
        tag += ` ${ATTRIBUTES[pick(ATTRIBUTES.length)]}="${VALUES[pick(VALUES.length)]!.replace(/"/g, '&quot;')}"`;
      out += `${tag}${pick(5) === 0 ? '/' : ''}>`;
    } else if (kind < 6) out += `</${TAGS[pick(TAGS.length)]}>`;
    else if (kind < 9) out += TEXTS[pick(TEXTS.length)];
    else out += CORPUS[pick(CORPUS.length)];
  }
  return out;
};

describe('generated documents', () => {
  it(
    '2 000 documents: nothing outside the promise; Copy HTML parsed and checked again reads the same',
    { timeout: 120_000 },
    () => {
      const pick = sequence(0x48544d4c);
      for (let i = 0; i < 2000; i++) {
        const input = generate(pick, 40 + pick(400));
        const result = sanitizeHtml(input, document);
        expect(violations(result), input).toEqual([]);
        const copied = serializeSanitized(result);
        const again = sanitizeHtml(copied, document);
        expect(violations(again), input).toEqual([]);
        expect(removedText(again.counts), input).toBe('');
        expect(serializeSanitized(again), input).toBe(copied);
      }
    },
  );
});

describe('the depth estimate on generated documents', () => {
  it('2 000 documents: never below the depth jsdom’s parser builds (its deepest leaf aside)', () => {
    const pick = sequence(0x44455054);
    const below: string[] = [];
    for (let i = 0; i < 2000; i++) {
      const input = generate(pick, 40 + pick(600));
      const doc = new DOMParser().parseFromString(input, 'text/html');
      let deepest = 0;
      const stack: Array<[Element, number]> = [[doc.documentElement, 1]];
      while (stack.length > 0) {
        const [el, depth] = stack.pop()!;
        deepest = Math.max(deepest, depth);
        for (const child of Array.from(el.children)) stack.push([child, depth + 1]);
      }
      if (nestingDepth(input, 10_000) + 1 < deepest) below.push(input);
    }
    expect(below).toEqual([]);
  });
});

describe('§12: large inputs are checked in time that grows with their size', () => {
  // The shape of the cost (`growth`): 256 Ki against eight inputs of 32 Ki, timed in turn — linear about 1, quadratic
  // about 8, on a free machine or a loaded one.
  const check = (input: string) => serializeSanitized(sanitizeHtml(input, document));
  const shapes: Array<[string, (n: number) => string]> = [
    // jsdom's parser recurses per level (Chrome's stops nesting at 512): nesting 2 000 deep, again and again
    ['deep nesting', n => `${'<div>'.repeat(2000)}${'</div>'.repeat(2000)}`.repeat(Math.ceil(n / 22000))],
    ['a wide table', n => `<table><tr>${'<td>a'.repeat(n / 5)}`],
    ['a tall table', n => `<table>${'<tr><td>a'.repeat(n / 9)}`],
    ['styled elements', n => '<p style="color:red;margin:0">x</p>'.repeat(n / 36)],
    ['a megabyte of CSS', n => `<style>${'.a{color:red;background:url(x)}'.repeat(n / 32)}</style>`],
    ['links', n => '<a href="https://example.com/x">x</a>'.repeat(n / 38)],
  ];
  it.each(shapes)('%s: 256 Ki cost about what eight times 32 Ki do', { timeout: 120_000 }, (_, make) => {
    expect(growth(check, make, 32 * 1024)).toBeLessThan(GROWTH_BOUND);
  });

  it(
    'nesting 5 000 deep is checked and copied without growing the call stack (the walk and the serializer)',
    { timeout: 120_000 },
    () => {
      const r = sanitizeHtml('<b style="color:red">'.repeat(5000), document);
      const copied = serializeSanitized(r);
      expect(copied.match(/<b style="color:red">/g)).toHaveLength(5000);
    },
  );
});
