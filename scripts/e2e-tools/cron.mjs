// The Cron tool in the built extension (docs/tools/specs/cron.md): its scenarios (§2) the way a person does them — the
// page's real controls — run by scripts/e2e-tools.mjs. Nothing of the machine is trusted: DevTools emulates the
// browser's zone (Europe/Berlin, then a southern, a half-hour and a western zone) and en-US; the page's clock
// (`Date.now`) is set to the moment of each scenario and its clipboard is the page's own stand-in. All three are put
// back before the module ends, also when a check throws.
// Screenshots: tool-cron-01 … (light), tool-cron-0N-dark-… (the default dark theme).

/* global document, window, location, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Cron';
const NOW = '2026-11-19T18:30:00Z'; // §2: Thursday
const DST_LINE =
  'Daylight saving time: a job at a fixed time runs once — when the clocks move forward, or on the first pass of a repeated hour. Other jobs follow the clock (Vixie cron).';

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const cdp = await page.context().newCDPSession(page);
  const emulate = async timezoneId => {
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId });
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' });
  };
  const field = page.getByLabel('Expression', { exact: true });
  const picker = page.getByRole('combobox', { name: 'Time zone', exact: true });
  const frame = page.locator('[data-slot="tool-page"]');
  const readAs = () => page.locator('#cron-read-as p').innerText();
  const description = () => page.locator('[data-description]').innerText();
  const notes = () => page.locator('[data-notes] p').allInnerTexts();
  const headers = () => page.locator('[data-runs] thead th').allInnerTexts();
  const rows = () =>
    page
      .locator('[data-runs] tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.querySelectorAll('td')].map(td => td.textContent ?? '')));
  /** The page's clock reads `iso` now and runs on from there (the tool reads only Date.now). */
  const setClock = iso =>
    page.evaluate(t => {
      window.__e2eRealNow ??= Date.now;
      const real = window.__e2eRealNow;
      const start = real();
      Date.now = () => t + (real() - start);
    }, Date.parse(iso));
  const restoreClock = () =>
    page.evaluate(() => {
      if (window.__e2eRealNow) Date.now = window.__e2eRealNow;
      delete window.__e2eRealNow;
    });
  /**
   * Another address of the same document without a new entry in the tab's history: the session history holds 50, and
   * the modules after this one count what their own steps add to it.
   */
  const go = hash => page.evaluate(url => location.replace(url), `${base}${hash}`);
  /** The tool mounted afresh at the clock's moment (a hash change leaves the document and its stubs as they are). */
  const openAt = async (iso, expression) => {
    await setClock(iso);
    await go('#/tools');
    await page.waitForFunction(() => location.hash === '#/tools');
    await go('#/tools/cron');
    await field.waitFor();
    if (expression !== undefined) await field.fill(expression);
  };
  const chooseZone = async (query, zone) => {
    await picker.click();
    await picker.fill(query);
    await page
      .getByRole('option', { name: new RegExp(`^${zone}`) })
      .first()
      .click();
  };
  const chooseOption = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const settle = () => sleep(250); // a select closing, the copy button's words

  let clipboard;
  try {
    await emulate('Europe/Berlin');
    await page.goto(`${base}#/tools/cron`);
    await page.reload(); // the browser's zone is read when the page starts
    await field.waitFor();
    clipboard = await stubClipboard(page);

    // §8 — the empty state.
    await openAt(NOW);
    check(
      `${T}: the empty state — the defaults, nothing described, the copy buttons off (§8)`,
      (await field.inputValue()) === '' &&
        (await field.getAttribute('placeholder')) === '0 9 * * 1-5' &&
        (await field.getAttribute('spellcheck')) === 'false' &&
        (await page.getByLabel('Dialect', { exact: true }).innerText()) === 'Auto' &&
        (await picker.inputValue()) === 'UTC' &&
        (await page.getByLabel('Runs', { exact: true }).innerText()) === '10' &&
        (await description()) === '' &&
        (await rows()).length === 0 &&
        (await page.getByRole('button', { name: 'Copy description' }).isDisabled()) &&
        (await page.getByRole('button', { name: 'Copy runs' }).isDisabled()),
    );
    await settledShot(shoot, frame, 'tool-cron-01-empty.png');

    // §2.1 — weekdays at nine, with the browser's zone beside the chosen one.
    await field.fill('0 9 * * 1-5');
    await sleep(1100); // the In column follows the clock: its first tick
    const first = await rows();
    check(
      `${T}: 0 9 * * 1-5 — Read as, the description, the runs in UTC and in the browser's zone (§2.1)`,
      (await readAs()) === 'Read as: Unix cron (5 fields)' &&
        (await description()) === 'At 09:00, Monday through Friday' &&
        JSON.stringify(await headers()) === JSON.stringify(['When', 'Local (Europe/Berlin)', 'In', 'Note']) &&
        JSON.stringify(first.slice(0, 2)) ===
          JSON.stringify([
            ['Fri 2026-11-20 09:00 UTC', 'Fri 2026-11-20 10:00 +01:00', 'in 14 hours', ''],
            ['Mon 2026-11-23 09:00 UTC', 'Mon 2026-11-23 10:00 +01:00', 'in 3 days', ''],
          ]) &&
        first.length === 10,
      JSON.stringify(first.slice(0, 2)),
    );
    await settledShot(shoot, frame, 'tool-cron-02-weekdays.png');

    // §2.2, §2.3 — the two day rules and their notes.
    await field.fill('0 0 1 * MON');
    const or = await notes();
    const orRuns = (await rows()).slice(0, 4).map(r => r[0]);
    await field.fill('0 0 */2 * 1');
    const and = await notes();
    const andRuns = (await rows()).slice(0, 3).map(r => r[0].slice(4, 14));
    check(
      `${T}: OR when both day fields are set, AND when one starts with * — the notes and the days (§2.2, §2.3)`,
      or.join('|') ===
        'Runs when the day of month OR the day of week matches: cron does this when both fields are set.' &&
        orRuns.join('|') ===
          'Mon 2026-11-23 00:00 UTC|Mon 2026-11-30 00:00 UTC|Tue 2026-12-01 00:00 UTC|Mon 2026-12-07 00:00 UTC' &&
        and.join('|') === "One day field starts with *, so a day must match both fields (cron's rule)." &&
        andRuns.join('|') === '2026-11-23|2026-12-07|2026-12-21',
      `${or} ${orRuns} ${and} ${andRuns}`,
    );
    await settledShot(shoot, frame, 'tool-cron-03-and-rule.png');

    // §2.4 — Spring's six fields with ? read as Quartz; then the same text with seconds, by the Dialect select.
    await field.fill('0 0 12 ? * 2-6');
    const quartz = [await readAs(), await description(), (await notes()).join('|')];
    await chooseOption('Dialect', 'With seconds (6 fields)');
    const seconds = await readAs();
    await chooseOption('Dialect', 'Auto');
    check(
      `${T}: 0 0 12 ? * 2-6 — Quartz (6 fields), its day numbering; With seconds by hand (§2.4, §4)`,
      quartz.join('|') ===
        'Read as: Quartz (6 fields)|At 12:00, Monday through Friday|Quartz numbers days from 1 = Sunday to 7 = Saturday.' &&
        seconds === 'Read as: Cron with seconds (6 fields)',
      `${quartz.join(' / ')} / ${seconds}`,
    );

    // §2.7 — an error under the field, with its column, read out politely.
    await field.fill('60 * * * *');
    check(
      `${T}: 60 * * * * — the error under the field with its column (§2.7, §6)`,
      (await readAs()) === 'Column 1: 60 is out of range for minute (0–59)' &&
        (await page.locator('#cron-read-as').getAttribute('role')) === 'status' &&
        (await field.getAttribute('aria-invalid')) === 'true' &&
        (await page.getByRole('button', { name: 'Copy runs' }).isDisabled()),
      await readAs(),
    );
    await settledShot(shoot, frame, 'tool-cron-04-error.png');

    // §2.8 — a whole crontab line.
    await field.fill('0 3 * * * /usr/local/bin/backup.sh');
    check(
      `${T}: a crontab line — the command is ignored (§2.8)`,
      (await readAs()) === 'Read as: crontab line — the command after the 5th field is ignored' &&
        (await description()) === 'At 03:00' &&
        (await rows())[0]?.[0] === 'Fri 2026-11-20 03:00 UTC',
    );

    // §2.6 — never: why, instead of the table.
    await field.fill('0 0 30 2 *');
    check(
      `${T}: 0 0 30 2 * — described, and why it never runs (§2.6)`,
      (await description()) === 'At 00:00, on day 30 of the month, only in February' &&
        (await page.locator('[data-no-runs]').innerText()) === 'This never runs: no selected month has day 30.' &&
        (await page.locator('[data-runs] table').count()) === 0,
    );

    // §3 — Copy description and Copy runs; Runs by its select.
    await field.fill('0 0 1 * MON');
    await chooseOption('Runs', '5');
    await page.getByRole('button', { name: 'Copy description' }).click();
    await page.getByRole('button', { name: 'Copy runs' }).click();
    await page.getByRole('button', { name: 'Copied' }).nth(1).waitFor({ timeout: 2000 });
    const copied = await clipboard.copied();
    check(
      `${T}: Copy description copies the words; Copy runs one ISO instant a line; Runs 5 (§3, §4)`,
      copied.at(-2) === 'At 00:00, on day 1 of the month, and on Monday' &&
        copied.at(-1) ===
          '2026-11-23T00:00:00+00:00\n2026-11-30T00:00:00+00:00\n2026-12-01T00:00:00+00:00\n2026-12-07T00:00:00+00:00\n2026-12-14T00:00:00+00:00' &&
        (await rows()).length === 5,
      JSON.stringify(copied.slice(-2)),
    );
    const kept = await waitForHistoryRecord(
      page,
      'cron',
      r => r.label === '0 0 1 * MON — At 00:00, on day 1 of the month, and on Monday',
    ).catch(() => null);
    check(`${T}: a copy is kept in History (commit)`, kept?.kind === 'explain', kept?.label);

    // §2.5 — the night the clocks move forward in Europe/Berlin; the zone picker finds the zone by a word.
    await openAt('2027-03-26T12:00:00Z', '30 2 * * *');
    await chooseZone('berlin', 'Europe/Berlin');
    await sleep(1100);
    const spring = await rows();
    check(
      `${T}: 30 2 * * * in Europe/Berlin — 03:00 +02:00 after the clocks moved forward, and the line under the table (§2.5)`,
      (await picker.inputValue()) === 'Europe/Berlin' &&
        JSON.stringify(await headers()) === JSON.stringify(['When', 'In', 'Note']) &&
        JSON.stringify(spring.slice(0, 3)) ===
          JSON.stringify([
            ['Sat 2027-03-27 02:30 +01:00', 'in 13 hours', ''],
            ['Sun 2027-03-28 03:00 +02:00', 'in 1 day', 'after the clocks moved forward'],
            ['Mon 2027-03-29 02:30 +02:00', 'in 2 days', ''],
          ]) &&
        (await page.locator('[data-dst-line]').innerText()) === DST_LINE,
      JSON.stringify(spring.slice(0, 3)),
    );
    await settledShot(shoot, frame, 'tool-cron-05-dst-forward.png');

    // The night the clocks move back: a fixed job once, */30 on both passes.
    await openAt('2027-10-30T12:00:00Z', '*/30 2 * * *');
    await chooseZone('berlin', 'Europe/Berlin');
    const autumn = (await rows()).slice(0, 4).map(r => `${r[0]} ${r[2]}`.trim());
    await field.fill('30 2 * * *');
    const once = (await rows()).slice(0, 2).map(r => r[0]);
    check(
      `${T}: the repeated hour in Europe/Berlin — both passes for */30, the first only for a fixed time`,
      autumn.join('|') ===
        'Sun 2027-10-31 02:00 +02:00|Sun 2027-10-31 02:30 +02:00|Sun 2027-10-31 02:00 +01:00 repeated hour, second pass|Sun 2027-10-31 02:30 +01:00 repeated hour, second pass' &&
        once.join('|') === 'Sun 2027-10-31 02:30 +02:00|Mon 2027-11-01 02:30 +01:00',
      `${autumn.join(' | ')} / ${once.join(' | ')}`,
    );
    await settledShot(shoot, frame, 'tool-cron-06-dst-back.png');

    // History: the kept entry opens back into the tool from its Recent entries.
    await page.reload();
    await field.waitFor();
    await page.locator('.kit-tool-history-recent summary').click();
    const recent = page.locator('.kit-tool-history-recent .kit-history-entry', { hasText: '0 0 1 * MON' });
    await recent.first().waitFor({ timeout: 5000 });
    await recent.first().getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor({ timeout: 5000 });
    check(
      `${T}: an entry opens back with its expression, zone and number of runs`,
      (await field.inputValue()) === '0 0 1 * MON' &&
        (await picker.inputValue()) === 'UTC' &&
        (await page.getByLabel('Runs', { exact: true }).innerText()) === '5',
    );

    // Node and Chrome agree whatever the browser's zone: the same answers with three other browser zones.
    for (const zone of ['Australia/Sydney', 'Asia/Kolkata', 'America/New_York']) {
      await emulate(zone);
      await page.reload();
      await field.waitFor();
      await openAt('2027-03-26T12:00:00Z', '30 2 * * *');
      const local = await headers();
      await chooseZone('berlin', 'Europe/Berlin');
      const berlin = (await rows()).slice(0, 3).map(r => `${r[0]}|${r.at(-1)}`);
      await openAt('2027-10-01T12:00:00Z', '30 2 * * *');
      await chooseZone('sydney', 'Australia/Sydney');
      const sydney = (await rows())[1]?.[0];
      check(
        `${T}: with the browser in ${zone}, UTC stays the default and the daylight-saving answers are Node's`,
        local.join('|') === `When|Local (${zone})|In|Note` &&
          berlin.join(' / ') ===
            'Sat 2027-03-27 02:30 +01:00| / Sun 2027-03-28 03:00 +02:00|after the clocks moved forward / Mon 2027-03-29 02:30 +02:00|' &&
          sydney === 'Sun 2027-10-03 03:00 +11:00',
        `${local.join(',')} · ${berlin.join(' / ')} · ${sydney}`,
      );
    }
    await emulate('Europe/Berlin');
    await page.reload();
    await field.waitFor();

    // From the start page: a pasted expression opens the tool; five ordinary words do not.
    const paste = async text => {
      await go('#/start');
      const start = page.getByRole('combobox', { name: 'Find a tool or search the web' });
      await start.waitFor();
      await start.fill('');
      await start.focus();
      await page.evaluate(value => {
        const data = new DataTransfer();
        data.setData('text/plain', value);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, text);
    };
    await paste('the quick brown fox jumps');
    await sleep(600);
    const stayed = await page.evaluate(() => location.hash);
    await paste('*/15 * * * *');
    await page.waitForFunction(() => location.hash === '#/tools/cron', null, { timeout: 5000 });
    await field.waitFor();
    check(
      `${T}: an expression pasted on the start page opens the tool with it; five words of text do not`,
      stayed !== '#/tools/cron' &&
        (await field.inputValue()) === '*/15 * * * *' &&
        (await description()) === 'Every 15 minutes',
      stayed,
    );

    // Dark: the default dark theme, then back.
    await inDarkTheme(ctx, base, page, async () => {
      await openAt(NOW, '0 0 */2 * 1');
      await sleep(1100);
      await settledShot(shoot, frame, 'tool-cron-07-dark-and-rule.png');
      await openAt('2027-03-26T12:00:00Z', '30 2 * * *');
      await chooseZone('berlin', 'Europe/Berlin');
      await sleep(1100);
      await settledShot(shoot, frame, 'tool-cron-08-dark-dst-forward.png');
      await field.fill('0 0 * * 1#6');
      await settle();
      await settledShot(shoot, frame, 'tool-cron-09-dark-error.png');
      await picker.click();
      await picker.fill('kolkata');
      await settle();
      await shoot(page, 'tool-cron-10-dark-zone-search.png');
      await picker.press('Escape');
    });
  } finally {
    await restoreClock().catch(() => undefined);
    await clipboard?.restore().catch(() => undefined);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: '' }).catch(() => undefined);
    await cdp.send('Emulation.setLocaleOverride', {}).catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
};
