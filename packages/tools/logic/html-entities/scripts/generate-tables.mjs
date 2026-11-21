#!/usr/bin/env node
// Generates the HTML Entities tool's two data modules from the HTML Standard's list of named character references
// (§13.5, published as JSON at https://html.spec.whatwg.org/entities.json):
//
//   src/namedReferences.generated.ts   the whole table — every name, with and without the semicolon, and what it stands
//                                      for; loaded lazily by loadReferenceTable() (src/table.ts), never by detect
//   src/detectNames.generated.ts       names only, no values: the 106 names that also work without a semicolon and the
//                                      names of HTML 4.01 — what detectHtmlEntities() recognises (src/detect.ts)
//
// Usage (the list is downloaded once, by hand, from its official address; this script never touches the network):
//
//   curl -sS -D headers.txt -o entities.json https://html.spec.whatwg.org/entities.json
//   node packages/tools/logic/html-entities/scripts/generate-tables.mjs entities.json \
//     --fetched=2026-11-21 --last-modified="Wed, 12 Nov 2025 00:20:03 GMT"
//   pnpm exec prettier --write packages/tools/logic/html-entities/src/*.generated.ts
//
// The script checks what it writes: the compact form parses back into exactly the list it was made from.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE_URL = 'https://html.spec.whatwg.org/entities.json';
const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

const args = process.argv.slice(2);
const file = args.find(a => !a.startsWith('--'));
const flag = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
if (!file) {
  console.error('usage: node generate-tables.mjs <entities.json> --fetched=YYYY-MM-DD --last-modified="<HTTP date>"');
  process.exit(1);
}
const raw = readFileSync(file);
const sha256 = createHash('sha256').update(raw).digest('hex');
const fetched = flag('fetched') ?? 'unknown';
const lastModified = flag('last-modified') ?? 'unknown';
/** @type {Record<string, { codepoints: number[], characters: string }>} */
const list = JSON.parse(raw.toString('utf8'));

const fail = message => {
  console.error(`generate-tables: ${message}`);
  process.exit(1);
};

// The list: "&name;" for every name, and also "&name" for the names that work without a semicolon (legacy names).
const keys = Object.keys(list);
for (const key of keys) {
  if (!/^&[A-Za-z][A-Za-z0-9]*;?$/.test(key)) fail(`unexpected key ${key}`);
  const { codepoints, characters } = list[key];
  if (String.fromCodePoint(...codepoints) !== characters) fail(`${key}: codepoints and characters differ`);
  if (codepoints.length < 1 || codepoints.length > 2) fail(`${key}: ${codepoints.length} code points`);
}
const names = keys
  .filter(k => k.endsWith(';'))
  .map(k => k.slice(1, -1))
  .sort();
const legacy = new Set(keys.filter(k => !k.endsWith(';')).map(k => k.slice(1)));
for (const name of legacy) {
  if (!(`&${name};` in list)) fail(`legacy ${name} has no form with a semicolon`);
  if (list[`&${name};`].characters !== list[`&${name}`].characters) fail(`legacy ${name}: the two forms differ`);
  if (list[`&${name}`].codepoints.length !== 1) fail(`legacy ${name}: more than one code point`);
}

// The compact form: for each name in order, the name, one marker, then the value's code points —
//   '&'  the name also works without a semicolon (legacy); one code point
//   ';'  with a semicolon only; one code point
//   ':'  with a semicolon only; two code points
// Names are [A-Za-z0-9]+ and markers are none of those, so the string reads back without separators.
let compact = '';
for (const name of names) {
  const { codepoints, characters } = list[`&${name};`];
  const marker = legacy.has(name) ? '&' : codepoints.length === 1 ? ';' : ':';
  if (legacy.has(name) && codepoints.length !== 1) fail(`${name}: legacy with two code points`);
  compact += name + marker + characters;
}

// The same reading as src/table.ts parseTable, to prove the round trip here.
const parsed = new Map();
for (let i = 0; i < compact.length;) {
  let j = i;
  while (/[A-Za-z0-9]/.test(compact[j])) j++;
  const name = compact.slice(i, j);
  const marker = compact[j];
  let k = j + 1;
  const count = marker === ':' ? 2 : 1;
  for (let n = 0; n < count; n++) k += compact.codePointAt(k) > 0xffff ? 2 : 1;
  const value = compact.slice(j + 1, k);
  parsed.set(`&${name};`, value);
  if (marker === '&') parsed.set(`&${name}`, value);
  i = k;
}
if (parsed.size !== keys.length) fail(`round trip: ${parsed.size} keys, the list has ${keys.length}`);
for (const key of keys) if (parsed.get(key) !== list[key].characters) fail(`round trip: ${key} differs`);

