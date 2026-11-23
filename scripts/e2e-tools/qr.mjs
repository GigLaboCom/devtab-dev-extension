// The QR Code tool in the built extension (docs/tools/specs/qr.md): its scenarios (§2) with the page's real controls,
// and what only the browser can tell — run by scripts/e2e-tools.mjs. Names: 'QR Code: …'; screenshots tool-qr-NN-….
//
// - Loading (§9, §11): nothing of the tool on the start route; opening the tool loads its component only; the encoder
//   (`maker-*.js`) comes with the first code, the reader (`read.worker-*.js`, a module worker) with the first image.
// - Drawing under the extension's policy (§5.4–§5.6): the code is SVG elements (no `<img>`), its screenshot is read by
//   jsQR (an independent reader, a development dependency of the logic package); the saved SVG and PNG are read back by
//   jsQR and by the tool itself through its file input; an SVG file is read through `<img src="blob:…">`; JPEG, a drop and
//   a paste (synthetic events carrying a File — a real ⌘V would read the machine's clipboard); the preview is a canvas
//   with the image's pixels; `securitypolicyviolation` is listened for throughout.
// - A 12-megapixel photo with a small code: read in the worker; the page's longest frame meanwhile is measured.
// - Copy image: `navigator.clipboard.write` is replaced in the page by a stand-in that takes the ClipboardItem and reads
//   its PNG — no clipboard is written, neither the browser's nor the machine's. Copy text: the same through
//   stubClipboard. Both stand-ins are put back before the module ends.
// - History (D17): a code of text is kept in clear; Wi-Fi details are kept only encrypted, with a throwaway master
//   password made here (never printed), not opened while locked, opened back unlocked, and the master password is
//   turned off again at the end (its entries go with it). The Wi-Fi details are invented.

/* global chrome, document, window, location, requestAnimationFrame, OffscreenCanvas, createImageBitmap, indexedDB,
   DataTransfer, ClipboardEvent, DragEvent, Image -- page.evaluate callbacks run in the pages */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'QR Code';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.state/e2e/qr');
