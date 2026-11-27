#!/usr/bin/env node
// The licences of the installed npm packages (everything under node_modules/.pnpm, development tools included)
// against a list of permissive ones. The repository's own licence forbids nothing here, but a copyleft dependency
// would put conditions on the code that uses it: a package under a licence that is not in ALLOWED fails the check
// until someone has read its licence and either removed the package or named it in EXCEPTIONS with the reason.
//
//   - ALLOWED: permissive licences. A package whose `license` is an SPDX expression passes when one side of an OR
//     is allowed, and when every side of an AND is.
//   - EXCEPTIONS: packages under other licences that do not ship in the extension (build tools, test data). An
//     exception names the package AND the licence: when either changes, the check fails again. An exception no
//     installed package uses fails too, so the list cannot go stale.
//   - A package without a licence field fails.
//
// The licences of what does ship are checked where the build collects their texts (validate-build.sh, licenses/).
// The Rust side has its own list (cargo deny).
//
// Usage: node scripts/licences-check.mjs [--list]
//   --list  print how many packages each licence has
import { existsSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STORE = join(ROOT, 'node_modules', '.pnpm');

const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'CC0-1.0',
  'ISC',
  'MIT',
  'MIT-0',
  'PSF-2.0',
  'Python-2.0',
  'Unicode-3.0',
  'Zlib',
]);

/**
 * Package name → the licence it is excepted under and why it is acceptable. None of these ships in the extension. A
 * name also covers the package's per-platform binaries (`<name>-darwin-arm64`, `<name>-linux-x64-gnu`, …).
 */
const EXCEPTIONS = new Map([
  ['@resvg/resvg-js', { licence: 'MPL-2.0', reason: 'build tool: renders the icons (scripts/generate-icons.mjs)' }],
  ['axe-core', { licence: 'MPL-2.0', reason: 'test tool: accessibility checks' }],
  ['lightningcss', { licence: 'MPL-2.0', reason: 'build tool: processes CSS, none of its code ships' }],
  ['caniuse-lite', { licence: 'CC-BY-4.0', reason: 'data read by build tools' }],
  ['commonmark-spec', { licence: 'CC-BY-SA-4.0', reason: "test data: the specification's examples, tests only" }],
]);

/** The exception that covers a package: its own, or the one of the package it is a platform binary of. */
const PLATFORM = /-(darwin|linux|win32|freebsd|android)-/;
const exceptionFor = name =>
  [...EXCEPTIONS].find(([base]) => name === base || (name.startsWith(`${base}-`) && PLATFORM.test(`${name}-`)));

/** The licence a package.json declares, as one SPDX expression; undefined when it declares none. */
const declared = pkg => {
  const { license, licenses } = pkg;
  if (typeof license === 'string' && license.trim() !== '') return license.trim();
  if (license && typeof license === 'object' && typeof license.type === 'string') return license.type;
  if (Array.isArray(licenses)) {
    const types = licenses.map(entry => (typeof entry === 'string' ? entry : entry?.type)).filter(Boolean);
    if (types.length > 0) return types.join(' OR ');
  }
  return undefined;
};

/** Whether an SPDX expression is satisfied by ALLOWED alone. Parentheses are only ever around the whole here. */
const allowed = expression =>
  expression
    .replace(/[()]/g, ' ')
    .split(/\s+OR\s+/i)
    .some(side => side.split(/\s+AND\s+/i).every(id => ALLOWED.has(id.trim())));

/** Every installed package: name → Set of "version\tlicence". */
const installed = () => {
  const found = new Map();
  for (const entry of readdirSync(STORE)) {
    const modules = join(STORE, entry, 'node_modules');
    if (!existsSync(modules)) continue;
    for (const name of readdirSync(modules)) {
      if (name === '.bin') continue;
      const dirs = name.startsWith('@') ? readdirSync(join(modules, name)).map(sub => join(name, sub)) : [name];
      for (const dir of dirs) {
        const path = join(modules, dir);
        // The package itself is a directory; its dependencies beside it are links to their own store entries.
        if (lstatSync(path).isSymbolicLink()) continue;
        let pkg;
        try {
          pkg = JSON.parse(readFileSync(join(path, 'package.json'), 'utf8'));
        } catch {
          continue;
        }
        if (typeof pkg.name !== 'string') continue;
        const versions = found.get(pkg.name) ?? new Set();
        versions.add(`${pkg.version}\t${declared(pkg) ?? ''}`);
        found.set(pkg.name, versions);
      }
    }
  }
  return found;
};

if (!existsSync(STORE)) {
  console.error('licences: node_modules/.pnpm is missing — run `pnpm install --frozen-lockfile` first');
  process.exit(2);
}

const problems = [];
const counts = new Map();
const used = new Set();
let total = 0;
for (const [name, versions] of [...installed()].sort(([a], [b]) => a.localeCompare(b))) {
  for (const line of versions) {
    const [version, licence] = line.split('\t');
    total += 1;
    counts.set(licence || '(none)', (counts.get(licence || '(none)') ?? 0) + 1);
    if (licence === '') {
      problems.push(`${name}@${version}: no licence declared`);
      continue;
    }
    if (allowed(licence)) continue;
    const [base, exception] = exceptionFor(name) ?? [];
    if (exception && exception.licence === licence) {
      used.add(base);
      continue;
    }
    problems.push(
      exception
        ? `${name}@${version}: ${licence}, but its exception is for ${exception.licence}`
        : `${name}@${version}: ${licence} is not in the allowed list`,
    );
  }
}
for (const name of EXCEPTIONS.keys()) {
  if (!used.has(name)) problems.push(`${name}: listed in EXCEPTIONS, but no installed package needs it — remove it`);
}

if (process.argv.includes('--list')) {
  for (const [licence, count] of [...counts].sort((a, b) => b[1] - a[1]))
    console.log(`${String(count).padStart(5)}  ${licence}`);
}
if (problems.length > 0) {
  console.error(`licences: ${problems.length} problem(s) in ${total} packages`);
  for (const problem of problems) console.error(`  ✗ ${problem}`);
  console.error('Read the licence, then remove the package or name it in EXCEPTIONS of scripts/licences-check.mjs.');
  process.exit(1);
}
console.log(`licences: ${total} packages, all under allowed licences (${used.size} named exceptions, none ships)`);
