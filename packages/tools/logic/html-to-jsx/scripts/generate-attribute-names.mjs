#!/usr/bin/env node
// Generates the HTML to JSX tool's data file, src/attribute-names.json: the attribute names whose React property is
// written differently (`class` → `className`, `stroke-width` → `strokeWidth`), taken from the dictionary
// `possibleStandardNames` of the installed `react-dom` (cjs/react-dom-client.development.js; MIT — the notice is copied
// to licenses/react-dom-LICENSE.txt). The file's header records the package, its version, the source file's SHA-256
// and the number of pairs. Loaded lazily by loadAttributeNames() (src/names.ts), a chunk of its own in a build.
//
// Usage — after `react-dom` changes version in the workspace (the package's test compares the file with the installed
// package and fails until this is run again):
//
//   node packages/tools/logic/html-to-jsx/scripts/generate-attribute-names.mjs
//
// The script reads only the installed package and never touches the network.

import { createHash } from 'node:crypto';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const PACKAGE = join(dirname(fileURLToPath(import.meta.url)), '..');
const SOURCE_FILE = 'cjs/react-dom-client.development.js';

/** The pairs `name → property` of `possibleStandardNames` in the source's order, every one of them (494 in 19.3.1). */
export const possibleStandardNames = source => {
  const start = source.indexOf('possibleStandardNames = {');
  if (start === -1) throw new Error('possibleStandardNames not found');
  const end = source.indexOf('}', start);
  const body = source.slice(source.indexOf('{', start) + 1, end);
  const pairs = [];
  for (const line of body.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '') continue;
    const m = /^(?:"([^"]+)"|([A-Za-z_$][\w$]*)):\s*"([^"]*)",?$/.exec(trimmed);
    if (!m) throw new Error(`unreadable entry: ${trimmed}`);
    pairs.push([m[1] ?? m[2], m[3]]);
  }
  return pairs;
};

/** What the data file holds for this `react-dom`: its header and the pairs that change (name ≠ property). */
export const attributeNamesFile = (source, version) => {
  const names = Object.fromEntries(possibleStandardNames(source).filter(([name, property]) => name !== property));
  return {
    source: `react-dom/${SOURCE_FILE}, possibleStandardNames`,
    package: 'react-dom',
    version,
    license: 'MIT (licenses/react-dom-LICENSE.txt)',
    sha256: createHash('sha256').update(source).digest('hex'),
    count: Object.keys(names).length,
    names,
  };
};

/** The installed `react-dom`: its directory, version and source text. */
export const installedReactDom = () => {
  const manifest = createRequire(join(PACKAGE, 'package.json')).resolve('react-dom/package.json');
  const dir = dirname(manifest);
  return {
    dir,
    version: JSON.parse(readFileSync(manifest, 'utf8')).version,
    source: readFileSync(join(dir, SOURCE_FILE), 'utf8'),
  };
};

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const { dir, version, source } = installedReactDom();
  const file = attributeNamesFile(source, version);
  writeFileSync(join(PACKAGE, 'src/attribute-names.json'), `${JSON.stringify(file, null, 2)}\n`);
  copyFileSync(join(dir, 'LICENSE'), join(PACKAGE, 'licenses/react-dom-LICENSE.txt'));
  console.log(`attribute-names.json: ${file.count} pairs from react-dom ${version} (SHA-256 ${file.sha256})`);
}
