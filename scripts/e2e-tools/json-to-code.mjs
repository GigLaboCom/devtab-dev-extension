// The JSON to Code tool in the built extension (docs/tools/specs/json-to-code.md §2, §6, §12), with real page elements:
// the scenarios of §2 one by one — TypeScript at once, Go aligned, null and a missing key, two log lines merged, the
// Root type, an identifier beyond i64, an error that puts the caret on its place — then Copy (the page's clipboard
// stubbed) and its history record, nesting far past the limit, the largest live input timed, a large input waiting for
// Generate and generated in the tool's worker (16 MiB, timed apart from the text box), the record opened back into the
// tool, and the page in the dark theme. Run by scripts/e2e-tools.mjs.

/* global document, HTMLTextAreaElement, requestAnimationFrame -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const MiB = 1024 * 1024;

/** Records of six fields in an array, at most `chars` characters. */
const records = chars => {
  const items = [];
  let size = 2;
  for (let i = 0; ; i++) {
    const item = JSON.stringify({
      id: i,
      name: `user ${i} — Zürich`,
      score: i * 1.25,
      tags: ['alpha', `t${i % 17}`],
      owner: { login: `l${i}`, since: 2000 + (i % 25) },
      note: i % 2 ? null : 'x',
    });
    if (size + item.length + 1 > chars) break;
    size += item.length + 1;
    items.push(item);
  }
  return `[${items.join(',')}]`;
};

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const pageErrors = [];
  const onError = e => pageErrors.push(String(e));
  page.on('pageerror', onError);
  await page.goto(`${base}#/tools/json-to-code`);
  const input = page.locator('#json-to-code-input');
  // The page says "Loading…" until its history is open: wait for the tool's own field.
  await input.waitFor({ timeout: 15_000 });
  const result = () => page.locator('#json-to-code-output').inputValue();
  const status = page.locator('[data-part="status"]');
  const said = async () => (await status.innerText()).trim();
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(t => t.trim()).filter(Boolean);
  const language = async name => {
    await page.locator('#json-to-code-language').click();
    await page.getByRole('option', { name, exact: true }).click();
  };
  /** Waits until the result holds `text` (a new input's own result, never the previous one's). */
  const until = async (test, timeout = 10_000) => {
    const start = Date.now();
    let last = '';
    while (Date.now() - start < timeout) {
      last = await result();
      if (test(last)) return last;
      await sleep(30);
    }
    return last;
  };

  // §2.1: an answer copied from the Network tab; TypeScript by default; the types at once.
  await input.fill('{"id":7,"name":"Ann","owner":{"login":"ann"}}');
  const ts = await until(r => r.includes('login'));
  check(
    'JSON to Code: §2.1 TypeScript at once, Owner under Root',
    ts ===
      'export interface Root {\n  id: number;\n  name: string;\n  owner: Owner;\n}\n\nexport interface Owner {\n  login: string;\n}\n',
    JSON.stringify(ts),
  );
  await settledShot(shoot, page, 'tool-json-to-code-01-typescript.png');

  // §2.2: the same answer in Go, aligned as gofmt does; the TypeScript options are hidden.
  await language('Go');
  const go = await until(r => r.startsWith('type Root struct'));
  check(
    'JSON to Code: §2.2 Go structs aligned as gofmt; Declaration and Export hidden',
    go ===
      'type Root struct {\n\tID    int64  `json:"id"`\n\tName  string `json:"name"`\n\tOwner Owner  `json:"owner"`\n}\n\ntype Owner struct {\n\tLogin string `json:"login"`\n}\n' &&
      (await page.getByRole('radio', { name: 'interface', exact: true }).count()) === 0 &&
      (await page.getByLabel('Export', { exact: true }).count()) === 0,
    JSON.stringify(go),
  );
  await settledShot(shoot, page, 'tool-json-to-code-02-go.png');

  // §2.3: a list of users in TypeScript: null and a missing key.
  await language('TypeScript');
  await input.fill('[{"id":1,"email":"a@x"},{"id":2,"email":null,"phone":"1"}]');
  const users = await until(r => r.includes('phone'));
  check(
    'JSON to Code: §2.3 email: string | null, phone?: string',
    users ===
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n  email: string | null;\n  phone?: string;\n}\n',
    JSON.stringify(users),
  );

  // §2.4: two log lines pasted whole.
  await input.fill('{"event":"login","user":"ann"}\n{"event":"login","ip":"1.2.3.4"}');
  const merged = await until(r => r.includes('ip?'));
  const mergedNotes = await notes();
  check(
    'JSON to Code: §2.4 two samples merged, the keys of one optional, the note',
    merged === 'export interface Root {\n  event: string;\n  user?: string;\n  ip?: string;\n}\n' &&
      mergedNotes[0] === '2 samples merged: keys missing from some of them are optional.',
    `${JSON.stringify(merged)}; ${mergedNotes.join(' | ')}`,
  );
  await settledShot(shoot, page, 'tool-json-to-code-03-samples.png');

  // §2.5: the Root type.
  await input.fill('{"id":1}');
  await page.locator('#json-to-code-root').fill('user profile');
  const named = await until(r => r.startsWith('export interface UserProfile'));
  check(
    'JSON to Code: §2.5 Root type "user profile" → UserProfile',
    named.startsWith('export interface UserProfile {'),
  );
  await page.locator('#json-to-code-root').fill('');

  // §2.6: an identifier beyond i64.
  await input.fill('{"id":12345678901234567890}');
  await language('Rust');
  const rust = await until(r => r.includes('u64'));
  await language('Go');
  const goBig = await until(r => r.includes('uint64'));
  check(
    'JSON to Code: §2.6 12345678901234567890 is u64 in Rust, uint64 in Go',
    rust.includes('    pub id: u64,\n') && goBig.includes('\tID uint64 `json:"id"`\n'),
    `${JSON.stringify(rust)}; ${JSON.stringify(goBig)}`,
  );
  await language('TypeScript');

  // §2.7: an error; pressing its line puts the caret on the place.
  await input.fill('{\n  "a": 1,\n  "b": \n}');
  await status.filter({ hasText: 'Line 4' }).waitFor();
  const error = await said();
  await page.getByRole('button', { name: 'Line 4, column 1: unexpected "}"', exact: true }).click();
  const caret = await page.evaluate(() => {
    const el = document.querySelector('#json-to-code-input');
    return { focused: document.activeElement === el, start: el.selectionStart };
  });
  check(
    'JSON to Code: §2.7 the error says where, the result is empty, Copy is off; pressing it puts the caret there',
    error === 'Line 4, column 1: unexpected "}"' &&
      caret.focused &&
      caret.start === 20 &&
      (await result()) === '' &&
      (await page.getByRole('button', { name: 'Copy', exact: true }).isDisabled()),
    `${error}; ${JSON.stringify(caret)}`,
  );
  await settledShot(shoot, page, 'tool-json-to-code-04-error.png');

  // Copy (the page's clipboard stubbed): the whole result; the Copy is in the history at once.
  await input.fill('{"user":{"id":1},"owner":{"user":{"name":"x"}}}');
  await page.locator('#json-to-code-root').fill('account');
  await language('Python');
  const python = await until(r => r.includes('class Account'));
  const clipboard = await stubClipboard(page);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  const copied = await clipboard.copied();
  await clipboard.restore();
  const record = await waitForHistoryRecord(
    page,
    'json-to-code',
    r => r.kind === 'result' && r.label === 'Python · account · copied',
  ).catch(() => null);
  check(
    'JSON to Code: Copy copies the whole result; the Copy is recorded in clear with the sample, the options and the result',
    copied.length === 1 &&
      copied[0] === python &&
      python.startsWith('from typing import TypedDict\n\n\nclass User(TypedDict):') &&
      record !== null &&
      !record.sealed &&
      record.payload?.language === 'python' &&
      record.payload?.rootName === 'account',
    `copied ${JSON.stringify(copied[0]?.slice(0, 60))}; record ${record?.label} ${JSON.stringify(record?.payload)}`,
  );
  await page.locator('#json-to-code-root').fill('');
  await language('TypeScript');

  // §6: 10,000 levels — a worded error at the 1 001st bracket, no page error.
  const setValue = async text =>
    page.evaluate(async value => {
      const field = document.querySelector('#json-to-code-input');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      return document.querySelector('[data-part="status"]').textContent.trim();
    }, text);
  const deep = await setValue(`${'['.repeat(10_000)}${']'.repeat(10_000)}`);
  const limit = await setValue(`${'{"a":'.repeat(1000)}1${'}'.repeat(1000)}`);
  const limitTypes = (await result()).match(/^export interface A\d*/gm)?.length ?? 0;
  check(
    'JSON to Code: 10,000 levels are a worded error, no page error; 1,000 levels give 999 interfaces',
    deep === 'Line 1, column 1001: nesting deeper than 1000 levels' &&
      limit === '' &&
      limitTypes === 999 &&
      pageErrors.length === 0,
    `${deep}; 1,000 levels: ${limitTypes} interfaces; page errors ${pageErrors.length}`,
  );

  // §12: up to 1 MiB the result follows every change on the page — the largest live input timed from the value set to
  // the result painted, with the page's longest task meanwhile; and the text box alone (the same text, no JSON).
  const timed = text =>
    page.evaluate(async value => {
      const field = document.querySelector('#json-to-code-input');
      const output = document.querySelector('#json-to-code-output');
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      let longest = 0;
      const observer = new PerformanceObserver(list => {
        for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
      });
      observer.observe({ type: 'longtask', buffered: false });
      const before = output.value;
      const start = performance.now();
      setter.call(field, value);
      field.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      while (output.value === before && performance.now() - start < 10_000)
        await new Promise(r => requestAnimationFrame(r));
      const elapsed = performance.now() - start;
      await new Promise(r => setTimeout(r, 100));
      observer.disconnect();
      return { elapsed: Math.round(elapsed), longest: Math.round(longest), chars: value.length };
    }, text);
  await setValue('');
  const live = await timed(records(MiB));
  const liveStatus = await said();
  const liveResult = await result();
  // The text box's own cost: a text of the same size that is not JSON (an error at once, nothing to generate).
  await setValue('');
  const box = await page.evaluate(async chars => {
    const field = document.querySelector('#json-to-code-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const start = performance.now();
    setter.call(field, `x${' '.repeat(chars - 1)}`);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, live.chars);
  report.jsonToCode = { live1MiB: live, textBox1MiB: box };
  check(
    'JSON to Code: §12 the largest live input (1 MiB) is generated as it changes',
    liveStatus === '' && liveResult.includes('export interface Owner {') && live.chars <= MiB,
    `${live.chars} characters → result painted in ${live.elapsed} ms (the text box alone ${box} ms), longest task ${live.longest} ms`,
  );

  // §12: above 1 MiB the result waits for Generate (or Ctrl+Enter), made in the tool's worker; 16 MiB timed, with the
  // page's longest task meanwhile, apart from setting the text.
  await setValue('');
  const large = records(16 * MiB - 64);
  const setLarge = await page.evaluate(async value => {
    const field = document.querySelector('#json-to-code-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    const start = performance.now();
    setter.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    return Math.round(performance.now() - start);
  }, large);
  const waiting = await said();
  const generateVisible = await page.getByRole('button', { name: 'Generate', exact: true }).isVisible();
  const generated = await page.evaluate(async () => {
    let longest = 0;
    let frames = 0;
    const observer = new PerformanceObserver(list => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    observer.observe({ type: 'longtask', buffered: false });
    const button = [...document.querySelectorAll('button')].find(b => b.textContent === 'Generate');
    const output = document.querySelector('#json-to-code-output');
    const start = performance.now();
    button.click();
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const working = [...document.querySelectorAll('button')].some(b => b.textContent === 'Working…' && b.disabled);
    while (output.value === '' && performance.now() - start < 30_000) {
      frames++;
      await new Promise(r => requestAnimationFrame(r));
    }
    const elapsed = performance.now() - start;
    await new Promise(r => setTimeout(r, 100));
    observer.disconnect();
    return { elapsed: Math.round(elapsed), longest: Math.round(longest), frames, working };
  });
  const workers = page.workers().map(w => w.url());
  const largeResult = await result();
  report.jsonToCode = { ...report.jsonToCode, set16MiB: setLarge, generate16MiB: generated, workers };
  check(
    'JSON to Code: §12 16 MiB waits for Generate; Generate works in the tool’s worker (Working… meanwhile) without holding the page',
    waiting === 'Large input: press Generate (Ctrl+Enter).' &&
      generateVisible &&
      generated.working &&
      largeResult.includes('export interface RootItem {') &&
      workers.some(u => u.includes('json-to-code.worker')) &&
      generated.longest < 200,
    `${large.length} characters: set in ${setLarge} ms; Generate → result ${generated.elapsed} ms, ${generated.frames} frames, longest task ${generated.longest} ms; workers ${workers.join(', ')}`,
  );
  await settledShot(shoot, page, 'tool-json-to-code-05-large.png');
  // One character more than MAX_INPUT is refused in words.
  const refused = await setValue(`${' '.repeat(16 * MiB)}{}`);
  check(
    'JSON to Code: §6 more than 16 MiB is refused in words',
    refused === 'Input is larger than 16 MB; paste a smaller sample.',
    refused,
  );
  await setValue('');

  // History: an edit is kept; the Copy's record opens back into the tool with the sample and every option.
  await page.goto(`${base}#/tools`);
  await page.goto(`${base}#/tools/json-to-code`);
  await input.waitFor({ timeout: 15_000 });
  await page.getByText('Recent entries').click();
  await page.locator('.kit-history-entry').first().waitFor();
  await page
    .locator('.kit-history-entry')
    .filter({ hasText: 'Python · account · copied' })
    .first()
    .getByRole('button', { name: 'Open' })
    .click();
  await page.getByText('Opened from History: Python · account · copied.').waitFor();
  const reopened = await until(r => r.includes('class Account'));
  check(
    'JSON to Code: the Copy’s record opens back into the tool — the sample, Python, the Root type, the result',
    (await input.inputValue()) === '{"user":{"id":1},"owner":{"user":{"name":"x"}}}' &&
      (await page.locator('#json-to-code-root').inputValue()) === 'account' &&
      (await page.locator('#json-to-code-language').innerText()).includes('Python') &&
      reopened === python,
    JSON.stringify(reopened.slice(0, 80)),
  );
  await settledShot(shoot, page, 'tool-json-to-code-06-reopened.png');
  await page.locator('#json-to-code-root').fill('');
  await language('TypeScript');

  // The page in the dark theme, then back.
  await input.fill('[{"id":1,"email":"a@x","tags":["a"]},{"id":2,"email":null,"phone":"1"}]');
  await until(r => r.includes('phone'));
  const mode = await inDarkTheme(ctx, base, page, async () => {
    await page.locator('#json-to-code-input').waitFor();
    await settledShot(shoot, page, 'tool-json-to-code-07-dark.png');
    await language('Rust');
    await until(r => r.startsWith('use serde'));
    await settledShot(shoot, page, 'tool-json-to-code-08-dark-rust.png');
    await page.locator('#json-to-code-input').fill('{\n  "a": 1\n  "b": 2\n}');
    await status.filter({ hasText: 'Line 3' }).waitFor();
    await settledShot(shoot, page, 'tool-json-to-code-09-dark-error.png');
    await language('TypeScript');
    return page.evaluate(() => document.documentElement.dataset.mode);
  });
  const after = await page.evaluate(() => document.documentElement.dataset.mode);
  check('JSON to Code: the page in the dark theme and back', mode === 'dark' && after !== 'dark', `${mode} → ${after}`);
  await page.locator('#json-to-code-input').fill('');
  check('JSON to Code: no page error', pageErrors.length === 0, pageErrors.join(' | '));
  page.off('pageerror', onError);
};
