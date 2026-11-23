// The Image Converter in the built extension (docs/tools/specs/image-convert.md): its scenarios (§2) with the page's real
// controls, and what only Chrome can tell — run by scripts/e2e-tools.mjs. Names: 'Image Converter: …'; screenshots
// tool-image-convert-NN-….
//
// - Pictures are made here, in code (a photo-like gradient with noise, flat interface colours with text, a transparent
//   icon, a zone plate), by the page's own canvas or by a small PNG writer below; nothing is downloaded or taken from
//   the machine. They reach the tool through its file input, as a person's choice does.
// - Every result is saved through the page's Save (a download) and decoded again in the page: PNG and lossless WebP are
//   compared with the source pixel by pixel, JPEG and WebP by PSNR, resizing against an exact area average. The saved
//   files stay in .state/e2e/image-convert-out/ for the cross-check with the machine's programs
//   (packages/tools/logic/image-convert/scripts/cross-check.mjs).
// - SVG is hostile input: scripts, handlers, external images, an external stylesheet, @import, a foreignObject — no
//   request leaves the extension (Playwright, CDP, a route for reserved names), no script runs (a canary).
// - Odd inputs: a lying extension, a truncated file, a header claiming 30,000 × 30,000, animated GIF, CMYK JPEG, 16-bit
//   PNG, AVIF, ICO, HEIC, 1 × 1, 16,384 × 1, 65,535 × 1, 65,536 × 1.
// - Large inputs (§12): a 50-megapixel JPEG, 20 files at once, icons from a 4,096 px source, 50 conversions in a row —
//   time, the page's longest task, the memory of the browser's processes, object URLs made and revoked.
// - History (D17), saved parameters (D21), light and dark screenshots; what the start page opens for a pasted image or
//   SVG text. Navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, window, location, OffscreenCanvas, createImageBitmap, DataTransfer, ClipboardEvent
   -- page.evaluate callbacks run in the pages */

import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import {
  forgetSavedParameters,
  historyRecords,
  inDarkTheme,
  settledShot,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Image Converter';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.state/e2e/image-convert-out');
const INVALID = /^(?:https?|wss?):\/\/[^/?#]*\.invalid(?:[:/?#]|$)/;

// ---- A small PNG writer (8- or 16-bit RGBA) and CRC-32 for its chunks
const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = buf => {
  let c = 0xffffffff;
  for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const head = Buffer.alloc(4);
  head.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const tail = Buffer.alloc(4);
  tail.writeUInt32BE(crc32(body));
  return Buffer.concat([head, body, tail]);
};
const PNG_SIGNATURE = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
/** A PNG of `w × h`; `px(x, y)` → [r, g, b, a]; `depth` 16 doubles each byte. */
const png = (w, h, px, depth = 8) => {
  const bpp = depth === 16 ? 8 : 4;
  const raw = Buffer.alloc((w * bpp + 1) * h);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const at = y * (w * bpp + 1) + 1 + x * bpp;
      const [r, g, b, a] = px(x, y);
      raw.set(depth === 16 ? [r, r, g, g, b, b, a, a] : [r, g, b, a], at);
    }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = depth;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** The header a decompression bomb shows: an IHDR claiming a size, and a tiny IDAT. */
const pngClaim = (w, h) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  return Buffer.concat([
    PNG_SIGNATURE,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc(4096))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** An APP1 EXIF segment: an orientation, and a GPS IFD with a latitude reference (what a phone writes). */
const exifApp1 = orientation => {
  const gps = 8 + 2 + 2 * 12 + 4;
  const t = Buffer.alloc(gps + 2 + 12 + 4);
  t.write('MM', 0, 'latin1');
  t.writeUInt16BE(42, 2);
  t.writeUInt32BE(8, 4);
  t.writeUInt16BE(2, 8);
  t.writeUInt16BE(0x0112, 10); // Orientation, SHORT
  t.writeUInt16BE(3, 12);
  t.writeUInt32BE(1, 14);
  t.writeUInt16BE(orientation, 18);
  t.writeUInt16BE(0x8825, 22); // GPS IFD pointer, LONG
  t.writeUInt16BE(4, 24);
  t.writeUInt32BE(1, 26);
  t.writeUInt32BE(gps, 30);
  t.writeUInt32BE(0, 34);
  t.writeUInt16BE(1, gps); // GPSLatitudeRef 'N'
  t.writeUInt16BE(0x0001, gps + 2);
  t.writeUInt16BE(2, gps + 4);
  t.writeUInt32BE(2, gps + 6);
  t.write('N\0', gps + 10, 'latin1');
  const body = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), t]);
  const head = Buffer.from([0xff, 0xe1, 0, 0]);
  head.writeUInt16BE(body.length + 2, 2);
  return Buffer.concat([head, body]);
};
/** A two-image ICO of PNGs (16 and 32), written here — not by the tool. */
const ico2 = (a, b) => {
  const dir = Buffer.alloc(6 + 32);
  dir.writeUInt16LE(1, 2);
  dir.writeUInt16LE(2, 4);
  [
    [16, a],
    [32, b],
  ].forEach(([size, data], i) => {
    const at = 6 + 16 * i;
    dir[at] = size;
    dir[at + 1] = size;
    dir.writeUInt16LE(1, at + 4);
    dir.writeUInt16LE(32, at + 6);
    dir.writeUInt32LE(data.length, at + 8);
    dir.writeUInt32LE(38 + (i ? a.length : 0), at + 12);
  });
  return Buffer.concat([dir, a, b]);
};
// Tiny images ImageMagick converted from an 8 × 8 / 8 × 4 gradient this repository wrote (the logic's
// src/testing/fixtures.ts): an animated GIF of two frames, a CMYK JPEG, an AVIF, a HEIC.
const FIXTURES = JSON.parse(
  readFileSync(join(ROOT, 'packages/tools/logic/image-convert/src/testing/fixtures.json'), 'utf8'),
);
const fixture = name => Buffer.from(FIXTURES[name], 'base64');