const requireLogic = createRequire(join(ROOT, 'packages/tools/logic/qr/package.json'));
const jsqrModule = requireLogic('jsqr');
const jsQR = typeof jsqrModule === 'function' ? jsqrModule : jsqrModule.default;
// Invented details only.
const WIFI = {
  ssid: 'Example;Lab',
  password: 'quiet:river\\42',
  string: 'WIFI:T:WPA;S:Example\\;Lab;P:quiet\\:river\\\\42;H:true;;',
};

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const chunk = url => {
  const m = /\/assets\/(QrTool|maker|read\.worker)-[^/]+\.js$/.exec(url);
  return m ? m[1] : null;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const facts = (report.qr = {});
  const opened = [];
  const open = async (hash = '') => {
    const p = await ctx.newPage();
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  /** A blank page (no extension policy) for the independent checks: decoding PNGs, rasterizing SVG, making photos. */
  const blank = await ctx.newPage();
  const rgbaOf = async (bytes, type) => {
    const { width, height, b64 } = await blank.evaluate(
      async ([data, mime]) => {
        const blob = new Blob([Uint8Array.from(atob(data), c => c.charCodeAt(0))], { type: mime });
        let source;
        if (mime === 'image/svg+xml') {
          const img = new Image();
          img.src = URL.createObjectURL(blob);
          await img.decode();
          source = img;
        } else source = await createImageBitmap(blob);
        const w = source.naturalWidth || source.width;
        const h = source.naturalHeight || source.height;
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext('2d');
        g.fillStyle = '#fff';
        g.fillRect(0, 0, w, h);
        g.drawImage(source, 0, 0, w, h);
        const px = g.getImageData(0, 0, w, h).data;
        let s = '';
        for (let i = 0; i < px.length; i += 0x8000) s += String.fromCharCode(...px.subarray(i, i + 0x8000));
        return { width: w, height: h, b64: btoa(s) };
      },
      [Buffer.from(bytes).toString('base64'), type],
    );
    return { width, height, data: new Uint8ClampedArray(Buffer.from(b64, 'base64')) };
  };
  const jsqrRead = img => jsQR(img.data, img.width, img.height)?.data ?? null;

  // Requests and workers of the tool's chunks, and every CSP violation, from here on.
  const loaded = [];
  page.on('request', r => chunk(r.url()) && loaded.push(chunk(r.url())));
  page.on('worker', w => chunk(w.url()) && loaded.push(`${chunk(w.url())} (worker)`));

  // §9: nothing of the tool on the start route.
  const start = await ctx.newPage();
  const startLoaded = [];
  start.on('request', r => chunk(r.url()) && startLoaded.push(chunk(r.url())));
  await start.goto(base);
  await start.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await start.waitForLoadState('networkidle');
  await start.getByRole('combobox', { name: 'Find a tool or search the web' }).fill('qr code');
  const startRow = await start.getByRole('option').first().innerText();
  await sleep(300);
  check(
    `${T}: nothing of the tool on the start route; its field finds it by a keyword`,
    startLoaded.length === 0 && startRow.includes(T),
    `start route loaded ${JSON.stringify(startLoaded)}; first row "${startRow.split('\n')[0]}"`,
  );
  await start.close();

  // Open the tool in the main page without a new entry in the tab's history.
  // (A page not yet on the extension's origin — this module run alone — cannot replace itself with it: go there.)
  if (page.url().split('#')[0] === base.split('#')[0])
    await page.evaluate(url => location.replace(url), `${base}#/tools/qr`);
  else await page.goto(`${base}#/tools/qr`);
  await page.getByRole('heading', { name: T }).waitFor();
  const text = page.getByLabel('Text', { exact: true });
  await text.waitFor();
  await page.evaluate(() => {
    window.__qrViolations = [];
    window.__qrViolationListener = e => window.__qrViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener('securitypolicyviolation', window.__qrViolationListener);
  });
  await sleep(300);
  check(
    `${T}: opening it loads the component only — not the encoder, not the reader`,
    loaded.includes('QrTool') && !loaded.includes('maker') && !loaded.some(l => l.startsWith('read.worker')),
    JSON.stringify(loaded),
  );
  check(
    `${T}: listed in Tools with its title and summary`,
    (await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('list', { name: 'Tools' })
      .getByRole('link', { name: T })
      .count()) === 1 &&
      (await page.locator('.kit-tool-page-summary').innerText()).includes(
        'Make a QR code from text or Wi-Fi details, or read one from an image.',
      ),
  );
  check(
    `${T}: empty — the frame says what to do, the actions are off`,
    (await page.getByText('Enter text to make a QR code.').count()) === 1 &&
      (await page.getByRole('button', { name: 'Download SVG' }).isDisabled()) &&
      (await page.getByRole('button', { name: 'Copy image' }).isDisabled()),
  );
  await settledShot(shoot, page, 'tool-qr-01-empty.png');

  // §2.1: https://example.com/ — the code at once, drawn as SVG elements, readable from the screen.
  await text.fill('https://example.com/');
  const svg = page.getByRole('img', { name: 'QR code' });
  await svg.waitFor();
  const info = await page.locator('[data-info]').innerText();
  check(
    `${T}: https://example.com/ — the code and "Version 2 · 25 × 25 modules · level M · 20 bytes (byte mode)"`,
    info === 'Version 2 · 25 × 25 modules · level M · 20 bytes (byte mode)',
    info,
  );
  check(
    `${T}: the encoder loads with the first code, the reader still not`,
    loaded.includes('maker') && !loaded.some(l => l.startsWith('read.worker')),
    JSON.stringify(loaded),
  );
  const drawn = await svg.evaluate(el => ({
    tag: el.tagName,
    size: [el.getBoundingClientRect().width, el.getBoundingClientRect().height],
    imgs: el.closest('[data-half]').querySelectorAll('img').length,
    style: el.querySelectorAll('[style]').length + (el.hasAttribute('style') ? 1 : 0),
  }));
  const screenImg = await rgbaOf(await svg.screenshot(), 'image/png');
  const fromScreen = jsqrRead(screenImg);
  check(
    `${T}: the code on the page is SVG elements, 256 × 256, no <img>, colours as fill attributes (no style) — its screenshot reads back (jsQR)`,
    drawn.tag === 'svg' &&
      drawn.size.join() === '256,256' &&
      drawn.imgs === 0 &&
      drawn.style === 0 &&
      fromScreen === 'https://example.com/',
    `${JSON.stringify(drawn)}; jsQR: ${fromScreen}`,
  );
  await settledShot(shoot, page, 'tool-qr-02-text.png');

  // Download SVG and PNG: the files of §5.5, read by jsQR.
  const save = async (name, file) => {
    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name, exact: true }).click(),
    ]);
    const path = join(OUT, file);
    await download.saveAs(path);
    return { suggested: download.suggestedFilename(), bytes: readFileSync(path), path };
  };
  const svgFile = await save('Download SVG', 'qr-code.svg');
  const pngFile = await save('Download PNG', 'qr-code.png');
  const svgImg = await rgbaOf(svgFile.bytes, 'image/svg+xml');
  const pngImg = await rgbaOf(pngFile.bytes, 'image/png');
  facts.files = {
    svgBytes: svgFile.bytes.length,
    svgSha: sha256(svgFile.bytes).slice(0, 16),
    pngBytes: pngFile.bytes.length,
  };
  check(
    `${T}: Download SVG saves qr-code.svg — 2,396 bytes, SHA-256 db0699cbd9048ef0…, read back by jsQR`,
    svgFile.suggested === 'qr-code.svg' &&
      svgFile.bytes.length === 2396 &&
      sha256(svgFile.bytes).startsWith('db0699cbd9048ef0') &&
      svgImg.width === 264 &&
      jsqrRead(svgImg) === 'https://example.com/',
    JSON.stringify(facts.files),
  );
  check(
    `${T}: Download PNG saves qr-code.png — 264 × 264, 3,360 bytes, read back by jsQR`,
    pngFile.suggested === 'qr-code.png' &&
      pngFile.bytes.length === 3360 &&
      pngImg.width === 264 &&
      pngImg.height === 264 &&
      jsqrRead(pngImg) === 'https://example.com/',
    `${pngImg.width} × ${pngImg.height}, ${pngFile.bytes.length} bytes`,
  );

  // Copy text and Copy image, each into a stand-in in the page — no clipboard is written.
  const clipboard = await stubClipboard(page);
  await page.evaluate(() => {
    window.__qrImages = [];
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async items => {
        for (const item of items) {
          const part = item.types.includes('image/png') ? item.getType('image/png') : null;
          const blob = await part;
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (const b of bytes) s += String.fromCharCode(b);
          window.__qrImages.push({ types: item.types, type: blob.type, b64: btoa(s) });
        }
      },
    });
  });
  await page.getByRole('button', { name: 'Copy text' }).click();
  await page.getByRole('button', { name: 'Copied' }).first().waitFor();
  await page.getByRole('button', { name: 'Copy image' }).click();
  await page.locator('button[data-copy-image][data-copied]').waitFor();
  const images = await page.evaluate(() => window.__qrImages);
  const copiedPng = images[0] ? await rgbaOf(Buffer.from(images[0].b64, 'base64'), 'image/png') : null;
  check(
    `${T}: Copy text copies the encoded string; Copy image hands a PNG (a ClipboardItem of image/png) that reads back`,
    JSON.stringify(await clipboard.copied()) === JSON.stringify(['https://example.com/']) &&
      images.length === 1 &&
      images[0].types.join() === 'image/png' &&
      images[0].type === 'image/png' &&
      copiedPng?.width === 264 &&
      jsqrRead(copiedPng) === 'https://example.com/',
    images[0] ? `${images[0].types} ${copiedPng?.width}px` : 'nothing copied',
  );
  await page.evaluate(() => {
    delete navigator.clipboard.write;
    delete window.__qrImages;
  });
  await clipboard.restore();
  const madeRecord = await waitForHistoryRecord(page, 'qr', r => r.kind === 'made').catch(() => null);
  check(
    `${T}: a code of text is kept in clear (kind "made")`,
    madeRecord?.label === 'https://example.com/ · level M' && madeRecord?.payload?.text === 'https://example.com/',
    madeRecord ? madeRecord.label : 'no record',
  );

  // §2.6 (corrected): too long at M, version 40 at L.
  await text.fill('a'.repeat(2900));
  const tooLong = page.getByText('Too long for a QR code: 2,900 bytes; level M holds up to 2,331 bytes in byte mode.');
  await tooLong.waitFor();
  const noCode = (await svg.count()) === 0 && (await page.getByRole('button', { name: 'Download PNG' }).isDisabled());
  await page.getByLabel('Error correction').click();
  await page.getByRole('option', { name: 'L — 7%' }).click();
  await svg.waitFor();
  const info40 = await page.locator('[data-info]').innerText();
  check(
    `${T}: 2,900 bytes at M — the message, no code; at L — version 40`,
    noCode && info40 === 'Version 40 · 177 × 177 modules · level L · 2,900 bytes (byte mode)',
    info40,
  );
  await page.getByLabel('Error correction').click();
  await page.getByRole('option', { name: 'M — 15%' }).click();

  // Read: the saved files through the file input, the worker loads now.
  await page.getByRole('radio', { name: 'Read', exact: true }).click();
  const input = page.locator('[data-read] input[type="file"]');
  const content = page.getByLabel('Content', { exact: true });
  const readInfo = page.locator('[data-read-info]');
  const readError = page.locator('[data-read-error]');
  /** Reads ended so far (the page counts them: `data-read-serial`). */
  const serial = () => page.evaluate(() => Number(document.querySelector('[data-read]')?.dataset.readSerial ?? 0));
  const nextRead = before =>
    page.waitForFunction(n => Number(document.querySelector('[data-read]')?.dataset.readSerial ?? 0) > n, before, {
      timeout: 20_000,
    });
  const readFile = async files => {
    const before = await serial();
    await page.evaluate(() => {
      window.__qrRead = performance.now();
    });
    await input.setInputFiles(files);
    await nextRead(before);
    return page.evaluate(() => Math.round(performance.now() - window.__qrRead));
  };
  const pngMs = await readFile(pngFile.path);
  check(
    `${T}: the saved PNG is read back by the tool — the text, its line, the link note; the reader is a worker loaded now`,
    (await content.inputValue()) === 'https://example.com/' &&
      (await readInfo.innerText()).includes('Found a QR code: 20 characters.') &&
      (await readInfo.innerText()).includes('Links are shown as text and are never opened.') &&
      (await page.locator('[data-read] a[href]').count()) === 0 &&
      loaded.some(l => l.startsWith('read.worker')),
    `${pngMs} ms; ${JSON.stringify(loaded)}`,
  );
  const preview = await page.getByRole('img', { name: 'Image preview' }).evaluate(c => {
    const d = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    let dark = 0;
    for (let i = 0; i < d.length; i += 4) if (d[i + 3] > 0 && d[i] < 64) dark++;
    return { tag: c.tagName, w: c.width, css: c.getBoundingClientRect().width, dark };
  });
  check(
    `${T}: the image is shown on a canvas, 240 × 240, with its pixels (no image address)`,
    preview.tag === 'CANVAS' && preview.css === 240 && preview.dark > 1000,
    JSON.stringify(preview),
  );
  const svgMs = await readFile(svgFile.path);
  check(
    `${T}: the saved SVG is read back by the tool (drawn through <img src="blob:…">)`,
    (await content.inputValue()) === 'https://example.com/',
    `${svgMs} ms`,
  );

  // A JPEG, a picture without a code, a text file, a drop and a paste.
  const made = await blank.evaluate(async b64 => {
    const png = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
    const encode = async (canvas, type, quality) => {
      const bytes = new Uint8Array(await (await canvas.convertToBlob({ type, quality })).arrayBuffer());
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      return btoa(s);
    };
    const jpeg = new OffscreenCanvas(png.width, png.height);
    jpeg.getContext('2d').drawImage(png, 0, 0);
    const empty = new OffscreenCanvas(320, 240);
    const g = empty.getContext('2d');
    g.fillStyle = '#d8d8d8';
    g.fillRect(0, 0, 320, 240);
    g.fillStyle = '#404040';
    g.fillRect(40, 40, 120, 60);
    // 12 megapixels of noise, with the code at 3 px a module near a corner (the §10 row's "photo"), as JPEG.
    const W = 4000;
    const H = 3000;
    const photo = new OffscreenCanvas(W, H);
    const p = photo.getContext('2d');
    const noise = p.createImageData(W, H);
    let seed = 12345;
    for (let i = 0; i < noise.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const v = 96 + (seed >>> 24) / 2;
      noise.data[i] = v;
      noise.data[i + 1] = v * 0.9;
      noise.data[i + 2] = v * 0.8;
      noise.data[i + 3] = 255;
    }
    p.putImageData(noise, 0, 0);
    p.imageSmoothingEnabled = false;
    p.drawImage(png, W - 400, H - 400, 99, 99);
    return {
      jpeg: await encode(jpeg, 'image/jpeg', 0.6),
      empty: await encode(empty, 'image/png'),
      photo: await encode(photo, 'image/jpeg', 0.9),
      huge: await (async () => {
        // 8,000 × 6,000 (§6): scaled to 4,096 on its long side before the search; the code at 12 px a module.
        const c = new OffscreenCanvas(8000, 6000);
        const h = c.getContext('2d');
        h.fillStyle = '#f4f1ea';
        h.fillRect(0, 0, 8000, 6000);
        h.imageSmoothingEnabled = false;
        h.drawImage(png, 5000, 4000, 396, 396);
        return encode(c, 'image/jpeg', 0.85);
      })(),
    };
  }, pngFile.bytes.toString('base64'));
  const jpegPath = join(OUT, 'code.jpg');
  const emptyPath = join(OUT, 'empty.png');
  const photoPath = join(OUT, 'photo-12mp.jpg');
  writeFileSync(jpegPath, Buffer.from(made.jpeg, 'base64'));
  writeFileSync(emptyPath, Buffer.from(made.empty, 'base64'));
  writeFileSync(photoPath, Buffer.from(made.photo, 'base64'));
  writeFileSync(join(OUT, 'notes.txt'), 'not an image');
  const hugePath = join(OUT, 'huge-8000x6000.jpg');
  writeFileSync(hugePath, Buffer.from(made.huge, 'base64'));
  const jpegMs = await readFile(jpegPath);
  check(`${T}: a JPEG (quality 0.6) is read`, (await content.inputValue()) === 'https://example.com/', `${jpegMs} ms`);
  await readFile(emptyPath);
  check(
    `${T}: a picture without a code — "No QR code found. Try a sharper or larger image, or crop it to the code."`,
    (await readError.innerText()) === 'No QR code found. Try a sharper or larger image, or crop it to the code.' &&
      (await readError.getAttribute('role')) === 'alert',
  );
  await readFile(join(OUT, 'notes.txt'));
  check(
    `${T}: a text file — "This file is not an image."`,
    (await readError.innerText()) === 'This file is not an image.',
  );

  const hand = async (how, file, type) =>
    page.evaluate(
      async ([way, b64, name, mime]) => {
        const dt = new DataTransfer();
        dt.items.add(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], name, { type: mime }));
        if (way === 'drop') {
          const zone = document.querySelector('[data-read] [data-slot="file-drop"]');
          zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          return true;
        }
        const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        (document.querySelector('#qr-text') ?? document.body).dispatchEvent(event);
        return event.defaultPrevented;
      },
      [how, readFileSync(file).toString('base64'), file.split('/').pop(), type],
    );
  let before = await serial();
  await hand('drop', jpegPath, 'image/jpeg');
  await nextRead(before);
  check(`${T}: an image dropped on the zone is read`, (await content.inputValue()) === 'https://example.com/');
  await page.getByRole('radio', { name: 'Generate', exact: true }).click();
  await text.waitFor();
  before = await serial();
  const prevented = await hand('paste', pngFile.path, 'image/png');
  await page.locator('[data-half="read"]').waitFor();
  await nextRead(before);
  check(
    `${T}: an image pasted while in Generate switches to Read and is read; the paste does not reach the field`,
    prevented &&
      (await page.evaluate(() => document.querySelector('#qr-text') === null)) &&
      (await content.inputValue()) === 'https://example.com/',
  );
  await settledShot(shoot, page, 'tool-qr-03-read.png');

  const hugeMs = await readFile(hugePath);
  check(
    `${T}: an 8,000 × 6,000 picture is scaled to 4,096 px on its long side and read`,
    (await content.inputValue()) === 'https://example.com/',
    `${hugeMs} ms`,
  );

  // The 12-megapixel photo: read off the page's thread; the page's frames meanwhile.
  await page.evaluate(() => {
    const frames = (window.__qrFrames = { last: performance.now(), longest: 0, loaf: 0, on: true });
    const tick = t => {
      frames.longest = Math.max(frames.longest, t - frames.last);
      frames.last = t;
      if (frames.on) requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    window.__qrLoaf = new PerformanceObserver(list => {
      for (const e of list.getEntries()) frames.loaf = Math.max(frames.loaf, e.duration);
    });
    window.__qrLoaf.observe({ type: 'long-animation-frame' });
  });
  const photoMs = await readFile(photoPath);
  const frames = await page.evaluate(() => {
    window.__qrFrames.on = false;
    window.__qrLoaf.disconnect();
    const f = window.__qrFrames;
    delete window.__qrFrames;
    delete window.__qrLoaf;
    return { longest: Math.round(f.longest), loaf: Math.round(f.loaf) };
  });
  facts.photo = { bytes: readFileSync(photoPath).length, ms: photoMs, ...frames };
  check(
    `${T}: a 12-megapixel photo with a code of 3 px a module is read in the worker; the page keeps drawing frames`,
    (await content.inputValue()) === 'https://example.com/' && frames.longest < 200,
    `${(facts.photo.bytes / 1e6).toFixed(1)} MB JPEG, ${photoMs} ms to the result, longest frame ${frames.longest} ms, longest animation frame ${frames.loaf} ms`,
  );

  // Wi-Fi (invented details): the form, the string, the code read back; and the secret kind.
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  const groupText = await group.innerText();
  check(
    `${T}: Settings → History says what it keeps and never keeps`,
    groupText.includes('The text you made a code of, with the level, quiet zone and PNG size') &&
      groupText.includes('The images you give it and the code’s image files'),
  );
  await page.bringToFront();
  await page.getByRole('radio', { name: 'Generate', exact: true }).click();
  await page.getByRole('radio', { name: 'Wi-Fi', exact: true }).click();
  const fillWifi = async p => {
    await p.getByLabel('Network name', { exact: true }).fill(WIFI.ssid);
    await p.getByLabel('Password', { exact: true }).fill(WIFI.password);
    if (!(await p.getByLabel('Hidden network').isChecked())) await p.getByLabel('Hidden network').click();
    await p.getByRole('img', { name: 'QR code' }).waitFor();
  };
  await fillWifi(page);
  const wifiString = page.getByRole('status', { name: 'Wi-Fi string' });
  const masked = await wifiString.innerText();
  await page.getByRole('button', { name: 'Show', exact: true }).click();
  const plain = await wifiString.innerText();
  const wifiPng = await save('Download PNG', 'wifi.png');
  const wifiRead = jsqrRead(await rgbaOf(wifiPng.bytes, 'image/png'));
  check(
    `${T}: Wi-Fi — the string under the form (password masked until Show), the code holds it (jsQR)`,
    masked === 'WIFI:T:WPA;S:Example\\;Lab;P:••••••••;H:true;;' && plain === WIFI.string && wifiRead === WIFI.string,
    masked,
  );
  await settledShot(shoot, page, 'tool-qr-04-wifi.png');
  await page.getByRole('button', { name: 'Hide', exact: true }).click();
  const secretRows = async () =>
    (
      await page.evaluate(async () => {
        const db = await new Promise(res => {
          const r = indexedDB.open('tool-history');
          r.onupgradeneeded = () => r.transaction.abort();
          r.onsuccess = () => res(r.result);
          r.onerror = () => res(null);
        });
        if (!db) return [];
        const rows = await new Promise(res => {
          const r = db.transaction('records').objectStore('records').getAll();
          r.onsuccess = () => res(r.result);
        });
        db.close();
        return rows.map(row => ({ owner: row.owner, kind: row.kind, kid: row.kid ?? null, line: row.line }));
      })
    ).filter(r => r.owner === 'qr' && r.kind.endsWith('-secret'));
  await sleep(500);
  check(
    `${T}: without a master password the Wi-Fi details are not kept, and the page says so`,
    (await secretRows()).length === 0 &&
      (await page.locator('[data-kept]').innerText()).startsWith('Not kept: Wi-Fi details and one-time password keys'),
  );

  const master = `e2e-${randomBytes(12).toString('base64url')}-Zz9`;
  await settings.bringToFront();
  await group.getByRole('button', { name: 'Set a master password…' }).click();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByLabel('The same again').fill(master);
  await group.getByLabel('I understand: forgotten means lost').click();
  await group.getByRole('button', { name: 'Set the master password' }).click();
  await group.getByText('The master password is set and the history is unlocked.').waitFor();
  await page.bringToFront();
  await page.locator('[data-kept]').filter({ hasText: 'Kept in this browser’s history, encrypted.' }).waitFor();
  await page.getByRole('button', { name: 'Copy text' }).click();
  let rows = [];
  for (let i = 0; i < 50 && rows.length === 0; i++) {
    await sleep(100);
    rows = await secretRows();
  }
  const record = rows[0] ? JSON.parse(rows[0].line) : {};
  check(
    `${T}: unlocked, the Wi-Fi code is kept encrypted — no name, password, label or payload in clear`,
    rows.length === 1 &&
      rows[0].kind === 'made-secret' &&
      !!rows[0].kid &&
      typeof record.sealed === 'object' &&
      record.payload === undefined &&
      record.label === undefined &&
      !rows[0].line.includes('quiet') &&
      !rows[0].line.includes('Example'),
    rows.length ? `kind ${rows[0].kind}` : 'no entry',
  );

  // A Wi-Fi code read while unlocked is kept encrypted too.
  // §2.4: a "photo" of the Wi-Fi code — turned 15°, with noise — made in the blank page.
  const turned = await blank.evaluate(async b64 => {
    const png = await createImageBitmap(new Blob([Uint8Array.from(atob(b64), c => c.charCodeAt(0))]));
    const side = Math.round(png.width * 1.5);
    const canvas = new OffscreenCanvas(side, side);
    const g = canvas.getContext('2d');
    g.fillStyle = '#e8e4dc';
    g.fillRect(0, 0, side, side);
    g.translate(side / 2, side / 2);
    g.rotate((15 * Math.PI) / 180);
    g.drawImage(png, -png.width / 2, -png.height / 2);
    g.setTransform(1, 0, 0, 1, 0, 0);
    const img = g.getImageData(0, 0, side, side);
    let seed = 7;
    for (let i = 0; i < img.data.length; i += 4) {
      seed = (seed * 1103515245 + 12345) >>> 0;
      const d = ((seed >>> 24) - 128) / 3;
      for (let k = 0; k < 3; k++) img.data[i + k] = Math.max(0, Math.min(255, img.data[i + k] + d));
    }
    g.putImageData(img, 0, 0);
    const bytes = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }, wifiPng.bytes.toString('base64'));
  const turnedPath = join(OUT, 'wifi-photo.png');
  writeFileSync(turnedPath, Buffer.from(turned, 'base64'));
  await page.getByRole('radio', { name: 'Read', exact: true }).click();
  const turnedMs = await readFile(turnedPath);
  facts.turnedWifiMs = turnedMs;
  const table = page.getByRole('table', { name: 'Wi-Fi details' });
  const tableText = await table.innerText();
  for (let i = 0; i < 50 && (await secretRows()).length < 2; i++) await sleep(100);
  check(
    `${T}: a Wi-Fi "photo" (turned 15°, noise) is read — the table, the password hidden; kept encrypted ("read-secret")`,
    (await content.inputValue()) === 'WIFI:T:WPA;S:Example\\;Lab;P:••••••••;H:true;;' &&
      tableText.includes('Example;Lab') &&
      tableText.includes('••••••••') &&
      !tableText.includes('quiet:river') &&
      (await secretRows()).some(r => r.kind === 'read-secret'),
    `${turnedMs} ms; ${tableText.replace(/\s+/g, ' ')}`,
  );

  // Locked: the entry stays shut. Unlocked: it opens back into the form.
  const history = await open('#/history');
  await history.locator('[data-page="history"]').waitFor();
  await history.getByRole('button', { name: 'Lock now' }).click();
  await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
  const entry = history.locator('.kit-history-entry[data-kind="made-secret"]');
  await entry.waitFor();
  await entry.getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  const lockedText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: locked, the Wi-Fi entry does not open`,
    lockedText === 'This entry is encrypted: unlock the history to open it.',
    lockedText,
  );
  await settings.bringToFront();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('Unlocked.', { exact: true }).waitFor();
  await history.bringToFront();
  await history.goto(`${base}#/history`);
  await history.locator('.kit-history-entry[data-kind="made-secret"]').getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  const restoredText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: unlocked, History's Open brings the Wi-Fi details back into the form`,
    restoredText === 'Opened from History: Wi-Fi · Example;Lab · level M.' &&
      (await history.getByLabel('Network name', { exact: true }).inputValue()) === WIFI.ssid &&
      (await history.getByLabel('Password', { exact: true }).inputValue()) === WIFI.password,
    restoredText,
  );

  // Dark theme screenshots (invented details only), then the master password off again.
  await page.bringToFront();
  await page.getByRole('radio', { name: 'Generate', exact: true }).click();
  await inDarkTheme(ctx, base, page, async () => {
    await page.getByRole('img', { name: 'QR code' }).waitFor();
    await settledShot(shoot, page, 'tool-qr-05-wifi-dark.png');
    await page.getByRole('radio', { name: 'Text', exact: true }).click();
    await page.getByLabel('Text', { exact: true }).fill('https://example.com/');
    await page.getByRole('img', { name: 'QR code' }).waitFor();
    const darkSvg = await rgbaOf(await page.getByRole('img', { name: 'QR code' }).screenshot(), 'image/png');
    check(
      `${T}: in the dark theme the code is still black on white and reads back`,
      jsqrRead(darkSvg) === 'https://example.com/',
    );
    await settledShot(shoot, page, 'tool-qr-06-text-dark.png');
    await page.getByRole('radio', { name: 'Read', exact: true }).click();
    await readFile(pngFile.path);
    await settledShot(shoot, page, 'tool-qr-07-read-dark.png');
  });

  await settings.bringToFront();
  await group.getByRole('button', { name: 'Turn off…' }).click();
  await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await group.getByText(/^The master password is off/).waitFor();
  await page.bringToFront();
  check(`${T}: with the master password off again, its encrypted entries are gone`, (await secretRows()).length === 0);

  const violations = await page.evaluate(() => {
    document.removeEventListener('securitypolicyviolation', window.__qrViolationListener);
    const v = window.__qrViolations;
    delete window.__qrViolations;
    delete window.__qrViolationListener;
    return v;
  });
  check(`${T}: no content security policy violation on the way`, violations.length === 0, violations.join('; '));
  facts.loaded = loaded;

  // Saved parameters (D21): Generate · Wi-Fi with the invented details still in the form, H and 16 px chosen — written
  // 400 ms after the change, without anything of the network; the page opened again is as left, the form empty.
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.qr);
  await page.getByRole('radio', { name: 'Generate', exact: true }).click();
  await page.getByRole('radio', { name: 'Wi-Fi', exact: true }).click();
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  await choose('Error correction', 'H — 30%');
  await choose('PNG size', '16 px per module');
  for (let i = 0; i < 25 && (await stored())?.values?.px !== 16; i++) await sleep(200);
  const formBefore = await page.getByLabel('Network name', { exact: true }).inputValue();
  await page.reload();
  await page.getByLabel('Network name', { exact: true }).waitFor();
  const kept = {
    stored: await stored(),
    generate: await page.getByRole('radio', { name: 'Generate', exact: true }).getAttribute('aria-checked'),
    wifi: await page.getByRole('radio', { name: 'Wi-Fi', exact: true }).getAttribute('aria-checked'),
    level: await page.getByLabel('Error correction', { exact: true }).innerText(),
    px: await page.getByLabel('PNG size', { exact: true }).innerText(),
    ssid: await page.getByLabel('Network name', { exact: true }).inputValue(),
    password: await page.getByLabel('Password', { exact: true }).inputValue(),
  };
  const storedText = JSON.stringify(kept.stored ?? null);
  check(
    `${T}: Generate · Wi-Fi, H and 16 px chosen, the page opened again — as left, the Wi-Fi form empty; nothing of the network saved (saved parameters)`,
    formBefore === WIFI.ssid &&
      kept.generate === 'true' &&
      kept.wifi === 'true' &&
      kept.level.includes('H — 30%') &&
      kept.px.includes('16 px per module') &&
      kept.ssid === '' &&
      kept.password === '' &&
      JSON.stringify(Object.keys(kept.stored?.values ?? {}).sort()) === JSON.stringify(['content', 'level', 'px']) &&
      !storedText.includes('Example') &&
      !storedText.includes(WIFI.password),
    JSON.stringify({ ...kept, stored: kept.stored?.values }),
  );
  await forgetSavedParameters(page, 'qr');

  for (const p of opened) await p.close();
  await blank.close();
  // Leave the page where any module may go next, without a new history entry.
  await page.evaluate(url => location.replace(url), `${base}#/tools`);
};
