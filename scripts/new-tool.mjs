#!/usr/bin/env node
// Starts a tool (D14; docs/tools/adding-a-tool.md): the two packages from one template, so every tool begins from the
// same files — the reference is the JSON tool (packages/tools/logic/json, packages/tools/ui/json).
//
//   node scripts/new-tool.mjs <id> --order=<n> [--title="UUID / ULID"] [--summary="…"] [--keywords=a,b,c] [--no-install]
//
//   <id>        the tool's id: the file name of its specification, docs/tools/specs/<id>.md (lowercase, hyphens)
//   --order     its number in the registry table of docs/tools/README.md (JSON 1, Base64 2, URL 3, …): where it stands
//               in the host's lists and in which order pasted text is offered to `detect`
//   --title, --summary, --keywords   the specification's header: «Название в интерфейсе», «Строка под названием»,
//               «Ключевые слова» (otherwise TODO, to be filled in by hand)
//   --no-install  do not run `pnpm install` (it links the two packages into the workspace and adds them to the lockfile)
//
// Creates (and touches no existing file):
//   packages/tools/logic/<id>/   package.json, tsconfig.json, src/index.ts, src/logic.ts, src/logic.test.ts (fails on
//                                purpose until the specification's §10 is written into it)
//   packages/tools/ui/<id>/      package.json, tsconfig.json, vitest.config.ts, src/definition.ts, src/history.ts,
//                                src/<Name>Tool.tsx, src/<Name>Tool.test.tsx
//   scripts/e2e-tools/<id>.mjs   the tool's e2e module (fails on purpose until written)
// The host finds the tool by itself (extension/src/tools/registry.ts); nothing else is edited. The script never reads
// docs/ — the documents are a repository of their own.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const flag = name => {
  const found = args.find(a => a.startsWith(`--${name}=`));
  return found === undefined ? undefined : found.slice(name.length + 3);
};
const id = args.find(a => !a.startsWith('--'));
const fail = message => {
  console.error(`new-tool: ${message}`);
  console.error(
    'usage: node scripts/new-tool.mjs <id> --order=<n> [--title=…] [--summary=…] [--keywords=a,b] [--no-install]',
  );
  process.exit(1);
};

if (!id) fail('the tool id is missing');
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(id))
  fail(`"${id}" is not an id: lowercase letters and digits, hyphens between`);
if (['shared', 'host'].includes(id)) fail(`"${id}" is the name of a shared package`);
const order = Number(flag('order'));
if (!Number.isInteger(order) || order < 1) fail('--order=<n> is required: the tool’s number in docs/tools/README.md');

const logicDir = join(ROOT, 'packages/tools/logic', id);
const uiDir = join(ROOT, 'packages/tools/ui', id);
const e2eFile = join(ROOT, 'scripts/e2e-tools', `${id}.mjs`);
for (const path of [logicDir, uiDir, e2eFile]) if (existsSync(path)) fail(`${relative(ROOT, path)} exists already`);

const words = id.split('-');
const Name = words.map(w => w[0].toUpperCase() + w.slice(1)).join('');
const name = Name[0].toLowerCase() + Name.slice(1);
const title = flag('title') ?? `TODO ${Name}`;
const summary = flag('summary') ?? 'TODO: the specification’s line under the title.';
const keywords = (flag('keywords') ?? id)
  .split(',')
  .map(k => k.trim())
  .filter(Boolean);
const str = value => `'${value.replaceAll('\\', '\\\\').replaceAll("'", "\\'")}'`;
const json = value => `${JSON.stringify(value, null, 2)}\n`;

const DEV = {
  '@extension/tsconfig': 'workspace:*',
  typescript: '^5.9.3',
  vitest: '^4.1.10',
};

