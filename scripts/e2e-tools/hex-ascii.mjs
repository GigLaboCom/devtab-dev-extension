// The Hex and Text tool in the built extension (docs/tools/specs/hex-ascii.md): its scenarios (§2) the way a person does
// them — the page's real controls — run by scripts/e2e-tools.mjs. The clipboard is the page's own stand-in for the length
// of this module (scripts/e2e-helpers.mjs), put back at the end, also when a check throws. Then: the keyboard order (§8),
// what `TextDecoder('latin1')` gives in Chrome (§10), the limits timed in the browser with the text box's own cost apart
// (§12), hex pasted on the start page (§7, with the `0x…` paste that Number Bases takes first), a copy recorded in the
// history and opened back (D17), and the page in the default dark theme.
// Screenshots: tool-hex-ascii-01 … (light), tool-hex-ascii-0N-dark-… (dark).

/* global document, location, HTMLTextAreaElement, requestAnimationFrame, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Hex and Text';

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const input = page.locator('#hex-ascii-input');
  const result = page.locator('#hex-ascii-output');
  const frame = page.locator('[data-slot="tool-page"]');
  const errorLine = () => page.locator('[data-part="error"]').innerText();
  const byteLine = () => page.locator('[data-part="bytes"]').innerText();
  const notes = async () =>
    (await page.locator('[data-part="note"]').allInnerTexts()).map(n => n.trim()).filter(Boolean);
  const radio = name => page.getByRole('radio', { name, exact: true });
  const button = name => page.getByRole('button', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  // Chrome keeps at most 50 entries of a tab's history, and the modules after this one count them: go by replacing the
  // current entry; only the start page's own move to a tool adds one.
  const go = async hash => {
    // Run alone, the tab may not be on an extension page yet: the first move is an ordinary one.
    if (!page.url().startsWith(base)) await page.goto(`${base}${hash}`);
    else await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5000 });
  };
  const tool = async () => {
    await go('#/tools/hex-ascii');
    await input.waitFor();
  };

  await tool();
  const clipboard = await stubClipboard(page);
  try {
    check(
      `${T}: opens empty in Text to hex — UTF-8, Plain, 0 bytes, Copy and Swap off (§8)`,
      (await radio('Text to hex').getAttribute('aria-checked')) === 'true' &&
        (await page.getByLabel('Text', { exact: true }).getAttribute('id')) === 'hex-ascii-input' &&
        (await input.getAttribute('placeholder')) === 'Text to turn into bytes' &&
        (await byteLine()).trim() === '0 bytes' &&
        (await button('Copy').isDisabled()) &&
        (await button('Swap').isDisabled()),
    );
    await settledShot(shoot, frame, 'tool-hex-ascii-01-empty.png');

    // §2.3 — é€😀 as UTF-8 Spaced, then UTF-16 LE.
    await input.fill('é€😀');
    await choose('Format', 'Spaced — 48 65 6c');
    const utf8 = await result.inputValue();
    const utf8Count = (await byteLine()).trim();
    await choose('Encoding', 'UTF-16 LE');
    const utf16 = await result.inputValue();
    check(
      `${T}: §2.3 é€😀 — UTF-8 Spaced c3 a9 e2 82 ac f0 9f 98 80 (9 bytes), UTF-16 LE e9 00 ac 20 3d d8 00 de`,
      utf8 === 'c3 a9 e2 82 ac f0 9f 98 80' && utf8Count === '9 bytes' && utf16 === 'e9 00 ac 20 3d d8 00 de',
      JSON.stringify({ utf8, utf8Count, utf16 }),
    );
    await choose('Encoding', 'UTF-8');
    await input.fill('Hello, World!\nПривет 😀');
    await settledShot(shoot, frame, 'tool-hex-ascii-02-spaced.png');

    // §2.5 — the dump view.
    await choose('Format', 'Dump — offsets and text');
    const dump = (await result.inputValue()).split('\n');
    check(
      `${T}: §2.5 Dump is the view of hexdump -C; Swap and Bytes per line are off`,
      dump[0] === '00000000  48 65 6c 6c 6f 2c 20 57  6f 72 6c 64 21 0a d0 9f  |Hello, World!...|' &&
        dump.length === 2 &&
        (await button('Swap').isDisabled()) &&
        (await page.getByRole('combobox', { name: 'Bytes per line', exact: true }).isDisabled()),
      dump.join(' ⏎ '),
    );
    await settledShot(shoot, frame, 'tool-hex-ascii-03-dump.png');
    await choose('Format', 'Plain — 48656c');

    // §2.1, §2.2 — Hex to text.
    await radio('Hex to text').click();
    await input.fill('48656c6c6f2c20776f726c64');
    const read = await result.inputValue();
    const readCount = (await byteLine()).trim();
    await input.fill('{0x48, 0x65, 0x6c, 0x6c, 0x6f}');
    const cArray = await result.inputValue();
    check(
      `${T}: §2.1–§2.2 hex from a log reads "Hello, world" (12 bytes); a C array reads "Hello"`,
      read === 'Hello, world' &&
        readCount === '12 bytes' &&
        cArray === 'Hello' &&
        (await input.getAttribute('placeholder')) === '48 65 6c 6c 6f, 0x48 or \\x48' &&
        (await page.getByRole('combobox', { name: 'Format', exact: true }).count()) === 0,
      JSON.stringify({ read, readCount, cArray }),
    );

    // §2.4 — Latin-1 bytes.
    await input.fill('e9');
    const replaced = await result.inputValue();
    const invalid = await notes();
    await choose('Encoding', 'ISO-8859-1');
    const latin = await result.inputValue();
    check(
      `${T}: §2.4 e9 is U+FFFD with a note in UTF-8 and é in ISO-8859-1`,
      replaced === '�' &&
        invalid[0] ===
          'Not valid UTF-8 from byte 1: invalid bytes are shown as U+FFFD. ISO-8859-1 shows every byte as one character.' &&
        latin === 'é',
      JSON.stringify({ replaced, invalid, latin }),
    );
    await choose('Encoding', 'UTF-8');
    await input.fill('48e941');
    await settledShot(shoot, frame, 'tool-hex-ascii-04-invalid-utf8.png');

    // §2.6 — a typo with its place.
    await input.fill('48 6g');
    const typo = (await errorLine()).trim();
    check(
      `${T}: §2.6 a typo is named with its place, result empty`,
      typo === 'Line 1, column 5: "g" is not a hex digit' && (await result.inputValue()) === '',
      typo,
    );
    await settledShot(shoot, frame, 'tool-hex-ascii-05-error.png');

    // §2.7 — control characters: symbols on screen, the real characters copied.
    await input.fill('00 07 0d 0a 41');
    const symbols = await result.inputValue();
    const controlNote = await notes();
    await button('Copy').click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2000 });
    const copied = (await clipboard.copied()).at(-1);
    check(
      `${T}: §2.7 controls show as ␀␇␍, Copy copies U+0000 U+0007 U+000D`,
      symbols === '␀␇␍\nA' &&
        copied === '\u0000\u0007\r\nA' &&
        controlNote[0] === 'Contains 3 control characters, shown as symbols. Copy copies the real characters.',
      JSON.stringify({ symbols, copied, controlNote }),
    );
    await settledShot(shoot, frame, 'tool-hex-ascii-06-controls.png');
    const record = await waitForHistoryRecord(
      page,
      'hex-ascii',
      r => r.kind === 'to-text' && r.label?.endsWith('copied'),
    ).catch(() => null);
    check(
      `${T}: the copy is a history record (commit) of kind to-text`,
      record?.label === 'Hex to text · UTF-8 · 5 bytes · copied' && record?.payload?.encoding === 'utf-8',
      record?.label,
    );

    // §4 — Swap both ways.
    await radio('Text to hex').click();
    await choose('Format', 'C array — 0x48, 0x65');
    await input.fill('Привет');
    const there = await result.inputValue();
    await button('Swap').click();
    const back = { input: await input.inputValue(), result: await result.inputValue() };
    await button('Swap').click();
    check(
      `${T}: §4 Swap turns the direction around and back`,
      there === '0xd0, 0x9f, 0xd1, 0x80, 0xd0, 0xb8, 0xd0, 0xb2, 0xd0, 0xb5, 0xd1, 0x82' &&
        back.input === there &&
        back.result === 'Привет' &&
        (await input.inputValue()) === 'Привет' &&
        (await result.inputValue()) === there,
      JSON.stringify({ there, back }),
    );

    // §8 — the keyboard: Tab passes the direction, the options, Swap, the input, Copy, the result.
    await radio('Text to hex').focus();
    const order = [];
    for (let i = 0; i < 8; i++) {
      await page.keyboard.press('Tab');
      order.push(
        await page.evaluate(() => {
          const el = document.activeElement;
          return el.labels?.[0]?.textContent || el.getAttribute('aria-label') || el.textContent.trim().slice(0, 20);
        }),
      );
    }
    await radio('Text to hex').focus();
    await page.keyboard.press('ArrowRight');
    await sleep(100); // Radix moves the focus on the next task
    await page.keyboard.press('Space');
    const arrowed = (await radio('Hex to text').getAttribute('aria-checked')) === 'true';
    check(
      `${T}: §8 Tab order is Encoding, Format, Uppercase, Bytes per line, Swap, Text, Copy, Hex; arrows and Space switch`,
      order.join(' → ') === 'Encoding → Format → Uppercase → Bytes per line → Swap → Text → Copy → Hex' && arrowed,
      `${order.join(' → ')}; arrow and Space ${arrowed}`,
    );

    // §10 row 15 — in Chrome the label latin1 is windows-1252: 0x80 is "€", which is why the tool decodes it itself.
    const latin1Label = await page.evaluate(() => {
      const d = new TextDecoder('latin1');
      return { encoding: d.encoding, text: d.decode(new Uint8Array([0x80])) };
    });
    await radio('Hex to text').click();
    await choose('Encoding', 'ISO-8859-1');
    await input.fill('80');
    const ours = await result.inputValue();
    check(
      `${T}: §10 TextDecoder('latin1') in Chrome is windows-1252 (0x80 → €); the tool's ISO-8859-1 gives U+0080`,
      latin1Label.encoding === 'windows-1252' && latin1Label.text === '€' && ours === '\u0080',
      JSON.stringify({ latin1Label, ours }),
    );
    await choose('Encoding', 'UTF-8');

    // §12 — the limits, timed in the browser. `longest` is the longest task on the page's thread meanwhile; `box` is
    // the same output text put into a bare textarea, no tool — the text box's own cost.
    const timed = (text, done) =>
      page.evaluate(
        async ([value, want]) => {
          const field = document.querySelector('#hex-ascii-input');
          const out = document.querySelector('#hex-ascii-output');
          const error = () => document.querySelector('[data-part="error"]').textContent.trim();
          let longest = 0;
          const observer = new PerformanceObserver(list => {
            for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
          });
          observer.observe({ type: 'longtask', buffered: false });
          const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
          const start = performance.now();
          setter.call(field, value);
          field.dispatchEvent(new Event('input', { bubbles: true }));
          const ready = () =>
            typeof want === 'number' ? Number(out.dataset.totalLength ?? out.value.length) === want : error() === want;
          while (!ready() && performance.now() - start < 20_000) await new Promise(r => requestAnimationFrame(r));
          const elapsed = performance.now() - start;
          await new Promise(r => setTimeout(r, 100));
          observer.disconnect();
          return {
            elapsed: Math.round(elapsed),
            longest: Math.round(longest),
            ok: ready(),
            length: Number(out.dataset.totalLength ?? out.value.length),
          };
        },
        [text, done],
      );
    const textBox = length =>
      page.evaluate(async n => {
        const box = document.createElement('textarea');
        document.body.append(box);
        const value = 'c3 a9 '.repeat(Math.ceil(n / 6)).slice(0, n);
        const start = performance.now();
        box.value = value;
        void box.scrollHeight;
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const ms = performance.now() - start;
        box.remove();
        return Math.round(ms);
      }, length);
    await radio('Text to hex').click();
    await choose('Format', 'Spaced — 48 65 6c');
    await input.fill('');
    // 1 Mi characters of text, one in six a two-byte letter.
    const text = 'Hex ad'
      .repeat(174_763)
      .slice(0, 1024 * 1024)
      .replaceAll('d', 'é');
    const textBytes = Buffer.byteLength(text, 'utf8');
    const live = await timed(text.slice(0, 256 * 1024), Buffer.byteLength(text.slice(0, 256 * 1024)) * 3 - 1);
    await input.fill('');
    const toHex = await timed(text, textBytes * 3 - 1);
    const toHexBox = await textBox(textBytes * 3 - 1);
    const refusedText = await timed(`${text}a`, 'Text is larger than 1 MB. Text to hex works with up to 1 MB.');
    await input.fill('');
    await radio('Hex to text').click();
    // 5 Mi characters less two, ending on a whole byte and its space.
    const hex = '48 65 78 20 61 '.repeat(349_526).slice(0, 5 * 1024 * 1024 - 2);
    const toText = await timed(hex, Math.ceil(hex.length / 3));
    const refusedHex = await timed(`${hex}   `, 'Input is larger than 5 MB. Hex to text works with up to 5 MB.');
    check(
      `${T}: §12 256 Ki follows the edit at once; 1 Mi of text and 5 Mi of hex come after the pause; one more is refused`,
      live.ok &&
        live.elapsed < 300 &&
        toHex.ok &&
        toText.ok &&
        refusedText.ok &&
        refusedHex.ok &&
        refusedText.length === 0 &&
        refusedHex.length === 0,
      [
        `256 Ki text to hex ${live.elapsed} ms (longest task ${live.longest} ms)`,
        `1 Mi text (${textBytes.toLocaleString('en-US')} bytes) to ${toHex.length.toLocaleString('en-US')} characters of spaced hex ${toHex.elapsed} ms, 300 ms of it the pause (longest task ${toHex.longest} ms; the same text in a bare textarea ${toHexBox} ms)`,
        `5 Mi of hex to ${toText.length.toLocaleString('en-US')} characters of text ${toText.elapsed} ms (longest task ${toText.longest} ms)`,
        `refused: text in ${refusedText.elapsed} ms, hex in ${refusedHex.elapsed} ms`,
      ].join('; '),
    );
    await input.fill('');

    // §7 — hex pasted into the start page's field opens this tool in Hex to text; a `0x…` run opens Number Bases,
    // which comes first in the registry (the collision named in the specification's §15); a hash opens neither.
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
    };
    await paste('48656c6c6f2c20776f726c64');
    await page.waitForFunction(() => location.hash === '#/tools/hex-ascii', null, { timeout: 5000 }).catch(() => {});
    await input.waitFor({ timeout: 5000 }).catch(() => {});
    const opened = {
      hash: await page.evaluate(() => location.hash),
      input: await input.inputValue().catch(() => null),
      mode: await radio('Hex to text')
        .getAttribute('aria-checked')
        .catch(() => null),
      result: await result.inputValue().catch(() => null),
    };
    await paste('0x48656c6c6f');
    await page.waitForFunction(() => location.hash.startsWith('#/tools/'), null, { timeout: 5000 }).catch(() => {});
    const prefixed = await page.evaluate(() => location.hash);
    await paste('deadbeef');
    await sleep(300);
    const hash = await page.evaluate(() => location.hash);
    check(
      `${T}: §7 hex of text pasted on the start page opens the tool in Hex to text; 0x48656c6c6f opens Number Bases (first in the registry); deadbeef opens nothing`,
      opened.hash === '#/tools/hex-ascii' &&
        opened.input === '48656c6c6f2c20776f726c64' &&
        opened.mode === 'true' &&
        opened.result === 'Hello, world' &&
        prefixed === '#/tools/number-base' &&
        hash === '#/start',
      JSON.stringify({ opened, prefixed, hash }),
    );

    // D17 — the copied entry is in the tool's "Recent entries" and opens back into the tool.
    await tool();
    const recent = page.locator('.kit-tool-history-recent');
    await recent.locator('summary').waitFor({ timeout: 5000 });
    await recent.locator('summary').click();
    const entry = recent.locator('.kit-history-entry', { hasText: 'Hex to text · UTF-8 · 5 bytes · copied' }).first();
    const listed = await entry.count();
    if (listed) await entry.getByRole('button', { name: 'Open' }).click();
    await page
      .locator('[data-restored]')
      .waitFor({ timeout: 5000 })
      .catch(() => {});
    const restored = {
      listed,
      kind: listed ? await entry.locator('.kit-history-entry-kind').innerText() : null,
      input: await input.inputValue(),
      mode: await radio('Hex to text').getAttribute('aria-checked'),
      result: await result.inputValue(),
    };
    check(
      `${T}: a copied result is in the tool's history as Hex → text and opens back into the tool`,
      restored.listed > 0 &&
        restored.kind === 'Hex → text' &&
        restored.input === '00 07 0d 0a 41' &&
        restored.mode === 'true' &&
        restored.result === '␀␇␍\nA',
      JSON.stringify(restored),
    );

    // The page in the default dark theme, entered afresh ("Recent entries" closed), then the theme mode as it was.
    await go('#/start');
    await tool();
    await choose('Format', 'Spaced — 48 65 6c');
    await input.fill('Hello, World!\nПривет 😀');
    const dark = await inDarkTheme(ctx, base, page, async () => {
      await settledShot(shoot, frame, 'tool-hex-ascii-07-dark-spaced.png');
      await radio('Hex to text').click();
      await input.fill('48 65 6c 6c 6f 00 07 e9');
      await settledShot(shoot, frame, 'tool-hex-ascii-08-dark-hex-to-text.png');
      await input.fill('48 6g');
      await settledShot(shoot, frame, 'tool-hex-ascii-09-dark-error.png');
      return page.evaluate(() => document.documentElement.dataset.mode);
    });
    check(`${T}: the page in the default dark theme`, dark === 'dark', dark);
    await input.fill('');
  } finally {
    await clipboard.restore();
  }
};
