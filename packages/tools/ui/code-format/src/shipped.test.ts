/**
 * What the Prettier worker imports is shipped exactly as published (the bundler copies the files; it does not process
 * them), so the files themselves are checked here: each module is self-contained (no import of its own, nothing the
 * page would have to resolve), none builds code from strings (the extension's CSP refuses `eval` and `new Function`),
 * and the only addresses in them are in messages — a new one fails this test before it ships. The build validator
 * looks only at `.js` files, and these are `.mjs` (docs/tools/specs/code-format.md §15).
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const prettierDir = dirname(require.resolve('prettier/package.json'));
const saxesDir = dirname(require.resolve('saxes/package.json'));

const SHIPPED = [
  'standalone.mjs',
  'plugins/babel.mjs',
  'plugins/estree.mjs',
  'plugins/postcss.mjs',
  'plugins/html.mjs',
  'plugins/markdown.mjs',
  'plugins/yaml.mjs',
];
/** Where each address is: a message about the plugin API, PostCSS's deprecation warning, remark's internal error, an HTML namespace. */
const KNOWN_HOSTS = ['prettier.io', 'evilmartians.com', 'git.io', 'www.w3.org'];

const read = (path: string): string => readFileSync(path, 'utf8');

describe('the Prettier modules the worker imports', () => {
  it('is version 3.9.10', () => {
    expect(JSON.parse(read(join(prettierDir, 'package.json'))).version).toBe('3.9.10');
  });

  it.each(SHIPPED)('%s is self-contained and builds no code from strings', file => {
    const source = read(join(prettierDir, file));
    expect(source.match(/(?:^|[;}\n])\s*import\s*(?:[{*"']|[\w$]+\s*(?:,|from\b))/g) ?? []).toEqual([]);
    // (Babel's message "`import` can only be used in `import()`…" is the one place the word is followed by a bracket.)
    expect(source.match(/(?<![`\w$.])import\(/g) ?? []).toEqual([]);
    expect(source.match(/\beval\s*\(/g) ?? []).toEqual([]);
    expect(source.match(/\bnew\s+Function\b/g) ?? []).toEqual([]);
    expect(source.match(/(?<![\w$.])Function\s*\(/g) ?? []).toEqual([]);
    expect(source.match(/\bimportScripts\b|\bfetch\s*\(|XMLHttpRequest/g) ?? []).toEqual([]);
  });

  it('mentions no address but the known ones', () => {
    const hosts = new Set<string>();
    for (const file of SHIPPED)
      for (const m of read(join(prettierDir, file)).matchAll(/https?:\/\/([a-zA-Z0-9.-]+)/g)) hosts.add(m[1]!);
    expect([...hosts].sort()).toEqual([...KNOWN_HOSTS].sort());
  });

  it('saxes builds no code from strings either', () => {
    const source = read(join(saxesDir, 'saxes.js'));
    expect(JSON.parse(read(join(saxesDir, 'package.json'))).version).toBe('6.0.0');
    expect(source.match(/\beval\s*\(|\bnew\s+Function\b|(?<![\w$.])Function\s*\(/g) ?? []).toEqual([]);
  });
});
