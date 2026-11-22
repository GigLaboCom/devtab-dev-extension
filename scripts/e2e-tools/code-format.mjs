// The Code Formatter in the built extension (docs/tools/specs/code-format.md): its scenarios (§2) with the page's real
// controls; every language formatted in the tool's module workers under the extension's CSP (no console error, no
// policy violation, in the page or in a worker); what each language loads — the worker's own requests, seen through
// CDP on the worker — and that nothing of it is on the start route or in `detect`; an error with its place; Run and
// Cancel on a megabyte of minified JavaScript with the longest frame of the page meanwhile; the limits of §12 measured
// per language straight on the worker (the tool's work apart from the text box's); a result too large to show; text
// pasted on the start page; an entry opened back from the tool's history (D17); the page in the light and the dark
// theme. Run by scripts/e2e-tools.mjs; `pnpm test:e2e -- --only=code-format` runs it alone.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, Worker, DataTransfer, ClipboardEvent, MutationObserver -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Code Formatter';
const KI = 1024;
const MI = 1024 * KI;

/** About `size` characters of a language, built from a repeated, varied unit (for the §12 measurements). */
const generate = (language, size) => {
  const parts = [];
  let length = 0;
  for (let i = 0; length < size; i++) {
    const unit = {
      javascript: `function f${i}(a,b){const c=a.map(x=>x*${i}).filter(Boolean);if(c.length>b){return{ok:!0,value:c,label:"item ${i}"}}else{throw new Error("no "+${i})}}`,
      typescript: `interface Item${i}<T extends object = {}> { id: number; name?: string; tags: readonly string[]; meta: Record<string, T> }\nexport class Store${i} implements Iterable<Item${i}> { private items: Item${i}[] = []; constructor(readonly limit: number = ${i}) {} add(item: Item${i}): this { if (this.items.length < this.limit) this.items.push(item); return this } *[Symbol.iterator]() { yield* this.items } }\nexport const pick${i} = <K extends keyof Item${i}>(x: Item${i}, k: K): Item${i}[K] => x[k];\n`,
      css: `.card-${i}{display:flex;margin:0 0 ${i % 16}px;padding:4px 8px;color:#${((i * 2654435761) % 0xffffff).toString(16).padStart(6, '0')};background:linear-gradient(90deg,rgba(0,0,0,.1),transparent)}.card-${i}>a:hover,.card-${i}>a:focus-visible{text-decoration:underline;outline:2px solid currentColor}@media (max-width:${600 + (i % 400)}px){.card-${i}{display:block}}`,
      scss: `$space-${i}:${i % 16}px;.card-${i}{margin:$space-${i};&:hover{color:darken(#336699,${i % 30}%)}.title{font:{weight:600;size:1.${i % 9}rem}}@include media(${i % 3}){display:block}}`,
      less: `@space-${i}:${i % 16}px;.card-${i}{margin:@space-${i};.mixin-${i % 7}();&:hover{color:darken(#336699,${i % 30}%)}.title{font-weight:600}}`,
      html: `<section class="row-${i}"><h2 id="h${i}">Title ${i}</h2><p>Some <b>bold</b> and <a href="#a${i}">a link</a> in text number ${i}.</p><ul><li>one</li><li>two ${i}</li></ul><table><tr><td>${i}</td><td style="color:red;padding:0">x</td></tr></table></section>`,
      markdown: `## Section ${i}\n\nA paragraph with *emphasis*, **strong**, \`code\` and a [link](#s${i}) for item ${i}.\n\n*  first\n*  second ${i}\n\n| a | b |\n|-|-|\n| ${i} | x |\n\n`,
      yaml: `- id: ${i}\n  name:   "user ${i}"\n  tags: [a,   b, c]\n  address: {city: Town, zip: "${10000 + i}"}\n  # note ${i}\n  active: ${i % 2 === 0}\n`,
      xml: `<item id="${i}" kind='k${i % 5}'><name>Name ${i}</name><body>Text <b>${i}</b> more</body><empty/></item>`,
    }[language];
    parts.push(unit);
    length += unit.length;
  }
  const body = parts.join('');
  return language === 'xml' ? `<?xml version="1.0"?><items>${body}</items>` : body;
};

