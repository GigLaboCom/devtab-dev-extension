#!/usr/bin/env node
// Brings the generated half of the tokens from the theme exporter: spikes/theme-export/out/{themes.css,
// themes.index.json} → this package, byte for byte, then re-derives tokens.json.
//
//   node scripts/sync-themes.mjs [<exporter out dir>]   (default: ../../spikes/theme-export/out)
//
// The exporter itself (Rust: gpui-kit's own Theme::apply_config; Node: to-css.mjs) is described in
// spikes/theme-export/RESULTS.md and in README.md → «Как обновлять токены».
import { copyFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const pkg = fileURLToPath(new URL('../', import.meta.url));
const from = resolve(process.argv[2] ?? resolve(pkg, '../../spikes/theme-export/out'));
for (const file of ['themes.css', 'themes.index.json']) {
  const src = resolve(from, file);
  if (!existsSync(src)) {
    console.error(`${src} is missing — run the exporter first (spikes/theme-export/RESULTS.md).`);
    process.exit(1);
  }
  copyFileSync(src, resolve(pkg, file));
  console.log(`${file} ← ${src}`);
}
execFileSync(process.execPath, [resolve(pkg, 'scripts/tokens.mjs'), '--write'], { stdio: 'inherit' });