const files = {
  // ---- logic ----
  [join(logicDir, 'package.json')]: json({
    name: `@workspace/tool-logic-${id}`,
    version: '0.1.0',
    description: `The ${title} tool's logic (D14, docs/tools/specs/${id}.md). Pure TypeScript: no React, no DOM, no chrome.`,
    private: true,
    type: 'module',
    exports: { '.': './src/index.ts' },
    sideEffects: false,
    scripts: { 'type-check': 'tsc --noEmit', test: 'vitest run', 'clean:turbo': 'rm -rf .turbo' },
    dependencies: { '@workspace/tools-shared': 'workspace:*' },
    devDependencies: {
      '@extension/tsconfig': DEV['@extension/tsconfig'],
      '@types/node': '^22.20.1',
      typescript: DEV.typescript,
      vitest: DEV.vitest,
    },
  }),
  [join(logicDir, 'tsconfig.json')]: `{
  "extends": "@extension/tsconfig/app",
  "compilerOptions": {
    // A tool's logic: no DOM (D14) — the DOM library is left out, so \`document\` or \`window\` does not compile. Node's
    // types bring what the logic may use in a page and in Node alike: TextEncoder, URL, crypto, Blob.
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["src"]
}
`,
  [join(logicDir, 'src/index.ts')]:
    `/** @workspace/tool-logic-${id} — the ${title} tool's logic, everything its component and its definition use. */
export * from './logic';
`,
  [join(logicDir, 'src/logic.ts')]: `/**
 * The ${title} tool's logic: the functions of docs/tools/specs/${id}.md §9, with their signatures. Pure: no React, no
 * DOM, no chrome. Shared pure code comes from @workspace/tools-shared (random, hex, base64, time); a tool never imports
 * another tool. \`detect${Name}\` runs on every paste into the start page's field: cheap and strict (§7).
 */

/** Does pasted text look like this tool's input (§7)? */
export const detect${Name}: (text: string) => boolean = () => false;
`,
  [join(logicDir, 'src/logic.test.ts')]: `import { detect${Name} } from './logic';
import { describe, expect, it } from 'vitest';

// Every row of docs/tools/specs/${id}.md §10 becomes a test here, each with the specification's expected value.
describe('${id}', () => {
  it('implements docs/tools/specs/${id}.md §10', () => {
    expect(detect${Name}('')).toBe(false);
    expect.fail('Write the tests of the specification’s §10 here, then the logic that passes them.');
  });
});
`,
  // ---- ui ----
  [join(uiDir, 'package.json')]: json({
    name: `@workspace/tool-ui-${id}`,
    version: '0.1.0',
    description: `The ${title} tool's component and definition (D14, docs/tools/specs/${id}.md): the definition is the main export, the component loads when the tool is opened.`,
    private: true,
    type: 'module',
    exports: { '.': './src/definition.ts' },
    sideEffects: false,
    scripts: { 'type-check': 'tsc --noEmit', test: 'vitest run', 'clean:turbo': 'rm -rf .turbo' },
    dependencies: {
      [`@workspace/tool-logic-${id}`]: 'workspace:*',
      '@workspace/tools-host': 'workspace:*',
      '@workspace/ui': 'workspace:*',
    },
    peerDependencies: { react: '^19.2.8' },
    devDependencies: {
      '@extension/tsconfig': DEV['@extension/tsconfig'],
      '@testing-library/react': '^16.3.2',
      '@types/react': '^19.2.18',
      '@types/react-dom': '^19.2.4',
      jsdom: '^25.0.1',
      react: '^19.2.8',
      'react-dom': '^19.2.8',
      typescript: DEV.typescript,
      vitest: DEV.vitest,
    },
  }),
  [join(uiDir, 'tsconfig.json')]: `{
  "extends": "@extension/tsconfig/app",
  "compilerOptions": {
    // A tool's component: no \`chrome\` types — a tool never touches the extension's APIs (D14).
    "types": []
  },
  "include": ["src", "vitest.config.ts"]
}
`,
  [join(uiDir, 'vitest.config.ts')]: `import { defineConfig } from 'vitest/config';

// The component's tests: jsdom with what it lacks (@workspace/ui/testing), React once.
export default defineConfig({
  esbuild: { jsx: 'automatic' },
  resolve: { dedupe: ['react', 'react-dom'] },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['@workspace/ui/testing'],
  },
});
`,
  [join(uiDir, 'src/definition.ts')]: `/**
 * The ${title} tool as a host lists it (docs/tools/specs/${id}.md): the description, its history declaration and its
 * component, loaded only when the tool is opened. This module is part of every host page that lists the tools, so it
 * imports only the light \`detect\` and the declaration — never the component or a library.
 */
import { ${name}History } from './history';
import { detect${Name} } from '@workspace/tool-logic-${id}';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: '${id}',
  title: ${str(title)},
  summary: ${str(summary)},
  keywords: [${keywords.map(str).join(', ')}],
  order: ${order},
  detect: detect${Name},
  history: ${name}History,
  load: () => import('./${Name}Tool'),
};
`,
  [join(uiDir, 'src/history.ts')]: `/**
 * What the tool history keeps of the ${title} tool (D17): the row of docs/tools/history.md §10 for \`${id}\`, as kinds of
 * records. A kind that carries a secret (a password, a key, a token) is \`secret: true\`: the history writes it only
 * encrypted, with a master password and the history unlocked. No kinds: the tool keeps nothing.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const ${name}History: HistoryDeclaration = {
  kinds: [],
  schema: 1,
  records: 'TODO: what is kept, in a sentence for Settings → History.',
  never: 'TODO: what is never kept, in a sentence for Settings → History.',
};
`,
  [join(uiDir, `src/${Name}Tool.tsx`)]: `/**
 * The ${title} tool's page (docs/tools/specs/${id}.md §8). The host wraps it in the kit's ToolPage (title, summary,
 * the history line); this is the body, built from the kit's tool parts. Logic: @workspace/tool-logic-${id}. History:
 * through the host (\`useToolHistory\`) — \`recorder.change(draft)\` on a person's edit, \`recorder.commit(draft)\` on an
 * explicit action; \`useRestore\` opens an entry the host asks for.
 */
import { ${name}History } from './history';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useState } from 'react';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const ${Name}Tool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const { history } = useToolHistory(host, '${id}', ${name}History);
  useRestore(history, restore, () => undefined);

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions />
      <ToolPanes>
        <ToolPane label="Input" htmlFor="${id}-input">
          <Textarea
            id="${id}-input"
            className="h-90 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            value={input}
            onChange={e => setInput(e.target.value)}
          />
          <ToolMessage />
        </ToolPane>
        <ToolPane label="Result" />
      </ToolPanes>
    </div>
  );
};

export default ${Name}Tool;
`,
  [join(uiDir, `src/${Name}Tool.test.tsx`)]: `import { definition } from './definition';
import ${Name}Tool from './${Name}Tool';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(cleanup);

describe('the ${title} tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition.id).toBe('${id}');
    expect((await definition.load()).default).toBe(${Name}Tool);
  });

  it('renders with no host at all', () => {
    render(<${Name}Tool />);
    expect(screen.getByLabelText('Input')).toBeTruthy();
  });

  // The specification's §2 scenarios and §8 as tests: what a person does and sees, the copy buttons, the errors
  // next to their field, what is recorded (change / commit) and what an entry opened from History brings back.
  it.todo('docs/tools/specs/${id}.md §2 and §8');
});
`,
  // ---- e2e ----
  [e2eFile]: `// The ${title} tool in the built extension (docs/tools/specs/${id}.md): its scenarios (§2) the way a person does
// them — the page's real controls, the real clipboard — run by scripts/e2e-tools.mjs. Name each check '${title}: …'.

export default async ({ page, base, check }) => {
  await page.goto(\`\${base}#/tools/${id}\`);
  await page.getByLabel('Input').waitFor();
  check('${title}: e2e checks written (scripts/e2e-tools/${id}.mjs)', false, 'replace this with the §2 scenarios');
};
`,
};

for (const [path, content] of Object.entries(files)) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content);
  console.log(`created ${relative(ROOT, path)}`);
}

if (!args.includes('--no-install')) {
  // Links the packages into the workspace; everything they need is in the store already (offline first).
  try {
    execFileSync('pnpm', ['install', '--offline'], { cwd: ROOT, stdio: 'inherit' });
  } catch {
    execFileSync('pnpm', ['install'], { cwd: ROOT, stdio: 'inherit' });
  }
}

console.log(`
${id}: two packages and an e2e module. Next (docs/tools/adding-a-tool.md):
  1. the specification's §10 → packages/tools/logic/${id}/src/logic.test.ts, then the logic (§9) in src/logic.ts;
  2. the component (§8) in packages/tools/ui/${id}/src/${Name}Tool.tsx, its tests, the history declaration (src/history.ts);
  3. its e2e module, scripts/e2e-tools/${id}.mjs;
  4. pnpm --filter @workspace/tool-logic-${id} test, pnpm --filter @workspace/tool-ui-${id} test, then pnpm check and pnpm test:e2e.`);
