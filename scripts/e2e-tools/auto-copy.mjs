// "Copy automatically after generating" in the built extension (docs/tools/copying.md): the capability every generator
// declares (`output.origin: 'generated'`), checked across the tools that have it — so it is one module, not a part of
// each tool's own (run by scripts/e2e-tools.mjs like them; it runs first and leaves the setting off).
//   - Settings → Tools: one switch, off, listing the tools it applies to; flipping it upserts `autoCopy` into the entry
//     of each of them in chrome.storage.local, and a tool page already open follows it live;
//   - switched on, Generate in Password Generator and in UUID / ULID puts the result on the clipboard — a batch all of it,
//     one per line — and the copy button says Copied; a change of an option, opening a tool's page and opening an entry
//     from History copy nothing; switched off, Generate copies nothing.
// The clipboard is the test browser's own (a browser without a window keeps its own — the machine's is never touched),
// read and written with the permission granted through CDP (Browser.grantPermissions), as the compare checks do; a
// sentinel put on it before each step tells "not copied" from "copied". Generated passwords are not printed.

/* global document, chrome -- page.evaluate callbacks run in the page */

const T = 'Auto-copy';

export default async ({ ctx, page, base, id, check, sleep, report }) => {
  const origin = `chrome-extension://${id}`;
  // DevTools' permission overrides last as long as the session that set them: kept open until the end.
  const cdp = await ctx.newCDPSession(page);
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });
  const opened = [];
  const open = async hash => {
    const p = await ctx.newPage();
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  const read = p => p.evaluate(() => navigator.clipboard.readText());
  const put = (p, text) => p.evaluate(t => navigator.clipboard.writeText(t), text);
  const stored = p => p.evaluate(() => chrome.storage.local.get('toolSettings').then(r => r.toolSettings ?? null));
  const entriesSay = (record, value) =>
    record?.v === 1 &&
    record.all?.autoCopy === value &&
    record.tools?.password?.autoCopy === value &&
    record.tools?.uuid?.autoCopy === value &&
    Object.values(record.tools).every(entry => entry.autoCopy === value) &&
    !('json' in record.tools);

  try {
    // Settings → Tools.
    const settings = await open('#/settings');
    const group = settings.locator('[data-settings="tools"]');
    await group.waitFor();
    const toggle = group.getByRole('switch', { name: 'Copy automatically after generating' });
    const switched = value =>
      settings.waitForFunction(
        v => document.querySelector('[data-settings="tools"] [role="switch"]')?.getAttribute('aria-checked') === v,
        String(value),
      );
    const applies = await group.locator('[data-applies]').innerText();
    check(
      `${T}: Settings → Tools has one switch, off by default, with the tools it applies to`,
      (await toggle.getAttribute('aria-checked')) === 'false' &&
        /^Applies to: .*UUID \/ ULID, .*Password Generator.*\.$/.test(applies) &&
        !/JSON|Base64|URL|Hash/.test(applies) &&
        (await stored(settings)) === null,
      applies,
    );

    // Off: Generate copies nothing.
    const pw = await open('#/tools/password');
    const output = n => pw.getByLabel(n ? `Generated password ${n}` : 'Generated password', { exact: true });
    const generate = p => p.getByRole('button', { name: 'Generate', exact: true }).click();
    await output().waitFor();
    await put(pw, 'sentinel-off');
    await generate(pw);
    await sleep(300);
    check(`${T}: switched off, Generate in Password Generator copies nothing`, (await read(pw)) === 'sentinel-off');

    // On, from Settings; the tool page open in another tab follows it live.
    await settings.bringToFront();
    await toggle.click();
    await switched(true);
    const on = await stored(settings);
    check(
      `${T}: the switch upserts autoCopy into the entry of every tool it applies to (chrome.storage.local)`,
      entriesSay(on, true),
      JSON.stringify(on),
    );
    await pw.bringToFront();
    await generate(pw);
    await pw.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 3000 });
    const one = (await output().textContent()) ?? '';
    const said = await pw.locator('[aria-live="polite"]').textContent();
    check(
      `${T}: switched on (the open page followed), Generate in Password Generator puts the password on the clipboard, says Copied and announces it once`,
      one.length === 20 && (await read(pw)) === one && said === 'New password generated and copied',
      said ?? '',
    );

    // A change of an option makes new passwords and copies nothing; Generate copies the batch.
    await put(pw, 'sentinel-edit');
    await pw.getByLabel('How many', { exact: true }).fill('5');
    await output(5).waitFor();
    await sleep(300);
    check(`${T}: a change of How many makes five passwords and copies nothing`, (await read(pw)) === 'sentinel-edit');
    await generate(pw);
    await pw.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 3000 });
    const five = [];
    for (let n = 1; n <= 5; n++) five.push((await output(n).textContent()) ?? '');
    check(
      `${T}: a batch of five passwords is copied whole, one per line, no line break at the end — as Copy all`,
      new Set(five).size === 5 && (await read(pw)) === five.join('\n'),
    );
    await pw.getByLabel('How many', { exact: true }).fill('1');

    // Opening a tool's page copies nothing, while the setting is on.
    await put(settings, 'sentinel-open');
    const again = await open('#/tools/password');
    await again.getByLabel('Generated password', { exact: true }).waitFor();
    await sleep(500);
    check(`${T}: switched on, opening Password Generator copies nothing`, (await read(again)) === 'sentinel-open');

    const uu = await open('#/tools/uuid');
    const ids = uu.getByLabel('Generated identifiers');
    await ids.waitFor();
    await sleep(500);
    check(`${T}: switched on, opening UUID / ULID copies nothing`, (await read(uu)) === 'sentinel-open');
    await uu.getByLabel('How many').fill('3');
    await sleep(300);
    check(`${T}: a change of How many in UUID / ULID copies nothing`, (await read(uu)) === 'sentinel-open');
    await generate(uu);
    await uu.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 3000 });
    const batch = await ids.inputValue();
    check(
      `${T}: Generate in UUID / ULID copies the whole batch, as Copy all`,
      batch.split('\n').length === 3 &&
        (await read(uu)) === batch &&
        (await uu.locator('[aria-live="polite"]').textContent()) === '3 new identifiers generated and copied',
      batch.replaceAll('\n', ' '),
    );

    // Opening an entry from History copies nothing.
    await put(uu, 'sentinel-history');
    const history = await open('#/history');
    await history.locator('[data-page="history"]').waitFor();
    const entry = history.locator('.kit-history-entry[data-kind="generate"]', { hasText: 'UUID v4 · 3 identifiers' });
    await entry.first().waitFor({ timeout: 3000 });
    await entry.first().getByRole('button', { name: 'Open' }).click();
    await history.locator('[data-restored]').waitFor({ timeout: 3000 });
    await sleep(500);
    check(
      `${T}: switched on, opening a UUID entry from History brings it back and copies nothing`,
      (await history.getByLabel('Generated identifiers').inputValue()) === batch &&
        (await read(history)) === 'sentinel-history',
    );

    // Off again.
    await settings.bringToFront();
    await toggle.click();
    await switched(false);
    await uu.bringToFront();
    await put(uu, 'sentinel-off-again');
    await generate(uu);
    await sleep(300);
    const off = await stored(settings);
    check(
      `${T}: switched off again, every entry says so and Generate copies nothing`,
      entriesSay(off, false) && (await read(uu)) === 'sentinel-off-again',
      JSON.stringify(off),
    );
  } finally {
    for (const p of opened) await p.close();
    await cdp.send('Browser.resetPermissions').catch(() => undefined);
    await cdp.detach().catch(() => undefined);
  }
};
