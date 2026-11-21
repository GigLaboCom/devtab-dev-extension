// The YAML and JSON tool in the built extension (docs/tools/specs/yaml-json.md): its scenarios (§2) with the page's
// real controls — the conversion in the tool's module worker, under the extension's CSP (no eval: the page refuses it,
// and the library does every conversion below without it); the copy goes to the test browser's own clipboard (CDP
// grants the read). Then the limits of §12 timed in the browser (a multi-megabyte document by Run, Cancel, deep
// nesting, the alias bomb), pasting YAML into the start page's field (§7), an entry opened back from the tool's own
// history (D17), and the page in the light and the dark theme. Run by scripts/e2e-tools.mjs.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { themeMode, withSettings } from '../e2e-theme.mjs';

const LOST = 'JSON has no comments, anchors, tags or YAML styles: they are not carried over.';

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  // Node's URL gives chrome-extension: URLs an opaque origin; the scheme and host are the origin Chrome means.
  const origin = `chrome-extension://${new URL(base).host}`;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });

  await page.goto(`${base}#/tools/yaml-json`);
  const input = page.locator('#yaml-json-input');
  const output = page.locator('#yaml-json-output');
  await input.waitFor();
  const status = page.locator('[data-part="status"]');
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
    await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  };
  // A result counts once it is the input's own, not the previous one kept while the new one is under way.
  const result = async (expected, timeout = 5_000) => {
    await page
      .waitForFunction(
        want =>
          document.querySelector('#yaml-json-output')?.value === want &&
          !document.querySelector('[data-part="status"]')?.hasAttribute('data-stale'),
        expected,
        { timeout },
      )
      .catch(() => {});
    return output.inputValue().catch(() => null);
  };
  const said = async (expected, timeout = 5_000) => {
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
  /** Sets the input as a paste would (one input event), without sending megabytes through the keyboard. */
  const put = text =>
    page.evaluate(value => {
      const field = document.querySelector('#yaml-json-input');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
    }, text);

  // Empty state (§6, §8).
  check(
    'YAML and JSON: opens empty in YAML → JSON, 1.2, 2 spaces; Copy, Save, Swap off',
    (await radio('YAML → JSON').getAttribute('aria-checked')) === 'true' &&
      (await page.getByLabel('YAML version', { exact: true }).innerText()).includes('YAML 1.2') &&
      (await page.getByLabel('Indent', { exact: true }).innerText()).includes('2 spaces') &&
      (await input.getAttribute('placeholder')) === 'key: value' &&
      (await input.getAttribute('spellcheck')) === 'false' &&
      (await button('Copy').isDisabled()) &&
      (await button('Save').isDisabled()) &&
      (await button('Swap').isDisabled()),
  );

  // §2.1: a manifest, Copy.
  await input.fill('apiVersion: v1\nkind: Pod\nmetadata:\n  name: web');
  const manifest = await result(
    '{\n  "apiVersion": "v1",\n  "kind": "Pod",\n  "metadata": {\n    "name": "web"\n  }\n}',
  );
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  // The conversion runs in the tool's module worker, a file of the package; the library in it uses no eval or
  // Function (the extension's CSP would refuse them; the source is searched as the browser fetched it).
  const workers = page.workers().map(w => w.url());
  const workerSource = workers[0] ? await page.evaluate(url => fetch(url).then(r => r.text()), workers[0]) : '';
  const codeFromStrings = (workerSource.match(/\beval\s*\(|new\s+Function\b|\bFunction\s*\(/g) ?? []).length;
  check(
    'YAML and JSON: §2.1 a manifest becomes JSON with 2 spaces, the losses noted, copied — converted in a module worker of the package, with no eval or Function in it',
    manifest === copied &&
      copied.startsWith('{\n  "apiVersion": "v1"') &&
      (await status.innerText()).trim() === 'Valid YAML' &&
      JSON.stringify(await notes()) === JSON.stringify([LOST]) &&
      workers.length === 1 &&
      workers[0].startsWith(`${origin}/assets/convert.worker-`) &&
      workerSource.includes('aliases expand to more than') &&
      codeFromStrings === 0,
    `${workers.join(', ')} (${workerSource.length} bytes, eval/Function: ${codeFromStrings})`,
  );
  await shoot(page, 'tool-yaml-json-01-manifest-light.png');

  // §2.2: YAML 1.1 reads the value on as true, the key stays "on".
  await input.fill('on:\n  push: on');
  const v12 = await result('{\n  "on": {\n    "push": "on"\n  }\n}');
  await choose('YAML version', 'YAML 1.1');
  const v11 = await result('{\n  "on": {\n    "push": true\n  }\n}');
  check(
    'YAML and JSON: §2.2 in YAML 1.1 the value on is true, the key stays "on"',
    v12 === '{\n  "on": {\n    "push": "on"\n  }\n}' && v11 === '{\n  "on": {\n    "push": true\n  }\n}',
    JSON.stringify({ v12, v11 }),
  );
  await choose('YAML version', 'YAML 1.2');

  // §2.3: docker-compose with an anchor and merge keys.
  await choose('Indent', 'Minified');
  await input.fill(
    'x-defaults: &defaults\n  restart: always\n  image: app\nservices:\n  web:\n    <<: *defaults\n    image: web\n  worker:\n    <<: *defaults\n',
  );
  const merged = await result(
    '{"x-defaults":{"restart":"always","image":"app"},"services":{"web":{"restart":"always","image":"web"},"worker":{"restart":"always","image":"app"}}}',
  );
  check(
    'YAML and JSON: §2.3 merge keys apply (the service’s own keys win), with the note',
    merged?.includes('"web":{"restart":"always","image":"web"}') &&
      (await notes()).includes('Aliases were expanded and merge keys (<<) applied: JSON has no references.'),
    merged,
  );

  // §2.4: a broken indent — the error is a link that puts the cursor on its place.
  await input.fill('a:\n  b: 1\n c: 2');
  const indentError = await said('Line 3, column 1: All mapping items must start at the same column');
  await page.getByRole('button', { name: /^Line 3, column 1/ }).click();
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#yaml-json-input');
    return { focused: document.activeElement === el, at: el.selectionStart };
  });
  check(
    'YAML and JSON: §2.4 a broken indent is named with its place; pressing it puts the cursor there; no alert',
    indentError === 'Line 3, column 1: All mapping items must start at the same column' &&
      caret.focused &&
      caret.at === 10 &&
      (await output.inputValue()) === '' &&
      (await page.getByRole('alert').count()) === 0,
    JSON.stringify({ indentError, caret }),
  );
  await shoot(page, 'tool-yaml-json-02-error-light.png');

  // §2.5, §2.6: JSON → YAML keeps numbers and order, quotes "yes".
  await radio('JSON → YAML').click();
  await input.fill('{"id":12345678901234567890,"price":1.50,"b":1,"2":2,"answer":"yes","e":1E400,"z":-0}');
  const yaml = await result('id: 12345678901234567890\nprice: 1.50\nb: 1\n"2": 2\nanswer: "yes"\ne: 1E400\nz: -0\n');
  check(
    'YAML and JSON: §2.5–2.6 JSON → YAML keeps 12345678901234567890, 1.50, 1E400, -0 and the key order; "yes" quoted',
    yaml === 'id: 12345678901234567890\nprice: 1.50\nb: 1\n"2": 2\nanswer: "yes"\ne: 1E400\nz: -0\n' &&
      (await status.innerText()).trim() === 'Valid JSON' &&
      (await notes()).some(n => n.startsWith('2 numbers are kept as written')),
    yaml,
  );
  // …and back: Swap gives the same JSON, digit for digit.
  await button('Swap').click();
  await choose('Indent', 'Minified');
  const back = await result('{"id":12345678901234567890,"price":1.50,"b":1,"2":2,"answer":"yes","e":1E400,"z":-0}');
  check(
    'YAML and JSON: Swap converts the YAML back to the same JSON, numbers digit for digit',
    back === '{"id":12345678901234567890,"price":1.50,"b":1,"2":2,"answer":"yes","e":1E400,"z":-0}' &&
      (await radio('YAML → JSON').getAttribute('aria-checked')) === 'true',
    back,
  );
  await shoot(page, 'tool-yaml-json-03-json-to-yaml-light.png');

  // §2.7: three documents.
  await input.fill('a: 1\n---\nb: 2\n---\n- 3\n');
  const docs = await result('[{"a":1},{"b":2},[3]]');
  check(
    'YAML and JSON: §2.7 three documents become an array of three, with the note',
    docs === '[{"a":1},{"b":2},[3]]' && (await notes()).includes('3 YAML documents became a JSON array of 3 items.'),
  );

  // §2.8: the alias bomb — refused with its place, the page answers meanwhile (the worker does the work).
  const bomb = [`a: &a [${Array(9).fill('"lol"').join(', ')}]`];
  for (const [prev, name] of [...'abcdefgh'].map((c, i) => [c, 'bcdefghi'[i]]))
    bomb.push(`${name}: &${name} [${Array(9).fill(`*${prev}`).join(', ')}]`);
  const bombed = await page.evaluate(async text => {
    const field = document.querySelector('#yaml-json-input');
    let longest = 0;
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    const done = () => document.querySelector('[data-part="status"]').textContent.includes('alias bomb');
    while (!done() && performance.now() - start < 10_000) await new Promise(r => requestAnimationFrame(r));
    const elapsed = performance.now() - start;
    observer.disconnect();
    return {
      elapsed: Math.round(elapsed),
      longest: Math.round(longest),
      text: document.querySelector('[data-part="status"]').textContent.trim(),
    };
  }, bomb.join('\n'));
  check(
    'YAML and JSON: §2.8 the alias bomb is refused at 7:8 in a fraction of a second; the page does not stall',
    bombed.text === 'Line 7, column 8: aliases expand to more than 1,000,000 nodes: refusing (an alias bomb?)' &&
      bombed.elapsed < 3_000 &&
      bombed.longest < 200,
    `${bombed.elapsed} ms after the edit (150 ms of it the settle), longest task on the page ${bombed.longest} ms`,
  );

  // §12: a multi-megabyte document by Run, in the worker; Cancel and Esc stop it; the page keeps answering.
  const bigYaml = await page.evaluate(() => {
    const parts = [];
    let size = 0;
    for (let i = 0; size < 7.5 * 1024 * 1024; i++) {
      const record = `- id: ${i}\n  name: user ${i}\n  email: u${i}@example.com\n  active: ${i % 2 === 0}\n  score: ${i * 1.5}\n  tags: [a, b, ключ]\n  address:\n    city: Town\n    zip: "${10000 + i}"\n    geo: {lat: 12.345678, lng: -98.7654321}\n  big: 12345678901234567890\n`;
      parts.push(record);
      size += record.length;
    }
    return parts.join('');
  });
  await choose('Indent', '2 spaces');
  const pasted = await page.evaluate(async text => {
    const field = document.querySelector('#yaml-json-input');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, bigYaml);
  const largeSaid = await said('Large input: press Run (Ctrl+Enter) to convert it.');
  await sleep(500);
  const runTimed = await page.evaluate(async () => {
    let longest = 0;
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    [...document.querySelectorAll('button')].find(b => b.textContent === 'Run').click();
    let sawConverting = false;
    let frames = 0;
    const summary = () => document.querySelector('[data-part="summary"]')?.textContent ?? '';
    while (!summary() && performance.now() - start < 60_000) {
      sawConverting ||= document.querySelector('[data-part="status"]').textContent.includes('Converting…');
      await new Promise(r => requestAnimationFrame(r));
      frames++;
    }
    const elapsed = performance.now() - start;
    observer.disconnect();
    return { elapsed: Math.round(elapsed), longest: Math.round(longest), frames, sawConverting, summary: summary() };
  });
  check(
    'YAML and JSON: §12 a 7.5 MB YAML document converts by Run in the worker; "Converting…" meanwhile; the page keeps drawing frames; the result is a summary',
    largeSaid === 'Large input: press Run (Ctrl+Enter) to convert it.' &&
      runTimed.sawConverting &&
      /^Result: [\d.]+ MB, [\d,]+ lines\. Too large to show here\.$/.test(runTimed.summary) &&
      runTimed.longest < 500 &&
      !(await button('Copy').isDisabled()),
    `${(bigYaml.length / 1048576).toFixed(2)} Mi characters (the input field took ${pasted} ms to show them): Run → result ${runTimed.elapsed} ms, ${runTimed.frames} frames drawn meanwhile, longest task on the page ${runTimed.longest} ms; ${runTimed.summary}`,
  );
  await shoot(page, 'tool-yaml-json-04-large-summary-light.png');

  await put(`${bigYaml}- id: last\n`);
  await said('Large input: press Run (Ctrl+Enter) to convert it.');
  await button('Run').click();
  await button('Cancel').waitFor({ timeout: 2_000 });
  await button('Cancel').click();
  const afterCancel = await said('Large input: press Run (Ctrl+Enter) to convert it.');
  await input.focus();
  await page.keyboard.press('Control+Enter');
  await said('Converting…', 2_000);
  await page.keyboard.press('Escape');
  const afterEscape = await said('Large input: press Run (Ctrl+Enter) to convert it.');
  check(
    'YAML and JSON: Cancel and Esc stop a Run under way (Ctrl+Enter starts one); no result is left behind',
    afterCancel === 'Large input: press Run (Ctrl+Enter) to convert it.' &&
      afterEscape === 'Large input: press Run (Ctrl+Enter) to convert it.' &&
      (await page.locator('[data-part="summary"]').count()) === 0 &&
      (await output.inputValue()) === '' &&
      (await button('Copy').isDisabled()),
    JSON.stringify({ afterCancel, afterEscape }),
  );

  await put('x'.repeat(8 * 1024 * 1024 + 1));
  const refused = await said('Input is larger than 8 MB. This tool converts up to 8 MB.');
  check(
    'YAML and JSON: §6 more than 8 Mi characters is refused at once',
    refused === 'Input is larger than 8 MB. This tool converts up to 8 MB.' && (await button('Run').count()) === 0,
  );

  // Deep nesting (§5 «Чтение», 11; §15): what the library's recursive parser and printer reach inside a worker's stack,
  // and that past it the page says so in words — never a crash, never a wrong result.
  const settled = async () => {
    await page
      .waitForFunction(
        () => {
          const line = document.querySelector('[data-part="status"]');
          const s = line.textContent.trim();
          return !line.hasAttribute('data-stale') && (s.startsWith('Valid') || s.startsWith('Line'));
        },
        null,
        { timeout: 10_000 },
      )
      .catch(() => {});
    return (await status.innerText()).trim();
  };
  const nested = depth => `${'['.repeat(depth)}${']'.repeat(depth)}`;
  await put('');
  await radio('JSON → YAML').click();
  const toYaml = {};
  for (const depth of [500, 1000, 1001]) {
    await put('');
    await put(nested(depth));
    toYaml[depth] = await settled();
  }
  await radio('YAML → JSON').click();
  const toJson = {};
  for (const depth of [300, 1000, 5000]) {
    await put('');
    await put(nested(depth));
    toJson[depth] = await settled();
  }
  const chain = ['l0: &l0 [x]'];
  for (let i = 1; i <= 1000; i++) chain.push(`l${i}: &l${i} [*l${i - 1}]`);
  await choose('Indent', 'Minified');
  await put('');
  await put(chain.join('\n'));
  const aliasDeep = await settled();
  await choose('Indent', '2 spaces');
  check(
    'YAML and JSON: deep nesting — JSON of 500 levels becomes YAML and 1001 is refused; flow YAML of 300 converts; past the library’s stack, and past 1000 levels built by aliases, a worded error with its place',
    toYaml[500] === 'Valid JSON' &&
      (toYaml[1000] === 'Valid JSON' ||
        /^Line 1, column \d+: nesting too deep for the YAML printer: it ran out of stack here$/.test(toYaml[1000])) &&
      toYaml[1001] === 'Line 1, column 1001: nesting deeper than 1000 levels' &&
      toJson[300] === 'Valid YAML' &&
      /^Line 1, column \d+: nesting too deep for the YAML parser: it ran out of stack here/.test(toJson[5000]) &&
      /^Line \d+, column \d+: nesting deeper than 1000 levels$/.test(aliasDeep),
    `JSON → YAML ${JSON.stringify(toYaml)}; YAML → JSON ${JSON.stringify(toJson)}; 1001 levels of aliases: ${aliasDeep}`,
  );
  await put('');

  // §7: YAML pasted into the start page's field opens this tool with it; JSON opens the JSON tool; prose nothing.
  const paste = async text => {
    await page.goto(`${base}#/start`);
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
  await paste('apiVersion: v1\nkind: Pod\n');
  await page.waitForFunction(() => location.hash === '#/tools/yaml-json', null, { timeout: 5_000 }).catch(() => {});
  await input.waitFor({ timeout: 5_000 }).catch(() => {});
  const opened = {
    hash: await page.evaluate(() => location.hash),
    input: await input.inputValue().catch(() => null),
    result: await result('{\n  "apiVersion": "v1",\n  "kind": "Pod"\n}'),
  };
  check(
    'YAML and JSON: §7 YAML pasted into the start page opens the tool with it, converted',
    opened.hash === '#/tools/yaml-json' &&
      opened.input === 'apiVersion: v1\nkind: Pod\n' &&
      opened.result === '{\n  "apiVersion": "v1",\n  "kind": "Pod"\n}',
    JSON.stringify(opened),
  );
  const elsewhere = [];
  for (const text of ['{"a": 1, "b": [2]}', 'Note: this is a sentence.', 'key=value\nother=1', '* * * * *']) {
    await paste(text);
    await sleep(300);
    if ((await page.evaluate(() => location.hash)) === '#/tools/yaml-json') elsewhere.push(text);
  }
  check(
    'YAML and JSON: §7 JSON, prose, key=value and cron do not open it',
    elsewhere.length === 0,
    elsewhere.join(' | '),
  );

  // D17: what was taken (Copy) is in the tool's own history and opens back into the tool.
  await page.goto(`${base}#/tools/yaml-json`);
  await input.waitFor();
  await choose('YAML version', 'YAML 1.1');
  await input.fill('enabled: yes\nport: 010');
  await result('{\n  "enabled": true,\n  "port": 8\n}');
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  await sleep(500); // the record is written asynchronously
  await page.goto(`${base}#/start`);
  await page.goto(`${base}#/tools/yaml-json`);
  await input.waitFor();
  const recent = page.locator('.kit-tool-history-recent');
  await recent.locator('summary').waitFor({ timeout: 5_000 });
  await recent.locator('summary').click();
  const entry = recent
    .locator('.kit-history-entry', { hasText: 'YAML 1.1 → JSON · 2 spaces · 22 characters · copied' })
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
    version: await page.getByLabel('YAML version', { exact: true }).innerText(),
    result: await result('{\n  "enabled": true,\n  "port": 8\n}'),
  };
  check(
    'YAML and JSON: a copied result is in the tool’s history as YAML → JSON and opens back with its YAML version',
    restored.listed > 0 &&
      restored.kind === 'YAML → JSON' &&
      restored.input === 'enabled: yes\nport: 010' &&
      restored.version.includes('YAML 1.1') &&
      restored.result === '{\n  "enabled": true,\n  "port": 8\n}',
    JSON.stringify(restored),
  );

  // The page in the light and the dark theme (entered afresh), then the theme mode as it was.
  await page.goto(`${base}#/start`);
  await page.goto(`${base}#/tools/yaml-json`);
  await input.waitFor();
  const modeBefore = await withSettings(ctx, base, settings =>
    settings.getByRole('radiogroup', { name: 'Theme mode' }).locator('[role="radio"][aria-checked="true"]').innerText(),
  );
  const compose =
    'x-defaults: &defaults\n  restart: always\nservices:\n  web:\n    <<: *defaults\n    image: "nginx:1.27"\n    ports:\n      - "80:80"\n  db:\n    <<: *defaults\n    image: postgres\n';
  await input.fill(compose);
  await result(
    '{\n  "x-defaults": {\n    "restart": "always"\n  },\n  "services": {\n    "web": {\n      "restart": "always",\n      "image": "nginx:1.27",\n      "ports": [\n        "80:80"\n      ]\n    },\n    "db": {\n      "restart": "always",\n      "image": "postgres"\n    }\n  }\n}',
  );
  await shoot(page, 'tool-yaml-json-05-compose-light.png');
  await themeMode(ctx, base, 'Dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme?.endsWith('dark'), null, {
    timeout: 5_000,
  });
  await sleep(300);
  await shoot(page, 'tool-yaml-json-06-compose-dark.png');
  await input.fill('a:\n\tb: 1');
  await said('Line 2, column 1: Tabs are not allowed as indentation');
  await shoot(page, 'tool-yaml-json-07-error-dark.png');
  await radio('JSON → YAML').click();
  await input.fill('{"yes":"yes","time":"1:20","id":12345678901234567890,"note":"line1\\nline2\\n"}');
  await result('"yes": "yes"\ntime: "1:20"\nid: 12345678901234567890\nnote: |\n  line1\n  line2\n');
  await shoot(page, 'tool-yaml-json-08-json-to-yaml-dark.png');
  await themeMode(ctx, base, modeBefore.trim());
  await radio('YAML → JSON').click();
  await input.fill('');
  await cdp.detach();
};
