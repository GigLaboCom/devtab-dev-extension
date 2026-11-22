#!/usr/bin/env node
// Generates the String Inspector's two data modules from the Unicode Character Database 16.0.0
// (https://www.unicode.org/Public/16.0.0/ucd/, files UnicodeData.txt and NameAliases.txt; Unicode License v3, whose
// text ships from licenses/):
//
//   src/names.generated.ts     the 178 character names of docs/tools/specs/string-inspector.md §5.3 — the 95 of printable
//                              ASCII and the 83 of the characters the tool flags (a control character's name, which
//                              UnicodeData.txt gives as <control>, is its first `control` alias in NameAliases.txt);
//                              loaded lazily by loadNames() (src/names.ts), a chunk of its own in a build
//   src/markers.generated.ts   the markers of §5.3: the `abbreviation` aliases of the flagged characters that have one
//                              (57 of the 83); TAB for U+0009 and EM for U+0019, where NameAliases.txt lists HT and EOM
//                              first. Small and needed at once (warnings, the visible text), so it is a plain module
//
// The variation selectors' markers, VS1–VS256, are a formula in src/kinds.ts; this script checks the formula against
// every one of the 256 abbreviations in NameAliases.txt and fails if they differ.
//
// Usage (the two files are downloaded once, by hand, from their official address; this script never touches the
// network):
//
//   curl -sS -o UnicodeData.txt https://www.unicode.org/Public/16.0.0/ucd/UnicodeData.txt
//   curl -sS -o NameAliases.txt https://www.unicode.org/Public/16.0.0/ucd/NameAliases.txt
//   node packages/tools/logic/string-inspector/scripts/generate-names.mjs UnicodeData.txt NameAliases.txt \
//     --fetched=2026-11-22
//   pnpm exec prettier --write packages/tools/logic/string-inspector/src/*.generated.ts

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const VERSION = '16.0.0';
const SOURCE = `https://www.unicode.org/Public/${VERSION}/ucd/`;
// The published files of 16.0.0 (docs/tools/specs/string-inspector.md §11): another file is another version.
const EXPECTED = {
  'UnicodeData.txt': 'ff58e5823bd095166564a006e47d111130813dcf8bf234ef79fa51a870edb48f',
  'NameAliases.txt': '9953f0fcebf5ea8091c5c581e4df0e43f20d2533c84ccca7987a9bb819a896a8',
};
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const fail = message => {
  console.error(`generate-names: ${message}`);
  process.exit(1);
};
const args = process.argv.slice(2);
const files = args.filter(a => !a.startsWith('--'));
const fetched = args.find(a => a.startsWith('--fetched='))?.slice('--fetched='.length);
if (files.length !== 2 || !fetched)
  fail('usage: node generate-names.mjs <UnicodeData.txt> <NameAliases.txt> --fetched=YYYY-MM-DD');

const read = (path, name) => {
  const raw = readFileSync(path);
  const sha256 = createHash('sha256').update(raw).digest('hex');
  if (sha256 !== EXPECTED[name]) fail(`${path}: SHA-256 ${sha256} is not ${name} of Unicode ${VERSION}`);
  return { text: raw.toString('utf8'), sha256, bytes: raw.length };
};
const unicodeData = read(files[0], 'UnicodeData.txt');
const nameAliases = read(files[1], 'NameAliases.txt');

const hex = cp => cp.toString(16).toUpperCase().padStart(4, '0');
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, i) => from + i);

// The characters the tool flags (§5.3, the table's rows with their own names), in code point order, and U+FFFD, which
// has a name and no marker.
const FLAGGED = [
  ...range(0x0000, 0x001f),
  0x007f,
  0x0085,
  0x00a0,
  0x00ad,
  0x034f,
  0x061c,
  0x115f,
  0x1160,
  0x1680,
  0x180e,
  ...range(0x2000, 0x200f),
  0x2028,
  0x2029,
  ...range(0x202a, 0x202f),
  0x205f,
  ...range(0x2060, 0x2064),
  ...range(0x2066, 0x2069),
  0x2800,
  0x3000,
  0x3164,
  0xfeff,
  0xffa0,
  0xfffc,
  0xfffd,
];
const ASCII = range(0x0020, 0x007e);
if (FLAGGED.length !== 83) fail(`${FLAGGED.length} flagged characters, not the 83 of §5.3`);

