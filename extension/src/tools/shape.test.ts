/**
 * Every tool fits the shape this host finds it by (D14; docs/tools/adding-a-tool.md): two packages,
 * `packages/tools/logic/<id>` (@workspace/tool-logic-<id>, main export src/index.ts) and `packages/tools/ui/<id>`
 * (@workspace/tool-ui-<id>, main export src/definition.ts, which exports `definition`), whose definition names the
 * folder's id, and whose sources import nothing of another tool, nothing of the extension, and no file outside their
 * own package. A tool that breaks it fails here — and would otherwise be missing from the host, or load another tool.
 */
import { TOOLS } from './registry';
import { describe, expect, it } from 'vitest';
import type { ToolDefinition } from '@workspace/tools-host';

interface Manifest {
  name?: string;
  private?: boolean;
  type?: string;
  sideEffects?: boolean;
  exports?: Record<string, string>;
  scripts?: Record<string, string>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

const ROOT = '../../../packages/tools/';
const manifests = import.meta.glob<Manifest>('../../../packages/tools/*/*/package.json', {
  eager: true,
  import: 'default',
});
const sources = import.meta.glob<string>(
  ['../../../packages/tools/*/*/src/**/*.{ts,tsx}', '../../../packages/tools/*/*/*.{ts,tsx}'],
  { eager: true, query: '?raw', import: 'default' },
);
const definitionModules = import.meta.glob<Record<string, unknown>>('../../../packages/tools/ui/*/src/definition.ts', {
  eager: true,
});

/** `logic/json/src/index.ts` → ['logic', 'json', 'src/index.ts']. */
const split = (path: string): [string, string, string] => {
  const [layer, id, ...rest] = path.slice(ROOT.length).split('/');
  return [layer!, id!, rest.join('/')];
};
const SHARED = new Set(['logic/shared', 'ui/host']);
const toolDirs = (layer: 'logic' | 'ui'): string[] =>
  [
    ...new Set(
      [...Object.keys(manifests), ...Object.keys(sources)]
        .map(split)
        .filter(([l, id]) => l === layer && !SHARED.has(`${l}/${id}`))
        .map(([, id]) => id),
    ),
  ].sort();
const LOGIC = toolDirs('logic');
const UI = toolDirs('ui');
const manifestOf = (layer: string, id: string): Manifest | undefined => manifests[`${ROOT}${layer}/${id}/package.json`];

/** Import specifiers of a source: `import … from 'x'`, `export … from 'x'`, `import('x')`, `import 'x'`. */
const importsOf = (source: string): string[] =>
  [
    ...source.matchAll(/^\s*(?:import|export)\s[^;]*?\sfrom\s+['"]([^'"]+)['"]/gms),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
    ...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g),
  ].map(m => m[1]!);
/** The package a bare specifier names: `@scope/name/sub` → `@scope/name`, `name/sub` → `name`. */
const packageOf = (specifier: string): string =>
  specifier
    .split('/')
    .slice(0, specifier.startsWith('@') ? 2 : 1)
    .join('/');
/** Does `../x` from `dir` (inside a package, as path segments) stay inside it? */
const staysInside = (dir: string[], specifier: string): boolean => {
  const at = [...dir];
  for (const part of specifier.split('/')) {
    if (part === '..') {
      if (at.length === 0) return false;
      at.pop();
    } else if (part !== '.') at.push(part);
  }
  return true;
};

