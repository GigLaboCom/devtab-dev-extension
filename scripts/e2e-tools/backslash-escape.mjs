// The String Escape tool in the built extension (docs/tools/specs/backslash-escape.md): its scenarios (§2) the way a
// person does them — the page's real controls — then the notes (§8), the keyboard order, the limits timed in the browser
// (§12: the page answers up to 1 Mi, the worker above it), pasting escaped text into the start page's field next to
// other tools' inputs (§7), a copied result opened back from the tool's own history (D17), and the page in the light and
// the dark theme. The clipboard is the page's own stand-in for the length of this module (scripts/e2e-helpers.mjs), put
// back at the end, also when a check throws. Navigation replaces the tab's current entry (Chrome keeps 50 per tab and the
// modules share one), so this module adds at most the start page's own moves to the tool, which it goes back over.
// Screenshots: tool-backslash-escape-NN-….png, light then dark.

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'String Escape';
const MI = 1024 * 1024;

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const go = async hash => {
    // The first move onto the extension's page (from a blank tab when this module runs alone) is a normal one.
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5_000 });
  };
  // The page's clipboard stand-in; a reload drops it, so `fresh` puts it back.
  let clipboard = null;
  /** The tool afresh: the page reloaded, so every choice is back to its default. */
  const fresh = async () => {
    await go('#/tools/backslash-escape');
    await page.reload();
    await page.getByLabel('Input', { exact: true }).waitFor();
    clipboard = await stubClipboard(page);
  };
  const input = page.getByLabel('Input', { exact: true });
  const result = page.getByLabel('Result', { exact: true });
  const frame = page.locator('[data-slot="tool-page"]');
  const errorLine = async () => (await page.locator('[data-part="error"]').innerText()).trim();
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(n => n.trim()).filter(Boolean);
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const checkbox = name => page.getByRole('checkbox', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };

  try {
    await fresh();
    // §8: the empty state.
    check(
      `${T}: opens empty — Escape, JSON, both checkboxes off, Copy and Swap off, no messages`,
      (await radio('Escape').getAttribute('aria-checked')) === 'true' &&
        (await page.getByRole('combobox', { name: 'Dialect', exact: true }).innerText()).trim() === 'JSON' &&
        (await page.getByRole('combobox', { name: 'Quote', exact: true }).count()) === 0 &&
        (await checkbox('Escape non-ASCII').getAttribute('aria-checked')) === 'false' &&
        (await checkbox('With quotes').getAttribute('aria-checked')) === 'false' &&
        (await input.getAttribute('placeholder')) === 'Text to escape' &&
        (await button('Copy').isDisabled()) &&
        (await button('Swap').isDisabled()) &&
        (await errorLine()) === '' &&
        (await notes()).length === 0,
    );
    await settledShot(shoot, frame, 'tool-backslash-escape-01-empty-light.png');

    // §2.1: a JSON log line, unescaped twice with Swap between.
    await radio('Unescape').click();
    await input.fill('Request failed:\\n\\t{\\"code\\": 42, \\"msg\\": \\"caf\\\\u00e9\\"}');
    const once = await result.inputValue();
    await button('Swap').click();
    await radio('Unescape').click();
    const twice = await result.inputValue();
    check(
      `${T}: §2.1 a JSON log line unescapes into two lines; Swap and Unescape again reads café`,
      once === 'Request failed:\n\t{"code": 42, "msg": "caf\\u00e9"}' &&
        twice === 'Request failed:\n\t{"code": 42, "msg": "café"}' &&
        (await input.getAttribute('placeholder')) === 'Text with \\n, \\" and other escapes',
      JSON.stringify({ once, twice }),
    );
    await settledShot(shoot, frame, 'tool-backslash-escape-02-unescape-json-light.png');

    // §2.2: SQL into a JavaScript string in ' quotes, with quotes; Copy.
    await fresh();
    await choose('Dialect', 'JavaScript');
    await choose('Quote', 'Single quote');
    await checkbox('With quotes').click();
    await input.fill("SELECT *\nFROM t\nWHERE name = 'x'");
    const sql = await result.inputValue();
    await button('Copy').click();
    await button('Copied').waitFor({ timeout: 2_000 });
    const copied = (await clipboard.copied()).at(-1);
    check(
      `${T}: §2.2 SQL into a JavaScript string in ' quotes — one line, copied whole`,
      sql === "'SELECT *\\nFROM t\\nWHERE name = \\'x\\''" && copied === sql,
      JSON.stringify({ sql, copied }),
    );
    await settledShot(shoot, frame, 'tool-backslash-escape-03-escape-js-light.png');
    const record = await waitForHistoryRecord(page, 'backslash-escape', r => r.payload?.action === 'copy').catch(
      () => null,
    );
    check(
      `${T}: Copy is a history record (commit) with the choices`,
      record?.kind === 'escape' &&
        record?.label === 'Escape · JavaScript · single quotes · with quotes · 32 characters · copied' &&
        record?.payload?.dialect === 'js' &&
        record?.payload?.quote === "'",
      record?.label,
    );

    // §8: the keyboard — Tab passes mode, dialect, quote, the checkboxes, Swap, input, Copy, result.
    await radio('Escape').focus();
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return (
            el.labels?.[0]?.textContent ||
            el.getAttribute('aria-label') ||
            document.querySelector(`label[for="${el.id}"]`)?.textContent ||
            el.textContent.trim().slice(0, 20)
          );
        }),
      );
    }
    await radio('Escape').focus();
    await page.keyboard.press('ArrowRight');
    await sleep(100);
    await page.keyboard.press('Space');
    const arrowed = (await radio('Unescape').getAttribute('aria-checked')) === 'true';
    check(
      `${T}: §8 Tab order is mode, Dialect, Quote, Escape non-ASCII, With quotes, Swap, Input, Copy, Result; arrows and Space switch the mode`,
      // The copy button still says Copied: the result was just copied.
      order.join(' → ') === 'Dialect → Quote → Escape non-ASCII → With quotes → Swap → Input → Copied → Result' &&
        arrowed,
      `${order.join(' → ')}; arrows ${arrowed}`,
    );

    // §2.3: a Windows path for Python.
    await fresh();
    await choose('Dialect', 'Python');
    await input.fill('C:\\temp\\new');
    const path = await result.inputValue();
    check(`${T}: §2.3 a Windows path for Python — C:\\\\temp\\\\new`, path === 'C:\\\\temp\\\\new', path);

    // §2.4: \x41 in JSON — an error with its place and a hint; JavaScript reads A.
    await radio('Unescape').click();
    await choose('Dialect', 'JSON');
    await input.fill('He said:\n\\x41');
    const hint = await errorLine();
    const emptyOnError = (await result.inputValue()) === '' && (await button('Copy').isDisabled());
    await settledShot(shoot, frame, 'tool-backslash-escape-04-error-hint-light.png');
    await choose('Dialect', 'JavaScript');
    check(
      `${T}: §2.4 \\x41 in JSON is an error with its line and column and the dialects that know it; JavaScript reads A`,
      hint === 'Line 2, column 1: unknown escape "\\x" in JSON. It is an escape in JavaScript, Python, C / C++.' &&
        emptyOnError &&
        (await result.inputValue()) === 'He said:\nA' &&
        (await errorLine()) === '',
      hint,
    );

    // §2.5: a C string with its quotes.
    await choose('Dialect', 'C / C++');
    await checkbox('With quotes').click();
    await input.fill('"caf\\303\\251"');
    check(`${T}: §2.5 "caf\\303\\251" from C, with quotes — café`, (await result.inputValue()) === 'café');
    await checkbox('With quotes').click();

    // §8: the notes — bytes that are not UTF-8 (C); Python's kept escapes and its unpaired surrogates.
    await input.fill('\\xe9');
    const utf8 = await notes();
    await choose('Dialect', 'Python');
    await input.fill('\\d+\\s*\\ud83d\\ude00 \\q\\w');
    const python = await notes();
    check(
      `${T}: §8 notes — not UTF-8 in C; Python keeps \\d \\s \\q \\w and counts two surrogates`,
      JSON.stringify(utf8) ===
        JSON.stringify(['Bytes from \\x and octal escapes are not valid UTF-8: shown as U+FFFD.']) &&
        JSON.stringify(python) ===
          JSON.stringify([
            'Kept with the backslash, as Python does: \\d, \\s, \\q, \\w',
            'Contains 2 unpaired surrogates, the first U+D83D. Most programs turn them into U+FFFD.',
          ]),
      JSON.stringify({ utf8, python }),
    );
    await settledShot(shoot, frame, 'tool-backslash-escape-05-python-notes-light.png');

    // §2.6: ASCII-only JSON.
    await fresh();
    await input.fill('café 😀');
    await checkbox('Escape non-ASCII').click();
    check(
      `${T}: §2.6 Escape non-ASCII, JSON — caf\\u00e9 \\ud83d\\ude00`,
      (await result.inputValue()) === 'caf\\u00e9 \\ud83d\\ude00',
    );

    // §12, timed in the browser: the result follows every edit up to 1 Mi on the page; above it the worker answers
    // 300 ms after the last edit while the page stays free; above 5 Mi the tool refuses at once. `longest` is the
    // longest task the page ran meanwhile (rendering the fields included).
    /** Empties the input the way a paste replaces it (one input event): Playwright's fill edits huge fields slowly. */
    const clear = () =>
      page.evaluate(() => {
        const field = document.querySelector('#backslash-escape-input');
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(field, '');
        field.dispatchEvent(new Event('input', { bubbles: true }));
      });
    const timed = (text, done) =>
      page.evaluate(
        async ([value, want]) => {
          const field = document.querySelector('#backslash-escape-input');
          const out = document.querySelector('#backslash-escape-output');
          const error = document.querySelector('[data-part="error"]');
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          const start = performance.now();
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          const finished = () =>
            want.length !== undefined
              ? Number(out.dataset.totalLength ?? out.value.length) === want.length
              : error.textContent.trim() === want.error;
          while (!finished() && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => setTimeout(r, 100));
          observer.disconnect();
          return {
            elapsed: Math.round(elapsed),
            longest: Math.round(longest),
            length: Number(out.dataset.totalLength ?? out.value.length),
            error: error.textContent.trim(),
          };
        },
        [text, done],
      );
    await clear();
    await checkbox('Escape non-ASCII').click();
    // 1 Mi of log lines: quotes, tabs and line breaks to escape all through (32,768 lines of 32 characters).
    const logLine = 'Request failed:\t{"code": 4200}\n\\';
    const live = await timed(logLine.repeat(MI / 32), { length: (MI / 32) * 37 });
    await clear();
    const workerEscape = await timed('\\'.repeat(5 * MI), { length: 10 * MI });
    // Typing at the end of the 5 Mi input: each key is answered (the field keeps up), the result comes after the pause.
    await input.focus();
    await page.keyboard.press('End');
    const typingStart = performance.now();
    await page.keyboard.type('abcd');
    const typing = Math.round(performance.now() - typingStart);
    await clear();
    await radio('Unescape').click();
    const workerUnescape = await timed('\\n'.repeat((5 * MI) / 2), { length: (5 * MI) / 2 });
    await clear();
    const refused = await timed('x'.repeat(5 * MI + 1), {
      error: 'Input is larger than 5 MB. This tool works with up to 5 MB.',
    });
    await clear();
    check(
      `${T}: §12 1 Mi follows the edit on the page; 5 Mi escape and unescape come from the worker after the pause; one more refuses at once`,
      live.length === (MI / 32) * 37 &&
        live.elapsed < 300 &&
        workerEscape.length === 10 * MI &&
        workerUnescape.length === (5 * MI) / 2 &&
        refused.error === 'Input is larger than 5 MB. This tool works with up to 5 MB.' &&
        refused.length === 0,
      `1 Mi on the page ${live.elapsed} ms (longest task ${live.longest} ms); 5 Mi of backslashes escaped in ${workerEscape.elapsed} ms (longest task ${workerEscape.longest} ms); 5 Mi of \\n unescaped in ${workerUnescape.elapsed} ms (longest task ${workerUnescape.longest} ms); 5 Mi + 1 refused in ${refused.elapsed} ms; 4 keys typed into the 5 Mi input in ${typing} ms`,
    );

    // §7: escaped text pasted into the start page's field opens this tool in Unescape; other tools' inputs, paths and
    // regular expressions do not. A paste that opened a tool is gone back over, so the tab's history does not grow.
    const paste = async text => {
      await go('#/start');
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
      await sleep(400);
      const hash = await page.evaluate(() => location.hash);
      return hash;
    };
    const openedHash = await paste('He said \\"hi\\"\\n');
    await input.waitFor({ timeout: 5_000 }).catch(() => {});
    const opened = {
      hash: openedHash,
      input: await input.inputValue().catch(() => null),
      unescape: await radio('Unescape')
        .getAttribute('aria-checked')
        .catch(() => null),
      result: await result.inputValue().catch(() => null),
    };
    if (openedHash !== '#/start') await page.goBack();
    check(
      `${T}: §7 escaped text pasted into the start page opens the tool in Unescape with it`,
      opened.hash === '#/tools/backslash-escape' &&
        opened.input === 'He said \\"hi\\"\\n' &&
        opened.unescape === 'true' &&
        opened.result === 'He said "hi"\n',
      JSON.stringify(opened),
    );
    const taken = [];
    for (const text of [
      'C:\\new\\table',
      '\\\\server\\share\\new',
      '\\d+\\s*',
      'just \\n once',
      '{"a":"x\\ny\\t"}',
      '\\x48\\x65\\x6c\\x6c\\x6f',
      'hello%20world',
      '&lt;div&gt;',
      'SGVsbG8sIFdvcmxkIQ==',
    ]) {
      const hash = await paste(text);
      if (hash === '#/tools/backslash-escape') taken.push(text);
      if (hash !== '#/start') await page.goBack();
    }
    check(
      `${T}: §7 Windows paths, regular expressions, one escape, JSON, \\x hex, URL encoding, entities, Base64 do not open it`,
      taken.length === 0,
      taken.join(', '),
    );

    // D17: the copied entry opens back into the tool from its own history line.
    await fresh();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').waitFor({ timeout: 5_000 });
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: 'single quotes · with quotes' }).first();
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
      dialect: (await page.getByRole('combobox', { name: 'Dialect', exact: true }).innerText()).trim(),
      withQuotes: await checkbox('With quotes').getAttribute('aria-checked'),
      result: await result.inputValue(),
    };
    check(
      `${T}: a copied result is in the tool’s history as Escaped and opens back with its choices`,
      back.listed > 0 &&
        back.kind === 'Escaped' &&
        back.input === "SELECT *\nFROM t\nWHERE name = 'x'" &&
        back.dialect === 'JavaScript' &&
        back.withQuotes === 'true' &&
        back.result === "'SELECT *\\nFROM t\\nWHERE name = \\'x\\''",
      JSON.stringify(back),
    );

    // The dark theme (the default dark one), then back.
    await fresh();
    await inDarkTheme(ctx, base, page, async () => {
      await choose('Dialect', 'JavaScript');
      await choose('Quote', 'Backtick');
      await checkbox('With quotes').click();
      await input.fill('Hello, ${name}!\n\tcafé 😀 "quoted" \\ path');
      await settledShot(shoot, frame, 'tool-backslash-escape-06-escape-template-dark.png');
      await radio('Unescape').click();
      await checkbox('With quotes').click();
      await choose('Dialect', 'Python');
      await input.fill('caf\\xe9 \\N{BULLET}');
      await settledShot(shoot, frame, 'tool-backslash-escape-07-error-dark.png');
      await input.fill('Kept: \\d+ \\q; lone: \\udc00');
      await settledShot(shoot, frame, 'tool-backslash-escape-08-python-notes-dark.png');
    });
    await input.fill('');
  } finally {
    await clipboard?.restore().catch(() => undefined);
  }
};
