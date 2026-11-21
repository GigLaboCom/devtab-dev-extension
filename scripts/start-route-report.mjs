#!/usr/bin/env node
// What the start route loads before its first paint, by piece: builds the extension with source maps into a temporary
// directory (the same configuration as `pnpm build`, minified), takes the files Check 15 of validate-build.sh counts (the
// main page's scripts and stylesheets, their static imports, the boot scripts) and attributes every byte of them:
// JavaScript to the source module it came from (through the source map), CSS to the rule group it belongs to (by the
// first class of the selector). Prints a table, or JSON with --json. Nothing is written outside the temporary directory.
//
// Usage: node scripts/start-route-report.mjs [--json] [--modules] [--dist=<dir>]
//   --modules     one row per source module as well as per piece
//   --dist=<dir>  read an existing build made with source maps instead of building
import { buildExtension, ROOT, startFiles } from './start-route.mjs';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = name => args.includes(`--${name}`);
const option = name => args.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);

const buildWithMaps = async () => {
  const outDir = mkdtempSync(join(tmpdir(), 'start-route-'));
  await buildExtension(outDir, { sourcemap: 'hidden' });
  return outDir;
};

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const decodeVlq = segment => {
  const out = [];
  let value = 0;
  let shift = 0;
  for (const c of segment) {
    const digit = B64.indexOf(c);
    value += (digit & 31) << shift;
    if (digit & 32) shift += 5;
    else {
      out.push(value & 1 ? -(value >>> 1) : value >>> 1);
      value = 0;
      shift = 0;
    }
  }
  return out;
};

/** Bytes of a minified file per source module, through its source map. */
const attributeJs = (file, map) => {
  const text = readFileSync(file, 'utf8');
  const lines = text.split('\n');
  const bytes = new Map();
  const add = (source, slice) => bytes.set(source, (bytes.get(source) ?? 0) + Buffer.byteLength(slice));
  let src = 0;
  map.mappings.split(';').forEach((line, i) => {
    const code = lines[i] ?? '';
    let col = 0;
    let start = 0;
    let current = '(unmapped)';
    for (const segment of line.split(',').filter(Boolean)) {
      const [dc, ds] = decodeVlq(segment);
      col += dc;
      add(current, code.slice(start, col));
      start = col;
      if (ds !== undefined) {
        src += ds;
        current = map.sources[src] ?? '(unmapped)';
      } else current = '(unmapped)';
    }
    add(current, code.slice(start) + (i < lines.length - 1 ? '\n' : ''));
  });
  return bytes;
};

