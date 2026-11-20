/**
 * The extension holds itself to the rules of @workspace/dna (its README → «Контракт»): the stylesheets, the Tailwind
 * classes in the components and pages, the inline styles and the HTML use the package's tokens only, so every theme
 * works and the look stays gpui-kit's. Also: the pages load the package in its order, and every `cn-*` / `kit-*` class
 * written here has a rule in the package (a class without one renders as nothing).
 */
import { lintCss, lintHtml, lintInlineStyles } from '@workspace/dna/lint';
import dnaStyle from '@workspace/dna/style-gpui.css?raw';
import dnaUi from '@workspace/dna/ui.css?raw';
import { describe, expect, it } from 'vitest';

const raw = (files: Record<string, unknown>) => Object.entries(files as Record<string, string>);
const CSS = raw(import.meta.glob('./**/*.css', { query: '?raw', import: 'default', eager: true }));
const TSX = raw(
  import.meta.glob(['./**/*.tsx', '!./**/*.test.tsx'], { query: '?raw', import: 'default', eager: true }),
);
const HTML = raw(import.meta.glob('./**/*.html', { query: '?raw', import: 'default', eager: true }));

const DNA_IMPORTS = [
  'tailwindcss',
  '@workspace/dna/theme.css',
  '@workspace/dna/tailwind.css',
  '@workspace/dna/style-gpui.css',
  '@workspace/dna/ui.css',
];
// Radix publishes its measurements as custom properties (`--radix-select-trigger-width`); the components read them.
const OWN = ['--radix-'];

/** String literals of an expression: `'a b'`, `"a"`, `` `a ${x}` `` (the interpolations dropped). */
const literals = (code: string): string[] =>
  [...code.matchAll(/'([^']*)'|"([^"]*)"|`([^`]*)`/g)].map(m =>
    (m[1] ?? m[2] ?? m[3] ?? '').replace(/\$\{[^}]*\}/g, ' '),
  );

/** The expression that opens at `from` (just after a `{` or `(`), up to its matching close. */
const balanced = (source: string, from: number, open: string, close: string): string => {
  let depth = 1;
  let i = from;
  for (; i < source.length && depth > 0; i++) {
    if (source[i] === open) depth++;
    else if (source[i] === close) depth--;
  }
  return source.slice(from, i - 1);
};

/** Every class a file writes: `className="…"`, `className={…}` and the variant tables of `cva(…)`. */
const classesOf = (source: string): string[] => {
  const out: string[] = [];
  for (const m of source.matchAll(/className=(?:"([^"]*)"|\{)/g)) {
    const values = m[1] !== undefined ? [m[1]] : literals(balanced(source, m.index + m[0].length, '{', '}'));
    for (const value of values) out.push(...value.split(/\s+/).filter(Boolean));
  }
  for (const m of source.matchAll(/\bcva\(/g)) {
    for (const value of literals(balanced(source, m.index + m[0].length, '(', ')'))) {
      out.push(...value.split(/\s+/).filter(Boolean));
    }
  }
  return out;
};

describe('the extension’s styling keeps the @workspace/dna contract', () => {
  it('finds its sources', () => {
    expect(CSS.map(([file]) => file)).toEqual(['./app/app.css', './viewer/viewer.css']);
    // vitest.config.ts processes CSS: without it a `?raw` CSS import is '' and the lint below proves nothing.
    for (const [file, css] of CSS) expect(css.length, file).toBeGreaterThan(300);
    expect(TSX.length).toBeGreaterThanOrEqual(10);
    expect(HTML).toHaveLength(2);
  });

  it.each(CSS)('%s: tokens only', (file, css) => {
    expect(lintCss(css, { file, own: OWN, imports: DNA_IMPORTS })).toEqual([]);
  });

  it.each(TSX)('%s: Tailwind classes name tokens only', (file, source) => {
    const classes = classesOf(source);
    expect(lintCss(`.tsx { @apply ${classes.join(' ')}; }`, { file, own: OWN })).toEqual([]);
  });

  it.each(TSX)('%s: no styling in inline styles', (file, source) => {
    expect(lintInlineStyles(source, { file })).toEqual([]);
  });

  it.each(HTML)('%s: no inline style or script', (file, html) => {
    expect(lintHtml(html, { file })).toEqual([]);
  });

  it('the main page loads Tailwind, then the package: tokens, bridge, component style, frame', () => {
    const app = CSS.find(([file]) => file === './app/app.css')![1];
    const at = DNA_IMPORTS.map(target => app.indexOf(`@import '${target}';`));
    expect(at.every(i => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
  });

  it('the editor page takes the tokens and the base only (no Tailwind, no components)', () => {
    const viewer = CSS.find(([file]) => file === './viewer/viewer.css')![1];
    expect([...viewer.matchAll(/@import '([^']+)';/g)].map(m => m[1])).toEqual(['@workspace/dna/theme.css']);
  });
});

describe('every cn-* and kit-* class written here has a rule in @workspace/dna', () => {
  const defined = new Set(
    [dnaStyle, dnaUi].flatMap(css =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.((?:cn|kit)-[\w-]+)/g)].map(m => m[1]!),
    ),
  );
  it.each(TSX)('%s', (_file, source) => {
    const used = classesOf(source).filter(c => /^(?:cn|kit)-/.test(c));
    expect(used.filter(c => !defined.has(c))).toEqual([]);
  });
});
