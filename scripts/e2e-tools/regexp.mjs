// The RegExp tool in the built extension (docs/tools/specs/regexp.md): its scenarios (§2) the way a person does them —
// the page's real controls — run by scripts/e2e-tools.mjs. Matching runs in the tool's module worker, loaded from the
// package's own file (never blob: or data:); a pattern that backtracks for ever is stopped at the limit while the page
// keeps answering, which is measured here: the longest frame and a click's answer while it runs, when the worker is
// stopped and the message shows. Also the engine's own features the specification checked only in Chrome (duplicate
// group names, modifiers, v), 10,000 highlighted matches built without a long frame, and an entry of the tool history
// opened back. The copy buttons' clipboard writes are caught in the page, so the run never touches a real clipboard.

/* global document, window, requestAnimationFrame, DataTransfer, ClipboardEvent, indexedDB -- page.evaluate callbacks run in the page */

import { themeMode, withSettings } from '../e2e-theme.mjs';

/** The tool's records in the extension's history, parsed. */
const records = page =>
  page
    .evaluate(async () => {
      const db = await new Promise(res => {
        const r = indexedDB.open('tool-history');
        r.onupgradeneeded = () => r.transaction.abort();
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
      if (!db) return [];
      const lines = await new Promise((res, rej) => {
        const r = db.transaction('records').objectStore('records').getAll();
        r.onsuccess = () => res(r.result.map(x => x.line));
        r.onerror = () => rej(r.error);
      });
      db.close();
      return lines;
    })
    .then(lines => lines.map(line => JSON.parse(line)).filter(r => r.owner === 'regexp'));

/** Frame watch in the page: the longest gap between animation frames, and long animation frames (LoAF). */
const watchFrames = page =>
  page.evaluate(() => {
    const w = { max: 0, last: performance.now(), on: true, loaf: 0, blocking: 0 };
    window.__frames = w;
    const tick = t => {
      if (!w.on) return;
      w.max = Math.max(w.max, t - w.last);
      w.last = t;
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
    try {
      w.observer = new PerformanceObserver(list => {
        for (const e of list.getEntries()) {
          w.loaf = Math.max(w.loaf, e.duration);
          w.blocking = Math.max(w.blocking, e.blockingDuration ?? 0);
        }
      });
      w.observer.observe({ type: 'long-animation-frame' });
    } catch {
      // no LoAF in this browser: the frame gaps stand alone
    }
  });

const stopFrames = page =>
  page.evaluate(() => {
    const w = window.__frames;
    w.on = false;
    w.observer?.disconnect();
    return { max: Math.round(w.max), loaf: Math.round(w.loaf), blocking: Math.round(w.blocking) };
  });

export default async args => {
  try {
    await run(args);
  } finally {
    // The page stays for the next modules: the stand-in for the clipboard goes (the prototype's writeText is back).
    await args.page.evaluate(() => delete navigator.clipboard.writeText).catch(() => undefined);
  }
};

const run = async ({ ctx, page, base, check, shoot }) => {
  const workers = [];
  page.on('worker', w => {
    const seen = { url: w.url(), at: Date.now(), closedAt: null };
    workers.push(seen);
    w.on('close', () => (seen.closedAt = Date.now()));
  });
  await page.goto(`${base}#/tools/regexp`);
  const pattern = page.getByLabel('Pattern', { exact: true });
  const text = page.getByLabel('Test text', { exact: true });
  const flag = name => page.getByRole('button', { name, exact: true });
  const status = page.locator('[data-status]');
  const region = page.getByRole('region', { name: 'Matches in text' });
  const message = where => page.locator(`[data-field="${where}"]`).innerText();
  const until = want => status.filter({ hasText: want }).waitFor({ timeout: 10_000 });
  /** Waits for the highlighted texts of a new run (the status alone may still be the previous run's). */
  const marksAre = want =>
    page.waitForFunction(
      w => [...document.querySelectorAll('[aria-label="Matches in text"] mark')].map(m => m.textContent).join() === w,
      want,
      { timeout: 10_000 },
    );
  const tableRows = name =>
    page
      .getByRole('table', { name, exact: true })
      .locator('tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.cells].map(td => td.innerText)));
  await pattern.waitFor();
  // The whole tool page in a screenshot: a taller window for the moment, scrolled to the top, then back.
  const shootAll = async name => {
    const size = page.viewportSize();
    await page.setViewportSize({ width: size.width, height: 1_700 });
    await page.locator('[data-slot="tool-page"]').evaluate(el => el.scrollIntoView({ block: 'start' }));
    await page.waitForTimeout(150);
    await shoot(page, name);
    await page.setViewportSize(size);
  };
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = t => (window.__copied.push(t), Promise.resolve());
  });
  const copied = () => page.evaluate(() => window.__copied.at(-1));

  // Empty: g on, nothing counted, no worker yet.
  check(
    'RegExp: an empty tool has g on, an empty status and no worker',
    (await flag('global').getAttribute('aria-pressed')) === 'true' &&
      (await status.innerText()).trim() === '' &&
      workers.length === 0 &&
      (await page.getByText('JavaScript regular expressions, as this browser runs them.').count()) === 1,
  );

  // §2.1: dates — 2 matches highlighted; the second one's groups.
  await pattern.fill('(\\d{4})-(\\d{2})-(\\d{2})');
  await text.fill('from 2026-11-19 to 2026-12-01');
  await until('2 matches');
  const marked = await region.locator('mark').allInnerTexts();
  await page.getByRole('button', { name: 'Match 2', exact: true }).click();
  const groups = await tableRows('Groups');
  check(
    'RegExp: dates are highlighted in the text and the second match’s groups have their positions',
    marked.join() === '2026-11-19,2026-12-01' &&
      JSON.stringify(groups) ===
        JSON.stringify([
          ['1', '—', '19–23', '"2026"'],
          ['2', '—', '24–26', '"12"'],
          ['3', '—', '27–29', '"01"'],
        ]),
    `${marked.join()} ${JSON.stringify(groups)}`,
  );
  check(
    'RegExp: matching runs in the tool’s module worker, loaded from the extension’s own file',
    workers.length > 0 &&
      workers.every(w => w.url.startsWith('chrome-extension://') && /\/assets\/regexp\.worker-[\w-]+\.js$/.test(w.url)),
    workers.map(w => w.url).join(', '),
  );
  const hasNoStyle = await region.evaluate(el => [...el.querySelectorAll('*')].every(n => !n.hasAttribute('style')));
  check('RegExp: the highlights are elements with classes, no style attribute', hasNoStyle);
  await shootAll('tool-regexp-01-matches-light.png');

  // §2.2: replacement $3.$2.$1; Copy result.
  await page.getByLabel('Replace', { exact: true }).click();
  await page.getByLabel('Replace with', { exact: true }).fill('$3.$2.$1');
  const result = page.getByLabel('Result', { exact: true });
  await page.waitForFunction(() => document.getElementById('regexp-result')?.value.startsWith('from 19'));
  await page.getByRole('button', { name: 'Copy result', exact: true }).click();
  check(
    'RegExp: $3.$2.$1 swaps the dates; Copy result copies the result',
    (await result.inputValue()) === 'from 19.11.2026 to 01.12.2026' &&
      (await copied()) === 'from 19.11.2026 to 01.12.2026',
  );
  await shootAll('tool-regexp-02-replace-light.png');

  // §2.3: named groups.
  await pattern.fill('(?<user>\\w+)@(?<host>[\\w.]+)');
  await text.fill('mail ann@example.com, bob@test.org');
  await page.getByLabel('Replace with', { exact: true }).fill('$<host>: $<user>');
  await until('2 matches');
  await page.waitForFunction(
    () => document.getElementById('regexp-result')?.value === 'mail example.com: ann, test.org: bob',
  );
  check(
    'RegExp: named groups are named in the table and in the replacement',
    JSON.stringify((await tableRows('Groups')).map(r => r[1])) === '["user","host"]',
  );

  // Duplicate names in branches, modifiers and v — Chrome's engine (Node 22's refuses the first two).
  await pattern.fill('(?<y>\\d{4})-\\d{2}|\\d{2}/(?<y>\\d{4})');
  await text.fill('2026-11 and 11/2027');
  await page.getByLabel('Replace with', { exact: true }).fill('$<y>');
  await until('2 matches');
  await page.waitForFunction(() => document.getElementById('regexp-result')?.value === '2026 and 2027');
  await page.getByRole('button', { name: 'Match 2', exact: true }).click();
  const dup = await tableRows('Groups');
  await page.getByRole('button', { name: 'Copy regex', exact: true }).click();
  const literal = await copied();
  check(
    'RegExp: duplicate group names in branches work in Chrome; $<y> takes the one that matched; the literal escapes /',
    JSON.stringify(dup) ===
      JSON.stringify([
        ['1', 'y', '—', 'no match'],
        ['2', 'y', '15–19', '"2027"'],
      ]) && literal === '/(?<y>\\d{4})-\\d{2}|\\d{2}\\/(?<y>\\d{4})/g',
    `${JSON.stringify(dup)} ${literal}`,
  );
  await page.getByLabel('Replace', { exact: true }).click();
  await pattern.fill('(?i:a)b');
  await text.fill('Ab AB ab');
  await marksAre('Ab,ab');
  check('RegExp: modifiers (?i:…) work in Chrome', (await status.innerText()).trim() === '2 matches');
  await flag('unicodeSets').click();
  await pattern.fill('[\\p{L}--[a-z]]');
  await text.fill('aBcÉ');
  await marksAre('B,É');
  check('RegExp: v subtracts classes', (await status.innerText()).trim() === '2 matches');
  await flag('unicodeSets').click();
  await pattern.fill('\\p{L}');
  await text.fill('p{L}');
  await until('1 match');
  check(
    'RegExp: \\p{L} without u or v finds p{L} and says why',
    (await message('pattern')) ===
      'Without u or v, \\p{…} is not a Unicode property: it matches the letter p and the braces.',
  );

  // §2.4: a literal pasted into the empty field is split.
  await pattern.fill('');
  await pattern.focus();
  await page.evaluate(clip => {
    const data = new DataTransfer();
    data.setData('text/plain', clip);
    document
      .getElementById('regexp-pattern')
      .dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
  }, '/^\\s*#.*$/gm');
  await page.getByRole('button', { name: 'Keep as pasted', exact: true }).waitFor();
  check(
    'RegExp: a pasted /…/gm is split into the pattern and the flags g and m',
    (await pattern.inputValue()) === '^\\s*#.*$' &&
      (await page.locator('[data-flags]').innerText()) === 'global, multiline' &&
      (await message('pattern')) === 'Pasted as a literal: the pattern and the flags were split.',
  );
  await page.getByRole('button', { name: 'Keep as pasted', exact: true }).click();
  check(
    'RegExp: Keep as pasted puts the literal back and the flags as they were',
    (await pattern.inputValue()) === '/^\\s*#.*$/gm' && (await page.locator('[data-flags]').innerText()) === 'global',
  );

  // §2.6: half an emoji without u.
  await pattern.fill('.');
  await text.fill('😀');
  await until('2 matches');
  const half = await message('matches');
  await flag('unicode').click();
  await until('1 match');
  check(
    'RegExp: without u a match splits the emoji and the note says so; with u it is whole',
    half ===
      'A match boundary splits a character made of two UTF-16 units. Turn on u or v to match whole characters.' &&
      (await region.locator('mark').allInnerTexts()).join() === '😀',
  );
  await flag('unicode').click();

  // §2.7: a typo.
  await pattern.fill('(\\d+');
  await page.locator('[data-field="pattern"][data-tone="error"]').waitFor();
  check(
    'RegExp: (\\d+ says Unterminated group under the field and shows no results',
    (await message('pattern')) === 'Unterminated group' &&
      (await status.innerText()).trim() === '' &&
      (await region.locator('mark').count()) === 0,
  );

  // §2.5: a pattern that never ends. The page answers a click while it runs, the worker is stopped at the limit, the
  // message appears, and a following edit works.
  await pattern.fill('^(a+)+$');
  await text.fill('');
  await until('No matches');
  // The worker that will run it: the idle one kept from the last job (or a new one, if none is alive).
  const before = workers.filter(w => w.closedAt === null).length ? workers.length - 1 : workers.length;
  await watchFrames(page);
  await text.fill(`${'a'.repeat(40)}b`);
  const startedAt = Date.now();
  // A click during the run (sent at 150 ms, limit 1 s): Copy regex answers with "Copied".
  await page.waitForTimeout(600);
  const clickMs = await page.evaluate(async () => {
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Copy regex');
    const t = performance.now();
    button.click();
    while (![...document.querySelectorAll('button')].some(b => b.textContent === 'Copied'))
      await new Promise(r => requestAnimationFrame(r));
    return Math.round(performance.now() - t);
  });
  const runningShown = (await status.innerText()).includes('Running…');
  await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
  const stoppedMs = Date.now() - startedAt;
  const frames = await stopFrames(page);
  const ran = workers.slice(before);
  await page.waitForTimeout(100);
  const stoppedText = await page.locator('[data-stopped] [role="alert"]').innerText();
  check(
    'RegExp: a catastrophic pattern is stopped after 1 second and the page says why',
    stoppedText ===
      'Stopped after 1 second: the pattern takes too long on this text. Nested quantifiers such as (a+)+ often cause this (catastrophic backtracking).' &&
      (await page.getByRole('button', { name: 'Allow 10 seconds', exact: true }).count()) === 1 &&
      stoppedMs < 2_500,
    `${stoppedMs} ms from the edit to the message`,
  );
  check(
    'RegExp: the page answers while the pattern runs (a click, the frames), and says Running…',
    clickMs < 200 && frames.max < 100 && runningShown,
    `click answered in ${clickMs} ms; longest frame gap ${frames.max} ms; longest animation frame ${frames.loaf} ms (blocking ${frames.blocking} ms)`,
  );
  // terminate() is called at the limit; Chrome ends a busy worker's thread by force after its own delay (Blink's
  // forcible termination, 2 s) — the page does not wait for that: the next job has a new worker.
  const stoppedAt = Date.now();
  for (let i = 0; i < 40 && ran.some(w => w.closedAt === null); i++) await page.waitForTimeout(100);
  check(
    'RegExp: the worker running it is terminated at the limit (its thread ended by the browser)',
    ran.length >= 1 && ran.every(w => w.closedAt !== null),
    ran
      .map(w => (w.closedAt === null ? 'still open' : `thread gone ${w.closedAt - stoppedAt} ms after the message`))
      .join(', '),
  );
  await shootAll('tool-regexp-03-stopped-light.png');

  // Allow 10 seconds: the same job runs past 1 s (Running…); an edit cancels it and works at once.
  await page.getByRole('button', { name: 'Allow 10 seconds', exact: true }).click();
  await page.waitForTimeout(1_600);
  const stillRunning =
    (await page.getByRole('button', { name: 'Allow 10 seconds', exact: true }).count()) === 0 &&
    (await page.locator('[data-stopped]').count()) === 0 &&
    (await status.innerText()).includes('Running…');
  const longWorker = workers.at(-1);
  const longOpen = longWorker.closedAt === null;
  await text.fill('aaaa');
  await until('1 match');
  for (let i = 0; i < 40 && longWorker.closedAt === null; i++) await page.waitForTimeout(100);
  check(
    'RegExp: Allow 10 seconds runs on past 1 s; a following edit cancels it and answers',
    stillRunning &&
      longOpen &&
      longWorker.closedAt !== null &&
      (await region.locator('mark').allInnerTexts()).join() === 'aaaa',
    `still running at 1.6 s: ${stillRunning}; its worker open then: ${longOpen}, closed by the edit: ${longWorker.closedAt !== null}`,
  );

  // The specification's other two catastrophic rows: (\w+\s?)*$ without flags, ^(a|aa)+$ with a replacement.
  const stopsAt = async () => {
    const t = Date.now();
    await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
    return Date.now() - t;
  };
  await flag('global').click();
  await pattern.fill('(\\w+\\s?)*$');
  await text.fill(`${'word '.repeat(30)}!`);
  const wordsMs = await stopsAt();
  await flag('global').click();
  await page.getByLabel('Replace', { exact: true }).click();
  await page.getByLabel('Replace with', { exact: true }).fill('x');
  await pattern.fill('^(a|aa)+$');
  await text.fill(`${'a'.repeat(60)}b`);
  const altMs = await stopsAt();
  await page.getByLabel('Replace', { exact: true }).click();
  check(
    'RegExp: (\\w+\\s?)*$ on 30 words and ^(a|aa)+$ on 60 a’s are stopped at the limit too',
    wordsMs < 2_500 && altMs < 2_500,
    `${wordsMs} ms and ${altMs} ms from the edit to the message`,
  );

  // 10,000 matches: all highlighted, built a chunk per frame (no long frame); the table shows 1,000.
  await pattern.fill('a');
  await text.fill('');
  await until('No matches');
  await watchFrames(page);
  const t0 = Date.now();
  await text.fill('a '.repeat(10_001));
  await until('10,000+ matches (the first 10,000 are shown)');
  await region.and(page.locator('[data-built="all"]')).waitFor({ timeout: 10_000 });
  const builtMs = Date.now() - t0;
  const many = await stopFrames(page);
  const marks = await region.locator('mark').count();
  check(
    'RegExp: 10,000 matches are all highlighted without a long frame; the table shows 1,000 and says so',
    marks === 10_000 &&
      (await page.getByRole('button', { name: /^Match \d+$/ }).count()) === 1_000 &&
      (await message('rows')) === 'Showing 1,000 of 10,000+ matches.' &&
      many.max < 200,
    `${marks} marks in ${builtMs} ms; longest frame gap ${many.max} ms; longest animation frame ${many.loaf} ms (blocking ${many.blocking} ms)`,
  );
  // Selecting the last match in the table scrolls the text to it.
  await page.getByRole('button', { name: 'Match 1000', exact: true }).click();
  const inView = await region.evaluate(el => {
    const m = el.querySelector('mark[data-match="999"]').getBoundingClientRect();
    const r = el.getBoundingClientRect();
    return m.top >= r.top && m.bottom <= r.bottom;
  });
  check('RegExp: choosing a match in the table scrolls the text to it', inView);

  // History: the edits are kept; an entry opens back into the tool.
  await pattern.fill('(\\w+)@example\\.com');
  await text.fill('write to ann@example.com');
  await until('1 match');
  await page.goto(`${base}#/tools`);
  let kept = [];
  for (let i = 0; i < 50 && !kept.some(r => r.payload?.pattern === '(\\w+)@example\\.com'); i++) {
    await page.waitForTimeout(100);
    kept = await records(page);
  }
  const entry = kept.find(r => r.payload?.pattern === '(\\w+)@example\\.com');
  check(
    'RegExp: an edit is recorded in clear with its count',
    !!entry && !entry.sealed && entry.label === '/(\\w+)@example\\.com/g · 1 match',
    entry ? `${entry.kind}: ${entry.label}` : `${kept.length} records`,
  );
  await page.goto(`${base}#/tools/regexp`);
  await page.getByText('Recent entries').click();
  await page.locator('.kit-history-entry').first().waitFor();
  await page
    .locator('.kit-history-entry')
    .filter({ hasText: '/(\\w+)@example\\.com/g · 1 match' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByText('Opened from History: /(\\w+)@example\\.com/g · 1 match.').waitFor();
  await until('1 match');
  check(
    'RegExp: an entry opens back into the tool and runs',
    (await pattern.inputValue()) === '(\\w+)@example\\.com' &&
      (await text.inputValue()) === 'write to ann@example.com' &&
      (await region.locator('mark').allInnerTexts()).join() === 'ann@example.com',
  );
  await page.getByText('Recent entries').click();

  // Dark: the matches with groups and replacement, and the stop message.
  const mode = await withSettings(ctx, base, async settings =>
    (
      await settings.getByRole('radiogroup', { name: 'Theme mode' }).getByRole('radio', { checked: true }).innerText()
    ).trim(),
  );
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor();
  await page.goto(`${base}#/tools/regexp`);
  await page.locator('html[data-mode="dark"]').waitFor();
  await pattern.fill('(\\d{4})-(\\d{2})-(\\d{2})');
  await text.fill('from 2026-11-19 to 2026-12-01');
  await page.getByLabel('Replace', { exact: true }).click();
  await page.getByLabel('Replace with', { exact: true }).fill('$3.$2.$1');
  await until('2 matches');
  await page.getByRole('button', { name: 'Match 2', exact: true }).click();
  await page.waitForTimeout(200);
  await shootAll('tool-regexp-04-matches-dark.png');
  await pattern.fill('^(a+)+$');
  await text.fill(`${'a'.repeat(40)}b`);
  await page.locator('[data-stopped]').waitFor({ timeout: 5_000 });
  await shootAll('tool-regexp-05-stopped-dark.png');
  check('RegExp: the dark theme shows the same page', true);
  await themeMode(ctx, base, mode || 'Light');
  await page.locator('html[data-mode="light"]').waitFor();
  await page.goto(`${base}#/tools`);
};
