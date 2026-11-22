// The JSON Query tool in the built extension (docs/tools/specs/json-query.md): its scenarios (§2) the way a person does
// them — the page's real controls — run by scripts/e2e-tools.mjs. Queries run in the tool's module worker, loaded from
// the package's own file (never blob: or data:). Measured here (§12): a 1 MB document with $..* — the text box's cost
// apart from the tool's, the rows built a chunk per frame, what Copy values takes; a document at the scanner's depth
// limit; a filter with a descendant query on a deep document and a pattern that backtracks, both stopped at the limit
// while the page answers. Also a query pasted into the start page, and an entry of the tool history opened back. The
// copy buttons' clipboard writes are caught in the page (stubClipboard), so the run never touches a real clipboard.

/* global document, window, location, requestAnimationFrame, HTMLTextAreaElement, HTMLInputElement, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const STORE = JSON.stringify(
  {
    store: {
      book: [
        { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
        { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
        { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
        {
          category: 'fiction',
          author: 'J. R. R. Tolkien',
          title: 'The Lord of the Rings',
          isbn: '0-395-19395-8',
          price: 22.99,
        },
      ],
      bicycle: { color: 'red', price: 399 },
    },
  },
  null,
  2,
);

/** About 1 MB of records (as the logic's timing in Node used). */
const records = () => {
  const out = [];
  let k = 0;
  let size = 2;
  while (size < 1024 * 1024) {
    const r = {
      id: k,
      name: `user ${k}`,
      tags: ['a', 'b', 'c'],
      address: { city: 'X', zip: String(10000 + k) },
      score: k * 1.5,
      active: k % 2 === 0,
    };
    size += JSON.stringify(r).length + 1;
    out.push(r);
    k++;
  }
  return JSON.stringify(out);
};

