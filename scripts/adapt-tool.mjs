#!/usr/bin/env node
// Adapts a tool package written in the previous shape to the one the start page's catalogue and the lazy `detect` need
// (D16, docs/tools/adding-a-tool.md §4; extension/src/tools/shape.test.ts holds it):
//
//   1. `detect` leaves the definition: `detect: detectX,` and its import go; src/detect.ts re-exports it as `detect`
//      from where it came (the tool's logic package, or a module of the ui package), and package.json gets the
//      `./detect` export. A tool without `detect` is left as it is.
//   2. The definition imports nothing at run time but './history' (type imports stay). Any other import is reported:
//      it has to go by hand (a constant the definition needs is written into it).
//   3. src/history.ts keeps the declaration alone: every other value it exports (labels, guards, helpers) and the
//      helpers they use move to src/entries.ts (created, or appended to), and the tool's sources that imported them from
//      './history' import them from './entries'. Its types stay.
//   4. Tests that called `definition.detect(…)` call `detect(…)` from './detect'.
//
// Then it runs the tool package's type-check and tests and the shape test, and says what is left, if anything.
//
// Usage: node scripts/adapt-tool.mjs <id> [--dry-run] [--no-check]
//   --dry-run   print what would change, write nothing
//   --no-check  skip the type-check and tests at the end
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const id = args.find(a => !a.startsWith('--'));
const dry = args.includes('--dry-run');
if (!id) {
  console.error('usage: node scripts/adapt-tool.mjs <id> [--dry-run] [--no-check]');
  process.exit(1);
}
const ui = join(ROOT, 'packages/tools/ui', id);
const src = join(ui, 'src');
if (!existsSync(join(src, 'definition.ts'))) {
  console.error(`adapt-tool: ${relative(ROOT, src)}/definition.ts not found`);
  process.exit(1);
}

const changed = new Map();
const left = [];
const read = file => changed.get(file) ?? (existsSync(file) ? readFileSync(file, 'utf8') : null);
const write = (file, text) => changed.set(file, text);

/** `import { a, b as c } from 'x';` statements (not `import type`), with the names they bind. */
const valueImports = source =>
  [...source.matchAll(/^import\s+(?!type\b)\{([^}]*)\}\s+from\s+['"]([^'"]+)['"];?\n/gm)].map(m => ({
    text: m[0],
    from: m[2],
    names: m[1]
      .split(',')
      .map(n => n.trim())
      .filter(n => n && !n.startsWith('type '))
      .map(n => {
        const [orig, local] = n.split(/\s+as\s+/);
        return { orig, local: local ?? orig };
      }),
  }));

// 1–2. The definition.
const definitionFile = join(src, 'definition.ts');
let definition = read(definitionFile);
const detectField = /^\s*detect:\s*([A-Za-z_$][\w$]*)\s*,\s*\n/m.exec(definition);
if (detectField) {
  const local = detectField[1];
  const from = valueImports(definition).find(i => i.names.some(n => n.local === local));
  if (!from) {
    left.push(`definition.ts: \`detect: ${local}\` is not imported by name — move it to src/detect.ts by hand`);
  } else {
    const orig = from.names.find(n => n.local === local).orig;
    definition = definition.replace(detectField[0], '');
    const rest = from.names.filter(n => n.local !== local);
    definition = definition.replace(
      from.text,
      rest.length
        ? `import { ${rest.map(n => (n.orig === n.local ? n.orig : `${n.orig} as ${n.local}`)).join(', ')} } from '${from.from}';\n`
        : '',
    );
    const detectFile = join(src, 'detect.ts');
    if (read(detectFile) === null)
      write(
        detectFile,
        `/**
 * Does pasted text look like this tool's input (its specification's §7)? The package's \`./detect\` export, a module of
 * its own: a host loads it only when pasted text needs it, never with the list of tools.
 */
export { ${orig === 'detect' ? 'detect' : `${orig} as detect`} } from '${from.from}';
`,
      );
    else left.push('src/detect.ts exists already: check that it exports `detect`');
    const pkgFile = join(ui, 'package.json');
    const pkg = JSON.parse(read(pkgFile));
    if (!pkg.exports?.['./detect']) {
      pkg.exports = { ...(pkg.exports ?? { '.': './src/definition.ts' }), './detect': './src/detect.ts' };
      write(pkgFile, `${JSON.stringify(pkg, null, 2)}\n`);
    }
  }
}
// The old comment said the module imports "the light `detect`"; say what it is now.
definition = definition.replace(
  /This module is part of every host page that lists the tools, so it\s*\n\s*\*\s*imports only the light `detect` and the declaration(?: — never the component or a library)?\./,
  'Data only: it imports its history declaration and nothing else at\n * run time — a host reads it at build time and lists the tool without its code.',
);
write(definitionFile, definition);
for (const i of valueImports(definition).filter(i => i.from !== './history'))
  left.push(
    `definition.ts imports ${i.names.map(n => n.orig).join(', ')} from '${i.from}' at run time — only './history' may stay`,
  );

