#!/usr/bin/env node
// Measures the tool history in the built extension, in Chrome for Testing without a window: the real IndexedDB store
// (extension/src/history/idbStore.ts), the real factory and archive (@workspace/tools-shared/history), run inside an
// extension page — the same origin, the same database the app uses — and the History page with that data.
//   1. 10 000 records written one by one through the factory (each with its own small blob), then listed;
//   2. a history of about 100 MB with blobs: export to a file, delete everything, restore, compare byte for byte;
//      the page's JS heap is sampled meanwhile (Chrome's performance.memory).
// Not part of pnpm test:e2e (it takes a minute and writes 100 MB). Usage:
//   node scripts/history-measure.mjs [<dist>] [--json=<file>]

/* global document, indexedDB, IDBKeyRange -- page.evaluate callbacks run in the page */

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const DIST = resolve(argv.find(a => !a.startsWith('--')) ?? join(ROOT, 'dist'));
const JSON_OUT = resolve(
  argv.find(a => a.startsWith('--json='))?.slice(7) ?? join(ROOT, '.state/history-measure.json'),
);
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '.state/extension-e2e/browsers');
const { chromium } = createRequire(join(ROOT, '.state/e2e/node/package.json'))('playwright');
const esbuild = createRequire(createRequire(join(ROOT, 'extension/package.json')).resolve('vite'))('esbuild');

const bundle = (
  await esbuild.build({
    stdin: {
      contents: `
        import { idbStore } from ${JSON.stringify(join(ROOT, 'extension/src/history/idbStore.ts'))};
        import * as h from ${JSON.stringify(join(ROOT, 'packages/tools/logic/shared/history/index.ts'))};
        globalThis.__measure = { idbStore, ...h };
      `,
      resolveDir: join(ROOT, 'extension/src/history'),
      loader: 'ts',
    },
    bundle: true,
    write: false,
    format: 'iife',
    platform: 'browser',
    logLevel: 'silent',
  })
).outputFiles[0].text;

