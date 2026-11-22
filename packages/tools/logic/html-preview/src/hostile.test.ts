// @vitest-environment jsdom
// The hostile corpus (hostile-corpus.json — the same entries the e2e module pastes into the built extension): Markdown
// Preview's 63 entries as raw HTML (they render here), then <script> in every form, every event handler, javascript: /
// vbscript: / data: in every attribute that takes an address, navigation, frames and objects, forms, <link> in every
// rel, images and media, SVG, CSS that loads, reads or covers, DOM clobbering, mutation XSS shapes and character
// encoding tricks. Every remote address is a reserved name (*.invalid, example.com) or a local port where nothing
// listens. Each entry, checked by the logic's layer (the layers after it — the sandboxed frame, its own policy, the
// page's policy — are the e2e module's, with and without this one):
//   1. the checked document holds nothing the promise does not allow (testing.ts states it independently of the rules);
//   2. Copy HTML is a fixed point: parsed and checked again it loses nothing more and reads the same — what is copied
//      cannot change meaning when parsed again (mutation XSS);
//   3. the canary is never in an attribute a browser acts on.
import { removedText, sanitizeHtml, serializeSanitized } from '.';
import corpus from './hostile-corpus.json';
import { CANARY, violations } from './testing';
import { describe, expect, it } from 'vitest';

interface Entry {
  name: string;
  html: string;
  from?: 'markdown-preview';
}
const ENTRIES = (corpus as Entry[]).map(e => ({ ...e, html: e.html.replaceAll('{{CANARY}}', CANARY) }));
const check = (html: string) => sanitizeHtml(html, document);

describe('the hostile corpus', () => {
  it('has its size — Markdown Preview’s 63 and the HTML preview’s own — every remote address reserved', () => {
    expect(ENTRIES.length).toBe(333);
    expect(ENTRIES.filter(e => e.from === 'markdown-preview')).toHaveLength(63);
    expect(new Set(ENTRIES.map(e => e.name)).size).toBe(ENTRIES.length);
    for (const { html } of ENTRIES)
      for (const [, host] of html.matchAll(/(?<![/:\w])(?:https?:)?\/\/([^/\s"'`)>\\&]+)/g))
        expect(host, html).toMatch(/(\.invalid|^example\.com|^127\.0\.0\.1:9)$/);
  });

  it.each(ENTRIES.map(e => [e.name, e] as const))('%s', (_, e) => {
    const result = check(e.html);
    expect(violations(result)).toEqual([]);
    const copied = serializeSanitized(result);
    const again = check(copied);
    expect(violations(again)).toEqual([]);
    expect(removedText(again.counts), copied).toBe('');
    expect(again.counts.styleUrls).toBe(0);
    expect(serializeSanitized(again)).toBe(copied);
    // What is copied, parsed as it is (no check): no script element, no handler anywhere.
    const raw = new DOMParser().parseFromString(copied, 'text/html');
    expect(raw.querySelectorAll('script')).toHaveLength(0);
    for (const el of Array.from(raw.querySelectorAll('*')))
      for (const a of Array.from(el.attributes)) expect(a.name, copied).not.toMatch(/^on/i);
  });

  it('what is neutralised without a word in «Not shown» is what §5.2 removes silently, or only text', () => {
    const silent: string[] = [];
    for (const e of ENTRIES) {
      if (e.from) continue;
      const { counts } = check(e.html);
      const risky = /<script|\son[a-z]+=|src=|srcset=|href="|url\(|image-set|@import/i.test(e.html);
      if (risky && !Object.values(counts).some(n => n > 0)) silent.push(e.name);
    }
    expect(silent.sort()).toEqual(
      [
        // removed silently by §5.2: <link> other than a stylesheet, <base>, <meta>, <template>, <title>, noembed,
        // noframes; an SVG's address; a link's ping, target, download (the link itself still opens)
        ...[
          'apple-touch-icon',
          'compression-dictionary',
          'dns-prefetch',
          'expect',
          'icon',
          'import',
          'manifest',
          'modulepreload',
          'next',
          'pingback',
          'preconnect',
          'prefetch',
          'preload',
          'prerender',
          'search',
          'serviceworker',
          'shortcut icon',
        ].map(rel => `link rel=${rel}`),
        'SVG cursor and font-face-uri elements',
        'SVG use with a remote address and data:',
        'base in the body and in SVG',
        'declarative shadow root',
        'javascript: ping',
        'link that targets a named frame and asks for an opener',
        'link that targets the top',
        'link with download',
        'meta http-equiv content type UTF-7',
        'noembed and noframes',
        'template with a style that would swallow',
        'textarea and title text',
        // harmless as written: the risky part is text (an attribute value, a comment, raw text, CSS text) or a reference
        // into the document
        'SVG with local references (kept)',
        'attributes in the closing tag',
        'conditional comments of a mail template',
        'link on a local port',
        'math, mtext, table, mglyph, style',
        'nested forms with math and mglyph (a known bypass)',
        'noscript with a title that closes it',
        'plaintext',
        'script in an attribute value',
        'select with a style',
        'style text with a tag',
        'svg CDATA',
        'svg style whose text closes an HTML style',
        'xmp',
      ].sort(),
    );
  });
});
