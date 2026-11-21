/**
 * The tool catalogue (D16, docs/research/start-route-budget.md): what the start page, the palette and the sidebar need to
 * know of every tool before any of its code — id, title and keywords (and the shortcut it suggests, when it does) — as
 * data, produced at build time from the tools' definitions. The start page imports this module instead of the
 * definitions, so a tool adds one entry of data to its first load and nothing else; the definitions (with their history
 * declarations and component loaders) load with the shell, a tool's `detect` with the detectors' chunk
 * (src/tools/detectors.ts) when pasted text first needs it.
 *
 * `virtual:tool-catalogue` exports `CATALOGUE`: the entries in the order the definitions ask for (`order`, then `id`,
 * as src/tools/registry.ts sorts them). Each definition module is bundled on its own with the esbuild Vite brings — its
 * dynamic imports (the component) left out — and evaluated in Node; a definition that imports more than its history
 * declaration fails src/tools/shape.test.ts, and one that cannot be evaluated here fails the build.
 */
import { existsSync, readdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { Plugin } from 'vite';

export const CATALOGUE_MODULE = 'virtual:tool-catalogue';
const RESOLVED = `\0${CATALOGUE_MODULE}`;

/** The shortcut a tool suggests, as its definition writes it (ToolShortcut of @workspace/tools-host). */
type Shortcut = Record<string, unknown>;

export interface CatalogueEntry {
  id: string;
  title: string;
  keywords: readonly string[];
  shortcut?: Shortcut;
}

interface Definition extends CatalogueEntry {
  order: number;
}

/** As much of the esbuild Vite brings as this module uses (esbuild is Vite's dependency, not the extension's). */
interface Esbuild {
  build(options: {
    entryPoints: string[];
    bundle: boolean;
    write: false;
    format: 'esm';
    platform: 'neutral';
    logLevel: 'silent';
    plugins: Array<{
      name: string;
      setup(build: {
        onResolve(
          options: { filter: RegExp },
          callback: (args: { path: string; kind: string }) => { path: string; external: boolean } | undefined,
        ): void;
      }): void;
    }>;
  }): Promise<{ outputFiles: Array<{ text: string }> }>;
}

const esbuildOf = (root: string): Esbuild => {
  const fromExtension = createRequire(join(root, 'extension/package.json'));
  return createRequire(fromExtension.resolve('vite'))('esbuild') as Esbuild;
};

/** `packages/tools/ui/<id>/src/definition.ts` of every tool package under `root`. */
export const definitionFiles = (root: string): string[] => {
  const dir = join(root, 'packages/tools/ui');
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter(e => e.isDirectory())
    .map(e => join(dir, e.name, 'src/definition.ts'))
    .filter(existsSync);
};

const readDefinition = async (esbuild: Esbuild, file: string): Promise<Definition | undefined> => {
  const { outputFiles } = await esbuild.build({
    entryPoints: [file],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [
      {
        name: 'leave-lazy-imports',
        setup(build) {
          build.onResolve({ filter: /.*/ }, args =>
            args.kind === 'dynamic-import' ? { path: args.path, external: true } : undefined,
          );
        },
      },
    ],
  });
  const source = outputFiles[0].text;
  const module = (await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`)) as {
    definition?: Definition;
  };
  return module.definition;
};

/** The catalogue of the tools under `root`, in their order. */
export const readCatalogue = async (root: string, files = definitionFiles(root)): Promise<CatalogueEntry[]> => {
  const esbuild = esbuildOf(root);
  const found: Definition[] = [];
  for (const file of files) {
    const d = await readDefinition(esbuild, file);
    // A package without a `definition` export is left out, as the registry leaves it out (the shape test fails it).
    if (!d) continue;
    if (typeof d.id !== 'string' || typeof d.title !== 'string' || !Array.isArray(d.keywords))
      throw new Error(`${file}: the definition has no id, title or keywords`);
    found.push(d);
  }
  return found
    .sort((a, b) => a.order - b.order || a.id.localeCompare(b.id))
    .map(({ id, title, keywords, shortcut }) => ({ id, title, keywords, ...(shortcut ? { shortcut } : {}) }));
};

/** The module's source: data only. */
export const catalogueSource = (entries: readonly CatalogueEntry[]): string =>
  `export const CATALOGUE = ${JSON.stringify(entries)};\n`;

/** Serves `virtual:tool-catalogue` from the definitions under `root` (the workspace). */
export const toolCatalogue = (root: string): Plugin => ({
  name: 'extension:tool-catalogue',
  resolveId: id => (id === CATALOGUE_MODULE ? RESOLVED : null),
  async load(id) {
    if (id !== RESOLVED) return null;
    const files = definitionFiles(root);
    // Rebuild in watch mode when a definition or its history declaration changes.
    for (const file of files) {
      this.addWatchFile(file);
      const history = join(file, '../history.ts');
      if (existsSync(history)) this.addWatchFile(history);
    }
    return catalogueSource(await readCatalogue(root, files));
  },
});
