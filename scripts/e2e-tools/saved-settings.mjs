// Saved parameters (D21; docs/tools/settings.md) in the built extension: a host capability checked across the tools
// wired to it, so it is one module, not a part of each tool's own (run by scripts/e2e-tools.mjs like them;
// `pnpm test:e2e -- --only=saved-settings` runs it alone).
//
// The build under test is the default one — the edition root (extension/src/edition/index.ts) selects Pro:
//   - JSON, Base64, cURL to Code, Password Generator, Date Calculator: parameters changed, the tool left and opened
//     again (in the same tab and in a new one), they are as left;
//   - "Reset settings" in the tool page's head: absent while nothing differs from the defaults (a typed input is not a
//     parameter), present after a change, and pressing it puts the defaults back, keeps the input, removes the tool's
//     saved record, says so once and moves the focus to the title;
//   - an entry opened from History (JSON) and a text pasted into the start page (Base64, opening Decode) win for that
//     visit and leave what is saved alone;
//   - a record damaged by hand in chrome.storage.local does not break a tool: what is valid is used, the rest is the
//     defaults, no page error;
//   - nothing but parameters is stored: after each tool was used with a recognisable input (and a secret, and the
//     passwords it made), the stored bytes hold none of it, and each tool's record names only its declared fields;
//   - a write the browser refuses (chrome.storage.local filled to its quota): the tool page says in one line that the
//     settings could not be saved and keeps the choice; with room again the next change saves both and the line goes.
// Then the free edition: built from the same sources with the root reading `free` (DEVTAB_VARIANT=edition:free, the
// one line changed at build time — extension/vite.config.ts) into .state/e2e/dist-free, loaded in a browser of its
// own: no tool parameter is ever written to storage, a tool opens with its defaults on every visit (a new tab, a
// reload), and there is no reset control.
// Every setting it changes is put back as it found it before it ends: other modules share the browser and the
// profile and expect a tool to open with its defaults.

/* global document, window, chrome, location, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the pages */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { stubClipboard } from '../e2e-helpers.mjs';

const T = 'Saved settings';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

/** The fields each wired tool declares (its src/settings.ts): a stored record must name nothing else. */
const DECLARED = {
  json: ['mode', 'indent', 'sortKeys', 'allowComments'],
  base64: ['mode', 'alphabet', 'padding', 'lineLength'],
  'curl-to-code': ['target'],
  password: [
    'mode',
    'length',
    'setsUpper',
    'setsLower',
    'setsDigits',
    'setsSymbols',
    'symbols',
    'avoidLookAlike',
    'words',
    'separator',
    'capitalize',
    'count',
  ],
  'date-calc': ['zones', 'operation'],
};

const MARK = 'SAVEDSETTINGSPROBE';

/** What a tool page says while the browser refuses to store the tool's settings (SAVE_PROBLEM_TEXT of the host package). */
const NOT_SAVED = 'Settings could not be saved. They stay as you set them until this page is closed.';
/** The key this module fills chrome.storage.local with, to its quota, and removes. */
const FILLER = 'e2eQuotaFiller';

