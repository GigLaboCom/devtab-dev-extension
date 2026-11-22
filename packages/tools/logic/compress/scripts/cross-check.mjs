// The tool's work against independent implementations already on this machine (docs/tools/specs/compress.md §10, row
// 33): the engine of this package runs in Chrome for Testing — the browser's own CompressionStream and
// DecompressionStream, the zstd and brotli modules the workers carry — and every result is checked by another program:
// Apple's gzip/gunzip, Python's zlib, gzip and compression.zstd, the zstd command, Node's brotli. Both ways: what the
// tool compresses the others decompress to the input, what the others compress the tool decompresses to the input.
// Inputs: seeded random sizes from 0 bytes to several MiB, of zeros, text and random bytes.
//
// Not part of `pnpm check`: it needs the test browser (bash scripts/e2e-setup.sh) and those programs, installs nothing
// and skips what is missing. Run from the repository: node packages/tools/logic/compress/scripts/cross-check.mjs
/* global window -- page.evaluate callbacks run in the page */
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import zlib from 'node:zlib';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../..');
const require = createRequire(join(ROOT, 'node_modules/.pnpm/node_modules/vite/package.json'));
const esbuild = require('esbuild');
const { chromium } = await import(join(ROOT, '.state/e2e/node/node_modules/playwright/index.mjs'));
const browsers = join(ROOT, '.state/extension-e2e/browsers');
const chromiumDir = readdirSync(browsers).find(d => d.startsWith('chromium-'));
const exe = join(
  browsers,
  chromiumDir,
  'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing',
);

const has = (cmd, args) => spawnSync(cmd, args, { stdio: 'ignore' }).status === 0;
const PY = has('python3', ['-c', 'import zlib, gzip']) ? 'python3' : null;
const PY_ZSTD = PY && has(PY, ['-c', 'import compression.zstd']);
const GZIP = has('gzip', ['--version']);
const ZSTD = has('zstd', ['--version']);
const version = (cmd, args) =>
  (spawnSync(cmd, args).stdout?.toString() || spawnSync(cmd, args).stderr?.toString() || '').trim().split('\n')[0];

// ---- The engine and the codecs, bundled for the page as the workers have them.
const bundle = await esbuild.build({
  stdin: {
    contents: `
      import { run, createCollector, bytesSource } from '@workspace/tool-logic-compress';
      import { compress } from 'brotli/compress';
      window.tool = { run, createCollector, bytesSource, brotliCompress: async (b, q) => compress(b, { quality: q }) };`,
    resolveDir: join(ROOT, 'packages/tools/ui/compress'),
    loader: 'ts',
  },
  bundle: true,
  format: 'iife',
  write: false,
  platform: 'browser',
});
const uiRequire = createRequire(join(ROOT, 'packages/tools/ui/compress/package.json'));
const wasm = {
  zstd: readFileSync(uiRequire.resolve('@tootallnate/zstd-wasm/zstd.wasm')).toString('base64'),
  brotli: readFileSync(uiRequire.resolve('@tootallnate/brotli-wasm/brotli.wasm')).toString('base64'),
};

const browser = await chromium.launch({ executablePath: exe, headless: true });
const page = await browser.newPage();
await page.goto('about:blank');
await page.addScriptTag({ content: bundle.outputFiles[0].text });
await page.evaluate(w => {
  const bytes = b64 => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
  window.codecs = {
    zstd: async () => bytes(w.zstd),
    brotliDecoder: async () => bytes(w.brotli),
    brotliCompress: window.tool.brotliCompress,
  };
}, wasm);

/** The tool's work in Chrome: bytes in, bytes out (or the page's message). */
const tool = (direction, format, input, level) => {
  if (process.env.TRACE) console.error(`tool ${direction} ${format} ${level ?? ''} ${input.length}`);
  return page
    .evaluate(
      async ([direction, format, b64, level]) => {
        const input = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const sink = window.tool.createCollector(Infinity, 1);
        const job = { direction, format, ...(level !== undefined ? { level } : {}) };
        const outcome = await window.tool.run(job, window.tool.bytesSource(input), sink, { codecs: window.codecs });
        if (!outcome.ok) return { error: outcome.message };
        const out = sink.result().bytes;
        let s = '';
        for (let i = 0; i < out.length; i += 0x8000) s += String.fromCharCode(...out.subarray(i, i + 0x8000));
        return { b64: btoa(s) };
      },
      [direction, format, Buffer.from(input).toString('base64'), level],
    )
    .then(r => (r.error ? { error: r.error } : { bytes: Buffer.from(r.b64, 'base64') }));
};

