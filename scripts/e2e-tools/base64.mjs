// The Base64 tool in the built extension (docs/tools/specs/base64.md): its scenarios (§2) the way a person does them —
// the page's real controls; the copy goes to the test browser's own clipboard (CDP grants the read, as the compare
// checks do), never the system's. Then the keyboard order (§8), the limits timed in the browser (§12), pasting Base64
// into the start page's field (§7), an entry opened back from the tool's own history (D17), and the page in the light
// and the dark theme. Run by scripts/e2e-tools.mjs.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { forgetSavedParameters } from '../e2e-helpers.mjs';
import { themeMode, withSettings } from '../e2e-theme.mjs';

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  // Node's URL gives chrome-extension: URLs an opaque origin; the scheme and host are the origin Chrome means.
  const origin = `chrome-extension://${new URL(base).host}`;
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });

  await page.goto(`${base}#/tools/base64`);
  const input = page.getByLabel('Input');
  const result = page.getByLabel('Result');
  await input.waitFor();
  const errorLine = page.locator('[data-part="error"]');
  const notes = page.locator('[data-part="note"]');
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };

  // Empty state (§8).
  check(
    'Base64: opens empty in Encode, Copy and Swap off',
    (await radio('Encode').getAttribute('aria-checked')) === 'true' &&
      (await input.inputValue()) === '' &&
      (await input.getAttribute('placeholder')) === 'Text to encode' &&
      (await button('Copy').isDisabled()) &&
      (await button('Swap').isDisabled()),
  );

  // §2.2: Encode Cyrillic, Copy.
  await input.fill('Привет');
  const encoded = await result.inputValue();
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  const copied = await page.evaluate(() => navigator.clipboard.readText());
  check(
    'Base64: §2.2 encode "Привет" as UTF-8 and copy it',
    encoded === '0J/RgNC40LLQtdGC' && copied === encoded,
    JSON.stringify({ encoded, copied }),
  );

  // §2.3: URL-safe turns padding off by itself.
  await input.fill('subjects?_d');
  const standard = await result.inputValue();
  await choose('Alphabet', 'URL-safe');
  const urlSafe = await result.inputValue();
  check(
    'Base64: §2.3 URL-safe switches padding off — c3ViamVjdHM_X2Q',
    standard === 'c3ViamVjdHM/X2Q=' &&
      urlSafe === 'c3ViamVjdHM_X2Q' &&
      (await page.getByLabel('Padding').getAttribute('aria-checked')) === 'false',
    JSON.stringify({ standard, urlSafe }),
  );
  await choose('Line length', '64');
  await input.fill('a'.repeat(60));
  const wrapped = await result.inputValue();
  check(
    'Base64: line length 64 wraps with \\n',
    wrapped === `${'YWFh'.repeat(16)}\n${'YWFh'.repeat(4)}`,
    JSON.stringify(wrapped),
  );
  await shoot(page, 'tool-base64-01-encode-light.png');
  await choose('Line length', 'No wrapping');
  await choose('Alphabet', 'Standard');

  // §2.1: Decode Basic credentials.
  await radio('Decode').click();
  await input.fill('YWRtaW46c2VjcmV0');
  check(
    'Base64: §2.1 decode the Basic credentials — admin:secret',
    (await result.inputValue()) === 'admin:secret' &&
      (await input.getAttribute('placeholder')) === 'Base64 to decode' &&
      (await page.getByText('Accepts standard and URL-safe alphabets, with or without padding.').isVisible()) &&
      (await page.getByLabel('Alphabet', { exact: true }).count()) === 0,
  );

  // §2.4: a PEM-like block over several lines.
  await input.fill('SGVsbG8s\nIFdvcmxk\r\n  IQ==\n');
  check('Base64: §2.4 decode across lines and spaces', (await result.inputValue()) === 'Hello, World!');

  // §2.5: not text → hex and a note.
  await input.fill('//79');
  const hexNote = (await notes.allInnerTexts()).join('|').trim();
  check(
    'Base64: §2.5 bytes that are not UTF-8 show as hex with a note, Swap off',
    (await result.inputValue()) === 'ff fe fd' &&
      hexNote === 'Not UTF-8 text: showing 3 bytes as hex.' &&
      (await button('Swap').isDisabled()),
    hexNote,
  );
  await shoot(page, 'tool-base64-02-decode-hex-light.png');

  // §2.6: a typo with its place.
  await input.fill('Zm9v!');
  const typo = (await errorLine.innerText()).trim();
  check(
    'Base64: §2.6 a typo is named with its place, result empty',
    typo === 'Line 1, column 5: invalid character "!"' && (await result.inputValue()) === '',
    typo,
  );
  await shoot(page, 'tool-base64-03-decode-error-light.png');

  // §2.7: Swap.
  await radio('Encode').click();
  await input.fill('Привет, 😀');
  const there = await result.inputValue();
  await button('Swap').click();
  const swapped =
    (await input.inputValue()) === there &&
    (await radio('Decode').getAttribute('aria-checked')) === 'true' &&
    (await result.inputValue()) === 'Привет, 😀';
  check('Base64: §2.7 Swap moves the result into the input and turns to Decode', swapped, there);

  // §8: the keyboard — Tab passes direction, options, Swap, input, Copy, result; arrows switch the direction.
  await radio('Encode').click();
  await input.fill('keyboard');
  await radio('Encode').focus();
  const order = [];
  for (let i = 0; i < 7; i++) {
    await page.keyboard.press('Tab');
    order.push(
      await page.evaluate(() => {
        const el = document.activeElement;
        return el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20);
      }),
    );
  }
  // The kit's ToggleGroup (Radix): the arrows move between the items, Space chooses the focused one.
  await radio('Encode').focus();
  await page.keyboard.press('ArrowRight');
  await sleep(100); // Radix moves the focus on the next task
  const onDecode = await radio('Decode').evaluate(el => el === document.activeElement);
  await page.keyboard.press('Space');
  const arrowed = onDecode && (await radio('Decode').getAttribute('aria-checked')) === 'true';
  check(
    'Base64: §8 Tab order is direction, Alphabet, Padding, Line length, Swap, Input, Copy, Result; arrows and Space switch',
    order.join(' → ') === 'Alphabet → Padding → Line length → Swap → Input → Copy → Result' && arrowed,
    `${order.join(' → ')}; arrow to Decode ${onDecode}, Space chose it ${arrowed}`,
  );

  // §12: the limits, timed in the browser. The result follows every edit up to 256 Ki, then 300 ms after the last
  // edit; above 5 Mi the tool refuses at once. `longest` is the longest task the page ran meanwhile.
  const timed = (text, expectLength) =>
    page.evaluate(
      async ([value, want]) => {
        const field = document.querySelector('#base64-input');
        const out = document.querySelector('#base64-output');
        let longest = 0;
        const observer = new PerformanceObserver(list => {
          for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
        });
        observer.observe({ type: 'longtask', buffered: false });
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        const start = performance.now();
        setter.call(field, value);
        field.dispatchEvent(new Event('input', { bubbles: true }));
        while (out.value.length !== want && performance.now() - start < 15_000)
          await new Promise(r => requestAnimationFrame(r));
        const elapsed = performance.now() - start;
        await new Promise(r => setTimeout(r, 100));
        observer.disconnect();
        return { elapsed: Math.round(elapsed), longest: Math.round(longest), length: out.value.length };
      },
      [text, expectLength],
    );
  await radio('Encode').click();
  await input.fill('');
  const liveRun = await timed('Lorem ipsum dolor '.repeat(14_564).slice(0, 262_144), Math.ceil(262_144 / 3) * 4);
  const big = 'QUFB'.repeat((5 * 1024 * 1024) / 4);
  await input.fill('');
  await radio('Decode').click();
  const decodeMax = await timed(big, (big.length / 4) * 3);
  // The largest result: 5 Mi of Base64 that is not text, shown as hex (3 932 160 bytes, 11 796 479 characters).
  await input.fill('');
  const hexMax = await timed('/'.repeat(5 * 1024 * 1024), 3 * 3_932_160 - 1);
  // Typing at the end of the 5 Mi input: each key is answered (the textarea keeps up), the result comes after the pause.
  await input.focus();
  await page.keyboard.press('End');
  const typingStart = performance.now();
  await page.keyboard.type('QUFB');
  const typing = Math.round(performance.now() - typingStart);
  await input.fill('');
  await radio('Encode').click();
  const encodeMax = await timed('Lorem ipsum dolor '.repeat(291_272).slice(0, 5 * 1024 * 1024), 6_990_508);
  const refused = await timed(`${big}Q`, 0);
  const refusal = (await errorLine.innerText()).trim();
  check(
    'Base64: §12 256 Ki follows the edit at once; 5 Mi decodes (text and hex) and encodes after the 300 ms pause; one more refuses',
    liveRun.length === Math.ceil(262_144 / 3) * 4 &&
      liveRun.elapsed < 300 &&
      decodeMax.length === (big.length / 4) * 3 &&
      hexMax.length === 3 * 3_932_160 - 1 &&
      encodeMax.length === 6_990_508 &&
      refusal === 'Input is larger than 5 MB. This tool works with up to 5 MB.' &&
      refused.length === 0,
    `256 Ki encode ${liveRun.elapsed} ms (longest task ${liveRun.longest} ms); 5 Mi decode ${decodeMax.elapsed} ms (longest task ${decodeMax.longest} ms); 5 Mi to hex ${hexMax.elapsed} ms (longest task ${hexMax.longest} ms); 5 Mi encode ${encodeMax.elapsed} ms (longest task ${encodeMax.longest} ms); 5 Mi + 1 refused in ${refused.elapsed} ms; 4 keys typed into the 5 Mi input in ${typing} ms`,
  );
  await input.fill('');

  // §7: Base64 of text pasted into the start page's field opens this tool in Decode; ordinary words do not.
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
  await paste('SGVsbG8sIFdvcmxkIQ==');
  await page.waitForFunction(() => location.hash === '#/tools/base64', null, { timeout: 5_000 }).catch(() => {});
  await input.waitFor({ timeout: 5_000 }).catch(() => {});
  const opened = {
    hash: await page.evaluate(() => location.hash),
    input: await input.inputValue().catch(() => null),
    decode: await radio('Decode')
      .getAttribute('aria-checked')
      .catch(() => null),
    result: await result.inputValue().catch(() => null),
  };
  check(
    'Base64: §7 pasting Base64 of text into the start page opens the tool in Decode with it',
    opened.hash === '#/tools/base64' &&
      opened.input === 'SGVsbG8sIFdvcmxkIQ==' &&
      opened.decode === 'true' &&
      opened.result === 'Hello, World!',
    JSON.stringify(opened),
  );
  const notOurs = [];
  for (const text of ['password', '550e8400-e29b-41d4-a716-446655440000', '1700000000', 'deadbeef']) {
    await paste(text);
    await sleep(300);
    if ((await page.evaluate(() => location.hash)) === '#/tools/base64') notOurs.push(text);
  }
  check('Base64: §7 a word, a UUID, a Unix time, hex do not open it', notOurs.length === 0, notOurs.join(', '));

  // D17: what was taken (Copy) is in the tool's own history and opens back into the tool.
  await page.goto(`${base}#/tools/base64`);
  await input.waitFor();
  await radio('Decode').click();
  await input.fill('YWRtaW46c2VjcmV0');
  await button('Copy').click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2_000 });
  await page.goto(`${base}#/start`);
  await page.goto(`${base}#/tools/base64`);
  await input.waitFor();
  const recent = page.locator('.kit-tool-history-recent');
  await recent.locator('summary').waitFor({ timeout: 5_000 });
  await recent.locator('summary').click();
  const entry = recent.locator('.kit-history-entry', { hasText: 'Decode · 16 characters · copied' }).first();
  const listed = await entry.count();
  if (listed) await entry.getByRole('button', { name: 'Open' }).click();
  await page
    .locator('[data-restored]')
    .waitFor({ timeout: 5_000 })
    .catch(() => {});
  const back = {
    listed,
    kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
    input: await input.inputValue(),
    decode: await radio('Decode').getAttribute('aria-checked'),
    result: await result.inputValue(),
  };
  check(
    'Base64: a copied result is in the tool’s history as Decoded and opens back into the tool',
    back.listed > 0 &&
      back.kind === 'Decoded' &&
      back.input === 'YWRtaW46c2VjcmV0' &&
      back.decode === 'true' &&
      back.result === 'admin:secret',
    JSON.stringify(back),
  );

  // The page in the light and the dark theme (entered afresh: "Recent entries" closed), then the theme mode as it was.
  await page.goto(`${base}#/start`);
  await page.goto(`${base}#/tools/base64`);
  await input.waitFor();
  const modeBefore = await withSettings(ctx, base, settings =>
    settings.getByRole('radiogroup', { name: 'Theme mode' }).locator('[role="radio"][aria-checked="true"]').innerText(),
  );
  await radio('Encode').click();
  await input.fill('Привет, 😀 subjects?_d');
  await shoot(page, 'tool-base64-04-encode-light.png');
  await themeMode(ctx, base, 'Dark');
  await page.waitForFunction(() => document.documentElement.dataset.theme?.endsWith('dark'), null, {
    timeout: 5_000,
  });
  await sleep(300);
  await shoot(page, 'tool-base64-05-encode-dark.png');
  await radio('Decode').click();
  await input.fill('77u/YQ==');
  const bomNote = (await notes.allInnerTexts()).join('|').trim();
  check('Base64: a byte order mark is kept and noted', bomNote === 'Starts with a byte order mark (U+FEFF).', bomNote);
  await input.fill('Zm9v\n😀');
  await shoot(page, 'tool-base64-06-decode-error-dark.png');
  await themeMode(ctx, base, modeBefore.trim());
  await input.fill('');
  // The direction and options it chose are saved parameters (D21): the next module opens Base64 with its defaults.
  await forgetSavedParameters(page, 'base64');
  await cdp.detach();
};
