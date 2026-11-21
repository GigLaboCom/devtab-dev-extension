// The start route as Check 15 of validate-build.sh counts it — what a new tab loads before its first paint: the main
// page's scripts and stylesheets, their static imports and the boot scripts — and a build of the extension into a
// directory of its own (the configuration of `pnpm build`, minified). Shared by scripts/start-route-report.mjs (bytes by
// piece) and scripts/start-route-growth.mjs (what a tool adds to it).
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const APP_PAGE = 'src/app/index.html';

/** Builds the extension into `outDir` (emptied first); `sourcemap: 'hidden'` adds maps without naming them. */
export const buildExtension = async (outDir, { sourcemap = false } = {}) => {
  const fromExtension = createRequire(join(ROOT, 'extension/package.json'));
  const { build } = await import(fromExtension.resolve('vite'));
  process.env.CLI_CEB_DEV = 'false';
  await build({
    root: join(ROOT, 'extension'),
    configFile: join(ROOT, 'extension/vite.config.ts'),
    logLevel: 'error',
    build: { outDir, emptyOutDir: true, sourcemap },
  });
};

/** The files a new tab loads before its first paint, as Check 15 counts them (absolute paths). */
export const startFiles = dir => {
  const html = readFileSync(join(dir, APP_PAGE), 'utf8');
  const refs = [...html.matchAll(/<(?:script|link)[^>]*(?:src|href)="([^"]+\.(?:js|css))"/g)].map(m => m[1]);
  const files = new Set();
  const queue = refs.map(ref => (ref.startsWith('/') ? join(dir, ref) : join(dirname(join(dir, APP_PAGE)), ref)));
  while (queue.length) {
    const file = queue.shift();
    if (files.has(file) || !existsSync(file)) continue;
    files.add(file);
    if (!file.endsWith('.js')) continue;
    const text = readFileSync(file, 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*["'](\.{1,2}\/[^"']+\.js)["']/g))
      queue.push(resolve(dirname(file), m[1]));
  }
  return [...files];
};

export const bytesOf = files => files.reduce((sum, f) => sum + readFileSync(f).length, 0);
