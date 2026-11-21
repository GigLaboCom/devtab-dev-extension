/**
 * Every tool fits the shape this host finds it by (D14; docs/tools/adding-a-tool.md): two packages,
 * `packages/tools/logic/<id>` (@workspace/tool-logic-<id>, main export src/index.ts) and `packages/tools/ui/<id>`
 * (@workspace/tool-ui-<id>, main export src/definition.ts, which exports `definition`), whose definition names the
 * folder's id and states its `output`, and whose sources import nothing of another tool, nothing of the extension, and no
 * file outside their own package. A tool that breaks it fails here — and would otherwise be missing from the host, or
 * load another tool.
 *
 * And the shape that keeps the start page's first load independent of the number of tools (D16,
 * docs/research/start-route-budget.md): the definition is data — at run time it imports its history declaration and
 * nothing else, so the build can read it for the catalogue (build/toolCatalogue.ts); the history declaration imports
 * nothing at run time and exports the declaration alone (labels and guards live elsewhere); recognising pasted text is
 * `src/detect.ts`, the package's `./detect` export, a module of its own that the host loads lazily (detectors.ts) and
 * that imports only the tool's own logic.
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
const detectModules = import.meta.glob<Record<string, unknown>>('../../../packages/tools/ui/*/src/detect.ts', {
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
/** Import specifiers a module evaluates: everything but `import type` and `export type … from`. */
const runtimeImportsOf = (source: string): string[] =>
  [
    ...source.matchAll(/^\s*(?:import|export)\s+(?!type\b)[^;]*?\sfrom\s+['"]([^'"]+)['"]/gms),
    ...source.matchAll(/^\s*import\s+['"]([^'"]+)['"]/gm),
  ].map(m => m[1]!);
/** Names a module exports as values: `export const|let|function|class <name>`, `export { … }` (not `export type`). */
const valueExportsOf = (source: string): string[] => [
  ...[...source.matchAll(/^export\s+(?:const|let|var|function\*?|async\s+function|class)\s+([A-Za-z_$][\w$]*)/gm)].map(
    m => m[1]!,
  ),
  ...[...source.matchAll(/^export\s+\{([^}]*)\}/gm)].flatMap(m =>
    m[1]!
      .split(',')
      .map(n =>
        n
          .trim()
          .split(/\s+as\s+/)
          .at(-1)!,
      )
      .filter(n => n && !n.startsWith('type ')),
  ),
];
const sourceOf = (layer: string, id: string, file: string): string | undefined =>
  sources[`${ROOT}${layer}/${id}/${file}`];

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
    // `./detect` exactly when the tool recognises pasted text (src/detect.ts).
    expect(m!.exports).toEqual({
      '.': './src/definition.ts',
      ...(sourceOf('ui', id, 'src/detect.ts') !== undefined ? { './detect': './src/detect.ts' } : {}),
    });
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
    // `detect` is a module of its own (below), never a member of the definition.
    expect(d, 'no `detect` in the definition: src/detect.ts').not.toHaveProperty('detect');
    // What its result is (docs/tools/copying.md): made on request — with what one generation copies — or derived from
    // the person's input. Every tool states it; automatic copying is offered by it.
    expect(['generated', 'input'], 'output.origin').toContain(d!.output?.origin);
    if (d!.output.origin === 'generated') expect(['lines', 'text'], 'output.copies').toContain(d!.output.copies);
    else expect(Object.keys(d!.output)).toEqual(['origin']);
    if (d!.history) {
      const kinds = d!.history.kinds.map(k => k.id);
      expect(new Set(kinds).size).toBe(kinds.length);
      expect(Number.isInteger(d!.history.schema) && d!.history.schema >= 1).toBe(true);
      expect(d!.history.records.trim()).not.toBe('');
      expect(d!.history.never.trim()).not.toBe('');
    }
    expect(TOOLS.map(t => t.id)).toContain(id);
  });

  it.each(UI)('ui/%s: the definition is data — at run time it imports its history declaration, nothing else', id => {
    const source = sourceOf('ui', id, 'src/definition.ts') ?? '';
    expect(runtimeImportsOf(source).filter(s => s !== './history')).toEqual([]);
    // The component, the one lazy import: `load: () => import('./<Name>Tool')` — inside the package.
    const lazy = [...source.matchAll(/\bimport\(\s*['"]([^'"]+)['"]\s*\)/g)].map(m => m[1]!);
    expect(lazy.filter(s => !s.startsWith('./'))).toEqual([]);
  });

  it.each(UI.filter(id => sourceOf('ui', id, 'src/history.ts') !== undefined))(
    'ui/%s: the history declaration imports nothing at run time and exports the declaration alone',
    id => {
      const source = sourceOf('ui', id, 'src/history.ts')!;
      expect(runtimeImportsOf(source)).toEqual([]);
      const values = valueExportsOf(source);
      expect(values, 'move labels, guards and helpers to another module (entries.ts)').toHaveLength(1);
      const d = definitionModules[`${ROOT}ui/${id}/src/definition.ts`]?.definition as ToolDefinition | undefined;
      expect(d?.history, 'the definition’s `history` is this declaration').toBeDefined();
    },
  );

  it.each(UI.filter(id => sourceOf('ui', id, 'src/detect.ts') !== undefined))(
    'ui/%s: src/detect.ts exports `detect` and imports only the tool’s own logic',
    id => {
      const module = detectModules[`${ROOT}ui/${id}/src/detect.ts`];
      expect(typeof module?.detect).toBe('function');
      const source = sourceOf('ui', id, 'src/detect.ts')!;
      expect(
        runtimeImportsOf(source).filter(s => !s.startsWith('.') && packageOf(s) !== `@workspace/tool-logic-${id}`),
      ).toEqual([]);
      expect(valueExportsOf(source)).toEqual(['detect']);
    },
  );

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
