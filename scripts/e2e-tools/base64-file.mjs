// The Base64 File tool in the built extension (docs/tools/specs/base64-file.md): its scenarios (§2) with the page's
// real controls, and what only Chrome can tell — run by scripts/e2e-tools.mjs. Names: 'Base64 File: …'; screenshots
// tool-base64-file-NN-….
//
// - Exactness in Chrome: files encoded through the worker equal Node's Base64 (which the package's cross-check matched
//   with the system's `base64` and python3), saved files are byte for byte what they should be.
// - Large files without holding them (§5.6, §12): a file of BASE64_FILE_E2E_BYTES (64 MiB by default; the
//   specification's measurement ran it with 1 GiB) encoded by Save into a file and that file decoded back, each through
//   the worker: time, the page's and the worker's JS heap at their peak, the renderer's memory, the longest frame; what
//   the page shows is bounded, Copy refused in words.
// - Decoded bytes are never shown, run or loaded: HTML with a script and remote references, an SVG with a script, a
//   script, each decoded and saved — no request leaves the extension, no script runs, nothing navigates or opens; Save
//   is a download from a `blob:` URL revoked at once; a saved file's name carries no path or control characters from a
//   data URI's parameters or from the name field.
// - §7 on the start page, history (D17), light and dark screenshots.
// The clipboard is a stand-in (stubClipboard), put back before the module ends. Every remote address is a reserved name
// (*.invalid), answered by a route: even a failure reaches no network. Navigates by replacing the current entry.

/* global document, window, location, chrome, requestAnimationFrame, HTMLTextAreaElement,
   DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the pages */

import { execFileSync } from 'node:child_process';
import { createHash, randomBytes } from 'node:crypto';
import { closeSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync, createReadStream } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forgetSavedParameters,
  historyRecords,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Base64 File';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = join(ROOT, '.state/e2e/base64-file');
const INVALID = /^(?:https?|wss?):\/\/[^/?#]*\.invalid(?:[:/?#]|$)/;
const LARGE = Number(process.env.BASE64_FILE_E2E_BYTES ?? 64 * 1024 * 1024);

/** What a script would do if it ran: marks in the page, storage and the network, then a navigation. */
const CANARY =
  "try{top.__b64fPwned=1}catch(e){};window.__b64fPwned=1;try{localStorage.setItem('b64fPwned','1')}catch(e){};" +
  "try{chrome.storage.local.set({b64fPwned:1})}catch(e){};try{fetch('https://canary.invalid/fetch')}catch(e){};" +
  "try{new Image().src='https://canary.invalid/img'}catch(e){};try{top.location='https://canary.invalid/nav'}catch(e){}";

const CERT_B64 =
  'MIIBYjCCAQigAwIBAgIULI/FBMKhSjIE/HAWbdttARxSji4wCgYIKoZIzj0EAwIwFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MB4XDTI2MTEyMjE1Mzc0M1oXDTM2MTExOTE1Mzc0M1owFzEVMBMGA1UEAwwMZXhhbXBsZS50ZXN0MFkwEwYHKoZIzj0CAQYIKoZIzj0DAQcDQgAExHhGxRbzc/vXd9NpQxxuDnhyfGNj3f6Oq7qH5NKHSvps4yWCZzZN4DS5kPcphGK8gXn3jx54Vx6dSmx+cTRQgKMyMDAwHQYDVR0OBBYEFPhazzmPwIPHYkS2TjlJhfCH3WfPMA8GA1UdEwEB/wQFMAMBAf8wCgYIKoZIzj0EAwIDSAAwRQIgDQSV9KY44EE+Bx9+nufzUAVbwnj6ZHCVCenks7UP6Q0CIQC4S8A1ycdgwDRy0o9ZTLb5l4Z95Mge5wVVmKLqhi8zBA==';
const PDF = Buffer.concat([
  Buffer.from('%PDF-1.7\n%'),
  Buffer.from([0xe2, 0xe3, 0xcf, 0xd3]),
  Buffer.from('\n1 0 obj\n<<>>\nendobj\ntrailer\n<<>>\n%%EOF\n'),
]);
const b64 = data => Buffer.from(data).toString('base64');
const sha = data => createHash('sha256').update(data).digest('hex');

/** The SHA-256 of a file, and of the Base64 of a file (computed by Node a piece of 3 · 2^20 bytes at a time). */
const shaOfFile = path =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    createReadStream(path, { highWaterMark: 4 << 20 })
      .on('data', d => h.update(d))
      .on('end', () => resolve(h.digest('hex')))
      .on('error', reject);
  });
const shaOfBase64 = path =>
  new Promise((resolve, reject) => {
    const h = createHash('sha256');
    let carry = Buffer.alloc(0);
    createReadStream(path, { highWaterMark: 3 << 20 })
      .on('data', d => {
        const all = carry.length ? Buffer.concat([carry, d]) : d;
        const cut = all.length - (all.length % 3);
        h.update(all.subarray(0, cut).toString('base64'));
        carry = Buffer.from(all.subarray(cut));
      })
      .on('end', () => resolve(h.update(carry.toString('base64')).digest('hex')))
      .on('error', reject);
  });