/** 999 levels, each with an array of 100 numbers: a descendant query inside a filter visits it about 500 times over. */
const deepAndWide = () => {
  const wide = Array.from({ length: 100 }, (_, i) => i).join(',');
  let text = '1';
  for (let d = 0; d < 999; d++) text = `{"w":[${wide}],"a":${text}}`;
  return text;
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

export default async args => {
  let clipboard = null;
  try {
    clipboard = await run(args);
  } finally {
    // The page stays for the next modules: the stand-in for the clipboard goes.
    await args.page.evaluate(() => delete navigator.clipboard.writeText).catch(() => undefined);
    await clipboard?.restore().catch(() => undefined);
  }
};

const run = async ({ ctx, page, base, check, shoot, report }) => {
  const workers = [];
  page.on('worker', w => {
    const seen = { url: w.url(), closedAt: null };
    workers.push(seen);
    w.on('close', () => (seen.closedAt = Date.now()));
  });
  const open = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(url => location.replace(url), `${base}${hash}`);
    else await page.goto(`${base}${hash}`);
  };
  await open('#/tools/json-query');
  const query = page.locator('#json-query-query');
  const docField = page.locator('#json-query-document');
  // An element of this tool (not the heading): the page shows "Loading…" until its history is open.
  await query.waitFor({ timeout: 15_000 });
  const status = page.locator('[data-status]');
  const statusText = async () => (await status.innerText().catch(() => '')).trim();
  const message = where => page.locator(`[data-field="${where}"]`).innerText();
  const until = want => page.locator('[data-status]', { hasText: want }).waitFor({ timeout: 15_000 });
  const button = name => page.getByRole('button', { name, exact: true });
  const rows = () =>
    page
      .getByRole('table', { name: 'Results', exact: true })
      .locator('tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.cells].slice(0, 3).map(td => td.innerText)));
  /** Sets a field as a paste would (React hears the input event); no typing of megabytes. */
  const setValue = (selector, text) =>
    page.evaluate(
      ([s, t]) => {
        const el = document.querySelector(s);
        const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, t);
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

  check(
    'JSON Query: opens empty — no status, no table, copying off, the RFC 9535 hint',
    (await query.inputValue()) === '' &&
      (await docField.inputValue()) === '' &&
      (await statusText()) === '' &&
      (await page.getByRole('table').count()) === 0 &&
      (await button('Copy values').isDisabled()) &&
      (await page.getByText('JSONPath as RFC 9535 defines it:', { exact: false }).count()) === 1,
  );

  // §2.1: the bookstore, authors; Copy values and Copy paths.
  await setValue('#json-query-document', STORE);
  await query.fill('$.store.book[*].author');
  await until('4 results');
  const authors = await rows();
  await button('Copy values').click();
  const copiedValues = await copied();
  await button('Copy paths').click();
  const copiedPaths = await copied();
  check(
    'JSON Query: §2.1 four authors with their normalized paths; Copy values is a JSON array, Copy paths one per line',
    JSON.stringify(authors.map(r => r[1])) ===
      JSON.stringify([0, 1, 2, 3].map(k => `$['store']['book'][${k}]['author']`)) &&
      authors[0][2] === '"Nigel Rees"' &&
      copiedValues === '[\n  "Nigel Rees",\n  "Evelyn Waugh",\n  "Herman Melville",\n  "J. R. R. Tolkien"\n]' &&
      copiedPaths.split('\n').length === 4,
    `${JSON.stringify(authors)} ${JSON.stringify(copiedValues)}`,
  );
  check(
    'JSON Query: queries run in the tool’s module worker, loaded from the extension’s own file',
    workers.length > 0 &&
      workers.every(
        w => w.url.startsWith('chrome-extension://') && /\/assets\/json-query\.worker-[\w-]+\.js$/.test(w.url),
      ),
    workers.map(w => w.url).join(', '),
  );

  // §2.2: a filter; a row's value indented by 2.
  await query.fill('$..book[?@.price < 10]');
  await until('2 results');
  await button('Copy value 1').click();
  const one = await copied();
  check(
    'JSON Query: §2.2 books under 10; Copy value 1 copies the first book indented by 2',
    one ===
      '{\n  "category": "reference",\n  "author": "Nigel Rees",\n  "title": "Sayings of the Century",\n  "price": 8.95\n}',
    JSON.stringify(one),
  );
  await shootAll('tool-json-query-01-results-light.png');

  // §2.3: typing with an error — the previous results stay, the status says so, the echo marks the place.
  await query.fill('$..book[?@.price <');
  await page.locator('[data-part="echo"]').waitFor();
  const typing = {
    message: (await message('query')).trim(),
    status: await statusText(),
    rows: (await rows()).length,
    caret: await page.locator('[data-part="caret"]').count(),
  };
  await page.getByRole('button', { name: /^Position 19:/ }).click();
  const selection = await query.evaluate(el => [document.activeElement === el, el.selectionStart, el.selectionEnd]);
  check(
    'JSON Query: §2.3 an error while typing: position and reason, the place marked, the last results kept and said so',
    typing.message === 'Position 19: unexpected end of the query: expected a value to compare with' &&
      typing.status === 'The query has an error. Showing 2 results of the last valid query: $..book[?@.price < 10]' &&
      typing.rows === 2 &&
      typing.caret === 1 &&
      JSON.stringify(selection) === '[true,18,18]',
    JSON.stringify({ ...typing, selection }),
  );
  await query.fill('$[?@.a=1]');
  await page.locator('[data-part="marked"]').waitFor();
  await shootAll('tool-json-query-02-error-light.png');

  // §2.4: exact numbers.
  await setValue('#json-query-document', '{"a":[{"n":12345678901234567890},{"n":12345678901234567891}]}');
  await query.fill('$.a[?@.n == 12345678901234567891].n');
  await until('1 result');
  const exact = await rows();
  check(
    'JSON Query: §2.4 a number beyond a double is compared exactly and shown as written, with a note',
    JSON.stringify(exact) === JSON.stringify([['1', "$['a'][1]['n']", '12345678901234567891']]) &&
      (await message('document')).trim() ===
        '2 numbers are kept as written and compared exactly: JSON.parse in JavaScript would change them.',
    JSON.stringify(exact),
  );

  // I-Regexp in Chrome's engine: . does not take a line break; a pattern that is not I-Regexp is false, with a note.
  await setValue('#json-query-document', '["ab", "xab", "a\\nb", "12", "É"]');
  await query.fill("$[?search(@, 'a.') || match(@, '\\\\p{Lu}')]");
  await until('3 results');
  const searched = (await rows()).map(r => r[2]);
  await query.fill("$[?match(@, '\\\\d+')]");
  await until('No results');
  check(
    'JSON Query: match() and search() run I-Regexp in Chrome (. without line breaks, \\p{Lu}); \\d is refused with a note',
    JSON.stringify(searched) === JSON.stringify(['"ab"', '"xab"', '"É"']) &&
      (await message('query')).trim() ===
        "The pattern '\\\\d+' of match() is not an I-Regexp (RFC 9485): \\d is not part of it (write [0-9]), so match() is false for every node.",
    JSON.stringify(searched),
  );

  // §12: 1 MB with $..* — the text box first (no query), then the query; rows a chunk per frame; Copy values.
  await query.fill('');
  await page.waitForFunction(() => document.querySelector('[data-status]')?.textContent.trim() === '');
  const big = records();
  const field = await page.evaluate(async text => {
    const el = document.querySelector('#json-query-document');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, big);
  await watchFrames(page);
  const tool = await page.evaluate(async () => {
    const el = document.querySelector('#json-query-query');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '$..*');
    el.dispatchEvent(new Event('input', { bubbles: true }));
    const counted = () => /^[\d,]+ results/.test(document.querySelector('[data-status]')?.textContent ?? '');
    while (!counted() && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
    const shown = performance.now() - start;
    while (!document.querySelector('[data-row="999"]') && performance.now() - start < 20_000)
      await new Promise(r => requestAnimationFrame(r));
    return { shown: Math.round(shown), built: Math.round(performance.now() - start) };
  });
  const frames = await stopFrames(page);
  const bigStatus = await statusText();
  const bigRows = (await message('results')).trim();
  const copyMs = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Copy values');
    const start = performance.now();
    b.click();
    while (![...document.querySelectorAll('button')].some(x => x.textContent === 'Copied'))
      await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - start);
  });
  const bigCopy = await copied();
  report.jsonQuery = { megabyte: { chars: big.length, field, tool, frames, copyMs, copied: bigCopy.length } };
  check(
    'JSON Query: §12 a 1 MB document with $..* — all results counted, 1,000 rows built without a long frame, Copy values copies all',
    /^[\d,]+ results$/.test(bigStatus) &&
      /^Showing 1,000 of [\d,]+ results\.$/.test(bigRows) &&
      bigCopy.startsWith('[\n  {\n    "id": 0,') &&
      frames.max < 200,
    `${big.length} characters: text box ${field} ms; query → count ${tool.shown} ms, 1,000 rows ${tool.built} ms; longest frame gap ${frames.max} ms, longest task ${frames.longest} ms; ${bigStatus}; Copy values ${copyMs} ms, ${bigCopy.length} characters`,
  );

  // §12: the largest document taken, 16 Mi characters: the text box's cost, then the worker reading it and a query;
  // one character more is refused at once.
  await query.fill('$[-1].id');
  const huge = await page.evaluate(async () => {
    const recs = [];
    let size = 2;
    for (let k = 0; size < 16 * 1024 * 1024 - 200; k++) {
      const r = { id: k, name: `user ${k}`, tags: ['a', 'b', 'c'], address: { city: 'X', zip: String(10000 + k) } };
      size += JSON.stringify(r).length + 1;
      recs.push(r);
    }
    const text = JSON.stringify(recs);
    const el = document.querySelector('#json-query-document');
    const start = performance.now();
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(el, text);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const painted = performance.now() - start;
    const counted = () => document.querySelector('[data-status]')?.textContent.trim() === '1 result';
    while (!counted() && performance.now() - start < 30_000) await new Promise(r => requestAnimationFrame(r));
    return {
      chars: text.length,
      field: Math.round(painted),
      result: Math.round(performance.now() - start),
      value: document.querySelector('[data-row="0"] [data-part="value"]')?.textContent,
      last: recs.length - 1,
    };
  });
  const over = await page.evaluate(async () => {
    const el = document.querySelector('#json-query-document');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(
      el,
      'x'.repeat(16 * 1024 * 1024 + 1),
    );
    el.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return document.querySelector('[data-field="document"]')?.textContent.trim();
  });
  report.jsonQuery.huge = huge;
  check(
    'JSON Query: §12 a 16 Mi document is read in the worker and queried; one character more is refused at once',
    huge.value === String(huge.last) &&
      huge.chars <= 16 * 1024 * 1024 &&
      over === 'The document is longer than 16 MB. JSON Query works with up to 16 MB.',
    `${huge.chars} characters: text box ${huge.field} ms, $[-1].id answered ${huge.result} ms after the edit (150 ms of it the wait after the edit)`,
  );

  // The scanner's depth limit: 1,000 levels, no recursion anywhere.
  await query.fill('$..*');
  await setValue('#json-query-document', `${'['.repeat(1000)}${']'.repeat(1000)}`);
  await until('999 results');
  check('JSON Query: 1,000 nested arrays — $..* gives 999 results, no stack overflow', true);

  // A node list over 1,000,000: refused with the reason.
  await setValue('#json-query-document', `${'['.repeat(600)}${']'.repeat(600)}`);
  await query.fill('$..*..*..*');
  await page.locator('[data-refused]').waitFor({ timeout: 10_000 });
  check(
    'JSON Query: a query selecting over 1,000,000 nodes is refused with the reason',
    (await page.locator('[data-refused]').innerText()).trim() ===
      'The query selects more than 1,000,000 nodes. Narrow it.',
  );

  // §2.7: a descendant query inside a filter on a deep document — quadratic by nature — stopped at 1 s.
  await query.fill('$[0]');
  await setValue('#json-query-document', deepAndWide());
  await until('No results');
  await watchFrames(page);
  const startedAt = Date.now();
  await query.fill('$..[?count(@..*) > 0]');
  await page.waitForTimeout(700);
  const clickMs = await page.evaluate(async () => {
    const b = [...document.querySelectorAll('button')].find(x => x.textContent === 'Copy paths');
    const field = document.querySelector('#json-query-query');
    const t = performance.now();
    field.focus();
    b?.focus();
    await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - t);
  });
  const runningShown = (await statusText()).includes('Running…');
  await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
  const stoppedMs = Date.now() - startedAt;
  const quadratic = await stopFrames(page);
  const stoppedText = (await page.locator('[data-stopped] [role="alert"]').innerText()).trim();
  check(
    'JSON Query: §2.7 a filter with a descendant query on a deep document is stopped after 1 second and says why',
    stoppedText ===
      'Stopped after 1 second: the query takes too long on this document. Descendant queries inside a filter (?@..x) and patterns such as (a+)+ in match() or search() often cause this.' &&
      (await button('Allow 10 seconds').count()) === 1 &&
      stoppedMs < 3_000,
    `${stoppedMs} ms from the edit to the message`,
  );
  check(
    'JSON Query: the page answers while the query runs, and says Running…',
    clickMs < 200 && quadratic.max < 150 && runningShown,
    `focus answered in ${clickMs} ms; longest frame gap ${quadratic.max} ms; longest task ${quadratic.longest} ms`,
  );
  await shootAll('tool-json-query-03-stopped-light.png');

  // A pattern that backtracks: (a+)+b on 40 a's and a '!', once per candidate.
  await setValue('#json-query-document', JSON.stringify([`${'a'.repeat(40)}!`]));
  await query.fill("$[?match(@, '(a+)+b')]");
  const t0 = Date.now();
  await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
  const patternMs = Date.now() - t0;
  check(
    'JSON Query: a pattern that backtracks is stopped at the limit too',
    patternMs < 3_000,
    `${patternMs} ms from the edit to the message`,
  );
  report.jsonQuery.stopped = { quadraticMs: stoppedMs, patternMs, clickMs, frames: quadratic };

  // Dark theme screenshots of the same states.
  await query.fill('$..book[?@.price < 10]');
  await setValue('#json-query-document', STORE);
  await until('2 results');
  await inDarkTheme(ctx, base, page, async () => {
    await shootAll('tool-json-query-01-results-dark.png');
    await query.fill('$[?@.a=1]');
    await page.locator('[data-part="marked"]').waitFor();
    await shootAll('tool-json-query-02-error-dark.png');
  });

  // History: the edit is kept in clear; an entry opens back into the tool.
  await query.fill('$.store.bicycle.color');
  await until('1 result');
  await open('#/tools');
  const entry = await waitForHistoryRecord(
    page,
    'json-query',
    r => r.payload?.query === '$.store.bicycle.color' && r.label === '$.store.bicycle.color · 1 result',
  ).catch(() => null);
  check(
    'JSON Query: an edit is recorded in clear with the query and its count',
    !!entry && !entry.sealed && entry.kind === 'edit',
    entry ? `${entry.kind}: ${entry.label}` : 'no record',
  );
  await open('#/tools/json-query');
  await query.waitFor();
  await page.getByText('Recent entries').click();
  await page.locator('.kit-history-entry').first().waitFor();
  await page
    .locator('.kit-history-entry')
    .filter({ hasText: '$.store.bicycle.color · 1 result' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByText('Opened from History: $.store.bicycle.color · 1 result.').waitFor({ timeout: 10_000 });
  await until('1 result');
  check(
    'JSON Query: the entry opens back with the query and the document, and runs again',
    (await query.inputValue()) === '$.store.bicycle.color' &&
      (await docField.inputValue()) === STORE &&
      JSON.stringify((await rows())[0]) === JSON.stringify(['1', "$['store']['bicycle']['color']", '"red"']),
  );

  // §7: a query pasted into the start page opens this tool with it; pasted JSON still opens the JSON tool.
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
  };
  await paste('$.store.book[*].author');
  await page.waitForFunction(() => location.hash === '#/tools/json-query', null, { timeout: 5_000 }).catch(() => {});
  await query.waitFor({ timeout: 10_000 }).catch(() => {});
  const pasted = { hash: await page.evaluate(() => location.hash), query: await query.inputValue().catch(() => null) };
  await paste('{"a": 1}');
  await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5_000 }).catch(() => {});
  const json = await page.evaluate(() => location.hash);
  check(
    'JSON Query: §7 a query pasted into the start page opens this tool with it; pasted JSON opens the JSON tool',
    pasted.hash === '#/tools/json-query' && pasted.query === '$.store.book[*].author' && json === '#/tools/json',
    `${JSON.stringify(pasted)} ${json}`,
  );
  return clipboard;
};
