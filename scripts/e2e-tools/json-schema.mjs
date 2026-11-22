// The JSON Schema tool in the built extension (docs/tools/specs/json-schema.md): its scenarios (§2) the way a person
// does them — the page's real controls — run by scripts/e2e-tools.mjs. Validation runs in the tool's module worker,
// loaded from the package's own file (never blob: or data:). Proved here: a remote $ref is never fetched (no request
// leaves the extension, no content security policy violation); the built chunks of the tool hold no eval, new
// Function or network call. Measured (§12): a 5 MB document, 10,000 violations, a recursive schema on a deep document,
// a pattern that backtracks, nesting 10,000 deep — time, the longest frame, the message shown. Also generation, the
// history (a record written and opened back), a saved parameter, and what a schema pasted into the start page opens.
// The copy buttons' clipboard writes are caught in the page (stubClipboard), so the run never touches a real clipboard.

/* global document, window, location, requestAnimationFrame, HTMLTextAreaElement, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA =
  '{\n  "type": "object",\n  "properties": {\n    "port": { "type": "integer" }\n  },\n  "required": ["port"]\n}';
const DOC = '{\n  "name": "web",\n  "port": "8080"\n}';

const RECORDS_SCHEMA = JSON.stringify({
  type: 'array',
  items: {
    type: 'object',
    required: ['id', 'name'],
    properties: {
      id: { type: 'integer', minimum: 0 },
      name: { type: 'string', maxLength: 40 },
      tags: { type: 'array', items: { type: 'string' }, uniqueItems: true },
      address: {
        type: 'object',
        properties: { city: { type: 'string' }, zip: { type: 'string', pattern: '^[0-9]{5}$' } },
      },
      score: { type: 'number', multipleOf: 0.5 },
      active: { type: 'boolean' },
    },
  },
});

/** About `mb` megabytes of records, every one valid against RECORDS_SCHEMA. */
const records = mb => {
  const out = [];
  let size = 2;
  for (let k = 0; size < mb * 1024 * 1024; k++) {
    const r = {
      id: k,
      name: `user ${k}`,
      tags: ['a', 'b', 'c'],
      address: { city: 'X', zip: String(10000 + (k % 89999)) },
      score: k * 1.5,
      active: k % 2 === 0,
    };
    size += JSON.stringify(r).length + 1;
    out.push(r);
  }
  return JSON.stringify(out);
};

/** Frame watch in the page: the longest gap between animation frames, and the longest task. */
const watchFrames = page =>
  page.evaluate(() => {
    const w = { max: 0, last: performance.now(), on: true, longest: 0 };
    window.__frames = w;
    const tick = t => {
      if (!w.on) return;
      w.max = Math.max(w.max, t - w.last);
      w.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    w.observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) w.longest = Math.max(w.longest, e.duration);
    });
    w.observer.observe({ type: 'longtask', buffered: false });
  });

const stopFrames = page =>
  page.evaluate(() => {
    const w = window.__frames;
    w.on = false;
    w.observer.disconnect();
    return { max: Math.round(w.max), longest: Math.round(w.longest) };
  });

/**
 * The built chunks of this tool's own code: its component chunk and its worker (the logic, the meta-schemas and the
 * scanner are bundled into them), and the shared pure chunks they import (`json-scan`). The app's shell, the kit and
 * the host they also import are not the tool's code and are listed apart.
 */