/** A ZIP of one stored entry (PKWARE APPNOTE §4.3): local header, central directory, end record; CRC left 0. */
const zipOf = (name, content) => {
  const u16 = n => Buffer.from([n & 255, n >> 8]);
  const u32 = n => Buffer.from([n & 255, (n >>> 8) & 255, (n >>> 16) & 255, n >>> 24]);
  const data = Buffer.from(content);
  const local = Buffer.concat([
    Buffer.from([0x50, 0x4b, 3, 4]),
    u16(10),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    Buffer.from(name),
    data,
  ]);
  const central = Buffer.concat([
    Buffer.from([0x50, 0x4b, 1, 2]),
    u16(20),
    u16(10),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    u32(data.length),
    u32(data.length),
    u16(name.length),
    u16(0),
    u16(0),
    u16(0),
    u16(0),
    u32(0),
    u32(0),
    Buffer.from(name),
  ]);
  const end = Buffer.concat([
    Buffer.from([0x50, 0x4b, 5, 6]),
    u16(0),
    u16(0),
    u16(1),
    u16(1),
    u32(central.length),
    u32(local.length),
    u16(0),
  ]);
  return Buffer.concat([local, central, end]);
};

/** A file of `size` bytes: 1 MiB of random bytes repeated (not text: its first byte is 0). */
const makeLarge = (path, size) => {
  const block = randomBytes(1024 * 1024);
  block[0] = 0;
  const fd = openSync(path, 'w');
  try {
    for (let at = 0; at < size; at += block.length) writeSync(fd, block, 0, Math.min(block.length, size - at));
  } finally {
    closeSync(fd);
  }
};