// UnicodeData.txt: code point;name;category;… — one line per code point (ranges as <…, First>/<…, Last>, not needed).
const dataNames = new Map();
for (const line of unicodeData.text.split('\n')) {
  if (!line) continue;
  const [cp, name] = line.split(';');
  dataNames.set(parseInt(cp, 16), name);
}
// NameAliases.txt: code point;alias;type — in the file's order.
const aliases = new Map();
for (const line of nameAliases.text.split('\n')) {
  if (!line || line.startsWith('#')) continue;
  const [cp, alias, type] = line.split(';');
  const key = parseInt(cp, 16);
  if (!aliases.has(key)) aliases.set(key, []);
  aliases.get(key).push({ alias, type });
}

const nameOf = cp => {
  const name = dataNames.get(cp);
  if (name === undefined) fail(`U+${hex(cp)} is not in UnicodeData.txt`);
  if (name !== '<control>') return name;
  const control = (aliases.get(cp) ?? []).find(a => a.type === 'control');
  if (!control) fail(`U+${hex(cp)}: <control> without a control alias`);
  return control.alias;
};
// §5.3: U+0009 is TAB (NameAliases.txt lists HT, then TAB) and U+0019 is EM (it lists EOM, then EM — the name ASCII
// and the control pictures give it); every other marker is the first abbreviation.
const PREFERRED = new Map([
  [0x0009, 'TAB'],
  [0x0019, 'EM'],
]);
const abbreviationOf = cp => {
  const list = (aliases.get(cp) ?? []).filter(a => a.type === 'abbreviation').map(a => a.alias);
  const preferred = PREFERRED.get(cp);
  if (preferred !== undefined) {
    if (!list.includes(preferred)) fail(`U+${hex(cp)}: ${preferred} is not one of its abbreviations`);
    return preferred;
  }
  return list[0] ?? null;
};

const names = [...ASCII, ...FLAGGED].sort((a, b) => a - b).map(cp => [cp, nameOf(cp)]);
for (const [cp, name] of names) if (!/^[A-Z0-9][A-Z0-9 -]*$/.test(name)) fail(`U+${hex(cp)}: unexpected name ${name}`);
const markers = FLAGGED.filter(cp => cp !== 0xfffd)
  .map(cp => [cp, abbreviationOf(cp)])
  .filter(([, m]) => m !== null);
const without = FLAGGED.filter(cp => cp !== 0xfffd && abbreviationOf(cp) === null);

// VS1–VS16 at U+FE00–U+FE0F and VS17–VS256 at U+E0100–U+E01EF: the formula of src/kinds.ts.
for (let i = 0; i < 256; i++) {
  const cp = i < 16 ? 0xfe00 + i : 0xe0100 + i - 16;
  const found = abbreviationOf(cp);
  if (found !== `VS${i + 1}`) fail(`U+${hex(cp)}: abbreviation ${found}, the formula says VS${i + 1}`);
}

const compact = list => list.map(([cp, v]) => `${hex(cp)}:${v}`).join(';');
const header = what => `/**
 * ${what}
 *
 * Generated — do not edit — by scripts/generate-names.mjs from the Unicode Character Database ${VERSION},
 * ${SOURCE} (UnicodeData.txt, ${unicodeData.bytes} bytes, SHA-256 ${unicodeData.sha256};
 * NameAliases.txt, ${nameAliases.bytes} bytes, SHA-256 ${nameAliases.sha256}); fetched ${fetched}.
 * Unicode License v3: the notice ships with the tool (licenses/unicode-character-database-LICENSE.txt).
 */`;

writeFileSync(
  join(SRC, 'names.generated.ts'),
  `${header(
    `The ${names.length} character names of docs/tools/specs/string-inspector.md §5.3, compact: \`XXXX:NAME\` joined by \`;\` (the code point in hex). The ${ASCII.length} of printable ASCII and the ${FLAGGED.length} of the characters the tool flags; a control character's name is its first \`control\` alias in NameAliases.txt. Read by parseNames (names.ts).`,
  )}
export const NAMES =
  '${compact(names)}';
`,
);
writeFileSync(
  join(SRC, 'markers.generated.ts'),
  `${header(
    `The markers of docs/tools/specs/string-inspector.md §5.3, compact: \`XXXX:ABBREVIATION\` joined by \`;\` — the \`abbreviation\` alias in NameAliases.txt of the ${markers.length} flagged characters that have one (TAB for U+0009, EM for U+0019, the first one otherwise). The other ${without.length} show as U+XXXX; the variation selectors are a formula (kinds.ts).`,
  )}
export const ABBREVIATIONS =
  '${compact(markers)}';
`,
);
console.log(
  `generate-names: ${names.length} names (${compact(names).length} characters), ${markers.length} markers; ${without.length} flagged code points without an abbreviation: ${without.map(hex).join(' ')}`,
);
