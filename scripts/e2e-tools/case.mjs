// The Case Converter in the built extension (docs/tools/specs/case.md): its scenarios (§2) the way a person does them —
// the page's real controls; Copy goes to the page's own stubbed clipboard, never the machine's. Then every example of
// the specification's §10 converted by Chrome under a Turkish locale and compared with the tool's logic run by Node
// (the same answers whatever the locale, §5.3), the keyboard order (§8), the limits timed in the browser (§12), an
// entry opened back from the tool's own history (D17), and the page in the light and the dark theme. Run by
// scripts/e2e-tools.mjs.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');

/** Every input of the specification's §10 and a few of §5: Chrome must answer exactly what the logic does in Node. */
const INPUTS = [
  'HTTPServer',
  'parseURL2',
  'parseURL2Name',
  'XMLHttpRequest',
  'getID',
  'ABCdef',
  'iOS',
  'base64Encode',
  'sha256_hash',
  'A1B2',
  'x1Y',
  '2fa_code',
  'version_1_2',
  'some_mixed-Case.input',
  'foo.bar/baz',
  'file_name.txt',
  '__proto__',
  '  hello   world  ',
  'fooBar\tbaz',
  "don't stop",
  'it’s fine',
  "O'Neil",
  "rock 'n' roll",
  'the lord of the rings',
  'a tale of two cities',
  'what is it for',
  'use the HTTP API',
  'HTTP_SERVER',
  'THIS OR THAT',
  'use AND gate',
  'ABC',
  'привет мир',
  'ÉCOLE élève',
  'école',
  'naïve café',
  'ΟΔΟΣ ΣΟΦΟΣ',
  'ΟΣ',
  '变量Name',
  'hello 👋 world',
  'x²y',
  'Straße',
  'ßa',
  'İstanbul',
  'TITLE',
  'İI',
  'istanbul ILIK',
  'ﬁle name',
  'ǅemal',
  'DE-ÜBER',
  'a\uD800b',
  '---',
  '',
  ' ',
  'fooBar\r\nbaz_qux\n\n  HTTPServer\n',
  'fooBar\n  x-y\n',
  '𐐨𐐀 a𐐀b 𠀀Name',
  'caféBar HTTPÉcole',
];

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  // The logic itself, run by Node (logic.ts imports nothing and is erasable syntax, so Node runs the file as it is).
  const logic = await import(pathToFileURL(join(ROOT, 'packages/tools/logic/case/src/logic.ts')).href);
  const FORMS = logic.CASE_FORMS;

  // Every move replaces the tab's history entry: Chrome keeps at most 50, and a later module counts entries (Text Diff
  // checks that opening it adds exactly one), so this module adds none.
  const go = async hash => {
    if (page.url().startsWith(base)) await page.evaluate(h => location.replace(h), hash);
    else await page.goto(`${base}${hash}`);
  };
  await go('#/tools/case');
  const text = page.getByLabel('Text', { exact: true });
  await text.waitFor();
  const clipboard = await stubClipboard(page);
  const cdp = await page.context().newCDPSession(page);
  const result = label => page.getByLabel(label, { exact: true });
  const copy = label => page.getByRole('button', { name: `Copy ${label}`, exact: true });
  const copied = label => page.getByRole('button', { name: `Copied ${label}`, exact: true });
  const hint = page.locator('[data-part="hint"]');
  const all = () => Promise.all(FORMS.map(f => result(f.label).inputValue()));

  try {
    // Empty state (§8): the names of the forms in the order of §4, all fields empty, every Copy off.
    const names = await page.locator('[data-form] label').allInnerTexts();
    const values = await all();
    const disabled = await Promise.all(FORMS.map(f => copy(f.label).isDisabled()));
    check(
      'Case Converter: opens empty — the hint, 13 named empty fields in the order of §4, every Copy off',
      names.join('|') === FORMS.map(f => f.label).join('|') &&
        values.every(v => v === '') &&
        disabled.every(Boolean) &&
        (await text.getAttribute('placeholder')) === 'Paste names or text, one per line' &&
        (await hint.innerText()).trim() ===
          'Each line is converted on its own. Words split at spaces, punctuation, _ - . / and at case changes.',
      names.join('|'),
    );
    await settledShot(shoot, page, 'tool-case-01-empty-light.png');

    // §2.1: user_id, and Copy at camelCase.
    await text.fill('user_id');
    await copy('camelCase').click();
    await copied('camelCase').waitFor({ timeout: 2_000 });
    const taken = await clipboard.copied();
    check(
      'Case Converter: §2.1 user_id → userId / UserId / USER_ID, Copy takes camelCase',
      (await result('camelCase').inputValue()) === 'userId' &&
        (await result('PascalCase').inputValue()) === 'UserId' &&
        (await result('CONSTANT_CASE').inputValue()) === 'USER_ID' &&
        taken.at(-1) === 'userId' &&
        (await copied('camelCase').innerText()) === 'Copied',
      JSON.stringify(taken),
    );

    // §2.2: a Java class name.
    await text.fill('XMLHttpRequest');
    check(
      'Case Converter: §2.2 XMLHttpRequest → xml_http_request / xml-http-request / XML Http Request',
      (await result('snake_case').inputValue()) === 'xml_http_request' &&
        (await result('kebab-case').inputValue()) === 'xml-http-request' &&
        (await result('Title Case').inputValue()) === 'XML Http Request',
    );

    // §2.3: three lines; Copy copies all three with the line breaks of the result. Another Copy takes "Copied" off.
    await text.fill('firstName\nlast_name\ndate-of-birth');
    await copy('snake_case').click();
    await copied('snake_case').waitFor({ timeout: 2_000 });
    await copy('kebab-case').click();
    await copied('kebab-case').waitFor({ timeout: 2_000 });
    const lines = await clipboard.copied();
    check(
      'Case Converter: §2.3 three lines convert line by line; Copy takes them all; one Copied at a time',
      (await result('snake_case').inputValue()) === 'first_name\nlast_name\ndate_of_birth' &&
        lines.at(-2) === 'first_name\nlast_name\ndate_of_birth' &&
        lines.at(-1) === 'first-name\nlast-name\ndate-of-birth' &&
        (await copy('snake_case').innerText()) === 'Copy',
      JSON.stringify(lines.slice(-2)),
    );
    await settledShot(shoot, page, 'tool-case-02-lines-light.png');

    // §2.4–§2.7.
    await text.fill('Fix the login page for iOS users');
    const branch = await result('kebab-case').inputValue();
    await text.fill('a tale of two cities');
    const title = [await result('Title Case').inputValue(), await result('Sentence case').inputValue()];
    await text.fill('parseURL2');
    const digit = [await result('camelCase').inputValue(), await result('snake_case').inputValue()];
    await text.fill('---');
    const none = await all();
    const noneOff = await Promise.all(FORMS.slice(0, 11).map(f => copy(f.label).isDisabled()));
    check(
      'Case Converter: §2.4–§2.7 a branch name, a title, a digit with its word, no words at all',
      branch === 'fix-the-login-page-for-i-os-users' &&
        title.join('|') === 'A Tale of Two Cities|A tale of two cities' &&
        digit.join('|') === 'parseUrl2|parse_url2' &&
        none.slice(0, 11).every(v => v === '') &&
        noneOff.every(Boolean) &&
        none[11] === '---' &&
        none[12] === '---',
      JSON.stringify({ branch, title, digit, lower: none[11] }),
    );

    // §5.3: Chrome under a Turkish locale answers what the logic answers in Node, form by form.
    await cdp.send('Emulation.setLocaleOverride', { locale: 'tr-TR' });
    const turkish = await page.evaluate(() => [
      'TITLE'.toLocaleLowerCase(),
      new Intl.Collator().resolvedOptions().locale,
    ]);
    const answers = await page.evaluate(
      async ([inputs, ids]) => {
        const field = document.querySelector('#case-input');
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const out = [];
        for (const value of inputs) {
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
          // A textarea gives its line breaks back as \n (HTML's value normalisation): `input` is what it holds.
          out.push({
            input: field.value,
            ...Object.fromEntries(ids.map(id => [id, document.querySelector(`#case-${id}`).value])),
          });
        }
        return out;
      },
      [INPUTS, FORMS.map(f => f.id)],
    );
    await cdp.send('Emulation.setLocaleOverride', {});
    const differ = [];
    INPUTS.forEach((_, i) => {
      const input = answers[i].input;
      const expected = logic.convertAll(input);
      for (const f of FORMS)
        if (answers[i][f.id] !== expected[f.id])
          differ.push(`${JSON.stringify(input)} ${f.id}: Chrome ${JSON.stringify(answers[i][f.id])}`);
    });
    check(
      `Case Converter: §5.3 Chrome under tr-TR gives Node's answers for ${INPUTS.length} inputs × 13 forms`,
      turkish[0] === 'tıtle' && turkish[1].startsWith('tr') && differ.length === 0,
      `page locale ${turkish[1]}, 'TITLE'.toLocaleLowerCase() = ${turkish[0]}; ${differ.slice(0, 5).join('; ') || 'all equal'}`,
    );

    // §8: the keyboard — Tab passes the text, then each form's field and its Copy.
    await text.fill('HTTPServer');
    await text.focus();
    const order = [];
    for (let i = 0; i < FORMS.length * 2; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el.getAttribute('aria-label') || el.id;
        }),
      );
    }
    check(
      'Case Converter: §8 Tab goes through each form’s field and its Copy, in order',
      order.join('|') === FORMS.flatMap(f => [`case-${f.id}`, `Copy ${f.label}`]).join('|'),
      order.slice(0, 6).join(' → '),
    );

    // §12, timed in the browser: every edit up to 64 Ki, 300 ms after the last edit up to 512 Ki, above it a refusal
    // at once. `longest` is the longest task the page ran meanwhile.
    const timed = (value, expectLength) =>
      page.evaluate(
        async ([v, want]) => {
          const field = document.querySelector('#case-input');
          // The last form of §4: above 64 Ki the forms come one per frame, so it is the last to arrive.
          const out = document.querySelector('#case-upper');
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          const start = performance.now();
          setter.call(field, v);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          while (out.value.length !== want && performance.now() - start < 15_000)
            await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => setTimeout(r, 150));
          observer.disconnect();
          return { elapsed: Math.round(elapsed), longest: Math.round(longest), length: out.value.length };
        },
        [value, expectLength],
      );
    const sample = n => 'someVariableName42 HTTPServer_value-x 17\n'.repeat(Math.ceil(n / 41)).slice(0, n);
    const upperLength = n => logic.convertCase(sample(n), 'upper').length;
    await text.fill('');
    const live = await timed(sample(64 * 1024), upperLength(64 * 1024));
    await text.fill('');
    const max = await timed(sample(512 * 1024), upperLength(512 * 1024));
    // Typing at the end of the 512 Ki text: each key is answered, the forms follow after the pause.
    await text.focus();
    await page.keyboard.press('End');
    const typingStart = performance.now();
    await page.keyboard.type('abcd');
    const typing = Math.round(performance.now() - typingStart);
    await text.fill('');
    const refused = await timed(sample(512 * 1024 + 1), 0);
    const refusal = (await hint.innerText()).trim();
    check(
      'Case Converter: §12 64 Ki follows the edit at once; 512 Ki converts after the 300 ms pause, no task over 500 ms; one more refuses',
      live.length === upperLength(64 * 1024) &&
        live.elapsed < 300 &&
        max.length === upperLength(512 * 1024) &&
        max.elapsed >= 300 &&
        // The forms arrive one per frame: no task near the 755 ms that 13 fields at once took (measured).
        max.longest < 500 &&
        refusal === 'Text is larger than 512 KB. Case Converter works with up to 512 KB.' &&
        (await hint.getAttribute('role')) === 'status' &&
        refused.length === 0,
      `64 Ki ${live.elapsed} ms (longest task ${live.longest} ms); 512 Ki ${max.elapsed} ms (longest task ${max.longest} ms); 4 keys typed into 512 Ki in ${typing} ms; 512 Ki + 1 refused in ${refused.elapsed} ms (longest task ${refused.longest} ms)`,
    );
    await text.fill('');
    await sleep(100);

    // D17: a copied form is in the tool's own history and opens back into the tool.
    await text.fill('getUserID\nHTTP_SERVER');
    await copy('Train-Case').click();
    await copied('Train-Case').waitFor({ timeout: 2_000 });
    const record = await waitForHistoryRecord(
      page,
      'case',
      r => r.label === 'getUserID · 2 lines · copied Train-Case',
    ).catch(() => null);
    await go('#/start');
    await page.waitForFunction(() => location.hash === '#/start');
    await go('#/tools/case');
    await text.waitFor();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').waitFor({ timeout: 5_000 });
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: 'getUserID · 2 lines · copied Train-Case' }).first();
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5_000 })
      .catch(() => {});
    const back = {
      record: record?.kind ?? null,
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      text: await text.inputValue(),
      train: await result('Train-Case').inputValue(),
    };
    check(
      'Case Converter: a copied form is in the tool’s history as Converted and opens back into the tool',
      back.record === 'convert' &&
        back.listed > 0 &&
        back.kind === 'Converted' &&
        back.text === 'getUserID\nHTTP_SERVER' &&
        back.train === 'Get-User-Id\nHttp-Server',
      JSON.stringify(back),
    );

    // The page in the light and the dark theme (entered afresh: "Recent entries" closed).
    await go('#/start');
    await page.waitForFunction(() => location.hash === '#/start');
    await go('#/tools/case');
    await text.waitFor();
    await text.fill('XMLHttpRequest\nuse the HTTP API\nfirst_name');
    await settledShot(shoot, page, 'tool-case-03-forms-light.png');
    await inDarkTheme(ctx, base, page, async () => {
      await page.waitForFunction(() => document.documentElement.dataset.mode === 'dark', null, { timeout: 5_000 });
      await sleep(300);
      await settledShot(shoot, page, 'tool-case-04-forms-dark.png');
      await text.fill('x'.repeat(512 * 1024 + 1));
      await settledShot(shoot, page, 'tool-case-05-too-large-dark.png');
    });
    await text.fill('');
  } finally {
    await cdp.send('Emulation.setLocaleOverride', {}).catch(() => {});
    await cdp.detach().catch(() => {});
    await clipboard.restore().catch(() => {});
  }
};
