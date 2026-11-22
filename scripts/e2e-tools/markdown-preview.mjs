// The Markdown Preview tool in the built extension (docs/tools/specs/markdown-preview.md): its scenarios (§2) with the
// page's real controls, then the tool's promise — "Nothing is loaded and nothing runs" — proved rather than assumed:
//   - the preview is a sandboxed srcdoc frame (no allow-scripts) with a policy of its own, filled by the page with nodes
//     of the allowlist; its stylesheet is a file of the package; it follows the theme;
//   - the hostile corpus (packages/tools/logic/markdown-preview/src/hostile-corpus.json, the unit tests' entries) typed
//     into the field: the frame holds only allowlisted nodes, as Chrome's own parser builds them;
//   - the layers under the allowlist on their own, on a page of their own: hostile elements written straight into the
//     frame's document, as if every rule of the logic had failed — nothing runs, loads or navigates;
//   - for the whole module: every request of the browser context outside the extension's files (Playwright and CDP),
//     a canary that a script would set on the parent and the top window, a message it would post, a value it would
//     write to chrome.storage or localStorage, the top page's address, and the console;
//   - links (http, https, a fragment, a relative address, a forbidden scheme) by click and by keyboard; a mailto: link
//     by its attributes only — a click would hand it to the mail program of the machine that runs the checks;
//   - §12: a megabyte of Markdown and the pathological shapes, timed with the longest task;
//   - the library only on the tool's page (requests), no eval in it; history (D17); light and dark screenshots.
// Every remote address is a reserved name (*.invalid, example.com) or a local port where nothing listens, and a route
// answers them locally: even a failed rule reaches no network, and the attempt is recorded as the tool's failure.
// Run by scripts/e2e-tools.mjs; navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, location, window, getComputedStyle, requestAnimationFrame, HTMLTextAreaElement, chrome, addEventListener -- page.evaluate callbacks run in the pages */