export default async ({ ctx, base, check, sleep, report }) => {
  const opened = [];
  const watch = p => {
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  };
  const open = async hash => {
    const p = await ctx.newPage();
    watch(p);
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  const stored = p => p.evaluate(() => chrome.storage.local.get('toolSettings').then(r => r.toolSettings ?? null));
  const putStored = (p, value) =>
    p.evaluate(
      v => (v === null ? chrome.storage.local.remove('toolSettings') : chrome.storage.local.set({ toolSettings: v })),
      value,
    );
  /** The record with these tools' saved parameters taken out (the rest as it was). */
  const withoutParams = (record, ids) => {
    if (!record) return record;
    const params = Object.fromEntries(Object.entries(record.params ?? {}).filter(([id]) => !ids.includes(id)));
    const rest = { ...record };
    delete rest.params;
    return Object.keys(params).length ? { ...rest, params } : rest;
  };
  const paramsOf = async (p, id) => (await stored(p))?.params?.[id] ?? null;
  /** Waits until the tool's stored record passes `test` (writes are debounced). */
  const storedFor = async (p, id, test, timeout = 5_000) => {
    const until = Date.now() + timeout;
    let last = null;
    while (Date.now() < until) {
      last = await paramsOf(p, id);
      if (test(last)) return last;
      await sleep(100);
    }
    return last;
  };
  const resetButton = p => p.getByRole('button', { name: 'Reset settings', exact: true });
  const hasReset = async p => (await resetButton(p).count()) > 0;
  const radioOn = async (p, name) =>
    (await p.getByRole('radio', { name, exact: true }).getAttribute('aria-checked')) === 'true';
  const checkedState = (p, label) => p.getByLabel(label, { exact: true }).getAttribute('data-state');
  const choose = async (p, label, option) => {
    await p.getByLabel(label, { exact: true }).click();
    await p.getByRole('option', { name: option, exact: true }).click();
  };
  const tools = Object.keys(DECLARED);
  /** The same values, whatever the order of their keys. */
  const same = (a, b) =>
    JSON.stringify(Object.entries(a ?? {}).sort()) === JSON.stringify(Object.entries(b ?? {}).sort());

  const main = await open('#/tools');
  const before = await stored(main);
  let clipboard = null;
  const freeDist = join(ROOT, '.state/e2e/dist-free');
  const used = [];
  try {
    // Start from the defaults: an earlier module may have left a tool's parameters saved.
    await putStored(main, withoutParams(before, tools));

    // ---- JSON: options saved; the reset control; an entry opened from History. ----
    const json = await open('#/tools/json');
    const jsonInput = json.locator('#json-input');
    await jsonInput.waitFor({ timeout: 15_000 });
    // Copy writes the page's own clipboard, stubbed: nothing reaches the browser's or the machine's.
    clipboard = await stubClipboard(json);
    const jsonText = `{"probe":"${MARK}-json","b":1,"a":2}`;
    await jsonInput.fill(jsonText);
    await json.locator('#json-output').waitFor();
    await sleep(700);
    check(
      `${T}: JSON — a typed input is not a parameter: nothing saved, no reset control`,
      (await paramsOf(json, 'json')) === null && !(await hasReset(json)),
    );
    await choose(json, 'Indent', 'Tab');
    await json.getByLabel('Sort keys', { exact: true }).click();
    await resetButton(json).waitFor({ timeout: 3_000 });
    const jsonSaved = await storedFor(json, 'json', r => r?.values?.sortKeys === true && r.values.indent === 'tab');
    used.push(jsonText, await json.locator('#json-output').inputValue());
    // An entry with these options, then other options chosen after it.
    await json.getByRole('button', { name: 'Copy', exact: true }).click();
    await json.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 3_000 });
    await json.getByRole('radio', { name: 'Minify', exact: true }).click();
    const jsonMinified = await storedFor(json, 'json', r => r?.values?.mode === 'minify');
    await json.goto(`${base}#/tools/base64`);
    await json.getByLabel('Input', { exact: true }).waitFor({ timeout: 15_000 });
    await json.goto(`${base}#/tools/json`);
    await jsonInput.waitFor({ timeout: 15_000 });
    const jsonBack = {
      minify: await radioOn(json, 'Minify'),
      sortKeys: await checkedState(json, 'Sort keys'),
      input: await jsonInput.inputValue(),
      reset: await hasReset(json),
    };
    const jsonTab = await open('#/tools/json');
    await jsonTab.locator('#json-input').waitFor({ timeout: 15_000 });
    const jsonNewTab = { minify: await radioOn(jsonTab, 'Minify'), sortKeys: await checkedState(jsonTab, 'Sort keys') };
    check(
      `${T}: JSON — Indent, Sort keys and Minify are saved; left and opened again (same tab, new tab) they are as left, the input is not`,
      jsonSaved?.schema === 1 &&
        jsonMinified?.values?.indent === 'tab' &&
        jsonBack.minify &&
        jsonBack.sortKeys === 'checked' &&
        jsonBack.input === '' &&
        jsonBack.reset &&
        jsonNewTab.minify &&
        jsonNewTab.sortKeys === 'checked',
      JSON.stringify({ jsonMinified, jsonBack, jsonNewTab }),
    );

    // The entry (Format · Tab · sorted keys) opened from History: its options for the visit; what is saved stays.
    const history = await open('#/history');
    await history.locator('[data-page="history"]').waitFor({ timeout: 15_000 });
    const entry = history.locator('.kit-history-entry', { hasText: 'Format · Tab · sorted keys · copied' }).first();
    await entry.waitFor({ timeout: 5_000 });
    await entry.getByRole('button', { name: 'Open' }).click();
    await history.locator('[data-restored]').waitFor({ timeout: 5_000 });
    const fromEntry = {
      format: await radioOn(history, 'Format'),
      indent: await history.getByLabel('Indent', { exact: true }).innerText(),
      input: await history.locator('#json-input').inputValue(),
    };
    await sleep(800);
    const afterEntry = await paramsOf(history, 'json');
    // Left and opened again: what is saved, not the entry.
    await history.goto(`${base}#/tools`);
    await history.goto(`${base}#/tools/json`);
    await history.locator('#json-input').waitFor({ timeout: 15_000 });
    check(
      `${T}: JSON — an entry opened from History shows its options for the visit and does not overwrite the saved ones`,
      fromEntry.format &&
        fromEntry.indent.includes('Tab') &&
        fromEntry.input === jsonText &&
        afterEntry?.values?.mode === 'minify' &&
        (await radioOn(history, 'Minify')),
      JSON.stringify({ fromEntry, afterEntry }),
    );

    // Reset: defaults back, the input stays, the record goes, said once, focus on the title.
    await jsonInput.fill(jsonText);
    await resetButton(json).focus();
    await json.keyboard.press('Enter');
    await json.waitForFunction(
      () => document.querySelector('[data-part="reset-announcement"]')?.textContent === 'Settings reset to defaults.',
      null,
      { timeout: 3_000 },
    );
    const afterReset = {
      format: await radioOn(json, 'Format'),
      indent: await json.getByLabel('Indent', { exact: true }).innerText(),
      sortKeys: await checkedState(json, 'Sort keys'),
      input: await jsonInput.inputValue(),
      output: await json.locator('#json-output').inputValue(),
      reset: await hasReset(json),
      focus: await json.evaluate(() => document.activeElement?.classList.contains('kit-tool-page-title') ?? false),
    };
    const resetRecord = await storedFor(json, 'json', r => r === null);
    check(
      `${T}: JSON — "Reset settings" (keyboard) puts the defaults back, keeps the input, removes the saved record, says so and focuses the title`,
      afterReset.format &&
        afterReset.indent.includes('2 spaces') &&
        afterReset.sortKeys === 'unchecked' &&
        afterReset.input === jsonText &&
        afterReset.output.startsWith('{\n  "probe"') &&
        !afterReset.reset &&
        afterReset.focus &&
        resetRecord === null,
      JSON.stringify(afterReset),
    );

    // ---- Base64: options saved; a paste opens Decode for the visit only. ----
    const b64 = await open('#/tools/base64');
    const b64Input = b64.getByLabel('Input', { exact: true });
    await b64Input.waitFor({ timeout: 15_000 });
    const b64Text = `${MARK}-base64`;
    await b64Input.fill(b64Text);
    await choose(b64, 'Alphabet', 'URL-safe');
    await choose(b64, 'Line length', '76');
    const b64Saved = await storedFor(b64, 'base64', r => r?.values?.lineLength === 76);
    used.push(b64Text, await b64.getByLabel('Result', { exact: true }).inputValue());
    // A paste into the start page's field: Base64 opens the tool in Decode.
    await b64.goto(`${base}#/start`);
    const field = b64.getByRole('combobox', { name: 'Find a tool or search the web' });
    await field.waitFor({ timeout: 15_000 });
    await field.focus();
    await b64.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, 'SGVsbG8sIFdvcmxkIQ==');
    await b64.waitForFunction(() => location.hash === '#/tools/base64', null, { timeout: 5_000 });
    await b64Input.waitFor({ timeout: 15_000 });
    const pasted = {
      decode: await radioOn(b64, 'Decode'),
      result: await b64.getByLabel('Result', { exact: true }).inputValue(),
    };
    await sleep(800);
    const afterPaste = await paramsOf(b64, 'base64');
    await b64.goto(`${base}#/tools/json`);
    await b64.locator('#json-input').waitFor({ timeout: 15_000 });
    await b64.goto(`${base}#/tools/base64`);
    await b64Input.waitFor({ timeout: 15_000 });
    const b64Back = {
      encode: await radioOn(b64, 'Encode'),
      alphabet: await b64.getByLabel('Alphabet', { exact: true }).innerText(),
      padding: await b64.getByLabel('Padding', { exact: true }).getAttribute('aria-checked'),
      lineLength: await b64.getByLabel('Line length', { exact: true }).innerText(),
    };
    check(
      `${T}: Base64 — Alphabet (with its padding) and Line length are saved; a pasted text opens Decode for that visit without saving it`,
      same(b64Saved?.values, { alphabet: 'url', padding: false, lineLength: 76 }) &&
        pasted.decode &&
        pasted.result === 'Hello, World!' &&
        JSON.stringify(afterPaste) === JSON.stringify(b64Saved) &&
        b64Back.encode &&
        b64Back.alphabet.includes('URL-safe') &&
        b64Back.padding === 'false' &&
        b64Back.lineLength.includes('76'),
      JSON.stringify({ b64Saved, pasted, afterPaste, b64Back }),
    );

    // ---- cURL to Code: the client, one of seventeen. ----
    const curl = await open('#/tools/curl-to-code');
    const command = curl.getByLabel('curl command', { exact: true });
    await command.waitFor({ timeout: 15_000 });
    const secret = `${MARK}SECRET`;
    const curlText = `curl -u 'ann:${secret}' https://example.com/${MARK}-curl`;
    await command.fill(curlText);
    await choose(curl, 'Target', 'Kotlin (OkHttp)');
    await curl.waitForFunction(() => document.querySelector('[data-client]')?.dataset.client === 'kotlin');
    const code = await curl.getByLabel('Code', { exact: true }).inputValue();
    used.push(curlText, secret, code);
    const curlSaved = await storedFor(curl, 'curl-to-code', r => r?.values?.target === 'kotlin');
    const curlTab = await open('#/tools/curl-to-code');
    await curlTab.getByLabel('curl command', { exact: true }).waitFor({ timeout: 15_000 });
    check(
      `${T}: cURL to Code — the client is saved (never the command, its secret or the code); a new tab opens on it with an empty command`,
      curlSaved?.values?.target === 'kotlin' &&
        (await curlTab.getByLabel('Target', { exact: true }).innerText()).includes('Kotlin (OkHttp)') &&
        (await curlTab.getByLabel('curl command', { exact: true }).inputValue()) === '',
      JSON.stringify(curlSaved),
    );

    // ---- Password Generator: how passwords are made. ----
    const pw = await open('#/tools/password');
    const pwOut = n => pw.getByLabel(`Generated password ${n}`, { exact: true });
    await pw.getByLabel('Generated password', { exact: true }).waitFor({ timeout: 15_000 });
    await pw.getByLabel('Length', { exact: true }).fill('24');
    await pw.getByLabel('Symbols', { exact: true }).click();
    await pw.getByLabel('How many', { exact: true }).fill('3');
    await pwOut(3).waitFor();
    for (const n of [1, 2, 3]) used.push((await pwOut(n).textContent()) ?? '');
    const pwSaved = await storedFor(pw, 'password', r => r?.values?.count === 3 && r.values.length === 24);
    await pw.goto(`${base}#/tools/json`);
    await pw.locator('#json-input').waitFor({ timeout: 15_000 });
    await pw.goto(`${base}#/tools/password`);
    await pwOut(3).waitFor({ timeout: 15_000 });
    const pwBack = [];
    for (const n of [1, 2, 3]) pwBack.push((await pwOut(n).textContent()) ?? '');
    check(
      `${T}: Password Generator — Length, Symbols off and How many are saved; opened again, its first passwords follow them`,
      same(pwSaved?.values, { length: 24, setsSymbols: false, count: 3 }) &&
        (await pw.getByLabel('Length', { exact: true }).inputValue()) === '24' &&
        (await checkedState(pw, 'Symbols')) === 'unchecked' &&
        pwBack.every(v => /^[A-Za-z0-9]{24}$/.test(v)),
      JSON.stringify(pwSaved),
    );

    // ---- Date Calculator: the list of zones the person built, and Subtract. ----
    const dc = await open('#/tools/date-calc');
    await dc.locator('input#date-calc-from').waitFor({ timeout: 15_000 });
    const moment = '2024-03-31T10:30:00Z';
    await dc.locator('input#date-calc-moment').fill(moment);
    await dc.locator('input#date-calc-duration').fill('P3D');
    used.push(moment, 'P3D');
    const zonesBefore = await dc
      .locator('[data-zone-row]')
      .evaluateAll(rows => rows.map(r => r.getAttribute('data-zone-row')));
    const add = dc.getByRole('combobox', { name: 'Add a time zone', exact: true });
    await add.focus();
    await add.press('ArrowDown');
    await add.fill('tokyo');
    await add.press('Enter');
    await dc.locator('[data-zone-row="Asia/Tokyo"]').waitFor();
    await dc.getByRole('radio', { name: 'Subtract', exact: true }).click();
    const dcSaved = await storedFor(dc, 'date-calc', r => r?.values?.operation === 'subtract');
    const dcTab = await open('#/tools/date-calc');
    await dcTab.locator('input#date-calc-from').waitFor({ timeout: 15_000 });
    const dcBack = await dcTab
      .locator('[data-zone-row]')
      .evaluateAll(rows => rows.map(r => r.getAttribute('data-zone-row')));
    check(
      `${T}: Date Calculator — the zone list the person built and Subtract are saved; a new tab opens with them and empty fields`,
      JSON.stringify(dcSaved?.values?.zones) === JSON.stringify([...zonesBefore, 'Asia/Tokyo']) &&
        JSON.stringify(dcBack) === JSON.stringify([...zonesBefore, 'Asia/Tokyo']) &&
        (await radioOn(dcTab, 'Subtract')) &&
        (await dcTab.locator('input#date-calc-moment').inputValue()) === '',
      JSON.stringify({ dcSaved, dcBack }),
    );

    // ---- Nothing but parameters in the stored record. ----
    const record = await stored(main);
    const bytes = JSON.stringify(record);
    const leaked = used.filter(text => text && bytes.includes(text));
    const fields = Object.entries(record?.params ?? {}).flatMap(([id, saved]) =>
      Object.keys(saved.values ?? {})
        .filter(key => !(DECLARED[id] ?? []).includes(key))
        .map(key => `${id}.${key}`),
    );
    check(
      `${T}: the stored record holds parameters only — no input, result, secret or password of the ${used.length} used, no undeclared field`,
      leaked.length === 0 && fields.length === 0 && !bytes.includes(MARK) && Object.keys(record.params).length === 4,
      leaked.length || fields.length ? JSON.stringify({ leaked: leaked.map(t => t.slice(0, 20)), fields }) : bytes,
    );

    // ---- A record damaged by hand. ----
    await putStored(main, {
      ...record,
      params: {
        json: { schema: 1, values: { mode: 'sideways', indent: 3, sortKeys: true, junk: { a: 1 } } },
        base64: { schema: 99, values: { mode: 'decode' } },
        'curl-to-code': 'garbage',
        password: {
          schema: 1,
          values: { length: 9999, setsUpper: false, setsLower: false, setsDigits: false, setsSymbols: false, count: 2 },
        },
        'date-calc': { schema: 1, values: { zones: ['Mars/Base', 'UTC'], operation: 'subtract' } },
      },
    });
    const errorsBefore = report.console.filter(m => m.type === 'pageerror').length;
    const damaged = await open('#/tools/json');
    await damaged.locator('#json-input').waitFor({ timeout: 15_000 });
    await damaged.locator('#json-input').fill('{"b":1,"a":2}');
    const jsonDamaged = {
      format: await radioOn(damaged, 'Format'),
      indent: await damaged.getByLabel('Indent', { exact: true }).innerText(),
      sortKeys: await checkedState(damaged, 'Sort keys'),
      output: await damaged.locator('#json-output').inputValue(),
    };
    await damaged.goto(`${base}#/tools/base64`);
    await damaged.getByLabel('Input', { exact: true }).waitFor({ timeout: 15_000 });
    const b64Damaged = await radioOn(damaged, 'Encode');
    await damaged.goto(`${base}#/tools/curl-to-code`);
    await damaged.getByLabel('curl command', { exact: true }).waitFor({ timeout: 15_000 });
    await damaged.getByLabel('curl command', { exact: true }).fill('curl https://example.com/x');
    await damaged.waitForFunction(() => document.querySelector('[data-client]')?.dataset.client === 'javascript');
    const curlDamaged = (await damaged.getByLabel('Code', { exact: true }).inputValue()).includes('fetch(');
    await damaged.goto(`${base}#/tools/password`);
    await damaged.getByLabel('Generated password 2', { exact: true }).waitFor({ timeout: 15_000 });
    const pwDamaged = {
      length: await damaged.getByLabel('Length', { exact: true }).inputValue(),
      upper: await checkedState(damaged, 'Uppercase (A–Z)'),
    };
    await damaged.goto(`${base}#/tools/date-calc`);
    await damaged.locator('input#date-calc-from').waitFor({ timeout: 15_000 });
    const dcDamaged = {
      zones: await damaged
        .locator('[data-zone-row]')
        .evaluateAll(rows => rows.map(r => r.getAttribute('data-zone-row'))),
      subtract: await radioOn(damaged, 'Subtract'),
    };
    check(
      `${T}: a record damaged by hand breaks no tool — each valid field is used, every other is its default, no page error`,
      jsonDamaged.format &&
        jsonDamaged.indent.includes('2 spaces') &&
        jsonDamaged.sortKeys === 'checked' &&
        jsonDamaged.output === '{\n  "a": 2,\n  "b": 1\n}' &&
        b64Damaged &&
        curlDamaged &&
        pwDamaged.length === '20' &&
        pwDamaged.upper === 'checked' &&
        JSON.stringify(dcDamaged.zones) === JSON.stringify(zonesBefore) &&
        dcDamaged.subtract &&
        report.console.filter(m => m.type === 'pageerror').length === errorsBefore,
      JSON.stringify({ jsonDamaged, b64Damaged, curlDamaged, pwDamaged, dcDamaged }),
    );
    await putStored(main, withoutParams(await stored(main), tools));

    // ---- A write the browser refuses: chrome.storage.local is filled to its quota. ----
    const full = await open('#/tools/json');
    await full.locator('#json-input').waitFor({ timeout: 15_000 });
    const noticeOf = p => p.locator('[data-part="settings-notice"]');
    const quiet = (await noticeOf(full).count()) === 0;
    const filled = await full.evaluate(async key => {
      const quota = chrome.storage.local.QUOTA_BYTES;
      const used = await chrome.storage.local.getBytesInUse(null);
      // An item takes its key and its value as JSON (a string and its two quotes); a few bytes are left free.
      await chrome.storage.local.set({ [key]: 'x'.repeat(quota - used - key.length - 2 - 8) });
      // What Chrome answers a write that does not fit (the reason the storage hands on).
      const reason = await chrome.storage.local.set({ [`${key}More`]: 'x'.repeat(64) }).then(
        () => null,
        error => String(error?.message ?? error),
      );
      return { quota, left: quota - (await chrome.storage.local.getBytesInUse(null)), reason };
    }, FILLER);
    await full.getByLabel('Sort keys', { exact: true }).click();
    await noticeOf(full)
      .waitFor({ timeout: 5_000 })
      .catch(() => undefined);
    const refused = {
      said: (await noticeOf(full).count()) > 0 ? await noticeOf(full).textContent() : null,
      role: (await noticeOf(full).count()) > 0 ? await noticeOf(full).getAttribute('role') : null,
      sortKeys: await checkedState(full, 'Sort keys'),
      stored: await paramsOf(full, 'json'),
    };
    await full.evaluate(key => chrome.storage.local.remove([key, `${key}More`]), FILLER);
    await choose(full, 'Indent', '4 spaces');
    const afterRoom = await storedFor(full, 'json', r => r?.values?.indent === 4 && r.values.sortKeys === true);
    await noticeOf(full)
      .waitFor({ state: 'detached', timeout: 5_000 })
      .catch(() => undefined);
    check(
      `${T}: JSON — the browser refuses the write (storage full): the page says "${NOT_SAVED}" and keeps the choice; with room again the next change saves both and the line goes`,
      quiet &&
        filled.left >= 0 &&
        filled.left < 64 &&
        typeof filled.reason === 'string' &&
        refused.said === NOT_SAVED &&
        refused.role === 'status' &&
        refused.sortKeys === 'checked' &&
        refused.stored === null &&
        same(afterRoom?.values, { indent: 4, sortKeys: true }) &&
        (await noticeOf(full).count()) === 0,
      JSON.stringify({ quiet, filled, refused, afterRoom }),
    );
    await putStored(main, withoutParams(await stored(main), tools));
  } finally {
    await clipboard?.restore().catch(() => undefined);
    for (const p of opened.splice(0)) await p.close().catch(() => undefined);
    const restoring = await ctx.newPage();
    await restoring.goto(`${base}#/tools`);
    await restoring.evaluate(key => chrome.storage.local.remove([key, `${key}More`]), FILLER);
    await putStored(restoring, before);
    await restoring.close();
  }

  // ---- The free edition: built with the root reading `free`, in a browser of its own. ----
  mkdirSync(join(ROOT, '.state/e2e'), { recursive: true });
  const built = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: join(ROOT, 'extension'),
    env: { ...process.env, CLI_CEB_DEV: 'false', DEVTAB_VARIANT: 'edition:free', DEVTAB_OUT_DIR: freeDist },
    encoding: 'utf8',
    timeout: 600_000,
  });
  writeFileSync(join(ROOT, '.state/e2e/free-build.log'), `${built.stdout ?? ''}\n${built.stderr ?? ''}`);
  if (!check(`${T}: the free edition builds (DEVTAB_VARIANT=edition:free)`, built.status === 0, `exit ${built.status}`))
    return;
  let chromium;
  for (const dir of [process.env.PLAYWRIGHT_DIR, join(ROOT, '.state/e2e/node')].filter(Boolean)) {
    try {
      ({ chromium } = createRequire(join(resolve(dir), 'package.json'))('playwright'));
      break;
    } catch {
      // the next place
    }
  }
  mkdirSync(join(ROOT, '.state/e2e/profiles'), { recursive: true });
  const profile = mkdtempSync(join(ROOT, '.state/e2e/profiles/free-'));
  const free = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${freeDist}`, `--load-extension=${freeDist}`, '--lang=en-US'],
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  try {
    let [sw] = free.serviceWorkers();
    sw ??= await free.waitForEvent('serviceworker');
    const freeBase = `chrome-extension://${new URL(sw.url()).host}/src/app/index.html`;
    const p = await free.newPage();
    watch(p);
    await p.goto(`${freeBase}#/tools/json`);
    await p.locator('#json-input').waitFor({ timeout: 15_000 });
    await p.locator('#json-input').fill(`{"probe":"${MARK}-free"}`);
    await p.getByRole('radio', { name: 'Minify', exact: true }).click();
    await p.getByLabel('Sort keys', { exact: true }).click();
    await p.goto(`${freeBase}#/tools/base64`);
    await p.getByLabel('Input', { exact: true }).waitFor({ timeout: 15_000 });
    await choose(p, 'Line length', '64');
    await sleep(1_000);
    const noReset = !(await hasReset(p));
    // Within the page the choice lives on (the page's memory): back to JSON, it is as left.
    await p.goto(`${freeBase}#/tools/json`);
    await p.locator('#json-input').waitFor({ timeout: 15_000 });
    const samePage = (await radioOn(p, 'Minify')) && !(await hasReset(p));
    await p.evaluate(() => window.dispatchEvent(new Event('pagehide')));
    await sleep(800);
    const freeStored = await stored(p);
    check(
      `${T}: free edition — no tool parameter is written to chrome.storage.local, and there is no "Reset settings"`,
      noReset && samePage && (freeStored === null || freeStored.params === undefined),
      JSON.stringify(freeStored),
    );
    const again = await free.newPage();
    watch(again);
    await again.goto(`${freeBase}#/tools/json`);
    await again.locator('#json-input').waitFor({ timeout: 15_000 });
    const newTab = { format: await radioOn(again, 'Format'), sortKeys: await checkedState(again, 'Sort keys') };
    await p.reload();
    await p.locator('#json-input').waitFor({ timeout: 15_000 });
    const reloaded = { format: await radioOn(p, 'Format'), sortKeys: await checkedState(p, 'Sort keys') };
    await p.goto(`${freeBase}#/tools/base64`);
    await p.getByLabel('Input', { exact: true }).waitFor({ timeout: 15_000 });
    const b64Default = (await p.getByLabel('Line length', { exact: true }).innerText()).includes('No wrapping');
    check(
      `${T}: free edition — a tool opens with its defaults on every visit (a new tab, a reload)`,
      newTab.format &&
        newTab.sortKeys === 'unchecked' &&
        reloaded.format &&
        reloaded.sortKeys === 'unchecked' &&
        b64Default,
      JSON.stringify({ newTab, reloaded, b64Default }),
    );
  } finally {
    await free.close();
    rmSync(profile, { recursive: true, force: true });
  }
};