/** The RSS of this run's Chrome for Testing processes (its own throwaway profile), in MiB; null where ps says nothing. */
const browserRss = () => {
  try {
    const out = execFileSync('ps', ['-A', '-o', 'rss=,command='], { encoding: 'utf8' });
    const kib = out
      .split('\n')
      .filter(line => line.includes('Google Chrome for Testing') && line.includes('e2e/profiles/run-'))
      .reduce((sum, line) => sum + Number(line.trim().split(/\s+/)[0] || 0), 0);
    return kib ? Math.round(kib / 1024) : null;
  } catch {
    return null;
  }
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const facts = (report.imageConvert = {});
  // `new URL(base).origin` is "null" in Node for a chrome-extension: address: built from the extension's id.
  const extensionOrigin = base.split('/').slice(0, 3).join('/');
  const outsideOf = url => !url.startsWith(extensionOrigin) && !url.startsWith('blob:') && !url.startsWith('data:');

  // ---- Every request outside the extension: Playwright, CDP, and a route for reserved names
  const outside = [];
  const onRequest = r => outsideOf(r.url()) && outside.push(r.url());
  ctx.on('request', onRequest);
  const routed = [];
  await ctx.route(INVALID, route => {
    routed.push(route.request().url());
    return route.fulfill({ status: 404, body: '' });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpOutside = [];
  const onCdp = e => outsideOf(e.request.url) && cdpOutside.push(e.request.url);
  cdp.on('Network.requestWillBeSent', onCdp);

  // ---- Helpers
  const toolUrl = `${base}#/tools/image-convert`;
  const go = async url => {
    if (page.url().split('#')[0] === base.split('#')[0]) await page.evaluate(u => location.replace(u), url);
    else await page.goto(url);
    await page.waitForFunction(h => location.hash === h, new URL(url).hash, { timeout: 5_000 });
  };
  const button = name => page.getByRole('button', { name, exact: true });
  const radio = name => page.getByRole('radio', { name, exact: true });
  const fileInput = () => page.locator('input[type="file"]').first();
  /** How many times a click in a list had to be made again (reported with the loop of 50 conversions). */
  let chooseRetries = 0;
  const choose = async (label, option) => {
    // A click on an option has been seen to hang once in the full run, in the loop that opens the list a hundred
    // times; a second attempt is counted and shown rather than hidden.
    for (let attempt = 0; ; attempt++) {
      try {
        if ((await page.getByRole('listbox').count()) === 0)
          await page.getByLabel(label, { exact: true }).click({ timeout: 5_000 });
        await page.getByRole('option', { name: option, exact: true }).click({ timeout: 5_000 });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        chooseRetries++;
        await page.keyboard.press('Escape');
      }
    }
    await page.getByRole('listbox').waitFor({ state: 'detached' });
  };
  const setNumber = (label, value) => page.getByLabel(label, { exact: true }).fill(String(value));
  const sourceRows = () => page.locator('[data-part="sources"] li');
  const resultRows = () => page.locator('[data-part="results"] li');
  const waitRows = (selector, n, timeout = 30_000) =>
    page.waitForFunction(([s, k]) => document.querySelectorAll(s).length >= k, [selector, n], { timeout });
  const add = async files => {
    const before = await sourceRows().count();
    await fileInput().setInputFiles(files);
    await waitRows('[data-part="sources"] li', before + files.length);
  };
  const clear = async () => {
    await button('Clear').click();
    await page.waitForFunction(() => !document.querySelector('[data-part="sources"]'));
  };
  /** Presses Convert and waits for `n` result rows and the end of the work. */
  const convert = async (n, timeout = 60_000) => {
    await button('Convert').click();
    await page.waitForFunction(
      k =>
        document.querySelectorAll('[data-part="results"] li').length >= k &&
        !document.body.textContent.includes('Converting '),
      n,
      { timeout },
    );
  };
  const rowText = name => page.locator(`[data-result="${name}"]`).innerText();
  /** A row's facts line: the line after its name. */
  const factsOf = text => text.split('\n').filter(Boolean)[1] ?? '';
  const sourceText = name => page.locator(`[data-source="${name}"]`).first().innerText();
  /** Saves one row's file through its Save and returns its bytes (kept in OUT for the cross-check). */
  const save = async (name, as = name) => {
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 30_000 }),
      page.getByRole('button', { name: `Save ${name}`, exact: true }).click(),
    ]);
    const path = join(OUT, as);
    await file.saveAs(path);
    return { name: file.suggestedFilename(), bytes: readFileSync(path), path };
  };
  const saveAll = async as => {
    const [file] = await Promise.all([
      page.waitForEvent('download', { timeout: 60_000 }),
      button('Save all (.zip)').click(),
    ]);
    const path = join(OUT, as);
    await file.saveAs(path);
    return { name: file.suggestedFilename(), bytes: readFileSync(path), path };
  };

  /** The picture makers and the comparison, in the page (they live as long as its document). */
  const installMakers = () =>
    page.evaluate(() => {
      if (window.__icMake) return;
      let seed = 12345;
      const rnd = () => (seed = (seed * 1103515245 + 12345) >>> 0) / 4294967296;
      const draw = {
        photo: (g, w, h) => {
          const d = g.createImageData(w, h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const n = (rnd() - 0.5) * 40;
              d.data[i] = 128 + 100 * Math.sin(x / 97) + n;
              d.data[i + 1] = 90 + 80 * Math.cos(y / 61) + n;
              d.data[i + 2] = 60 + 60 * Math.sin((x + y) / 151) + n;
              d.data[i + 3] = 255;
            }
          g.putImageData(d, 0, 0);
        },
        ui: (g, w, h) => {
          g.fillStyle = '#f4f5f7';
          g.fillRect(0, 0, w, h);
          g.fillStyle = '#2b5fd9';
          g.fillRect(0, 0, w, Math.round(h * 0.06));
          for (let k = 0; k < 12; k++) {
            g.fillStyle = k % 2 ? '#ffffff' : '#e6e9ef';
            g.fillRect(24, 72 + k * 44, w - 48, 40);
            g.fillStyle = '#1d2330';
            g.font = '16px sans-serif';
            g.fillText(`Row ${k + 1}: The quick brown fox jumps over the lazy dog 0123456789`, 36, 98 + k * 44);
          }
        },
        icon: (g, w, h) => {
          g.clearRect(0, 0, w, h);
          g.fillStyle = '#e8590c';
          g.beginPath();
          g.arc(w / 2, h / 2, Math.min(w, h) * 0.42, 0, Math.PI * 2);
          g.fill();
          g.fillStyle = 'rgba(255,255,255,0.9)';
          g.beginPath();
          g.moveTo(w * 0.38, h * 0.3);
          g.lineTo(w * 0.72, h * 0.5);
          g.lineTo(w * 0.38, h * 0.7);
          g.closePath();
          g.fill();
        },
        zone: (g, w, h) => {
          const d = g.createImageData(w, h);
          for (let y = 0; y < h; y++)
            for (let x = 0; x < w; x++) {
              const i = (y * w + x) * 4;
              const dx = x - w / 2;
              const dy = y - h / 2;
              const v = 127.5 + 127.5 * Math.cos((Math.PI * (dx * dx + dy * dy)) / w);
              d.data[i] = d.data[i + 1] = d.data[i + 2] = v;
              d.data[i + 3] = 255;
            }
          g.putImageData(d, 0, 0);
        },
        halves: (g, w, h) => {
          g.fillStyle = '#ff0000';
          g.fillRect(0, 0, w / 2, h);
          g.fillStyle = '#0000ff';
          g.fillRect(w / 2, 0, w / 2, h);
        },
      };
      window.__icSources = {};
      window.__icMake = async (key, kind, w, h, type = 'image/png', quality) => {
        seed = 12345;
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        draw[kind](g, w, h);
        if (w * h <= 1_100_000) window.__icSources[key] = { w, h, data: g.getImageData(0, 0, w, h).data };
        const blob = await c.convertToBlob(quality === undefined ? { type } : { type, quality });
        c.width = 0;
        return blob;
      };
      window.__icB64 = async blob => {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return btoa(s);
      };
      window.__icMakeB64 = async (...args) => window.__icB64(await window.__icMake(...args));
      /** Files made in the page put into the tool's file input as a person's choice (no copy through the test). */
      window.__icChoose = async files => {
        const input = document.querySelector('input[type="file"]');
        const dt = new DataTransfer();
        for (const f of files) dt.items.add(f);
        input.files = dt.files;
        input.dispatchEvent(new Event('change', { bubbles: true }));
      };
      window.__icPixels = async (b64, points) => {
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
        const c = new OffscreenCanvas(bitmap.width, bitmap.height);
        const g = c.getContext('2d', { willReadFrequently: true });
        g.drawImage(bitmap, 0, 0);
        const out = { w: bitmap.width, h: bitmap.height };
        bitmap.close();
        for (const [name, x, y] of points) out[name] = Array.from(g.getImageData(x, y, 1, 1).data);
        return out;
      };
      /** Decodes bytes and compares them with a kept source: differences by kind of pixel, and PSNR. */
      window.__icCompare = async (b64, key, options = {}) => {
        const src = window.__icSources[key];
        const bitmap = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
        const w = bitmap.width;
        const h = bitmap.height;
        const c = new OffscreenCanvas(w, h);
        const g = c.getContext('2d');
        g.drawImage(bitmap, 0, 0);
        bitmap.close();
        const got = g.getImageData(0, 0, w, h).data;
        if (!src) return { w, h };
        let ref = src.data;
        if (src.w !== w || src.h !== h) {
          if (options.reference !== 'box') return { w, h, mismatch: 'size' };
          // the exact area average of the source at the result's size
          const out = new Float64Array(w * h * 4);
          const sx = src.w / w;
          const sy = src.h / h;
          for (let ty = 0; ty < h; ty++)
            for (let tx = 0; tx < w; tx++) {
              const acc = [0, 0, 0, 0];
              let area = 0;
              const x0 = tx * sx;
              const y0 = ty * sy;
              for (let y = Math.floor(y0); y < Math.ceil(y0 + sy); y++) {
                const wy = Math.min(y + 1, y0 + sy) - Math.max(y, y0);
                for (let x = Math.floor(x0); x < Math.ceil(x0 + sx); x++) {
                  const wx = Math.min(x + 1, x0 + sx) - Math.max(x, x0);
                  const i = (y * src.w + x) * 4;
                  for (let k = 0; k < 4; k++) acc[k] += src.data[i + k] * wx * wy;
                  area += wx * wy;
                }
              }
              for (let k = 0; k < 4; k++) out[(ty * w + tx) * 4 + k] = acc[k] / area;
            }
          ref = out;
        } else if (options.background) {
          // the source composited on the background, as a JPEG must be
          const bg = [1, 3, 5].map(i => parseInt(options.background.slice(i, i + 2), 16));
          ref = new Float64Array(src.data.length);
          for (let i = 0; i < src.data.length; i += 4) {
            const a = src.data[i + 3] / 255;
            for (let k = 0; k < 3; k++) ref[i + k] = src.data[i + k] * a + bg[k] * (1 - a);
            ref[i + 3] = 255;
          }
        }
        let se = 0;
        let n = 0;
        let maxOpaque = 0;
        let alphaPixels = 0;
        let alphaOff = 0;
        let alphaOver = 0;
        let transparentColour = 0;
        let worst = null;
        let alphaMax = 0;
        let alphaOverStep = 0;
        for (let i = 0; i < got.length; i += 4) {
          const a = Math.round(ref[i + 3]);
          if (Math.abs(got[i + 3] - ref[i + 3]) > 0.5) alphaOff++;
          if (a > 0 && a < 255) alphaPixels++;
          for (let k = 0; k < 3; k++) {
            const e = got[i + k] - ref[i + k];
            if (a === 255) {
              maxOpaque = Math.max(maxOpaque, Math.abs(e));
              se += e * e;
              n++;
              // premultiplied storage: a colour step of 255 / α; half of it may be lost to rounding
            } else if (a > 0) {
              const over = Math.abs(e) - Math.ceil(127.5 / a);
              if (over > alphaOver) worst = { error: Math.round(Math.abs(e)), alpha: a };
              alphaOver = Math.max(alphaOver, over);
              alphaMax = Math.max(alphaMax, Math.abs(e));
              alphaOverStep = Math.max(alphaOverStep, Math.abs(e) - Math.ceil(255 / a));
            } else if (got[i + k] !== 0) transparentColour++;
          }
        }
        const psnr = se === 0 ? Infinity : 10 * Math.log10((255 * 255) / (se / n));
        return {
          w,
          h,
          maxOpaque: Math.round(maxOpaque * 100) / 100,
          alphaPixels,
          alphaOff,
          alphaOver,
          alphaMax: Math.round(alphaMax),
          alphaOverStep,
          worst,
          transparentColour,
          psnr: Number.isFinite(psnr) ? Number(psnr.toFixed(2)) : 'exact',
        };
      };
    });
  const make = (key, kind, w, h, type, quality) =>
    page.evaluate(a => window.__icMakeB64(...a), [key, kind, w, h, type, quality]).then(s => Buffer.from(s, 'base64'));
  const compare = (bytes, key, options) =>
    page.evaluate(([b, k, o]) => window.__icCompare(b, k, o), [bytes.toString('base64'), key, options]);
  const pixels = (bytes, points) =>
    page.evaluate(([b, p]) => window.__icPixels(b, p), [bytes.toString('base64'), points]);
  const longTasks = {
    start: () =>
      page.evaluate(() => {
        window.__icLong = [];
        window.__icObserver?.disconnect();
        window.__icObserver = new PerformanceObserver(list => {
          for (const e of list.getEntries()) window.__icLong.push(Math.round(e.duration));
        });
        window.__icObserver.observe({ type: 'longtask' });
      }),
    stop: () =>
      page.evaluate(() => {
        window.__icObserver?.disconnect();
        return Math.max(0, ...window.__icLong);
      }),
  };
  const exact = r => r.maxOpaque === 0;

  // ---- §9 / D16: nothing of the tool on the start route; its field finds it
  const chunk = url => /\/assets\/(ImageConvertTool|convert\.worker)-[^/]+\.js$/.exec(url)?.[1] ?? null;
  {
    const start = await ctx.newPage();
    const loaded = [];
    start.on('request', r => chunk(r.url()) && loaded.push(chunk(r.url())));
    await start.goto(base);
    const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await start.waitForLoadState('networkidle');
    const firsts = {};
    for (const query of ['png to jpg', 'favicon', 'svg to png']) {
      await field.fill(query);
      await sleep(200);
      firsts[query] = (await start.getByRole('option').first().innerText()).split('\n')[0];
    }
    check(
      `${T}: nothing of the tool on the start route; its field finds it by "png to jpg", "favicon", "svg to png"`,
      loaded.length === 0 && Object.values(firsts).every(f => f.includes(T)),
      `loaded ${JSON.stringify(loaded)}; ${JSON.stringify(firsts)}`,
    );
    await start.close();
  }

  // ---- Open the tool
  await go(toolUrl);
  // "Loading…" until the tool's history is open: wait for the tool's own element.
  await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
  await installMakers();
  await page.evaluate(() => {
    window.__icViolations = [];
    document.addEventListener('securitypolicyviolation', e =>
      window.__icViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
    const live = new Set();
    window.__icUrls = { live, made: 0, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = blob => {
      const url = window.__icUrls.create.call(URL, blob);
      live.add(url);
      window.__icUrls.made++;
      return url;
    };
    URL.revokeObjectURL = url => {
      live.delete(url);
      return window.__icUrls.revoke.call(URL, url);
    };
  });
  const urls = () => page.evaluate(() => ({ live: window.__icUrls.live.size, made: window.__icUrls.made }));
  await settledShot(shoot, page, 'tool-image-convert-01-empty.png');

  // ---- PNG → PNG exact; with alpha within the premultiplication bound; WebP lossless exact; JPEG and WebP by PSNR
  {
    await add([
      { name: 'photo.png', mimeType: 'image/png', buffer: await make('photo', 'photo', 320, 200) },
      { name: 'icon.png', mimeType: 'image/png', buffer: await make('icon', 'icon', 128, 128) },
    ]);
    await convert(2);
    const a = await compare((await save('photo.png', 'png-photo.png')).bytes, 'photo');
    const b = await compare((await save('icon.png', 'png-icon.png')).bytes, 'icon');
    facts.png = { photo: a, icon: b };
    check(
      `${T}: PNG → PNG — the photo's pixels exact (320 × 200); the transparent icon's opaque pixels and alpha exact, the colours of its ${b.alphaPixels} half-transparent pixels within ±⌈127.5 / α⌉, transparent ones 0,0,0`,
      a.w === 320 && a.h === 200 && exact(a) && exact(b) && b.alphaOff === 0 && b.alphaOver <= 0,
      JSON.stringify(facts.png),
    );
    await settledShot(shoot, page, 'tool-image-convert-02-converted.png');

    await choose('Format', 'WebP');
    await page.getByLabel('Lossless', { exact: true }).click();
    await convert(2);
    const losslessFile = await save('photo.webp', 'webp-lossless-photo.webp');
    const l = await compare(losslessFile.bytes, 'photo');
    const li = await compare((await save('icon.webp', 'webp-lossless-icon.webp')).bytes, 'icon');
    await page.getByLabel('Lossless', { exact: true }).click();
    await convert(2);
    const webpFile = await save('photo.webp', 'webp-80-photo.webp');
    const w80 = await compare(webpFile.bytes, 'photo');
    await save('icon.webp', 'webp-80-icon.webp');
    await choose('Format', 'JPEG');
    await convert(2);
    const jpegFile = await save('photo.jpg', 'jpeg-85-photo.jpg');
    const j85 = await compare(jpegFile.bytes, 'photo');
    const jIcon = await compare((await save('icon.jpg', 'jpeg-85-icon.jpg')).bytes, 'icon', { background: '#ffffff' });
    const alphaNote = await page
      .getByText('JPEG has no transparency: transparent areas are filled with the background colour.', { exact: true })
      .count();
    facts.lossy = {
      lossless: l,
      losslessIcon: li,
      webp80: w80,
      jpeg85: j85,
      jpegIcon: jIcon,
      bytes: { lossless: losslessFile.bytes.length, webp80: webpFile.bytes.length, jpeg85: jpegFile.bytes.length },
    };
    check(
      `${T}: WebP Lossless — the photo exact; the transparent icon's opaque pixels and alpha exact, its half-transparent colours within one step of premultiplied storage, ±⌈255 / α⌉ (worst ${li.worst ? `${li.worst.error} at α ${li.worst.alpha}` : 'none'}); on the photo WebP 80 ${w80.psnr} dB and JPEG 85 ${j85.psnr} dB (bound: ≥ 30 dB); JPEG fills the icon's transparency with white (${jIcon.psnr} dB against the icon on white) and says so`,
      exact(l) &&
        exact(li) &&
        li.alphaOff === 0 &&
        li.alphaOverStep <= 0 &&
        w80.psnr >= 30 &&
        j85.psnr >= 30 &&
        jIcon.psnr >= 28 &&
        alphaNote >= 1,
      JSON.stringify(facts.lossy),
    );
    await settledShot(shoot, page, 'tool-image-convert-03-jpeg-options.png');
    await clear();
  }

  // ---- Resize: width, percent, the three fits; never enlarged silently; halving near an exact area average
  {
    await choose('Format', 'PNG');
    await add([
      { name: 'zone.png', mimeType: 'image/png', buffer: await make('zone', 'zone', 1024, 1024) },
      { name: 'wide.png', mimeType: 'image/png', buffer: await make('wide', 'photo', 400, 300) },
    ]);
    await choose('Size', 'Width');
    await setNumber('Width', 128);
    await convert(2);
    const zone = await compare((await save('zone.png', 'resize-zone-128.png')).bytes, 'zone', { reference: 'box' });
    const wide = await compare((await save('wide.png', 'resize-wide-128.png')).bytes, 'wide', { reference: 'box' });
    await setNumber('Width', 800);
    await convert(2);
    const notEnlarged = await rowText('wide.png');
    await page.getByLabel('Allow enlarging', { exact: true }).click();
    await convert(2);
    const enlarged = await rowText('wide.png');
    await page.getByLabel('Allow enlarging', { exact: true }).click();
    await choose('Size', 'Width and height');
    await setNumber('Width', 100);
    await setNumber('Height', 100);
    const fits = {};
    for (const fit of ['Fit inside', 'Fill and crop', 'Stretch']) {
      await choose('Fit', fit);
      await convert(2);
      fits[fit] = factsOf(await rowText('wide.png'));
    }
    await choose('Size', 'Percentage');
    await setNumber('Percentage', 25);
    await convert(2);
    const percent = factsOf(await rowText('wide.png'));
    facts.resize = { zone, wide, notEnlarged, enlarged, fits, percent };
    check(
      `${T}: resize — a zone plate 1,024 → 128 by halves ${zone.psnr} dB against an exact area average (one draw: about 15 dB, §12), the photo 400 → 128 ${wide.psnr} dB; Width 800 on 400 × 300 not enlarged and said; with "Allow enlarging" 800 × 600 and said; 100 × 100 — Fit inside 100 × 75, Fill and crop and Stretch 100 × 100; 25 % — 100 × 75`,
      zone.w === 128 &&
        zone.psnr >= 40 &&
        wide.psnr >= 35 &&
        notEnlarged.includes('PNG · 400 × 300') &&
        notEnlarged.includes('Not enlarged: the image is 400 × 300. Tick “Allow enlarging” to make it larger.') &&
        enlarged.includes('PNG · 800 × 600') &&
        enlarged.includes('Enlarged from 400 × 300: enlarging adds no detail.') &&
        fits['Fit inside'].startsWith('PNG · 100 × 75') &&
        fits['Fill and crop'].startsWith('PNG · 100 × 100') &&
        fits.Stretch.startsWith('PNG · 100 × 100') &&
        percent.startsWith('PNG · 100 × 75'),
      JSON.stringify(facts.resize),
    );
    await choose('Size', 'Original size');
    await clear();
  }

  // ---- EXIF: the browser turns the photo upright; the result carries no EXIF, no GPS
  {
    const plain = await make('halves', 'halves', 40, 20, 'image/jpeg', 0.95);
    const withExif = Buffer.concat([plain.subarray(0, 2), exifApp1(6), plain.subarray(2)]);
    await add([{ name: 'IMG_2041.jpg', mimeType: 'image/jpeg', buffer: withExif }]);
    const listed = await sourceText('IMG_2041.jpg');
    await convert(1);
    const out = await save('IMG_2041.png', 'exif-upright.png');
    const seen = await pixels(out.bytes, [
      ['top', 10, 5],
      ['bottom', 10, 35],
    ]);
    const text = out.bytes.toString('latin1');
    facts.exif = { listed, seen, carriesExif: /Exif|eXIf|GPS/.test(text), inputHadGps: withExif.includes('N\0') };
    check(
      `${T}: EXIF orientation 6 — listed 20 × 40 with its note; the result is 20 × 40, red on top (turned upright by the browser), and carries no EXIF, no GPS`,
      listed.includes('JPEG · 20 × 40') &&
        listed.includes('EXIF orientation 6: turned upright; the result carries no orientation.') &&
        seen.w === 20 &&
        seen.h === 40 &&
        seen.top[0] > 200 &&
        seen.top[2] < 60 &&
        seen.bottom[2] > 200 &&
        !facts.exif.carriesExif,
      JSON.stringify(facts.exif),
    );
    await clear();
  }

  // ---- SVG: the hostile set — drawn as images, no request, no script; foreignObject refused; sizes from the text
  {
    const canary =
      "try{window.__icPwned=1;parent.__icPwned=1;top.__icPwned=1}catch(e){};try{localStorage.setItem('icPwned','1')}catch(e){};" +
      "try{fetch('https://canary.invalid/fetch')}catch(e){};try{new Image().src='https://canary.invalid/img'}catch(e){}";
    const svgs = {
      'script.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><script>${canary}</script><rect width="40" height="20" fill="#00ff00"/></svg>`,
      'onload.svg': `<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20" onload="${canary.replaceAll('"', '&quot;')}"><rect width="40" height="20" fill="#00ff00"/></svg>`,
      'external-image.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="40" height="20"><rect width="40" height="20" fill="#00ff00"/><image href="https://images.invalid/a.png" width="40" height="20"/><image xlink:href="//images.invalid/b.png" width="40" height="20"/></svg>',
      'external-style.svg':
        '<?xml-stylesheet href="https://styles.invalid/a.css" type="text/css"?><svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><style>@import url(https://styles.invalid/b.css); rect { fill: url(https://styles.invalid/c.svg#p) #00ff00; }</style><rect width="40" height="20"/></svg>',
      'foreign.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" width="40" height="20"><foreignObject width="40" height="20"><div xmlns="http://www.w3.org/1999/xhtml">hi<img src="https://images.invalid/c.png"/></div></foreignObject></svg>',
      'nosize.svg': '<svg xmlns="http://www.w3.org/2000/svg"><rect width="300" height="150" fill="#00ff00"/></svg>',
      'viewbox.svg':
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><circle cx="12" cy="12" r="10" fill="#e8590c"/></svg>',
    };
    await add(
      Object.entries(svgs).map(([name, text]) => ({ name, mimeType: 'image/svg+xml', buffer: Buffer.from(text) })),
    );
    const listed = {};
    for (const name of Object.keys(svgs)) listed[name] = await sourceText(name);
    await choose('Size', 'Width');
    await setNumber('Width', 512);
    await convert(6);
    const rows = {};
    for (const name of Object.keys(svgs).filter(n => n !== 'foreign.svg'))
      rows[name] = factsOf(await rowText(name.replace('.svg', '.png')));
    const vb = await pixels((await save('viewbox.png', 'svg-viewbox-512.png')).bytes, [
      ['centre', 256, 256],
      ['corner', 2, 2],
    ]);
    const drawn = await pixels((await save('script.png', 'svg-script-512.png')).bytes, [['centre', 256, 128]]);
    await sleep(500);
    const pwned = await page.evaluate(() => ({
      window: window.__icPwned ?? null,
      local: localStorage.getItem('icPwned'),
    }));
    facts.svg = { listed, rows, vb, drawn, pwned, routed: [...routed], outside: [...outside] };
    check(
      `${T}: SVG hostile set — scripts, onload, external images, an external stylesheet and @import drawn as images 512 px wide; no request outside the extension (${outside.length}, routed ${routed.length}), no script effect; foreignObject refused in words; no size — 300 × 150 and said; viewBox only — 24 × 24 drawn at 512 × 512`,
      listed['foreign.svg'].includes(
        'This SVG cannot be rasterised here: Chrome does not let a page read pixels drawn from a foreignObject.',
      ) &&
        listed['script.svg'].includes('SVG · 40 × 20') &&
        listed['script.svg'].includes('This SVG contains scripts or external references.') &&
        listed['nosize.svg'].includes('SVG · 300 × 150') &&
        listed['nosize.svg'].includes('This SVG has no size of its own') &&
        listed['viewbox.svg'].includes('SVG · 24 × 24') &&
        rows['script.svg'].startsWith('PNG · 512 × 256') &&
        rows['external-style.svg'].startsWith('PNG · 512 × 256') &&
        rows['nosize.svg'].startsWith('PNG · 512 × 256') &&
        vb.w === 512 &&
        vb.h === 512 &&
        vb.centre[0] > 200 &&
        vb.corner[3] === 0 &&
        drawn.centre[1] > 200 &&
        drawn.centre[0] < 50 &&
        pwned.window === null &&
        pwned.local === null &&
        outside.length === 0 &&
        routed.length === 0,
      JSON.stringify(facts.svg),
    );
    await choose('Size', 'Original size');
    await clear();
  }

  // ---- Odd inputs
  {
    const files = [
      { name: 'photo.png', mimeType: 'image/png', buffer: await make('lie', 'photo', 32, 16, 'image/jpeg', 0.9) },
      { name: 'truncated.png', mimeType: 'image/png', buffer: (await make('t', 'photo', 64, 64)).subarray(0, 300) },
      { name: 'bomb.png', mimeType: 'image/png', buffer: pngClaim(30000, 30000) },
      { name: 'animated.gif', mimeType: 'image/gif', buffer: fixture('anim.gif') },
      { name: 'cmyk.jpg', mimeType: 'image/jpeg', buffer: fixture('g-cmyk.jpg') },
      { name: 'deep.png', mimeType: 'image/png', buffer: png(16, 16, (x, y) => [x * 16, y * 16, 200, 255], 16) },
      { name: 'still.avif', mimeType: 'image/avif', buffer: fixture('g.avif') },
      {
        name: 'two.ico',
        mimeType: 'image/x-icon',
        buffer: ico2(
          png(16, 16, () => [255, 0, 0, 255]),
          png(32, 32, () => [0, 0, 255, 255]),
        ),
      },
      { name: 'phone.heic', mimeType: 'image/heic', buffer: fixture('g.heic') },
      { name: 'dot.png', mimeType: 'image/png', buffer: png(1, 1, () => [10, 20, 30, 255]) },
      { name: 'wide16k.png', mimeType: 'image/png', buffer: png(16384, 1, x => [x % 256, 0, 0, 255]) },
      { name: 'wide64k.png', mimeType: 'image/png', buffer: png(65535, 1, x => [x % 256, 0, 0, 255]) },
      { name: 'wider.png', mimeType: 'image/png', buffer: png(65536, 1, x => [x % 256, 0, 0, 255]) },
    ];
    const rssBefore = browserRss();
    await add(files);
    const listed = {};
    for (const f of files) listed[f.name] = await sourceText(f.name);
    await convert(11, 120_000);
    const rssAfter = browserRss();
    const rows = {};
    for (const name of [
      'photo.png',
      'truncated.png',
      'animated.png',
      'cmyk.png',
      'deep.png',
      'still.png',
      'two.png',
      'dot.png',
      'wide16k.png',
      'wide64k.png',
      'wider.png',
    ])
      rows[name] = await rowText(name).catch(() => null);
    const two = await pixels((await save('two.png', 'odd-two.png')).bytes, [['p', 0, 0]]);
    for (const name of ['animated.png', 'cmyk.png', 'deep.png', 'still.png', 'dot.png'])
      await save(name, `odd-${name}`).catch(() => null);
    facts.odd = { listed, rows, two, rssBefore, rssAfter };
    check(
      `${T}: odd inputs — JPEG bytes named .png read as JPEG; a header claiming 30,000 × 30,000 refused before decoding; HEIC named and refused; a truncated PNG fails in words; an animated GIF (first frame), CMYK JPEG, 16-bit PNG, AVIF, a two-image ICO (${two.w} × ${two.h} decoded), 1 × 1, 16,384 × 1 and 65,535 × 1 converted; 65,536 × 1 refused at the canvas's bound; this browser's processes ${rssBefore} → ${rssAfter} MiB around the batch with the bomb`,
      listed['photo.png'].includes('JPEG · 32 × 16') &&
        listed['bomb.png'].includes(
          'The image says it is 30,000 × 30,000 pixels (900 megapixels), more than the 100 megapixels this tool decodes.',
        ) &&
        listed['phone.heic'].includes('HEIC images cannot be decoded by Chrome; this tool does not accept them.') &&
        listed['animated.gif'].includes('Animated image: only the first frame is converted.') &&
        listed['cmyk.jpg'].includes('CMYK JPEG: converted to RGB.') &&
        listed['deep.png'].includes('16-bit PNG: converted to 8 bits per channel.') &&
        rows['photo.png']?.includes('PNG · 32 × 16') &&
        rows['truncated.png']?.includes('The image could not be decoded: the file may be damaged or truncated.') &&
        rows['animated.png']?.includes('PNG · 8 × 4') &&
        rows['cmyk.png']?.includes('PNG · 8 × 8') &&
        rows['deep.png']?.includes('PNG · 16 × 16') &&
        rows['still.png']?.includes('PNG · 8 × 8') &&
        rows['two.png']?.includes('ICO with 2 images') &&
        rows['dot.png']?.includes('PNG · 1 × 1') &&
        rows['wide16k.png']?.includes('PNG · 16,384 × 1') &&
        rows['wide64k.png']?.includes('PNG · 65,535 × 1') &&
        rows['wider.png']?.includes('wider or taller than 65,535 pixels'),
      JSON.stringify(facts.odd),
    );
    await clear();
  }

  // ---- Large (§12): a 50-megapixel JPEG to WebP 2,000 px wide; 20 files at once
  {
    const madeIn = await page.evaluate(async () => {
      const t0 = performance.now();
      window.__icBig = await window.__icMake('big', 'photo', 8660, 5774, 'image/jpeg', 0.9);
      return { ms: Math.round(performance.now() - t0), bytes: window.__icBig.size };
    });
    await sleep(1000);
    // measured once the test's own picture is made: what follows is the tool's
    const rssBefore = browserRss();
    await page.evaluate(() => window.__icChoose([new File([window.__icBig], 'big.jpg', { type: 'image/jpeg' })]));
    await waitRows('[data-part="sources"] li', 1);
    await choose('Format', 'WebP');
    await choose('Size', 'Width');
    await setNumber('Width', 2000);
    let peak = rssBefore;
    const sampler = setInterval(() => {
      const now = browserRss();
      if (now !== null && (peak === null || now > peak)) peak = now;
    }, 200);
    await longTasks.start();
    const t0 = Date.now();
    await convert(1, 180_000);
    const ms = Date.now() - t0;
    const longest = await longTasks.stop();
    clearInterval(sampler);
    const row = await rowText('big.webp');
    await page.evaluate(() => delete window.__icBig);
    facts.big = { madeIn, ms, longest, rssBefore, peak, row };
    check(
      `${T}: §12 a 50-megapixel JPEG (8,660 × 5,774, ${madeIn.bytes.toLocaleString('en-US')} bytes) → WebP 2,000 px wide in ${ms} ms; the page's longest task ${longest} ms (the work is in the worker); this browser's processes ${rssBefore} → peak ${peak} MiB`,
      row.includes('WebP · 2,000 × 1,333') && longest < 200,
      JSON.stringify(facts.big),
    );
    await clear();

    await page.evaluate(async () => {
      const files = [];
      for (let i = 0; i < 20; i++)
        files.push(
          new File(
            [await window.__icMake(`f${i}`, i % 2 ? 'ui' : 'photo', 2000, 1500, 'image/jpeg', 0.9)],
            `shot-${i + 1}.jpg`,
            { type: 'image/jpeg' },
          ),
        );
      await window.__icChoose(files);
    });
    await waitRows('[data-part="sources"] li', 20, 60_000);
    await choose('Size', 'Original size');
    await longTasks.start();
    const t1 = Date.now();
    await convert(20, 240_000);
    const ms20 = Date.now() - t1;
    const longest20 = await longTasks.stop();
    const zip = await saveAll('images.zip');
    facts.twenty = { ms: ms20, longest: longest20, zipBytes: zip.bytes.length, name: zip.name };
    check(
      `${T}: §12 20 JPEGs of 2,000 × 1,500 → WebP 80 in ${ms20} ms, the page's longest task ${longest20} ms; Save all — ${zip.name}, ${zip.bytes.length.toLocaleString('en-US')} bytes`,
      (await resultRows().count()) === 20 &&
        zip.name === 'images.zip' &&
        zip.bytes.readUInt32LE(0) === 0x04034b50 &&
        longest20 < 200,
      JSON.stringify(facts.twenty),
    );
    await clear();
  }

  // ---- 50 conversions in a row: object URLs come back to what they were; memory does not grow
  {
    await choose('Format', 'PNG');
    const before = await urls();
    await add([{ name: 'loop.png', mimeType: 'image/png', buffer: await make('loop', 'photo', 1000, 750) }]);
    const rss = [];
    for (let i = 0; i < 50; i++) {
      await choose('Format', i % 2 ? 'WebP' : 'JPEG');
      await convert(1);
      if (i === 4 || i === 49) rss.push(browserRss());
    }
    await clear();
    await sleep(300);
    const after = await urls();
    facts.loop = { before, after, rss, chooseRetries };
    check(
      `${T}: 50 conversions in a row — ${after.made - before.made} object URLs made, ${after.live} live after Clear (before: ${before.live}); this browser's processes ${rss[0]} MiB after 5, ${rss[1]} MiB after 50`,
      after.live === before.live && (rss[0] === null || rss[1] - rss[0] < 300),
      JSON.stringify(facts.loop),
    );
  }

  // ---- Icons: from a 4,096 px source, every size and set; the .ico and the .zip saved for the cross-check
  {
    await radio('Icons').click();
    await page.locator('[data-part="icons-options"]').waitFor();
    for (const size of ['64', '128', '256']) await page.getByLabel(size, { exact: true }).click();
    for (const set of ['Extension', 'PWA']) await page.getByLabel(set, { exact: true }).click();
    await page.evaluate(async () =>
      window.__icChoose([
        new File([await window.__icMake('icon4k', 'icon', 4096, 4096)], 'logo.png', { type: 'image/png' }),
      ]),
    );
    await page.locator('[data-part="sources"] li').waitFor();
    await longTasks.start();
    const t0 = Date.now();
    await button('Make icons').click();
    await page.locator('[data-part="results"] li[data-result="icon-512.png"]').waitFor({ timeout: 120_000 });
    const ms = Date.now() - t0;
    const longest = await longTasks.stop();
    const names = await page.locator('[data-part="results"] li').evaluateAll(lis => lis.map(li => li.dataset.result));
    const ico = await save('favicon.ico', 'favicon-png.ico');
    const png16 = await save('favicon-16x16.png', 'favicon-16x16.png');
    for (const name of ['icon128.png', 'apple-touch-icon.png', 'icon-512.png']) await save(name, `icons-${name}`);
    const zip = await saveAll('icons.zip');
    const markup = await page.locator('#image-convert-markup').inputValue();
    const directory = Array.from({ length: ico.bytes.readUInt16LE(4) }, (_, i) => ({
      size: ico.bytes[6 + 16 * i] || 256,
      bytes: ico.bytes.readUInt32LE(6 + 16 * i + 8),
      offset: ico.bytes.readUInt32LE(6 + 16 * i + 12),
    }));
    const first = directory[0];
    const same = Boolean(first) && ico.bytes.subarray(first.offset, first.offset + first.bytes).equals(png16.bytes);
    const chromeIco = await pixels(ico.bytes, []);
    await settledShot(shoot, page, 'tool-image-convert-04-icons.png');
    await choose('ICO images', 'BMP up to 48 px, PNG above');
    await button('Make icons').click();
    await page.locator('[data-part="results"] li[data-result="favicon.ico"]').waitFor();
    await sleep(300);
    const bmpIco = await save('favicon.ico', 'favicon-bmp.ico');
    const bmpDirectory = Array.from({ length: bmpIco.bytes.readUInt16LE(4) }, (_, i) => {
      const offset = bmpIco.bytes.readUInt32LE(6 + 16 * i + 12);
      return { size: bmpIco.bytes[6 + 16 * i] || 256, dib: bmpIco.bytes.readUInt32LE(offset) === 40 };
    });
    const bmpChrome = await pixels(bmpIco.bytes, []);
    await choose('ICO images', 'PNG');
    facts.icons = {
      ms,
      longest,
      names,
      directory,
      same,
      chromeIco,
      bmpChrome,
      zipBytes: zip.bytes.length,
      bmpDirectory,
    };
    check(
      `${T}: icons from a 4,096 px PNG — favicon.ico (16–256) and the Favicon, Extension and PWA sets in ${ms} ms, the page's longest task ${longest} ms; the .ico's 16 px image is byte for byte favicon-16x16.png; Chrome decodes both .ico forms (${chromeIco.w} × ${chromeIco.h}, ${bmpChrome.w} × ${bmpChrome.h}); BMP entries for 16, 32, 48; icons.zip and the markup`,
      JSON.stringify(names) ===
        JSON.stringify([
          'favicon.ico',
          'favicon-16x16.png',
          'favicon-32x32.png',
          'apple-touch-icon.png',
          'icon16.png',
          'icon32.png',
          'icon48.png',
          'icon128.png',
          'icon-192.png',
          'icon-512.png',
        ]) &&
        JSON.stringify(directory.map(d => d.size)) === JSON.stringify([16, 32, 48, 64, 128, 256]) &&
        same &&
        chromeIco.w > 0 &&
        bmpChrome.w > 0 &&
        JSON.stringify(bmpDirectory.map(d => d.dib)) === JSON.stringify([true, true, true, false, false, false]) &&
        markup.includes('"128": "icon128.png"') &&
        longest < 200,
      JSON.stringify(facts.icons),
    );
    // an SVG source, drawn at each size
    await fileInput().setInputFiles({
      name: 'logo.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 24"><rect width="48" height="24" fill="#2b5fd9"/></svg>',
      ),
    });
    await page.locator('[data-source="logo.svg"]').waitFor();
    await button('Make icons').click();
    await page.locator('[data-part="icon-notes"]').waitFor();
    await sleep(300);
    const svgNotes = await page.locator('[data-part="icon-notes"]').innerText();
    const svgIcon = await pixels((await save('icon-512.png', 'svg-icon-512.png')).bytes, [
      ['middle', 256, 256],
      ['top', 256, 10],
    ]);
    facts.svgIcons = { svgNotes, svgIcon };
    check(
      `${T}: icons from an SVG — drawn at each size (512 × 512), not square: centred on a transparent square and said`,
      svgIcon.w === 512 &&
        svgIcon.middle[2] > 200 &&
        svgIcon.top[3] === 0 &&
        svgNotes.includes('The image is not square: it is centred on a transparent square.'),
      JSON.stringify(facts.svgIcons),
    );
    for (const set of ['Extension', 'PWA']) await page.getByLabel(set, { exact: true }).click();
    for (const size of ['64', '128', '256']) await page.getByLabel(size, { exact: true }).click();
    await button('Clear').click();
    await radio('Convert').click();
    await page.locator('[data-part="convert-options"]').waitFor();
  }

  // ---- History (D17): an entry per Convert — parameters and facts, never the picture or its name; opens back
  {
    await choose('Format', 'JPEG');
    await setNumber('Quality', 70);
    await add([{ name: 'secret-scan.png', mimeType: 'image/png', buffer: await make('h', 'ui', 300, 200) }]);
    await convert(1);
    const record = await waitForHistoryRecord(
      page,
      'image-convert',
      r => r.kind === 'convert' && r.payload?.format === 'jpeg' && r.payload?.quality === 70,
    ).catch(() => null);
    const records = await historyRecords(page, 'image-convert');
    const keeping = await page
      .locator('[data-part="keeping"]')
      .innerText()
      .catch(() => '');
    await choose('Format', 'PNG');
    const historyPage = await ctx.newPage();
    await historyPage.goto(`${base}#/history`);
    await historyPage.locator('[data-page="history"]').waitFor();
    const entry = historyPage.locator('.kit-history-entry[data-kind="convert"]').first();
    await entry.waitFor();
    await entry.getByRole('button', { name: 'Open' }).click();
    await historyPage.locator('[data-restored]').waitFor();
    const reopened = {
      restored: await historyPage.locator('[data-restored]').innerText(),
      format: await historyPage.getByLabel('Format', { exact: true }).innerText(),
      quality: await historyPage.getByLabel('Quality', { exact: true }).inputValue(),
    };
    await historyPage.close();
    facts.history = { record, count: records.length, reopened, keeping };
    check(
      `${T}: history — Convert writes one entry with the parameters and the image's type and sizes, never its pixels or name; it opens back with JPEG 70 and says the images are not kept`,
      record !== null &&
        (record.blobs ?? []).length === 0 &&
        !JSON.stringify(records).includes('secret-scan') &&
        record.payload.files?.[0]?.type === 'PNG' &&
        keeping.startsWith('Kept in the history:') &&
        reopened.restored.endsWith('The images are not kept: choose them again.') &&
        reopened.format === 'JPEG' &&
        reopened.quality === '70',
      JSON.stringify(facts.history),
    );
    await clear();
  }

  // ---- Saved parameters (D21): changed, reopened — as left
  {
    await choose('Format', 'WebP');
    await setNumber('Quality', 64);
    await choose('Size', 'Percentage');
    await setNumber('Percentage', 50);
    await sleep(800);
    await page.reload();
    await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
    const after = {
      format: await page.getByLabel('Format', { exact: true }).innerText(),
      quality: await page.getByLabel('Quality', { exact: true }).inputValue(),
      percent: await page.getByLabel('Percentage', { exact: true }).inputValue(),
    };
    check(
      `${T}: saved parameters — WebP 64 at 50 % chosen, the page reloaded: as left`,
      after.format === 'WebP' && after.quality === '64' && after.percent === '50',
      JSON.stringify(after),
    );
    await installMakers();
  }

  // ---- Screenshots, light and dark
  {
    await add([
      { name: 'screen.png', mimeType: 'image/png', buffer: await make('s1', 'ui', 960, 600) },
      { name: 'logo.png', mimeType: 'image/png', buffer: await make('s2', 'icon', 256, 256) },
    ]);
    await convert(2);
    await settledShot(shoot, page, 'tool-image-convert-05-webp-percent.png');
    await inDarkTheme(ctx, base, page, async () => {
      await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
      await settledShot(shoot, page, 'tool-image-convert-06-dark.png');
    });
    await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
    if (await page.locator('[data-part="sources"]').count()) await clear();
  }

  // ---- The start page: what a pasted image or SVG text opens (every tool's detect, in registry order)
  {
    const start = await ctx.newPage();
    const opens = {};
    const pasteInto = async (kind, fill, arg) => {
      await start.goto(`${base}#/start`);
      const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
      await field.waitFor();
      await start.waitForLoadState('networkidle');
      await field.focus();
      await start.evaluate(fill, arg);
      await start.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 3_000 }).catch(() => {});
      opens[kind] = await start.evaluate(() => location.hash);
    };
    const pasteText = text => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    };
    await pasteInto('image file', async () => {
      const c = new OffscreenCanvas(4, 4);
      c.getContext('2d').fillRect(0, 0, 4, 4);
      const data = new DataTransfer();
      data.items.add(new File([await c.convertToBlob()], 'image.png', { type: 'image/png' }));
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    await pasteInto('SVG text', pasteText, svg);
    await pasteInto('SVG with an XML declaration', pasteText, `<?xml version="1.0" encoding="UTF-8"?>\n${svg}`);
    await pasteInto(
      'PNG data URI',
      pasteText,
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC',
    );
    await start.close();
    facts.startPage = opens;
    check(
      `${T}: the start page — a pasted image file opens nothing (the field takes text only); pasted SVG text opens ${opens['SVG text'] || 'nothing'}, with an XML declaration ${opens['SVG with an XML declaration'] || 'nothing'}; a PNG data URI ${opens['PNG data URI']} — this tool has no detect`,
      !opens['image file'].startsWith('#/tools/') && opens['PNG data URI'] === '#/tools/base64-image',
      JSON.stringify(opens),
    );
  }

  // ---- The whole module
  const violations = await page.evaluate(() => window.__icViolations ?? []).catch(() => []);
  check(
    `${T}: the whole module — no request outside the extension (Playwright ${outside.length}, CDP ${cdpOutside.length}), none routed (${routed.length}), no policy violation (${violations.length})`,
    outside.length === 0 && cdpOutside.length === 0 && routed.length === 0 && violations.length === 0,
    JSON.stringify({
      outside: outside.slice(0, 5),
      cdp: cdpOutside.slice(0, 5),
      routed: routed.slice(0, 5),
      violations,
    }),
  );
  writeFileSync(join(OUT, 'facts.json'), JSON.stringify(facts, null, 1));

  await forgetSavedParameters(page, 'image-convert');
  ctx.off('request', onRequest);
  cdp.off('Network.requestWillBeSent', onCdp);
  await cdp.detach().catch(() => {});
  await ctx.unroute(INVALID);
  await page.evaluate(url => location.replace(url), `${base}#/tools`);
};
