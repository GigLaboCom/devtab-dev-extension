/**
 * Builds the showcase page into showcase/dist: compiles showcase.css with Tailwind v4 (the utilities are the class
 * names found in index.html), copies the page, its script and the package's fonts.
 *
 *   node showcase/build.mjs        (from packages/dna)
 */
import { compile } from '@tailwindcss/node';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, 'dist');

const html = readFileSync(join(here, 'index.html'), 'utf8');
const candidates = new Set();
for (const match of html.matchAll(/class="([^"]*)"/g)) {
  for (const name of match[1].split(/\s+/)) if (name) candidates.add(name);
}

const compiler = await compile(readFileSync(join(here, 'showcase.css'), 'utf8'), {
  base: here,
  onDependency: () => undefined,
});
const css = compiler.build([...candidates]);

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
// fonts.css names its files as ./fonts/…; the compiled sheet sits next to a copy of that folder.
writeFileSync(join(out, 'showcase.css'), css.replaceAll(/url\((['"]?)(?:\.\.\/|\.\/)*fonts\//g, 'url($1./fonts/'));
writeFileSync(join(out, 'index.html'), html);
cpSync(join(here, 'showcase.js'), join(out, 'showcase.js'));
cpSync(join(here, '..', 'fonts'), join(out, 'fonts'), { recursive: true });
cpSync(join(here, '..', 'themes.index.json'), join(out, 'themes.index.json'));

console.log(`showcase: ${candidates.size} class names, ${css.length} bytes of CSS → ${out}`);
