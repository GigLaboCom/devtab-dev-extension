// The Date Calculator in the built extension (docs/tools/specs/date-calc.md): its scenarios (§2) with the page's real
// controls, in a page of its own whose time zone (Europe/Berlin) and language (en-US) are set through CDP and whose clock
// is its own (Now writes 2026-11-22T13:00:00+01:00), closed at the end — the shared tab keeps its history length, its
// zone and its real clock. Playwright's clock is never used (it belongs to the whole context and cannot be taken back).
//   - Difference across a clock change, with the reason; Add or subtract with a constrained day and a gap; the list of
//     zones built and reordered with the keyboard only, the focus staying with the row; Copy and Copy all (a stand-in for
//     navigator.clipboard.writeText, nothing reaches the machine's clipboard);
//   - Chrome's own Temporal (this browser has it; the extension's minimum, Chrome 116, does not) answers the same pairs
//     and additions as the page, on the same zone data;
//   - a copy is kept in History and opens back into its part from Recent entries;
//   - the start page opens the tool for a pasted ISO 8601 duration and for two moments on two lines, and still opens
//     Unix Time for one timestamp.
// Screenshots light and dark: tool-date-calc-NN-….png. Run by scripts/e2e-tools.mjs.

/* global document, location, DataTransfer, ClipboardEvent, Temporal -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';

const T = 'Date Calculator';

/**
 * A clock of this page alone (the x509 module's pattern). Playwright's own clock belongs to the whole browser context and
 * cannot be taken back; this replaces `Date` in the one page from its first script on, and timers keep running.
 */
const pageClock = fixed => {
  const RealDate = Date;
  class PageDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(fixed);
      else super(...args);
    }
    static now() {
      return fixed;
    }
  }
  globalThis.Date = PageDate;
};

