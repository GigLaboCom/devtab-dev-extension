#!/usr/bin/env node
// Copies gpui-kit's theme files the offered themes come from (themes.index.json of @workspace/dna) into gpui-themes/,
// for the wasm editor's `set_theme`. Two lines go: `$schema` and `url` — links to GitHub that would otherwise ship in
// the extension's JS (scripts/validate-build.sh, Check 11: no remote hosts in the build); the theme data stays
// byte for byte.
//
//   node scripts/sync-gpui-themes.mjs [<gpui-kit checkout>]
//   (default: ~/.cargo/git/checkouts/gpui-component-72ee0333141c5f7c/d5da0f6 — the commit themes.css was exported from)
import { mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const gk = resolve(
  process.argv[2] ?? resolve(homedir(), '.cargo/git/checkouts/gpui-component-72ee0333141c5f7c/d5da0f6'),
);

/** The file as shipped: the upstream text without its `$schema` and `url` lines. */
export const shipped = text => text.replace(/^ +"(?:\$schema|url)": "[^"]*",\n/gm, '');

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const index = JSON.parse(readFileSync(resolve(pkg, '../dna/themes.index.json'), 'utf8'));
  const files = [...new Set(index.map(t => t.source).filter(s => s !== 'default-theme.json'))].sort();
  const out = resolve(pkg, 'gpui-themes');
  for (const old of readdirSync(out)) rmSync(resolve(out, old));
  mkdirSync(out, { recursive: true });
  for (const file of files)
    writeFileSync(resolve(out, file), shipped(readFileSync(resolve(gk, 'themes', file), 'utf8')));
  console.log(`gpui-themes/: ${files.length} files from ${gk}`);
  console.log('Update the SOURCES table in lib/sources.ts if the list changed (the test compares them).');
}