/** Deeply nested input per language: Prettier recurses; the XML printer and saxes do not. */
const nested = {
  javascript: `x = ${'['.repeat(5000)}${']'.repeat(5000)};`,
  typescript: `type T = ${'Array<'.repeat(3000)}string${'>'.repeat(3000)};`,
  css: `a{b:${'calc('.repeat(3000)}1px${')'.repeat(3000)}}`,
  scss: `${'.a{'.repeat(3000)}color:red${'}'.repeat(3000)}`,
  less: `${'.a{'.repeat(3000)}color:red${'}'.repeat(3000)}`,
  html: `${'<div>'.repeat(3000)}x${'</div>'.repeat(3000)}`,
  markdown: `${'> '.repeat(3000)}x`,
  yaml: `a: ${'['.repeat(3000)}1${']'.repeat(3000)}`,
  xml: `${'<a>'.repeat(100_000)}x${'</a>'.repeat(100_000)}`,
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  // What the page and its workers fetch and say, through CDP: the page's requests, and — attached to every worker as it
  // starts, before it runs — the worker's own requests (the Prettier modules it imports) and its console and log
  // (a refused eval or any other CSP violation is reported there).
  const cdp = await ctx.newCDPSession(page);
  const pageRequests = [];
  const workerRequests = [];
  const workerProblems = [];
  const bytes = new Map();
  await cdp.send('Network.enable');
  cdp.on('Network.requestWillBeSent', e => pageRequests.push(e.request.url));
  let message = 0;
  const toWorker = (sessionId, method, params = {}) =>
    cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: ++message, method, params }) });
  const requestUrls = new Map();
  cdp.on('Target.attachedToTarget', async e => {
    if (e.targetInfo.type !== 'worker') return;
    for (const method of ['Network.enable', 'Log.enable', 'Runtime.enable'])
      await toWorker(e.sessionId, method).catch(() => {});
    await toWorker(e.sessionId, 'Runtime.runIfWaitingForDebugger').catch(() => {});
  });
  cdp.on('Target.receivedMessageFromTarget', e => {
    const m = JSON.parse(e.message);
    if (m.method === 'Network.requestWillBeSent') {
      workerRequests.push(m.params.request.url);
      requestUrls.set(`${e.sessionId}:${m.params.requestId}`, m.params.request.url);
    } else if (m.method === 'Network.loadingFinished') {
      const url = requestUrls.get(`${e.sessionId}:${m.params.requestId}`);
      if (url) bytes.set(url, m.params.encodedDataLength);
    } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level))
      workerProblems.push(`${m.params.entry.source}: ${m.params.entry.text}`);
    else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning', 'assert'].includes(m.params.type))
      workerProblems.push(`console.${m.params.type}`);
    else if (m.method === 'Runtime.exceptionThrown')
      workerProblems.push(
        `exception: ${m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text}`,
      );
  });
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: true, flatten: false });
  const name = url => url.replace(/^.*\/assets\//, '').replace(/-[\w-]{8}\.(m?js|md)$/, '.$1');
  const since = (list, from) => list.slice(from).filter(u => /\/assets\/.+\.(m?js)$/.test(u));

  // Chrome keeps at most 50 entries of a tab's history, and the modules after this one count them: go by replacing the
  // current entry; only the start page's own move to a tool adds one.
  const go = async hash => {
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5_000 });
  };
  const input = page.locator('#code-format-input');
  const output = page.locator('#code-format-output');
  const status = page.locator('[data-part="status"]');
  const frame = page.locator('[data-slot="tool-page"]');
  const button = label => page.getByRole('button', { name: label, exact: true });
  /** The tool afresh: off its page and back, so its workers are new and every choice is the default. */
  const tool = async () => {
    await go('#/start');
    await go('#/tools/code-format');
    await input.waitFor();
    await page.evaluate(() => {
      document.documentElement.__cspViolations = [];
      document.addEventListener('securitypolicyviolation', e =>
        document.documentElement.__cspViolations.push(`${e.violatedDirective} ${e.blockedURI}`),
      );
    });
  };
  const pageViolations = () => page.evaluate(() => document.documentElement.__cspViolations ?? []);
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  };
  /** Sets the code as a paste would (one input event), without sending megabytes through the keyboard. */
  const put = text =>
    page.evaluate(value => {
      const field = document.querySelector('#code-format-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);
  const result = async (expected, timeout = 10_000) => {
    await page
      .waitForFunction(
        want =>
          document.querySelector('#code-format-output')?.value === want &&
          !document.querySelector('[data-part="status"]')?.hasAttribute('data-stale'),
        expected,
        { timeout },
      )
      .catch(() => {});
    return output.inputValue().catch(() => null);
  };
  const said = async (expected, timeout = 10_000) => {
    await page
      .waitForFunction(
        want => {
          const line = document.querySelector('[data-part="status"]');
          return line?.textContent.trim() === want && !line.hasAttribute('data-stale');
        },
        expected,
        { timeout },
      )
      .catch(() => {});
    return (await status.innerText()).trim();
  };

  // ── The start route: nothing of the tool but its catalogue entry; recognising pasted text loads no library. ──
  await go('#/start');
  const startFrom = pageRequests.length;
  await page.reload();
  await page.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await sleep(500);
  const startLoaded = since(pageRequests, startFrom).map(name);
  const paste = async text => {
    await go('#/start');
    const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor();
    await field.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
  };
  const pasteFrom = pageRequests.length;
  const workersBefore = workerRequests.length;
  await paste('.card { color: red; }\n.card a { margin: 0 }');
  await page.waitForFunction(() => location.hash === '#/tools/code-format', null, { timeout: 5_000 }).catch(() => {});
  await input.waitFor({ timeout: 5_000 }).catch(() => {});
  const pasted = {
    hash: await page.evaluate(() => location.hash),
    input: await input.inputValue().catch(() => null),
    language: await page
      .getByLabel('Language', { exact: true })
      .innerText()
      .catch(() => null),
    result: await result('.card {\n  color: red;\n}\n.card a {\n  margin: 0;\n}\n'),
  };
  const pasteLoaded = since(pageRequests, pasteFrom);
  // The chunks the start route and the paste loaded (detect's among them), the tool's own aside, carry no library and
  // no worker.
  const detectChunks = [...since(pageRequests, startFrom).slice(0, startLoaded.length), ...pasteLoaded].filter(
    u => !/CodeFormatTool|format\.worker|xml\.worker/.test(u),
  );
  const detectSources = await Promise.all(
    detectChunks.map(u => page.evaluate(url => fetch(url).then(r => r.text()), u)),
  );
  const libraryInDetect = detectSources.filter(s => /SaxesParser|\.mjs["']|format\.worker|printWidth:e/.test(s)).length;
  await paste('apiVersion: v1\nkind: Pod\nmetadata:\n  name: web');
  await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5_000 }).catch(() => {});
  const yamlHash = await page.evaluate(() => location.hash);
  await paste('<div class="x">hi</div>');
  await sleep(400);
  const htmlHash = await page.evaluate(() => location.hash);
  check(
    `${T}: the start route loads nothing of the tool; pasted CSS opens it in Auto (CSS) and formatted, the detect chunks carry no library; YAML opens YAML and JSON, one-line HTML opens nothing (§7)`,
    !startLoaded.some(f => /CodeFormat|format\.worker|xml\.worker|\.mjs$/.test(f)) &&
      pasted.hash === '#/tools/code-format' &&
      pasted.language === 'Auto (CSS)' &&
      pasted.result === '.card {\n  color: red;\n}\n.card a {\n  margin: 0;\n}\n' &&
      libraryInDetect === 0 &&
      since(workerRequests, workersBefore).map(name).join(',') === 'standalone.mjs,postcss.mjs' &&
      yamlHash === '#/tools/yaml-json' &&
      htmlHash === '#/start',
    JSON.stringify({
      startLoaded: startLoaded.length,
      pasted,
      detectChunks: detectChunks.map(name),
      yamlHash,
      htmlHash,
    }),
  );

  const clipboard = await stubClipboard(page);
  try {
    // ── §8 the empty page. ──
    await tool();
    const empty = {
      language: await page.getByLabel('Language', { exact: true }).innerText(),
      indent: await page.getByLabel('Indent', { exact: true }).innerText(),
      width: await page.getByLabel('Line width', { exact: true }).innerText(),
      placeholder: await input.getAttribute('placeholder'),
      spellcheck: await input.getAttribute('spellcheck'),
      copy: await button('Copy').isDisabled(),
      save: await button('Save').isDisabled(),
      workers: page.workers().length,
    };
    check(
      `${T}: opens empty — Auto, 2 spaces, 80; Copy and Save off; no worker started yet (§8)`,
      empty.language === 'Auto' &&
        empty.indent === '2 spaces' &&
        empty.width === '80' &&
        empty.placeholder === 'Paste code: JavaScript, CSS, HTML, XML…' &&
        empty.spellcheck === 'false' &&
        empty.copy &&
        empty.save &&
        empty.workers === 0,
      JSON.stringify(empty),
    );
    await settledShot(shoot, frame, 'tool-code-format-01-empty-light.png');

    // ── Every language, each on a fresh page: the result, what it loaded, and no CSP violation anywhere. ──
    const languages = [
      [
        'CSS',
        'a{color:red;background:BLUE}b,c{margin:0 0 0 0}',
        'a {\n  color: red;\n  background: BLUE;\n}\nb,\nc {\n  margin: 0 0 0 0;\n}\n',
        'standalone.mjs,postcss.mjs',
      ],
      [
        'SCSS',
        '$c:red;.a{&:hover{color:$c}@include m(1)}',
        '$c: red;\n.a {\n  &:hover {\n    color: $c;\n  }\n  @include m(1);\n}\n',
        'standalone.mjs,postcss.mjs',
      ],
      [
        'LESS',
        '@c:red;.a{.m();&:hover{color:@c}}',
        '@c: red;\n.a {\n  .m();\n  &:hover {\n    color: @c;\n  }\n}\n',
        'standalone.mjs,postcss.mjs',
      ],
      [
        'JavaScript',
        'const a={b:1,c:[1,2,3]};function f(x){return x*2}',
        'const a = { b: 1, c: [1, 2, 3] };\nfunction f(x) {\n  return x * 2;\n}\n',
        'standalone.mjs,babel.mjs,estree.mjs',
      ],
      [
        'TypeScript',
        'interface A{a:number;b?:string}\nenum E{A,B}',
        'interface A {\n  a: number;\n  b?: string;\n}\nenum E {\n  A,\n  B,\n}\n',
        'standalone.mjs,babel.mjs,estree.mjs',
      ],
      [
        'HTML',
        '<div><script>let a={b:1}</script><style>a{color:red}</style></div>',
        '<div>\n  <script>\n    let a = { b: 1 };\n  </script>\n  <style>\n    a {\n      color: red;\n    }\n  </style>\n</div>\n',
        'standalone.mjs,html.mjs,babel.mjs,estree.mjs,postcss.mjs',
      ],
      [
        'Markdown',
        '# Title\n*  one\n*  two\n\n| a | b |\n|-|-|\n| long cell | x |',
        '# Title\n\n- one\n- two\n\n| a         | b   |\n| --------- | --- |\n| long cell | x   |\n',
        'standalone.mjs,markdown.mjs',
      ],
      [
        'YAML',
        'a:   1\nlist:\n- x\n-   y\n# comment\nb: {c: 1, d: [1,2]}',
        'a: 1\nlist:\n  - x\n  - y\n# comment\nb: { c: 1, d: [1, 2] }\n',
        'standalone.mjs,yaml.mjs',
      ],
      [
        'XML',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c --><note id="1"><to>Ann</to><body>Hi <b>there</b></body><empty/></note>',
        '<?xml version="1.0" encoding="UTF-8"?>\n<!-- c -->\n<note id="1">\n  <to>Ann</to>\n  <body>Hi <b>there</b></body>\n  <empty/>\n</note>\n',
        '',
      ],
    ];
    const perLanguage = {};
    for (const [label, text, expected, modules] of languages) {
      await tool();
      const pageFrom = pageRequests.length;
      const workerFrom = workerRequests.length;
      const problemsFrom = workerProblems.length;
      await choose('Language', label);
      await put(text);
      const got = await result(expected);
      await sleep(200);
      // The worker's requests come over another channel than the page's result: on a busy machine they can arrive
      // after it. Wait for the modules expected (anything more or else still fails the comparison below).
      const until = Date.now() + 5000;
      while (since(workerRequests, workerFrom).map(name).join(',') !== modules && Date.now() < until) await sleep(100);
      const loaded = since(workerRequests, workerFrom).map(name);
      const started = since(pageRequests, pageFrom)
        .map(name)
        .filter(f => /worker/.test(f));
      const violations = [...(await pageViolations()), ...workerProblems.slice(problemsFrom)];
      perLanguage[label] = {
        worker: started.join(','),
        modules: loaded.join(','),
        bytes: since(workerRequests, workerFrom).reduce((sum, u) => sum + (bytes.get(u) ?? 0), 0),
        violations,
      };
      check(
        `${T}: ${label} formats in the built extension; it loads ${modules || 'no Prettier module (the XML worker)'} and nothing else; no CSP violation or console error in the page or the worker`,
        got === expected &&
          loaded.join(',') === modules &&
          started.join(',') === (label === 'XML' ? 'xml.worker.js' : 'format.worker.js') &&
          violations.length === 0,
        JSON.stringify({ got: got === expected ? 'as expected' : got, ...perLanguage[label] }),
      );
    }
    // What the browser fetched for the tool, searched as it fetched it: no code built from strings anywhere (the CSP
    // would refuse it); the licences ride along — Prettier's and saxes' in their workers, Prettier's notices beside.
    const shipped = [
      ...new Set(
        [...pageRequests, ...workerRequests].filter(u => /\/assets\/.*(\.worker-[\w-]{8}\.js|\.mjs)$/.test(u)),
      ),
    ];
    const texts = await Promise.all(shipped.map(u => page.evaluate(url => fetch(url).then(r => r.text()), u)));
    const fromStrings = texts.reduce(
      (n, text) => n + (text.match(/\beval\s*\(|\bnew\s+Function\b|(?<![\w$.])Function\s*\(/g) ?? []).length,
      0,
    );
    const formatWorker = texts[shipped.findIndex(u => /format\.worker-/.test(u))] ?? '';
    const xmlWorkerText = texts[shipped.findIndex(u => /xml\.worker-/.test(u))] ?? '';
    const noticesUrl = /"(\/assets\/THIRD-PARTY-NOTICES-[\w-]{8}\.md)"/.exec(formatWorker)?.[1];
    const notices = noticesUrl ? await page.evaluate(url => fetch(url).then(r => r.text()), noticesUrl) : '';
    check(
      `${T}: no file of the tool builds code from strings; Prettier's and saxes' licences ship in the workers, Prettier's notices of what it bundles beside its modules`,
      shipped.length === 9 &&
        fromStrings === 0 &&
        formatWorker.includes('@license MIT') &&
        formatWorker.includes('James Long and contributors') &&
        xmlWorkerText.includes('@license ISC') &&
        xmlWorkerText.includes('xmlchars 2.2.0') &&
        notices.startsWith('# Licenses of bundled dependencies'),
      `${shipped.map(name).join(', ')}; eval/Function: ${fromStrings}; notices ${notices.length} characters`,
    );

    // Shared modules load once per worker: CSS, then SCSS, then JavaScript, then HTML on one page.
    await tool();
    const sequence = [];
    for (const [label, text] of [
      ['CSS', 'a{b:c}'],
      ['SCSS', '$a:1;b{c:$a}'],
      ['JavaScript', 'let a=1'],
      ['TypeScript', 'let a:number=1'],
      ['HTML', '<p>x</p>'],
    ]) {
      const from = workerRequests.length;
      await choose('Language', label);
      await put(text);
      await page.waitForFunction(() => document.querySelector('#code-format-output')?.value !== '', null, {
        timeout: 10_000,
      });
      await put('');
      await sleep(150);
      sequence.push(`${label}: ${since(workerRequests, from).map(name).join(',') || '—'}`);
    }
    check(
      `${T}: modules shared between languages load once (§5 п. 8)`,
      sequence.join(' | ') ===
        'CSS: standalone.mjs,postcss.mjs | SCSS: — | JavaScript: babel.mjs,estree.mjs | TypeScript: — | HTML: html.mjs',
      sequence.join(' | '),
    );

    // ── §2.1 Auto recognises CSS; the loading line on first use; Copy. ──
    await tool();
    // Every text the line under the code shows (the loading line can last less than a frame when the module comes
    // from the disk cache), recorded as the page writes it.
    await page.evaluate(() => {
      const seen = [];
      const line = document.querySelector('[data-part="status"]');
      new MutationObserver(() => seen.push(line.textContent.trim())).observe(line, {
        childList: true,
        characterData: true,
        subtree: true,
      });
      document.documentElement.__statusSeen = seen;
    });
    await put('a{color:red;background:BLUE}b,c{margin:0 0 0 0}');
    const css = await result('a {\n  color: red;\n  background: BLUE;\n}\nb,\nc {\n  margin: 0 0 0 0;\n}\n');
    const loadingSeen = (await page.evaluate(() => document.documentElement.__statusSeen)).includes(
      'Loading the CSS formatter…',
    );
    await button('Copy').click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
    const copied = await clipboard.copied();
    const record = await waitForHistoryRecord(page, 'code-format', r => r.label?.endsWith('copied')).catch(() => null);
    check(
      `${T}: §2.1 Auto (CSS), the loading line while CSS loads for the first time, the result copied; Copy is a history record (commit)`,
      (await page.getByLabel('Language', { exact: true }).innerText()) === 'Auto (CSS)' &&
        loadingSeen &&
        css === copied.at(-1) &&
        record?.kind === 'format' &&
        record.label === 'CSS (Auto) · 2 spaces · 47 characters · copied',
      JSON.stringify({ loadingSeen, copied: copied.length, label: record?.label }),
    );
    await settledShot(shoot, frame, 'tool-code-format-02-css-light.png');

    // ── §2.2 the person's style. ──
    await tool();
    await choose('Language', 'JavaScript');
    await put('function greet(name){return "Hello, "+name}');
    await result('function greet(name) {\n  return "Hello, " + name;\n}\n');
    await page.getByRole('radio', { name: 'Single', exact: true }).click();
    await page.getByLabel('Semicolons', { exact: true }).click();
    await choose('Indent', '4 spaces');
    const styled = await result("function greet(name) {\n    return 'Hello, ' + name\n}\n");
    check(
      `${T}: §2.2 Quotes Single, no Semicolons, 4 spaces`,
      styled === "function greet(name) {\n    return 'Hello, ' + name\n}\n",
      styled,
    );
    await settledShot(shoot, frame, 'tool-code-format-03-javascript-options-light.png');

    // ── §2.3 an error with its place; the link puts the cursor there; no alert. ──
    await put('const a = {\n  b: 1,,\n};');
    const jsError = await said('Line 2, column 8: Unexpected token');
    await page.getByRole('button', { name: /^Line 2, column 8/ }).click();
    const caret = await page.evaluate(() => {
      const el = document.querySelector('#code-format-input');
      return { focused: document.activeElement === el, at: el.selectionStart };
    });
    check(
      `${T}: §2.3 a typo is named with its place; pressing it puts the cursor there; no alert`,
      jsError === 'Line 2, column 8: Unexpected token' &&
        caret.focused &&
        caret.at === 19 &&
        (await output.inputValue()) === '' &&
        (await page.getByRole('alert').count()) === 0,
      JSON.stringify({ jsError, caret }),
    );
    await settledShot(shoot, frame, 'tool-code-format-04-error-light.png');

    // ── §2.4, §2.5 XML. ──
    await tool();
    await put('<?xml version="1.0"?><note id="1"><to>Ann</to><body>Hi <b>there</b></body></note>');
    const soap = await result(
      '<?xml version="1.0"?>\n<note id="1">\n  <to>Ann</to>\n  <body>Hi <b>there</b></body>\n</note>\n',
    );
    const xmlRow = {
      width: await page.getByLabel('Line width', { exact: true }).count(),
      second: await page.locator('[data-part="language-options"]').count(),
    };
    await settledShot(shoot, frame, 'tool-code-format-05-xml-light.png');
    // `<a>` is also an HTML tag, so Auto would read this as HTML: the person chooses XML (§2.5).
    await choose('Language', 'XML');
    await put('<a>\n  <b></a>');
    const xmlError = await said('Line 2, column 10: unexpected close tag');
    check(
      `${T}: §2.4 XML: one element per line, mixed content on one; no Line width, no second row; §2.5 an XML error after the construct`,
      soap === '<?xml version="1.0"?>\n<note id="1">\n  <to>Ann</to>\n  <body>Hi <b>there</b></body>\n</note>\n' &&
        xmlRow.width === 0 &&
        xmlRow.second === 0 &&
        xmlError === 'Line 2, column 10: unexpected close tag',
      JSON.stringify({ xmlRow, xmlError }),
    );

    // ── HTML: the note about <script> and <style>. ──
    await tool();
    await put('<!doctype html><div><script>let a = {;</script></div>');
    const kept = await result('<!doctype html>\n<div>\n  <script>\n    let a = {;\n  </script>\n</div>\n');
    const note = (await page.locator('[data-part="note"]').innerText()).trim();
    check(
      `${T}: HTML keeps a <script> that does not parse, and says so under the result (§5 п. 3)`,
      kept === '<!doctype html>\n<div>\n  <script>\n    let a = {;\n  </script>\n</div>\n' &&
        note === "Code inside <script> and <style> that doesn't parse is left as it is.",
      note,
    );
    await settledShot(shoot, frame, 'tool-code-format-06-html-light.png');

    // ── §6 not recognised. ──
    await put('hello world');
    const undetected = await said("Choose a language: this text doesn't look like any of them.");
    check(
      `${T}: text that looks like none of the languages asks for one (§5 п. 7)`,
      undetected === "Choose a language: this text doesn't look like any of them.",
    );

    // ── §12: Run and Cancel on a megabyte of minified JavaScript; the longest frame while it formats. ──
    // The minified source: Prettier's own modules as the extension ships them (their addresses from the worker's
    // requests above), each wrapped in a function, cut at a megabyte.
    const moduleUrls = [
      ...new Set(workerRequests.filter(u => /\/assets\/(babel|estree|markdown|html|yaml)-[\w-]{8}\.mjs$/.test(u))),
    ];
    const sources = await Promise.all(moduleUrls.map(u => page.evaluate(url => fetch(url).then(r => r.text()), u)));
    let bundle = sources.map(s => `(function(){${s.replace(/export\s*\{[^}]*\};?\s*$/, '')}})();`).join('\n');
    if (bundle.length > MI) bundle = bundle.slice(0, bundle.lastIndexOf('\n(function(){', MI) + 1);
    await tool();
    await choose('Language', 'JavaScript');
    await put(bundle);
    const largeSaid = await said('Large input: press Run (Ctrl+Enter) to format it.');
    // Run, then Cancel at once (Esc on the focused Cancel): the worker is terminated, the page is back where it was.
    await button('Run').click();
    await page.getByRole('button', { name: 'Cancel', exact: true }).waitFor({ timeout: 2_000 });
    const cancelling = {
      focused: await page.evaluate(() => document.activeElement?.textContent === 'Cancel'),
      line: (await status.innerText()).trim(),
    };
    await page.keyboard.press('Escape');
    const afterCancel = await said('Large input: press Run (Ctrl+Enter) to format it.');
    await sleep(300);
    const workersAfterCancel = page.workers().length;
    const outputAfterCancel = await output.inputValue();
    // The frames of the page from Run to the result shown, split where the worker's answer reaches the page: before it
    // the worker formats (the page should only draw); from it the page puts megabytes into the text box. Every long
    // task is listed with its place, so the box's cost is told apart from the tool's.
    const timed = await page.evaluate(async () => {
      const onmessage = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage');
      let answered = Infinity;
      Object.defineProperty(Worker.prototype, 'onmessage', {
        configurable: true,
        get() {
          return onmessage.get.call(this);
        },
        set(handler) {
          onmessage.set.call(this, event => {
            if (event.data && 'result' in event.data) answered = Math.min(answered, performance.now());
            handler(event);
          });
        },
      });
      const frames = [];
      let last = performance.now();
      let running = true;
      const tick = now => {
        frames.push({ at: now, gap: now - last });
        last = now;
        if (running) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      const tasks = [];
      const observer = new PerformanceObserver(list => {
        for (const e of list.getEntries()) tasks.push({ start: e.startTime, duration: e.duration });
      });
      observer.observe({ type: 'longtask', buffered: false });
      const start = performance.now();
      [...document.querySelectorAll('button')].find(b => b.textContent === 'Run').click();
      const field = () => document.querySelector('#code-format-output');
      while (!field()?.value && performance.now() - start < 60_000) await new Promise(r => setTimeout(r, 5));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      const shown = performance.now();
      running = false;
      observer.disconnect();
      Object.defineProperty(Worker.prototype, 'onmessage', onmessage);
      // The text box alone: the same text put into a detached-from-React box of the same kind, laid out.
      const box = document.createElement('textarea');
      box.className = field().className;
      document.body.append(box);
      const boxStart = performance.now();
      box.value = field().value;
      void box.scrollHeight;
      const boxMs = performance.now() - boxStart;
      box.remove();
      const round = n => Math.round(n);
      const while_ = frames.filter(f => f.at > start && f.at <= answered);
      return {
        workerAnswered: round(answered - start),
        shown: round(shown - start),
        longestFrameWhileFormatting: round(Math.max(0, ...while_.slice(1).map(f => f.gap))),
        longestTaskWhileFormatting: round(
          Math.max(0, ...tasks.filter(t => t.start + t.duration <= answered).map(t => t.duration)),
        ),
        longestTaskShowingResult: round(
          Math.max(0, ...tasks.filter(t => t.start + t.duration > answered).map(t => t.duration)),
        ),
        tasks: tasks.map(t => `${round(t.start - start)}+${round(t.duration)}`),
        textBoxAlone: round(boxMs),
        lines: field().value.split('\n').length,
        size: field().value.length,
      };
    });
    check(
      `${T}: §12 a megabyte of minified JavaScript waits for Run; Cancel (Esc, the focus on it) stops the worker; Run formats it in the worker while the page keeps drawing frames — the long task left is the text box taking the result`,
      largeSaid === 'Large input: press Run (Ctrl+Enter) to format it.' &&
        cancelling.focused &&
        ['Loading the JavaScript formatter…', 'Formatting…'].includes(cancelling.line) &&
        afterCancel === 'Large input: press Run (Ctrl+Enter) to format it.' &&
        workersAfterCancel === 0 &&
        outputAfterCancel === '' &&
        timed.size > bundle.length &&
        timed.longestFrameWhileFormatting < 100,
      JSON.stringify({ input: bundle.length, cancelling, afterCancel, workersAfterCancel, ...timed }),
    );
    await put('');

    // ── §12 per language, straight on the worker: the tool's work without the text box. ──
    const workerUrl = urls => urls.find(u => /format\.worker-[\w-]{8}\.js$/.test(u));
    const xmlWorkerUrl = urls => urls.find(u => /xml\.worker-[\w-]{8}\.js$/.test(u));
    const prettierWorker = workerUrl(pageRequests);
    const xmlWorker = xmlWorkerUrl(pageRequests);
    const onWorker = (url, jobs) =>
      page.evaluate(
        async ({ url, jobs }) => {
          const worker = new Worker(url, { type: 'module' });
          const out = [];
          for (const [i, job] of jobs.entries()) {
            const started = performance.now();
            const reply = await new Promise(resolve => {
              worker.onmessage = e => {
                if (!('loading' in e.data)) resolve(e.data);
              };
              worker.postMessage({ id: i + 1, ...job });
            });
            out.push({
              label: job.label,
              wall: Math.round(performance.now() - started),
              ms: Math.round(reply.ms ?? -1),
              ok: reply.result?.ok ?? false,
              error: reply.result?.ok === false ? reply.result.error.message : (reply.failure ?? null),
              outLength: reply.result?.ok ? reply.result.text.length : 0,
            });
          }
          worker.terminate();
          return out;
        },
        { url, jobs },
      );
    const settings = {
      indent: 2,
      lineWidth: 80,
      semi: true,
      singleQuote: false,
      trailingComma: 'all',
      whitespace: 'css',
      proseWrap: 'preserve',
    };
    const job = (label, language, text) => ({ label, language, text, settings });
    // Warm up (the modules load), then a megabyte per language (Markdown: its limit, 256 Ki) and the deep nesting.
    const measured = await onWorker(prettierWorker, [
      job('warm js', 'javascript', 'a'),
      job('warm css', 'css', 'a{}'),
      job('warm html', 'html', '<p>'),
      job('warm md', 'markdown', 'a'),
      job('warm yaml', 'yaml', 'a: 1'),
      ...['javascript', 'typescript', 'css', 'scss', 'less', 'html', 'markdown', 'yaml'].map(language =>
        job(`${language}, 32 KiB (live)`, language, generate(language, 32 * KI)),
      ),
      job('JavaScript, 1 MiB minified', 'javascript', bundle),
      job('TypeScript, 1 MiB', 'typescript', generate('typescript', MI)),
      job('CSS, 1 MiB minified', 'css', generate('css', MI)),
      job('SCSS, 1 MiB', 'scss', generate('scss', MI)),
      job('LESS, 256 KiB (its limit)', 'less', generate('less', 256 * KI)),
      job('HTML, 1 MiB', 'html', generate('html', MI)),
      job('Markdown, 256 KiB', 'markdown', generate('markdown', 256 * KI)),
      job('YAML, 1 MiB', 'yaml', generate('yaml', MI)),
      job('JavaScript, nested 5000', 'javascript', nested.javascript),
      job('TypeScript, nested 3000', 'typescript', nested.typescript),
      job('CSS, nested 3000', 'css', nested.css),
      job('SCSS, nested 3000', 'scss', nested.scss),
      job('LESS, nested 3000', 'less', nested.less),
      job('HTML, nested 3000', 'html', nested.html),
      job('Markdown, nested 3000', 'markdown', nested.markdown),
      job('YAML, nested 3000', 'yaml', nested.yaml),
    ]);
    // How deep each language goes before the stack runs out (the worker's), by doubling.
    const depthOf = {
      javascript: n => `x = ${'['.repeat(n)}${']'.repeat(n)};`,
      typescript: n => `type T = ${'Array<'.repeat(n)}string${'>'.repeat(n)};`,
      css: n => `a{b:${'calc('.repeat(n)}1px${')'.repeat(n)}}`,
      scss: n => `${'.a{'.repeat(n)}color:red${'}'.repeat(n)}`,
      less: n => `${'.a{'.repeat(n)}color:red${'}'.repeat(n)}`,
      html: n => `${'<div>'.repeat(n)}x${'</div>'.repeat(n)}`,
      markdown: n => `${'> '.repeat(n)}x`,
      yaml: n => `a: ${'['.repeat(n)}1${']'.repeat(n)}`,
    };
    const depths = [100, 200, 400, 800, 1600];
    const probes = await onWorker(
      prettierWorker,
      Object.entries(depthOf).flatMap(([language, make]) =>
        depths.map(n => job(`${language} ${n}`, language, make(n))),
      ),
    );
    const deepest = Object.fromEntries(
      Object.keys(depthOf).map(language => {
        const fine = probes
          .filter(p => p.label.startsWith(`${language} `) && p.ok)
          .map(p => Number(p.label.split(' ')[1]));
        return [language, fine.length ? Math.max(...fine) : 0];
      }),
    );
    const xmlMeasured = await onWorker(xmlWorker, [
      job('XML, 1 MiB', 'xml', generate('xml', MI)),
      job('XML, 8 MiB', 'xml', generate('xml', 8 * MI - 64)),
      job('XML, nested 100 000', 'xml', nested.xml),
    ]);
    const all = [...measured.filter(m => !m.label.startsWith('warm')), ...xmlMeasured];
    report.codeFormat = {
      perLanguage,
      sequence,
      bigJavaScript: { input: bundle.length, ...timed },
      measured: all,
      deepest,
    };
    check(
      `${T}: §12 a megabyte per language (Markdown 256 Ki) formats in the worker; deep nesting ends in words, not a hang`,
      all.filter(m => !m.label.includes('nested')).every(m => m.ok) &&
        all.filter(m => m.label.includes('nested')).every(m => m.ok || m.error) &&
        all.every(m => m.wall < 15_000),
      `${all.map(m => `${m.label}: ${m.wall} ms${m.ok ? '' : ` — ${m.error}`}`).join('; ')}; deepest that formats (of ${depths.join(', ')}): ${JSON.stringify(deepest)}`,
    );

    // ── Over the limit: refused in words; a result too large to show is a summary, and Copy has it all. ──
    await tool();
    await choose('Language', 'Markdown');
    await put('x'.repeat(256 * KI + 1));
    const refused = await said('Input is larger than 256 KB. Formatting works with up to 256 KB of Markdown.');
    await choose('Language', 'XML');
    const manyLines = `<r>${'<a/>'.repeat(250_000)}</r>`;
    await put(manyLines);
    await button('Run').click();
    await page.locator('[data-part="summary"]').waitFor({ timeout: 30_000 });
    const summaryText = await page.locator('[data-part="summary"]').innerText();
    await button('Copy').click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 5_000 });
    const copiedBig = (await clipboard.copied()).at(-1) ?? '';
    check(
      `${T}: over the limit is refused in words (§6); a result over 200 000 lines is a summary, Copy takes it whole`,
      refused === 'Input is larger than 256 KB. Formatting works with up to 256 KB of Markdown.' &&
        summaryText === 'Result: 1.7 MB, 250,003 lines. Too large to show here.' &&
        copiedBig.length > 1_700_000 &&
        copiedBig.startsWith('<r>\n  <a/>\n'),
      `${summaryText} (${copiedBig.length} characters copied)`,
    );
    await settledShot(shoot, frame, 'tool-code-format-07-summary-light.png');
    await put('');

    // ── D17: the copied CSS entry is in "Recent entries" and opens back with its language and options. ──
    await tool();
    await choose('Language', 'TypeScript');
    await choose('Indent', 'Tab');
    await choose('Line width', '120');
    await put('interface A{a:number}');
    await result('interface A {\n\ta: number;\n}\n');
    await button('Copy').click();
    await waitForHistoryRecord(page, 'code-format', r => r.label === 'TypeScript · Tab · 21 characters · copied');
    await tool();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').waitFor({ timeout: 5_000 });
    await recent.locator('summary').click();
    const entry = recent
      .locator('.kit-history-entry', { hasText: 'TypeScript · Tab · 21 characters · copied' })
      .first();
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    const restored = {
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      input: await input.inputValue(),
      language: await page.getByLabel('Language', { exact: true }).innerText(),
      indent: await page.getByLabel('Indent', { exact: true }).innerText(),
      width: await page.getByLabel('Line width', { exact: true }).innerText(),
      result: await result('interface A {\n\ta: number;\n}\n'),
    };
    check(
      `${T}: a copied result is in the tool's history as Formatted and opens back with its language and options`,
      restored.listed > 0 &&
        restored.kind === 'Formatted' &&
        restored.input === 'interface A{a:number}' &&
        restored.language === 'TypeScript' &&
        restored.indent === 'Tab' &&
        restored.width === '120' &&
        restored.result === 'interface A {\n\ta: number;\n}\n',
      JSON.stringify(restored),
    );

    // ── The page in the default dark theme. ──
    await tool();
    const dark = await inDarkTheme(ctx, base, page, async () => {
      await choose('Language', 'JavaScript');
      await put('const A=()=><div className="x"><span>{a}</span></div>');
      await result('const A = () => (\n  <div className="x">\n    <span>{a}</span>\n  </div>\n);\n');
      await settledShot(shoot, frame, 'tool-code-format-08-javascript-dark.png');
      await put('function f( {');
      await said('Line 1, column 14: Unexpected token');
      await settledShot(shoot, frame, 'tool-code-format-09-error-dark.png');
      await choose('Language', 'Markdown');
      await put('# Title\n*  one\n*  two\n\n| a | b |\n|-|-|\n| long cell | x |');
      await result('# Title\n\n- one\n- two\n\n| a         | b   |\n| --------- | --- |\n| long cell | x   |\n');
      await settledShot(shoot, frame, 'tool-code-format-10-markdown-dark.png');
      return page.evaluate(() => document.documentElement.dataset.mode);
    });
    check(`${T}: the page in the default dark theme`, dark === 'dark', dark);
    await put('');
  } finally {
    await clipboard.restore();
    await cdp
      .send('Target.setAutoAttach', { autoAttach: false, waitForDebuggerOnStart: false, flatten: false })
      .catch(() => {});
    await cdp.detach().catch(() => {});
  }
};
