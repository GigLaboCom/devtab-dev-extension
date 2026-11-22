// @vitest-environment jsdom
// How deep the parser's stack will grow (depth.ts; docs/tools/specs/html-preview.md §12, §15): real documents stay
// shallow however long; every known way to grow the stack is caught before the markup reaches the parser; the
// estimate is never below the depth jsdom's parser (parse5, no limit of its own) builds; and it is linear.
import { MAX_DEPTH, nestingDepth } from '.';
import corpus from './hostile-corpus.json';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';

/** The deepest element of what jsdom's parser builds, counting <html>. */
const domDepth = (html: string): number => {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  let deepest = 0;
  const stack: Array<[Element, number]> = [[doc.documentElement, 1]];
  while (stack.length > 0) {
    const [el, depth] = stack.pop()!;
    deepest = Math.max(deepest, depth);
    for (const child of Array.from(el.children)) stack.push([child, depth + 1]);
  }
  return deepest;
};

describe('nestingDepth', () => {
  it('counts <html> and <body>, and what is open inside', () => {
    expect(nestingDepth('')).toBe(2);
    expect(nestingDepth('<p>x</p>')).toBe(3);
    expect(nestingDepth('<ul><li>a<li>b</ul>')).toBe(4);
    expect(nestingDepth('<table><tr><td>x</table>')).toBe(6);
    expect(nestingDepth('<div><div><div>x</div></div></div>')).toBe(5);
    expect(nestingDepth('<svg><g><path/><path/></g></svg>')).toBe(4); // a self-closed path is never open
  });

  it('long real documents stay shallow', () => {
    for (const html of [
      '<p>x'.repeat(100_000),
      `<ul>${'<li>x'.repeat(100_000)}</ul>`,
      '<b>x</b> '.repeat(100_000),
      `<table>${'<tr><td>a<td>b'.repeat(50_000)}</table>`,
      `<select>${'<option>x'.repeat(50_000)}</select>`,
      `<svg>${'<path d="M0 0"/>'.repeat(50_000)}</svg>`,
      `<dl>${'<dt>a<dd>b'.repeat(50_000)}</dl>`,
      '<h1>a<h2>b'.repeat(50_000),
      `${'<a href="https://example.com/">x'.repeat(50_000)}`,
      `<p>${'<span>x</span>'.repeat(50_000)}</p>`,
      `${'<style>p{}</style><script>x()</script><!-- c -->'.repeat(20_000)}`,
    ])
      expect(nestingDepth(html), html.slice(0, 40)).toBeLessThan(10);
  });

  it.each([
    ['nested divs', '<div>'.repeat(600)],
    ['nested spans', '<span>'.repeat(600)],
    ['nested bold', '<b>'.repeat(600)],
    ['self-closing divs (HTML ignores the slash)', '<div/>'.repeat(600)],
    ['a block kept open by the adoption agency', '<b><div></b>'.repeat(300)],
    ['formatting reconstructed again and again', '<i><b></i>'.repeat(600)],
    [
      'distinct formatting reopened in every paragraph',
      `${Array.from({ length: 600 }, (_, i) => `<b class="c${i}">`).join('')}</p><p>x`,
    ],
    ['SVG that HTML breaks out of', '<svg><div/>'.repeat(600)],
    ['fonts with a size break out of SVG', '<svg><font size="1">'.repeat(600)],
    ['nested tables', '<table><tr><td>'.repeat(200)],
    ['nested lists', '<ul><li>'.repeat(300)],
    ['nested links in divs (each <a> closes the last, the div stays)', '<div><a href="x">'.repeat(600)],
  ])('%s: more than the limit', (_, html) => {
    expect(nestingDepth(html)).toBeGreaterThan(MAX_DEPTH);
  });

  // The DOM's deepest element is a leaf, never open (an <img>, a self-closed SVG element): the stack is one less.
  it('is never below the depth jsdom’s parser builds — the corpus and the shapes above, smaller', () => {
    const shapes = [
      ...(corpus as Array<{ html: string }>).map(e => e.html),
      '<div>'.repeat(300),
      '<b><div></b>'.repeat(100),
      '<i><b></i>'.repeat(200),
      `${Array.from({ length: 200 }, (_, i) => `<b class="c${i}">`).join('')}</p><p>x`,
      '<svg><div/>'.repeat(200),
      '<table><tr><td>'.repeat(60),
      '<p><b>x<p>y<p>z</b>w'.repeat(50),
      '<a><div><a>x</a></div></a>'.repeat(50),
      '<table><b><tr><td>x</b>'.repeat(30),
      '<math><mi><svg><foreignObject><div>'.repeat(40),
    ];
    const below = shapes.filter(html => nestingDepth(html, 10_000) + 1 < domDepth(html));
    expect(below.map(html => [html.slice(0, 60), nestingDepth(html, 10_000), domDepth(html)])).toEqual([]);
  });

  it('stops as soon as it passes the limit, and is linear', { timeout: 60_000 }, () => {
    // The shape of the cost (`growth`): a megabyte against eight inputs of 128 Ki, timed in turn.
    for (const make of [
      (n: number) => '<p>x'.repeat(n / 4),
      (n: number) => `${'<div>'.repeat(400)}${'<td>x'.repeat(n / 5)}`,
      (n: number) => `${'<b class="x">'.repeat(100)}${'</p><p>x'.repeat(n / 8)}`,
      (n: number) => '<style>a{}</style>'.repeat(n / 18),
    ])
      expect(growth(html => nestingDepth(html), make, 128 * 1024)).toBeLessThan(GROWTH_BOUND);
    expect(nestingDepth('<div>'.repeat(200_000))).toBe(MAX_DEPTH + 1);
  });
});
