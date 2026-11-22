// The e2e checks of the tool history (D17), run by scripts/e2e-check.mjs after the toolbar button; also on their own:
// `node scripts/e2e-history.mjs [<dist>] [--shots=<dir>]` (needs a build and Playwright, as pnpm test:e2e does).
//   - the JSON tool says on its page that history is kept; an edit and a Copy of the result are recorded (in the
//     extension's real IndexedDB); the History page lists them as one session; "Open" brings the text, the options and
//     the result back into the tool; the tool's own "Recent entries" opens one too;
//   - restore from a file: an export made outside the browser (by the same format code) with entries 2 and 5 days old;
//     an entry of that file — written as the JSON tool's first version wrote (schema 1) — opens in the tool; filters by
//     kind, text and dates narrow the count; "Delete shown" over a date interval tells how many entries and
//     bytes, asks once, and removes exactly those;
//   - export everything (a real download), delete everything (settings, asked once), restore the file: the records'
//     lines and the blobs' bytes are the same as before, byte for byte; a foreign file and a damaged one are refused
//     with their own messages and write nothing;
//   - the master switch off: the tool says so and a Copy records nothing;
//   - a master password (a throwaway one made here, never shown or written to the report): set with the no-recovery
//     warning acknowledged, shared by a second tab, locked from that tab, a wrong password refused, unlocked again; an
//     export carries the wrapped key and no password; turning it off removes it;
//   - incognito: with the extension allowed there, a page of ours opened in an incognito window does not run (Chrome
//     blocks extension pages there in spanning mode) and a tab of ours created for that window opens in a normal
//     window; nothing is recorded by either.
// Screenshots: tool-history-01 … (the tool's history line, the History page, its filters, the confirmation, restore,
// settings, the master password form before anything is typed).

/* global document, indexedDB, chrome, location -- page.evaluate callbacks run in the pages */

import { stubClipboard } from './e2e-helpers.mjs';
import { at, readDefinitions } from './read-definitions.mjs';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const DAY = 86_400_000;

/**
 * An export made outside the browser by the format's own code: JSON entries 2 and 5 days old, as the JSON tool's first
 * version wrote them (schema 1, `action: 'format'`) — the rewritten tool still opens them.
 */
const seedArchive = async now =>
  Uint8Array.from(
    await readDefinitions(`
      import { collect, memoryStore, recordLine, sha256Hex, utf8, zipArchive } from ${at('packages/tools/logic/shared/history/index.ts')};
      const now = ${now};
      const store = memoryStore();
      const entry = async (daysAgo, id, input, output, label) => {
        const a = utf8(input); const b = utf8(output);
        const ha = 'sha256-' + (await sha256Hex(a)); const hb = 'sha256-' + (await sha256Hex(b));
        const time = new Date(now - daysAgo * ${DAY}).toISOString();
        const line = recordLine({ v: 1, id, owner: 'json', kind: 'result', session: id, time, schema: 1, label, text: input,
          payload: { action: 'format', indent: 2, sortKeys: false, ok: true },
          blobs: [{ name: 'input', hash: ha, size: a.length, type: 'application/json' },
                  { name: 'output', hash: hb, size: b.length, type: 'application/json' }] });
        await store.add([line], [{ hash: ha, size: a.length, type: 'application/json', data: new Blob([a]) },
                                 { hash: hb, size: b.length, type: 'application/json', data: new Blob([b]) }]);
      };
      await entry(5, '01SEEDF1VEDAYSAG0000000000', '{"seed":"five days"}', '{\\n  "seed": "five days"\\n}', 'Seeded five days ago');
      await entry(2, '01SEEDTW0DAYSAG00000000000', '{"seed":"two days"}', '{\\n  "seed": "two days"\\n}', 'Seeded two days ago');
      export default Array.from(await collect(zipArchive.write(store, {}, { producer: { name: 'e2e', version: '0' }, now })));
    `),
  );

