// The JWT tool in the built extension (docs/tools/specs/jwt.md): where the host lists it, its scenarios (§2) with the
// page's real controls, detection from the start page's field (§7) against the tools before it, and its two secret
// history kinds (D17) end to end:
//   - without a master password nothing of a token or a key is written;
//   - with a throwaway master password made here, a Copy writes one encrypted entry (no token, secret, label or
//     payload in clear in IndexedDB);
//   - locked, the entry does not open (the tool says it is encrypted) and a Copy writes nothing;
//   - unlocked, History's "Open" brings the token and the secret back, and the signature is verified again;
//   - the master password is turned off again (its encrypted entries go with it), so later steps start as before;
//   - Sign (§16): a token signed with the secret decodes back verified, one signed with a private key (made here by
//     node:crypto and thrown away) verifies with its public key, alg "none" is refused, and without a master password
//     nothing of it — key, token or payload — is written;
//   - saved parameters (D21): the secret format and Compact JSON are kept — never a token or a key — and the mode is
//     not (the page opens in Decode).
// Only published sample tokens and the specification's test keys are used. The master password is never written to
// the report or the console. Copy is checked against a stand-in for navigator.clipboard.writeText in the page, so the
// run does not touch the system clipboard. Run by scripts/e2e-tools.mjs.

/* global document, indexedDB, window, location, DataTransfer, ClipboardEvent, chrome -- page.evaluate callbacks run in the page */

import { generateKeyPairSync } from 'node:crypto';
import { forgetSavedParameters } from '../e2e-helpers.mjs';
import { themeMode } from '../e2e-theme.mjs';

const T = 'JWT';
// A published sample token (docs/tools/specs/jwt.md §10, HS256 with its test secret), not a credential.
const T1 =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.EGtiSsrqY5aOYhAICf6R9A5yr17V9Qdvjqsg0nJLFX4'; // gitleaks:allow
// A published sample token (the specification's §10, alg none), not a credential.
const T3 =
  'eyJhbGciOiJub25lIn0.eyJzdWIiOiJ1c2VyLTQyIiwibmFtZSI6IkFkYSBMb3ZlbGFjZSIsImlhdCI6MTc2MzU1MzYwMCwibmJmIjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.'; // gitleaks:allow
// A published sample token (the specification's §10, a JWE), not a credential.
const T11 = 'eyJhbGciOiJkaXIiLCJlbmMiOiJBMjU2R0NNIn0..AAAAAAAAAAAAAAAA.AAAA.AAAAAAAAAAAAAAAAAAAAAA'; // gitleaks:allow
// A published sample token (the specification's §10, RS256 with the x509 specification's test key), not a credential.
const T_RS256 =
  'eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJmaXh0dXJlIiwiaWF0IjoxNzYzNTUzNjAwLCJleHAiOjE3NjM1NTcyMDB9.bT7mYXgMn3Iz9US4R01Wsdtsh8zzTEOGYzG1fx8YgEE2Kv_ehmAFd1f1Ndt960ve3mDHaN-oJV_juh30X8_-oLWK-3_t15pZ0o1LTF5ojc2AFKmkeGheJMvBIuf2zy3npF4K5tzvzmdEwdWax4O5hQsTc_TpiWC6b191qL07Hvjw1ZJAJc_BDODculi3S6vfV1bvTOccKt8tIu_5_nbr3_NQilvFSFBJKlhQvaEnrnLzF5h9PXkoSXPUqV47ccymSE4AUZy1ewmWHc1BMHS5X3k-iu3YP3oMz8KMA_uxtDskQ-q-k8ieHC31F_WII1RZxyJxQKjYjHzJBH2C82o97g'; // gitleaks:allow