// Input through a file, not stdin: a child reading stdin hung once in a few hundred runs (spawnSync on this machine).
const TMP = mkdtempSync(join(tmpdir(), 'compress-cross-'));
const IN = join(TMP, 'in');
const viaFile = (cmd, args, input) => {
  writeFileSync(IN, input);
  return execFileSync(cmd, [...args, IN], { maxBuffer: 1 << 30, stdio: ['ignore', 'pipe', 'pipe'] });
};
const py = (code, input) => viaFile(PY, ['-I', '-c', code], input);
const PY_IN = 'import sys,zlib,gzip;d=open(sys.argv[1],"rb").read();';
const others = {
  gzip: {
    decompress: [
      GZIP && ['gunzip', b => viaFile('gunzip', ['-c'], b)],
      PY && ['python gzip', b => py(`${PY_IN}sys.stdout.buffer.write(gzip.decompress(d))`, b)],
    ],
    compress: [
      GZIP && ['gzip -9', b => viaFile('gzip', ['-c', '-9'], b)],
      GZIP && ['gzip -1', b => viaFile('gzip', ['-c', '-1'], b)],
      PY && ['python gzip', b => py(`${PY_IN}sys.stdout.buffer.write(gzip.compress(d,mtime=0))`, b)],
    ],
  },
  zlib: {
    decompress: [PY && ['python zlib', b => py(`${PY_IN}sys.stdout.buffer.write(zlib.decompress(d))`, b)]],
    compress: [
      PY && ['python zlib 1', b => py(`${PY_IN}sys.stdout.buffer.write(zlib.compress(d,1))`, b)],
      PY && ['python zlib 9', b => py(`${PY_IN}sys.stdout.buffer.write(zlib.compress(d,9))`, b)],
    ],
  },
  'deflate-raw': {
    decompress: [PY && ['python zlib raw', b => py(`${PY_IN}sys.stdout.buffer.write(zlib.decompress(d,-15))`, b)]],
    compress: [
      PY && [
        'python zlib raw',
        b => py(`${PY_IN}c=zlib.compressobj(9,zlib.DEFLATED,-15);sys.stdout.buffer.write(c.compress(d)+c.flush())`, b),
      ],
    ],
  },
  zstd: {
    decompress: [
      ZSTD && ['zstd -d', b => viaFile('zstd', ['-dcq'], b)],
      PY_ZSTD && [
        'python zstd',
        b =>
          py(
            'import sys;from compression import zstd;sys.stdout.buffer.write(zstd.decompress(open(sys.argv[1],"rb").read()))',
            b,
          ),
      ],
    ],
    compress: [
      ZSTD && ['zstd -19', b => viaFile('zstd', ['-cq', '-19'], b)],
      ZSTD && ['zstd -1 --long', b => viaFile('zstd', ['-cq', '-1', '--long=24'], b)],
      PY_ZSTD && [
        'python zstd',
        b =>
          py(
            'import sys;from compression import zstd;sys.stdout.buffer.write(zstd.compress(open(sys.argv[1],"rb").read()))',
            b,
          ),
      ],
    ],
  },
  brotli: {
    decompress: [['node brotli', b => zlib.brotliDecompressSync(b)]],
    compress: [
      ['node brotli 5', b => zlib.brotliCompressSync(b, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 5 } })],
      ['node brotli 11', b => zlib.brotliCompressSync(b)],
    ],
  },
};

