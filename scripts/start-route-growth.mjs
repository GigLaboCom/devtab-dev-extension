#!/usr/bin/env node
// What a tool adds to the start route (D16, docs/research/start-route-budget.md): the start page's first load must not
// grow with the number of tools beyond the tools' catalogue entries (extension/build/toolCatalogue.ts) — no tool's
// definition, history declaration, `detect`, component loader, preload entry or stylesheet rule. Proven here, not
// estimated: the extension is built twice into temporary directories — as it is, and with SYNTHETIC tool packages
// added under packages/tools/ui/ (each of the real shape: a definition with a history declaration and a component, a
// `detect` module, Tailwind classes no other file uses) — and the two start routes, as Check 15 of validate-build.sh
// counts them, are compared:
//
//   - with the catalogue's array taken out of the first chunk, chunk hashes and the minifier's names evened out, every
//     start-route file is the same in both builds: what the tools added is the catalogue and nothing else (the minifier
//     names variables by how often letters occur in its output, so more catalogue text can rename them — the renaming
//     may change the bytes by RENAME_SLACK at most, and it is reported);
//   - the growth per tool is at most PER_TOOL_LIMIT bytes;
//   - the default start route with as many tools as are specified (TOOLS_SPECIFIED) stays within Check 15's budget.
//
// It prints the start route now, its catalogue's bytes per real tool, the growth per synthetic tool and the projection.
// The synthetic packages are removed again, also when the build fails; a leftover `zz-growth-*` folder from a killed
// run is removed at the start. Nothing else is written outside the temporary directories.
//
// Usage: node scripts/start-route-growth.mjs [--tools=<n>] [--json] [--keep]
//   --keep  leave the two builds in their temporary directory (it is printed) to compare them
import { bytesOf, buildExtension, ROOT, startFiles } from './start-route.mjs';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

/** What a synthetic tool may add to the start route, at most, in bytes: its catalogue entry. */
const PER_TOOL_LIMIT = 200;
/** Check 15's budget (scripts/validate-build.sh) — not raised here. */
const START_ROUTE_BUDGET = 512000;
/** What renaming by the minifier may add or take beyond the catalogue's bytes, all files together. */
const RENAME_SLACK = 64;
/** The tools docs/tools/README.md specified when this check was written; the projection reaches at least that many. */
const TOOLS_SPECIFIED = 34;
/** Synthetic tools added even when every specified tool is built: with none the check would measure nothing. */
const MIN_SYNTHETIC = 8;

const args = process.argv.slice(2);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const UI = join(ROOT, 'packages/tools/ui');
const PREFIX = 'zz-growth-';

const realTools = () =>
  readdirSync(UI, { withFileTypes: true })
    .filter(e => e.isDirectory() && existsSync(join(UI, e.name, 'src/definition.ts')) && !e.name.startsWith(PREFIX))
    .map(e => e.name);

const removeSynthetic = () => {
  for (const name of readdirSync(UI))
    if (name.startsWith(PREFIX)) rmSync(join(UI, name), { recursive: true, force: true });
};

/** One synthetic tool of the real shape; `n` makes its texts and classes its own. */
const writeSynthetic = n => {
  const id = `${PREFIX}${String(n).padStart(2, '0')}`;
  const dir = join(UI, id, 'src');
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(UI, id, 'package.json'),
    `${JSON.stringify(
      {
        name: `@workspace/tool-ui-${id}`,
        private: true,
        type: 'module',
        exports: { '.': './src/definition.ts', './detect': './src/detect.ts' },
        sideEffects: false,
      },
      null,
      2,
    )}\n`,
  );
  // As long as a real tool's: a title of two words, a summary, nine keywords.
  writeFileSync(
    join(dir, 'definition.ts'),
    `import { growthHistory } from './history';
import type { ToolDefinition } from '@workspace/tools-host';

export const definition: ToolDefinition = {
  id: '${id}',
  title: 'Growth Tool ${n}',
  summary: 'A synthetic tool of the start route growth check, number ${n}: it is built and removed again.',
  keywords: ['growth${n}', 'synthetic', 'check', 'budget', 'catalogue', 'convert', 'decode', 'encode', 'format'],
  order: ${1000 + n},
  history: growthHistory,
  output: { origin: 'input' },
  load: () => import('./GrowthTool'),
};
`,
  );
  writeFileSync(
    join(dir, 'history.ts'),
    `import type { HistoryDeclaration } from '@workspace/tools-host';

export const growthHistory: HistoryDeclaration = {
  kinds: [{ id: 'edit', title: 'Edit' }],
  schema: 1,
  records: 'What you typed into synthetic tool ${n}, as edit snapshots.',
  never: 'Nothing else: synthetic tool ${n} exists only during the growth check.',
};
`,
  );
  writeFileSync(
    join(dir, 'detect.ts'),
    `export const detect = (text: string): boolean => /^growth-${n}:[a-z0-9]{8,}$/.test(text.trim());\n`,
  );
  // A component with classes no other file has: if the tools' classes reached the start page's stylesheet, it grows.
  writeFileSync(
    join(dir, 'GrowthTool.tsx'),
    `export default function GrowthTool() {
  return <div className="mt-${(n % 9) + 1} grid-cols-${(n % 11) + 1} gap-${(n % 7) + 3}">Growth tool ${n}</div>;
}
`,
  );
};