// 3. The history declaration alone.
const historyFile = join(src, 'history.ts');
const history = read(historyFile);
if (history !== null) {
  // Top-level statements, each with the comment before it.
  const statements = [];
  let i = 0;
  let start = 0;
  let depth = 0;
  let quote = null;
  for (; i < history.length; i++) {
    const c = history[i];
    if (quote) {
      if (c === '\\') i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (history.startsWith('//', i)) {
      i = history.indexOf('\n', i);
      if (i < 0) break;
      continue;
    }
    if (history.startsWith('/*', i)) {
      i = history.indexOf('*/', i) + 1;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') quote = c;
    else if ('{(['.includes(c)) depth++;
    else if ('})]'.includes(c)) depth--;
    if (depth === 0 && (c === ';' || (c === '}' && /^\s*\n\s*\n/.test(history.slice(i + 1))))) {
      statements.push(history.slice(start, i + 1));
      start = i + 1;
    }
  }
  if (history.slice(start).trim()) statements.push(history.slice(start));
  const bare = s =>
    s
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '')
      .trim();
  const declaration = statements.findIndex(s => /^export\s+const\s+\w+\s*:\s*HistoryDeclaration\b/.test(bare(s)));
  const isType = s => /^(export\s+)?(type|interface)\b/.test(bare(s)) || /^import\b/.test(bare(s));
  const moving = statements.filter((s, k) => k !== declaration && !isType(s) && bare(s));
  if (declaration < 0) left.push('history.ts: no `export const …: HistoryDeclaration` found');
  if (moving.length) {
    const kept = statements.filter(s => !moving.includes(s));
    const movedNames = moving
      .map(s => /^export\s+(?:const|let|function\*?|async\s+function|class)\s+([A-Za-z_$][\w$]*)/.exec(bare(s))?.[1])
      .filter(Boolean);
    const historyTypes = statements
      .map(s => /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/.exec(bare(s))?.[1])
      .filter(Boolean);
    const imports = statements.filter(s => /^import\b/.test(bare(s))).map(s => s.trim());
    const entriesFile = join(src, 'entries.ts');
    const body = moving.map(s => s.replace(/^\n+/, '')).join('\n\n');
    const used = name => new RegExp(`\\b${name}\\b`).test(body);
    const header = [
      ...imports.filter(line => {
        const names =
          /\{([^}]*)\}/
            .exec(line)?.[1]
            .split(',')
            .map(n =>
              n
                .trim()
                .split(/\s+as\s+/)
                .at(-1),
            ) ?? [];
        return names.some(used);
      }),
      ...(historyTypes.filter(used).length
        ? [`import type { ${historyTypes.filter(used).join(', ')} } from './history';`]
        : []),
    ];
    const existing = read(entriesFile);
    write(
      entriesFile,
      existing
        ? `${existing.trimEnd()}\n\n${body.trim()}\n`
        : `/** This tool's history entries as its component writes and reads them: labels, guards, helpers (moved out of
 * history.ts, which keeps the declaration alone — the definition imports it). */
${header.join('\n')}\n\n${body.trim()}\n`,
    );
    if (existing && header.length) left.push(`src/entries.ts existed: check its imports (${header.join(' ')})`);
    write(historyFile, `${kept.join('').trimEnd()}\n`);
    // Sources that imported the moved names from './history'.
    for (const name of readdirSync(src).filter(f => /\.tsx?$/.test(f) && !['history.ts', 'entries.ts'].includes(f))) {
      const file = join(src, name);
      let text = read(file);
      for (const imp of valueImports(text).filter(i => i.from === './history')) {
        const moved = imp.names.filter(n => movedNames.includes(n.orig));
        if (!moved.length) continue;
        const stay = imp.names.filter(n => !movedNames.includes(n.orig));
        const fmt = list => list.map(n => (n.orig === n.local ? n.orig : `${n.orig} as ${n.local}`)).join(', ');
        text = text.replace(
          imp.text,
          `import { ${fmt(moved)} } from './entries';\n${stay.length ? `import { ${fmt(stay)} } from './history';\n` : ''}`,
        );
      }
      write(file, text);
    }
  }
  if (/^import\s+(?!type\b)/m.test(read(historyFile)))
    left.push('history.ts still imports something at run time — it may import types only');
}

// 4. Tests that called definition.detect.
for (const name of readdirSync(src).filter(f => /\.test\.tsx?$/.test(f))) {
  const file = join(src, name);
  let text = read(file);
  if (!/definition\.detect\b/.test(text)) continue;
  text = text.replace(/definition\.detect\?\.\(/g, 'detect(').replace(/definition\.detect\(/g, 'detect(');
  text = text.replace(/expect\(definition\.detect\)\.toBeUndefined\(\);\n/g, '');
  if (/\bdetect\(/.test(text) && !/from '\.\/detect'/.test(text))
    text = text.replace(/^(import [^\n]*from '\.\/definition';\n)/m, `$1import { detect } from './detect';\n`);
  write(file, text);
}

// Write, report.
for (const [file, text] of changed) {
  const before = existsSync(file) ? readFileSync(file, 'utf8') : null;
  if (before === text) continue;
  console.log(`${before === null ? 'create' : 'change'} ${relative(ROOT, file)}`);
  if (!dry) writeFileSync(file, text);
}
if (dry) process.exit(left.length ? 1 : 0);

if (!args.includes('--no-check')) {
  const run = (cmd, argv) => {
    try {
      execFileSync(cmd, argv, { cwd: ROOT, stdio: 'pipe' });
      console.log(`✓ ${cmd} ${argv.join(' ')}`);
    } catch (e) {
      left.push(
        `${cmd} ${argv.join(' ')} failed:\n${String(e.stdout ?? '').slice(-2000)}${String(e.stderr ?? '').slice(-1000)}`,
      );
    }
  };
  run('npx', ['prettier', '--write', relative(ROOT, ui)]);
  run('pnpm', ['--filter', `@workspace/tool-ui-${id}`, 'type-check']);
  run('pnpm', ['--filter', `@workspace/tool-ui-${id}`, 'test']);
  run('npx', ['eslint', relative(ROOT, ui)]);
  run('pnpm', ['--filter', 'extension', 'exec', 'vitest', 'run', 'src/tools/shape.test.ts']);
}
if (left.length) {
  console.log(`\nLeft to do by hand (${id}):`);
  for (const l of left) console.log(`  - ${l}`);
  process.exit(1);
}
console.log(`\n${id}: in the new shape.`);