export default async ({ ctx, base, check, shoot, sleep, report }) => {
  const p = await ctx.newPage();
  await p.setViewportSize({ width: 1280, height: 2600 });
  p.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
  });
  p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  const requests = [];
  p.on('request', r => requests.push(r.url()));

  const field = label => p.locator(`input#date-calc-${label}`);
  const picker = name => p.getByRole('combobox', { name, exact: true });
  const frame = p.locator('[data-slot="tool-page"]');
  const part = id => p.locator(`[data-part="date-calc-${id}"]`);
  const messages = id => p.locator(`#date-calc-${id}-messages p`).allInnerTexts();
  const rows = async id =>
    Object.fromEntries(
      await part(id)
        .locator('[data-slot="result-row"]')
        .evaluateAll(list =>
          list.map(r => [
            r.querySelector('.kit-result-row-label')?.textContent ?? '',
            r.querySelector('output')?.textContent ?? '',
          ]),
        ),
    );
  const notes = id => part(id).locator('[data-notes] p').allInnerTexts();
  const zoneRows = () =>
    p
      .locator('[data-zone-row]')
      .evaluateAll(list =>
        list.map(tr => [
          tr.dataset.zoneRow,
          tr.querySelector('[data-local]')?.textContent ?? '',
          tr.querySelector('[data-offset]')?.textContent ?? '',
          tr.querySelector('[data-dst]')?.textContent ?? '',
        ]),
      );
  const focused = () =>
    p.evaluate(() => document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.id);
  const shot = file => settledShot(shoot, frame, file);
  const tool = async () => {
    await p.goto(`${base}#/tools/date-calc`);
    // The tool's own element, not the heading: the page says "Loading…" until its history is open.
    await field('from').waitFor({ timeout: 15_000 });
  };
  const chooseZone = async (name, query) => {
    const box = picker(name);
    await box.focus();
    await box.press('ArrowDown');
    await box.fill(query);
    await box.press('Enter');
  };

  const cdp = await ctx.newCDPSession(p);
  let clipboard;
  try {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' });
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' });
    await p.addInitScript(pageClock, Date.parse('2026-11-22T12:00:00.789Z'));
    await tool();
    clipboard = await stubClipboard(p);

    // §8 the empty state.
    check(
      `${T}: opens empty — three parts, fields in the browser's zone, the browser's zone and UTC listed, no time shown`,
      (await p.locator('h3').allInnerTexts()).join('|') === 'Difference|Add or subtract|Time zones' &&
        (await picker('From time zone').inputValue()) === 'Europe/Berlin' &&
        JSON.stringify(await zoneRows()) ===
          JSON.stringify([
            ['Europe/Berlin', '', '', ''],
            ['UTC', '', '', ''],
          ]) &&
        (await p.locator('[data-slot="result-row"]').count()) === 0 &&
        (await p.getByRole('button', { name: 'Copy all', exact: true }).isDisabled()),
    );
    await shot('tool-date-calc-01-empty.png');

    // §2.1 days between across a clock change.
    await field('from').fill('2024-03-01');
    await field('to').fill('2024-04-01');
    await part('difference').locator('[data-row="isoExact"]').waitFor();
    const diff = await rows('difference');
    check(
      `${T}: §2.1 1 March → 1 April in Berlin — 1 month, 31 calendar days, 30 days 23 hours exact, PT743H, and why`,
      diff.Calendar === '1 month' &&
        diff['Calendar days'] === '31 days' &&
        diff.Exact === '30 days, 23 hours' &&
        diff['Total hours'] === '743' &&
        diff['ISO 8601, calendar'] === 'P1M' &&
        diff['ISO 8601, exact'] === 'PT743H' &&
        (await notes('difference')).join('|') ===
          'Calendar days and exact time differ by 1 hour: Europe/Berlin changed its clocks between the two moments (+01:00 at From, +02:00 at To). Clock changes: 2024-03-31T02:00 → 03:00 (+01:00 → +02:00).',
      JSON.stringify(diff),
    );
    await p.getByRole('button', { name: 'Copy total days', exact: true }).click();
    check(
      `${T}: a total marked ≈ copies the number without it`,
      (await clipboard.copied()).at(-1) === '30.958333',
      (await clipboard.copied()).at(-1),
    );
    await shot('tool-date-calc-02-difference.png');

    // §2.2–§2.4 Add or subtract.
    await chooseZone('Start time zone', 'utc');
    await field('start').fill('2024-01-31T10:00:00Z');
    await field('duration').fill('1 month');
    await part('shift').locator('[data-row="elapsed"]').waitFor();
    const month = await rows('shift');
    check(
      `${T}: §2.2 January 31 + 1 month is February 29, said in a note`,
      month['Result, UTC'] === '2024-02-29T10:00:00+00:00' &&
        month['Elapsed (exact)'] === '29 days' &&
        (await notes('shift')).join('|') === 'Day 31 does not exist in February 2024: the last day, 29, is used.' &&
        (await messages('duration')).join('|') === 'Read as P1M (1 month).',
      JSON.stringify(month),
    );
    await chooseZone('Start time zone', 'berlin');
    await field('start').fill('2024-03-30T02:30');
    await field('duration').fill('1d');
    await p.locator('[data-row="result"] output', { hasText: '2024-03-31T03:30:00+02:00' }).waitFor();
    check(
      `${T}: §2.4 a result in the gap moves forward and the page says so`,
      (await notes('shift'))[0] ===
        '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. The result is 2024-03-31T03:30:00+02:00.',
    );
    await shot('tool-date-calc-03-add.png');

    // §2.9 Now — the page's own clock.
    await p.getByRole('button', { name: 'Now: Start', exact: true }).click();
    check(
      `${T}: §2.9 Now writes the current second in the field's zone (the page's clock)`,
      (await field('start').inputValue()) === '2026-11-22T13:00:00+01:00',
      await field('start').inputValue(),
    );

    // §2.5 the list of zones, with the keyboard only.
    await field('moment').fill('2024-03-31T10:30:00Z');
    await chooseZone('Add a time zone', 'tokyo');
    await p.locator('[data-zone-row="Asia/Tokyo"] [data-local]').waitFor();
    const listed = await zoneRows();
    check(
      `${T}: §2.5 Tokyo added by typing and Enter; each row its local time, offset and daylight saving`,
      JSON.stringify(listed) ===
        JSON.stringify([
          ['Europe/Berlin', '2024-03-31T12:30:00+02:00', 'UTC+02:00', 'Daylight saving time (+1 hour)'],
          ['UTC', '2024-03-31T10:30:00+00:00', 'UTC+00:00', 'No daylight saving in 2024'],
          ['Asia/Tokyo', '2024-03-31T19:30:00+09:00', 'UTC+09:00', 'No daylight saving in 2024'],
        ]),
      JSON.stringify(listed),
    );
    await p.getByRole('button', { name: 'Move Asia/Tokyo up', exact: true }).focus();
    await p.keyboard.press('Enter');
    await p.keyboard.press('Enter');
    const order = (await zoneRows()).map(r => r[0]).join('|');
    check(
      `${T}: Enter on Move up twice puts Tokyo first; the focus moves to its Move down at the top`,
      order === 'Asia/Tokyo|Europe/Berlin|UTC' && (await focused()) === 'Move Asia/Tokyo down',
      `${order} · ${await focused()}`,
    );
    // Move up is off at the top, so Shift+Tab skips it: Copy, (Move up), Move down, Remove.
    await p.keyboard.press('Shift+Tab');
    const beforeDown = await focused();
    await p.keyboard.press('Tab');
    await p.keyboard.press('Tab');
    check(
      `${T}: the row's buttons in Tab order — Copy, Move down (Move up off at the top), Remove`,
      beforeDown === 'Copy time in Asia/Tokyo' && (await focused()) === 'Remove Asia/Tokyo',
      `${beforeDown} · ${await focused()}`,
    );
    await p.getByRole('button', { name: 'Copy all', exact: true }).click();
    check(
      `${T}: Copy all copies RFC 9557 lines in the list's order`,
      (await clipboard.copied()).at(-1) ===
        '2024-03-31T19:30:00+09:00[Asia/Tokyo]\n2024-03-31T12:30:00+02:00[Europe/Berlin]\n2024-03-31T10:30:00+00:00[UTC]',
    );
    await shot('tool-date-calc-04-zones.png');

    // Chrome's Temporal, on the same zone data, against the page.
    const pairs = [
      ['2024-03-01', '2024-04-01', 'Europe/Berlin'],
      ['2024-02-29', '2025-02-28', 'UTC'],
      ['2011-12-29', '2011-12-31', 'Pacific/Apia'],
      ['2024-10-05', '2024-10-07', 'Australia/Lord_Howe'],
      ['2018-11-03', '2018-11-05', 'America/Sao_Paulo'],
    ];
    const agree = [];
    for (const [from, to, zone] of pairs) {
      await chooseZone('From time zone', zone);
      await chooseZone('To time zone', zone);
      await field('from').fill(from);
      await field('to').fill(to);
      await sleep(50);
      const shown = await rows('difference');
      const temporal = await p.evaluate(
        ([a, b, z]) => {
          const start = Temporal.PlainDate.from(a).toZonedDateTime(z);
          const end = Temporal.PlainDate.from(b).toZonedDateTime(z);
          return [
            start.until(end, { largestUnit: 'years' }).toString(),
            start.toInstant().until(end.toInstant(), { largestUnit: 'hours' }).toString(),
          ];
        },
        [from, to, zone],
      );
      agree.push(`${zone} ${shown['ISO 8601, calendar']}/${temporal[0]} ${shown['ISO 8601, exact']}/${temporal[1]}`);
      check(
        `${T}: ${from} → ${to} in ${zone} — the page and Chrome's Temporal agree`,
        shown['ISO 8601, calendar'] === temporal[0] && shown['ISO 8601, exact'] === temporal[1],
        agree.at(-1),
      );
    }
    // A zone whose rules the browser's data has changed: the row says what Chrome's own data says.
    await field('moment').fill('2027-01-15T12:00:00Z');
    await chooseZone('Add a time zone', 'vancouver');
    await p.locator('[data-zone-row="America/Vancouver"] [data-local]').waitFor();
    const vancouver = await p.locator('[data-zone-row="America/Vancouver"] [data-offset]').innerText();
    const chromeSays = await p.evaluate(
      () => Temporal.Instant.from('2027-01-15T12:00:00Z').toZonedDateTimeISO('America/Vancouver').offset,
    );
    check(
      `${T}: America/Vancouver in January 2027 — the row's offset is Chrome's own data (${chromeSays})`,
      vancouver === `UTC${chromeSays}`,
      vancouver,
    );

    // History: a copy is kept and opens back into its part from Recent entries.
    await chooseZone('Start time zone', 'utc');
    await field('start').fill('2024-01-31T10:00:00Z');
    await field('duration').fill('P1M');
    await p.getByRole('button', { name: 'Copy result in UTC', exact: true }).click();
    const record = await waitForHistoryRecord(p, 'date-calc', r => r.kind === 'shift' && /P1M/.test(r.label ?? ''));
    await p.reload(); // a new document: the page opens empty, the entry comes back from History
    await field('from').waitFor({ timeout: 15_000 });
    await p.locator('.kit-tool-history-recent summary').click();
    const recent = p.locator('.kit-tool-history-recent .kit-history-entry', { hasText: record.label });
    await recent.first().waitFor({ timeout: 5000 });
    await recent.first().getByRole('button', { name: 'Open' }).click();
    await p.locator('[data-restored]').waitFor({ timeout: 5000 });
    check(
      `${T}: a copied result is kept in History and opens back into Add or subtract`,
      record.label === '2024-01-31T10:00:00Z + P1M → 2024-02-29T10:00:00+00:00' &&
        (await field('start').inputValue()) === '2024-01-31T10:00:00Z' &&
        (await field('duration').inputValue()) === 'P1M' &&
        (await picker('Start time zone').inputValue()) === 'UTC' &&
        (await field('from').inputValue()) === '',
      `${record.label} · ${await field('start').inputValue()} · ${await field('duration').inputValue()} · ${await picker('Start time zone').inputValue()} · from "${await field('from').inputValue()}"`,
    );

    // The start page: a duration and two moments open this tool; one timestamp still opens Unix Time.
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
    await paste('P3DT4H');
    await p.waitForFunction(() => location.hash === '#/tools/date-calc', null, { timeout: 5000 });
    await field('duration').waitFor();
    check(
      `${T}: P3DT4H pasted on the start page opens the tool with the duration`,
      (await field('duration').inputValue()) === 'P3DT4H' &&
        (await messages('duration')).join('|') === 'Read as P3DT4H (3 days, 4 hours).',
    );
    await paste('2024-03-01\n2024-04-01');
    await p.waitForFunction(() => location.hash === '#/tools/date-calc', null, { timeout: 5000 });
    await field('from').waitFor();
    await part('difference').locator('[data-row="calendar"]').waitFor();
    check(
      `${T}: two dates pasted on two lines open the tool in Difference`,
      (await field('from').inputValue()) === '2024-03-01' &&
        (await field('to').inputValue()) === '2024-04-01' &&
        (await rows('difference')).Calendar === '1 month',
    );
    await paste('1700000000');
    await p.waitForFunction(() => location.hash === '#/tools/unix-time', null, { timeout: 5000 });
    check(`${T}: one timestamp still opens Unix Time`, true);

    // Dark.
    await inDarkTheme(ctx, base, p, async () => {
      await tool();
      await field('from').fill('2024-10-27');
      await field('to').fill('2024-10-28');
      await field('start').fill('2024-10-26T02:30');
      await field('duration').fill('P1D');
      await field('moment').fill('2024-03-31T10:30:00Z');
      await chooseZone('Add a time zone', 'lord howe');
      await p.locator('[data-zone-row="Australia/Lord_Howe"] [data-local]').waitFor();
      await shot('tool-date-calc-05-dark.png');
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
    // The zone list and the operation are saved parameters (D21): the next module opens the tool with its defaults.
    await forgetSavedParameters(p, 'date-calc').catch(() => undefined);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => undefined);
    await cdp.send('Emulation.setLocaleOverride', {}).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
    await p.close();
  }
};
