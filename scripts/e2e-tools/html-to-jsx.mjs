// The HTML to JSX tool in the built extension (docs/tools/specs/html-to-jsx.md): its scenarios (§2) with the page's
// real controls and a stubbed clipboard, the notes (§5), the keyboard (§8), the limits timed in Chrome (§12), the table
// of attribute names loading only with the first input, an entry opened back from the tool's history (D17), the page in
// the light and the dark theme — and the two promises of §11 and §10:
//   - parsing runs nothing and loads nothing: markup with scripts, handlers, images, links, frames, objects, a refresh,
//     <base>, SVG <use> and <image>, CSS url() in style attributes — no request outside the extension (Playwright and
//     CDP), no canary set, no navigation, no securitypolicyviolation and no console line; a probe page of its own shows
//     the same markup does raise violations when parsed as a fragment (the probe sees them) and what <template> does;
//   - Chrome's result equals jsdom's character for character on every example of §10 and every hostile input
//     (packages/tools/ui/html-to-jsx/src/examples.json): the page's output against the logic run in Node with jsdom;
//     every difference is listed in the report.
// Also what the start page does with pasted HTML and SVG: the tool has no detect (§7); the tools whose detect answers,
// in registry order, are found by running every tool's detect module (bundled by esbuild) in Node.
// Run by scripts/e2e-tools.mjs; navigates by replacing the current history entry (Chrome keeps 50 per tab).

/* global document, location, DOMParser, HTMLTextAreaElement, DataTransfer, ClipboardEvent, window */

