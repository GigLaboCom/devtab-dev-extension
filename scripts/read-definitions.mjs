// Reads the extension's definitions outside the app, as the build sees them: bundles an entry (plain modules, relative
// imports only) with the esbuild that Vite brings and imports the result. scripts/start-parts.mjs (the start page's
// parts) and scripts/toolbar-button.mjs (the toolbar button) print what theirs declare for scripts/validate-build.sh and
// the e2e checks, so the definitions stay the one source of what the manifest and the build hold.
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fromExtension = createRequire(join(ROOT, 'extension/package.json'));
const esbuild = createRequire(fromExtension.resolve('vite'))('esbuild');

/** A module path under the workspace, as a string literal for an entry's `import`. */
export const at = path => JSON.stringify(join(ROOT, path));

/** The app's own import alias (extension/vite.config.ts), for an entry whose modules use it. */
export const APP_ALIAS = { '@src': join(ROOT, 'extension/src') };

/** Bundles `entry` (TypeScript source whose default export is plain data) and returns that export. */
export const readDefinitions = async (entry, { external = [], alias = {} } = {}) => {
  const { outputFiles } = await esbuild.build({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    external,
    alias,
    logLevel: 'silent',
  });
  const dir = mkdtempSync(join(tmpdir(), 'definitions-'));
  try {
    const file = join(dir, 'definitions.mjs');
    writeFileSync(file, outputFiles[0].text);
    return (await import(pathToFileURL(file).href)).default;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};
