#!/usr/bin/env node
// Renders extension/icons-src/icon.svg to the PNGs the manifest names (extension/public/icons/icon-<size>.png):
// 16 / 32 for the toolbar, 48 for chrome://extensions, 128 for the store. Same tool as the second sibling extension
// (@resvg/resvg-js, pinned). Never hand-edit the PNGs — edit the SVG and run `pnpm icons`.
import { Resvg } from '@resvg/resvg-js';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const svg = readFileSync(join(root, 'extension/icons-src/icon.svg'), 'utf8');
const out = join(root, 'extension/public/icons');
mkdirSync(out, { recursive: true });

for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng();
  writeFileSync(join(out, `icon-${size}.png`), png);
  console.log(`icon-${size}.png  ${png.length} bytes`);
}