// ---- Inputs: a seeded generator, so a failure can be run again.
let seed = 0x5eed1234;
const next = () => ((seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0), seed);
const WORDS = 'the quick brown fox jumps over a lazy dog log line request user id status ok error'.split(' ');
const make = (kind, size) => {
  if (kind === 'zeros') return Buffer.alloc(size);
  if (kind === 'random') return Buffer.from(Uint8Array.from({ length: size }, () => next() & 255));
  const parts = [];
  let n = 0;
  while (n < size) {
    const w = WORDS[next() % WORDS.length] + (next() % 9 ? ' ' : '\n');
    parts.push(w);
    n += w.length;
  }
  return Buffer.from(parts.join('')).subarray(0, size);
};
const SIZES = [0, 1, 2, 3, 100, 1000, 32768, 65535, 65536, 65537, 1 << 20, 3 << 20, 6 << 20];
const KINDS = ['zeros', 'text', 'random'];
const levels = { zstd: [1, 3, 19], brotli: [1, 11] };

const counts = {};
const failures = [];
const note = (name, ok, detail) => {
  counts[name] = (counts[name] ?? 0) + 1;
  if (!ok) failures.push(`${name}: ${detail}`);
};

for (const size of SIZES)
  for (const kind of KINDS) {
    if (size === 0 && kind !== 'zeros') continue;
    const input = make(kind, size);
    for (const [format, tools] of Object.entries(others)) {
      for (const level of levels[format] ?? [undefined]) {
        if (format === 'brotli' && level === 11 && size > 1 << 20) continue; // quality 11 ≈ 0.1 MB/s
        const mine = await tool('compress', format, input, level);
        if (mine.error) {
          // The brotli library's output failed the tool's own round-trip check: refused, not handed out (§15).
          if (/^The brotli encoder failed/.test(mine.error))
            note(`tool ${format} ${level} refused (encoder check)`, true, '');
          else note(`tool ${format} compress`, false, mine.error);
          continue;
        }
        for (const entry of tools.decompress.filter(Boolean)) {
          const [name, decompress] = entry;
          let back;
          try {
            back = decompress(mine.bytes);
          } catch (e) {
            back = Buffer.from(`(failed: ${e.message.slice(0, 80)})`);
          }
          note(
            `tool ${format}${level !== undefined ? ` ${level}` : ''} → ${name}`,
            Buffer.compare(back, input) === 0,
            `${kind} ${size}`,
          );
        }
      }
      for (const entry of tools.compress.filter(Boolean)) {
        const [name, compress] = entry;
        if (/brotli 11/.test(name) && size > 1 << 20) continue;
        const theirs = compress(input);
        const back = await tool('decompress', format, theirs);
        note(
          `${name} → tool`,
          !back.error && Buffer.compare(back.bytes, input) === 0,
          `${kind} ${size}: ${back.error ?? 'different bytes'}`,
        );
        if (format !== 'brotli' && format !== 'deflate-raw') {
          const auto = await tool('decompress', 'auto', theirs);
          note(
            `${name} → tool (Auto)`,
            !auto.error && Buffer.compare(auto.bytes, input) === 0,
            `${kind} ${size}: ${auto.error ?? 'different bytes'}`,
          );
        }
      }
    }
  }

await browser.close();
rmSync(TMP, { recursive: true, force: true });
const total = Object.values(counts).reduce((a, b) => a + b, 0);
console.log(`Chrome for Testing ${browser.version()}`);
console.log(
  `gzip: ${GZIP ? version('gzip', ['--version']) : 'missing'}; python: ${PY ? version(PY, ['--version']) : 'missing'} (zlib ${PY ? execFileSync(PY, ['-c', 'import zlib;print(zlib.ZLIB_RUNTIME_VERSION)']).toString().trim() : '-'}${PY_ZSTD ? `, zstd ${execFileSync(PY, ['-c', 'from compression import zstd;print(zstd.zstd_version)']).toString().trim()}` : ''}); zstd: ${ZSTD ? version('zstd', ['--version']) : 'missing'}; node ${process.versions.node} (brotli ${process.versions.brotli})`,
);
for (const [name, n] of Object.entries(counts)) console.log(`${String(n).padStart(4)}  ${name}`);
console.log(`${total} comparisons, ${failures.length} failed`);
for (const f of failures.slice(0, 40)) console.log(`  FAIL ${f}`);
process.exit(failures.length ? 1 : 0);
