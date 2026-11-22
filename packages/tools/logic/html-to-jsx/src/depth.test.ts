// @vitest-environment jsdom
import { MAX_NESTING, nestingDepth } from './index.ts';
import { GROWTH_BOUND, growth } from '@workspace/tools-shared/growth';
import { describe, expect, it } from 'vitest';

/** The depth of the tree jsdom's parser builds for the markup the tool parses, counting `<html>` and `<body>`. */
const domDepth = (markup: string): number => {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${markup}`, 'text/html');
  let deepest = 0;
  const stack: Array<[Element, number]> = [[doc.documentElement, 1]];
  while (stack.length > 0) {
    const [el, depth] = stack.pop()!;
    deepest = Math.max(deepest, depth);
    for (const child of Array.from(el.children)) stack.push([child, depth + 1]);
  }
  return deepest;
};

// The scan counts open elements: a void element, or the element the parser makes for a stray end tag (`</p>`), is a
// leaf one level below the deepest open one, so the scan may be one below the DOM's depth, never more.
describe('nestingDepth — the guard before the parser (§12)', () => {
  it('counts nested elements with <html> and <body>; 510 levels pass, 511 are refused', () => {
    expect(nestingDepth('')).toBe(2);
    expect(nestingDepth('<div>x</div>')).toBe(3);
    expect(nestingDepth('<div>'.repeat(510))).toBe(MAX_NESTING);
    expect(nestingDepth('<div>'.repeat(511))).toBeGreaterThan(MAX_NESTING);
    expect(nestingDepth('<div>'.repeat(10_000))).toBeGreaterThan(MAX_NESTING);
    expect(nestingDepth(`<!doctype html><html><body>${'<div>'.repeat(511)}`)).toBeGreaterThan(MAX_NESTING);
  });

  it('counts the ways to grow the depth: unclosed blocks, formatting end tags that keep a block open', () => {
    for (const markup of [
      '<b><div></b>'.repeat(600),
      '<span><div></span>'.repeat(600),
      '<i><b></i>'.repeat(600),
      '<form><div></form>'.repeat(600),
      '<ul><li>'.repeat(300),
      '<table><tr><td>'.repeat(200),
      '<svg><g>'.repeat(300),
      `<svg><div>${'<div/>'.repeat(600)}`,
    ])
      expect(nestingDepth(markup), markup.slice(0, 30)).toBeGreaterThan(MAX_NESTING);
  });

  it('wide documents stay shallow: unclosed paragraphs, items, cells, options, void and self-closing tags', () => {
    for (const markup of [
      '<p>x'.repeat(100_000),
      `<ul>${'<li>x'.repeat(100_000)}</ul>`,
      `<dl>${'<dt>a<dd>b'.repeat(50_000)}</dl>`,
      `<table>${'<tr><td>a<td>b'.repeat(50_000)}</table>`,
      `<table>${'<tbody><tr><td>a'.repeat(20_000)}</table>`,
      `<select>${'<option>a'.repeat(50_000)}</select>`,
      '<br><img src="a.png"><input>'.repeat(50_000),
      `<svg>${'<path d="M0 0"/>'.repeat(50_000)}</svg>`,
      '<h1>a</h1><p>b<div>c</div>'.repeat(30_000),
      '<b>a</b><i>b</i>'.repeat(50_000),
    ])
      expect(nestingDepth(markup), markup.slice(0, 40)).toBeLessThanOrEqual(8);
  });

  it('markup inside raw text, comments and attributes is not counted', () => {
    const deep = '<div>'.repeat(10_000);
    expect(nestingDepth(`<script>${deep}</script>`)).toBe(3);
    expect(nestingDepth(`<textarea>${deep}</textarea><p>x`)).toBe(3);
    expect(nestingDepth(`<style>${deep}</style>`)).toBe(3);
    expect(nestingDepth(`<!--${deep}-->`)).toBe(2);
    expect(nestingDepth(`<p title="${deep}">x</p>`)).toBe(3);
  });

  it('is never below the depth jsdom builds on the ways to grow it, smaller', () => {
    const shapes = [
      '<div>'.repeat(300),
      '<b><div></b>'.repeat(100),
      '<i><b></i>'.repeat(100),
      '<span><div></span>'.repeat(100),
      '<form><div></form>'.repeat(100),
      '<p><b>x<p>y<p>z</b>w'.repeat(50),
      '<a><div><a>x</a></div></a>'.repeat(50),
      '<ul><li>'.repeat(100),
      '<table><tr><td>'.repeat(40),
      '<svg><g>'.repeat(100),
      `<svg><div>${'<div/>'.repeat(100)}`,
      '<select><option>'.repeat(50),
      '<dl><dt><div>'.repeat(60),
    ];
    const below = shapes.filter(markup => nestingDepth(markup, 10_000) + 1 < domDepth(markup));
    expect(below.map(m => [m.slice(0, 30), nestingDepth(m, 10_000), domDepth(m)])).toEqual([]);
  });

  it('2,000 generated tag soups: never below jsdom', { timeout: 60_000 }, () => {
    let seed = 7;
    const random = (n: number): number => (seed = (seed * 1103515245 + 12345) >>> 0) % n;
    const tags = (
      'div p span b i a li ul ol table tr td th tbody select option dl dt dd svg g path math mi br img input em ' +
      'strong h1 h2 pre form button textarea script'
    ).split(' ');
    const below: string[] = [];
    for (let doc = 0; doc < 2000; doc++) {
      const parts: string[] = [];
      for (let k = 0, n = 5 + random(120); k < n; k++) {
        const tag = tags[random(tags.length)]!;
        const r = random(10);
        parts.push(
          r < 5 ? `<${tag}${random(3) === 0 ? ' class="c"' : ''}>` : r < 8 ? `</${tag}>` : r < 9 ? 'x' : `<${tag}/>`,
        );
      }
      const markup = parts.join('');
      if (nestingDepth(markup, 10_000) + 1 < domDepth(markup)) below.push(markup);
    }
    expect(below).toEqual([]);
  });

  it('is linear and stops as soon as it passes the limit', { timeout: 60_000 }, () => {
    for (const make of [
      (n: number) => '<p>x'.repeat(n / 4),
      (n: number) => `<table>${'<tr><td>x'.repeat(n / 9)}`,
      (n: number) => `${'<div>'.repeat(400)}${'<span>x</span>'.repeat(n / 14)}`,
      (n: number) => `${'<b>'.repeat(10)}${'<div>'.repeat(400)}${'</b><b>'.repeat(n / 7)}`,
      (n: number) => '<style>a{}</style>'.repeat(n / 18),
    ])
      expect(growth(nestingDepth, make, 128 * 1024)).toBeLessThan(GROWTH_BOUND);
    expect(nestingDepth('<div>'.repeat(800_000))).toBeGreaterThan(MAX_NESTING);
  });
});