/** The resident memory of the browser's processes (macOS / Linux `ps`), by type, in MiB — for the run's own profile. */
const processMemory = profile => {
  try {
    const rows = execFileSync('ps', ['-A', '-o', 'pid=,ppid=,rss=,command='], { encoding: 'utf8', maxBuffer: 64 << 20 })
      .split('\n')
      .map(l => /^\s*(\d+)\s+(\d+)\s+(\d+)\s+(.*)$/.exec(l))
      .filter(Boolean)
      .map(m => ({ pid: +m[1], ppid: +m[2], rss: +m[3], command: m[4] }));
    const browser = rows.find(r => r.command.includes(profile) && !r.command.includes('--type='));
    if (!browser) return null;
    const children = rows.filter(r => r.ppid === browser.pid);
    const sum = filter => Math.round(children.filter(filter).reduce((a, r) => a + r.rss, 0) / 1024);
    return {
      browser: Math.round(browser.rss / 1024),
      renderers: sum(r => r.command.includes('--type=renderer')),
      extensionRenderer: Math.round(
        Math.max(0, ...children.filter(r => r.command.includes('--extension-process')).map(r => r.rss)) / 1024,
      ),
      others: sum(r => !r.command.includes('--type=renderer')),
    };
  } catch {
    return null;
  }
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  const facts = (report.base64File = {});
  const id = new URL(base).host;
  const origin = `chrome-extension://${id}`;
  // The run's own profile (scripts/e2e-check.mjs makes it under this copy's .state/): its browser process is found by it.
  const profile = join(ROOT, '.state/e2e/profiles/run-');

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
  const cdpOutside = [];
  const onCdp = e => {
    const url = e.request.url;
    if (!url.startsWith(origin) && !url.startsWith('blob:') && !url.startsWith('data:')) cdpOutside.push(url);
  };
  cdp.on('Network.requestWillBeSent', onCdp);
  const popups = [];
  const onPopup = p => popups.push(p.url());
  ctx.on('page', onPopup);

  // ---- Helpers
  const toolUrl = `${base}#/tools/base64-file`;
  const go = async url => {
    if (page.url().split('#')[0] === base.split('#')[0]) await page.evaluate(u => location.replace(u), url);
    else await page.goto(url);
    await page.waitForFunction(h => location.hash === h, new URL(url).hash, { timeout: 5_000 });
  };
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const fact = name =>
    page
      .locator(`[data-fact="${name}"]`)
      .innerText()
      .catch(() => null);
  const notes = () => page.locator('[data-part="notes"] [data-slot="tool-message"]').allInnerTexts();
  const errorLine = async () =>
    (
      await page
        .locator('[data-part="error"]')
        .innerText()
        .catch(() => '')
    ).trim();
  const fileInput = () => page.locator('input[type="file"]').first();
  /** Decode's field set as a paste would set it (one input event). */
  const put = async text => {
    await page.evaluate(value => {
      const field = document.querySelector('#base64-file-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  };
  const waitFact = (name, value, timeout = 10_000) =>
    page
      .waitForFunction(([n, v]) => document.querySelector(`[data-fact="${n}"]`)?.textContent === v, [name, value], {
        timeout,
      })
      .then(
        () => true,
        () => false,
      );
  /** Presses `name` and waits for the download; `inPlace`: the browser's own file (no copy — for the large ones). */
  const download = async (name, timeout = 30_000, inPlace = false) => {
    const [file] = await Promise.all([page.waitForEvent('download', { timeout }), button(name).click()]);
    if (inPlace) return { name: file.suggestedFilename(), path: await file.path(), url: file.url(), file };
    const path = join(OUT, `${Date.now()}-${file.suggestedFilename()}`);
    await file.saveAs(path);
    return { name: file.suggestedFilename(), path, url: file.url() };
  };
  const canaryState = () =>
    page.evaluate(async () => ({
      window: window.__b64fPwned ?? null,
      local: localStorage.getItem('b64fPwned'),
      storage: await new Promise(resolve => {
        try {
          chrome.storage.local.get('b64fPwned', r => resolve(r?.b64fPwned ?? null));
        } catch {
          resolve('unreadable');
        }
      }),
    }));

  // ---- §9 / D16: nothing of the tool on the start route; its field finds it
  const tool = url => /\/assets\/(Base64FileTool)-[^/]+\.js$/.exec(url)?.[1] ?? null;
  {
    const start = await ctx.newPage();
    const loaded = [];
    start.on('request', r => tool(r.url()) && loaded.push(tool(r.url())));
    await start.goto(base);
    const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await start.waitForLoadState('networkidle');
    await field.fill('base64 file');
    const first = (await start.getByRole('option').first().innerText()).split('\n')[0];
    check(
      `${T}: nothing of the tool on the start route; its field finds it by "base64 file"`,
      loaded.length === 0 && first.includes(T),
      `loaded ${JSON.stringify(loaded)}; first row "${first}"`,
    );
    await start.close();
  }

  // ---- Open the tool
  await go(toolUrl);
  // The page shows "Loading…" until the tool's history is open, which takes longer right after another tool's records.
  await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
  await page.evaluate(() => {
    window.__b64fViolations = [];
    window.__b64fListener = e => window.__b64fViolations.push(`${e.violatedDirective} ${e.blockedURI}`);
    document.addEventListener('securitypolicyviolation', window.__b64fListener);
    // Every object URL the page makes and revokes from here on (put back at the end).
    const created = new Set();
    window.__b64fUrls = { created, all: [], create: URL.createObjectURL, revoke: URL.revokeObjectURL };
    URL.createObjectURL = blob => {
      const url = window.__b64fUrls.create.call(URL, blob);
      created.add(url);
      window.__b64fUrls.all.push(url);
      return url;
    };
    URL.revokeObjectURL = url => {
      created.delete(url);
      return window.__b64fUrls.revoke.call(URL, url);
    };
  });
  const urls = () => page.evaluate(() => ({ live: [...window.__b64fUrls.created], all: [...window.__b64fUrls.all] }));
  const clipboard = await stubClipboard(page);
  await settledShot(shoot, page, 'tool-base64-file-01-empty.png');

  // ---- §2.1: a DER certificate → Base64, Copy takes it
  await fileInput().setInputFiles({ name: 'server.der', mimeType: '', buffer: Buffer.from(CERT_B64, 'base64') });
  await page.waitForFunction(v => document.querySelector('#base64-file-result')?.value === v, CERT_B64, {
    timeout: 10_000,
  });
  await button('Copy').click();
  await sleep(100);
  check(
    `${T}: §2.1 a DER certificate — DER certificate (application/pkix-cert), 358 bytes, its Base64; Copy copies it`,
    (await fact('Type')) === 'DER certificate (application/pkix-cert)' &&
      (await fact('Size')) === '358 bytes' &&
      (await fact('Base64 length')) === '480 characters' &&
      (await clipboard.copied()).at(-1) === CERT_B64,
    `${await fact('Type')}; copied ${(await clipboard.copied()).length}`,
  );
  await settledShot(shoot, page, 'tool-base64-file-02-encode.png');

  // ---- Exactness through the worker: sizes around the piece boundary, every option, against Node's Base64
  {
    const sizes = [0, 1, 2, 3, 911, 912, 913, 1_048_799, 1_048_800, 1_048_801, 2_097_601];
    const mismatches = [];
    let compared = 0;
    for (const size of sizes) {
      const data = randomBytes(size);
      if (size) data[0] = 0;
      await fileInput().setInputFiles({ name: `f${size}.bin`, mimeType: '', buffer: data });
      for (const [alphabet, wrap] of [
        ['Standard', 'No wrapping'],
        ['URL-safe', '76'],
        ['Standard', '64'],
      ]) {
        const node = (() => {
          let s = alphabet === 'Standard' ? data.toString('base64') : data.toString('base64url');
          if (wrap !== 'No wrapping') s = s.replace(new RegExp(`.{${wrap}}(?=.)`, 'gs'), '$&\n');
          return s;
        })();
        await page.getByLabel('Alphabet').click();
        await page.getByRole('option', { name: alphabet, exact: true }).click();
        await page.getByLabel('Line length').click();
        await page.getByRole('option', { name: wrap, exact: true }).click();
        // The field shows a long output's first 65,536 characters: its start is awaited, then Copy takes all of it.
        const ok =
          (await page
            .waitForFunction(
              ([start, whole]) => {
                const f = document.querySelector('#base64-file-result');
                return f && (whole ? f.value === start : f.value.length === 65536 && f.value === start);
              },
              [node.length <= 1048576 ? node : node.slice(0, 65536), node.length <= 1048576],
              { timeout: 15_000 },
            )
            .then(
              () => true,
              () => false,
            )) &&
          (size === 0 ||
            (await (async () => {
              await page.getByRole('button', { name: /^Cop(y|ied)$/ }).click();
              await sleep(50);
              return (await clipboard.copied()).at(-1) === node;
            })()));
        compared++;
        if (!ok) mismatches.push(`${size} ${alphabet} ${wrap}`);
      }
    }
    await page.getByLabel('Alphabet').click();
    await page.getByRole('option', { name: 'Standard', exact: true }).click();
    await page.getByLabel('Line length').click();
    await page.getByRole('option', { name: 'No wrapping', exact: true }).click();
    facts.exactInChrome = { compared, mismatches };
    check(
      `${T}: the worker's Base64 equals Node's for ${sizes.length} sizes around the 1,048,800-byte piece × 3 option sets (${compared} comparisons)`,
      mismatches.length === 0,
      JSON.stringify(mismatches),
    );
  }

  // ---- §2.6 a name that lies; §5.2 a polyglot
  await fileInput().setInputFiles({ name: 'photo.png', mimeType: 'image/png', buffer: PDF });
  await waitFact('Type', 'PDF document (application/pdf)');
  const lying = await notes();
  await fileInput().setInputFiles({
    name: 'paper.pdf',
    mimeType: '',
    buffer: Buffer.concat([PDF, zipOf('a.txt', 'hidden')]),
  });
  await page
    .waitForFunction(() =>
      [...document.querySelectorAll('[data-part="notes"] [data-slot="tool-message"]')].some(n =>
        n.textContent.includes('also a ZIP'),
      ),
    )
    .catch(() => {});
  const polyglot = await notes();
  check(
    `${T}: §2.6 a PDF named .png — the bytes decide, a note says so; a PDF with a ZIP appended — a PDF, and a note`,
    lying.includes('The name says .png, but the bytes are a PDF document.') &&
      polyglot.includes('The bytes are also a ZIP archive: its directory is at the end.') &&
      (await fact('Type')) === 'PDF document (application/pdf)',
    JSON.stringify({ lying, polyglot }),
  );

  // ---- §2.2 Decode: Base64 of a PDF → Save file saves file.pdf, the same bytes, from a revoked blob: URL
  await radio('Decode').click();
  await page.locator('#base64-file-input').waitFor();
  await put(b64(PDF));
  await waitFact('Type', 'PDF document (application/pdf)');
  const before = await urls();
  const savedPdf = await download('Save file');
  const after = await urls();
  const made = after.all.slice(before.all.length);
  check(
    `${T}: §2.2 Base64 of a PDF — PDF document, file.pdf; Save file saves the same bytes from a blob: URL revoked at once`,
    savedPdf.name === 'file.pdf' &&
      sha(readFileSync(savedPdf.path)) === sha(PDF) &&
      savedPdf.url.startsWith(`blob:${origin}/`) &&
      made.length === 1 &&
      after.live.length === 0,
    JSON.stringify({
      name: savedPdf.name,
      url: savedPdf.url.slice(0, 40),
      made: made.length,
      live: after.live,
    }),
  );
  await settledShot(shoot, page, 'tool-base64-file-03-decode.png');

  // ---- §6, §2.8: errors with their place
  await put('JVBERi0x!jcK');
  await page.waitForFunction(() => document.querySelector('[data-part="error"]')?.textContent.includes('column 9'));
  const invalid = await errorLine();
  await put('data:application/pdf;base64');
  await sleep(100);
  const noComma = await errorLine();
  check(
    `${T}: §2.8, §6 errors next to the field — "${invalid}", "${noComma}"`,
    invalid === 'Line 1, column 9: invalid character "!"' && noComma === 'a data URI needs a comma before the data',
  );

  // ---- Decoded markup and scripts are never shown, run or loaded; saved names carry nothing of a path
  {
    const hostile = [
      [
        'HTML with a script, an image, a frame, a meta refresh',
        'text/html',
        `<!DOCTYPE html><html><head><meta http-equiv="refresh" content="0;url=https://refresh.invalid/"><script>${CANARY}</script></head><body><img src="https://img.invalid/a.png" onerror="${CANARY}"><iframe src="https://frame.invalid/"></iframe><link rel="stylesheet" href="https://css.invalid/a.css"></body></html>`,
        'file.html',
        'HTML document (text/html)',
      ],
      [
        'SVG with a script, a handler, a remote image',
        'image/svg+xml',
        `<svg xmlns="http://www.w3.org/2000/svg" onload="${CANARY}"><script>${CANARY}</script><image href="https://svg-image.invalid/a.png" width="2" height="2"/></svg>`,
        'file.svg',
        'SVG image (image/svg+xml)',
      ],
      ['a script', 'text/javascript', `${CANARY}\n`, 'file.js', 'JavaScript (text/javascript)'],
    ];
    popups.length = 0;
    const results = [];
    for (const [name, type, content, file, typeFact] of hostile) {
      await put(`data:${type};base64,${b64(content)}`);
      const shownType = await waitFact('Type', typeFact).then(async () => fact('Type'));
      await button('Show text').click();
      await page.locator('#base64-file-text').waitFor();
      const textShown = (await page.locator('#base64-file-text').inputValue()) === content;
      const saved = await download('Save file');
      await sleep(300);
      results.push({
        name,
        shownType,
        textShown,
        saved: saved.name,
        sameBytes: readFileSync(saved.path, 'utf8') === content,
        url: page.url() === toolUrl,
      });
      void file;
    }
    const canary = await canaryState();
    const expectedNames = hostile.map(h => h[3]);
    check(
      `${T}: decoded HTML, SVG and a script are bytes with a name — shown only as text on request, saved as file.html / file.svg / file.js; no script ran, nothing navigated, no popup`,
      results.every((r, i) => r.textShown && r.sameBytes && r.url && r.saved === expectedNames[i]) &&
        canary.window === null &&
        canary.local === null &&
        canary.storage === null &&
        popups.length === 0 &&
        page.url() === toolUrl,
      JSON.stringify({ results, canary, popups }),
    );

    // Names from a data URI's parameters, and from the name field.
    const names = [];
    for (const param of [
      'name=..%2F..%2Fevil%0A.html',
      'name="..\\..\\Windows\\win.ini"',
      'filename=%E2%80%AEcod.txt',
      'name=CON',
      'name=a%00b%1Fc%7F.txt',
    ]) {
      await put(`data:text/plain;${param};base64,${b64('hello\n')}`);
      await page.waitForFunction(() => document.querySelector('#base64-file-name')?.value);
      names.push((await download('Save file')).name);
    }
    await page.locator('#base64-file-name').fill('../../x/\u{202E}fdp.txt\n');
    names.push((await download('Save file')).name);
    facts.savedNames = names;
    check(
      `${T}: a saved file's name carries no path separator or control character from a data URI's parameters or the name field`,
      JSON.stringify(names) === JSON.stringify(['evil.html', 'win.ini', 'cod.txt', '_CON.txt', 'abc.txt', 'fdp.txt']) &&
        names.every(
          n =>
            ![...n].some(c => c === '/' || c === '\\' || c.codePointAt(0) < 0x20 || c === '\u{7F}' || c === '\u{202E}'),
        ),
      JSON.stringify(names),
    );
    await page.locator('#base64-file-name').fill('');
  }

  // ---- §2.9 a PEM block; a paste over 4 Mi characters is held out of the field
  await put(`-----BEGIN CERTIFICATE-----\n${CERT_B64.match(/.{1,64}/g).join('\n')}\n-----END CERTIFICATE-----\n`);
  const pem = await waitFact('Type', 'DER certificate (application/pkix-cert)');
  const pemName = await page.locator('#base64-file-name').inputValue();
  const held = await page.evaluate(() => {
    const field = document.querySelector('#base64-file-input');
    field.focus();
    const data = new DataTransfer();
    data.setData('text/plain', 'AAAA'.repeat(1024 * 1024 + 1));
    const event = new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true });
    field.dispatchEvent(event);
    return event.defaultPrevented;
  });
  await page.locator('[data-held]').waitFor({ timeout: 5_000 });
  const heldNote = await page.locator('[data-held]').innerText();
  const heldSize = await waitFact('Size', '3,145,731 bytes (3.0 MiB)', 30_000);
  check(
    `${T}: §2.9 a PEM block → DER certificate, certificate.cer; a paste over 4 Mi characters stays out of the field and is decoded in the worker`,
    pem &&
      pemName === 'certificate.cer' &&
      held &&
      heldNote === 'Pasted text: 4,194,308 characters, not shown in the field.' &&
      heldSize,
    heldNote,
  );
  await button('Clear').click();

  // ---- §5.6, §12: a large file — Save streams Base64 to a file, and that file decodes back; nothing held whole
  {
    const large = join(OUT, 'large.bin');
    makeLarge(large, LARGE);
    const expectedText = await shaOfBase64(large);
    const expectedBytes = await shaOfFile(large);
    await radio('Encode').click();
    await page.locator('[data-slot="file-drop"]').waitFor();

    const sampler = { page: 0, worker: 0, renderer: 0, browser: 0, on: true };
    // The worker's JS heap through CDP: the page's session attaches to the worker's target (not flattened) and asks
    // Runtime.getHeapUsage through Target.sendMessageToTarget.
    const workerSessions = new Map();
    let message = 0;
    const answers = new Map();
    const onTargetMessage = e => {
      const data = JSON.parse(e.message);
      if (answers.has(data.id)) answers.get(data.id)(data.result);
    };
    cdp.on('Target.receivedMessageFromTarget', onTargetMessage);
    const workerHeap = async () => {
      try {
        const { targetInfos } = await cdp.send('Target.getTargets');
        let used = 0;
        for (const t of targetInfos.filter(i => i.type === 'worker' && i.url.includes('codec.worker'))) {
          if (!workerSessions.has(t.targetId))
            workerSessions.set(
              t.targetId,
              (await cdp.send('Target.attachToTarget', { targetId: t.targetId, flatten: false })).sessionId,
            );
          const id = ++message;
          const asked = new Promise(resolve => answers.set(id, resolve));
          await cdp.send('Target.sendMessageToTarget', {
            sessionId: workerSessions.get(t.targetId),
            message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }),
          });
          const heap = await Promise.race([asked, new Promise(resolve => setTimeout(() => resolve(null), 1000))]);
          answers.delete(id);
          used += heap?.usedSize ?? 0;
        }
        return used;
      } catch {
        return 0;
      }
    };
    const stopWorkerHeap = () => cdp.off('Target.receivedMessageFromTarget', onTargetMessage);
    const sample = async () => {
      while (sampler.on) {
        const heap = await page.evaluate(() => performance.memory?.usedJSHeapSize ?? 0).catch(() => 0);
        sampler.page = Math.max(sampler.page, heap);
        sampler.worker = Math.max(sampler.worker, await workerHeap());
        const mem = processMemory(profile);
        if (mem) {
          sampler.renderer = Math.max(sampler.renderer, mem.extensionRenderer || mem.renderers);
          sampler.browser = Math.max(sampler.browser, mem.browser);
        }
        await sleep(250);
      }
    };
    const frames = () =>
      page.evaluate(() => {
        window.__b64fFrames = { longest: 0, last: performance.now(), on: true };
        const tick = t => {
          const f = window.__b64fFrames;
          if (!f?.on) return;
          f.longest = Math.max(f.longest, t - f.last);
          f.last = t;
          requestAnimationFrame(tick);
        };
        requestAnimationFrame(tick);
      });
    const longest = () =>
      page.evaluate(() => {
        const f = window.__b64fFrames;
        f.on = false;
        delete window.__b64fFrames;
        return Math.round(f.longest);
      });
    const reset = () => Object.assign(sampler, { page: 0, worker: 0, renderer: 0, browser: 0 });
    const mib = n => Math.round(n / 1048576);
    const sampling = sample();

    // Encode: the start is shown, Copy refused in words, Save streams.
    await frames();
    let t0 = Date.now();
    await fileInput().setInputFiles(large);
    await page.waitForFunction(() => document.querySelector('#base64-file-result')?.value.length === 65536, null, {
      timeout: 60_000,
    });
    const previewMs = Date.now() - t0;
    const truncated = await page.locator('[data-part="truncated"]').innerText();
    const copyDisabled = await button('Copy').isDisabled();
    reset();
    t0 = Date.now();
    const savedText = await download('Save', 1_800_000, true);
    const encodeMs = Date.now() - t0;
    const encodeFrame = await longest();
    const encodeMem = { ...sampler };
    const textSize = statSync(savedText.path).size;
    const textOk = (await shaOfFile(savedText.path)) === expectedText;

    // Decode: the saved text, opened as a text file, decodes back to the file.
    await radio('Decode').click();
    await page.locator('#base64-file-input').waitFor();
    await frames();
    reset();
    t0 = Date.now();
    await page.locator('input[type="file"]').setInputFiles(savedText.path);
    await page.waitForFunction(
      () => document.querySelector('[data-fact="Type"]') && !document.querySelector('[data-part="working"]'),
      null,
      { timeout: 1_800_000, polling: 500 },
    );
    const decodeMs = Date.now() - t0;
    const decodeFrame = await longest();
    const decodeMem = { ...sampler };
    await savedText.file.delete();
    t0 = Date.now();
    const savedBytes = await download('Save file', 600_000, true);
    const saveFileMs = Date.now() - t0;
    const bytesOk = (await shaOfFile(savedBytes.path)) === expectedBytes;
    const bytesSize = statSync(savedBytes.path).size;
    sampler.on = false;
    await sampling;
    stopWorkerHeap();
    await savedBytes.file.delete();
    rmSync(large, { force: true });
    await button('Clear').click();

    facts.large = {
      bytes: LARGE,
      previewMs,
      encode: {
        ms: encodeMs,
        mibPerS: +(LARGE / 1048576 / (encodeMs / 1000)).toFixed(1),
        longestFrameMs: encodeFrame,
        pageHeapMiB: mib(encodeMem.page),
        workerHeapMiB: mib(encodeMem.worker),
        rendererMiB: encodeMem.renderer,
        browserMiB: encodeMem.browser,
        textBytes: textSize,
      },
      decode: {
        ms: decodeMs,
        mibPerS: +(LARGE / 1048576 / (decodeMs / 1000)).toFixed(1),
        longestFrameMs: decodeFrame,
        pageHeapMiB: mib(decodeMem.page),
        workerHeapMiB: mib(decodeMem.worker),
        rendererMiB: decodeMem.renderer,
        browserMiB: decodeMem.browser,
        saveFileMs,
      },
    };
    check(
      `${T}: §12 a file of ${LARGE.toLocaleString('en-US')} bytes — Save streams its Base64 to a file equal to Node's, that file decodes back to the same bytes; the page shows 65,536 characters and refuses Copy in words`,
      textOk &&
        bytesOk &&
        bytesSize === LARGE &&
        copyDisabled &&
        truncated.endsWith('Too large to copy: Save saves all.') &&
        encodeFrame < 500 &&
        decodeFrame < 500,
      JSON.stringify(facts.large),
    );
  }

  // ---- History (D17): a chosen file is kept as a blob without its name, opens back; a private key never
  await radio('Encode').click();
  await page.locator('[data-slot="file-drop"]').waitFor();
  await fileInput().setInputFiles({ name: 'secret-plan.pdf', mimeType: 'application/pdf', buffer: PDF });
  const record = await waitForHistoryRecord(
    page,
    'base64-file',
    r => r.kind === 'encode' && r.payload?.bytes === PDF.length,
  ).catch(() => null);
  const pkcs8 = Buffer.from([
    0x30, 0x10, 0x02, 0x01, 0x00, 0x30, 0x09, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x04, 0x00,
  ]);
  await fileInput().setInputFiles({ name: 'id.key', mimeType: '', buffer: pkcs8 });
  await waitFact('Type', 'DER private key (PKCS #8) (application/pkcs8)');
  const keyNote = await notes();
  await button('Copy').click();
  await sleep(500);
  const records = await historyRecords(page, 'base64-file');
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
    type: await historyPage.locator('[data-fact="Type"]').innerText(),
    file: await historyPage.locator('[data-fact="File"]').count(),
    result: await historyPage.locator('#base64-file-result').inputValue(),
  };
  await historyPage.close();
  check(
    `${T}: history — the chosen PDF is kept as a blob without its name or Base64 and opens back into Encode; the private key is never kept, and the page says so`,
    record !== null &&
      (record.blobs ?? []).some(b => b.name === 'file' && b.size === PDF.length) &&
      !JSON.stringify(record).includes('secret-plan') &&
      !JSON.stringify(record).includes(b64(PDF).slice(0, 16)) &&
      !records.some(r => r.payload?.type === 'pkcs8') &&
      keyNote.includes('Not kept in history: a private key is never kept.') &&
      reopened.restored.startsWith('Opened from History: Encode · PDF document') &&
      reopened.type === 'PDF document (application/pdf)' &&
      reopened.file === 0 &&
      reopened.result === b64(PDF),
    `${records.length} records; ${JSON.stringify(reopened)}`,
  );

  // ---- §7 on the start page: what opens for each kind of paste
  {
    const start = await ctx.newPage();
    const opens = {};
    for (const [kind, text] of [
      ['PDF data URI', `data:application/pdf;base64,${b64(PDF)}`],
      ['font data URI', 'data:font/woff2;base64,d09GMgABAAAAAA=='],
      ['text data URI', 'data:text/plain,hello%20world'],
      ['PDF Base64', b64(PDF)],
      ['gzip Base64', 'H4sIAAAAAAAAA+3BMQEAAADCoPVPbQwfoAAAAAAAAAAAAAAAAAAAAIA3mtidHgAoAAA='],
      ['certificate Base64', CERT_B64],
      [
        'PNG data URI',
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC',
      ],
      ['text Base64', 'SGVsbG8sIFdvcmxkIQ=='],
      ['PEM certificate', `-----BEGIN CERTIFICATE-----\n${CERT_B64}\n-----END CERTIFICATE-----`],
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
      `${T}: §7 on the start page — data URIs of a PDF, a font and text, Base64 of a PDF and a certificate open this tool, Base64 of gzip opens Compress; a PNG data URI opens Base64 Image, Base64 of text opens Base64, a PEM certificate X.509`,
      ['PDF data URI', 'font data URI', 'text data URI', 'PDF Base64', 'certificate Base64'].every(
        k => opens[k] === '#/tools/base64-file',
      ) &&
        // Compress / Decompress stands earlier in the registry and takes the gzip signature: what a person wants of it.
        opens['gzip Base64'] === '#/tools/compress' &&
        opens['PNG data URI'] === '#/tools/base64-image' &&
        opens['text Base64'] === '#/tools/base64' &&
        opens['PEM certificate'] === '#/tools/x509',
      JSON.stringify(opens),
    );
  }

  // ---- Saved parameters (D21): what a person chose in one tab is written 400 ms after the change; the tool opened
  // again in a new tab is as it was left, with nothing of the input.
  {
    await forgetSavedParameters(page, 'base64-file');
    const want = { alphabet: 'url', padding: false, lineLength: 76, mode: 'decode' };
    const same = (a, b) => JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b).sort());
    const stored = p =>
      p.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.['base64-file']);
    const chooser = await ctx.newPage();
    await chooser.goto(toolUrl);
    await chooser.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
    for (const [label, option] of [
      ['Alphabet', 'URL-safe'],
      ['Line length', '76'],
    ]) {
      await chooser.getByLabel(label, { exact: true }).click();
      await chooser.getByRole('option', { name: option, exact: true }).click();
    }
    await chooser.getByRole('radio', { name: 'Decode', exact: true }).click();
    for (let i = 0; i < 25 && !same((await stored(chooser))?.values, want); i++) await sleep(200);
    const kept = (await stored(chooser))?.values;
    await chooser.close();
    const again = await ctx.newPage();
    await again.goto(toolUrl);
    await again.locator('#base64-file-input').waitFor({ timeout: 30_000 });
    const opened = {
      decode: await again.getByRole('radio', { name: 'Decode', exact: true }).getAttribute('data-state'),
      input: await again.locator('#base64-file-input').inputValue(),
    };
    await again.getByRole('radio', { name: 'Encode', exact: true }).click();
    await again.locator('[data-slot="file-drop"]').waitFor();
    Object.assign(opened, {
      alphabet: await again.getByLabel('Alphabet', { exact: true }).innerText(),
      padding: await again.getByRole('checkbox', { name: 'Padding' }).getAttribute('aria-checked'),
      lineLength: await again.getByLabel('Line length', { exact: true }).innerText(),
      file: await again.locator('[data-encoded]').count(),
    });
    await again.close();
    facts.savedOpening = { kept, ...opened };
    check(
      `${T}: URL-safe, 76 and Decode chosen in one tab, the tool opened in another — Decode with the field empty; Encode with URL-safe, no padding, 76 and no file (saved parameters)`,
      same(kept, want) &&
        opened.decode === 'on' &&
        opened.input === '' &&
        opened.alphabet === 'URL-safe' &&
        opened.padding === 'false' &&
        opened.lineLength === '76' &&
        opened.file === 0,
      JSON.stringify(facts.savedOpening),
    );
    // The dark screenshots below expect the defaults.
    await forgetSavedParameters(page, 'base64-file');
  }

  // ---- Screenshots: dark
  await go(toolUrl);
  await page.locator('[data-slot="file-drop"]').waitFor({ timeout: 30_000 });
  await fileInput().setInputFiles({ name: 'server.der', mimeType: '', buffer: Buffer.from(CERT_B64, 'base64') });
  await page.locator('[data-encoded]').waitFor();
  await inDarkTheme(ctx, base, page, async () => {
    await settledShot(shoot, page, 'tool-base64-file-04-encode-dark.png');
    await radio('Decode').click();
    await put(`data:application/octet-stream;name=report.pdf;base64,${b64(PDF)}`);
    await waitFact('Type', 'PDF document (application/pdf)');
    await settledShot(shoot, page, 'tool-base64-file-05-decode-dark.png');
  });

  // ---- Nothing left the browser in the whole module; put back what was replaced
  const violations = await page
    .evaluate(() => {
      document.removeEventListener('securitypolicyviolation', window.__b64fListener);
      const v = window.__b64fViolations ?? [];
      delete window.__b64fViolations;
      delete window.__b64fListener;
      if (window.__b64fUrls) {
        URL.createObjectURL = window.__b64fUrls.create;
        URL.revokeObjectURL = window.__b64fUrls.revoke;
        delete window.__b64fUrls;
      }
      delete window.__b64fPwned;
      return v;
    })
    .catch(() => []);
  await clipboard.restore().catch(() => {});
  check(
    `${T}: the whole module — no request outside the extension (Playwright ${outside.length}, CDP ${cdpOutside.length}), none routed (${routed.length}), no policy violation`,
    outside.length === 0 && cdpOutside.length === 0 && routed.length === 0 && violations.length === 0,
    JSON.stringify({
      outside: outside.slice(0, 5),
      cdp: cdpOutside.slice(0, 5),
      routed: routed.slice(0, 5),
      violations,
    }),
  );

  ctx.off('request', onRequest);
  ctx.off('page', onPopup);
  cdp.off('Network.requestWillBeSent', onCdp);
  await cdp.detach().catch(() => {});
  await ctx.unroute(INVALID);
  rmSync(OUT, { recursive: true, force: true });
  await page.evaluate(url => location.replace(url), `${base}#/tools`);
  // Decode, chosen for the dark screenshot, is a saved parameter: the next module opens the tool with its defaults.
  await sleep(500);
  await forgetSavedParameters(page, 'base64-file').catch(() => {});
};