describe('the tools’ packages', () => {
  it('come in pairs: a logic and a ui package for every id', () => {
    expect(UI.length).toBeGreaterThan(0);
    expect(UI).toEqual(LOGIC);
    for (const id of UI) expect(id).toMatch(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/);
  });

  it.each(LOGIC)('logic/%s: @workspace/tool-logic-<id>, pure, its main export src/index.ts', id => {
    const m = manifestOf('logic', id);
    expect(m, 'package.json').toBeDefined();
    expect(m).toMatchObject({ name: `@workspace/tool-logic-${id}`, private: true, type: 'module', sideEffects: false });
    expect(m!.exports).toEqual({ '.': './src/index.ts' });
    expect(Object.keys(m!.scripts ?? {})).toEqual(expect.arrayContaining(['test', 'type-check']));
    const runtime = Object.keys({ ...m!.dependencies, ...m!.peerDependencies });
    expect(runtime.filter(d => /^(react|react-dom)$|^@workspace\/(?!tools-shared$)|^@extension\//.test(d))).toEqual([]);
  });

  it.each(UI)('ui/%s: @workspace/tool-ui-<id>, its main export src/definition.ts, on its own logic', id => {
    const m = manifestOf('ui', id);
    expect(m, 'package.json').toBeDefined();
    expect(m).toMatchObject({ name: `@workspace/tool-ui-${id}`, private: true, type: 'module', sideEffects: false });
    expect(m!.exports).toEqual({ '.': './src/definition.ts' });
    expect(Object.keys(m!.scripts ?? {})).toEqual(expect.arrayContaining(['test', 'type-check']));
    expect(m!.dependencies).toMatchObject({
      [`@workspace/tool-logic-${id}`]: 'workspace:*',
      '@workspace/tools-host': 'workspace:*',
    });
    const all = Object.keys({ ...m!.dependencies, ...m!.peerDependencies, ...m!.devDependencies });
    expect(
      all.filter(d => /^@workspace\/tool-(logic|ui)-/.test(d) && d !== `@workspace/tool-logic-${id}`),
      'another tool',
    ).toEqual([]);
    expect(all.filter(d => d.startsWith('@extension/') && d !== '@extension/tsconfig')).toEqual([]);
  });
});

describe('the tools’ definitions', () => {
  it.each(UI)('ui/%s exports a definition of its own id, which the host lists', id => {
    const module = definitionModules[`${ROOT}ui/${id}/src/definition.ts`];
    expect(module, 'src/definition.ts').toBeDefined();
    const d = module!.definition as ToolDefinition | undefined;
    expect(d, 'export const definition').toBeDefined();
    expect(d!.id).toBe(id);
    expect(typeof d!.title === 'string' && d!.title.trim() !== '').toBe(true);
    expect(typeof d!.summary === 'string' && d!.summary.trim() !== '').toBe(true);
    expect(d!.keywords.length).toBeGreaterThan(0);
    expect(Number.isInteger(d!.order) && d!.order > 0).toBe(true);
    expect(typeof d!.load).toBe('function');
    if (d!.detect !== undefined) expect(typeof d!.detect).toBe('function');
    if (d!.history) {
      const kinds = d!.history.kinds.map(k => k.id);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(Number.isInteger(d!.history.schema) && d!.history.schema >= 1).toBe(true);
      expect(d!.history.records.trim()).not.toBe('');
      expect(d!.history.never.trim()).not.toBe('');
    }
    expect(TOOLS.map(t => t.id)).toContain(id);
  });

  it('have unique orders (the registry’s numbers in docs/tools/README.md)', () => {
    const orders = TOOLS.map(t => t.order);
    expect(new Set(orders).size).toBe(orders.length);
  });
});

describe('the tools’ sources', () => {
  const files = Object.entries(sources).filter(([path]) => {
    const [layer, id] = split(path);
    return !SHARED.has(`${layer}/${id}`);
  });

  it.each(files.map(([path]) => [path.slice(ROOT.length)]))(
    '%s imports only its own package, its declared dependencies and no other tool',
    rel => {
      const path = `${ROOT}${rel}`;
      const [layer, id, file] = split(path);
      const m = manifestOf(layer, id) ?? {};
      const declared = new Set(Object.keys({ ...m.dependencies, ...m.devDependencies, ...m.peerDependencies }));
      const test = /\.test\.tsx?$/.test(file) || file === 'vitest.config.ts';
      const problems = importsOf(sources[path]!).filter(specifier => {
        if (specifier.startsWith('.')) return !staysInside(file.split('/').slice(0, -1), specifier);
        if (specifier.startsWith('node:')) return !test;
        if (/^@workspace\/tool-(logic|ui)-/.test(specifier))
          return packageOf(specifier) !== `@workspace/tool-logic-${id}`;
        if (/^@(extension|src)\//.test(specifier)) return true;
        return !declared.has(packageOf(specifier));
      });
      expect(problems).toEqual([]);
    },
  );
});
