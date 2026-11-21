// The Hash tool in the built extension (docs/tools/specs/hash.md): its scenarios (§2) the way a person does them — the
// page's real controls — run by scripts/e2e-tools.mjs. A file is hashed by the tool's module worker, loaded from the
// package's own file (never blob: or data:). The tool's history keeps only secrets: nothing without a master password,
// encrypted entries with one (a throwaway password made here, turned off again — which deletes them — at the end).
// The copy button's clipboard write is caught in the page, so the run never touches a real clipboard.

/* global indexedDB, window -- page.evaluate callbacks run in the page */

import { mkdirSync, rmSync, truncateSync, writeFileSync } from 'node:fs';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const ABC = {
  MD5: '900150983cd24fb0d6963f7d28e17f72',
  'SHA-1': 'a9993e364706816aba3e25717850c26c9cd0d89d',
  'SHA-256': 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
};

/** The tool's records in the extension's history: each record's line, parsed. */
const hashRecords = page =>
  page
    .evaluate(async () => {
      const db = await new Promise(res => {
        const r = indexedDB.open('tool-history');
        r.onupgradeneeded = () => r.transaction.abort();
        r.onsuccess = () => res(r.result);
        r.onerror = () => res(null);
      });
      if (!db) return [];
      const lines = await new Promise((res, rej) => {
        const r = db.transaction('records').objectStore('records').getAll();
        r.onsuccess = () => res(r.result.map(x => x.line));
        r.onerror = () => rej(r.error);
      });
      db.close();
      return lines;
    })
    .then(lines => lines.map(line => JSON.parse(line)).filter(r => r.owner === 'hash'));

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const workers = [];
  page.on('worker', w => workers.push(w.url()));
  await page.goto(`${base}#/tools/hash`);
  const group = name => page.getByRole('radiogroup', { name, exact: true });
  const mode = name => group('Input').getByRole('radio', { name, exact: true }).click();
  const output = name => group('Output').getByRole('radio', { name, exact: true }).click();
  const row = name => page.getByRole('status', { name, exact: true });
  const value = name => row(name).innerText();
  const until = (name, text) => row(name).filter({ hasText: text }).waitFor({ timeout: 10_000 });
  const message = where => page.locator(`[data-field="${where}"]`).innerText();
  const text = page.getByLabel('Text', { exact: true });
  await text.waitFor();

  // Empty: the hashes of the empty input (§6, §8).
  await until('MD5', 'd41d8cd98f00b204e9800998ecf8427e');
  check(
    'Hash: an empty field shows the hashes of the empty input',
    /Hash of empty input\./.test(await message('input')),
  );
  const kept = await page.locator('[data-kept]').innerText();
  check(
    'Hash: without a master password it says nothing is kept',
    kept === 'Nothing you hash here is kept: this tool’s history needs a master password (Settings → History).',
    kept,
  );

  // §2.1: abc → five rows; Copy SHA-256 copies only the value.
  await text.fill('abc');
  await until('MD5', ABC.MD5);
  const five = await Promise.all(['MD5', 'SHA-1', 'SHA-256'].map(value));
  check('Hash: abc gives MD5, SHA-1 and SHA-256 of RFC 1321 and FIPS 180-4', five.join() === Object.values(ABC).join());
  await page.evaluate(() => {
    window.__copied = [];
    navigator.clipboard.writeText = text => (window.__copied.push(text), Promise.resolve());
  });
  await page.getByRole('button', { name: 'Copy SHA-256', exact: true }).click();
  const copied = await page.evaluate(() => window.__copied);
  check('Hash: Copy SHA-256 copies the value alone', copied.length === 1 && copied[0] === ABC['SHA-256'], copied[0]);
  await shoot(page, 'tool-hash-01-text-light.png');

  // §2.2: a line break at the end changes the hash, and is said under the field.
  await text.fill('abc\n');
  await until('SHA-256', 'edeaaff3f1774ad2888673770c6d64097e391bc362d7d6fb34982ddf0efd18cb');
  check(
    'Hash: a trailing line break is hashed and pointed out',
    (await message('input')) === 'The text ends with a line break. It is part of the hashed bytes.',
  );

  // §2.6: Output Base64 (for Subresource Integrity).
  await text.fill('abc');
  await until('MD5', ABC.MD5);
  await output('Base64');
  check(
    'Hash: Output Base64 writes SHA-256 for Subresource Integrity',
    (await value('SHA-256')) === 'ungWv48Bz+pBQUDeXa4iI7ADYaOWF3qctBD/YfIAFa0=',
  );
  await output('hex');

  // §2.7: Hex input, and its error next to the field.
  await mode('Hex');
  const hex = page.getByLabel('Hex', { exact: true });
  await hex.fill('00 ff');
  await until('SHA-256', '06eb7d6a69ee19e5fbdf749018d3d2abfa04bcbd1365db312eb86dc7169389b8');
  await hex.fill('0g');
  check(
    'Hash: a wrong hex digit is named with its position',
    (await message('input')) === 'Position 2: "g" is not a hex digit.',
  );
  check('Hash: no hashes while the input is wrong', (await value('MD5')) === '');
  await mode('Text');

  // §2.4: a webhook signature — HMAC with the key Jefe (RFC 4231 case 2).
  await text.fill('what do ya want for nothing?');
  await page.getByLabel('HMAC', { exact: true }).check();
  check('Hash: HMAC with an empty key asks for one', (await value('HMAC-SHA-256')) === 'Enter a key.');
  const key = page.getByLabel('Key', { exact: true });
  check('Hash: the key is a password field', (await key.getAttribute('type')) === 'password');
  await key.fill('Jefe');
  await until('HMAC-SHA-256', '5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
  check('Hash: HMAC-SHA-256 of RFC 4231 case 2', true);

  // §2.5: a key given in hex (RFC 4231 case 1), chosen in the Key format list.
  await page.getByLabel('Key format', { exact: true }).click();
  await page.getByRole('option', { name: 'Hex', exact: true }).click();
  await key.fill('0b'.repeat(20));
  await text.fill('Hi There');
  await until('HMAC-SHA-256', 'b0344c61d8db38535ca8afceaf0bf12b881dc200c9833da726e9376c2e32cff7');
  check('Hash: HMAC with a hex key, RFC 4231 case 1', true);
  await shoot(page, 'tool-hash-02-hmac-light.png');
  await key.fill('');
  await page.getByLabel('HMAC', { exact: true }).uncheck();

  // §2.3: a downloaded file and its published checksum — File mode, a worker, a match.
  const dir = join(ROOT, '.state/e2e/hash');
  mkdirSync(dir, { recursive: true });
  const small = join(dir, 'installer.bin');
  const bytes = randomBytes(3 * 1024 * 1024 + 17);
  writeFileSync(small, bytes);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  await mode('File');
  await page.locator('input[type="file"]').setInputFiles(small);
  await until('SHA-256', sha256);
  check(
    'Hash: a file shows its name and size, then its hashes',
    (await page.locator('[data-file]').innerText()) === 'installer.bin — 3 MB' &&
      (await value('MD5')) === createHash('md5').update(bytes).digest('hex'),
  );
  check(
    'Hash: the file is hashed by the tool’s module worker, loaded from the extension’s own file',
    workers.length > 0 &&
      workers.every(u => u.startsWith('chrome-extension://') && /\/assets\/hash\.worker-[\w-]+\.js$/.test(u)),
    workers.join(', '),
  );
  await page.getByLabel('Compare with', { exact: true }).fill(`SHA256 (installer.bin) = ${sha256.toUpperCase()}`);
  check(
    'Hash: a pasted checksum marks the matching row',
    (await message('compare')) === 'Matches SHA-256.' &&
      (await page.locator('[data-match]').innerText()).includes('Matches'),
  );
  await shoot(page, 'tool-hash-03-file-match-light.png');
  await page.getByLabel('Compare with', { exact: true }).fill('');

  // No size limit (§12): a file over the former 256 MB limit is hashed — the same digests as node:crypto — and a long
  // one shows its throughput and time left, and stops on Cancel. Sparse files: no disk is used.
  const sparse = (name, size) => {
    const path = join(dir, name);
    writeFileSync(path, '');
    truncateSync(path, size);
    return path;
  };
  const zerosDigest = (algorithm, size) => {
    const hash = createHash(algorithm);
    const block = Buffer.alloc(8 * 1024 * 1024);
    for (let left = size; left > 0; left -= block.length)
      hash.update(left >= block.length ? block : block.subarray(0, left));
    return hash.digest('hex');
  };
  const over = 300 * 1024 * 1024;
  await page.locator('input[type="file"]').setInputFiles(sparse('over.iso', over));
  await until('SHA-512', zerosDigest('sha512', over));
  check(
    'Hash: a file over the former 256 MB limit is hashed, the same as node:crypto',
    (await value('MD5')) === zerosDigest('md5', over) && (await value('SHA-256')) === zerosDigest('sha256', over),
  );
  await page.locator('input[type="file"]').setInputFiles(sparse('long.iso', 8 * 1024 * 1024 * 1024));
  const progress = page
    .locator('[data-progress]')
    .filter({ hasText: /^Hashing… \d+% · [\d,]+ MB\/s · about \d+ (s|min) left$/ });
  await progress.waitFor({ timeout: 15_000 });
  const shown = await progress.innerText();
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  check(
    'Hash: a long file shows its throughput and time left, and Cancel stops it with no hashes',
    (await message('input')) === 'Cancelled.' &&
      (await value('MD5')) === '' &&
      !(await page.getByText(/^Hashing…/).count()),
    shown,
  );
  // Without a master password nothing is recorded.
  await mode('Text');
  await text.fill('not kept');
  await sleep(3_600);
  await page.goto(`${base}#/tools`);
  check('Hash: without a master password nothing reaches the history', (await hashRecords(page)).length === 0);

  // With one (set in Settings, thrown away at the end): a text is kept encrypted and opens back; a file is kept as its
  // name, size and hashes, with no blob.
  const settings = await ctx.newPage();
  await settings.goto(`${base}#/settings`);
  const history = settings.locator('[data-settings="history"]');
  await history.waitFor();
  const password = `e2e-${randomBytes(12).toString('base64url')}-Zz9`;
  await history.getByRole('button', { name: 'Set a master password…' }).click();
  await history.getByLabel('Master password', { exact: true }).fill(password);
  await history.getByLabel('The same again').fill(password);
  await history.getByLabel('I understand: forgotten means lost').click();
  await history.getByRole('button', { name: 'Set the master password' }).click();
  await history.getByText('The master password is set and the history is unlocked.').waitFor();

  await page.goto(`${base}#/tools/hash`);
  await page
    .locator('[data-kept]')
    .filter({ hasText: /^Kept in this browser’s history, encrypted/ })
    .waitFor();
  check('Hash: with the history unlocked it says what is kept, encrypted', true);
  await text.fill('kept secret');
  await until('MD5', createHash('md5').update('kept secret').digest('hex'));
  await sleep(3_600);
  await mode('File');
  await page.locator('input[type="file"]').setInputFiles(small);
  await until('SHA-256', sha256);
  await sleep(500);
  const records = await hashRecords(page);
  const textRecord = records.find(r => r.kind === 'text');
  const fileRecord = records.find(r => r.kind === 'file');
  check(
    'Hash: a text and a file are recorded, both encrypted',
    !!textRecord?.sealed && !!fileRecord?.sealed && records.every(r => r.sealed && !r.payload && !r.label),
    records.map(r => `${r.kind}:${r.sealed ? 'sealed' : 'clear'}:${(r.blobs ?? []).length} blobs`).join(', '),
  );
  check('Hash: a file’s contents are never kept (no blob)', (fileRecord?.blobs ?? []).length === 0);

  await page.goto(`${base}#/tools`);
  await page.goto(`${base}#/tools/hash`);
  await page.getByText('Recent entries').click();
  const entries = page.locator('.kit-history-entry');
  await entries.first().waitFor();
  await entries.filter({ hasText: 'Text' }).first().getByRole('button', { name: 'Open' }).click();
  await page.getByText('Opened from History: Text · 11 characters.').waitFor();
  check(
    'Hash: an encrypted entry opens back into the tool',
    (await text.inputValue()) === 'kept secret' &&
      (await value('MD5')) === createHash('md5').update('kept secret').digest('hex'),
  );
  await shoot(page, 'tool-hash-04-history-light.png');

  // Dark: the same page in the default dark theme, then back.
  const modes = page.getByRole('radiogroup', { name: 'Theme mode' });
  const before = (await modes.getByRole('radio', { checked: true }).innerText()).trim();
  await modes.getByRole('radio', { name: 'Dark', exact: true }).click();
  await page.locator('html[data-mode="dark"]').waitFor();
  await text.fill('abc');
  await until('MD5', ABC.MD5);
  await shoot(page, 'tool-hash-05-text-dark.png');
  await mode('File');
  await page.locator('input[type="file"]').setInputFiles(small);
  await until('MD5', createHash('md5').update(bytes).digest('hex'));
  await page.getByLabel('HMAC', { exact: true }).check();
  const darkKey = 'webhook-signing-key';
  const signature = createHmac('sha256', darkKey).update(bytes).digest('hex');
  await page.getByLabel('Key', { exact: true }).fill(darkKey);
  await until('HMAC-SHA-256', signature);
  await page.getByLabel('Compare with', { exact: true }).fill(signature);
  check('Hash: HMAC of a file, compared', (await message('compare')) === 'Matches HMAC-SHA-256.');
  await shoot(page, 'tool-hash-06-file-hmac-dark.png');
  if (before) await modes.getByRole('radio', { name: before, exact: true }).click();
  else await modes.getByRole('radio', { name: 'Light', exact: true }).click();
  await page.locator('html[data-mode="light"]').waitFor();

  // Turning the master password off deletes the encrypted entries: the history is as the run found it.
  await history.getByRole('button', { name: 'Turn off…' }).click();
  await history.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await history.getByText(/^The master password is off/).waitFor();
  check('Hash: turning the master password off deletes its entries', (await hashRecords(settings)).length === 0);
  await settings.close();
  await page.goto(`${base}#/tools`);
  rmSync(dir, { recursive: true, force: true });
};