const toolChunks = dist => {
  const assets = join(dist, 'assets');
  const names = readdirSync(assets).filter(f => f.endsWith('.js'));
  const own = names.filter(f => /^(JsonSchemaTool|json-schema\.worker)-[\w-]+\.js$/.test(f));
  const shared = new Set();
  for (const name of own) {
    const text = readFileSync(join(assets, name), 'utf8');
    for (const m of text.matchAll(/(?:from|import)\s*\(?\s*["']\.\/([\w.-]+\.js)["']/g)) shared.add(m[1]);
  }
  const pure = [...shared].filter(n => /^json-scan-[\w-]+\.js$/.test(n));
  return {
    chunks: [...own, ...pure].map(name => ({ name, text: readFileSync(join(assets, name), 'utf8') })),
    imported: [...shared].filter(n => !pure.includes(n)),
  };
};

export default async args => {
  let clipboard = null;
  try {
    clipboard = await run(args);
  } finally {
    await args.page.evaluate(() => delete navigator.clipboard.writeText).catch(() => undefined);
    await clipboard?.restore().catch(() => undefined);
    await forgetSavedParameters(args.page, 'json-schema').catch(() => undefined);
  }
};

const run = async ({ ctx, page, base, check, shoot, report }) => {
  const workers = [];
  page.on('worker', w => workers.push({ url: w.url() }));
  // Every request any page or worker of the context makes that does not stay inside the extension.
  const outside = [];
  const onRequest = r => {
    if (!r.url().startsWith('chrome-extension://')) outside.push(r.url());
  };
  ctx.on('request', onRequest);
  const open = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(url => location.replace(url), `${base}${hash}`);
    else await page.goto(`${base}${hash}`);
  };
  await open('#/tools/json-schema');
  const schemaField = page.locator('#json-schema-schema');
  const docField = page.locator('#json-schema-document');
  // An element of this tool (not the heading): the page shows "Loading…" until its history is open.
  await schemaField.waitFor({ timeout: 15_000 });
  await page.evaluate(() => {
    window.__csp = [];
    document.addEventListener('securitypolicyviolation', e =>
      window.__csp.push(`${e.violatedDirective} ${e.blockedURI}`),
    );
  });
  const status = page.locator('[data-status]');
  const statusText = async () => (await status.innerText().catch(() => '')).trim();
  const message = async where =>
    (
      await page
        .locator(`[data-field="${where}"]`)
        .innerText()
        .catch(() => '')
    ).trim();
  const until = want => page.locator('[data-status]', { hasText: want }).waitFor({ timeout: 20_000 });
  const button = name => page.getByRole('button', { name, exact: true });
  const rows = (table = 'Violations') =>
    page
      .getByRole('table', { name: table, exact: true })
      .locator('tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.cells].map(td => td.innerText.replace(/\s+/g, ' ').trim())));
  /** Sets a field as a paste would (React hears the input event); no typing of megabytes. */
  const setValue = (selector, text) =>
    page.evaluate(
      ([s, t]) => {
        const el = document.querySelector(s);
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, t);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      },
      [selector, text],
    );
  const shootAll = async name => {
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: 1_300 });
    await page.locator('[data-slot="tool-page"]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await settledShot(shoot, page, name);
    await page.setViewportSize(size);
  };
  const clipboard = await stubClipboard(page);
  const copied = async () => (await clipboard.copied()).at(-1);
  report.jsonSchema = {};

  check(
    'JSON Schema: opens empty in Validate — no status, no table, the referenced schemas place',
    (await schemaField.inputValue()) === '' &&
      (await docField.inputValue()) === '' &&
      (await statusText()) === '' &&
      (await page.getByRole('table').count()) === 0 &&
      (await page.getByRole('radio', { name: 'Validate' }).getAttribute('data-state')) === 'on' &&
      (await button('Add a referenced schema').count()) === 1,
  );

  // §2.1: one violation with both places; a click puts the caret on it; Copy violations.
  await setValue('#json-schema-schema', SCHEMA);
  await setValue('#json-schema-document', DOC);
  await until('1 violation');
  const first = await rows();
  await page.getByRole('button', { name: 'Go to /port, line 3, column 11' }).click();
  const caret = await docField.evaluate(el => [document.activeElement === el, el.selectionStart]);
  await button('Copy violations').click();
  const copiedViolations = await copied();
  check(
    'JSON Schema: §2.1 one violation — the place in the document and in the schema, a sentence; a click puts the caret there; Copy violations',
    JSON.stringify(first) ===
      JSON.stringify([
        ['1', '/port line 3, column 11', 'Expected an integer, got the string "8080".', '#/properties/port/type'],
      ]) &&
      JSON.stringify(caret) === JSON.stringify([true, DOC.indexOf('"8080"')]) &&
      copiedViolations ===
        '/port (line 3, column 11): Expected an integer, got the string "8080". [#/properties/port/type]',
    `${JSON.stringify(first)} ${JSON.stringify(caret)} ${JSON.stringify(copiedViolations)}`,
  );
  check(
    'JSON Schema: validation runs in the tool’s module worker, loaded from the extension’s own file',
    workers.length > 0 &&
      workers.every(
        w => w.url.startsWith('chrome-extension://') && /\/assets\/json-schema\.worker-[\w-]+\.js$/.test(w.url),
      ),
    workers.map(w => w.url).join(', '),
  );
  await shootAll('tool-json-schema-01-violations-light.png');

  // §2.2: a remote $ref is never fetched: a problem of the schema names it; pasted with its $id, it resolves.
  const before = outside.length;
  await setValue('#json-schema-schema', '{"$ref": "https://example.com/schemas/address.json"}');
  await setValue('#json-schema-document', '{"city": 1}');
  await page.getByRole('table', { name: 'Schema problems', exact: true }).waitFor({ timeout: 10_000 });
  const unresolved = await rows('Schema problems');
  await button('Add a referenced schema').click();
  await setValue(
    '#json-schema-referenced-0',
    '{"$id": "https://example.com/schemas/address.json", "properties": {"city": {"type": "string"}}}',
  );
  await until('1 violation');
  await page.waitForTimeout(500);
  const csp = await page.evaluate(() => window.__csp);
  check(
    'JSON Schema: §2.2 a remote $ref is never fetched — the page names it, no request leaves the extension, no CSP violation; pasted with its $id it resolves',
    unresolved[0]?.[2] ===
      'The reference https://example.com/schemas/address.json could not be resolved: schemas are never fetched. Add it under Referenced schemas with "$id": "https://example.com/schemas/address.json".' &&
      (await message('referenced-0')) === 'Found by "$id": https://example.com/schemas/address.json' &&
      (await rows())[0]?.[3] === '#/$ref/properties/city/type' &&
      outside.length === before &&
      csp.length === 0,
    `requests outside: ${JSON.stringify(outside.slice(before))}; CSP: ${JSON.stringify(csp)}`,
  );
  await button('Remove referenced schema 1').click();

  // §2.3: a schema that fails its meta-schema.
  await setValue('#json-schema-schema', '{\n  "type": "strnig"\n}');
  await setValue('#json-schema-document', '1');
  await page.locator('[data-field="problems"]', { hasText: 'The schema has 1 problem' }).waitFor({ timeout: 10_000 });
  const meta = await rows('Schema problems');
  check(
    'JSON Schema: §2.3 the schema’s own problem is shown apart, against the draft 2020-12 meta-schema; the document is not checked',
    meta[0]?.[1] === '/type line 2, column 11' &&
      meta[0]?.[2] === 'Must be one of: "array", "boolean", "integer", "null", "number", "object", "string".' &&
      (await message('problems')) ===
        'The schema has 1 problem: checked against the draft 2020-12 meta-schema. The document is checked once the schema is valid.' &&
      (await statusText()) === '',
    JSON.stringify(meta),
  );
  await shootAll('tool-json-schema-02-problems-light.png');

  // §2.4: exact numbers in Chrome's engine (BigInt), not doubles.
  await setValue('#json-schema-schema', '{"multipleOf": 0.1}');
  await setValue('#json-schema-document', '0.3');
  await until('The document is valid.');
  await setValue('#json-schema-schema', '{"maximum": 12345678901234567890}');
  await setValue('#json-schema-document', '12345678901234567891');
  await until('1 violation');
  check(
    'JSON Schema: §2.4 0.3 is a multiple of 0.1; 12345678901234567891 is above 12345678901234567890',
    (await rows())[0]?.[2] === 'Must be at most 12345678901234567890, got 12345678901234567891.',
  );

  // §12: 10,000 violations — the first 1,000 rows, the line, Copy takes all.
  await setValue('#json-schema-schema', '{"items": {"type": "integer"}}');
  await watchFrames(page);
  const many = await page.evaluate(async () => {
    const el = document.querySelector('#json-schema-document');
    const text = `[${Array.from({ length: 10_000 }, (_, i) => `"v${i}"`).join(',')}]`;
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const done = () => document.querySelector('[data-status]')?.textContent.trim() === '10,000 violations';
    while (!done() && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
    const counted = performance.now() - start;
    while (!document.querySelector('tr[data-row="999"]') && performance.now() - start < 20_000)
      await new Promise(r => requestAnimationFrame(r));
    return { counted: Math.round(counted), built: Math.round(performance.now() - start) };
  });
  const manyFrames = await stopFrames(page);
  await button('Copy violations').click();
  const manyCopy = await copied();
  report.jsonSchema.manyViolations = { ...many, frames: manyFrames, copiedLines: manyCopy.split('\n').length };
  check(
    'JSON Schema: §12 10,000 violations — counted, 1,000 rows built without a long frame, the bound said, Copy copies all 10,000',
    (await message('violations')) === 'Showing 1,000 of 10,000 violations. Copy violations copies all.' &&
      manyCopy.split('\n').length === 10_000 &&
      manyFrames.max < 250,
    `edit → count ${many.counted} ms, 1,000 rows ${many.built} ms; longest frame gap ${manyFrames.max} ms, longest task ${manyFrames.longest} ms`,
  );

  // §12: 5 MB of records — the text box's cost apart from the tool's.
  await setValue('#json-schema-schema', '');
  await setValue('#json-schema-document', '');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.trim() === '');
  const big = records(5);
  const field = await page.evaluate(async text => {
    const el = document.querySelector('#json-schema-document');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, big);
  await page.waitForTimeout(600);
  await watchFrames(page);
  const bigRun = await page.evaluate(async schema => {
    const el = document.querySelector('#json-schema-schema');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, schema);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const done = () => document.querySelector('[data-status]')?.textContent.trim() === 'The document is valid.';
    while (!done() && performance.now() - start < 30_000) await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - start);
  }, RECORDS_SCHEMA);
  const bigFrames = await stopFrames(page);
  report.jsonSchema.fiveMegabytes = { chars: big.length, field, validMs: bigRun, frames: bigFrames };
  check(
    'JSON Schema: §12 a 5 MB document is checked in the worker — valid, the page keeps its frames',
    (await statusText()) === 'The document is valid.' && bigFrames.max < 250,
    `${big.length} characters: text box ${field} ms; schema edit → «valid» ${bigRun} ms (150 ms of it the wait after the edit); longest frame gap ${bigFrames.max} ms, longest task ${bigFrames.longest} ms`,
  );
  await setValue('#json-schema-document', '1');
  await page.waitForTimeout(300);

  // §12: a recursive schema on a deep document — where the engine's stack ends, said in words.
  await setValue('#json-schema-schema', '{"type": "array", "items": {"$ref": "#"}}');
  const depths = {};
  for (const n of [300, 400, 500, 600, 800, 999]) {
    await setValue('#json-schema-document', `${'['.repeat(n)}${']'.repeat(n)}`);
    await page.waitForTimeout(400);
    await page.waitForFunction(
      () =>
        document.querySelector('[data-status]')?.textContent.trim() === 'The document is valid.' ||
        !!document.querySelector('[data-refused]'),
      null,
      { timeout: 10_000 },
    );
    depths[n] = (await page.locator('[data-refused]').count()) ? 'refused' : 'valid';
  }
  const deepMessage = (
    await page
      .locator('[data-refused]')
      .innerText()
      .catch(() => '')
  ).trim();
  report.jsonSchema.recursiveDepths = depths;
  check(
    'JSON Schema: §12 a recursive $ref on a deep document — checked to 400 levels at least; deeper the page says why instead of freezing',
    depths[400] === 'valid' &&
      (depths[999] === 'valid' ||
        deepMessage ===
          'The document nests too deep for this schema: checking it would recurse past what the browser allows. Flatten the document or the schema.'),
    JSON.stringify(depths),
  );

  // §12: nesting 10,000 deep — the scanner's limit of 1,000 levels, at once.
  const t10k = Date.now();
  await setValue('#json-schema-document', `${'['.repeat(10_000)}${']'.repeat(10_000)}`);
  await page.locator('[data-part="document-error"]').waitFor({ timeout: 10_000 });
  const deepError = (await page.locator('[data-part="document-error"]').innerText()).trim();
  const deepMs = Date.now() - t10k;
  report.jsonSchema.tenThousandDeep = { ms: deepMs, message: deepError };
  check(
    'JSON Schema: §12 nesting 10,000 deep is the scanner’s error, at once',
    deepError === 'Line 1, column 1001: nesting deeper than 1000 levels',
    `${deepError} (${deepMs} ms, 150 ms of it the wait after the edit)`,
  );

  // §2.7: a pattern that backtracks is stopped at 1 s; the page answers meanwhile.
  await setValue('#json-schema-schema', '{"pattern": "^(a+)+$"}');
  await watchFrames(page);
  const t0 = Date.now();
  await setValue('#json-schema-document', JSON.stringify(`${'a'.repeat(40)}!`));
  await page.waitForTimeout(600);
  const focusMs = await page.evaluate(async () => {
    const t = performance.now();
    document.querySelector('#json-schema-schema').focus();
    await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - t);
  });
  const runningShown = (await statusText()).includes('Running…');
  await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
  const stoppedMs = Date.now() - t0;
  const patternFrames = await stopFrames(page);
  const stoppedText = (await page.locator('[data-stopped] [role="alert"]').innerText()).trim();
  report.jsonSchema.backtracking = { stoppedMs, focusMs, frames: patternFrames };
  check(
    'JSON Schema: §2.7 a pattern that backtracks is stopped after 1 second with the reason; the page answers and says Running…',
    stoppedText ===
      'Stopped after 1 second: validation takes too long. A pattern such as (a+)+ in the schema often causes this.' &&
      (await button('Allow 10 seconds').count()) === 1 &&
      stoppedMs < 3_000 &&
      focusMs < 200 &&
      patternFrames.max < 150 &&
      runningShown,
    `${stoppedMs} ms from the edit to the message; focus answered in ${focusMs} ms; longest frame gap ${patternFrames.max} ms`,
  );

  // The built chunks of the tool: no eval, no new Function, no network.
  const { chunks, imported } = toolChunks(report.dist);
  const forbidden =
    /\beval\(|new Function\b|\bFunction\(|\bfetch\(|XMLHttpRequest|WebSocket|importScripts|sendBeacon|EventSource/;
  const hits = chunks.filter(c => forbidden.test(c.text)).map(c => `${c.name}: ${c.text.match(forbidden)[0]}`);
  report.jsonSchema.chunks = { own: chunks.map(c => ({ name: c.name, bytes: c.text.length })), imported };
  check(
    'JSON Schema: the built chunks of the tool’s code (component, worker, the shared scanner) hold no eval, new Function or network call',
    chunks.some(c => c.name.startsWith('json-schema.worker-')) &&
      chunks.some(c => c.name.startsWith('JsonSchemaTool-')) &&
      hits.length === 0,
    `${chunks.map(c => `${c.name} ${c.text.length} B`).join(', ')}; also imports the app's ${imported.length} shared chunks${hits.length ? `; found: ${hits.join(', ')}` : ''}`,
  );

  // §2.6: generation; Validate with it.
  await page.getByRole('radio', { name: 'Generate schema' }).click();
  const samples = page.locator('#json-schema-samples');
  await samples.waitFor();
  await setValue('#json-schema-samples', '{"id":1,"name":"Ann","email":null}\n{"id":2,"name":"Bob","tags":["a"]}');
  await page.locator('[data-field="inferred"]', { hasText: '2 samples merged' }).waitFor({ timeout: 10_000 });
  const inferred = await page.locator('#json-schema-inferred').inputValue();
  await shootAll('tool-json-schema-03-generate-light.png');
  await button('Validate with it').click();
  await schemaField.waitFor();
  check(
    'JSON Schema: §2.6 two samples give a schema with the shared properties required; Validate with it carries it over',
    JSON.stringify(JSON.parse(inferred).required) === '["id","name"]' && (await schemaField.inputValue()) === inferred,
    inferred.slice(0, 120),
  );

  // Dark theme screenshots.
  await inDarkTheme(ctx, base, page, async () => {
    await setValue('#json-schema-schema', SCHEMA);
    await setValue('#json-schema-document', DOC);
    await until('1 violation');
    await shootAll('tool-json-schema-01-violations-dark.png');
    await setValue('#json-schema-schema', '{\n  "type": "strnig"\n}');
    await page.locator('[data-field="problems"]', { hasText: 'The schema has 1 problem' }).waitFor({ timeout: 10_000 });
    await shootAll('tool-json-schema-02-problems-dark.png');
    await page.getByRole('radio', { name: 'Generate schema' }).click();
    await page.locator('[data-field="inferred"]', { hasText: '2 samples merged' }).waitFor({ timeout: 10_000 });
    await shootAll('tool-json-schema-03-generate-dark.png');
    await page.getByRole('radio', { name: 'Validate' }).click();
  });

  // History: a validation is recorded in clear; it opens back into the tool.
  await setValue('#json-schema-schema', SCHEMA);
  await setValue('#json-schema-document', DOC);
  await until('1 violation');
  await open('#/tools');
  const entry = await waitForHistoryRecord(
    page,
    'json-schema',
    r => r.kind === 'validate' && r.label === 'Validate · 1 violation',
  ).catch(() => null);
  check(
    'JSON Schema: a validation is recorded in clear with its outcome',
    !!entry && !entry.sealed,
    entry ? `${entry.kind}: ${entry.label}` : 'no record',
  );
  await open('#/tools/json-schema');
  await schemaField.waitFor();
  await page.getByText('Recent entries').click();
  await page.locator('.kit-history-entry').first().waitFor();
  await page
    .locator('.kit-history-entry')
    .filter({ hasText: 'Validate · 1 violation' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByText('Opened from History: Validate · 1 violation.').waitFor({ timeout: 10_000 });
  await until('1 violation');
  check(
    'JSON Schema: the entry opens back with the schema and the document, and validates again',
    (await schemaField.inputValue()) === SCHEMA && (await docField.inputValue()) === DOC,
  );

  // Saved parameter (D21): changed, opened again — as left.
  await page.getByLabel('Draft without $schema').click();
  await page.getByRole('option', { name: 'Draft 7', exact: true }).click();
  await page.waitForTimeout(400);
  await open('#/tools');
  await open('#/tools/json-schema');
  await schemaField.waitFor();
  check(
    'JSON Schema: a changed option is kept — opened again, the draft is Draft 7',
    (await page.getByLabel('Draft without $schema').innerText()).trim() === 'Draft 7',
  );

  // §7: what a pasted schema opens on the start page (detect in registry order: JSON, № 1, comes first).
  const paste = async text => {
    await open('#/start');
    const box = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await box.waitFor();
    await box.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
    await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5_000 }).catch(() => {});
    return page.evaluate(() => location.hash);
  };
  const pastedSchema = await paste('{"$schema": "https://json-schema.org/draft/2020-12/schema", "type": "object"}');
  report.jsonSchema.pastedSchemaOpens = pastedSchema;
  check(
    'JSON Schema: §7 a schema with $schema pasted into the start page opens the JSON tool (registry order: № 1 recognises any JSON first)',
    pastedSchema === '#/tools/json',
    pastedSchema,
  );
  ctx.off('request', onRequest);
  return clipboard;
};