/** Every record line and every blob of the page's history database, for a byte-for-byte comparison. */
const dumpHistory = page =>
  page.evaluate(async () => {
    // Never create the database here: if the app has not made it yet, the upgrade is aborted and nothing exists.
    const db = await new Promise(res => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { records: [], blobs: [], keyrings: [] };
    const all = name =>
      new Promise((res, rej) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const hex = buf => [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('');
    const records = (await all('records')).map(r => r.line).sort();
    const blobs = [];
    for (const b of await all('blobs'))
      blobs.push(
        `${b.hash} ${b.type} ${b.kid ?? ''} ${b.size} ${hex(await crypto.subtle.digest('SHA-256', await b.data.arrayBuffer()))}`,
      );
    const keyrings = (await all('keyrings')).map(k => k.line).sort();
    db.close();
    return { records, blobs: blobs.sort(), keyrings };
  });

const recordCount = async page => (await dumpHistory(page)).records.length;

export const runHistoryChecks = async ({ ctx, id, check, shoot, report, sleep, root }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const pages = [];
  const open = async (hash, viewport = { width: 1440, height: 900 }) => {
    const p = await ctx.newPage();
    await p.setViewportSize(viewport);
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    // Right after the extension reloads (allowing incognito does that), Chrome blocks its pages for a moment.
    for (let i = 0; ; i++) {
      try {
        await p.goto(`${base}${hash}`);
        break;
      } catch (error) {
        if (i > 40 || !/ERR_BLOCKED_BY_CLIENT/.test(String(error))) throw error;
        await sleep(250);
      }
    }
    pages.push(p);
    return p;
  };
  const state = join(root, '.state/e2e/history');
  mkdirSync(state, { recursive: true });
  const historyReport = (report.history = {});

  // Earlier steps of the run (the start page hands pasted JSON to the tool) have recorded already: count, then start
  // from an empty history.
  const tool = await open('#/tools/json');
  historyReport.recordedByEarlierSteps = await recordCount(tool);
  await tool.evaluate(async () => {
    const db = await new Promise(res => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return;
    const tx = db.transaction(['records', 'blobs', 'meta'], 'readwrite');
    for (const name of ['records', 'blobs', 'meta']) tx.objectStore(name).clear();
    await new Promise(res => (tx.oncomplete = res));
    db.close();
  });
  await tool.reload();

  // 1. Record in the JSON tool.
  const line = tool.locator('.kit-tool-history-line');
  await line.waitFor();
  check('the JSON tool says history is kept', /History is on/.test(await line.innerText()), await line.innerText());
  await tool.getByLabel('Input').fill('{"b": 1, "a": [1, 2]}');
  await tool.getByLabel('Sort keys').click();
  // Copy takes the result: recorded at once (the page's clipboard stub; the machine's clipboard is not touched).
  const clipboard = await stubClipboard(tool);
  await tool.getByRole('button', { name: 'Copy', exact: true }).click();
  await sleep(300);
  await clipboard.restore();
  const afterFormat = await recordCount(tool);
  check(
    'a Copy of the result is recorded at once in IndexedDB (the edit before it is covered by it)',
    afterFormat === 1,
    `${afterFormat} records`,
  );
  await tool.getByLabel('Input').fill('{"b": 1, "a": [1, 2, 3]}');
  await sleep(3_600); // the checkpoint rule: an edit is kept once the text has been still for 3 s
  check(
    'an edit is recorded once the text is still',
    (await recordCount(tool)) === 2,
    `${await recordCount(tool)} records`,
  );
  await shoot(tool, 'tool-history-01-json-tool-line.png');

  // 2. The History page lists them; Open brings one back.
  const history = await open('#/history');
  await history.locator('[data-page="history"]').waitFor();
  const count = history.locator('[data-history-count]');
  await history.waitForFunction(
    () => document.querySelector('[data-history-count]')?.getAttribute('data-history-count') === '2',
  );
  check(
    'History lists both entries as one JSON session',
    (await history.locator('.kit-history-session').count()) === 1,
    await count.innerText(),
  );
  await shoot(history, 'tool-history-02-history-page.png');
  const result = history.locator('.kit-history-entry[data-kind="result"]');
  check(
    'the result is labelled by its action and options',
    /Format · 2 spaces · sorted keys/.test(await result.innerText()),
    await result.innerText(),
  );
  await result.getByRole('button', { name: 'Open' }).click();
  await history.waitForFunction(() => location.hash === '#/tools/json');
  await history.locator('[data-restored]').waitFor();
  const restoredInput = await history.getByLabel('Input').inputValue();
  const restoredOutput = await history.locator('#json-output').inputValue();
  check(
    'Open brings the entry back into the tool: text, options and result',
    restoredInput === '{"b": 1, "a": [1, 2]}' &&
      restoredOutput === '{\n  "a": [\n    1,\n    2\n  ],\n  "b": 1\n}' &&
      (await history.getByLabel('Sort keys').getAttribute('data-state')) === 'checked',
    JSON.stringify({ restoredInput, restoredOutput }),
  );
  await history.locator('.kit-tool-history-recent summary').click();
  const recent = history.locator('.kit-tool-history-recent .kit-history-entry');
  check("the tool's own history lists its entries", (await recent.count()) === 2, String(await recent.count()));
  await recent.first().getByRole('button', { name: 'Open' }).click();
  await history.waitForFunction(() => document.querySelector('#json-input')?.value === '{"b": 1, "a": [1, 2, 3]}');
  check("the tool's own history opens an entry too", true);
  await shoot(history, 'tool-history-03-restored-in-tool.png');

  // 3. Restore a file made elsewhere, filter, delete by interval.
  const now = Date.now();
  const seedFile = join(state, 'seed.zip');
  writeFileSync(seedFile, await seedArchive(now));
  await history.goto(`${base}#/history`);
  await history.locator('[data-history-restore-input]').setInputFiles(seedFile);
  const restore = history.getByRole('region', { name: 'Restore from file' });
  await restore.getByText('Every checksum matches').waitFor();
  await shoot(history, 'tool-history-04-restore-inspected.png');
  await restore.getByRole('button', { name: 'Restore', exact: true }).click();
  await history.getByText('Restored 2 entries.').waitFor();
  await history.waitForFunction(
    () => document.querySelector('[data-history-count]')?.getAttribute('data-history-count') === '4',
  );
  check('restore from a file adds its entries', true, await count.innerText());
  await history
    .locator('.kit-history-entry', { hasText: 'Seeded two days ago' })
    .getByRole('button', { name: 'Open' })
    .click();
  await history.waitForFunction(() => location.hash === '#/tools/json');
  await history.locator('[data-restored]').waitFor();
  const seededInput = await history.getByLabel('Input').inputValue();
  const seededOutput = await history.locator('#json-output').inputValue();
  check(
    "an entry the JSON tool's first version wrote (schema 1) opens in the rewritten tool",
    seededInput === '{"seed":"two days"}' && seededOutput === '{\n  "seed": "two days"\n}',
    JSON.stringify({ seededInput, seededOutput }),
  );
  await history.goto(`${base}#/history`);
  await history.waitForFunction(
    () => document.querySelector('[data-history-count]')?.getAttribute('data-history-count') === '4',
  );

  const counted = () => history.locator('[data-history-count]').getAttribute('data-history-count');
  const waitCount = async n => {
    await history.waitForFunction(
      want => document.querySelector('[data-history-count]')?.getAttribute('data-history-count') === want,
      String(n),
      { timeout: 5_000 },
    );
    return true;
  };
  await history.getByLabel('Text', { exact: true }).fill('five days');
  check('the text filter narrows the list', await waitCount(1).catch(() => false), await counted());
  await history.getByLabel('Text', { exact: true }).fill('');
  await waitCount(4);
  await history.getByLabel('Kind', { exact: true }).click();
  await history.getByRole('option', { name: 'Edit' }).click();
  check('the kind filter narrows the list', await waitCount(1).catch(() => false), await counted());
  await history.getByLabel('Kind', { exact: true }).click();
  await history.getByRole('option', { name: 'All kinds' }).click();
  await waitCount(4);
  await history.getByRole('radio', { name: '24 hours' }).click();
  check('the period "24 hours" leaves out the older entries', await waitCount(2).catch(() => false), await counted());
  await history.getByRole('radio', { name: 'Dates' }).click();
  const day = ms => new Date(ms).toLocaleDateString('en-CA');
  await history.getByLabel('From', { exact: true }).fill(day(now - 6 * DAY));
  await history.getByLabel('To', { exact: true }).fill(day(now - 4 * DAY));
  check('a date interval shows only the entry inside it', await waitCount(1).catch(() => false), await counted());
  await shoot(history, 'tool-history-05-filtered-by-dates.png');
  const beforeInterval = await dumpHistory(history);
  await history.getByRole('button', { name: 'Delete shown…' }).click();
  const confirm = history.getByRole('alertdialog');
  await confirm.waitFor();
  const confirmText = await confirm.innerText();
  check(
    'before deleting, it says how many entries and bytes go, and asks',
    /1 entry and [\d.]+ (B|KB)/.test(confirmText) && /cannot be undone/.test(confirmText),
    confirmText,
  );
  await shoot(history, 'tool-history-06-confirm-delete.png');
  await confirm.getByRole('button', { name: 'Delete permanently' }).click();
  await history.getByText(/^Deleted 1 entry/).waitFor();
  const afterInterval = await dumpHistory(history);
  check(
    'deleting by interval removes exactly that entry (and the blobs only it used)',
    afterInterval.records.length === 3 &&
      !afterInterval.records.some(l => l.includes('Seeded five days ago')) &&
      afterInterval.records.some(l => l.includes('Seeded two days ago')) &&
      afterInterval.blobs.length === beforeInterval.blobs.length - 2,
    `${afterInterval.records.length} records, ${afterInterval.blobs.length} blobs`,
  );
  historyReport.deletedByInterval = 1;

  // 4. Export all, delete everything, restore, compare byte for byte.
  await history.getByRole('radio', { name: 'All time' }).click();
  await waitCount(3);
  const before = await dumpHistory(history);
  const downloadEvent = history.waitForEvent('download');
  await history.getByRole('button', { name: 'Export all' }).click();
  const download = await downloadEvent;
  const exported = join(state, 'export.zip');
  await download.saveAs(exported);
  const exportedBytes = readFileSync(exported);
  historyReport.export = { name: download.suggestedFilename(), bytes: exportedBytes.length };
  check(
    'Export all saves one ZIP file named after the product and the time',
    /^[a-z0-9-]+-history-\d{4}-\d{2}-\d{2}-\d{4}\.zip$/.test(download.suggestedFilename()) &&
      exportedBytes.subarray(30, 38).toString() === 'mimetype',
    `${download.suggestedFilename()}, ${exportedBytes.length} bytes`,
  );
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  await group.getByRole('button', { name: 'Delete everything…' }).click();
  await group.getByRole('alertdialog').getByRole('button', { name: 'Delete permanently' }).click();
  await group.getByText(/^Deleted 3 entries/).waitFor();
  const wiped = await dumpHistory(settings);
  check(
    '"Delete everything" leaves no record and no blob',
    !wiped.records.length && !wiped.blobs.length,
    JSON.stringify(wiped).slice(0, 200),
  );
  await history.reload();
  await history.locator('[data-history-restore-input]').setInputFiles(exported);
  await history
    .getByRole('region', { name: 'Restore from file' })
    .getByRole('button', { name: 'Restore', exact: true })
    .click();
  await history.getByText('Restored 3 entries.').waitFor();
  const after = await dumpHistory(history);
  check(
    'export → delete everything → restore gives byte-identical records and blobs',
    JSON.stringify(after) === JSON.stringify(before),
    `${after.records.length} records, ${after.blobs.length} blobs`,
  );

  // Refusals: a file that is not ours, a damaged one.
  const foreign = join(state, 'foreign.zip');
  writeFileSync(foreign, Buffer.from('not a zip archive at all'));
  await history.locator('[data-history-restore-input]').setInputFiles(foreign);
  await history
    .getByText('This file is not a history export: it is not a ZIP archive. Nothing was imported.')
    .waitFor();
  const damaged = Buffer.from(exportedBytes);
  const recordsAt = damaged.indexOf('records.jsonl') + 'records.jsonl'.length + 20;
  damaged[recordsAt] ^= 0xff;
  const damagedFile = join(state, 'damaged.zip');
  writeFileSync(damagedFile, damaged);
  await history.locator('[data-history-restore-input]').setInputFiles(damagedFile);
  await history.getByText(/^The file is damaged \(/).waitFor();
  check(
    'a foreign file and a damaged one are refused with their own messages, writing nothing',
    JSON.stringify(await dumpHistory(history)) === JSON.stringify(before),
  );

  // 5. The master switch.
  await settings.reload();
  await group.waitFor();
  await shoot(settings, 'tool-history-07-settings.png');
  await group.getByLabel('Keep a history of my tools').click();
  await tool.reload();
  await tool.locator('.kit-tool-history-line').waitFor();
  const offLine = await tool.locator('.kit-tool-history-line').innerText();
  await tool.getByLabel('Input').fill('{"off": true}');
  const offClipboard = await stubClipboard(tool);
  await tool.getByRole('button', { name: 'Copy', exact: true }).click();
  await sleep(500);
  await offClipboard.restore();
  check(
    'with history off the tool says so and records nothing',
    /off/.test(offLine) && (await recordCount(tool)) === 3,
    offLine,
  );
  await group.getByLabel('Keep a history of my tools').click();
  await tool.locator('.kit-tool-history[data-history-state="on"]').waitFor();
  check('switched on again, the tool says so', true);

  // 6. A master password, made here and thrown away.
  const password = `e2e-${[...crypto.getRandomValues(new Uint8Array(12))].map(b => b.toString(36)).join('')}-Zz9`;
  await group.getByRole('button', { name: 'Set a master password…' }).click();
  await group.locator('.kit-history-vault-warning').scrollIntoViewIfNeeded();
  await shoot(settings, 'tool-history-08-master-password-form.png');
  check(
    'setting a master password says plainly that it cannot be recovered',
    /no way to recover this password/.test(await group.innerText()),
  );
  await group.getByLabel('Master password', { exact: true }).fill(password);
  await group.getByLabel('The same again').fill(password);
  const setButton = group.getByRole('button', { name: 'Set the master password' });
  check('it cannot be set before the warning is acknowledged', await setButton.isDisabled());
  await group.getByLabel('I understand: forgotten means lost').click();
  const t0 = Date.now();
  await setButton.click();
  await group.getByText('The master password is set and the history is unlocked.').waitFor();
  historyReport.setPasswordMs = Date.now() - t0;
  const second = await open('#/history');
  await second.locator('.kit-history-lock[data-vault="unlocked"]').waitFor();
  check('a second tab shares the unlock', true);
  await second.getByRole('button', { name: 'Lock now' }).click();
  await settings.locator('[data-vault="locked"]').first().waitFor();
  check('locking in one tab locks the other', true);
  await group.getByLabel('Master password', { exact: true }).fill(`${password}x`);
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('That is not the master password.').waitFor();
  check('a wrong password is refused', (await settings.locator('[data-vault="locked"]').count()) > 0);
  await group.getByLabel('Master password', { exact: true }).fill(password);
  const t1 = Date.now();
  await group.getByRole('button', { name: 'Unlock' }).click();
  await group.getByText('Unlocked.').waitFor();
  historyReport.unlockMs = Date.now() - t1;
  await second.locator('.kit-history-lock[data-vault="unlocked"]').waitFor();
  check('unlocking in one tab unlocks the other', true, `unlock ${historyReport.unlockMs} ms`);
  // Read from an extension page, not the service worker: by this point of a long run Chrome may have stopped the idle
  // worker, and a handle taken at the start is dead. Extension pages see the same storage areas.
  const session = await settings.evaluate(
    async () => Object.keys((await chrome.storage.session.get('historyKeys')).historyKeys?.keys ?? {}).length,
  );
  const local = await settings.evaluate(async () => JSON.stringify(await chrome.storage.local.get(null)));
  check(
    'the unwrapped key is in session storage only; the password is nowhere',
    session === 1 && !local.includes(password),
  );
  const withKey = second.waitForEvent('download');
  await second.getByRole('button', { name: 'Export all' }).click();
  const keyed = join(state, 'export-with-password.zip');
  await (await withKey).saveAs(keyed);
  const keyedBytes = readFileSync(keyed);
  check(
    'an export of everything carries the wrapped key (so the password comes along), never the password',
    keyedBytes.includes(Buffer.from('keyrings.jsonl')) && !keyedBytes.includes(Buffer.from(password)),
  );
  await group.getByRole('button', { name: 'Turn off…' }).click();
  await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
  await group.getByText(/^The master password is off/).waitFor();
  check('turning the master password off removes it', (await settings.locator('[data-vault="none"]').count()) > 0);

  // 7. Incognito. Allowing the extension there reloads it: its pages close.
  for (const p of pages) await p.close();
  pages.length = 0;
  const counted0 = (await dumpHistory(await open('#/history'))).records.length;
  const setIncognito = async allowed => {
    const ext = await ctx.newPage();
    await ext.goto('chrome://extensions/');
    await ext.evaluate(
      async ([extId, value]) => {
        // Without developer mode Chrome does not load the unpacked extension again after the reload this causes.
        await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
        await chrome.developerPrivate.updateExtensionConfiguration({ extensionId: extId, incognitoAccess: value });
      },
      [id, allowed],
    );
    await ext.close();
    await sleep(1_500);
  };
  await setIncognito(true);
  // From a page of ours in a normal window: it has chrome.windows and chrome.tabs, as the service worker has.
  const driver = await open('#/settings');
  const incognito = await driver.evaluate(async url => {
    const w = await chrome.windows.create({ incognito: true, url });
    await new Promise(r => setTimeout(r, 2_000));
    const [tab] = await chrome.tabs.query({ windowId: w.id });
    const created = await chrome.tabs.create({ windowId: w.id, url });
    await new Promise(r => setTimeout(r, 2_000));
    const after = await chrome.tabs.get(created.id);
    await chrome.windows.remove(w.id);
    await chrome.tabs.remove(created.id);
    return {
      allowed: await chrome.extension.isAllowedIncognitoAccess(),
      tabUrl: tab?.url,
      tabTitle: tab?.title,
      createdIncognito: after.incognito,
    };
  }, `${base}#/tools/json`);
  historyReport.incognito = incognito;
  const counted1 = (await dumpHistory(await open('#/history'))).records.length;
  check(
    'incognito: our page does not run in an incognito window, a tab created for it opens in a normal window, nothing is recorded',
    incognito.allowed &&
      // Blocked: the tab shows Chrome's error page, titled by the address, not our page's title.
      incognito.tabTitle === incognito.tabUrl &&
      incognito.createdIncognito === false &&
      counted1 === counted0,
    JSON.stringify(incognito),
  );
  for (const p of pages) await p.close();
  pages.length = 0;
  await setIncognito(false);
};

// On its own: node scripts/e2e-history.mjs [<dist>] [--shots=<dir>]
if (import.meta.url === `file://${process.argv[1]}`) {
  const { createRequire } = await import('node:module');
  const { mkdtempSync, rmSync } = await import('node:fs');
  const root = resolve(new URL('..', import.meta.url).pathname);
  const argv = process.argv.slice(2);
  const dist = resolve(argv.find(a => !a.startsWith('--')) ?? join(root, 'dist'));
  const shots = argv.find(a => a.startsWith('--shots='))?.slice(8);
  process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(root, '.state/extension-e2e/browsers');
  const { chromium } = createRequire(join(root, '.state/e2e/node/package.json'))('playwright');
  mkdirSync(join(root, '.state/e2e/profiles'), { recursive: true });
  const profile = mkdtempSync(join(root, '.state/e2e/profiles/history-'));
  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${dist}`, `--load-extension=${dist}`, '--lang=en-US'],
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
    acceptDownloads: true,
  });
  const report = { checks: [], console: [] };
  const check = (name, ok, detail = '') => {
    report.checks.push({ name, ok, detail });
    console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
    return ok;
  };
  const shoot = async (target, name) => {
    if (!shots) return;
    mkdirSync(resolve(shots), { recursive: true });
    await target.screenshot({ path: join(resolve(shots), name) });
  };
  try {
    let [sw] = ctx.serviceWorkers();
    sw ??= await ctx.waitForEvent('serviceworker');
    await runHistoryChecks({
      ctx,
      sw,
      id: new URL(sw.url()).host,
      check,
      shoot,
      report,
      sleep: ms => new Promise(r => setTimeout(r, ms)),
      root,
    });
    const errors = report.console.filter(m => m.type !== 'warning');
    check('no console errors or page errors', !errors.length, errors.map(e => e.text).join(' | '));
  } catch (error) {
    check('the run finished', false, String(error?.stack ?? error));
  } finally {
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
  console.log(JSON.stringify(report.history ?? {}, null, 2));
  process.exit(report.checks.every(c => c.ok) ? 0 : 1);
}
