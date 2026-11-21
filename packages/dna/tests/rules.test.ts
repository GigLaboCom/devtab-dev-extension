import { COLOR_NAMES, TOKENS, lintCss, lintHtml, lintInlineStyles } from '../lint/rules';
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import type { Violation } from '../lint/rules';

const rulesOf = (violations: Violation[]) => [...new Set(violations.map(v => v.rule))].sort();
const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');

describe('every rule fires (failing cases)', () => {
  const red: Array<[string, string]> = [
    ['color-literal', '.a { color: #ff0000; }'],
    ['color-literal', '.a { background: rgb(0 0 0 / 0.5); }'],
    ['color-literal', '.a { border: 1px solid white; }'],
    ['color-literal', '.a { @apply bg-red-500; }'],
    ['color-literal', '.a { @apply text-white; }'],
    ['color-literal', '.a { @apply bg-[#fafafa]; }'],
    ['unknown-token', '.a { color: var(--backround); }'],
    ['unknown-token', '.a { @apply bg-brand; }'],
    ['token-override', ':root { --primary: var(--secondary); }'],
    ['radius', '.a { border-radius: 10px; }'],
    ['radius', '.a { @apply rounded-[10px]; }'],
    ['radius', '.a { @apply rounded-pill; }'],
    ['shadow', '.a { box-shadow: 0 1px 2px var(--border); }'],
    ['shadow', '.a { @apply shadow-[0_1px_2px_black]; }'],
    ['shadow', '.a { @apply shadow-glow; }'],
    ['size-literal', '.a { padding: 12px; }'],
    ['size-literal', '.a { grid-template-columns: 220px 1fr; }'],
    ['size-literal', '.a { @apply h-[25px]; }'],
    ['font-size', '.a { font-size: 13px; }'],
    ['weight', '.a { font-weight: 700; }'],
    ['weight', '.a { @apply font-bold; }'],
    ['font-stack', '.a { font-family: Inter; }'],
    ['system-font', '.a { font-family: system-ui, sans-serif; }'],
    ['gradient', '.a { background: linear-gradient(var(--primary), var(--secondary)); }'],
    ['gradient', '.a { @apply bg-linear-to-r; }'],
    ['blur', '.a { backdrop-filter: blur(4px); }'],
    ['blur', '.a { @apply backdrop-blur-xs; }'],
    ['color-scheme', '@media (prefers-color-scheme: dark) { .a { color: var(--foreground); } }'],
    ['font-face', '@font-face { font-family: X; src: url(x.woff2); }'],
    ['import', "@import 'other.css';"],
  ];
  it.each(red)('%s ← %s', (rule, css) => {
    expect(rulesOf(lintCss(css))).toContain(rule);
  });

  it('and stays quiet on what the contract allows', () => {
    const ok = `
      @import 'tailwindcss';
      .a { color: var(--muted-foreground); background: color-mix(in oklab, var(--accent) 80%, transparent); }
      .b { border: 1px solid var(--border); border-radius: var(--radius-md); box-shadow: var(--shadow-md); }
      .c { padding: calc(var(--spacing) * 3) 0; font-size: var(--text-sm); font-weight: 600; font-family: var(--font-mono); }
      .d { grid-template-columns: var(--sidebar-width) minmax(0, 1fr); height: 100%; border-radius: 50%; }
      .e { --x-gap: calc(var(--spacing) * 2); gap: var(--x-gap); }
      .f { @apply bg-primary text-primary-foreground hover:bg-primary-hover/80 rounded-md h-8 px-2.5 text-sm shadow-sm ring-1 ring-foreground/10 border-b border-transparent [&_svg:not([class*='size-'])]:size-4 focus-visible:ring-3 origin-(--radix-x) font-medium; }
      @media (max-width: 900px) { .a { display: none; } }
    `;
    expect(lintCss(ok, { own: ['--x-', '--radix-'], imports: ['tailwindcss'] })).toEqual([]);
  });

  it('own prefixes and allowed imports are options', () => {
    expect(rulesOf(lintCss('.p { --page-w: 4; }'))).toEqual(['token-override']);
    expect(lintCss('.p { --page-w: 4; }', { own: ['--page-'] })).toEqual([]);
    expect(rulesOf(lintCss("@import '@workspace/dna/theme.css';"))).toEqual(['import']);
    expect(lintCss("@import '@workspace/dna/theme.css';", { imports: ['@workspace/dna/theme.css'] })).toEqual([]);
  });

  it('inline styles: colours refused, geometry allowed; HTML: no style, no inline script', () => {
    expect(rulesOf(lintInlineStyles('<div style={{ color: "red" }} />'))).toEqual(['inline-style']);
    expect(rulesOf(lintInlineStyles('<div style={styles} />'))).toEqual(['inline-style']);
    expect(lintInlineStyles("<div style={{ width: 10, transform: 'x' }} />")).toEqual([]);
    expect(rulesOf(lintHtml('<p style="color: red">x</p>'))).toEqual(['inline-style']);
    expect(rulesOf(lintHtml('<style>p{}</style>'))).toEqual(['inline-style']);
    expect(rulesOf(lintHtml('<script>alert(1)</script>'))).toEqual(['inline-script']);
    expect(lintHtml('<script src="/x.js"></script><script type="module" src="./m.ts"></script>')).toEqual([]);
  });

  it('knows the tokens: the themes’ colours and the base', () => {
    for (const name of [
      '--background',
      '--primary-hover',
      '--radius-md',
      '--text-sm',
      '--shadow-tooltip',
      '--spacing',
    ]) {
      expect(TOKENS.has(name), name).toBe(true);
    }
    expect(COLOR_NAMES.has('tab-bar-segmented')).toBe(true);
    expect(COLOR_NAMES.has('radius-md')).toBe(false);
  });
});

describe('the package’s own pieces keep the contract', () => {
  it('ui.css (the extension frame the start page needs)', () => {
    expect(lintCss(read('ui.css'), { file: 'ui.css' })).toEqual([]);
  });

  it('sections.css (the frames of the extension’s sections)', () => {
    expect(lintCss(read('sections.css'), { file: 'sections.css' })).toEqual([]);
  });

  it('shell.css (the shell around the sections: sidebar, toolbar, palette)', () => {
    expect(lintCss(read('shell.css'), { file: 'shell.css' })).toEqual([]);
  });

  it('menu.css (the toolbar menu’s frame)', () => {
    expect(lintCss(read('menu.css'), { file: 'menu.css' })).toEqual([]);
  });

  it('style-gpui.css (the component layer)', () => {
    expect(lintCss(read('style-gpui.css'), { file: 'style-gpui.css', own: ['--radix-'] })).toEqual([]);
  });

  it('style-gpui-tools.css (the Table and the tools’ parts of the component layer)', () => {
    expect(lintCss(read('style-gpui-tools.css'), { file: 'style-gpui-tools.css' })).toEqual([]);
  });

  it('style-gpui-dialog.css (the Dialog of the component layer)', () => {
    expect(lintCss(read('style-gpui-dialog.css'), { file: 'style-gpui-dialog.css' })).toEqual([]);
  });
});
