// @vitest-environment jsdom
// The tool's promise as properties, on generated documents (a fixed seed, so a failure repeats): whatever the Markdown,
// the preview is built from the allowlist only — no element, attribute or address outside §5.6 — and an input of
// up to half a megabyte of the known pathological shapes (nested brackets, emphasis markers, …) costs time in proportion to its
// size, not to its square. Bounds are on the shape of the cost, never on milliseconds (a loaded machine).
import { isOpenableHref, renderMarkdown, toSafeFragment } from '.';
import corpus from './hostile-corpus.json';
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

const PIECES = [
  '# ',
  '## ',
  '> ',
  '- ',
  '1. ',
  '- [ ] ',
  '- [x] ',
  '*',
  '**',
  '_',
  '~~',
  '`',
  '```js\n',
  '```\n',
  '    ',
  '[',
  ']',
  '(',
  ')',
  '![',
  '](',
  '<',
  '>',
  '"',
  "'",
  '&',
  '&#x3C;',
  '&lt;',
  '\\',
  '|',
  '|:-:|',
  '---',
  '\n',
  '\n\n',
  '  \n',
  'text ',
  'http://a.invalid/x ',
  'mailto:a@b.invalid',
  'javascript:',
  'JaVaScRiPt:',
  'data:text/html,',
  'vbscript:',
  '%09',
  '&#x09;',
  '\t',
  '\u0001',
  'onerror=',
  'style=',
  '<script>',
  '<img src=x>',
  '<a href="javascript:x">',
  '<svg onload=x>',
  '[ref]: javascript:x\n',
  '[ref]',
  ...(corpus as Array<{ markdown: string }>).map(e => e.markdown),
];

const document_ = (next: (n: number) => number): string =>
  Array.from({ length: 5 + next(60) }, () => PIECES[next(PIECES.length)]).join('');

const ALLOWED_ELEMENTS = new Set(
  'p h1 h2 h3 h4 h5 h6 blockquote ul ol li pre code em strong s table thead tbody tr th td hr br a input span'.split(
    ' ',
  ),
);
const ALLOWED_ATTRIBUTES = new Set(['start', 'class', 'href', 'target', 'rel', 'title', 'type', 'disabled', 'checked']);

const problems = (fragment: DocumentFragment): string[] => {
  const out: string[] = [];
  for (const el of fragment.querySelectorAll('*')) {
    if (!ALLOWED_ELEMENTS.has(el.localName)) out.push(el.localName);
    for (const { name } of el.attributes) if (!ALLOWED_ATTRIBUTES.has(name)) out.push(`${el.localName}[${name}]`);
    if (el.localName === 'a' && !isOpenableHref(el.getAttribute('href') ?? '')) out.push('a[href]');
    if (el.localName === 'a' && el.getAttribute('rel') !== 'noopener noreferrer') out.push('a[rel]');
    if (el.localName === 'input' && (el.getAttribute('type') !== 'checkbox' || !el.hasAttribute('disabled')))
      out.push('input');
  }
  return out;
};

describe('properties of the preview', () => {
  it('1 000 generated documents: nothing outside the allowlist, through markdown-it and on the raw text alike', () => {
    const next = sequence(20261122);
    for (let i = 0; i < 1000; i++) {
      const source = document_(next);
      expect(problems(toSafeFragment(renderMarkdown(source), document)), source).toEqual([]);
      expect(problems(toSafeFragment(source, document)), source).toEqual([]);
    }
  }, 60_000); // jsdom is slow on a loaded machine: the bound is generous, the property is what is tested

  // The shape of the cost, not milliseconds (`growth`): half a megabyte against eight inputs of 64 Ki, timed in turn —
  // linear about 1, quadratic about 8, on a free machine or a loaded one.
  const SHAPES: Record<string, (n: number) => string> = {
    'nested brackets': n => '['.repeat(n),
    'image openers': n => '!['.repeat(n / 2),
    'brackets and emphasis': n => '[*'.repeat(n / 2),
    'emphasis markers between letters': n => '*a'.repeat(n / 2),
    'underscores between letters': n => '_a'.repeat(n / 2),
    'strikethrough openers': n => '~~a'.repeat(n / 3),
    'backtick runs': n => '`a``'.repeat(n / 4),
    'block quote markers': n => '>'.repeat(n),
    'angle brackets': n => '<'.repeat(n),
    'table of one long row': n => `${'|a'.repeat(n / 4)}\n${'|-'.repeat(n / 4)}`,
    'unclosed link destinations': n => `[a](${'('.repeat(n)}`,
  };
  it.each(Object.keys(SHAPES))(
    '%s: half a megabyte costs about what eight times 64 Ki do',
    name => {
      expect(growth(renderMarkdown, SHAPES[name]!, 65_536)).toBeLessThan(GROWTH_BOUND);
    },
    60_000,
  );
});
