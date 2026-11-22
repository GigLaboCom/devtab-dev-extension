// Data Units in the built extension (docs/tools/specs/data-units.md): its scenarios (§2) with the page's real controls,
// in a page of its own, closed at the end (the shared tab keeps its history length):
//   - Convert: 1.5 GiB in every unit; 250 MB read as decimal and as binary, the reading line; a rate; an error word for
//     word; Copy (a stand-in for navigator.clipboard.writeText — nothing reaches the machine's clipboard);
//   - Transfer time with overhead; Config suffixes;
//   - a copy is kept in History and opens back from Recent entries; a parameter changed and the page opened again is as
//     left (saved parameters, D21), forgotten at the end;
//   - the start page opens the tool for a pasted 1.5 GiB and 250 Mbps, and not for a bare number;
//   - the longest value the field takes: the time from the input to the rows, in this browser;
//   - nothing goes to the network.
// Screenshots light and dark: tool-data-units-NN-….png. Run by scripts/e2e-tools.mjs.

/* global document, location, chrome, requestAnimationFrame, CSS, HTMLInputElement, DataTransfer, ClipboardEvent -- page.evaluate callbacks */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Data Units';

export default async ({ ctx, base, check, shoot, report }) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 2200 });
  p.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
  });
  p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  const requests = [];
  p.on('request', r => requests.push(r.url()));

  const field = id => p.locator(`input#data-units-${id}`);
  const frame = p.locator('[data-slot="tool-page"]');
  const radio = name => p.getByRole('radio', { name, exact: true });
  const pressed = async name => (await radio(name).getAttribute('aria-checked')) === 'true';
  const messages = id => p.locator(`#data-units-${id}-message p`).allInnerTexts();
  const rows = () =>
    p
      .locator('[data-slot="result-row"]')
      .evaluateAll(list =>
        Object.fromEntries(list.map(r => [r.dataset.row ?? '', r.querySelector('output')?.textContent ?? ''])),
      );
  /** Waits until the row shows this value (something only the new input produces). */
  const rowIs = (id, value) =>
    p.waitForFunction(
      ([i, v]) => document.querySelector(`[data-row="${CSS.escape(i)}"] output`)?.textContent === v,
      [id, value],
      { timeout: 5000 },
    );
  const shot = file => settledShot(shoot, frame, file);
  const tool = async () => {
    await p.goto(`${base}#/tools/data-units`);
    // The tool's own element, not the heading: the page says "Loading…" until its history is open.
    await radio('Convert').waitFor({ timeout: 15_000 });
  };

  let clipboard;
  try {
    await tool();
    clipboard = await stubClipboard(p);

    check(
      `${T}: opens in Convert, Decimal, Exact, with an empty field and no rows`,
      (await pressed('Convert')) &&
        (await pressed('Decimal (1000)')) &&
        (await p.getByRole('combobox', { name: 'Digits' }).innerText()) === 'Exact' &&
        (await field('value').inputValue()) === '' &&
        (await p.locator('[data-slot="result-row"]').count()) === 0,
    );

    // §2 item 1.
    await field('value').fill('1.5 GiB');
    await rowIs('MiB', '1,536');
    const r1 = await rows();
    check(
      `${T}: 1.5 GiB in every unit — 42 rows, bytes 1,610,612,736, GB 1.610612736, Gibit 12, no reading line`,
      Object.keys(r1).length === 42 &&
        r1.bytes === '1,610,612,736' &&
        r1.GB === '1.610612736' &&
        r1.Gibit === '12' &&
        (await messages('value')).length === 0,
      JSON.stringify([r1.bytes, r1.GB, r1.Gibit]),
    );
    await shot('tool-data-units-01-convert-light.png');

    // Copy takes the number without groups.
    await p.getByRole('button', { name: 'Copy bytes', exact: true }).click();
    await p.waitForFunction(() => (document.documentElement.__e2eCopied ?? []).length > 0, null, { timeout: 5000 });
    check(`${T}: Copy bytes copies 1610612736 (no groups)`, (await clipboard.copied()).at(-1) === '1610612736');

    // §2 item 2: the reading line, and Binary (1024).
    await field('value').fill('250 MB');
    await rowIs('MiB', '238.4185791015625');
    const decimalLine = (await messages('value')).join('|');
    await radio('Binary (1024)').click();
    await rowIs('MiB', '250');
    const binaryLine = (await messages('value')).join('|');
    check(
      `${T}: 250 MB — decimal says so and gives the binary bytes; Binary (1024) reads it as 250 MiB`,
      decimalLine ===
        'MB is read as decimal: 1 MB = 1,000,000 bytes (SI). As binary (JEDEC, Windows), 250 MB is 262,144,000 bytes.' &&
        binaryLine.startsWith('MB is read as binary (JEDEC, Windows): 1 MB = 1,048,576 bytes.'),
      `${decimalLine} / ${binaryLine}`,
    );
    await shot('tool-data-units-02-reading-light.png');

    // Saved parameters: Binary is kept (written 400 ms after the change); opened again, the page reads as left.
    const storedReading = () =>
      p.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.['data-units']);
    for (let i = 0; i < 25 && (await storedReading())?.values?.reading !== 'binary'; i++) await p.waitForTimeout(200);
    await p.reload();
    await radio('Convert').waitFor({ timeout: 15_000 });
    check(
      `${T}: Binary (1024) chosen, the page opened again — still Binary (saved parameter)`,
      await pressed('Binary (1024)'),
      JSON.stringify(await storedReading()),
    );
    await radio('Decimal (1000)').click();
    for (let i = 0; i < 25 && (await storedReading()) !== undefined; i++) await p.waitForTimeout(200);
    check(
      `${T}: back to Decimal (1000), the default — nothing of this tool is left in storage`,
      (await storedReading()) === undefined,
      JSON.stringify(await storedReading()),
    );

    // §2 item 3 and an error.
    await field('value').fill('100 Mbps');
    await rowIs('MB/s', '12.5');
    const sections = await p.locator('[data-section]').evaluateAll(list => list.map(s => s.getAttribute('aria-label')));
    check(
      `${T}: 100 Mbps — bits per second first, MB/s 12.5, MiB/s 11.920928955078125`,
      sections.join('|') === 'Bits per second|Bytes per second' && (await rows())['MiB/s'] === '11.920928955078125',
    );
    await field('value').fill('256Mi');
    await p.locator('#data-units-value-message p').first().waitFor();
    check(
      `${T}: 256Mi — refused word for word, no rows`,
      (await messages('value')).join('|') ===
        'Column 4: "Mi" alone is a prefix, not a unit: write 256 MiB, 256 MB or 256 Mibit. Config suffixes shows how programs read it.' &&
        (await p.locator('[data-slot="result-row"]').count()) === 0,
    );

    // The longest value the field takes (200 characters, exponent 100): input to rows in this browser.
    const longest = `${'9'.repeat(190)}e100 QB`;
    const ms = await p.evaluate(async text => {
      const el = document.querySelector('#data-units-value');
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
      const t0 = performance.now();
      setter.call(el, text);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(r => {
        const wait = () => (document.querySelector('[data-row="bits"] output') ? r() : requestAnimationFrame(wait));
        wait();
      });
      await new Promise(r => requestAnimationFrame(() => r()));
      return performance.now() - t0;
    }, longest);
    const bits = (await rows()).bits ?? '';
    check(
      `${T}: the longest value (197 characters, 1e100 QB) — 42 exact rows in ${ms.toFixed(0)} ms`,
      bits.replace(/,/g, '').length === 191 + 130 && ms < 1000,
      `${ms.toFixed(1)} ms; bits ${bits.length} characters`,
    );
    report.measurements = { ...(report.measurements ?? {}), 'data-units longest value → rows (ms)': ms };

    // Transfer time.
    await radio('Transfer time').click();
    await field('size').fill('4.7 GB');
    await field('rate').fill('100 Mbps');
    await rowIs('time', '6 minutes 16 seconds');
    await field('overhead').fill('12.5');
    await rowIs('exact', '3008/7 seconds');
    const t = await rows();
    check(
      `${T}: 4.7 GB at 100 Mbps — 6 minutes 16 seconds; with 12.5 % overhead ≈ 7 minutes 9.714 seconds, 3008/7 exactly`,
      t.time === '≈ 7 minutes 9.714 seconds' && t.effective === '87.5 Mbps' && t.clock === '≈ 0:07:09.714',
      JSON.stringify(t),
    );
    await shot('tool-data-units-03-transfer-light.png');

    // History: a copy is kept and opens back from Recent entries.
    await p.getByRole('button', { name: 'Copy time', exact: true }).click();
    const record = await waitForHistoryRecord(p, 'data-units', r => r.kind === 'transfer');
    await p.reload();
    await radio('Convert').waitFor({ timeout: 15_000 });
    await p.locator('.kit-tool-history-recent summary').click();
    const recent = p.locator('.kit-tool-history-recent .kit-history-entry', { hasText: record.label });
    await recent.first().waitFor({ timeout: 5000 });
    await recent.first().getByRole('button', { name: 'Open' }).click();
    await p.locator('[data-restored]').waitFor({ timeout: 5000 });
    await rowIs('exact', '3008/7 seconds');
    check(
      `${T}: a copied transfer time is kept in History and opens back with its fields`,
      record.label === '4.7 GB at 100 Mbps (12.5 % overhead) → ≈ 7 minutes 9.714 seconds' &&
        (await field('size').inputValue()) === '4.7 GB' &&
        (await field('overhead').inputValue()) === '12.5',
      record.label,
    );

    // Config suffixes.
    await radio('Config suffixes').click();
    const table = p.getByRole('table', { name: 'Config suffixes' });
    await table.waitFor();
    check(
      `${T}: Config suffixes — nine programs, no links`,
      (await table.locator('tbody tr').count()) === 9 && (await table.locator('a').count()) === 0,
    );
    await shot('tool-data-units-04-suffixes-light.png');

    // The start page.
    const paste = async text => {
      await p.goto(`${base}#/start`);
      const start = p.getByRole('combobox', { name: 'Find a tool or search the web' });
      await start.waitFor();
      await start.focus();
      await p.evaluate(value => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, text);
    };
    await paste('1.5 GiB');
    await p.waitForFunction(() => location.hash === '#/tools/data-units', null, { timeout: 5000 });
    await rowIs('MiB', '1,536');
    check(
      `${T}: 1.5 GiB pasted on the start page opens the tool in Convert with it`,
      (await field('value').inputValue()) === '1.5 GiB' && (await pressed('Convert')),
    );
    await paste('250 Mbps');
    await p.waitForFunction(() => location.hash === '#/tools/data-units', null, { timeout: 5000 });
    await rowIs('MB/s', '31.25');
    check(`${T}: 250 Mbps pasted on the start page opens the tool`, (await field('value').inputValue()) === '250 Mbps');
    await paste('4096');
    await p.waitForTimeout(800);
    const after = await p.evaluate(() => location.hash);
    check(`${T}: a bare number pasted on the start page does not open this tool`, !after.includes('data-units'), after);

    // Dark.
    await inDarkTheme(ctx, base, p, async () => {
      await tool();
      await radio('Convert').click();
      await field('value').fill('1 TB');
      await rowIs('GiB', '931.322574615478515625');
      await shot('tool-data-units-01-convert-dark.png');
      await radio('Transfer time').click();
      await field('size').fill('1 TB');
      await field('rate').fill('1 bps');
      await rowIs('time', '92,592,592 days 14 hours 13 minutes 20 seconds (about 253,504.7 years)');
      await shot('tool-data-units-03-transfer-dark.png');
      await radio('Convert').click();
    });

    // `new URL(base).origin` is "null" for a chrome-extension: address in Node: the origin is built from the id.
    const origin = base.slice(0, base.indexOf('/', 'chrome-extension://'.length));
    check(
      `${T}: nothing went to the network — every request was to the extension itself`,
      requests.length > 0 && requests.every(url => url.startsWith(origin)),
      requests.filter(url => !url.startsWith(origin)).join(' '),
    );
  } finally {
    await clipboard?.restore().catch(() => undefined);
    // Task, reading, digits and solve are saved parameters (D21): the next module opens the tool with its defaults.
    await forgetSavedParameters(p, 'data-units').catch(() => undefined);
    await p.close();
  }
};
