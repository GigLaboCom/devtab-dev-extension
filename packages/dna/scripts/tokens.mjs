#!/usr/bin/env node
// tokens.json from the CSS: every theme of themes.css (generated) and the base tokens of theme.css's `:root`.
//
//   node scripts/tokens.mjs          prints the derived JSON
//   node scripts/tokens.mjs --write  writes tokens.json (after sync-themes.mjs, or after editing theme.css)
//
// tests/tokens.test.ts derives the same object and fails when tokens.json differs, so the list never drifts.
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = new URL('../', import.meta.url);
const read = name => readFileSync(new URL(name, here), 'utf8');
const strip = css => css.replace(/\/\*[\s\S]*?\*\//g, '');

/** `--name: value;` pairs of a block body, whitespace collapsed, in source order. */
const props = body =>
  Object.fromEntries(
    [...body.matchAll(/(--[a-z0-9-]+)\s*:\s*([^;]+);/gi)].map(m => [m[1], m[2].replace(/\s+/g, ' ').trim()]),
  );

/** Body of the block that opens at `at` (the index of its `{`). */
const body = (css, at) => {
  let depth = 0;
  for (let i = at; i < css.length; i++) {
    if (css[i] === '{') depth++;
    else if (css[i] === '}' && --depth === 0) return css.slice(at + 1, i);
  }
  throw new Error('unbalanced braces');
};

/** `{ id: { mode, tokens } }` of every `[data-theme="id"]` block. */
export const deriveThemes = themesCss => {
  const css = strip(themesCss);
  const themes = {};
  for (const m of css.matchAll(/\[data-theme="([^"]+)"\]\s*\{/g)) {
    const block = body(css, m.index + m[0].length - 1);
    const mode = /color-scheme:\s*(light|dark)/.exec(block)?.[1];
    if (!mode) throw new Error(`${m[1]}: no color-scheme`);
    themes[m[1]] = { mode, tokens: props(block) };
  }
  return themes;
};

/** The base tokens: the custom properties of theme.css's top-level `:root` block. */
export const deriveBase = themeCss => {
  const css = strip(themeCss);
  const at = css.search(/(^|\n):root\s*\{/);
  if (at < 0) throw new Error('theme.css has no :root block');
  return props(body(css, css.indexOf('{', at)));
};

export const deriveTokens = (themesCss = read('themes.css'), themeCss = read('theme.css')) => ({
  $comment:
    'Every token of @workspace/dna: `themes` — the generated themes.css, per theme id (gpui-kit values); `base` — the hand-written :root of theme.css. Derived by scripts/tokens.mjs; tests/tokens.test.ts re-derives it and fails on drift. Never edit by hand.',
  styleApi: '1.0.0',
  themes: deriveThemes(themesCss),
  base: deriveBase(themeCss),
});

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const json = `${JSON.stringify(deriveTokens(), null, 2)}\n`;
  if (process.argv.includes('--write')) {
    writeFileSync(new URL('tokens.json', here), json);
    const t = deriveTokens();
    console.log(`tokens.json: ${Object.keys(t.themes).length} themes, ${Object.keys(t.base).length} base tokens`);
  } else process.stdout.write(json);
}
