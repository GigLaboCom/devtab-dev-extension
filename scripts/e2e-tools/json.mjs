// The JSON tool in the built extension (docs/tools/specs/json.md §2, §6, §12), with real page elements: the scenarios of
// §2 one by one — formatted at once, an error that puts the caret on its place, a number kept as written, Sort keys,
// Minify and Copy, JSONC with Allow comments, a repeated name, JSON Lines — then nesting far past the limit (a worded
// error, no page error), a large input waiting for Run, a 20 MiB file behind a card printed by Run in the tool's worker
// (timed, with the page's longest task meanwhile), the summary of a result too large to show with Copy and Save, the
// history record and the page in the dark theme. The shared helpers come from scripts/e2e-helpers.mjs. Run by
// scripts/e2e-tools.mjs.

/* global document, HTMLTextAreaElement, requestAnimationFrame -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MiB = 1024 * 1024;

/** §12's «records» document: objects with strings, numbers, nested objects and non-ASCII, 20.0 MiB on one line. */
const records = () => {
  const items = [];
  let size = 2;
  for (let i = 0; size < 20 * MiB - 400; i++) {
    const item = JSON.stringify({
      id: i,
      name: `user ${i} — Zürich ключ`,
      score: i * 1.25,
      big: 12345678901234567890n.toString(),
      active: i % 3 === 0,
      tags: ['alpha', 'beta', `t${i % 17}`],
      address: { city: 'Zürich', zip: String(10000 + (i % 9000)), geo: { lat: 47.37, lng: 8.54 } },
      note: null,
      text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    });
    size += Buffer.byteLength(item) + 1;
    items.push(item);
  }
  return `[${items.join(',')}]`;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const pageErrors = [];
  const onError = e => pageErrors.push(String(e));
  page.on('pageerror', onError);
  await page.goto(`${base}#/tools/json`);
  const input = page.locator('#json-input');
  const result = () => page.locator('#json-output').inputValue();
  const status = page.locator('[data-part="status"]');
  const said = () => status.innerText();
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  const radio = name => page.getByRole('radio', { name, exact: true });
  const settle = () => sleep(150);

  // §2.1: a one-line answer from a log, Format chosen already: formatted at once with 2 spaces, Valid JSON.
  await input.fill('{"id":7,"tags":["a","b"],"ok":true}');
  await settle();
  const first = await result();
  check(
    'JSON: §2.1 a one-line answer is formatted at once, Valid JSON',
    first === '{\n  "id": 7,\n  "tags": [\n    "a",\n    "b"\n  ],\n  "ok": true\n}' &&
      (await said()) === 'Valid JSON' &&
      (await radio('Format').getAttribute('aria-checked')) === 'true',
    JSON.stringify(first),
  );
  await settledShot(shoot, page, 'tool-json-01-formatted.png');

  // §2.2: a trailing comma; pressing the line puts the caret on the place.
  await input.fill('{\n  "name": "web",\n  "port": 8080,\n}');
  await settle();
  const comma = await said();
  await page.getByRole('button', { name: /^Line 4, column 1: trailing comma$/ }).click();
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#json-input');
    return { focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd };
  });
  check(
    'JSON: §2.2 the error says where; pressing it puts the caret there; the result is empty',
    comma === 'Line 4, column 1: trailing comma' &&
      caret.focused &&
      caret.start === 35 &&
      caret.end === 35 &&
      (await result()) === '' &&
      (await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled()),
    `${comma}; ${JSON.stringify(caret)}`,
  );
  await settledShot(shoot, page, 'tool-json-02-error.png');

  // §2.3: an identifier a double cannot hold.
  await input.fill('{"id":12345678901234567890}');
  await settle();
  const big = await result();
  const bigNotes = await notes();
  check(
    'JSON: §2.3 12345678901234567890 is kept as written, with the note',
    big === '{\n  "id": 12345678901234567890\n}' &&
      bigNotes[0] ===
        "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    `${JSON.stringify(big)}; ${bigNotes.join(' | ')}`,
  );

  // What the old tool changed, all at once: numbers, the order of names, repeated names, escapes, a byte order mark.
  await input.fill(
    '\uFEFF{"b":[12345678901234567890,0.1000000000000000055511151231257827,1E400,-0,1.50],"2":"\\u00e9\\/","1":1,"b":2}',
  );
  await radio('Minify').click();
  await settle();
  const exact = await result();
  const exactNotes = await notes();
  check(
    'JSON: nothing the old tool changed changes now — numbers, the order of names, a repeated name, escapes',
    exact ===
      '{"b":[12345678901234567890,0.1000000000000000055511151231257827,1E400,-0,1.50],"2":"\\u00e9\\/","1":1,"b":2}' &&
      exactNotes.length === 3 &&
      exactNotes[0].startsWith('A byte order mark (U+FEFF)') &&
      exactNotes[1].startsWith('Duplicate key "b" at line 1, column 102.') &&
      exactNotes[2].startsWith('2 numbers are kept as written'),
    `${exact}; ${exactNotes.join(' | ')}`,
  );
  await radio('Format').click();

  // §2.4: Sort keys on every level, arrays untouched.
  await input.fill('{"name":"example","tags":["diff","tools"],"nested":{"b":2,"a":1},"ok":true}');
  await page.getByLabel('Sort keys').check();
  await settle();
  const sorted = await result();
  check(
    'JSON: §2.4 Sort keys orders names on every level, arrays untouched',
    sorted ===
      '{\n  "name": "example",\n  "nested": {\n    "a": 1,\n    "b": 2\n  },\n  "ok": true,\n  "tags": [\n    "diff",\n    "tools"\n  ]\n}',
    JSON.stringify(sorted),
  );
  await page.getByLabel('Sort keys').uncheck();

  // §2.5: Minify for an environment variable, then Copy (the page's clipboard stub); the Copy is recorded at once.
  await input.fill('{\n  "a": [1, 2],\n  "b": "x y"\n}');
  await radio('Minify').click();
  await settle();
  const indentOff = await page.locator('#json-indent').isDisabled();
  const clipboard = await stubClipboard(page);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const copied = await clipboard.copied();
  await clipboard.restore();
  const record = await waitForHistoryRecord(
    page,
    'json',
    r => r.kind === 'result' && /^Minify · copied$/.test(r.label ?? ''),
  ).catch(() => null);
  check(
    'JSON: §2.5 Minify, then Copy copies the one line; the indent is off; the Copy is in the history',
    copied.length === 1 && copied[0] === '{"a":[1,2],"b":"x y"}' && indentOff && record !== null,
    `copied ${JSON.stringify(copied)}; indent off ${indentOff}; record ${record?.label}`,
  );
  await radio('Format').click();

  // §2.6: a tsconfig with a comment: the error names the option; Allow comments gives strict JSON and the note.
  await input.fill('{\n  // Base options\n  "strict": true,\n  /* the libraries */ "lib": ["dom"],\n}');
  await settle();
  const noComments = await said();
  await page.getByLabel('Allow comments').check();
  await settle();
  const jsonc = await result();
  const jsoncSaid = await said();
  const jsoncNotes = await notes();
  check(
    'JSON: §2.6 comments are refused with the hint; Allow comments gives strict JSON, Valid JSON with comments, the note',
    noComments === 'Line 2, column 3: comments are not allowed in JSON (turn on "Allow comments")' &&
      jsonc === '{\n  "strict": true,\n  "lib": [\n    "dom"\n  ]\n}' &&
      jsoncSaid === 'Valid JSON with comments' &&
      jsoncNotes[0] === 'Removed 2 comments and 1 trailing comma: the result is strict JSON.',
    `${noComments}; ${jsoncSaid}; ${jsoncNotes.join(' | ')}`,
  );
  await settledShot(shoot, page, 'tool-json-03-comments.png');
  await page.getByLabel('Allow comments').uncheck();

  // §2.7: a repeated name in a service's answer.
  await input.fill('{"a":1,"b":2,"a":3}');
  await settle();
  const dupNotes = await notes();
  check(
    'JSON: §2.7 a repeated name: both kept, the note says where',
    (await result()) === '{\n  "a": 1,\n  "b": 2,\n  "a": 3\n}' &&
      dupNotes[0] ===
        'Duplicate key "a" at line 1, column 14. Both are kept; parsers disagree on which one wins (RFC 8259 §4).',
    dupNotes.join(' | '),
  );

  // §2.9: JSON Lines.
  await input.fill('{"a":1}\n{"a":2}');
  await settle();
  const lines = await said();
  check(
    'JSON: §2.9 JSON Lines: the error says this tool does not read them',
    lines ===
      'Line 2, column 1: unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    lines,
  );

  // §5 «Разбор» п. 3: 9,000 levels — once a stack overflow and an exception — are a worded error at the 1001st bracket.
  const deep = await page.evaluate(
    async text => {
      const field = document.querySelector('#json-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('[data-part="status"]').textContent.trim();
    },
    `${'['.repeat(9000)}${']'.repeat(9000)}`,
  );
  const limit = await page.evaluate(
    async text => {
      const field = document.querySelector('#json-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      const start = performance.now();
      setter.call(field, text);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return {
        ms: Math.round(performance.now() - start),
        status: document.querySelector('[data-part="status"]').textContent.trim(),
        length: document.querySelector('#json-output').value.length,
      };
    },
    `${'['.repeat(1000)}${']'.repeat(1000)}`,
  );
  check(
    'JSON: 9,000 levels deep is a worded error, no page error; 1,000 levels format (2,000,000 characters)',
    deep === 'Line 1, column 1001: nesting deeper than 1000 levels' &&
      !pageErrors.length &&
      limit.status === 'Valid JSON' &&
      limit.length === 2_000_000,
    `${deep}; 1,000 levels: ${limit.length} characters in ${limit.ms} ms; page errors ${pageErrors.length}`,
  );

  // §12: up to 256 Ki characters the result follows every change on the page — timed: the largest live input, from the
  // value set to the result painted, with the page's longest task meanwhile.
  const liveRecords = records().slice(0, 262_100);
  const liveText = `${liveRecords.slice(0, liveRecords.lastIndexOf('},{') + 1)}]`;
  const liveTiming = await page.evaluate(async text => {
    const field = document.querySelector('#json-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let longest = 0;
    const observer = new globalThis.PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    setter.call(field, text);
    field.dispatchEvent(new globalThis.Event('input', { bubbles: true }));
    while (document.querySelector('#json-output').value === '' && performance.now() - start < 10_000)
      await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const elapsed = performance.now() - start;
    await new Promise(r => setTimeout(r, 100));
    observer.disconnect();
    return { elapsed: Math.round(elapsed), longest: Math.round(longest), chars: text.length };
  }, liveText);
  report.json = { live256Ki: liveTiming };
  check(
    'JSON: §12 the largest live input (256 Ki characters) is formatted as it changes',
    (await said()) === 'Valid JSON' && liveTiming.chars <= 262_144,
    `${liveTiming.chars} characters → result painted in ${liveTiming.elapsed} ms, longest task ${liveTiming.longest} ms`,
  );

  // §12: above 256 Ki characters the result waits for Run (or Ctrl+Enter), printed in the tool's worker.
  const large = `[${'1,'.repeat(150_000)}1]`;
  await input.fill(large);
  await settle();
  const waiting = await said();
  const runVisible = await page.getByRole('button', { name: 'Run', exact: true }).isVisible();
  await input.press('Control+Enter');
  await status.filter({ hasText: 'Valid JSON' }).waitFor({ timeout: 10_000 });
  const ran = await result();
  check(
    'JSON: §12 a large input waits for Run; Ctrl+Enter runs it',
    waiting === 'Large input: press Run (Ctrl+Enter) to check it.' && runVisible && ran.startsWith('[\n  1,\n  1,'),
    `${waiting}; ${ran.length} characters`,
  );
  await input.fill('');

  // §2.8: a 20 MiB export opened as a file: a card instead of the field; Run prints it in the worker; the result is too
  // large to show — a summary, Copy and Save. Timed in the browser, with the page's longest task meanwhile.
  const dir = join(ROOT, '.state/e2e/json');
  mkdirSync(dir, { recursive: true });
  const exportFile = join(dir, 'export.json');
  writeFileSync(exportFile, records());
  const fileBytes = statSync(exportFile).size;
  await page.locator('input[type="file"]').setInputFiles(exportFile);
  const card = page.locator('[data-part="file"]');
  await card.waitFor({ timeout: 15_000 });
  const cardText = await card.locator('p').innerText();
  const timing = await page.evaluate(async () => {
    let longest = 0;
    let frames = 0;
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const run = [...document.querySelectorAll('button')].find(b => b.textContent === 'Run');
    const start = performance.now();
    run.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const working = [...document.querySelectorAll('button')].some(b => b.textContent === 'Working…' && b.disabled);
    const done = () => document.querySelector('[data-part="summary"]') !== null;
    while (!done() && performance.now() - start < 30_000) {
      frames++;
      await new Promise(r => requestAnimationFrame(r));
    }
    const elapsed = performance.now() - start;
    await new Promise(r => setTimeout(r, 100));
    observer.disconnect();
    return {
      elapsed: Math.round(elapsed),
      longest: Math.round(longest),
      frames,
      working,
      summary: document.querySelector('[data-part="summary"]')?.textContent ?? null,
      status: document.querySelector('[data-part="status"]').textContent.trim(),
    };
  });
  report.json = { ...report.json, fileBytes, run20MiB: timing };
  check(
    'JSON: §2.8 a 20 MiB file is a card; Run prints it in the worker (Working… meanwhile) without holding the page',
    cardText === 'export.json — 20.0 MB' &&
      timing.working &&
      timing.status === 'Valid JSON' &&
      /^Result: \d+\.\d MB, [\d,]+ lines\. Too large to show here\.$/.test(timing.summary ?? '') &&
      timing.longest < 200,
    `${cardText}; ${timing.summary}; Run → result ${timing.elapsed} ms, ${timing.frames} frames, longest task ${timing.longest} ms`,
  );
  await settledShot(shoot, page, 'tool-json-04-large-file.png');
  const bigClipboard = await stubClipboard(page);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  const bigCopied = await bigClipboard.copied();
  await bigClipboard.restore();
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save', exact: true }).click();
  const download = await downloadEvent;
  const saved = join(dir, 'formatted.json');
  await download.saveAs(saved);
  const savedBytes = statSync(saved).size;
  const summaryMb = Number(/Result: ([\d.]+) MB/.exec(timing.summary ?? '')?.[1]);
  check(
    'JSON: §3 the summary’s result is copied and saved whole (formatted.json)',
    bigCopied.length === 1 &&
      bigCopied[0].length > 20 * MiB &&
      download.suggestedFilename() === 'formatted.json' &&
      Math.abs(savedBytes / MiB - summaryMb) <= 0.05,
    `copied ${bigCopied[0]?.length} characters; saved ${download.suggestedFilename()} ${savedBytes} bytes; summary ${summaryMb} MB`,
  );
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // The page in the dark theme, then back.
  await input.fill(
    '{"name":"example","tags":["diff","tools"],"nested":{"b":2,"a":1},"ok":true,"id":12345678901234567890}',
  );
  await settle();
  const mode = await inDarkTheme(ctx, base, page, async () => {
    await settledShot(shoot, page, 'tool-json-05-dark.png');
    await input.fill('{\n  "a": 1,\n}');
    await settle();
    await settledShot(shoot, page, 'tool-json-06-dark-error.png');
    return page.evaluate(() => document.documentElement.dataset.mode);
  });
  const after = await page.evaluate(() => document.documentElement.dataset.mode);
  check('JSON: the page in the dark theme and back', mode === 'dark' && after !== 'dark', `${mode} → ${after}`);
  await input.fill('');
  // The options it changed are saved parameters (D21): the next module opens JSON with its defaults.
  await forgetSavedParameters(page, 'json');
  page.off('pageerror', onError);
};