/** A string literal with every invisible, spacing or combining character escaped, everything else as it is. */
const literal = text =>
  JSON.stringify(text).replace(/[\p{C}\p{M}]|(?! )\p{Z}/gu, c => `\\u{${c.codePointAt(0).toString(16).toUpperCase()}}`);

const header = what => `/**
${what.map(line => ` * ${line}`).join('\n')}
 *
 * Generated — do not edit — by scripts/generate-tables.mjs from the HTML Standard's list of named character
 * references (§13.5), ${SOURCE_URL}
 * Last-Modified: ${lastModified}; fetched ${fetched}; SHA-256 ${sha256}.
 * ${keys.length} entries: ${names.length} names with a semicolon, ${legacy.size} of them also without one.
 */
`;

writeFileSync(
  join(SRC, 'namedReferences.generated.ts'),
  `${header([
    'The named character references of HTML, compact: each name, then `&` (it also works without a semicolon; one code',
    'point), `;` (one code point) or `:` (two code points), then what it stands for. Read by parseTable (table.ts).',
  ])}export const NAMED_REFERENCES = ${literal(compact)};\n`,
);

// HTML 4.01's entity sets (HTMLlat1, HTMLsymbol, HTMLspecial) and XHTML's apos: the names people write. With the legacy
// names they are what detect knows; a name only HTML5 has (&NotEqualTilde;) is decoded by the tool but not recognised.
const HTML4 =
  `nbsp iexcl cent pound curren yen brvbar sect uml copy ordf laquo not shy reg macr deg plusmn sup2 sup3 acute
micro para middot cedil sup1 ordm raquo frac14 frac12 frac34 iquest Agrave Aacute Acirc Atilde Auml Aring AElig Ccedil
Egrave Eacute Ecirc Euml Igrave Iacute Icirc Iuml ETH Ntilde Ograve Oacute Ocirc Otilde Ouml times Oslash Ugrave Uacute
Ucirc Uuml Yacute THORN szlig agrave aacute acirc atilde auml aring aelig ccedil egrave eacute ecirc euml igrave iacute
icirc iuml eth ntilde ograve oacute ocirc otilde ouml divide oslash ugrave uacute ucirc uuml yacute thorn yuml
fnof Alpha Beta Gamma Delta Epsilon Zeta Eta Theta Iota Kappa Lambda Mu Nu Xi Omicron Pi Rho Sigma Tau Upsilon Phi Chi
Psi Omega alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigmaf sigma tau
upsilon phi chi psi omega thetasym upsih piv bull hellip prime Prime oline frasl weierp image real trade alefsym larr
uarr rarr darr harr crarr lArr uArr rArr dArr hArr forall part exist empty nabla isin notin ni prod sum minus lowast
radic prop infin ang and or cap cup int there4 sim cong asymp ne equiv le ge sub sup nsub sube supe oplus otimes perp
sdot lceil rceil lfloor rfloor lang rang loz spades clubs hearts diams
quot amp lt gt OElig oelig Scaron scaron Yuml circ tilde ensp emsp thinsp zwnj zwj lrm rlm ndash mdash lsquo rsquo sbquo
ldquo rdquo bdquo dagger Dagger permil lsaquo rsaquo euro apos`
    .split(/\s+/)
    .filter(Boolean);
if (HTML4.length !== 96 + 124 + 32 + 1) fail(`HTML 4 names: ${HTML4.length}, expected 253`);
if (new Set(HTML4).size !== HTML4.length) fail('HTML 4 names repeat');
for (const name of HTML4) if (!(`&${name};` in list)) fail(`HTML 4 name ${name} is not in the list`);
const legacyNames = [...legacy].sort();
const common = HTML4.filter(n => !legacy.has(n)).sort();

writeFileSync(
  join(SRC, 'detectNames.generated.ts'),
  `${header([
    'Names only, no values — what detectHtmlEntities recognises: LEGACY, the names that also work without a semicolon',
    '(a longer word that starts with one still decodes), and COMMON, the rest of HTML 4.01’s names and `apos`.',
  ])}export const LEGACY = ${literal(legacyNames.join(' '))};\n\nexport const COMMON = ${literal(common.join(' '))};\n`,
);

console.log(
  `generate-tables: ${keys.length} entries (${names.length} names, ${legacy.size} legacy), compact ${Buffer.byteLength(compact)} bytes UTF-8; detect: ${legacyNames.length} legacy + ${common.length} common names`,
);
