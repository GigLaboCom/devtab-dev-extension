// The tool's outputs read by independent programs already on this machine (docs/tools/specs/image-convert.md §12):
// every PNG, JPEG, WebP, .ico and .zip the e2e module saved through the page's Save (.state/e2e/image-convert-out/) is
// identified with its size by `file`, by Apple's `sips` and by ImageMagick's `identify`; a WebP's chunks by libwebp's
// `webpinfo` (lossless = VP8L); an .ico's images by `identify` (one line per image) and its header by `xxd`; a .zip by
// `unzip -t` and `zipinfo`. Nothing is installed: a program that is missing is skipped and said so.
//
// Not part of `pnpm check` (it needs the e2e module's files and those programs). Run from the repository, after
// `pnpm test:e2e -- --only=image-convert`: node packages/tools/logic/image-convert/scripts/cross-check.mjs
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../../../..');
const OUT = join(ROOT, '.state/e2e/image-convert-out');
const run = (cmd, args) => {
  const r = spawnSync(cmd, args, { encoding: 'utf8' });
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim(), missing: r.error?.code === 'ENOENT' };
};
const has = cmd => !run(cmd, ['-version']).missing || !run(cmd, ['--version']).missing;
const tools = {
  file: has('file'),
  sips: has('sips'),
  identify: has('magick'),
  webpinfo: has('webpinfo'),
  unzip: has('unzip'),
  zipinfo: has('zipinfo'),
  xxd: has('xxd'),
};

const files = readdirSync(OUT)
  .filter(name => /\.(png|jpg|webp|ico|zip)$/.test(name))
  .sort();
const rows = [];
const problems = [];
const expectType = {
  png: /PNG image data/,
  jpg: /JPEG image data/,
  webp: /Web\/P image/,
  ico: /icon resource/,
  zip: /Zip archive/,
};
const sipsFormat = { png: 'png', jpg: 'jpeg', webp: 'webp', ico: 'ico' };

for (const name of files) {
  const path = join(OUT, name);
  const ext = name.split('.').pop();
  const row = { name, bytes: readFileSync(path).length };
  if (tools.file) {
    row.file = run('file', ['-b', path]).out;
    if (!expectType[ext].test(row.file)) problems.push(`${name}: file says "${row.file}"`);
  }
  if (ext === 'zip') {
    if (tools.unzip) {
      const t = run('unzip', ['-t', path]);
      row.unzip = t.out.split('\n').pop();
      if (!t.ok || !/No errors detected/.test(t.out)) problems.push(`${name}: unzip -t: ${t.out}`);
    }
    if (tools.zipinfo) {
      const z = run('zipinfo', [path]);
      const lines = z.out.split('\n');
      row.zipinfo = lines.filter(l => /^-/.test(l)).map(l => l.replace(/\s+/g, ' '));
      row.zipinfoTotal = lines.pop();
      if (!z.ok || row.zipinfo.some(l => !/ stor /.test(` ${l} `))) problems.push(`${name}: zipinfo: not all stored`);
    }
  } else {
    if (tools.sips && sipsFormat[ext]) {
      const s = run('sips', ['-g', 'pixelWidth', '-g', 'pixelHeight', '-g', 'format', path]).out;
      const value = key => new RegExp(`${key}: (\\S+)`).exec(s)?.[1];
      row.sips = `${value('format')} ${value('pixelWidth')} × ${value('pixelHeight')}`;
      if (value('format') !== sipsFormat[ext]) problems.push(`${name}: sips says ${row.sips}`);
    }
    if (tools.identify) {
      const i = run('magick', ['identify', '-format', '%m %w×%h %[channels] %[bit-depth]-bit\\n', path]);
      row.identify = i.out.split('\n');
      if (!i.ok) problems.push(`${name}: identify failed: ${i.out}`);
    }
    if (ext === 'webp' && tools.webpinfo) {
      const w = run('webpinfo', [path]).out;
      row.webpinfo = [...new Set([...w.matchAll(/Chunk (\S+)/g)].map(m => m[1]))].join(', ');
      if (name.includes('lossless') && !row.webpinfo.includes('VP8L'))
        problems.push(`${name}: not VP8L (${row.webpinfo})`);
      if (!name.includes('lossless') && row.webpinfo.includes('VP8L')) problems.push(`${name}: lossy expected`);
    }
    if (ext === 'ico' && tools.xxd) row.xxd = run('xxd', ['-l', '54', path]).out.split('\n');
  }
  rows.push(row);
}

const report = {
  tools: {
    file: tools.file ? run('file', ['--version']).out.split('\n')[0] : 'missing',
    sips: tools.sips ? run('sips', ['--version']).out.split('\n')[0] : 'missing',
    identify: tools.identify ? run('magick', ['-version']).out.split('\n')[0] : 'missing',
    webpinfo: tools.webpinfo ? 'libwebp webpinfo' : 'missing',
    unzip: tools.unzip ? run('unzip', ['-v']).out.split('\n')[0] : 'missing',
  },
  files: rows.length,
  problems,
  rows,
};
writeFileSync(join(OUT, 'cross-check.json'), JSON.stringify(report, null, 1));
for (const r of rows)
  console.log(
    [r.name, `${r.bytes} B`, r.sips, r.identify?.join(' | '), r.webpinfo, r.unzip, r.zipinfoTotal]
      .filter(Boolean)
      .join(' — '),
  );
console.log(`\n${rows.length} files, ${problems.length} problems${problems.length ? `:\n${problems.join('\n')}` : ''}`);
process.exit(problems.length ? 1 : 0);