import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Markdown Preview';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const CORPUS = JSON.parse(
  readFileSync(join(ROOT, 'packages/tools/logic/markdown-preview/src/hostile-corpus.json'), 'utf8'),
);
/** Every remote address this module may cause: answered by a route, never by the network. */
const SAFE = /^(?:https?|wss?):\/\/(?:[^/?#@]*\.invalid|example\.com|127\.0\.0\.1:9)(?:[/?#:]|$)/;
const FRAME = 'iframe[title="Preview"]';
const SANDBOX = 'allow-same-origin allow-popups allow-popups-to-escape-sandbox';
/** What an injected script would do if it ran: the canary. */
const CANARY =
  'parent.__mdPwned=1;top.__mdPwned=1;window.__mdPwned=1;top.postMessage("md-pwned","*");' +
  'try{chrome.storage.local.set({mdPwned:1})}catch(e){}try{localStorage.setItem("mdPwned","1")}catch(e){}';

const README = [
  '# Project',
  '',
  'A tool that **does one thing** and does it _well_. See [the docs](https://example.com/docs) or the',
  '[contributing guide](./CONTRIBUTING.md).',
  '',
  '![CI](https://example.com/badge.svg)',
  '',
  '## Install',
  '',
  '```sh',
  'pnpm install',
  'pnpm build',
  '```',
  '',
  '| Option | Default | Meaning |',
  '|:--|:-:|--:|',
  '| `--watch` | off | rebuild on change |',
  '| `--out` | dist | where files go |',
  '',
  '- [x] tests',
  '- [ ] docs',
  '',
  '> Note: ~~old~~ new behaviour.',
  '',
  '1. one',
  '2. two',
  '',
  '<details><summary>More</summary>…</details>',
].join('\n');

/** What may be in the preview at all (§5.6), as the browser built it. */
const auditFrame = () => {
  const allowed = {
    ...Object.fromEntries(
      'p h1 h2 h3 h4 h5 h6 blockquote ul pre em strong s table thead tbody tr hr br'.split(' ').map(n => [n, {}]),
    ),
    ol: { start: '^\\d{1,9}$' },
    li: { class: '^task-list-item$' },
    th: { class: '^md-align-(left|center|right)$' },
    td: { class: '^md-align-(left|center|right)$' },
    code: { class: '^language-[\\p{L}\\p{N}_+#-]{1,32}$' },
    a: { href: '^(https?|mailto):', target: '^_blank$', rel: '^noopener noreferrer$', title: '' },
    input: { type: '^checkbox$', disabled: '^$', checked: '^$' },
    span: { class: '^(md-image|md-link-inactive)$', title: '^(Image not loaded|Not opened): ' },
    // the empty state's own line (the page writes it, not the allowlist)
  };
  const problems = [];
  for (const el of document.body.querySelectorAll('*')) {
    const rules = allowed[el.localName];
    if (!rules || el.namespaceURI !== 'http://www.w3.org/1999/xhtml') {
      problems.push(`<${el.localName}>`);
      continue;
    }
    for (const { name, value } of el.attributes)
      if (!(name in rules) || !new RegExp(rules[name], 'u').test(value)) problems.push(`<${el.localName} ${name}>`);
    // A control character or a space in an address: not one the tool opens.
    if (el.localName === 'a' && /[\s\p{Cc}]/u.test(el.getAttribute('href'))) problems.push('<a href> hidden');
  }
  for (const el of document.querySelectorAll(
    'img, script, iframe, object, embed, video, audio, link:not([rel="stylesheet"]), style, meta[http-equiv="refresh"], base, form',
  ))
    problems.push(`document has <${el.localName}>`);
  return problems;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const origin = `chrome-extension://${new URL(base).host}`;
  const timings = {};
  report.markdownPreview = timings;

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
  const input = page.locator('#markdown-preview-input');
  const frameEl = page.locator(FRAME);
  const button = name => page.getByRole('button', { name, exact: true });
  const errorLine = async () => (await page.locator('[data-part="error"]').innerText()).trim();
  const preview = async () => await (await frameEl.elementHandle()).contentFrame();
  const drawn = async () => Number((await frameEl.getAttribute('data-rendered')) ?? 0);
  /** Sets the field as a paste would (one input event), then waits for the preview drawn from it. */
  const show = async (text, timeout = 5000) => {
    const before = await drawn();
    await page.evaluate(value => {
      const field = document.querySelector('#markdown-preview-input');
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
  const bodyHtml = async () =>
    (await (await preview()).evaluate(() => document.body.innerHTML)).replace(/>\n</g, '><').replace(/\n$/, '');
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
      pwned: window.__mdPwned ?? null,
      messages: [...(window.__mdMessages ?? [])],
      local: localStorage.getItem('mdPwned'),
      storage: await new Promise(resolve =>
        chrome.storage.local.get('mdPwned', items => resolve(items?.mdPwned ?? null)),
      ),
    }));
  const armCanary = async target =>
    target.evaluate(() => {
      delete window.__mdPwned;
      window.__mdMessages = [];
      addEventListener('message', e => window.__mdMessages.push(String(e.data)));
    });

  // ---- The start route carries nothing of the tool; its page loads its chunk, its stylesheet, nothing else.
  await go('#/start');
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  const clipboard = await stubClipboard(page);
  try {
    const onStart = fetched.filter(u => /MarkdownPreviewTool-|\/preview-[\w-]+\.css/.test(u));
    fetched.length = 0;
    await go('#/tools/markdown-preview');
    await input.waitFor();
    await page.locator(`${FRAME}[data-rendered]`).waitFor();
    await armCanary(page);
    const chunk = fetched.find(u => /\/assets\/MarkdownPreviewTool-[\w-]+\.js$/.test(u));
    const sheet = fetched.find(u => /\/assets\/preview-[\w-]+\.css$/.test(u));
    const source = chunk ? await page.evaluate(url => fetch(url).then(r => r.text()), chunk) : '';
    const codeFromStrings = (source.match(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/g) ?? []).length;
    check(
      `${T}: the start route loads nothing of it; its page loads its chunk (markdown-it in it) and its frame’s stylesheet; no eval or Function in the chunk`,
      onStart.length === 0 &&
        Boolean(chunk && sheet) &&
        source.includes('markdown-it 15.0.3') &&
        source.includes('Image not loaded: ') &&
        codeFromStrings === 0,
      `start: ${onStart.length}; ${chunk?.replace(origin, '')} (${source.length} bytes, eval/Function: ${codeFromStrings}), ${sheet?.replace(origin, '')}`,
    );
    timings.chunkBytes = source.length;

    // ---- §6, §8: the empty page; the frame and what it is allowed.
    const frame = await preview();
    const empty = await frame.evaluate(async () => {
      await document.fonts.ready;
      const meta = document.querySelector('meta[http-equiv="Content-Security-Policy"]');
      const link = document.querySelector('link[rel="stylesheet"]');
      return {
        url: location.href,
        origin: window.origin,
        policy: meta?.getAttribute('content'),
        sheet: link?.href,
        rules: link?.sheet?.cssRules.length ?? 0,
        text: document.body.textContent,
        bodyClass: document.body.className,
        font: getComputedStyle(document.body).fontFamily,
        plex: document.fonts.check('14px "IBM Plex Sans"'),
        head: document.head.children.length,
      };
    });
    const emptyState = {
      sandbox: await frameEl.getAttribute('sandbox'),
      src: await frameEl.getAttribute('src'),
      placeholder: await input.getAttribute('placeholder'),
      spellcheck: await input.getAttribute('spellcheck'),
      copyOff: await button('Copy HTML').isDisabled(),
      error: await errorLine(),
      ...empty,
    };
    check(
      `${T}: opens empty — placeholder, “The preview appears here.”, Copy HTML off; the preview is an about:srcdoc frame sandboxed without scripts, with its own policy and the package’s stylesheet (IBM Plex)`,
      emptyState.sandbox === SANDBOX &&
        emptyState.src === null &&
        emptyState.url === 'about:srcdoc' &&
        emptyState.placeholder === '# Paste Markdown here' &&
        emptyState.spellcheck === 'false' &&
        emptyState.copyOff &&
        emptyState.error === '' &&
        emptyState.text === 'The preview appears here.' &&
        emptyState.bodyClass === 'md-preview' &&
        emptyState.policy?.includes("script-src 'none'") &&
        emptyState.policy?.includes("img-src 'none'") &&
        emptyState.sheet === sheet &&
        emptyState.rules > 30 &&
        emptyState.font.includes('IBM Plex Sans') &&
        emptyState.plex &&
        emptyState.head === 3,
      JSON.stringify(emptyState),
    );

    // ---- §2.1–2.3, 2.6: a README.
    await show(README);
    const readme = await frame.evaluate(() => ({
      h1: document.querySelector('h1')?.textContent,
      align: [...document.querySelectorAll('th')].map(th => [th.className, getComputedStyle(th).textAlign]),
      code: document.querySelector('pre > code.language-sh')?.textContent,
      mono: getComputedStyle(document.querySelector('pre > code')).fontFamily,
      boxes: [...document.querySelectorAll('input')].map(b => [b.type, b.disabled, b.checked, b.tabIndex]),
      image: [document.querySelector('.md-image')?.textContent, document.querySelector('.md-image')?.title],
      details: document.body.textContent.includes('<details><summary>More</summary>…</details>'),
      styled: document.querySelectorAll('[style]').length,
      imgs: document.querySelectorAll('img').length,
    }));
    check(
      `${T}: §2.1–2.3, 2.6 a README — heading, aligned table, monospaced code, disabled task boxes, an image frame with its address, raw HTML as text`,
      readme.h1 === 'Project' &&
        JSON.stringify(readme.align) ===
          JSON.stringify([
            ['md-align-left', 'left'],
            ['md-align-center', 'center'],
            ['md-align-right', 'right'],
          ]) &&
        readme.code === 'pnpm install\npnpm build\n' &&
        readme.mono.includes('IBM Plex Mono') &&
        JSON.stringify(readme.boxes) ===
          JSON.stringify([
            ['checkbox', true, true, 0],
            ['checkbox', true, false, 0],
          ]) &&
        readme.image[0] === 'CI' &&
        readme.image[1] === 'Image not loaded: https://example.com/badge.svg' &&
        readme.details &&
        readme.styled === 0 &&
        readme.imgs === 0,
      JSON.stringify(readme),
    );
    // ---- §2.7: Copy HTML takes the preview's HTML; the commit is in the history. (Before the screenshot: taking one
    // writes a `style` attribute on the frame's checkboxes for a moment — Playwright's, not the tool's.)
    const html = await frame.evaluate(() => document.body.innerHTML);
    await button('Copy HTML').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const copied = await clipboard.copied();
    const record = await waitForHistoryRecord(page, 'markdown-preview', r => r.label?.endsWith('HTML copied')).catch(
      () => null,
    );
    const last = copied.at(-1) ?? '';
    const differsAt = [...last].findIndex((c, i) => c !== html[i]);
    check(
      `${T}: §2.7 Copy HTML copies the preview’s HTML, says Copied, and the history keeps the Markdown as Previewed`,
      last === html && html.startsWith('<h1>Project</h1>') && record?.kind === 'preview',
      JSON.stringify({
        copied: last.length,
        shown: html.length,
        differsAt,
        near: [last.slice(differsAt - 20, differsAt + 40), html.slice(differsAt - 20, differsAt + 40)],
        label: record?.label,
        kind: record?.kind,
      }),
    );
    await settledShot(shoot, page, 'tool-markdown-preview-01-readme-light.png');
    const noRequestYet = { outside: [...outside], cdp: [...cdpOutside] };
    check(
      `${T}: the README with a remote image and links made no request at all`,
      noRequestYet.outside.length === 0 && noRequestYet.cdp.length === 0,
      JSON.stringify(noRequestYet),
    );

    // ---- §5.4: links, by click and by keyboard.
    await show(
      [
        '[https](https://example.com/docs) [http](http://ok.invalid/h) [mail](mailto:someone@mail.invalid)',
        '[frag](#section) [rel](./CONTRIBUTING.md) [scheme](chrome://settings)',
        '[js](javascript:parent.__mdPwned=1)',
      ].join('\n\n'),
    );
    const links = page.frameLocator(FRAME);
    const before = page.url();
    const https = await newTab(() => links.getByRole('link', { name: 'https' }).click());
    const http = await newTab(() => links.getByRole('link', { name: 'http', exact: true }).click());
    // Never clicked: the browser hands a mailto: address to the system's mail program, which opens a message there.
    const mailLink = links.getByRole('link', { name: 'mail' });
    const mail = {
      href: await mailLink.getAttribute('href'),
      target: await mailLink.getAttribute('target'),
      rel: await mailLink.getAttribute('rel'),
    };
    const inactive = [];
    for (const name of ['frag', 'rel', 'scheme'])
      inactive.push(await newTab(() => links.locator('.md-link-inactive', { hasText: name }).click()));
    const js = await newTab(() => links.getByText('[js](javascript:parent.__mdPwned=1)').click());
    // Keyboard: from Copy HTML, Tab enters the frame and reaches the first link; Enter opens it.
    await button('Copy HTML').focus();
    await page.keyboard.press('Tab');
    const focused = await frame.evaluate(() => document.activeElement?.textContent);
    const byKey = await newTab(() => page.keyboard.press('Enter'));
    const after = {
      https,
      http,
      mail,
      inactive,
      js,
      focused,
      byKey,
      top: page.url() === before,
      frame: (await preview()).url(),
      titles: await frame.evaluate(() => [...document.querySelectorAll('.md-link-inactive')].map(s => s.title)),
      routed: [...routed],
    };
    check(
      `${T}: §5.4 http and https open a new tab (no opener), by click and by Enter; a fragment, a relative address and another scheme are inactive with “Not opened: …”; javascript: stays text; the page and the frame stay`,
      https?.url === 'https://example.com/docs' &&
        https.noOpener === true &&
        http?.url === 'http://ok.invalid/h' &&
        http.noOpener === true &&
        mail.href === 'mailto:someone@mail.invalid' &&
        mail.target === '_blank' &&
        mail.rel === 'noopener noreferrer' &&
        inactive.every(x => x === null) &&
        js === null &&
        focused === 'https' &&
        byKey?.url === 'https://example.com/docs' &&
        after.top &&
        after.frame === 'about:srcdoc' &&
        JSON.stringify(after.titles) ===
          JSON.stringify(['Not opened: #section', 'Not opened: ./CONTRIBUTING.md', 'Not opened: chrome://settings']) &&
        JSON.stringify(after.routed) ===
          JSON.stringify(['https://example.com/docs', 'http://ok.invalid/h', 'https://example.com/docs']),
      JSON.stringify(after),
    );
    const expectedOutside = [...routed];

    // ---- §6 rows.
    const rows = {};
    await show(' \n\n  \n');
    rows.blank = [await bodyHtml(), await button('Copy HTML').isDisabled()];
    await show('www.example.com');
    rows.www = await bodyHtml();
    await show('Привет, **мир** 👋');
    rows.unicode = await bodyHtml();
    await show('footnote[^1]\n\n[^1]: note');
    rows.footnote = await bodyHtml();
    await show('![](data:image/png;base64,AAAA)');
    rows.data = await bodyHtml();
    check(
      `${T}: §6 blank input — empty, Copy HTML off; www. is text; Unicode as is; a footnote is an inactive link; a data: image is a frame`,
      rows.blank[0] === '' &&
        rows.blank[1] === true &&
        rows.www === '<p>www.example.com</p>' &&
        rows.unicode === '<p>Привет, <strong>мир</strong> 👋</p>' &&
        rows.footnote === '<p>footnote<span class="md-link-inactive" title="Not opened: note">^1</span></p>' &&
        rows.data === '<p><span class="md-image" title="Image not loaded: data:image/png;base64,AAAA">image</span></p>',
      JSON.stringify(rows),
    );

    // ---- The hostile corpus through the field: the browser's own parser, the allowlist, the frame.
    const consoleBefore = consoleLines.length;
    const audits = [];
    for (const entry of CORPUS) {
      await show(entry.markdown);
      const problems = await (await preview()).evaluate(auditFrame);
      if (problems.length) audits.push({ name: entry.name, problems });
    }
    await show(CORPUS.map(e => e.markdown).join('\n\n'));
    const whole = await (await preview()).evaluate(auditFrame);
    // Hover every link and inactive link (a preconnect on hover would show as a request), then wait.
    const targets = await page.frameLocator(FRAME).locator('a, .md-link-inactive, .md-image').all();
    for (const target of targets.slice(0, 40)) await target.hover({ timeout: 1000 }).catch(() => {});
    await sleep(1000);
    const corpus = {
      entries: CORPUS.length,
      audits,
      whole,
      hovered: Math.min(targets.length, 40),
      outside: outside.filter(u => !expectedOutside.includes(u)),
      cdp: cdpOutside.filter(u => !expectedOutside.includes(u)),
      routed: routed.slice(expectedOutside.length),
      canary: await canary(page),
      frameCanary: await (await preview()).evaluate(() => window.__mdPwned ?? null),
      top: page.url() === before,
      frame: (await preview()).url(),
      console: consoleLines.slice(consoleBefore),
    };
    check(
      `${T}: the hostile corpus (${CORPUS.length} entries and all at once) — only allowlisted nodes in the frame; no request, no script, no message, no storage write, no navigation, no console line`,
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
    await settledShot(shoot, page, 'tool-markdown-preview-02-hostile-light.png');

    // ---- §12: large inputs and the pathological shapes, timed with the longest task.
    const timed = (text, timeout = 20_000) =>
      page.evaluate(
        async ([value, sel, limit]) => {
          const field = document.querySelector('#markdown-preview-input');
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
          // the frame's layout of what was drawn
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
    const section = i =>
      `## Section ${i}\n\nSome *text* with a [link](https://example.com/${i}) and \`code\`.\n\n- item\n- item\n\n| a | b |\n|---|---|\n| ${i} | x |\n\n`;
    const sized = n => {
      let out = '';
      for (let i = 0; out.length < n; i++) out += section(i);
      return out.slice(0, n);
    };
    const large = {};
    large.live64k = await timed(sized(64 * 1024));
    large.settled256k = await timed(sized(256 * 1024));
    large.max1m = await timed(sized(1024 * 1024));
    // Above 64 Ki markdown-it runs in the tool's module worker, a file of the package, with no eval or Function in it.
    const workerUrl = page
      .workers()
      .map(w => w.url())
      .find(u => u.includes('/assets/markdown.worker-'));
    const workerSource = workerUrl ? await page.evaluate(url => fetch(url).then(r => r.text()), workerUrl) : '';
    large.worker = {
      url: workerUrl?.replace(origin, '') ?? null,
      bytes: workerSource.length,
      evals: (workerSource.match(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/g) ?? []).length,
    };
    large.brackets = await timed('['.repeat(1024 * 1024));
    large.images = await timed('!['.repeat(512 * 1024));
    large.emphasis = await timed('*a'.repeat(512 * 1024));
    large.quotes = await timed('>'.repeat(1024 * 1024));
    large.pipes = await timed(`${'|a'.repeat(256 * 1024 - 1)}\n${'|-'.repeat(256 * 1024 - 1)}`);
    const refusedAt = performance.now();
    await page.evaluate(
      value => {
        const field = document.querySelector('#markdown-preview-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
      },
      'x'.repeat(1024 * 1024 + 1),
    );
    await page
      .getByText('Text is larger than 1 MB. Markdown Preview works with up to 1 MB.')
      .waitFor({ timeout: 5000 });
    large.refused = {
      ms: Math.round(performance.now() - refusedAt),
      empty: await (await preview()).evaluate(() => document.body.childElementCount === 0),
      copyOff: await button('Copy HTML').isDisabled(),
    };
    // Still responsive: a small edit after all that draws at once.
    large.after = await timed('# back');
    Object.assign(timings, large);
    const shapes = ['brackets', 'images', 'emphasis', 'quotes', 'pipes'];
    check(
      `${T}: §12 64 Ki at once, 256 Ki and 1 Mi after the pause, the pathological megabytes all drawn (markdown-it in the tool’s worker, no eval in it), no task of 3 s; above 1 Mi refused at once; the page answers after`,
      [large.live64k, large.settled256k, large.max1m, ...shapes.map(s => large[s]), large.after].every(t => t.drawn) &&
        large.settled256k.elapsed >= 300 &&
        // no shape holds the page for seconds (a table of 131 071 columns once held it for 293 s: collapsed borders)
        [large.live64k, large.settled256k, large.max1m, ...shapes.map(s => large[s])].every(t => t.longest < 3000) &&
        large.worker.url?.startsWith('/assets/markdown.worker-') &&
        workerSource.includes('markdown-it 15.0.3') &&
        large.worker.evals === 0 &&
        large.refused.empty &&
        large.refused.copyOff &&
        large.after.elapsed < 1000,
      JSON.stringify(large),
    );

    // ---- The theme: the frame follows the page into the dark theme and back, without a reload.
    await show(README);
    const themeOf = async () =>
      (await preview()).evaluate(() => ({
        theme: document.documentElement.getAttribute('data-theme'),
        mode: document.documentElement.getAttribute('data-mode'),
        background: getComputedStyle(document.documentElement).backgroundColor,
        color: getComputedStyle(document.body).color,
      }));
    const pageBackground = () => page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    const light = { ...(await themeOf()), page: await pageBackground() };
    const drawsBefore = await drawn();
    const dark = await inDarkTheme(ctx, base, page, async () => {
      await page
        .waitForFunction(
          sel => document.querySelector(sel).contentDocument.documentElement.dataset.mode === 'dark',
          FRAME,
          {
            timeout: 5000,
          },
        )
        .catch(() => {});
      const seen = { ...(await themeOf()), page: await pageBackground() };
      await settledShot(shoot, page, 'tool-markdown-preview-03-readme-dark.png');
      return seen;
    });
    await page
      .waitForFunction(
        sel => document.querySelector(sel).contentDocument.documentElement.dataset.mode === 'light',
        FRAME,
        {
          timeout: 5000,
        },
      )
      .catch(() => {});
    const back = await themeOf();
    check(
      `${T}: the frame wears the page’s theme — light, then dark, then light again, without being drawn again`,
      light.mode === 'light' &&
        light.background === light.page &&
        dark.mode === 'dark' &&
        dark.theme === 'default-dark' &&
        dark.background === dark.page &&
        dark.background !== light.background &&
        back.mode === 'light' &&
        (await drawn()) === drawsBefore,
      JSON.stringify({ light, dark, back }),
    );

    // ---- D17: the copied entry opens back into the tool.
    await go('#/start');
    await go('#/tools/markdown-preview');
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
      input: (await input.inputValue()) === README,
      h1: await (await preview()).evaluate(() => document.querySelector('h1')?.textContent ?? null),
    };
    check(
      `${T}: a copied preview is in the tool’s history as Previewed and opens back into the tool, drawn again`,
      restored.listed > 0 && restored.kind === 'Previewed' && restored.input && restored.h1 === 'Project',
      JSON.stringify(restored),
    );
  } finally {
    await clipboard.restore().catch(() => {});
  }

  // ---- The layers under the allowlist, alone, on a page of their own (its console is this check's, not the run's):
  // hostile elements written straight into the frame's document, as if markdown-it and the allowlist had both failed.
  const probe = await ctx.newPage();
  const probeConsole = [];
  probe.on('console', m => probeConsole.push(`${m.type()}: ${m.text()}`));
  const probeErrors = [];
  probe.on('pageerror', e => probeErrors.push(String(e)));
  const routedBefore = routed.length;
  // Each request the frame's document starts outside the extension, and whether Chrome refused it before it left
  // (`blockedReason`: the policy, the sandbox) — only a request that reaches the network layer reaches the route.
  const probeCdp = await ctx.newCDPSession(probe);
  await probeCdp.send('Network.enable');
  const started = new Map();
  const blocked = new Map();
  // `data:` aside: the browser's own media controls draw their icons from data: SVGs (no network, not the content's).
  probeCdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith(origin) && !e.request.url.startsWith('data:'))
      started.set(e.requestId, e.request.url);
  });
  probeCdp.on('Network.loadingFailed', e => {
    if (started.has(e.requestId)) blocked.set(e.requestId, e.blockedReason ?? `failed: ${e.errorText}`);
  });
  try {
    await probe.goto(`${base}#/tools/markdown-preview`);
    await probe.locator(`${FRAME}[data-rendered]`).waitFor();
    await armCanary(probe);
    const scriptFile = `${origin}/theme-boot.js`;
    const injected = await probe.evaluate(
      ([sel, code, file]) => {
        const doc = document.querySelector(sel).contentDocument;
        doc.documentElement.setAttribute('data-theme', 'canary');
        const add = html => {
          const holder = doc.createElement('div');
          holder.innerHTML = html; // test code: the allowlist is bypassed on purpose
          doc.body.append(holder);
        };
        const script = doc.createElement('script');
        script.textContent = code;
        doc.body.append(script);
        const own = doc.createElement('script');
        own.src = file; // a file of the package: script-src 'self' of the page would let it run, the sandbox does not
        doc.body.append(own);
        const style = doc.createElement('style');
        style.textContent =
          '@import url(http://css.invalid/import.css); body { background: url(http://css.invalid/bg.png) }';
        doc.head.append(style);
        const meta = doc.createElement('meta');
        meta.httpEquiv = 'refresh';
        meta.content = '0;url=http://nav.invalid/refresh';
        doc.head.append(meta);
        add(`<img src="http://img.invalid/inject.png" onerror='${code}'>`);
        add(
          `<svg onload='${code}'><use href="http://svg.invalid/s.svg#a"></use><image href="http://img.invalid/svg.png"></image></svg>`,
        );
        add('<picture><source srcset="http://img.invalid/a.webp"><img src="http://img.invalid/b.png"></picture>');
        add('<video src="http://media.invalid/v.mp4" poster="http://img.invalid/poster.png" autoplay muted></video>');
        add('<audio src="http://media.invalid/a.mp3" autoplay></audio>');
        add(
          '<iframe src="http://frame.invalid/"></iframe><object data="http://object.invalid/x"></object><embed src="http://embed.invalid/x">',
        );
        add(
          '<link rel="stylesheet" href="http://css.invalid/a.css"><link rel="preconnect" href="http://preconnect.invalid"><link rel="dns-prefetch" href="//dns.invalid"><link rel="prefetch" href="http://prefetch.invalid/a">',
        );
        add('<input type="image" src="http://img.invalid/input.png">');
        add('<div style="background:url(http://css.invalid/inline.png);width:10px;height:10px"></div>');
        add('<base href="http://base.invalid/">');
        add(
          `<form action="http://form.invalid/submit" method="post"><input name="q" value="x"><button id="md-submit">Go</button></form>`,
        );
        add(`<a id="md-js" href='javascript:${code}'>js</a>`);
        add(
          '<a id="md-ping" href="http://ok.invalid/ping-target" target="_blank" ping="http://ping.invalid/">ping</a>',
        );
        add('<a id="md-top" href="http://nav.invalid/top" target="_top">top</a>');
        return doc.body.querySelectorAll('*').length;
      },
      [FRAME, CANARY, scriptFile],
    );
    const inner = probe.frameLocator(FRAME);
    await inner
      .locator('#md-submit')
      .click({ timeout: 2000 })
      .catch(() => {});
    await inner
      .locator('#md-js')
      .click({ timeout: 2000 })
      .catch(() => {});
    const pingTab = await (async () => {
      const before = popups.length;
      await inner
        .locator('#md-ping')
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
      .locator('#md-top')
      .click({ timeout: 2000 })
      .catch(() => {});
    await sleep(1500);
    const probeFrame = await (await probe.locator(FRAME).elementHandle()).contentFrame();
    const layers = {
      injected,
      canary: await canary(probe),
      frameCanary: await probeFrame.evaluate(() => window.__mdPwned ?? null).catch(e => `unreadable: ${e}`),
      ownScriptRan:
        (await probeFrame.evaluate(() => document.documentElement.getAttribute('data-theme')).catch(() => null)) !==
        'canary',
      top: probe.url() === `${base}#/tools/markdown-preview`,
      frame: probeFrame.url(),
      pingTab,
      // what the frame's document started, and why Chrome stopped each before it left
      refused: [...started].map(([id, url]) => `${url} — ${blocked.get(id) ?? 'not refused'}`),
      // what left: the new tab of the link with target=_blank (its ping did not)
      routed: routed.slice(routedBefore),
      errors: probeErrors,
    };
    // Every console line explained: what the sandbox or a policy refused.
    const EXPLAINED = [
      /Blocked script execution in 'about:srcdoc' because the document's frame is sandboxed and the 'allow-scripts' permission is not set/,
      /Refused to (load|apply|connect|frame|execute)/,
      /Blocked form submission to '[^']*' because the form's frame is sandboxed and the 'allow-forms' permission is not set/,
      /Unsafe attempt to initiate navigation for frame/,
      /Refused to execute the redirect|Refused to refresh/i,
      /Content Security Policy/,
      /Unsafe attempt to load URL \S+ from frame with URL about:srcdoc\. Domains, protocols and ports must match/,
    ];
    const unexplained = probeConsole.filter(line => !EXPLAINED.some(re => re.test(line)));
    layers.console = probeConsole.length;
    layers.kinds = [...new Set(probeConsole.map(line => EXPLAINED.findIndex(re => re.test(line))))];
    layers.unexplained = unexplained;
    check(
      `${T}: with the allowlist bypassed (${'hostile elements written into the frame'}) the sandbox and the policies alone run nothing, load nothing, navigate nothing; every console line is a refusal`,
      layers.canary.pwned === null &&
        layers.canary.messages.length === 0 &&
        layers.canary.local === null &&
        layers.canary.storage === null &&
        layers.frameCanary === null &&
        layers.ownScriptRan === false &&
        layers.top &&
        layers.frame === 'about:srcdoc' &&
        layers.pingTab === 'http://ok.invalid/ping-target' &&
        [...started.keys()].every(id => /^(csp|origin)$/.test(blocked.get(id) ?? '')) &&
        JSON.stringify(layers.routed) === JSON.stringify(['http://ok.invalid/ping-target']) &&
        layers.errors.length === 0 &&
        unexplained.length === 0,
      JSON.stringify(layers),
    );
    timings.layers = { console: probeConsole, kinds: layers.kinds };
  } finally {
    await probeCdp.detach().catch(() => {});
    await probe.close().catch(() => {});
  }

  // ---- Leave the page where the next module may start.
  await input.waitFor();
  await show('');
  await go('#/start');
  for (const p of popups) await p.close().catch(() => {});
  await ctx.unroute(SAFE);
  ctx.off('request', onRequest);
  ctx.off('page', onPopup);
  page.off('request', onPageRequest);
  page.off('console', onConsole);
  await cdp.detach().catch(() => {});
};
