// The Password Hash tool in the built extension (docs/tools/specs/password-hash.md): where the host lists it, its
// scenarios (§2) with the page's real controls, the work in a module worker of the package (its address, the page free
// of long tasks while it runs, Cancel terminating it), a pasted hash opening it from the start page (§7), and the
// password as a secret (§11):
//   - nothing of the password in the console, the page's address, the clipboard (only the hash, on Copy), IndexedDB,
//     localStorage or chrome.storage;
//   - without a master password nothing is written; with a throwaway master password made here, a Hash writes one
//     encrypted entry (no hash, label or payload in clear); locked, it does not open; unlocked, History's "Open" brings
//     the hash and its parameters back with the password field empty; the master password is turned off again;
//   - the algorithm, its cost and the format are saved parameters (D21): the tool opened again shows them, never the
//     password or the user.
// Only test passwords and the specification's vectors are used; the master password is never written anywhere.
// Copy is checked against a stand-in for navigator.clipboard.writeText (restored at the end). Run by scripts/e2e-tools.mjs.

/* global document, window, location, chrome, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { forgetSavedParameters, historyRecords, inDarkTheme, settledShot, stubClipboard } from '../e2e-helpers.mjs';

const T = 'Password Hash';
// A test password (not anybody's): the specification's own.
const PASSWORD = 'hunter2';
// A test secret key (pepper), not anybody's.
const PEPPER = 'e2e-pepper-not-a-secret';
// The specification's vectors (§10), not credentials.
const DJANGO = 'pbkdf2_sha256$10000$seasalt$CWWFdHOWwPnki7HvkcqN9iA2T3KLW1cf2uZ5kvArtVY='; // gitleaks:allow — Django test sample
const BCRYPT = '$2b$10$..CA.uOD/eaGAOmJB.yMBuu834GnnH8YqNEQajgI0v22.9vSJcuzK'; // gitleaks:allow — test vector (§10 row 29)

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
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
  // Every console message of the module's pages, to prove the password never reaches it.
  const consoleTexts = [];
  page.on('console', m => consoleTexts.push(m.text()));
  const password = p => p.getByLabel('Password', { exact: true });
  const result = p => p.locator('[data-result] output');
  const verdict = p => p.locator('[data-verdict]');
  const choose = async (p, label, option) => {
    await p.getByLabel(label, { exact: true }).click();
    await p.getByRole('option', { name: option, exact: true }).click();
  };
  const press = (p, name) => p.getByRole('button', { name, exact: true }).click();
  const mode = (p, name) => p.getByRole('radio', { name, exact: true }).click();
  const rowsOf = async p => (await historyRecords(p, 'password-hash')).length;

  // Where the host lists the tool, with no list edited.
  await page.goto(`${base}#/tools/password-hash`);
  await password(page).waitFor();
  check(
    `${T}: listed in Tools, its page titled and summarised by its definition`,
    (await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('list', { name: 'Tools' })
      .getByRole('link', { name: T, exact: true })
      .count()) === 1 &&
      (await page.locator('.kit-tool-page-summary').innerText()) ===
        'Create and verify bcrypt, Argon2, scrypt and PBKDF2 password hashes.',
  );
  check(
    `${T}: opens in Hash with Argon2id on RFC 9106's second option (64 MiB, t=3, p=4), says which is the recommendation and which the minimum, the secret key empty, Hash disabled`,
    (await page.getByLabel('Algorithm', { exact: true }).innerText()) === 'Argon2id' &&
      (await page.getByLabel('Memory (KiB)', { exact: true }).inputValue()) === '65536' &&
      (await page.getByLabel('Iterations', { exact: true }).inputValue()) === '3' &&
      (await page.getByLabel('Parallelism', { exact: true }).inputValue()) === '4' &&
      (await page.locator('[data-recommendation]').innerText()) ===
        'Recommended: m=65536 KiB, t=3, p=4 (RFC 9106, second recommended option). Warned below the minimum: m=19456 KiB with t=2 or an equal OWASP row.' &&
      (await page.locator('[data-warning]').count()) === 0 &&
      (await page.getByLabel('Secret key (pepper)', { exact: true }).inputValue()) === '' &&
      (await page.getByRole('button', { name: 'Hash', exact: true }).isDisabled()) &&
      (await page.getByText('Type a password, choose the algorithm and press Hash.').count()) === 1,
  );
  check(
    `${T}: the password field is a password field, with no spelling check or autocomplete and no form`,
    (await password(page).getAttribute('type')) === 'password' &&
      (await password(page).getAttribute('spellcheck')) === 'false' &&
      (await password(page).getAttribute('autocomplete')) === 'off' &&
      (await page.locator('form').count()) === 0,
  );
  const start = await open('#/start');
  const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.fill('htpasswd');
  const firstRow = await start.getByRole('option').first().innerText();
  check(`${T}: the start page's field finds it by a keyword`, firstRow.includes(T), firstRow.split('\n')[0]);
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  const groupText = await group.innerText();
  check(
    `${T}: Settings → History says what it keeps and never keeps`,
    groupText.includes('The hashes you made or checked, with the algorithm, parameters and format, only encrypted.') &&
      groupText.includes('The password, ever.'),
  );

  // §2.1: a password and Hash — an Argon2id PHC string; the work runs in the package's worker; Copy copies the hash.
  await page.bringToFront();
  const clipboard = await stubClipboard(page);
  await page.evaluate(() => {
    window.__long = [];
    new PerformanceObserver(list => list.getEntries().forEach(e => window.__long.push(e.duration))).observe({
      type: 'longtask',
    });
  });
  await password(page).fill(PASSWORD);
  await press(page, 'Hash');
  await result(page).waitFor();
  const hashed = await result(page).innerText();
  check(
    `${T}: §2.1 Hash gives an Argon2id PHC string with the new defaults and a random 16-byte salt`,
    /^\$argon2id\$v=19\$m=65536,t=3,p=4\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/.test(hashed) &&
      /^Argon2id · m=65536 KiB, t=3, p=4 · random 16-byte salt · [\d.]+ s$/.test(
        await page.locator('[data-summary]').innerText(),
      ),
    hashed.slice(0, 32),
  );
  await page.getByRole('button', { name: 'Copy hash' }).click();
  await sleep(100);
  check(
    `${T}: Copy copies the hash, never the password`,
    JSON.stringify(await clipboard.copied()) === JSON.stringify([hashed]),
  );
  await settledShot(shoot, page, 'tool-password-hash-01-argon2id.png');

  // The worker: a file of the package, alive only while the work runs.
  await choose(page, 'Algorithm', 'bcrypt');
  await page.getByLabel('Cost', { exact: true }).fill('14');
  await press(page, 'Hash');
  await page.locator('[data-working]').waitFor();
  await sleep(300);
  const workers = page.workers().map(w => w.url());
  await result(page).waitFor({ timeout: 30_000 });
  await sleep(200);
  check(
    `${T}: the work runs in a module worker of the package (assets/password-hash.worker-*.js), gone after the answer`,
    workers.length === 1 &&
      /^chrome-extension:\/\/[a-p]{32}\/assets\/password-hash\.worker-[\w-]+\.js$/.test(workers[0]) &&
      page.workers().length === 0,
    workers.join(', '),
  );
  // Cancel: cost 18 takes about 15 s; Cancel ends it at once.
  await page.getByLabel('Cost', { exact: true }).fill('18');
  await press(page, 'Hash');
  await page.locator('[data-working]').waitFor();
  await page.waitForFunction(
    () => /Hashing… 1 s/.test(document.querySelector('[data-working]')?.textContent ?? ''),
    null,
    {
      timeout: 5_000,
    },
  );
  await settledShot(shoot, page, 'tool-password-hash-02-working.png');
  const busy = page.workers().length;
  await press(page, 'Cancel');
  await page.locator('.kit-tool-message', { hasText: 'Cancelled.' }).waitFor();
  // Playwright hears of a terminated worker a moment later.
  for (let i = 0; i < 20 && page.workers().length > 0; i++) await sleep(100);
  check(
    `${T}: §2.7 a long hash says it is working ("Hashing… N s") and Cancel terminates its worker`,
    busy === 1 && page.workers().length === 0 && (await result(page).count()) === 0,
    `workers while hashing ${busy}, after Cancel ${page.workers().length}`,
  );
  const longTasks = await page.evaluate(() => window.__long);
  check(
    `${T}: no long task on the page while hashing (Argon2id, bcrypt 14 and 18)`,
    longTasks.length === 0,
    longTasks.join(', '),
  );

  // §2.2: htpasswd line.
  await page.getByLabel('Cost', { exact: true }).fill('10');
  await choose(page, 'Format', 'htpasswd line');
  await page.getByLabel('User', { exact: true }).fill('alice');
  await press(page, 'Hash');
  await result(page).waitFor();
  check(
    `${T}: §2.2 bcrypt as an htpasswd line — alice:$2y$10$…`,
    /^alice:\$2y\$10\$[./A-Za-z0-9]{53}$/.test(await result(page).innerText()),
  );
  await settledShot(shoot, page, 'tool-password-hash-03-htpasswd.png');

  // §2.7: beyond the limits.
  await page.getByLabel('Cost', { exact: true }).fill('19');
  const costError = page.getByText('Cost must be a whole number from 4 to 18.', { exact: true });
  await costError.waitFor();
  check(
    `${T}: a cost beyond the limits — the reason under its field (role status), Hash disabled`,
    (await costError.getAttribute('role')) === 'status' &&
      (await page.getByRole('button', { name: 'Hash', exact: true }).isDisabled()),
  );

  // §2.3–§2.4: Verify a Django string; the warnings; Does not match, then Matches.
  await mode(page, 'Verify');
  await page.getByLabel('Hash', { exact: true }).fill(DJANGO);
  await password(page).fill('letmein');
  await press(page, 'Verify');
  await verdict(page).waitFor();
  const no = await verdict(page).innerText();
  await password(page).fill('lètmein');
  await press(page, 'Verify');
  await page.locator('[data-verdict="match"]').waitFor();
  check(
    `${T}: §2.3 a Django string — read (PBKDF2-HMAC-SHA256, Django, 10,000 iterations), below OWASP, Does not match then Matches`,
    no === 'Does not match: this password gives a different hash.' &&
      (await page.locator('[data-row="Algorithm"]').innerText()) === 'PBKDF2-HMAC-SHA256' &&
      (await page.locator('[data-row="Format"]').innerText()) === 'Django' &&
      (await page.locator('[data-row="Parameters"]').innerText()) === '10,000 iterations' &&
      (await page
        .getByText('Below the OWASP minimum for PBKDF2-HMAC-SHA256: use 600,000 iterations or more.')
        .count()) === 1 &&
      (await verdict(page).innerText()) === 'Matches: this password gives this hash.',
    no,
  );
  await settledShot(shoot, page, 'tool-password-hash-04-verify.png');
  // The Argon2id string made above verifies with its password (Hash and Verify agree in Chrome).
  await page.getByLabel('Hash', { exact: true }).fill(hashed);
  await password(page).fill(PASSWORD);
  await press(page, 'Verify');
  await page.locator('[data-verdict="match"]').waitFor();
  check(`${T}: the Argon2id string made by Hash verifies with its password`, true);
  // §2.6: what it does not compute.
  await page.getByLabel('Hash', { exact: true }).fill('$6$rounds=5000$saltsalt$abcdefghijklmnop');
  await page
    .getByText('SHA-512-crypt ($6$) hashes are not supported: the tool reads bcrypt, Argon2, scrypt and PBKDF2.')
    .waitFor();
  await page.getByLabel('Hash', { exact: true }).fill('5f4dcc3b5aa765d61d8327deb882cf99');
  await page
    .getByText('This looks like a plain MD5 digest, not a password hash. Plain digests are compared in the Hash tool.')
    .waitFor();
  check(`${T}: §2.6 SHA-512-crypt and a plain MD5 digest are named, not checked`, true);
  await settledShot(shoot, page, 'tool-password-hash-05-unknown.png');

  // §5.10: the secret key (pepper) — a password field, not in the string; Verify needs it again.
  await mode(page, 'Hash');
  await choose(page, 'Algorithm', 'Argon2id');
  const key = page.getByLabel('Secret key (pepper)', { exact: true });
  check(
    `${T}: the secret key is a password field with a show/hide button, no spelling check or autocomplete`,
    (await key.getAttribute('type')) === 'password' &&
      (await key.getAttribute('spellcheck')) === 'false' &&
      (await key.getAttribute('autocomplete')) === 'off' &&
      (await page.getByRole('button', { name: 'Show secret key', exact: true }).getAttribute('aria-pressed')) ===
        'false',
  );
  await password(page).fill(PASSWORD);
  await key.fill(PEPPER);
  await page.getByText('The secret key is not part of the hash string: verifying needs the same key again.').waitFor();
  await press(page, 'Hash');
  await result(page).waitFor();
  const keyedHash = await result(page).innerText();
  await settledShot(shoot, page, 'tool-password-hash-08-secret-key.png');
  await mode(page, 'Verify');
  await page.getByLabel('Hash', { exact: true }).fill(keyedHash);
  await password(page).fill(PASSWORD);
  await page.getByLabel('Secret key (pepper)', { exact: true }).fill(PEPPER);
  await press(page, 'Verify');
  await page.locator('[data-verdict="match"]').waitFor();
  await page.getByLabel('Secret key (pepper)', { exact: true }).fill('');
  await press(page, 'Verify');
  await page.locator('[data-verdict="no-match"]').waitFor();
  check(
    `${T}: a hash made with a key — the string does not carry it; with the key it matches, without it it does not, and the page says what it cannot know`,
    /^\$argon2id\$v=19\$m=65536,t=3,p=4\$/.test(keyedHash) &&
      !keyedHash.includes(PEPPER) &&
      (await page.locator('[data-secret-unknown]').innerText()) ===
        'The hash string does not say whether a secret key (pepper) was used: with a missing or wrong key, even the right password does not match.',
  );
  await settledShot(shoot, page, 'tool-password-hash-09-secret-key-missing.png');

  // Dark theme screenshots.
  await inDarkTheme(ctx, base, page, async () => {
    await page.getByLabel('Hash', { exact: true }).fill(DJANGO);
    await password(page).fill('lètmein');
    await press(page, 'Verify');
    await page.locator('[data-verdict="match"]').waitFor();
    await settledShot(shoot, page, 'tool-password-hash-06-verify-dark.png');
    await mode(page, 'Hash');
    await choose(page, 'Algorithm', 'Argon2id');
    await password(page).fill(PASSWORD);
    await press(page, 'Hash');
    await result(page).waitFor();
    await settledShot(shoot, page, 'tool-password-hash-07-argon2id-dark.png');
  });

  // Saved parameters (D21): the algorithm, its cost and the format a person chose are written 400 ms after the change;
  // the tool opened again shows them — the password and the user empty, nothing of them in the stored record. In a page
  // of its own (this one carries the clipboard's stand-in), then forgotten: the steps below open with the defaults.
  {
    const own = await ctx.newPage();
    const stored = () =>
      own.evaluate(
        async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.['password-hash'],
      );
    await own.goto(`${base}#/tools/password-hash`);
    await password(own).waitFor();
    // The dark screenshots' last choice is written 400 ms after it: let it land before it is forgotten.
    await sleep(500);
    await forgetSavedParameters(own, 'password-hash');
    await own.reload();
    await password(own).waitFor();
    await password(own).fill(PASSWORD);
    await choose(own, 'Algorithm', 'bcrypt');
    await own.getByLabel('Cost', { exact: true }).fill('3'); // beyond the limits: not saved
    await own.getByLabel('Cost', { exact: true }).fill('11');
    await choose(own, 'Format', 'htpasswd line');
    await own.getByLabel('User', { exact: true }).fill('alice');
    for (let i = 0; i < 25 && (await stored())?.values?.format !== 'htpasswd'; i++) await sleep(200);
    const record = await stored();
    await own.reload();
    await password(own).waitFor();
    const kept = {
      algorithm: await own.getByLabel('Algorithm', { exact: true }).innerText(),
      cost: await own.getByLabel('Cost', { exact: true }).inputValue(),
      format: await own.getByLabel('Format', { exact: true }).innerText(),
      password: await password(own).inputValue(),
      user: await own.getByLabel('User', { exact: true }).inputValue(),
      warning: await own.locator('[data-warning]').count(),
    };
    check(
      `${T}: bcrypt, cost 11 and htpasswd line chosen, the tool opened again — as left, password and user empty, neither stored (saved parameters)`,
      kept.algorithm === 'bcrypt' &&
        kept.cost === '11' &&
        kept.format === 'htpasswd line' &&
        kept.password === '' &&
        kept.user === '' &&
        kept.warning === 0 &&
        JSON.stringify(record) ===
          JSON.stringify({ schema: 1, values: { algorithm: 'bcrypt', bcryptCost: 11, format: 'htpasswd' } }),
      JSON.stringify({ kept, record }),
    );
    await forgetSavedParameters(own, 'password-hash');
    await own.close();
  }

  // §7: a hash pasted on the start page opens this tool in Verify with it; the password field stays empty.
  const paste = async text => {
    await page.goto(`${base}#/start`);
    const f = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await f.waitFor();
    await f.focus();
    await page.evaluate(value => {
      const data = new DataTransfer();
      data.setData('text/plain', value);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, text);
    await page.waitForFunction(() => location.hash !== '#/start', null, { timeout: 3_000 }).catch(() => {});
    await sleep(200);
    return page.evaluate(() => location.hash);
  };
  const pasted = {};
  for (const [name, text] of [
    ['bcrypt', BCRYPT],
    ['django', DJANGO],
    ['argon2id', hashed],
  ]) {
    pasted[name] = await paste(text);
    if (pasted[name] === '#/tools/password-hash') {
      await page.getByLabel('Hash', { exact: true }).waitFor();
      pasted[`${name} filled`] =
        (await page.getByLabel('Hash', { exact: true }).inputValue()) === text &&
        (await password(page).inputValue()) === '';
    }
  }
  check(
    `${T}: §7 bcrypt, Django and Argon2id strings pasted on the start page open this tool in Verify, password empty`,
    Object.values(pasted).every(v => v === true || v === '#/tools/password-hash'),
    JSON.stringify(pasted),
  );
  const notOurs = [];
  for (const text of ['$6$rounds=5000$saltsalt$abcdefghijklmnop', '5f4dcc3b5aa765d61d8327deb882cf99', 'hunter2']) {
    if ((await paste(text)) === '#/tools/password-hash') notOurs.push(text);
  }
  check(
    `${T}: §7 SHA-512-crypt, a plain MD5 digest and a word do not open it`,
    notOurs.length === 0,
    notOurs.join(', '),
  );

  // D17: no master password — nothing is written.
  await page.goto(`${base}#/tools/password-hash`);
  await password(page).fill(PASSWORD);
  await press(page, 'Hash');
  await result(page).waitFor();
  await sleep(500);
  check(`${T}: without a master password nothing is written`, (await rowsOf(page)) === 0);

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
      .querySelector('[data-kept]')
      ?.textContent?.endsWith('The hashes you make or check are kept encrypted in this browser.'),
  );
  await choose(page, 'Algorithm', 'bcrypt');
  await page.getByRole('radio', { name: 'Custom', exact: true }).click();
  await page.getByLabel('Salt', { exact: true }).fill('000102030405060708090a0b0c0d0e0f');
  await page.getByLabel('Cost', { exact: true }).fill('10');
  await press(page, 'Hash');
  await page.waitForFunction(h => document.querySelector('[data-result] output')?.textContent === h, BCRYPT);
  let records = [];
  for (let i = 0; i < 40 && records.length === 0; i++) {
    await sleep(100);
    records = await historyRecords(page, 'password-hash');
  }
  const rawRows = JSON.stringify(records);
  check(
    `${T}: unlocked, a Hash writes one encrypted entry — no hash, password, label or payload in clear`,
    records.length === 1 &&
      records[0].kind === 'hashed' &&
      typeof records[0].sealed === 'object' &&
      records[0].payload === undefined &&
      records[0].label === undefined &&
      !rawRows.includes(PASSWORD) &&
      !rawRows.includes(BCRYPT.slice(7)),
    `${records.length} entries`,
  );

  // A hash made with a secret key: written encrypted, and the key is nowhere in the store.
  await choose(page, 'Algorithm', 'Argon2id');
  await page.getByLabel('Secret key (pepper)', { exact: true }).fill(PEPPER);
  await press(page, 'Hash');
  await result(page).waitFor();
  let keyedRecords = [];
  for (let i = 0; i < 40 && keyedRecords.length < 2; i++) {
    await sleep(100);
    keyedRecords = await historyRecords(page, 'password-hash');
  }
  check(
    `${T}: a hash made with a secret key is written encrypted, and the key is not in IndexedDB`,
    keyedRecords.length === 2 && !JSON.stringify(keyedRecords).includes(PEPPER),
    `${keyedRecords.length} entries`,
  );

  // Locked: the entry stays shut.
  const history = await open('#/history');
  await history.locator('[data-page="history"]').waitFor();
  await history.getByRole('button', { name: 'Lock now' }).click();
  await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
  const entry = history.locator('.kit-history-entry[data-kind="hashed"]').last();
  await entry.waitFor();
  await entry.getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  check(
    `${T}: locked, opening the entry says it is encrypted`,
    (await history.locator('[data-restored]').innerText()) ===
      'This entry is encrypted: unlock the history to open it.',
  );
  // Unlocked: Open brings the hash and its parameters back; the password field is empty.
  await settings.bringToFront();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('Unlocked.', { exact: true }).waitFor();
  await history.bringToFront();
  await history.goto(`${base}#/history`);
  await history.locator('.kit-history-entry[data-kind="hashed"]').last().getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  check(
    `${T}: unlocked, History's Open brings the hash, bcrypt and the salt back — the password field empty`,
    (await history.locator('[data-restored]').innerText()) ===
      'Opened from History: bcrypt · cost 10. The password is never kept: type it again.' &&
      (await result(history).innerText()) === BCRYPT &&
      (await history.getByLabel('Salt', { exact: true }).inputValue()) === '000102030405060708090a0b0c0d0e0f' &&
      (await password(history).inputValue()) === '',
  );

  // The password nowhere: console, address, localStorage, chrome.storage.
  const stores = await page.evaluate(async () => {
    const local = Object.keys(localStorage)
      .map(k => `${k}=${localStorage.getItem(k)}`)
      .join('\n');
    const all = await Promise.all(
      ['local', 'session', 'sync'].map(a => chrome.storage[a]?.get(null).catch(() => ({})) ?? {}),
    );
    return { local, storage: JSON.stringify(all), url: location.href };
  });
  check(
    `${T}: the password and the secret key are in no console message, address, localStorage, chrome.storage or the clipboard`,
    [PASSWORD, PEPPER].every(
      secret =>
        !consoleTexts.some(t => t.includes(secret)) &&
        !stores.url.includes(secret) &&
        !stores.local.includes(secret) &&
        !stores.storage.includes(secret),
    ) && !(await clipboard.copied()).some(t => t.includes(PASSWORD) || t.includes(PEPPER)),
  );

  // Turn the master password off again; restore the clipboard.
  await settings.bringToFront();
  await group.getByRole('button', { name: 'Turn off…' }).click();
  await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await group.getByText(/^The master password is off/).waitFor();
  await page.bringToFront();
  await clipboard.restore();
  await page.reload();
  await password(page).waitFor();
  check(`${T}: with the master password off again, its entries are gone`, (await rowsOf(page)) === 0);
  for (const p of opened) await p.close();
  // The algorithm and cost the steps above chose are saved parameters (written 400 ms after the change): the next
  // module opens the tool with its defaults.
  await sleep(500);
  await forgetSavedParameters(page, 'password-hash').catch(() => undefined);
};
