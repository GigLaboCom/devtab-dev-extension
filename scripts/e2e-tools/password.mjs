// The Password Generator in the built extension (docs/tools/specs/password.md): its scenarios (§2) with the page's real
// controls, where the host lists it, and its one secret history kind (D17) end to end — the first tool to record a
// secret:
//   - without a master password a generated password is not written at all;
//   - with a throwaway master password made here, Generate writes one encrypted entry (no password, label or settings
//     in clear in IndexedDB);
//   - locked, the entry does not open (the tool says it is encrypted) and a Generate writes nothing;
//   - unlocked, History's "Open" brings the very password back into the tool;
//   - the master password is turned off again (its encrypted entries go with it), so later steps start as before.
// The master password and the generated passwords are never written to the report or the console, and the passwords
// are blurred in the screenshots. Copy is checked against a stand-in for navigator.clipboard.writeText in the page, so
// the run does not touch the system clipboard. Run by scripts/e2e-tools.mjs.

/* global document, indexedDB, window -- page.evaluate callbacks run in the page */

const T = 'Password Generator';
const DEFAULT_STRENGTH = '130 bits of entropy (20 characters from a set of 94, at least one of each chosen set)';

/** The rows of the history database (owner, kind, whether sealed, and the stored line), read without creating it. */
const historyRows = page =>
  page.evaluate(async () => {
    const db = await new Promise(res => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return [];
    const rows = await new Promise((res, rej) => {
      const r = db.transaction('records').objectStore('records').getAll();
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
    db.close();
    return rows.map(row => ({ owner: row.owner, kind: row.kind, kid: row.kid ?? null, line: row.line }));
  });

const passwordRows = async page => (await historyRows(page)).filter(r => r.owner === 'password');

import { themeMode } from '../e2e-theme.mjs';

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const opened = [];
  const open = async hash => {
    const p = await ctx.newPage();
    // Its console errors count against the run, as the main page's do.
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await p.goto(`${base}${hash}`);
    opened.push(p);
    return p;
  };
  const output = (p, n) =>
    p.getByLabel(n === undefined ? 'Generated password' : `Generated password ${n}`, { exact: true });
  const strength = p => p.locator('[data-strength]');
  const hint = p => p.locator('[data-hint]');
  /** Screenshots never show a generated password: blurred through the CSSOM (not a style attribute) while shooting. */
  const shot = async (p, file) => {
    const veil = on =>
      p.evaluate(blur => {
        for (const el of document.querySelectorAll('output[aria-label^="Generated password"]'))
          el.style.filter = blur ? 'blur(6px)' : '';
      }, on);
    // No focus ring on the last field typed into, and the colours settled (the controls fade in 180 ms).
    await p.evaluate(() => document.activeElement?.blur());
    await veil(true);
    await sleep(400);
    await shoot(p, file);
    await veil(false);
  };

  // Where the host lists the tool, with no list edited: the Tools list, the start page's field, Settings → History.
  await page.goto(`${base}#/tools/password`);
  await output(page).waitFor();
  check(
    `${T}: listed in Tools, its page titled and summarised by its definition`,
    (await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('list', { name: 'Tools' })
      .getByRole('link', { name: T })
      .count()) === 1 &&
      (await page.getByRole('heading', { name: T }).count()) === 1 &&
      /Kept only encrypted, with a master password\./.test(await page.locator('.kit-tool-page-summary').innerText()),
  );
  const start = await open('#/start');
  const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.fill('passphrase');
  const firstRow = await start.getByRole('option').first().innerText();
  check(`${T}: the start page's field finds it by a keyword`, firstRow.includes(T), firstRow.split('\n')[0]);
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  const groupText = await group.innerText();
  check(
    `${T}: Settings → History says what it keeps and never keeps`,
    groupText.includes('The passwords and passphrases you generated or copied, with their settings') &&
      groupText.includes('Generated passwords without a master password or while the history is locked'),
  );

  // §2.1: a password of 20 characters of the four sets, its strength, Copy.
  await page.bringToFront();
  const first = (await output(page).textContent()) ?? '';
  check(
    `${T}: opens with a password of 20 characters of all four sets and its strength`,
    first.length === 20 &&
      /[A-Z]/.test(first) &&
      /[a-z]/.test(first) &&
      /\d/.test(first) &&
      /[^A-Za-z0-9]/.test(first) &&
      (await strength(page).innerText()) === DEFAULT_STRENGTH,
    await strength(page).innerText(),
  );
  await page.evaluate(() => {
    window.__copied = [];
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: text => {
        window.__copied.push(text);
        return Promise.resolve();
      },
    });
  });
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
  const copied = await page.evaluate(() => window.__copied);
  check(`${T}: Copy copies exactly the password and says Copied`, copied.length === 1 && copied[0] === first);
  check(
    `${T}: says generated passwords are not kept without a master password, and so does the history line`,
    /Generated passwords are not kept \(no master password\)\./.test(await hint(page).innerText()) &&
      /keeps secrets only: nothing is kept without a master password\./.test(
        await page.locator('.kit-tool-history-line').innerText(),
      ),
  );
  await shot(page, 'tool-password-01-default.png');

  // §2.2: Symbols "-_!@".
  const symbols = page.getByLabel('Symbols to use');
  await symbols.fill('-_!@');
  const limited = (await output(page).textContent()) ?? '';
  check(
    `${T}: Symbols "-_!@" — a new password at once from 66 characters, 120 bits`,
    /^[A-Za-z0-9\-_!@]{20}$/.test(limited) &&
      /^120 bits of entropy \(20 characters from a set of 66,/.test(await strength(page).innerText()),
    await strength(page).innerText(),
  );
  await page.getByRole('button', { name: 'Reset', exact: true }).click();

  // §2.3: Avoid look-alike characters.
  await page.getByLabel('Avoid look-alike characters (0 O 1 I l |)').click();
  const plain = (await output(page).textContent()) ?? '';
  check(
    `${T}: Avoid look-alike characters — none of 0 O 1 I l |, 128 bits`,
    !/[0O1Il|]/.test(plain) && (await strength(page).innerText()).startsWith('128 bits of entropy'),
    await strength(page).innerText(),
  );
  await page.getByLabel('Avoid look-alike characters (0 O 1 I l |)').click();

  // §2.4: Words, then capitalized with spaces (the shadcn Select).
  await page.getByRole('radio', { name: 'Words' }).click();
  await page.getByText('Word list: EFF Large Wordlist (CC BY).').waitFor();
  await page.waitForFunction(() => document.querySelector('[data-strength]')?.textContent?.includes('words'));
  const phrase = (await output(page).textContent()) ?? '';
  check(
    `${T}: Words — six EFF words through hyphens, 77 bits`,
    /^[a-z]+(-[a-z]+){5,9}$/.test(phrase) &&
      (await strength(page).innerText()) === '77 bits of entropy (6 words from a list of 7,776)',
    await strength(page).innerText(),
  );
  await page.getByLabel('Capitalize words').click();
  await page.getByLabel('Separator').click();
  await page.getByRole('option', { name: 'Space', exact: true }).click();
  await page.waitForFunction(() =>
    /^[A-Z][a-z-]+( [A-Z][a-z-]+){5}$/.test(
      document.querySelector('output[aria-label="Generated password"]')?.textContent ?? '',
    ),
  );
  check(`${T}: Capitalize words and Space — "Word Word Word Word Word Word"`, true);
  await shot(page, 'tool-password-02-words.png');
  await page.getByRole('radio', { name: 'Random characters' }).click();

  // §2.5: a PIN.
  for (const name of ['Uppercase (A–Z)', 'Lowercase (a–z)', 'Symbols'])
    await page.getByLabel(name, { exact: true }).click();
  await page.getByLabel('Length', { exact: true }).fill('6');
  const pin = (await output(page).textContent()) ?? '';
  check(
    `${T}: Digits only, length 6 — six digits, 19 bits; the last set cannot be turned off`,
    /^\d{6}$/.test(pin) &&
      (await strength(page).innerText()) === '19 bits of entropy (6 characters from a set of 10)' &&
      (await page.getByLabel('Digits (0–9)', { exact: true }).isDisabled()),
    await strength(page).innerText(),
  );
  for (const name of ['Uppercase (A–Z)', 'Lowercase (a–z)', 'Symbols'])
    await page.getByLabel(name, { exact: true }).click();
  await page.getByLabel('Length', { exact: true }).fill('20');

  // §2.6: five passwords to choose from.
  await page.getByLabel('How many', { exact: true }).fill('5');
  await output(page, 5).waitFor();
  const five = [];
  for (let n = 1; n <= 5; n++) five.push((await output(page, n).textContent()) ?? '');
  await page.getByRole('button', { name: 'Copy password 3', exact: true }).click();
  await page.getByRole('button', { name: 'Copy all', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).first().waitFor();
  const copiedFive = await page.evaluate(() => window.__copied.slice(-2));
  check(
    `${T}: How many 5 — five passwords, each with its own Copy, and Copy all`,
    new Set(five).size === 5 &&
      five.every(v => v.length === 20) &&
      copiedFive[0] === five[2] &&
      copiedFive[1] === five.join('\n'),
  );
  await shot(page, 'tool-password-03-five.png');
  await page.getByLabel('How many', { exact: true }).fill('1');

  // §2.7: Length 200.
  await page.getByLabel('Length', { exact: true }).fill('200');
  const lengthError = page.getByText('Length must be a whole number from 4 to 128.');
  await lengthError.waitFor();
  check(
    `${T}: Length 200 — the message under the field, no password, Generate off`,
    (await page.getByLabel('Length', { exact: true }).getAttribute('aria-describedby')) ===
      (await lengthError.getAttribute('id')) &&
      (await output(page).textContent()) === '' &&
      (await page.getByRole('button', { name: 'Generate', exact: true }).isDisabled()),
  );
  await shot(page, 'tool-password-04-error.png');
  await page.getByLabel('Length', { exact: true }).fill('20');

  // The same page in the default dark theme.
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor();
  await shot(page, 'tool-password-05-default-dark.png');
  await page.getByRole('radio', { name: 'Words' }).click();
  await page.waitForFunction(() => document.querySelector('[data-strength]')?.textContent?.includes('words'));
  await shot(page, 'tool-password-06-words-dark.png');
  await page.getByRole('radio', { name: 'Random characters' }).click();
  await themeMode(ctx, base, 'System');
  await page.locator('html[data-mode="light"]').waitFor();

  // D17, the secret kind. No master password: nothing is written.
  const before = (await historyRows(page)).length;
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await sleep(500);
  check(
    `${T}: without a master password a generated password is not written at all`,
    (await passwordRows(page)).length === 0 && (await historyRows(page)).length === before,
  );

  // A master password made here and thrown away (never printed).
  const master = `e2e-${[...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36)).join('')}-Zz9`;
  await settings.bringToFront();
  await group.getByRole('button', { name: 'Set a master password…' }).click();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByLabel('The same again').fill(master);
  await group.getByLabel('I understand: forgotten means lost').click();
  await group.getByRole('button', { name: 'Set the master password' }).click();
  await group.getByText('The master password is set and the history is unlocked.').waitFor();

  await page.bringToFront();
  await page.waitForFunction(() =>
    document
      .querySelector('[data-hint]')
      ?.textContent?.includes('Generated passwords are kept encrypted in this browser.'),
  );
  check(`${T}: with the history unlocked, it says generated passwords are kept encrypted`, true);
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const secret = (await output(page).textContent()) ?? '';
  let rows = [];
  for (let i = 0; i < 40 && rows.length === 0; i++) {
    await sleep(100);
    rows = await passwordRows(page);
  }
  const all = await historyRows(page);
  const row = rows[0];
  const record = row ? JSON.parse(row.line) : {};
  check(
    `${T}: unlocked, Generate writes one encrypted entry — no password, label or settings in clear`,
    secret.length === 20 &&
      rows.length === 1 &&
      row.kind === 'generated' &&
      !!row.kid &&
      typeof record.sealed === 'object' &&
      record.payload === undefined &&
      record.label === undefined &&
      record.text === undefined &&
      !all.some(r => r.line.includes(secret)),
    rows.length === 1 ? `kind ${row.kind}, sealed ${typeof record.sealed === 'object'}` : `${rows.length} entries`,
  );

  // Locked: the entry stays shut and nothing new is written.
  const history = await open('#/history');
  await history.locator('[data-page="history"]').waitFor();
  await history.getByRole('button', { name: 'Lock now' }).click();
  await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
  const entry = history.locator('.kit-history-entry[data-kind="generated"]');
  await entry.waitFor();
  check(`${T}: History lists it as an encrypted entry`, /Encrypted entry/.test(await entry.innerText()));
  await entry.getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  const lockedText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: locked, opening the entry says it is encrypted and shows no kept password`,
    lockedText === 'This entry is encrypted: unlock the history to open it.' &&
      (await output(history).textContent()) !== secret,
    lockedText,
  );
  await history.waitForFunction(() =>
    document
      .querySelector('[data-hint]')
      ?.textContent?.includes('Generated passwords are not kept while the history is locked.'),
  );
  await history.getByRole('button', { name: 'Generate', exact: true }).click();
  await sleep(500);
  check(`${T}: locked, a Generate writes nothing`, (await passwordRows(history)).length === 1);

  // Unlocked again: History's Open brings the very password back.
  await settings.bringToFront();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('Unlocked.').waitFor();
  await history.bringToFront();
  await history.goto(`${base}#/history`);
  await history.locator('.kit-history-entry[data-kind="generated"]').getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  const restoredText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: unlocked, History's Open brings the generated password back into the tool`,
    (await output(history).textContent()) === secret &&
      restoredText === 'Opened from History: Password · 20 characters · 130 bits.' &&
      (await strength(history).innerText()) === DEFAULT_STRENGTH,
    restoredText,
  );

  // Turn the master password off again: its encrypted entries go, later steps start without one.
  await settings.bringToFront();
  await group.getByRole('button', { name: 'Turn off…' }).click();
  await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await group.getByText(/^The master password is off/).waitFor();
  await page.bringToFront();
  await page.reload();
  await output(page).waitFor();
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  await sleep(500);
  check(
    `${T}: with the master password off again, its entries are gone and nothing secret is written`,
    (await passwordRows(page)).length === 0 &&
      /Generated passwords are not kept \(no master password\)\./.test(await hint(page).innerText()),
  );

  for (const p of opened) await p.close();
};