/** Where a module belongs in the report. */
const pieceOfModule = source => {
  const s = source.replace(/\\/g, '/');
  const rules = [
    [/node_modules\/(?:\.pnpm\/)?(?:react-dom|react|scheduler)[@/]/, 'core: React'],
    [/node_modules\/(?:\.pnpm\/)?lucide-react[@/]/, 'icons (lucide-react)'],
    [/node_modules\/(?:\.pnpm\/)?(?:radix-ui|@radix-ui)[@/]/, 'Radix'],
    [/node_modules\/(?:\.pnpm\/)?(?:clsx|tailwind-merge|class-variance-authority)[@/]/, 'ui kit: cn / cva'],
    [/vite\/preload-helper|vite\/modulepreload-polyfill|\0vite/, 'core: Vite runtime'],
    [/packages\/logger\//, 'core: logger'],
    [/packages\/tools\/ui\/[^/]+\/src\/definition\.ts/, 'tools: definitions'],
    [/packages\/tools\/ui\/[^/]+\/src\/history\.ts/, 'tools: history declarations'],
    [/packages\/tools\/ui\/[^/]+\/src\/detect\.ts/, 'tools: detect'],
    [/packages\/tools\/logic\//, 'tools: detect (logic)'],
    [/packages\/tools\/ui\/host\//, 'tools: host contract'],
    [/virtual:tool-catalogue|tools\/catalogue/, 'tools: catalogue'],
    [/extension\/src\/tools\/registry/, 'tools: registry'],
    [/packages\/ui\//, 'ui kit: components'],
    [/extension\/src\/app\/(?:main|App|route)\.tsx?$/, 'core: page frame'],
    [/extension\/src\/app\/(?:useTheme)\.ts$|extension\/src\/shared\/theme\//, 'core: theme'],
    [/extension\/src\/app\/useStart\.ts$/, 'core: route boot / start state'],
    [/extension\/src\/(?:newTab|options)\//, 'core: route boot / start state'],
    [/extension\/src\/start\/(?:store|settings|newTabPage|behaviors)\.ts$/, 'core: route boot / start state'],
    [/extension\/src\/start\/part\.ts$|extension\/src\/start\/parts\/(?:index|deps)\.ts$/, 'parts: seam and list'],
    [/extension\/src\/start\/parts\/[^/]+\.ts$/, 'parts: definitions and implementations'],
    [/extension\/src\/start\/(?:tileSources|webSearch|siteIcons)\.ts$/, 'parts: tile sources, web search, site icons'],
    [/extension\/src\/app\/start\/(?:Tiles|ShortcutForm)\.tsx$/, 'rows: tiles and the shortcut form'],
    [/extension\/src\/app\/sections\/StartPage\.tsx$/, 'start page component'],
    [
      /extension\/src\/app\/start\/CommandField\.tsx$|extension\/src\/app\/finder\/|extension\/src\/app\/handoff/,
      'field: component, list, paste',
    ],
    [/extension\/src\/shared\/(?:finder|fuzzy|match)/, 'field: matcher'],
    [/extension\/src\/shared\/destinations|extension\/src\/app\/destinationIcons/, 'field: places (sections + tools)'],
    [/extension\/src\/shortcuts\//, 'shortcuts'],
    [/extension\/src\/shared\/pages/, 'core: pages'],
    [/product\.json/, 'core: page frame'],
  ];
  return (
    rules.find(([re]) => re.test(s))?.[1] ?? `other: ${s.replace(/^.*?(extension|packages|node_modules)\//, '$1/')}`
  );
};

/** Splits CSS into top-level rules, entering @layer / @media / @supports blocks; returns [selector-or-at, text]. */
const cssRules = (css, prefix = '') => {
  const out = [];
  let i = 0;
  while (i < css.length) {
    while (i < css.length && /\s/.test(css[i])) i++;
    if (i >= css.length) break;
    let j = i;
    let depth = 0;
    let head = -1;
    let quote = null;
    for (; j < css.length; j++) {
      const c = css[j];
      if (quote) {
        if (c === '\\') j++;
        else if (c === quote) quote = null;
        continue;
      }
      if (c === '"' || c === "'") quote = c;
      else if (c === '{') {
        if (depth === 0) head = j;
        depth++;
      } else if (c === '}') {
        depth--;
        if (depth === 0) {
          j++;
          break;
        }
      } else if (c === ';' && depth === 0) {
        j++;
        break;
      }
    }
    const text = css.slice(i, j);
    const selector = head < 0 ? text : css.slice(i, head).trim();
    if (head >= 0 && /^@(layer|media|supports|container)\b/.test(selector))
      out.push(...cssRules(css.slice(head + 1, j - 1), `${prefix}${selector} `).map(([s, t, p]) => [s, t, p]));
    else out.push([selector, text, prefix]);
    i = j;
  }
  return out;
};

const pieceOfRule = (selector, prefix) => {
  if (selector.startsWith('@font-face')) return 'css: fonts (@font-face)';
  if (selector.startsWith('@property') || selector.startsWith('@keyframes'))
    return 'css: Tailwind @property / keyframes';
  if (/^@layer\b[^{]*$/.test(selector) || selector.startsWith('@layer')) return 'css: layer order';
  if (/\[data-theme=/.test(selector)) return 'css: themes (30)';
  if (prefix.includes('@layer theme') || /^:root|^:host/.test(selector)) return 'css: tokens (:root)';
  if (prefix.includes('@layer base')) return 'css: base';
  const cls = selector.match(/\.((?:kit|cn)-[a-z0-9]+(?:-[a-z0-9]+)?)/)?.[1];
  if (cls) {
    const groups = [
      [/^kit-settings/, 'css: kit-settings* (shell only)'],
      [/^kit-compare/, 'css: kit-compare* (shell only)'],
      [/^kit-history/, 'css: kit-history* (shell only)'],
      [/^kit-tool-history/, 'css: kit-tool-history* (shell only)'],
      [/^kit-tool/, 'css: kit-tool-* tool page (shell only)'],
      [/^kit-result-row/, 'css: kit-result-row* (tools only)'],
      [/^kit-file-drop/, 'css: kit-file-drop* (tools only)'],
      [/^cn-table/, 'css: cn-table* (tools only)'],
      [/^kit-(?:start|command|tile)/, 'css: start page frame (kit-start/command/tile*)'],
      [/^kit-bare/, 'css: kit-bare (options dialog)'],
      [/^kit-section/, 'css: kit-section* (shell only)'],
      [/^cn-/, `css: component layer (${cls.replace(/^(cn-[a-z]+).*/, '$1')}*)`],
    ];
    return groups.find(([re]) => re.test(cls))?.[1] ?? `css: ${cls}*`;
  }
  if (prefix.includes('@layer utilities')) return 'css: Tailwind utilities';
  if (prefix.includes('@layer components')) return 'css: component layer (other)';
  return 'css: other';
};

const dir = option('dist') ? resolve(option('dist')) : await buildWithMaps();
try {
  const files = startFiles(dir);
  const pieces = new Map();
  const modules = new Map();
  const fileRows = [];
  const add = (map, key, n) => map.set(key, (map.get(key) ?? 0) + n);
  for (const file of files) {
    const size = readFileSync(file).length;
    fileRows.push([relative(dir, file), size]);
    if (file.endsWith('.js') && existsSync(`${file}.map`)) {
      const map = JSON.parse(readFileSync(`${file}.map`, 'utf8'));
      for (const [source, n] of attributeJs(file, map)) {
        const abs = resolve(dirname(file), source);
        add(pieces, pieceOfModule(abs), n);
        add(modules, relative(ROOT, abs), n);
      }
    } else if (file.endsWith('.css')) {
      for (const [selector, text, prefix] of cssRules(readFileSync(file, 'utf8')))
        add(pieces, pieceOfRule(selector, prefix), Buffer.byteLength(text));
    } else add(pieces, `boot: ${relative(dir, file)}`, size);
  }
  const total = fileRows.reduce((s, [, n]) => s + n, 0);
  const counted = [...pieces.values()].reduce((s, n) => s + n, 0);
  // Bytes between rules (whitespace) and the files' own wrappers end up here so the rows add up to the total.
  if (total !== counted) add(pieces, '(between rules, wrappers)', total - counted);
  const sorted = map => [...map.entries()].sort((a, b) => b[1] - a[1]);
  if (flag('json')) {
    process.stdout.write(
      `${JSON.stringify({ total, files: fileRows, pieces: Object.fromEntries(sorted(pieces)), modules: flag('modules') ? Object.fromEntries(sorted(modules)) : undefined }, null, 2)}\n`,
    );
  } else {
    const fmt = n => n.toLocaleString('en-US').padStart(9);
    console.log(`Start route: ${files.length} files, ${total.toLocaleString('en-US')} bytes`);
    for (const [f, n] of fileRows) console.log(`  ${fmt(n)}  ${f}`);
    console.log('\nBy piece:');
    for (const [p, n] of sorted(pieces)) console.log(`  ${fmt(n)}  ${p}`);
    if (flag('modules')) {
      console.log('\nBy module:');
      for (const [m, n] of sorted(modules)) console.log(`  ${fmt(n)}  ${m}`);
    }
  }
} finally {
  if (!option('dist')) rmSync(dir, { recursive: true, force: true });
}