mkdirSync(join(ROOT, '.state/e2e/profiles'), { recursive: true });
const profile = mkdtempSync(join(ROOT, '.state/e2e/profiles/measure-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--lang=en-US',
    '--enable-precise-memory-info',
  ],
  viewport: { width: 1440, height: 900 },
});
const out = { dist: DIST, at: new Date().toISOString() };
try {
  let [sw] = ctx.serviceWorkers();
  sw ??= await ctx.waitForEvent('serviceworker');
  const base = `chrome-extension://${new URL(sw.url()).host}/src/app/index.html`;
  const page = await ctx.newPage();
  await page.goto(`${base}#/settings`);
  await page.evaluate(bundle);
  out.browser = ctx.browser()?.version() ?? null;

  // 1. 10 000 records, one write each, through the factory.
  out.records10k = await page.evaluate(async () => {
    const m = globalThis.__measure;
    const store = m.idbStore({ factory: indexedDB, keyRange: IDBKeyRange }, 'tool-history');
    const factory = m.createHistoryFactory({ store, cipher: m.noCipher });
    const declaration = { kinds: [{ id: 'result', title: 'Result' }], schema: 1, records: '', never: '' };
    const owners = ['json', 'base64', 'url', 'jwt'];
    const histories = owners.map(o => factory.forOwner(o, declaration));
    const recorders = histories.map(h => h.session());
    const times = [];
    const t0 = performance.now();
    for (let i = 0; i < 10_000; i++) {
      const text = `{"n": ${i}, "pad": "${'x'.repeat(200 + (i % 300))}"}`;
      const s = performance.now();
      const r = await recorders[i % 4].commit({
        kind: 'result',
        payload: { i, indent: 2 },
        label: `Entry ${i}`,
        text: text.slice(0, 120),
        blobs: { input: new Blob([text], { type: 'application/json' }) },
      });
      times.push(performance.now() - s);
      if (!r.recorded) throw new Error(`not recorded: ${r.reason}`);
    }
    const total = performance.now() - t0;
    times.sort((a, b) => a - b);
    const q = p => +times[Math.floor(times.length * p)].toFixed(2);
    const timed = async fn => {
      const s = performance.now();
      const v = await fn();
      return { ms: +(performance.now() - s).toFixed(1), v };
    };
    const firstPage = await timed(() => store.page({}, { limit: 100 }));
    const owner = await timed(() => store.page({ owners: ['jwt'] }, { limit: 100 }));
    const text = await timed(() => store.page({ text: 'entry 9999' }, { limit: 100 }));
    const measure = await timed(() => store.measure({}));
    const range = await timed(() => store.measure({ from: Date.now() - 10_000, to: Date.now() }));
    const stats = await timed(() => store.stats());
    return {
      writeTotalMs: +total.toFixed(0),
      writeEachMs: { p50: q(0.5), p90: q(0.9), p99: q(0.99), max: +times.at(-1).toFixed(1) },
      listFirst100Ms: firstPage.ms,
      listOneOwner100Ms: owner.ms,
      listTextFilterMs: text.ms,
      textMatches: text.v.rows.length,
      measureAllMs: measure.ms,
      measureLast10sMs: range.ms,
      statsMs: stats.ms,
      stats: stats.v,
    };
  });
  // The History page over those 10 000 records: from navigation to the count on screen.
  const t = Date.now();
  await page.goto(`${base}#/history`);
  await page.waitForFunction(
    () => document.querySelector('[data-history-count]')?.getAttribute('data-history-count') === '10000',
    null,
    { timeout: 60_000 },
  );
  out.records10k.historyPageReadyMs = Date.now() - t;
  await page.evaluate(bundle);
  out.records10k.deleteAllMs = await page.evaluate(async () => {
    const store = globalThis.__measure.idbStore({ factory: indexedDB, keyRange: IDBKeyRange }, 'tool-history');
    const s = performance.now();
    await store.delete({});
    return +(performance.now() - s).toFixed(0);
  });

  // 2. About 100 MB with blobs: export, delete everything, restore, compare.
  out.archive100mb = await page.evaluate(async () => {
    const m = globalThis.__measure;
    const store = m.idbStore({ factory: indexedDB, keyRange: IDBKeyRange }, 'tool-history');
    const factory = m.createHistoryFactory({ store, cipher: m.noCipher });
    const declaration = {
      kinds: [
        { id: 'image', title: 'Image' },
        { id: 'text', title: 'Text' },
      ],
      schema: 1,
      records: '',
      never: '',
    };
    const recorder = factory.forOwner('qr', declaration).session();
    const heap = [];
    const sample = setInterval(() => heap.push(performance.memory?.usedJSHeapSize ?? 0), 50);
    const mb = n => +(n / 1024 / 1024).toFixed(1);
    // 300 binary blobs of 256 KiB (incompressible, like images) and 300 text blobs of ~80 KiB (compressible).
    for (let i = 0; i < 300; i++) {
      const bin = new Uint8Array(256 * 1024);
      for (let j = 0; j < bin.length; j += 65536) crypto.getRandomValues(bin.subarray(j, j + 65536));
      await recorder.commit({
        kind: 'image',
        payload: { i },
        label: `Image ${i}`,
        blobs: { image: new Blob([bin], { type: 'image/png' }) },
      });
      const text = Array.from({ length: 1600 }, (_, k) => `line ${k} of text ${i}: lorem ipsum dolor sit amet`).join(
        '\n',
      );
      await recorder.commit({
        kind: 'text',
        payload: { i },
        label: `Text ${i}`,
        text: text.slice(0, 200),
        blobs: { text: new Blob([text], { type: 'text/plain' }) },
      });
    }
    const stats = await store.stats();
    const dump = async () => {
      const lines = [];
      const digests = [];
      for await (const row of store.scan({})) {
        lines.push(row.line);
        for (const h of row.blobs) {
          const b = await store.blob(h);
          digests.push(
            `${h}:${m.toHex(new Uint8Array(await crypto.subtle.digest('SHA-256', await b.data.arrayBuffer())))}`,
          );
        }
      }
      return JSON.stringify([lines, digests.sort()]);
    };
    const before = await dump();
    const heapBefore = performance.memory?.usedJSHeapSize ?? 0;
    heap.length = 0;
    let s = performance.now();
    const file = await new Response(
      m.zipArchive.write(store, {}, { producer: { name: 'measure', version: '0' }, now: Date.now() }),
    ).blob();
    const exportMs = performance.now() - s;
    const exportPeak = Math.max(...heap);
    await store.delete({});
    heap.length = 0;
    s = performance.now();
    const inspection = await m.zipArchive.inspect(file);
    const inspectMs = performance.now() - s;
    s = performance.now();
    const report = await m.zipArchive.restore(store, inspection, {});
    const restoreMs = performance.now() - s;
    const importPeak = Math.max(...heap);
    clearInterval(sample);
    const after = await dump();
    return {
      history: { records: stats.records, blobs: stats.blobs, mb: mb(stats.recordBytes + stats.blobBytes) },
      fileMb: mb(file.size),
      exportMs: +exportMs.toFixed(0),
      inspectMs: +inspectMs.toFixed(0),
      restoreMs: +restoreMs.toFixed(0),
      restored: report.added,
      byteIdentical: before === after,
      heapMb: { beforeExport: mb(heapBefore), exportPeak: mb(exportPeak), importPeak: mb(importPeak) },
    };
  });
} finally {
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
}
mkdirSync(dirname(JSON_OUT), { recursive: true });
writeFileSync(JSON_OUT, JSON.stringify(out, null, 2) + '\n');
console.log(JSON.stringify(out, null, 2));