import { extensionOrigin, inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const T = 'HTML to JSX';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const UI = join(ROOT, 'packages/tools/ui/html-to-jsx');
const LOGIC = pathToFileURL(join(ROOT, 'packages/tools/logic/html-to-jsx/src/index.ts')).href;
const EXAMPLES = JSON.parse(readFileSync(join(UI, 'src/examples.json'), 'utf8'));

/** The logic in Node with jsdom's parser (Node strips the types): the result and the notes of every input. */
const NODE_SIDE = `
import { readFileSync } from 'node:fs';
import { JSDOM } from 'jsdom';
const { htmlToJsx, loadAttributeNames, describeNotes } = await import(process.argv[1]);
const inputs = JSON.parse(readFileSync(0, 'utf8'));
const names = await loadAttributeNames();
const { DOMParser } = new JSDOM('').window;
const parse = s => new DOMParser().parseFromString(s, 'text/html');
process.stdout.write(JSON.stringify(inputs.map(e => {
  const r = htmlToJsx(e.input, { component: !!e.component }, parse, names);
  return { text: r.text, notes: describeNotes(r.notes) };
})));
`;

/** Every tool's detect, in registry order, on the pasted texts: bundled by esbuild from the ui packages, run in Node. */
const detectAnswers = texts => {
  const esbuild = createRequire(join(UI, 'package.json'))('esbuild');
  const tools = readdirSync(join(ROOT, 'packages/tools/ui'))
    .filter(id => existsSync(join(ROOT, 'packages/tools/ui', id, 'src/definition.ts')))
    .map(id => {
      const definition = readFileSync(join(ROOT, 'packages/tools/ui', id, 'src/definition.ts'), 'utf8');
      return { id, order: Number(/order:\s*(\d+)/.exec(definition)?.[1] ?? 999) };
    })
    .sort((a, b) => a.order - b.order);
  const withDetect = tools.filter(t => existsSync(join(ROOT, 'packages/tools/ui', t.id, 'src/detect.ts')));
  const entry = withDetect
    .map(
      (t, i) =>
        `export { detect as d${i} } from ${JSON.stringify(join(ROOT, 'packages/tools/ui', t.id, 'src/detect.ts'))};`,
    )
    .join('\n');
  const bundle = esbuild.buildSync({
    stdin: { contents: entry, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
  }).outputFiles[0].text;
  const script = `
    const m = await import('data:text/javascript;base64,' + process.argv[1]);
    const texts = JSON.parse(process.argv[2]);
    const ids = JSON.parse(process.argv[3]);
    process.stdout.write(JSON.stringify(texts.map(t => ids.filter((_, i) => { try { return m['d' + i](t); } catch { return false; } }))));
  `;
  const out = execFileSync(
    process.execPath,
    [
      '--no-warnings',
      '--input-type=module',
      '-e',
      script,
      Buffer.from(bundle).toString('base64'),
      JSON.stringify(texts),
      JSON.stringify(withDetect.map(t => t.id)),
    ],
    { maxBuffer: 16 * 1024 * 1024 },
  ).toString('utf8');
  return { answers: JSON.parse(out), detecting: withDetect.map(t => `${t.order} ${t.id}`) };
};

/** What would show that something ran: a canary on the document, a message, a storage write. */
const CANARY = "document.documentElement.dataset.hjPwned='1'";
const PROBE = 'https://inert-probe.invalid';
/** Markup that would load or run something anywhere else (§11). */
const HOSTILE = [
  `<script>${CANARY}</script>`,
  `<script src="${PROBE}/s.js"></script>`,
  `<img src="${PROBE}/i.png" srcset="${PROBE}/i2.png 2x" onerror="${CANARY}" onload="${CANARY}">`,
  `<link rel="stylesheet" href="${PROBE}/s.css"><link rel="preload" as="image" href="${PROBE}/p.png">`,
  `<iframe src="${PROBE}/f.html" onload="${CANARY}"></iframe><iframe srcdoc="<script>${CANARY}</script>"></iframe>`,
  `<object data="${PROBE}/o.swf"></object><embed src="${PROBE}/e.swf">`,
  `<meta http-equiv="refresh" content="0;url=${PROBE}/r">`,
  `<base href="${PROBE}/">`,
  `<svg onload="${CANARY}"><use href="${PROBE}/u.svg#a"/><image href="${PROBE}/s.png"/></svg>`,
  `<div style="background: url(${PROBE}/bg.png); color: red">bg</div>`,
  `<p style="background-image: url('${PROBE}/q.png')">q</p>`,
  `<video autoplay src="${PROBE}/v.mp4" poster="${PROBE}/poster.png"></video><audio autoplay src="${PROBE}/a.mp3"></audio>`,
  `<style>@import url(${PROBE}/i.css); p { background: url(${PROBE}/p.png) }</style>`,
  `<input autofocus onfocus="${CANARY}"><details open ontoggle="${CANARY}"><summary>s</summary></details>`,
  `<a href="javascript:${CANARY}" ping="${PROBE}/ping">js</a><form action="${PROBE}/f"><button>go</button></form>`,
].join('\n');

const show = s => JSON.stringify(s).slice(0, 90);

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const origin = extensionOrigin(base);
  const frame = page.locator('[data-slot="tool-page"]');
  const input = page.locator('#html-to-jsx-input');
  const result = page.locator('#html-to-jsx-output');
  const notes = page.locator('[data-part="note"]');
  const status = page.locator('[data-part="status"]');
  const wrap = page.getByRole('checkbox', { name: 'Wrap in a component' });
  const button = name => page.getByRole('button', { name, exact: true });
  const noteText = async () => (await notes.allInnerTexts()).map(t => t.trim()).filter(Boolean);
  const go = async hash => {
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5000 });
  };
  /** Sets the field as a paste would (one input event). */
  const setInput = value =>
    page.evaluate(v => {
      const field = document.querySelector('#html-to-jsx-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, v);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, value);
  const resultValue = () => page.evaluate(() => document.querySelector('#html-to-jsx-output').value);
  /** Sets the input and waits for a result other than `previous`. */
  const convert = async (value, previous) => {
    await setInput(value);
    await page
      .waitForFunction(p => document.querySelector('#html-to-jsx-output').value !== p, previous, { timeout: 10_000 })
      .catch(() => {});
    return resultValue();
  };
  let marker = 0;
  /** The result of `value`, certainly made from it: a unique marker first, then the input. */
  const resultOf = async value => {
    const sentinel = await convert(`<i>marker-${++marker}</i>`, await resultValue());
    return convert(value, sentinel);
  };

  // What leaves the extension: Playwright's view of the context and CDP's of the page; the page's own console lines;
  // what the page fetched from the package (which chunk loads when).
  const outside = [];
  const onRequest = request => {
    if (!request.url().startsWith(origin)) outside.push(request.url());
  };
  ctx.on('request', onRequest);
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable');
  const cdpOutside = [];
  cdp.on('Network.requestWillBeSent', e => {
    if (!e.request.url.startsWith(origin)) cdpOutside.push(e.request.url);
  });
  const fetched = [];
  const onPageRequest = request => fetched.push(request.url());
  page.on('request', onPageRequest);
  const consoleLines = [];
  const onConsole = m => {
    if (m.type() === 'error' || m.type() === 'warning') consoleLines.push(`${m.type()}: ${m.text()}`);
  };
  page.on('console', onConsole);

  // The start route never loads the tool or its table; opening the tool loads its chunk; the table waits for input.
  await go('#/start');
  fetched.length = 0;
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await sleep(500);
  const onStart = [...fetched];
  await go('#/tools/html-to-jsx');
  await input.waitFor();
  await page.waitForFunction(() => !document.body.textContent.includes('Loading…'), null, { timeout: 10_000 });
  await sleep(300);
  const opened = [...fetched];
  const table = list => list.filter(n => /attribute-names/.test(n)).length;
  check(
    `${T}: opens empty — Wrap off, no Convert, Copy off, the placeholder; no line under either field`,
    (await wrap.getAttribute('aria-checked')) === 'false' &&
      (await input.inputValue()) === '' &&
      (await input.getAttribute('placeholder')) === '<div class="card">Hello</div>' &&
      (await input.getAttribute('spellcheck')) === 'false' &&
      (await result.getAttribute('spellcheck')) === 'false' &&
      (await result.getAttribute('readonly')) !== null &&
      (await button('Convert').count()) === 0 &&
      (await button('Copy').isDisabled()) &&
      (await status.innerText()).trim() === '' &&
      (await noteText()).length === 0,
  );
  const clipboard = await stubClipboard(page);
  try {
    // §2.1 — at once.
    const s1 = await resultOf('<label class="field" for="email">Email</label>');
    const afterInput = [...fetched];
    check(
      `${T}: the table of attribute names is not on the start route; it loads with the first input, not with the page`,
      !onStart.some(n => /HtmlToJsxTool|attribute-names/.test(n)) &&
        opened.some(n => /HtmlToJsxTool/.test(n)) &&
        table(opened) === 0 &&
        table(afterInput) === 1,
      `start: ${onStart.filter(n => /assets/.test(n)).length} chunks; tool open: table ${table(opened)}; after input: ${table(afterInput)}`,
    );
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const copied = await clipboard.copied();
    check(
      `${T}: §2.1 <label class for> → className, htmlFor at once; Copy copies the result, Copied`,
      s1 === '<label className="field" htmlFor="email">Email</label>\n' && copied.at(-1) === s1,
      show(s1),
    );

    // §2.2 — an icon.
    const s2 = await resultOf(
      '<svg viewBox="0 0 24 24"><path stroke-width="2" fill-rule="evenodd" d="M12 2 2 22h20z"/></svg>',
    );
    check(
      `${T}: §2.2 an SVG icon — strokeWidth, fillRule, self-closing path`,
      s2 === '<svg viewBox="0 0 24 24">\n  <path strokeWidth="2" fillRule="evenodd" d="M12 2 2 22h20z" />\n</svg>\n',
      show(s2),
    );

    // §2.3 — a checkbox.
    const s3 = await resultOf('<input type="checkbox" checked disabled="disabled" tabindex="0">');
    check(
      `${T}: §2.3 a checkbox — defaultChecked, disabled, tabIndex={0}`,
      s3 === '<input type="checkbox" defaultChecked disabled tabIndex={0} />\n',
      show(s3),
    );

    // §2.4 — a handler, with its note.
    const s4 = await resultOf('<a href="#" onclick="save(event); return false;">Save</a>');
    const n4 = await noteText();
    check(
      `${T}: §2.4 onclick → an arrow function with (event); the note asks to check it`,
      s4 === '<a href="#" onClick={(event) => { save(event); return false }}>Save</a>\n' &&
        n4.join('|') === '1 inline event handler became an arrow function with the same code: check it.',
      `${show(s4)} · ${n4.join('|')}`,
    );
    await settledShot(shoot, frame, 'tool-html-to-jsx-01-handler-light.png');

    // §2.5 — a fragment, then Wrap in a component.
    const s5 = await resultOf('<p>First paragraph.</p>\n<p>Second paragraph.</p>');
    await wrap.click();
    await page.waitForFunction(() => document.querySelector('#html-to-jsx-output').value.startsWith('export'), null, {
      timeout: 5000,
    });
    const s5w = await resultValue();
    check(
      `${T}: §2.5 two paragraphs → <>…</>; Wrap in a component → export default function Component()`,
      s5 === '<>\n  <p>First paragraph.</p>\n  <p>Second paragraph.</p>\n</>\n' &&
        s5w ===
          'export default function Component() {\n  return (\n    <>\n      <p>First paragraph.</p>\n      <p>Second paragraph.</p>\n    </>\n  );\n}\n',
      show(s5w),
    );
    await settledShot(shoot, frame, 'tool-html-to-jsx-02-component-light.png');
    await wrap.click();

    // §2.6 — a whole page.
    const s6 = await resultOf(
      '<!DOCTYPE html>\n<html lang="en">\n<head><meta charset="utf-8"><title>Page</title><link rel="stylesheet" href="s.css"></head>\n<body>\n  <main class="page">\n    <h1>Hello</h1>\n  </main>\n</body>\n</html>',
    );
    const n6 = await noteText();
    check(
      `${T}: §2.6 a whole page → the contents of <body>, with the note`,
      s6 === '<main className="page">\n  <h1>Hello</h1>\n</main>\n' &&
        n6.join('|') === 'Converted the contents of <body>; <head> and the doctype were left out.',
      `${show(s6)} · ${n6.join('|')}`,
    );

    // §8: the keyboard — Tab passes Wrap in a component, the input, Copy, the result.
    await wrap.focus();
    const order = [];
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el.id || el.textContent.trim().slice(0, 20);
        }),
      );
    }
    await wrap.focus();
    await page.keyboard.press('Space');
    const spaced = (await wrap.getAttribute('aria-checked')) === 'true';
    await page.keyboard.press('Space');
    check(
      `${T}: §8 Tab order is Wrap in a component, input, Copy, result; Space toggles Wrap`,
      order.join(' → ') === 'html-to-jsx-input → Copy → html-to-jsx-output' && spaced,
      `${order.join(' → ')}; Space ${spaced}`,
    );

    // §10 and the hostile inputs: Chrome's result against jsdom's, character for character.
    const all = [
      ...EXAMPLES.spec.map(e => ({ ...e, set: 'spec' })),
      ...EXAMPLES.hostile.map(e => ({ ...e, set: 'hostile' })),
    ];
    let node;
    try {
      node = JSON.parse(
        execFileSync(process.execPath, ['--no-warnings', '--input-type=module', '-e', NODE_SIDE, LOGIC], {
          cwd: UI,
          input: JSON.stringify(all),
          maxBuffer: 64 * 1024 * 1024,
        }).toString('utf8'),
      );
    } catch (error) {
      node = { error: String(error).slice(0, 600) };
    }
    if (node.error)
      check(`${T}: the logic runs in Node with jsdom (TypeScript stripped by Node 22.18+)`, false, node.error);
    else {
      const differences = [];
      for (let i = 0; i < all.length; i++) {
        const example = all[i];
        if ((await wrap.getAttribute('aria-checked')) !== String(Boolean(example.component))) await wrap.click();
        const chrome = await resultOf(example.input);
        const chromeNotes = await noteText();
        if (chrome !== node[i].text || chromeNotes.join('|') !== node[i].notes.join('|'))
          differences.push({
            input: example.input,
            chrome,
            jsdom: node[i].text,
            chromeNotes,
            jsdomNotes: node[i].notes,
          });
      }
      if ((await wrap.getAttribute('aria-checked')) === 'true') await wrap.click();
      report.htmlToJsx = { ...(report.htmlToJsx ?? {}), chromeVsJsdom: { inputs: all.length, differences } };
      check(
        `${T}: Chrome’s result equals jsdom’s character for character on all ${EXAMPLES.spec.length} §10 inputs and ${EXAMPLES.hostile.length} hostile ones, notes included`,
        differences.length === 0,
        differences.length
          ? differences
              .slice(0, 4)
              .map(d => `${show(d.input)}: chrome ${show(d.chrome)} jsdom ${show(d.jsdom)}`)
              .join('; ')
          : `${all.length} inputs, 0 differences`,
      );
    }

    // §11: parsing runs nothing and loads nothing — on this page, through the tool.
    await page.evaluate(() => {
      delete document.documentElement.dataset.hjPwned;
      window.__hjViolations = [];
      document.addEventListener('securitypolicyviolation', e =>
        window.__hjViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
    const urlBefore = page.url();
    const outsideBefore = outside.length + cdpOutside.length;
    const consoleBefore = consoleLines.length;
    const inert = await resultOf(HOSTILE);
    await sleep(1500);
    const inertNotes = await noteText();
    const inertState = await page.evaluate(() => ({
      pwned: document.documentElement.dataset.hjPwned ?? null,
      violations: [...window.__hjViolations],
      base: document.baseURI,
      refreshes: document.querySelectorAll('meta[http-equiv]').length,
    }));
    const inertness = {
      outside: [...outside, ...cdpOutside].slice(outsideBefore),
      console: consoleLines.slice(consoleBefore),
      ...inertState,
      url: page.url(),
    };
    report.htmlToJsx = { ...(report.htmlToJsx ?? {}), inertness };
    check(
      `${T}: §11 scripts, handlers, img, link, iframe, object, refresh, <base>, SVG use/image, url() in style — no request, no script, no navigation, no policy violation, no console line`,
      inertness.outside.length === 0 &&
        inertness.console.length === 0 &&
        inertness.pwned === null &&
        inertness.violations.length === 0 &&
        inertness.url === urlBefore &&
        inertness.base === urlBefore &&
        inertness.refreshes === 0 &&
        inert.includes(`style={{ background: 'url(${PROBE}/bg.png)', color: 'red' }}`) &&
        inert.includes(`<script>{\`${CANARY}\`}</script>`) &&
        inert.includes(`onError={() => { ${CANARY} }}`) &&
        inertNotes.includes('A <script> rendered by React on the client does not run.'),
      JSON.stringify(inertness).slice(0, 600),
    );

    // §12: the limits, timed in Chrome. `tool` is from the input event (or the Convert click) until the result is in
    // the field; `field` is what setting the same text into a fresh text box costs; `parse` is DOMParser alone;
    // `longest` is the longest task meanwhile.
    const timed = (text, press) =>
      page.evaluate(
        async ([value, viaConvert]) => {
          const field = document.querySelector('#html-to-jsx-input');
          const out = document.querySelector('#html-to-jsx-output');
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          setter.call(field, '');
          field.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => setTimeout(r, 50));
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const p0 = performance.now();
          new DOMParser().parseFromString(`<!doctype html><body>${value}`, 'text/html');
          const parse = performance.now() - p0;
          let start = performance.now();
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          if (viaConvert) {
            await new Promise(r => setTimeout(r, 50));
            const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Convert');
            start = performance.now();
            button?.click();
          }
          while (out.value === '' && performance.now() - start < 30_000) await new Promise(r => setTimeout(r, 5));
          const tool = performance.now() - start;
          await new Promise(r => setTimeout(r, 100));
          observer.disconnect();
          const text = out.value;
          const probe = document.createElement('textarea');
          probe.className = out.className;
          out.parentElement.append(probe);
          const f0 = performance.now();
          probe.value = text;
          void probe.scrollHeight;
          const fieldMs = performance.now() - f0;
          probe.remove();
          return {
            chars: value.length,
            parse: Math.round(parse),
            tool: Math.round(tool),
            field: Math.round(fieldMs),
            longest: Math.round(longest),
            out: text.length,
          };
        },
        [text, press],
      );
    const rows = n =>
      `<table>${Array.from({ length: n }, (_, i) => `<tr><td class="c">Row ${i}</td><td>${'x'.repeat(60)}</td></tr>`).join('\n')}</table>`;
    const t50k = await timed(rows(500), false);
    const t256 = await timed(rows(2600).slice(0, 256 * 1024), false);
    const t1m = await timed(rows(10_500), true);
    const t2m = await timed(rows(21_000), true);
    const t4m = await timed(rows(43_000).slice(0, 4 * 1024 * 1024), true);
    const deep = await timed(`${'<div>'.repeat(10_000)}x${'</div>'.repeat(10_000)}`, false);
    const deepTree = await page.evaluate(() => {
      const d = new DOMParser().parseFromString(`<!doctype html><body>${'<div>'.repeat(10_000)}x`, 'text/html');
      let depth = 0;
      let widest = 0;
      for (let n = d.body.firstElementChild; n; n = n.firstElementChild) {
        depth++;
        widest = Math.max(widest, n.childElementCount);
      }
      return { depth, widest, divs: d.querySelectorAll('div').length };
    });
    const mega = await timed(`<div>${'<p class="x">Hello <b>world</b> &amp; {you}</p>\n'.repeat(20_000)}</div>`, true);
    await setInput('x'.repeat(4 * 1024 * 1024 + 1));
    await page
      .waitForFunction(
        () => document.querySelector('[data-part="status"]').textContent.trim() === 'Input is larger than 4 MB.',
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});
    const refusal = (await status.innerText()).trim();
    const refusedConvert = await button('Convert').count();
    await setInput('x'.repeat(256 * 1024 + 1));
    const largeLine = (await status.innerText()).trim();
    const timings = { t50k, t256, t1m, t2m, t4m, deep, deepTree, mega, browser: ctx.browser()?.version() };
    report.htmlToJsx = { ...(report.htmlToJsx ?? {}), timings };
    check(
      `${T}: §12 up to 256 Ki live, then Convert (1, 2, 4 MiB), 10,000 levels and a megabyte convert; one over 4 MiB refuses`,
      t50k.out > 0 &&
        t256.out > 0 &&
        t1m.out > 0 &&
        t2m.out > 0 &&
        t4m.out > 0 &&
        deep.out > 0 &&
        mega.out > 0 &&
        refusal === 'Input is larger than 4 MB.' &&
        refusedConvert === 0 &&
        largeLine === 'Large input: press Convert (Ctrl+Enter).',
      `0.05 MiB ${t50k.tool} ms; 256 Ki ${t256.tool} ms (parse ${t256.parse}, field ${t256.field}, longest ${t256.longest}); 1 MiB ${t1m.tool} ms (field ${t1m.field}); 2 MiB ${t2m.tool} ms; 4 MiB ${t4m.tool} ms (parse ${t4m.parse}, field ${t4m.field}, longest task ${t4m.longest}); 1 MiB longest task ${t1m.longest}, 2 MiB ${t2m.longest}; 10,000 levels ${deep.tool} ms — Chrome nested ${deepTree.depth} of them, the deepest holding ${deepTree.widest} as siblings; 1 MB of paragraphs ${mega.tool} ms`,
    );
    await setInput('');

    // D17: a copied result is in the tool's history and opens back into the tool.
    const kept = '<button class="btn" onclick="go()">Go</button>';
    await resultOf(kept);
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2000 });
    const label = `HTML → JSX · ${kept.length} characters · copied`;
    const record = await waitForHistoryRecord(page, 'html-to-jsx', r => r.label === label).catch(() => null);
    await go('#/start');
    await go('#/tools/html-to-jsx');
    await page.reload();
    await input.waitFor();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: label }).first();
    await entry.waitFor({ timeout: 5000 }).catch(() => {});
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    await page
      .waitForFunction(() => document.querySelector('#html-to-jsx-output').value !== '', null, { timeout: 5000 })
      .catch(() => {});
    const restored = {
      record: record?.label,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      input: await input.inputValue(),
      result: await resultValue(),
    };
    check(
      `${T}: a copied result is in the tool’s history as Converted, in clear, and opens back into the tool`,
      restored.record === label &&
        restored.kind === 'Converted' &&
        restored.input === kept &&
        restored.result === '<button className="btn" onClick={() => { go() }}>Go</button>\n',
      JSON.stringify(restored),
    );
  } finally {
    await clipboard.restore();
  }

  // The probe page (its console is this check's, not the run's): the same markup parsed as a fragment raises
  // violations — the listener sees them; a whole document does not; <template> inside the markup — what Chrome does
  // today, through the tool as well.
  const probePage = await ctx.newPage();
  const probeConsole = [];
  probePage.on('console', m => probeConsole.push(`${m.type()}: ${m.text()}`));
  await probePage.goto(`${base}#/tools/html-to-jsx`);
  await probePage.locator('#html-to-jsx-input').waitFor();
  const styled = '<p style="color: red">a</p><div style="margin: 0">b</div>';
  const probe = await probePage.evaluate(
    async ([markup, styledMarkup]) => {
      const seen = [];
      document.addEventListener('securitypolicyviolation', e => seen.push(e.violatedDirective));
      const settle = () => new Promise(r => setTimeout(r, 300));
      const count = async fn => {
        const before = seen.length;
        fn();
        await settle();
        return seen.length - before;
      };
      return {
        documentParse: await count(() =>
          new DOMParser().parseFromString(`<!doctype html><body>${markup}`, 'text/html'),
        ),
        fragmentInTemplate: await count(() => {
          const t = document.createElement('template');
          t.innerHTML = styledMarkup;
        }),
        templateInsideMarkup: await count(() =>
          new DOMParser().parseFromString(`<!doctype html><body><template>${styledMarkup}</template>`, 'text/html'),
        ),
      };
    },
    [HOSTILE, styled],
  );
  // Markup that makes Chrome itself speak while it parses (console lines or violations), one snippet at a time.
  const SPEAKING = [
    `<base href="${PROBE}/">`,
    `<template><p style="color: red">t</p></template>`,
    `<meta http-equiv="Content-Security-Policy" content="script-src garbage; nonsense-directive x">`,
    `<meta http-equiv="origin-trial" content="bad">`,
    `<meta name="viewport" content="width=bad, foo=bar">`,
    `<meta name="referrer" content="bad">`,
    `<link rel="preload" as="garbage" href="${PROBE}/x">`,
    `<link rel="modulepreload" href="${PROBE}/m.js"><link rel="manifest" href="${PROBE}/m.json"><link rel="icon" href="${PROBE}/i.ico">`,
    `<link rel="dns-prefetch" href="${PROBE}"><link rel="preconnect" href="${PROBE}">`,
    `<link rel="stylesheet" href="${PROBE}/s.css" integrity="bad" media="garbage((">`,
    `<script type="importmap">{bad json</script><script type="speculationrules">{bad</script>`,
    `<iframe sandbox="garbage allow-nothing" allow="garbage; camera 'bad'"></iframe>`,
    `<img src="${PROBE}/l.png" loading="lazy" sizes="garbage((" srcset="bad bad bad" referrerpolicy="bad">`,
    `<input type="number" value="abc"><input type="color" value="red"><input type="date" value="x"><input type="range" value="q">`,
    `<input pattern="[" value="x"><input type="email" value="  a@b ">`,
    `<portal src="${PROBE}/p"></portal><fencedframe></fencedframe>`,
    `<form><input name="action"><input name="submit"></form><img name="body">`,
    `<svg><style>@import url(${PROBE}/s.css)</style><foreignObject><img src="${PROBE}/f.png"></foreignObject><animate attributeName="href" to="javascript:alert(1)"/></svg>`,
    `<math><mtext><img src="${PROBE}/m.png"></mtext></math>`,
    `<select><option selected>a</option><option selected>b</option></select>`,
    `<p dir="garbage" lang="" tabindex="x" contenteditable="bad" popover="bad" hidden="until-found">p</p>`,
    `<video src="${PROBE}/v.mp4" preload="auto" crossorigin="bad"></video>`,
  ];
  const speaking = [];
  for (const snippet of SPEAKING) {
    const before = probeConsole.length;
    const violations = await probePage.evaluate(async markup => {
      const seen = [];
      const on = e => seen.push(`${e.violatedDirective} ${e.blockedURI}`);
      document.addEventListener('securitypolicyviolation', on);
      new DOMParser().parseFromString(`<!doctype html><body>${markup}`, 'text/html');
      await new Promise(r => setTimeout(r, 200));
      document.removeEventListener('securitypolicyviolation', on);
      return seen;
    }, snippet);
    const lines = probeConsole.slice(before);
    if (violations.length || lines.length) speaking.push({ snippet, violations, console: lines });
  }
  report.htmlToJsx = { ...(report.htmlToJsx ?? {}), speaking };
  // The same snippets through the tool on the probe page: nothing at all (the tool shields <base> and <template>).
  const throughTool = [];
  for (const snippet of SPEAKING) {
    const before = probeConsole.length;
    const seen = await probePage.evaluate(async v => {
      const found = [];
      const on = e => found.push(`${e.violatedDirective} ${e.blockedURI}`);
      document.addEventListener('securitypolicyviolation', on);
      const field = document.querySelector('#html-to-jsx-input');
      const out = document.querySelector('#html-to-jsx-output');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, '<i>reset</i>');
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const t0 = performance.now();
      while (!out.value.includes('reset') && performance.now() - t0 < 5000) await new Promise(r => setTimeout(r, 10));
      setter.call(field, v);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      const t1 = performance.now();
      while (out.value.includes('reset') && performance.now() - t1 < 5000) await new Promise(r => setTimeout(r, 10));
      await new Promise(r => setTimeout(r, 200));
      document.removeEventListener('securitypolicyviolation', on);
      return { violations: found, result: out.value };
    }, snippet);
    throughTool.push({ snippet, ...seen, console: probeConsole.slice(before) });
  }
  await probePage.close();
  const loud = throughTool.filter(t => t.violations.length || t.console.length);
  report.htmlToJsx = { ...(report.htmlToJsx ?? {}), probe, throughTool: loud };
  check(
    `${T}: §11 Chrome reports only <base href> and <template> styles when parsing a whole document (${speaking.length} of ${SPEAKING.length} probes; a fragment parse is the control); through the tool all ${SPEAKING.length} are silent`,
    probe.documentParse === 1 &&
      probe.fragmentInTemplate > 0 &&
      probe.templateInsideMarkup > 0 &&
      speaking.map(x => x.snippet).join('|') === SPEAKING.slice(0, 2).join('|') &&
      loud.length === 0 &&
      throughTool[1].result.includes(`<p style={{ color: 'red' }}>t</p>`) &&
      throughTool[0].result === `<base href="${PROBE}/" />\n`,
    JSON.stringify({
      probe,
      speaking: speaking.map(x => `${x.snippet.slice(0, 40)}: ${x.violations.join(',')}`),
      loud,
    }).slice(0, 700),
  );

  // §7: the tool has no detect. What the start page does with pasted HTML and SVG: the tools whose detect answers, in
  // registry order (the first opens), and what opens in the page.
  const pasted = [
    '<div class="card">Hello</div>',
    '<svg viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>',
    '<!DOCTYPE html><html><body><p>x</p></body></html>',
  ];
  let detection;
  try {
    detection = detectAnswers(pasted);
  } catch (error) {
    detection = { error: String(error).slice(0, 400) };
  }
  const paste = async text => {
    await go('#/start');
    const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await field.fill('');
    await field.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
    await sleep(600);
    return page.evaluate(() => location.hash);
  };
  const openedBy = [];
  for (const text of pasted) openedBy.push(await paste(text));
  report.htmlToJsx = { ...(report.htmlToJsx ?? {}), startPagePaste: { pasted, detection, openedBy } };
  check(
    `${T}: §7 no detect — pasted HTML, SVG or a document never opens this tool from the start page`,
    !detection.error &&
      !openedBy.includes('#/tools/html-to-jsx') &&
      detection.answers.every(ids => !ids.includes('html-to-jsx')),
    detection.error ??
      pasted
        .map((p, i) => `${show(p)} → detect: ${detection.answers[i].join(', ') || 'none'}; opens ${openedBy[i]}`)
        .join('; '),
  );

  // The page in the dark theme, then the theme mode as it was.
  await go('#/tools/html-to-jsx');
  await page.reload();
  await input.waitFor();
  await inDarkTheme(ctx, base, page, async () => {
    await resultOf(
      '<form class="login">\n  <label for="user">User</label>\n  <input id="user" name="user" required autofocus>\n  <select name="role"><option>dev</option><option selected>admin</option></select>\n  <button type="submit" style="margin-top: 8px; font-weight: 600 !important">Sign in</button>\n</form>',
    );
    await settledShot(shoot, frame, 'tool-html-to-jsx-03-form-dark.png');
    await wrap.click();
    await page.waitForFunction(() => document.querySelector('#html-to-jsx-output').value.startsWith('export'), null, {
      timeout: 5000,
    });
    await settledShot(shoot, frame, 'tool-html-to-jsx-04-component-dark.png');
    await wrap.click();
  });
  await setInput('');
  await go('#/start');
  page.off('request', onPageRequest);
  page.off('console', onConsole);
  ctx.off('request', onRequest);
  await cdp.detach().catch(() => {});
};