// The specification's test secret, not a credential.
const SECRET = 'tools-test-secret-0123456789abcdef!'; // gitleaks:allow
const CA_SPKI = `-----BEGIN PUBLIC KEY-----
MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA1Laz8hEQjcfLnLj1nBot
7tJrRR1BTWCnWbfZ6RM6pZXzTfgXDjgqpZrqkVOOZSwTNujVJLW4z8OYMxa7jWm9
FmuMq8ZdYZ7QiWuqqKZB5bV03IQwcWDFfpRYzepqiDgLS1rIsxEqJEXUQUvqC8Ne
1MnBaBYmxKHe5nKaMgfQvzl64SuNi78HG8T27SmXonb0DYF8tbuAbkxw3i9M+36S
hLCk0bVqjQ+7TU5fEw+K5om7CnxFZ4y2w79daohWM7rn3MOl9nlTeclvTdvqvHWc
mNVe2YygVfiRBnnS3XYrgOYO0quzzmTWqxGS6my5GpUeNBw6pQmGpsfej/6Kj3Np
iwIDAQAB
-----END PUBLIC KEY-----`;

/** The rows of the history database (owner, kind, key id, and the stored line), read without creating it. */
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
const jwtRows = async page => (await historyRows(page)).filter(r => r.owner === 'jwt');

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
  const token = p => p.getByLabel('Token', { exact: true });
  const title = p => p.locator('[data-signature-title]');
  const verdict = (p, want) =>
    p.waitForFunction(w => document.querySelector('[data-signature-title]')?.textContent === w, want, {
      timeout: 5_000,
    });
  const captions = p => p.locator('[data-caption]').allInnerTexts();
  const hint = p => p.locator('[data-hint]');
  const paneCopy = (p, name) =>
    p
      .locator('.kit-tool-pane')
      .filter({ has: p.locator('.kit-tool-pane-head', { hasText: new RegExp(`^${name}`) }) })
      .getByRole('button', { name: /^Cop(y|ied)$/ });
  const chooseFormat = async (p, name) => {
    await p.getByLabel('Secret format', { exact: true }).click();
    await p.getByRole('option', { name, exact: true }).click();
  };
  const shot = async (p, file) => {
    // No focus ring on the last field typed into, and the colours settled (the controls fade in 180 ms).
    await p.evaluate(() => document.activeElement?.blur());
    await sleep(400);
    await shoot(p, file);
  };

  // Where the host lists the tool, with no list edited: the Tools list, the page, the start page's field, Settings.
  await page.goto(`${base}#/tools/jwt`);
  await token(page).waitFor();
  check(
    `${T}: listed in Tools, its page titled and summarised by its definition`,
    (await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('list', { name: 'Tools' })
      .getByRole('link', { name: T, exact: true })
      .count()) === 1 &&
      (await page.getByRole('heading', { name: T, exact: true }).count()) === 1 &&
      (await page.locator('.kit-tool-page-summary').innerText()) ===
        'Decode a JSON Web Token and check its signature with your key.',
  );
  check(
    `${T}: empty, only the token field and the line of §8`,
    (await token(page).getAttribute('placeholder')) === 'Paste a JWT: eyJ…' &&
      (await page.getByText('Paste a token to decode it. Add a key to verify its signature.').count()) === 1 &&
      (await title(page).count()) === 0,
  );
  const start = await open('#/start');
  const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.fill('bearer');
  const firstRow = await start.getByRole('option').first().innerText();
  check(`${T}: the start page's field finds it by a keyword`, firstRow.includes(T), firstRow.split('\n')[0]);
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  const groupText = await group.innerText();
  check(
    `${T}: Settings → History says what it keeps and never keeps`,
    groupText.includes('Tokens you decoded, with the signature result and the key you checked them with') &&
      groupText.includes('and tokens you signed with their header and payload') &&
      groupText.includes(
        'Tokens and keys without an unlocked master password, and never in clear; the key or secret a token was signed with, ever.',
      ),
  );
  const shortcut = settings.locator('[data-shortcut="open:tools/jwt"] input');
  check(
    `${T}: Settings → Shortcuts lists it, with no default shortcut`,
    (await shortcut.count()) === 1 && (await shortcut.inputValue()) === '',
  );

  // §2.1: T1 — decoded, not verified; header, payload, the claims, the times.
  await page.bringToFront();
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
  await token(page).fill(T1);
  await title(page).waitFor();
  const header = await page.getByLabel('Header', { exact: true }).innerText();
  const expRow = await page.locator('[data-claim="exp"]').innerText();
  check(
    `${T}: T1 — the header, "Signature not verified", "Decoded, not verified" over both parts, exp in three lines`,
    header === '{\n  "alg": "HS256",\n  "typ": "JWT"\n}' &&
      (await title(page).innerText()) === 'Signature not verified' &&
      (await captions(page)).every(c => c === 'Decoded, not verified') &&
      (await captions(page)).length === 2 &&
      expRow.includes('2025-11-19T13:00:00Z') &&
      /expired \d+ \w+ ago/.test(expRow) &&
      /^Expired \d+ \w+ ago$/.test(await page.locator('[data-times]').innerText()) &&
      (await page.getByText('Algorithm: HS256 — HMAC with SHA-256').count()) === 1,
    expRow.replaceAll('\n', ' | '),
  );
  check(
    `${T}: the hint says tokens and keys are not kept without a master password, and so does the history line`,
    (await hint(page).innerText()).endsWith('They are not kept (no master password).') &&
      /nothing is kept without a master password\./.test(await page.locator('.kit-tool-history-line').innerText()),
  );
  await shot(page, 'tool-jwt-01-decoded.png');

  // §2.2: the secret verifies; one letter changed does not match.
  const secret = page.getByLabel('Secret', { exact: true });
  check(
    `${T}: the secret field is hidden, unchecked by spelling and autocomplete`,
    (await secret.getAttribute('type')) === 'password' &&
      (await secret.getAttribute('spellcheck')) === 'false' &&
      (await secret.getAttribute('autocomplete')) === 'off',
  );
  await secret.fill(SECRET);
  await verdict(page, 'Signature verified');
  check(
    `${T}: the test secret — "Signature verified", both parts marked verified`,
    (await captions(page)).every(c => c === 'Signature verified') &&
      (await page.getByText('with the key below').count()) === 1,
  );
  await shot(page, 'tool-jwt-02-verified.png');
  await secret.fill(SECRET.replace('!', '?'));
  await verdict(page, 'Signature does not match');
  check(
    `${T}: one letter changed — "Signature does not match", parts back to "Decoded, not verified"`,
    (await captions(page)).every(c => c === 'Decoded, not verified'),
  );

  // §2.3: the secret in Base64.
  await chooseFormat(page, 'Base64');
  await secret.fill('dG9vbHMtdGVzdC1zZWNyZXQtMDEyMzQ1Njc4OWFiY2RlZiE='); // gitleaks:allow
  await verdict(page, 'Signature verified');
  check(`${T}: Secret format Base64 — verified`, true);
  await chooseFormat(page, 'Text (UTF-8)');

  // Copy: the payload as shown.
  await paneCopy(page, 'Payload').click();
  await page.waitForFunction(() => window.__copied.length > 0);
  const copied = await page.evaluate(() => window.__copied.at(-1));
  check(`${T}: Copy copies the payload JSON`, copied.startsWith('{\n  "sub": "user-42",') && copied.endsWith('}'));

  // §2.4: an RS256 token and a public key in PEM.
  await token(page).fill(T_RS256);
  await page.getByLabel('Public key', { exact: true }).fill(CA_SPKI);
  await verdict(page, 'Signature verified');
  check(
    `${T}: RS256 with the PEM public key — verified, described`,
    (await page.getByText('RSA 2048-bit public key', { exact: true }).count()) === 1,
  );
  await shot(page, 'tool-jwt-03-rs256.png');

  // §2.7: a private key is refused.
  await page
    .getByLabel('Public key', { exact: true })
    .fill('-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEIA==\n-----END PRIVATE KEY-----');
  await verdict(page, 'Signature not verified');
  check(
    `${T}: a private key is refused and not used`,
    (await page
      .getByText("This is a private key. Verification needs only the public key; don't paste private keys here.")
      .count()) === 1,
  );

  // §2.6: alg none.
  await token(page).fill(T3);
  await verdict(page, 'Unsecured token: alg is "none". Anyone could have written it.');
  check(
    `${T}: alg none — the unsecured line, no key field`,
    (await page.getByLabel('Secret', { exact: true }).count()) === 0 &&
      (await page.getByLabel('Public key', { exact: true }).count()) === 0,
  );
  await shot(page, 'tool-jwt-04-unsecured.png');

  // §2.8: "Bearer " and a line break.
  await token(page).fill(`Bearer ${T1.slice(0, 40)}\n${T1.slice(40)}`);
  await page.getByText('Removed "Bearer " and line breaks.').waitFor({ timeout: 2_000 });
  check(`${T}: "Bearer " and a line break are taken away, with the note`, true);

  // §2.9: a JWE.
  await token(page).fill(T11);
  await page
    .getByText('This is an encrypted token (JWE). Only its header can be read without the decryption key.')
    .waitFor({ timeout: 2_000 });
  check(
    `${T}: a JWE — the message and its header`,
    (await page.getByLabel('Header', { exact: true }).innerText()) === '{\n  "alg": "dir",\n  "enc": "A256GCM"\n}',
  );
  await shot(page, 'tool-jwt-05-jwe.png');

  // §6: an error next to the token field.
  await token(page).fill('eyJh+bGciOiJIUzI1NiJ9.e30.');
  const error = page.getByText('Segment 1, position 5: "+" is not used in Base64url. This looks like standard Base64.');
  await error.waitFor({ timeout: 2_000 });
  check(
    `${T}: standard Base64 in a part — the message under the field, read out politely`,
    (await error.getAttribute('role')) === 'status' &&
      (await token(page).getAttribute('aria-describedby')) === (await error.getAttribute('id')),
  );
  await shot(page, 'tool-jwt-06-error.png');

  // Dark: the default dark theme.
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor();
  await token(page).fill(T1);
  await page.getByLabel('Secret', { exact: true }).fill(SECRET);
  await verdict(page, 'Signature verified');
  await shot(page, 'tool-jwt-07-verified-dark.png');
  await token(page).fill(T_RS256);
  await page.getByLabel('Public key', { exact: true }).fill(CA_SPKI);
  await verdict(page, 'Signature verified');
  await shot(page, 'tool-jwt-08-rs256-dark.png');
  await themeMode(ctx, base, 'System');
  await page.locator('html[data-mode="light"]').waitFor();
  await page.getByRole('button', { name: 'Clear', exact: true }).click();

  // §7: a token pasted into the start page's field opens this tool with it — Base64 (number 2) does not take it; a
  // single part (Base64 of a JSON object) is not a token.
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
    ['T1', T1],
    ['Bearer T1', `Bearer ${T1}`],
    ['JWE', T11],
  ]) {
    pasted[name] = await paste(text);
    if (pasted[name] === '#/tools/jwt') pasted[`${name} field`] = (await token(page).inputValue()) === text;
  }
  check(
    `${T}: §7 a token, "Bearer " + a token and a JWE pasted on the start page open this tool with it`,
    pasted.T1 === '#/tools/jwt' &&
      pasted['T1 field'] &&
      pasted['Bearer T1'] === '#/tools/jwt' &&
      pasted['Bearer T1 field'] &&
      pasted.JWE === '#/tools/jwt',
    JSON.stringify(pasted),
  );
  const notOurs = [];
  for (const text of ['eyJhbGciOiJIUzI1NiJ9', 'a.b.c', 'www.example.com', '1.2.3', 'SGVsbG8sIFdvcmxkIQ==']) {
    if ((await paste(text)) === '#/tools/jwt') notOurs.push(text);
  }
  check(
    `${T}: §7 one part, dotted words, a host name and Base64 do not open it`,
    notOurs.length === 0,
    notOurs.join(', '),
  );

  // D17, the secret kinds. No master password: nothing is written.
  await page.goto(`${base}#/tools/jwt`);
  await token(page).fill(T1);
  await page.getByLabel('Secret', { exact: true }).fill(SECRET);
  await verdict(page, 'Signature verified');
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.resolve() });
  });
  await paneCopy(page, 'Header').click();
  await sleep(500);
  check(
    `${T}: without a master password a token and its key are not written at all`,
    (await jwtRows(page)).length === 0,
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
    document.querySelector('[data-hint]')?.textContent?.endsWith('They are kept encrypted in this browser.'),
  );
  check(`${T}: with the history unlocked, it says tokens and keys are kept encrypted`, true);
  await paneCopy(page, 'Header').click();
  let rows = [];
  for (let i = 0; i < 40 && rows.length === 0; i++) {
    await sleep(100);
    rows = await jwtRows(page);
  }
  const all = await historyRows(page);
  const row = rows[0];
  const record = row ? JSON.parse(row.line) : {};
  check(
    `${T}: unlocked, a Copy writes one encrypted entry — no token, secret, label or payload in clear`,
    rows.length === 1 &&
      row.kind === 'checked' &&
      !!row.kid &&
      typeof record.sealed === 'object' &&
      record.payload === undefined &&
      record.label === undefined &&
      record.text === undefined &&
      !all.some(r => r.line.includes(T1.split('.')[1]) || r.line.includes(SECRET) || r.line.includes('user-42')),
    rows.length === 1 ? `kind ${row.kind}, sealed ${typeof record.sealed === 'object'}` : `${rows.length} entries`,
  );

  // Locked: the entry stays shut and nothing new is written.
  const history = await open('#/history');
  await history.locator('[data-page="history"]').waitFor();
  await history.getByLabel('Tool', { exact: true }).click();
  await history.getByRole('option', { name: T, exact: true }).click();
  await history.getByLabel('Kind', { exact: true }).click();
  const kinds = await history.getByRole('option').allInnerTexts();
  await history.keyboard.press('Escape');
  check(
    `${T}: History filters by it and by its two kinds`,
    kinds.includes('Decoded') && kinds.includes('Checked with a key'),
    kinds.join(', '),
  );
  await history.getByRole('button', { name: 'Lock now' }).click();
  await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
  const entry = history.locator('.kit-history-entry[data-kind="checked"]');
  await entry.waitFor();
  check(`${T}: History lists it as an encrypted entry`, /Encrypted entry/.test(await entry.innerText()));
  await entry.getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  const lockedText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: locked, opening the entry says it is encrypted and brings no token back`,
    lockedText === 'This entry is encrypted: unlock the history to open it.' &&
      (await token(history).inputValue()) === '',
    lockedText,
  );
  await token(history).fill(T1);
  await history.waitForFunction(() =>
    document.querySelector('[data-hint]')?.textContent?.endsWith('They are not kept while the history is locked.'),
  );
  await history.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', { configurable: true, value: () => Promise.resolve() });
  });
  await paneCopy(history, 'Payload').click();
  await sleep(500);
  check(`${T}: locked, a Copy writes nothing`, (await jwtRows(history)).length === 1);

  // Unlocked again: History's Open brings the token and the secret back.
  await settings.bringToFront();
  await group.getByLabel('Master password', { exact: true }).fill(master);
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('Unlocked.', { exact: true }).waitFor();
  await history.bringToFront();
  await history.goto(`${base}#/history`);
  await history.locator('.kit-history-entry[data-kind="checked"]').getByRole('button', { name: 'Open' }).click();
  await history.locator('[data-restored]').waitFor();
  await verdict(history, 'Signature verified');
  const restoredText = await history.locator('[data-restored]').innerText();
  check(
    `${T}: unlocked, History's Open brings the token and the secret back, verified again`,
    (await token(history).inputValue()) === T1 &&
      (await history.getByLabel('Secret', { exact: true }).inputValue()) === SECRET &&
      restoredText === 'Opened from History: HS256 · signature verified.',
    restoredText,
  );

  // Turn the master password off again: its encrypted entries go, later steps start without one.
  await settings.bringToFront();
  await group.getByRole('button', { name: 'Turn off…' }).click();
  await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await group.getByText(/^The master password is off/).waitFor();
  await page.bringToFront();
  await page.reload();
  await token(page).waitFor();
  check(`${T}: with the master password off again, its entries are gone`, (await jwtRows(page)).length === 0);

  // §16 Sign: the secret signs, Decode it verifies; a private key signs; "none" is refused; nothing is written.
  await page.getByRole('radio', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Signing secret', { exact: true }).fill(SECRET);
  const signedField = page.getByLabel('Signed token', { exact: true });
  await page.waitForFunction(() => document.querySelector('#jwt-signed')?.value?.startsWith('eyJ'));
  const hs = await signedField.inputValue();
  await shot(page, 'tool-jwt-sign-01-hs256.png');
  await page.getByRole('button', { name: 'Decode it', exact: true }).click();
  await verdict(page, 'Signature verified');
  check(
    `${T}: §16 Sign with the secret — "Decode it" shows the token verified with the same secret`,
    (await token(page).inputValue()) === hs && /^eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9\./.test(hs),
  );
  await page.getByRole('radio', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Algorithm', { exact: true }).click();
  await page.getByRole('option', { name: 'ES256', exact: true }).click();
  const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
  const ecPrivate = ec.privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
  await page.getByLabel('Private key', { exact: true }).fill(ecPrivate);
  await page.waitForFunction(() => document.querySelector('#jwt-signed')?.value?.startsWith('eyJhbGciOiJFUzI1NiIs'));
  const es = await signedField.inputValue();
  await page.getByRole('button', { name: 'Decode it', exact: true }).click();
  await page
    .getByLabel('Public key', { exact: true })
    .fill(ec.publicKey.export({ type: 'spki', format: 'pem' }).toString());
  await verdict(page, 'Signature verified');
  check(
    `${T}: §16 Sign ES256 with a private key — verified with its public key`,
    (await token(page).inputValue()) === es,
  );
  await page.getByRole('radio', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Header', { exact: true }).fill('{"alg":"none"}');
  await page.locator('[data-sign-error="header"]').waitFor();
  check(
    `${T}: §16 alg "none" is refused for signing`,
    (await page.locator('[data-sign-error="header"]').innerText()) ===
      'alg "none" makes an unsecured token; this tool signs only with a key.',
  );
  await sleep(3500);
  const dump = JSON.stringify(await historyRows(page));
  check(
    `${T}: §16 without a master password nothing of signing is written (no key, no token)`,
    (await jwtRows(page)).length === 0 && !dump.includes(ecPrivate.split('\n')[1]) && !dump.includes(es.split('.')[2]),
  );
  await page.getByRole('radio', { name: 'Decode', exact: true }).click();
  await token(page).fill('');

  // Saved parameters (D21): the secret format and Compact JSON are kept (written 400 ms after the change), never a
  // token or a key; the page opened again is in Decode, with those options.
  const stored = () =>
    page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.jwt);
  await token(page).fill(T1);
  await chooseFormat(page, 'Hex');
  await page.getByLabel('Secret', { exact: true }).fill(SECRET);
  await page.getByRole('radio', { name: 'Sign', exact: true }).click();
  await page.getByLabel('Compact JSON', { exact: true }).click();
  await page.getByLabel('Signing secret', { exact: true }).fill(SECRET);
  for (let i = 0; i < 25 && (await stored())?.values?.compact !== false; i++) await sleep(200);
  const kept = await stored();
  await page.reload();
  await token(page).waitFor({ timeout: 15_000 });
  const reopened = {
    decode: await page.getByRole('radio', { name: 'Decode', exact: true }).getAttribute('aria-checked'),
  };
  reopened.token = await token(page).inputValue();
  await token(page).fill(T1);
  reopened.format = await page.getByLabel('Secret format', { exact: true }).innerText();
  reopened.secret = await page.getByLabel('Secret', { exact: true }).inputValue();
  await page.getByRole('radio', { name: 'Sign', exact: true }).click();
  reopened.compact = await page.getByLabel('Compact JSON', { exact: true }).getAttribute('aria-checked');
  check(
    `${T}: Hex and Compact JSON off chosen, the page opened again — in Decode, Hex, Compact JSON off, no token or key (saved parameters)`,
    kept?.values?.secretFormat === 'hex' &&
      kept?.values?.compact === false &&
      Object.keys(kept?.values ?? {}).length === 2 &&
      !JSON.stringify(kept).includes(SECRET) &&
      reopened.decode === 'true' &&
      reopened.token === '' &&
      reopened.format === 'Hex' &&
      reopened.secret === '' &&
      reopened.compact === 'false',
    JSON.stringify({ values: kept?.values, ...reopened, token: reopened.token.length }),
  );
  await page.getByRole('radio', { name: 'Decode', exact: true }).click();
  await token(page).fill('');
  // The secret format and Compact JSON are saved parameters: the next module opens JWT with its defaults.
  await forgetSavedParameters(page, 'jwt');

  for (const p of opened) await p.close();
};
