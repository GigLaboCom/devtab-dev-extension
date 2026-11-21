// The Unix Time tool in the built extension (docs/tools/specs/unix-time.md): its scenarios (§2) the way a person does
// them — the page's real controls — run by scripts/e2e-tools.mjs. The machine's time zone and language are not
// trusted: DevTools emulates the browser's zone (Europe/Berlin, the zone of §2; then a half-hour, a southern and a
// legacy-named zone) and en-US, and puts both back at the end. The clipboard is the page's own stand-in for the length
// of this module (what was copied is read from it; nothing reaches the machine's clipboard).
// Screenshots: tool-unix-time-01 … (light), tool-unix-time-0N-dark-… (the default dark theme).

/* global document, location, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

const T = 'Unix Time';
/** ICU puts a narrow no-break space before AM / PM. */
const plain = text => text.replace(/\u202f/g, ' ');

export default async ({ page, base, check, shoot, sleep }) => {
  const cdp = await page.context().newCDPSession(page);
  const emulate = async (timezoneId, locale = 'en-US') => {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId });
    await cdp.send('Emulation.setLocaleOverride', { locale });
  };
  const field = page.getByLabel('Timestamp or date', { exact: true });
  const picker = page.getByRole('combobox', { name: 'Time zone', exact: true });
  const frame = page.locator('[data-slot="tool-page"]');
  const tool = async () => {
    await page.goto(`${base}#/tools/unix-time`);
    await field.waitFor();
  };
  const row = key => page.locator(`dl[aria-label="Result"] [data-row="${key}"] dd`).first();
  const value = async key => plain(await row(key).innerText());
  const rows = async keys => Object.fromEntries(await Promise.all(keys.map(async k => [k, await value(k)])));
  const messages = () => page.locator('#unix-time-messages p').allInnerTexts();
  const zoneLine = () => page.locator('[data-zone-line]').innerText();
  const copied = () => page.evaluate(() => document.documentElement.dataset.e2eCopied ?? '');
  const stubClipboard = () =>
    page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, 'writeText', {
        configurable: true,
        value: text => {
          document.documentElement.dataset.e2eCopied = text;
          return Promise.resolve();
        },
      });
    });
  const settle = () => sleep(250); // transitions of the select and the copy icon, before a screenshot

  try {
    await emulate('Europe/Berlin');
    await tool();
    await stubClipboard();

    // §2.10 — the empty field: the time now, ticking; the browser's zone chosen.
    const before = await value('seconds');
    await sleep(1200);
    const after = await value('seconds');
    check(
      `${T}: an empty field shows the time now and it ticks (§2.10)`,
      (await messages()).join('|') === 'Showing the current time.' && Number(after) > Number(before),
      `${before} → ${after}`,
    );
    check(
      `${T}: the browser's zone is the default, its line under the picker`,
      (await picker.inputValue()) === 'Europe/Berlin' &&
        /^UTC\+0[12]:00 · Central European (Standard|Summer) Time$/.test(await zoneLine()),
      `${await picker.inputValue()} · ${await zoneLine()}`,
    );
    await shoot(frame, 'tool-unix-time-01-now.png');

    // §2.1 — seconds from a log, every row; Readable in en-US as Chrome writes it.
    await field.fill('1700000000');
    const all = await rows([
      'seconds',
      'milliseconds',
      'isoUtc',
      'isoZone',
      'rfc2822',
      'httpDate',
      'readable',
      'dayOfWeek',
      'dayOfYear',
      'isoWeekDate',
      'relative',
    ]);
    check(
      `${T}: 1700000000 — the note and every row (§2.1)`,
      (await messages()).join('|') === 'Read as seconds (10 digits).' &&
        JSON.stringify(all) ===
          JSON.stringify({
            seconds: '1700000000',
            milliseconds: '1700000000000',
            isoUtc: '2023-11-14T22:13:20Z',
            isoZone: '2023-11-14T23:13:20+01:00',
            rfc2822: 'Tue, 14 Nov 2023 23:13:20 +0100',
            httpDate: 'Tue, 14 Nov 2023 22:13:20 GMT',
            readable: 'Nov 14, 2023, 11:13:20 PM GMT+1',
            dayOfWeek: 'Tuesday',
            dayOfYear: '318',
            isoWeekDate: '2023-W46-2',
            relative: all.relative,
          }) &&
        /^\d+ years ago$/.test(all.relative),
      JSON.stringify(all),
    );
    check(
      `${T}: the zone line follows the instant shown`,
      (await zoneLine()) === 'UTC+01:00 · Central European Standard Time',
    );
    await page.getByRole('button', { name: 'Copy ISO 8601 in Europe/Berlin', exact: true }).click();
    await page
      .locator('dl[aria-label="Result"] [data-row="isoZone"] button[aria-label="Copied"]')
      .waitFor({ timeout: 2000 });
    check(`${T}: a row's icon copies exactly its value`, (await copied()) === '2023-11-14T23:13:20+01:00');
    await settle();
    await shoot(frame, 'tool-unix-time-02-seconds.png');

    // §2.5 — Unit → Milliseconds, then back to Auto.
    await page.getByLabel('Unit', { exact: true }).click();
    await page.getByRole('option', { name: 'Milliseconds', exact: true }).click();
    check(
      `${T}: Unit Milliseconds reads the same digits as milliseconds (§2.5)`,
      (await value('isoUtc')) === '1970-01-20T16:13:20Z' && (await messages()).length === 0,
    );
    await page.getByLabel('Unit', { exact: true }).click();
    await page.getByRole('option', { name: 'Auto', exact: true }).click();

    // §2.3 — nanoseconds beyond 2^53, all nine digits; §2.4 — seconds with a fraction.
    await field.fill('1700000000123456789');
    const ns = await value('isoUtc');
    await field.fill('1700000000.123');
    check(
      `${T}: nanoseconds keep every digit, a fraction of seconds is exact (§2.3, §2.4)`,
      ns === '2023-11-14T22:13:20.123456789Z' && (await value('milliseconds')) === '1700000000123',
      ns,
    );

    // §2.6 — a wall time in the gap of the spring change.
    await field.fill('2024-03-31T02:30');
    const gap = await messages();
    check(
      `${T}: 02:30 on 2024-03-31 in Europe/Berlin — the gap, an hour later (§2.6)`,
      gap.join('|') ===
        'No offset in the text: read as Europe/Berlin time.|02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. Showing 2024-03-31T03:30:00+02:00.' &&
        (await value('seconds')) === '1711848600',
      gap.join(' | '),
    );
    await shoot(frame, 'tool-unix-time-03-gap.png');

    // §2.7, §2.8 — an HTTP date; a Java zoned date-time.
    await field.fill('Tue, 14 Nov 2023 22:13:20 GMT');
    const http = await value('seconds');
    await field.fill('2023-11-14T23:13:20+01:00[Europe/Berlin]');
    check(
      `${T}: an HTTP date and a zoned date-time read as 1700000000 (§2.7, §2.8)`,
      http === '1700000000' && (await value('seconds')) === '1700000000' && (await messages()).length === 0,
    );

    // §2.9 — an ambiguous date: the error under the field, read out politely, the rows empty.
    await field.fill('01/02/2024');
    const error = (await messages()).join('|');
    check(
      `${T}: 01/02/2024 is refused with both readings (§2.9)`,
      error === '01/02/2024 is ambiguous: January 2 or February 1. Write 2024-01-02 or 2024-02-01.' &&
        (await field.getAttribute('aria-invalid')) === 'true' &&
        (await page.locator('#unix-time-messages').getAttribute('role')) === 'status' &&
        (await page.getByRole('button', { name: 'Copy seconds', exact: true }).isDisabled()),
      error,
    );
    await shoot(frame, 'tool-unix-time-04-error.png');

    // §8 — the zone picker: search by a word, the keyboard, Enter.
    await field.fill('1700000000');
    await picker.click();
    await picker.pressSequentially('kolkata');
    const options = await page.getByRole('option').allInnerTexts();
    check(
      `${T}: the zone picker finds Kolkata by a word`,
      options.length === 1 && options[0].replace(/\s+/g, ' ').trim() === 'Asia/Kolkata UTC+05:30',
      options.join(' | '),
    );
    await picker.fill('');
    await picker.pressSequentially('+05:45');
    await settle();
    await shoot(page, 'tool-unix-time-05-zone-search.png');
    await picker.fill('kolkata');
    await picker.press('Enter');
    check(
      `${T}: Enter chooses the zone; its rows and line follow`,
      (await picker.inputValue()) === 'Asia/Kolkata' &&
        (await value('isoZone')) === '2023-11-15T03:43:20+05:30' &&
        (await zoneLine()) === 'UTC+05:30 · India Standard Time',
    );

    // §2.10 — Now writes the current milliseconds into the field and the instant stops.
    await page.getByRole('button', { name: 'Now', exact: true }).click();
    const written = await field.inputValue();
    const focused = await page.evaluate(() => document.activeElement?.id);
    check(
      `${T}: Now writes the current milliseconds and focuses the field`,
      /^\d{13}$/.test(written) && Math.abs(Number(written) - Date.now()) < 60_000 && focused === 'unix-time-input',
      written,
    );
    await page.getByRole('button', { name: 'Clear', exact: true }).click();
    check(
      `${T}: Clear empties the field and the time runs again`,
      (await field.inputValue()) === '' && (await messages()).join('|') === 'Showing the current time.',
    );

    // History: a copied row is kept; the tool's Recent entries opens it back with the unit and the zone.
    await field.fill('2023-11-14T22:13');
    await page.getByRole('button', { name: 'Copy seconds', exact: true }).click();
    await sleep(400); // the commit is written to IndexedDB
    await page.reload();
    await field.waitFor();
    await stubClipboard();
    await page.locator('.kit-tool-history-recent summary').click();
    const recent = page.locator('.kit-tool-history-recent .kit-history-entry', {
      hasText: '2023-11-14T22:13 → 2023-11-14T16:43:00Z',
    });
    await recent.first().waitFor({ timeout: 3000 });
    await recent.first().getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor({ timeout: 3000 });
    check(
      `${T}: a copied row is kept in History and opens back with its zone`,
      (await field.inputValue()) === '2023-11-14T22:13' &&
        (await picker.inputValue()) === 'Asia/Kolkata' &&
        (await value('seconds')) === '1699980180',
    );

    // Node and Chrome agree whatever the machine's zone: the same inputs under three more browser zones.
    const answers = [];
    for (const [zone, shown] of [
      ['Asia/Kathmandu', 'Asia/Kathmandu'],
      ['Australia/Lord_Howe', 'Australia/Lord_Howe'],
      ['Asia/Calcutta', 'Asia/Kolkata'],
    ]) {
      await emulate(zone);
      await tool();
      await page.reload(); // a new document: the zone is read when the page starts
      await field.waitFor();
      const picked = await picker.inputValue();
      await field.fill('1970-01-01T00:00:00Z');
      const epoch = await value('seconds');
      await field.fill('2024-10-06T02:15[Australia/Lord_Howe]');
      const lordHowe = await value('seconds');
      await field.fill('1960-01-01T12:00[Africa/Monrovia]');
      const monrovia = await value('seconds');
      answers.push(`${zone}: ${picked} ${epoch} ${lordHowe} ${monrovia}`);
      check(
        `${T}: with the browser in ${zone} the default zone is ${shown} and the answers are Node's`,
        picked === shown && epoch === '0' && lordHowe === '1728143100' && monrovia === '-315573330',
        answers.at(-1),
      );
    }
    await emulate('Europe/Berlin');

    // From the start page: a pasted timestamp opens the tool with the field filled (§7, D16).
    await page.goto(`${base}#/start`);
    const start = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await start.waitFor();
    await start.focus();
    await page.evaluate(text => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, '1700000000000');
    await page.waitForFunction(() => location.hash === '#/tools/unix-time', null, { timeout: 5000 });
    await field.waitFor();
    check(
      `${T}: a timestamp pasted on the start page opens the tool with it`,
      (await field.inputValue()) === '1700000000000' && (await value('isoUtc')) === '2023-11-14T22:13:20Z',
    );

    // Dark: the default dark theme, then back to the system's.
    await page.goto(`${base}#/settings`);
    await page.getByRole('radio', { name: 'Dark' }).first().click();
    await page.locator('html[data-mode="dark"]').waitFor();
    await tool();
    await sleep(1100);
    await shoot(frame, 'tool-unix-time-06-dark-now.png');
    await field.fill('2024-10-27T02:30');
    await shoot(frame, 'tool-unix-time-07-dark-overlap.png');
    await field.fill('-000001-01-01T00:00:00Z');
    await shoot(frame, 'tool-unix-time-08-dark-before-year-1.png');
    await page.goto(`${base}#/settings`);
    await page.getByRole('radio', { name: 'System' }).first().click();
    await page.locator('html[data-mode="light"]').waitFor();
  } finally {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => undefined);
    await cdp.send('Emulation.setLocaleOverride', {}).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    await page
      .evaluate(() => {
        delete navigator.clipboard.writeText;
        delete document.documentElement.dataset.e2eCopied;
      })
      .catch(() => undefined);
  }
};