/** The catalogue's array in the first chunk: from `[{id:"<first id>"` to its closing bracket. */
const catalogueIn = (text, firstId) => {
  const start = text.search(new RegExp(`\\[\\{id:\\s*["']${firstId}["']`));
  if (start < 0) return null;
  let depth = 0;
  let quote = null;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
    } else if (c === '"' || c === "'" || c === '`') quote = c;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return { start, end: i + 1 };
  }
  return null;
};

/** A start route's files with the catalogue cut out and every chunk hash evened out, by name. */
const normalised = (dir, firstId) => {
  const out = new Map();
  let catalogue = 0;
  for (const file of startFiles(dir)) {
    let text = readFileSync(file, 'utf8');
    const found = file.endsWith('.js') ? catalogueIn(text, firstId) : null;
    if (found) {
      catalogue = Buffer.byteLength(text.slice(found.start, found.end));
      text = text.slice(0, found.start) + text.slice(found.end);
    }
    out.set(
      basename(file).replace(/-[\w-]{8}\.(js|css)$/, '.$1'),
      text.replace(/-[\w-]{8}\.(js|css)\b/g, '-HASH.$1').replace(/[A-Za-z_$][\w$]*/g, 'I'),
    );
  }
  return { files: out, catalogue };
};

const measure = (dir, firstId) => {
  const files = startFiles(dir);
  return { bytes: bytesOf(files), ...normalised(dir, firstId) };
};

const count = Number(option('tools') ?? Math.max(MIN_SYNTHETIC, TOOLS_SPECIFIED - realTools().length));
const work = mkdtempSync(join(tmpdir(), 'start-route-growth-'));
removeSynthetic();
const real = realTools();
let result;
try {
  await buildExtension(join(work, 'now'));
  // The first entry of the catalogue — the real tool first in order — marks where the array starts.
  const catalogueText = readFileSync(
    startFiles(join(work, 'now')).find(f => /\/app-[\w-]+\.js$/.test(f)),
    'utf8',
  );
  const first = /\[\{id:\s*["']([a-z0-9-]+)["'],title:/.exec(catalogueText)?.[1];
  if (!first) throw new Error('the catalogue was not found in the first chunk');
  const now = measure(join(work, 'now'), first);

  for (let n = 1; n <= count; n++) writeSynthetic(n);
  await buildExtension(join(work, 'more'));
  const more = measure(join(work, 'more'), first);

  const differing = [...new Set([...now.files.keys(), ...more.files.keys()])].filter(
    name => now.files.get(name) !== more.files.get(name),
  );
  const perTool = (more.bytes - now.bytes) / count;
  const perRealTool = now.catalogue / real.length;
  const projected = Math.round(now.bytes + count * Math.max(perTool, perRealTool));
  result = {
    tools: real.length,
    startRoute: now.bytes,
    catalogue: { bytes: now.catalogue, perTool: Math.round(perRealTool) },
    synthetic: { count, startRoute: more.bytes, catalogue: more.catalogue, perTool: Math.round(perTool) },
    projected: { tools: real.length + count, startRoute: projected, budget: START_ROUTE_BUDGET },
    differing,
    beyondCatalogue: more.bytes - now.bytes - (more.catalogue - now.catalogue),
  };
} finally {
  removeSynthetic();
  if (args.includes('--keep')) console.log(`the two builds: ${work}`);
  else rmSync(work, { recursive: true, force: true });
}

const failures = [
  ...(result.differing.length ? [`start-route files differ beyond the catalogue: ${result.differing.join(', ')}`] : []),
  ...(result.synthetic.perTool > PER_TOOL_LIMIT
    ? [`a tool adds ${result.synthetic.perTool} bytes to the start route (limit ${PER_TOOL_LIMIT})`]
    : []),
  ...(Math.abs(result.beyondCatalogue) > RENAME_SLACK
    ? [
        `the start route grew by ${result.synthetic.startRoute - result.startRoute} bytes, the catalogue by ${result.synthetic.catalogue - result.catalogue.bytes}`,
      ]
    : []),
  ...(result.projected.startRoute > START_ROUTE_BUDGET
    ? [`with ${result.projected.tools} tools the start route would load ${result.projected.startRoute} bytes`]
    : []),
];

if (args.includes('--json')) process.stdout.write(`${JSON.stringify({ ...result, failures }, null, 2)}\n`);
else {
  const n = v => v.toLocaleString('en-US');
  console.log(`Start route with the ${result.tools} tools: ${n(result.startRoute)} bytes`);
  console.log(`  their catalogue: ${n(result.catalogue.bytes)} bytes, ${result.catalogue.perTool} per tool`);
  console.log(
    `With ${result.synthetic.count} synthetic tools more: ${n(result.synthetic.startRoute)} bytes (+${n(result.synthetic.startRoute - result.startRoute)}, ${result.synthetic.perTool} per tool; limit ${PER_TOOL_LIMIT})`,
  );
  console.log(
    `  every start-route file the same beyond the catalogue: ${result.differing.length ? `no — ${result.differing.join(', ')}` : 'yes'}; the catalogue grew by ${n(result.synthetic.catalogue - result.catalogue.bytes)}, the rest by ${result.beyondCatalogue} bytes (renaming by the minifier may move ±${RENAME_SLACK})`,
  );
  console.log(
    `Projected with ${result.projected.tools} tools: ${n(result.projected.startRoute)} bytes (budget ${n(START_ROUTE_BUDGET)})`,
  );
}
if (failures.length) {
  for (const f of failures) console.error(`✗ ${f}`);
  process.exit(1);
}
console.log('✓ the start route grows by the tools’ catalogue entries only');
