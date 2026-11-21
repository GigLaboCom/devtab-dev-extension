/**
 * The extension holds itself to the rules of @workspace/dna (its README → «Контракт»): the stylesheets, the Tailwind
 * classes in the components and pages, the inline styles and the HTML use the package's tokens only, so every theme
 * works and the look stays gpui-kit's. Also: the pages load the package in its order, and every `cn-*` / `kit-*` class
 * written here has a rule in the package (a class without one renders as nothing).
 */
import { lintCss, lintHtml, lintInlineStyles } from '@workspace/dna/lint';
import dnaMenu from '@workspace/dna/menu.css?raw';
import dnaSections from '@workspace/dna/sections.css?raw';
import dnaShell from '@workspace/dna/shell.css?raw';
import dnaDialog from '@workspace/dna/style-gpui-dialog.css?raw';
import dnaTools from '@workspace/dna/style-gpui-tools.css?raw';
import dnaStyle from '@workspace/dna/style-gpui.css?raw';
import dnaUi from '@workspace/dna/ui.css?raw';
import { describe, expect, it } from 'vitest';

const raw = (files: Record<string, unknown>) => Object.entries(files as Record<string, string>);
const CSS = raw(import.meta.glob('./**/*.css', { query: '?raw', import: 'default', eager: true }));
// The UI kit and the tools' own packages (D14) hold to the same contract as the extension's pages.
const TSX = raw(
  import.meta.glob(
    [
      './**/*.tsx',
      '!./**/*.test.tsx',
      '../../packages/ui/src/**/*.tsx',
      '!../../packages/ui/src/**/*.test.tsx',
      '../../packages/tools/ui/**/*.tsx',
      '!../../packages/tools/ui/**/*.test.tsx',
    ],
    { query: '?raw', import: 'default', eager: true },
  ),
);
const HTML = raw(import.meta.glob('./**/*.html', { query: '?raw', import: 'default', eager: true }));

const DNA_IMPORTS = [
  'tailwindcss',
  '@workspace/dna/theme.css',
  '@workspace/dna/tailwind.css',
  '@workspace/dna/style-gpui.css',
  '@workspace/dna/ui.css',
];
// The toolbar menu's popup page takes its own frame instead of the main page's; the shell's lazy stylesheet takes a
// Tailwind build of its own (the theme without the preflight, the utilities over the tools too, the bridge), the Table
// and the tools' parts, the Dialog, the sections' frames and the shell's frame.
const SHELL_IMPORTS = [
  'tailwindcss/theme.css',
  'tailwindcss/utilities.css',
  '@workspace/dna/tailwind.css',
  '@workspace/dna/style-gpui-tools.css',
  '@workspace/dna/style-gpui-dialog.css',
  '@workspace/dna/sections.css',
  '@workspace/dna/shell.css',
];
const IMPORTS = [...DNA_IMPORTS, '@workspace/dna/menu.css', ...SHELL_IMPORTS];
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
    expect(CSS.map(([file]) => file)).toEqual([
      './app/app.css',
      './app/shell.css',
      './popup/popup.css',
      './viewer/viewer.css',
    ]);
    // vitest.config.ts processes CSS: without it a `?raw` CSS import is '' and the lint below proves nothing.
    for (const [file, css] of CSS) expect(css.length, file).toBeGreaterThan(300);
    expect(TSX.length).toBeGreaterThanOrEqual(10);
    expect(HTML).toHaveLength(3);
  });

  it.each(CSS)('%s: tokens only', (file, css) => {
    expect(lintCss(css, { file, own: OWN, imports: IMPORTS })).toEqual([]);
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

  it('the main page’s own stylesheet keeps to the theme picker: page frames are kit-* rules', () => {
    // The layout of a page (the shell, the start page, settings, «Compare code») is the package's `kit-*` frame
    // (ui.css), so the contract below and the package's own lint cover it; a class of a new prefix here would go around
    // both.
    const app = CSS.find(([file]) => file === './app/app.css')![1]
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/@import[^;]*;/g, '');
    const own = new Set([...app.matchAll(/\.([a-z][\w-]*)/gi)].map(m => m[1]));
    expect([...own].sort()).toEqual(['theme-field', 'theme-field-label', 'theme-picker', 'theme-swatch']);
  });

  it('the toolbar menu’s popup takes the tokens, the base and its frame (menu.css) only — no rules of its own', () => {
    // Light: no Tailwind, no components, not the main page's frame. Its look is the package's `kit-menu*`.
    const popup = CSS.find(([file]) => file === './popup/popup.css')![1];
    expect([...popup.matchAll(/@import '([^']+)';/g)].map(m => m[1])).toEqual([
      '@workspace/dna/theme.css',
      '@workspace/dna/menu.css',
    ]);
    expect(
      popup
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@import[^;]*;/g, '')
        .trim(),
    ).toBe('');
  });

  it('the shell’s own stylesheet (loaded with its lazy chunk) takes the Dialog and the shell’s frame only', () => {
    // Off the start route (a new tab has a byte budget): the shell, the palette and the Tools overview are
    // shell.css, the Dialog is style-gpui-dialog.css; app.css has set the layers' order before this loads.
    const shell = CSS.find(([file]) => file === './app/shell.css')![1];
    expect([...shell.matchAll(/@import '([^']+)'[^;]*;/g)].map(m => m[1])).toEqual(SHELL_IMPORTS);
    expect(
      shell
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/@import[^;]*;/g, '')
        .replace(/@source[^;]*;/g, '')
        .trim(),
    ).toBe('');
    // It scans the tools; app.css does not (a tool adds nothing to the start page's stylesheet), and scans nothing
    // app.css would not (so the start page's utilities are all here again, in one build's order).
    expect(shell).toContain("@source '../../../packages/tools/ui';");
    const app = CSS.find(([file]) => file === './app/app.css')![1];
    expect(app).not.toContain('packages/tools');
    for (const target of SHELL_IMPORTS.filter(t => t.startsWith('@workspace/dna/') && !t.endsWith('/tailwind.css')))
      expect(app).not.toContain(target);
  });

  it('the editor page takes the tokens and the base only (no Tailwind, no components)', () => {
    const viewer = CSS.find(([file]) => file === './viewer/viewer.css')![1];
    expect([...viewer.matchAll(/@import '([^']+)';/g)].map(m => m[1])).toEqual(['@workspace/dna/theme.css']);
  });
});

describe('every cn-* and kit-* class written here has a rule in @workspace/dna', () => {
  const defined = new Set(
    [dnaStyle, dnaDialog, dnaTools, dnaUi, dnaSections, dnaShell, dnaMenu].flatMap(css =>
      [...css.replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/\.((?:cn|kit)-[\w-]+)/g)].map(m => m[1]!),
    ),
  );
  it.each(TSX)('%s', (_file, source) => {
    const used = classesOf(source).filter(c => /^(?:cn|kit)-/.test(c));
    expect(used.filter(c => !defined.has(c))).toEqual([]);
  });

  // A page that builds its rows from a <template> (the toolbar menu) writes its classes in the HTML.
  it.each(HTML)('%s', (_file, html) => {
    const used = [...html.matchAll(/\sclass="([^"]*)"/g)]
      .flatMap(m => m[1]!.split(/\s+/))
      .filter(c => /^(?:cn|kit)-/.test(c));
    expect(used.filter(c => !defined.has(c))).toEqual([]);
  });
});
