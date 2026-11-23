#!/usr/bin/env node
// DEVTAB_MOCK_BACKEND — development only.
//
// `node scripts/mock-backend/scan-build.mjs <build directory>` — proves that no file of a build mentions the mock
// backend: its marker, its control path, a loopback address, a `mock-` key id, or the coordinates of the keys it
// generated in .state/mock-backend/public.json (when there are any). scripts/validate-build.sh runs it as Check 17,
// in the spirit of the licence check's planned Check 17 (pro-entitlement-implementation.md §7.3, part 1), which will
// join it. Exit 0 with one line when clean; exit 1 with the findings.
import { readdir, readFile } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { pathToFileURL } from 'node:url';

const ROOT = join(import.meta.dirname, '..', '..');
const DEFAULT_PUBLIC_KEYS = join(ROOT, '.state', 'mock-backend', 'public.json');

/** What a build must never contain, as [label, pattern]. */
export const FORBIDDEN = Object.freeze([
  ['the mock backend’s marker', /DEVTAB_MOCK_BACKEND/],
  ['the mock’s control path', /\/__mock\//],
  ['a loopback address', /(?:https?|wss?):\/\/(?:127\.0\.0\.1|localhost|\[::1\])(?::\d+)?(?![\w.-])/],
  ['a mock key id', /kid["']?\s*:\s*["'`]mock-/],
]);

async function* files(dir) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile()) yield path;
  }
}

/** The x and y coordinates of the mock's public keys, if it has generated any. */
export async function mockKeyCoordinates(file = DEFAULT_PUBLIC_KEYS) {
  try {
    const entries = JSON.parse(await readFile(file, 'utf8'));
    return entries.flatMap(e => [e?.jwk?.x, e?.jwk?.y]).filter(v => typeof v === 'string' && v.length >= 40);
  } catch {
    return [];
  }
}

/** The findings in `dir`: `{ file, what }[]`, empty when clean. */
export async function scanBuild(dir, { coordinates = [] } = {}) {
  const findings = [];
  for await (const path of files(dir)) {
    const text = (await readFile(path)).toString('latin1');
    for (const [what, pattern] of FORBIDDEN) if (pattern.test(text)) findings.push({ file: relative(dir, path), what });
    for (const value of coordinates)
      if (text.includes(value))
        findings.push({ file: relative(dir, path), what: 'a coordinate of the mock’s public key' });
  }
  return findings;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const dir = process.argv[2];
  if (!dir) {
    console.error('usage: node scripts/mock-backend/scan-build.mjs <build directory> [public keys file]');
    process.exit(2);
  }
  const coordinates = await mockKeyCoordinates(process.argv[3]);
  const findings = await scanBuild(dir, { coordinates });
  if (findings.length) {
    for (const f of findings) console.log(`${f.file}: ${f.what}`);
    process.exit(1);
  }
  console.log(
    `no trace of the mock backend (marker, control path, loopback address, mock key id${coordinates.length ? `, its ${coordinates.length / 2} public keys` : ''})`,
  );
}
