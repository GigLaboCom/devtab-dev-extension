// The JSON and CSV tool in the built extension (docs/tools/specs/json-csv.md §2, §6, §12), with real page elements: the
// scenarios of §2 one by one — an API answer to CSV, a semicolon file with a byte order mark for Excel (the saved bytes
// checked), a formula guarded, a zip code kept, a semicolon detected, an unclosed quote that puts the caret on its
// place, long identifiers kept — then Swap, the largest live input timed, a 100,000-row CSV file and a 20 MiB JSON file
// behind a card converted by Run in the tool's worker (timed, with the page's longest task meanwhile), the summary of a
// result too large to show with Copy and Save, the history record and the page in the dark theme. Navigation inside
// the module replaces the tab's entry (the e2e modules share one tab, and Chrome keeps 50 entries). Run by
// scripts/e2e-tools.mjs.

/* global document, HTMLTextAreaElement, requestAnimationFrame, location -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const MiB = 1024 * 1024;

const NAMES = ['Ann', 'Bob, Jr.', 'say "hi"', 'Zürich', 'Ольга', '🙂 ok', 'plain', 'x;y|z'];

/** A CSV export of `rows` records, ten columns, with commas, quotes, line breaks and non-ASCII in its values. */
const csvExport = rows => {
  const quote = v => (/[",\r\n]/.test(v) ? `"${v.replaceAll('"', '""')}"` : v);
  const lines = ['id,name,email,active,score,big,city,zip,note,created'];
  for (let i = 0; i < rows; i++)
    lines.push(
      [
        String(i),
        NAMES[i % NAMES.length],
        `user${i}@example.com`,
        i % 3 === 0 ? 'true' : 'false',
        (i * 1.25).toFixed(2),
        `1234567890123456${i % 10000}`,
        NAMES[(i * 7) % NAMES.length],
        String(10000 + (i % 89999)).padStart(6, '0'),
        i % 5 === 0 ? '' : 'a note, with "quotes"\nand a second line',
        '2026-11-21',
      ]
        .map(quote)
        .join(','),
    );
  return `${lines.join('\r\n')}\r\n`;
};

/** A JSON export of about `mib` MiB on one line: objects with nested objects, arrays, numbers a double cannot hold. */
const jsonExport = mib => {
  const items = [];
  let size = 2;
  for (let i = 0; size < mib * MiB - 400; i++) {
    const item = JSON.stringify({
      id: i,
      name: `user ${i} — Zürich ключ`,
      score: i * 1.25,
      active: i % 3 === 0,
      tags: ['alpha', `t${i % 17}`],
      address: { city: 'Zürich', zip: String(10000 + (i % 9000)), geo: { lat: 47.37, lng: 8.54 } },
      note: null,
      text: 'Lorem ipsum dolor sit amet, consectetur adipiscing elit.',
    }).replace(/^\{"id":(\d+)/, (_, id) => `{"id":${id},"big":1234567890123456789${id % 10}`);
    size += Buffer.byteLength(item) + 1;
    items.push(item);
  }
  return `[${items.join(',')}]`;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const pageErrors = [];
  const onError = e => pageErrors.push(String(e));
  page.on('pageerror', onError);
  // Into the tool without a new entry in the tab's history when the page is ours already.
  if (page.url().startsWith(base)) await page.evaluate(url => location.replace(url), `${base}#/tools/json-csv`);
  else await page.goto(`${base}#/tools/json-csv`);
  const input = page.locator('#json-csv-input');
  await input.waitFor();
  const result = () => page.locator('#json-csv-output').inputValue();
  const status = page.locator('[data-part="status"]');
  const said = () => status.innerText();
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const settle = () => sleep(150);
  const dir = join(ROOT, '.state/e2e/json-csv');
  mkdirSync(dir, { recursive: true });

  // §2.1: an API answer; columns by first appearance, Bob's city empty, the size note.
  await input.fill('[{"id":1,"name":"Ann","address":{"city":"Paris"}},{"id":2,"name":"Bob"}]');
  await settle();
  const first = await result();
  check(
    'JSON and CSV: §2.1 an API answer becomes CSV — columns by first appearance, an empty city, 2 rows × 3 columns',
    first === 'id,name,address.city\n1,Ann,Paris\n2,Bob,\n' &&
      (await said()) === 'Valid JSON' &&
      (await notes())[0] === '2 rows × 3 columns.' &&
      (await radio('JSON → CSV').getAttribute('aria-checked')) === 'true',
    JSON.stringify(first),
  );
  await settledShot(shoot, page, 'tool-json-csv-01-json-to-csv.png');

  // §2.2: Semicolon and Add BOM for Excel; Copy takes the text without the mark, Save writes it first.
  await input.fill('[{"item":"Tea","price":"1,5"},{"item":"Coffee","price":"2,25"}]');
  await choose('Delimiter', 'Semicolon');
  await page.getByLabel('Add BOM (for Excel)').check();
  await settle();
  const clipboard = await stubClipboard(page);
  await button('Copy').click();
  const copied = await clipboard.copied();
  await clipboard.restore();
  const downloadEvent = page.waitForEvent('download');
  await button('Save').click();
  const download = await downloadEvent;
  const savedPath = join(dir, 'converted.csv');
  await download.saveAs(savedPath);
  const savedBytes = readFileSync(savedPath);
  const record = await waitForHistoryRecord(
    page,
    'json-csv',
    r => r.kind === 'to-csv' && /semicolon · 2 rows × 2 columns · copied$/.test(r.label ?? ''),
  ).catch(() => null);
  check(
    'JSON and CSV: §2.2 Semicolon and Add BOM — Copy without the mark, converted.csv starts with EF BB BF; Copy is in the history',
    copied.length === 1 &&
      copied[0] === 'item;price\r\nTea;1,5\r\nCoffee;2,25\r\n' &&
      download.suggestedFilename() === 'converted.csv' &&
      savedBytes.subarray(0, 3).equals(Buffer.from([0xef, 0xbb, 0xbf])) &&
      savedBytes.subarray(3).toString('utf8') === copied[0] &&
      record !== null,
    `copied ${JSON.stringify(copied)}; saved ${download.suggestedFilename()} ${savedBytes.subarray(0, 3).toString('hex')}; record ${record?.label}`,
  );
  await settledShot(shoot, page, 'tool-json-csv-02-semicolon-bom.png');
  await page.getByLabel('Add BOM (for Excel)').uncheck();
  await choose('Delimiter', 'Comma');

  // §2.3: a formula in a value is prefixed with ' and quoted; the note names how many.
  await input.fill('[{"comment":"=HYPERLINK(\\"http://x\\")","phone":"+1 555","n":-5}]');
  await settle();
  const guarded = await result();
  const guardNotes = await notes();
  check(
    'JSON and CSV: §2.3 formula-like cells get a quote prefix and the note says so; a negative number does not',
    guarded === 'comment,phone,n\n"\'=HYPERLINK(""http://x"")","\'+1 555",-5\n' &&
      guardNotes[1] ===
        "2 cells start with = + - @ or a tab and were prefixed with ' so spreadsheets show them as text.",
    `${JSON.stringify(guarded)}; ${guardNotes.join(' | ')}`,
  );
  await settledShot(shoot, page, 'tool-json-csv-03-formulas.png');

  // §2.7: identifiers a double cannot hold keep their digits.
  await input.fill('[{"id":12345678901234567890,"p":1.50,"e":1E400}]');
  await settle();
  const exact = await result();
  check(
    'JSON and CSV: §2.7 numbers reach the CSV as written (12345678901234567890, 1.50, 1E400), with the note',
    exact === 'id,p,e\n12345678901234567890,1.50,1E400\n' &&
      (await notes()).some(n => n.startsWith('2 numbers are kept as written')),
    JSON.stringify(exact),
  );

  // §2.4, §2.5: CSV → JSON — a zip code keeps its leading zero, a quantity is a number; the semicolon is detected.
  await radio('CSV → JSON').click();
  await input.fill('zip;qty;city\n01234;3;Köln\n10115;12;Berlin, Mitte');
  await settle();
  const back = await result();
  const backNotes = await notes();
  check(
    'JSON and CSV: §2.4–2.5 CSV → JSON keeps 01234 a string, 3 a number; Detected delimiter: semicolon.',
    back ===
      '[\n  {\n    "zip": "01234",\n    "qty": 3,\n    "city": "Köln"\n  },\n  {\n    "zip": 10115,\n    "qty": 12,\n    "city": "Berlin, Mitte"\n  }\n]' &&
      backNotes[0] === 'Detected delimiter: semicolon.' &&
      (await said()) === 'Valid CSV: 2 rows × 3 columns',
    `${JSON.stringify(back)}; ${backNotes.join(' | ')}`,
  );
  await settledShot(shoot, page, 'tool-json-csv-04-csv-to-json.png');

  // §2.6: an unclosed quote; pressing the line puts the caret on the opening quote.
  await input.fill('name,city\n"Ann,Paris\nBob,Rome');
  await settle();
  const unclosed = await said();
  await page.getByRole('button', { name: 'Line 2, column 1: unclosed quote: the field never ends' }).click();
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#json-csv-input');
    return { focused: document.activeElement === el, start: el.selectionStart, end: el.selectionEnd };
  });
  check(
    'JSON and CSV: §2.6 an unclosed quote says where; pressing it puts the caret there; the result is empty',
    unclosed === 'Line 2, column 1: unclosed quote: the field never ends' &&
      caret.focused &&
      caret.start === 10 &&
      caret.end === 10 &&
      (await result()) === '' &&
      (await button('Copy').isDisabled()),
    `${unclosed}; ${JSON.stringify(caret)}`,
  );
  await settledShot(shoot, page, 'tool-json-csv-05-error.png');

  // Swap: the JSON goes back to CSV, the direction turns.
  await input.fill('a,b\n1,"x,y"');
  await settle();
  await button('Swap').click();
  await settle();
  const swapped = await result();
  check(
    'JSON and CSV: Swap turns the result into the input and converts it back',
    (await radio('JSON → CSV').getAttribute('aria-checked')) === 'true' && swapped === 'a,b\n1,"x,y"\n',
    JSON.stringify(swapped),
  );

  // §12: the largest live input (256 Ki characters of CSV) converts as it changes — from the value set to the result
  // painted, with the page's longest task meanwhile (the two text areas holding the texts are part of it).
  await radio('CSV → JSON').click();
  // Whole records only: a record ends with CRLF, a line break inside a value is a bare LF.
  const liveCsv = csvExport(4000).slice(0, 262_000);
  const liveText = liveCsv.slice(0, liveCsv.lastIndexOf('\r\n') + 2);
  const live = await page.evaluate(async text => {
    const field = document.querySelector('#json-csv-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    let longest = 0;
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const start = performance.now();
    setter.call(field, text);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    while (document.querySelector('#json-csv-output').value === '' && performance.now() - start < 10_000)
      await new Promise(r => requestAnimationFrame(r));
    await new Promise(r => requestAnimationFrame(r));
    const elapsed = performance.now() - start;
    await new Promise(r => setTimeout(r, 100));
    observer.disconnect();
    return { elapsed: Math.round(elapsed), longest: Math.round(longest), chars: text.length };
  }, liveText);
  const liveSaid = await said();
  report.jsonCsv = { live256Ki: live };
  check(
    'JSON and CSV: §12 the largest live input (256 Ki characters of CSV) converts as it changes',
    /^Valid CSV: [\d,]+ rows × 10 columns$/.test(liveSaid) && live.chars <= 262_144,
    `${live.chars} characters → result painted in ${live.elapsed} ms, longest task ${live.longest} ms; ${liveSaid}`,
  );

  // §2.8: a CSV of 100,000 records opened as a file: a card instead of the field; Run converts it in the worker; the
  // result is too large to show — a summary, Copy and Save. Timed in the browser, with the page's longest task.
  const runTimed = () =>
    page.evaluate(async () => {
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
      while (!done() && performance.now() - start < 60_000) {
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
  const csvFile = join(dir, 'export.csv');
  writeFileSync(csvFile, csvExport(100_000));
  const csvBytes = statSync(csvFile).size;
  await page.locator('input[type="file"]').setInputFiles(csvFile);
  const card = page.locator('[data-part="file"]');
  await card.waitFor({ timeout: 15_000 });
  const csvCard = await card.locator('p').innerText();
  const csvRun = await runTimed();
  check(
    'JSON and CSV: §2.8 a CSV of 100,000 records is a card; Run converts it in the worker without holding the page',
    csvCard === `export.csv — ${(csvBytes / MiB).toFixed(1)} MB` &&
      csvRun.working &&
      csvRun.status === 'Valid CSV: 100,000 rows × 10 columns' &&
      /^Result: \d+\.\d MB, [\d,]+ lines\. Too large to show here\.$/.test(csvRun.summary ?? '') &&
      csvRun.longest < 200,
    `${csvCard}; ${csvRun.summary}; Run → result ${csvRun.elapsed} ms, ${csvRun.frames} frames, longest task ${csvRun.longest} ms`,
  );
  await settledShot(shoot, page, 'tool-json-csv-06-large-file.png');
  const bigClipboard = await stubClipboard(page);
  await button('Copy').click();
  const bigCopied = await bigClipboard.copied();
  await bigClipboard.restore();
  const jsonDownload = page.waitForEvent('download');
  await button('Save').click();
  const savedJson = await jsonDownload;
  const savedJsonPath = join(dir, 'converted.json');
  await savedJson.saveAs(savedJsonPath);
  const savedJsonBytes = statSync(savedJsonPath).size;
  const summaryMb = Number(/Result: ([\d.]+) MB/.exec(csvRun.summary ?? '')?.[1]);
  check(
    'JSON and CSV: §3 the summary’s result is copied and saved whole (converted.json)',
    bigCopied.length === 1 &&
      bigCopied[0].startsWith('[\n  {\n    "id": 0,') &&
      savedJson.suggestedFilename() === 'converted.json' &&
      Math.abs(savedJsonBytes / MiB - summaryMb) <= 0.05,
    `copied ${bigCopied[0]?.length} characters; saved ${savedJson.suggestedFilename()} ${savedJsonBytes} bytes; summary ${summaryMb} MB`,
  );

  // §12: a 20 MiB JSON array opened as a file goes to JSON → CSV; Run converts it in the worker.
  const jsonFile = join(dir, 'export.json');
  writeFileSync(jsonFile, jsonExport(20));
  await page.locator('input[type="file"]').setInputFiles(jsonFile);
  await card.locator('p').filter({ hasText: 'export.json' }).waitFor({ timeout: 15_000 });
  const jsonCard = await card.locator('p').innerText();
  const toCsvDirection = await radio('JSON → CSV').getAttribute('aria-checked');
  const jsonRun = await runTimed();
  report.jsonCsv = { ...report.jsonCsv, csvFileBytes: csvBytes, csvRun, jsonRun };
  check(
    'JSON and CSV: §12 a 20 MiB JSON file is converted to CSV by Run in the worker without holding the page',
    jsonCard === 'export.json — 20.0 MB' &&
      toCsvDirection === 'true' &&
      jsonRun.status === 'Valid JSON' &&
      /^Result: \d+\.\d MB, [\d,]+ lines\. Too large to show here\.$/.test(jsonRun.summary ?? '') &&
      jsonRun.longest < 200,
    `${jsonCard}; ${jsonRun.summary}; Run → result ${jsonRun.elapsed} ms, ${jsonRun.frames} frames, longest task ${jsonRun.longest} ms`,
  );
  await button('Clear').click();

  // The page in the dark theme, then back.
  await input.fill('[{"id":1,"name":"Ann","address":{"city":"Paris"},"tags":["a","b"]},{"id":2,"name":"=cmd"}]');
  await settle();
  const mode = await inDarkTheme(ctx, base, page, async () => {
    await settledShot(shoot, page, 'tool-json-csv-07-dark.png');
    await radio('CSV → JSON').click();
    await input.fill('id,name\n1,Ann\n2,"Bob');
    await settle();
    await settledShot(shoot, page, 'tool-json-csv-08-dark-error.png');
    return page.evaluate(() => document.documentElement.dataset.mode);
  });
  const after = await page.evaluate(() => document.documentElement.dataset.mode);
  check('JSON and CSV: the page in the dark theme and back', mode === 'dark' && after !== 'dark', `${mode} → ${after}`);
  check('JSON and CSV: no page errors', pageErrors.length === 0, pageErrors.join(' | '));
  await input.fill('');
  await radio('JSON → CSV').click();
  page.off('pageerror', onError);
};
