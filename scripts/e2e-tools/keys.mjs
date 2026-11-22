// The Key Pairs tool in the built extension (docs/tools/specs/keys.md): its scenarios (§2) with the page's real
// controls, in the shared tab (navigated in place: location.replace):
//   - Generate: Ed25519 with a comment (the OpenSSH line, its fingerprint, the private key hidden until shown), RSA 4096
//     timed with the page's longest frame while the browser makes the key ("Generating…", the page answers);
//   - Inspect: a private key (SEC1) made here by node:crypto and thrown away, a JWK Set, messages next to the field;
//   - Copy copies (a stand-in for navigator.clipboard.writeText — the machine's clipboard is never touched);
//   - the history keeps public keys: a record is written and opens back into the tool, with only the public key;
//   - after generating, converting and leaving the page, nothing of any private key is in chrome.storage (local and
//     session), localStorage or any IndexedDB database of the extension — read back in full;
//   - the start page's field opens this tool for a pasted key, X.509 for a certificate, JSON for a JWK;
//   - saved parameters: changed, reopened — as left; forgotten at the end;
//   - nothing goes to the network.
// Screenshots light and dark: tool-keys-NN-….png. Run by scripts/e2e-tools.mjs.

/* global document, location, DataTransfer, ClipboardEvent, indexedDB, chrome, requestAnimationFrame -- page.evaluate callbacks run in the page */

import {
  forgetSavedParameters,
  inDarkTheme,
  settledShot,
  stubClipboard,
  waitForHistoryRecord,
} from '../e2e-helpers.mjs';
import { generateKeyPairSync } from 'node:crypto';

const T = 'Key Pairs';

/** Everything the extension keeps in this profile, as text: chrome.storage (local, session), localStorage, IndexedDB. */
const storageDump = page =>
  page.evaluate(async () => {
    const parts = [];
    parts.push(JSON.stringify(await chrome.storage.local.get(null)));
    try {
      parts.push(JSON.stringify(await chrome.storage.session.get(null)));
    } catch {
      parts.push('(no session storage)');
    }
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      parts.push(`${key}=${localStorage.getItem(key)}`);
    }
    for (const info of await indexedDB.databases()) {
      const db = await new Promise(resolve => {
        const r = indexedDB.open(info.name);
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      });
      if (!db) continue;
      for (const name of db.objectStoreNames) {
        const rows = await new Promise(resolve => {
          const r = db.transaction(name).objectStore(name).getAll();
          r.onsuccess = () => resolve(r.result);
          r.onerror = () => resolve([]);
        });
        for (const row of rows) {
          parts.push(JSON.stringify(row, (k, v) => (v instanceof Blob ? `[blob ${v.size}]` : v)));
          for (const v of Object.values(row ?? {})) if (v instanceof Blob) parts.push(await v.text());
        }
      }
      db.close();
    }
    return parts.join('\n');
  });

export default async ({ ctx, page, base, check, shoot, sleep, report }) => {
  const requests = [];
  const onRequest = r => requests.push(r.url());
  page.on('request', onRequest);
  const go = hash => page.evaluate(url => location.replace(url), `${base}${hash}`);
  const shot = file => settledShot(shoot, page, file);
  const summary = () => page.locator('[data-summary]').textContent();
  const publicField = page.getByLabel('Public key', { exact: true });
  const form = (group, name) => page.getByRole('radiogroup', { name: group }).getByRole('radio', { name, exact: true });
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const secrets = [];

  await page.goto(`${base}#/tools/keys`);
  await page.locator('[data-generate]').waitFor({ timeout: 10_000 });
  const clipboard = await stubClipboard(page);
  try {
    // §2.1: opens in Generate, Ed25519, nothing made.
    check(
      `${T}: opens in Generate with Ed25519 and nothing made`,
      (await page.getByLabel('Algorithm', { exact: true }).textContent()) === 'Ed25519' &&
        (await page.locator('[data-key]').count()) === 0 &&
        (await page
          .getByText('Choose an algorithm and press Generate. The private key stays in this page.')
          .count()) === 1,
    );
    await shot('tool-keys-01-empty.png');

    await page.getByLabel('Comment', { exact: true }).fill('alice@laptop');
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    await page.locator('[data-summary]').waitFor();
    const line = (await publicField.inputValue()).trim();
    const sha = await page.getByLabel('SHA256 (OpenSSH)', { exact: true }).textContent();
    check(
      `${T}: §2.1 Generate makes an Ed25519 pair — the OpenSSH line with the comment, its SHA256 fingerprint, the private key hidden`,
      (await summary()) === 'Ed25519 key pair' &&
        /^ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAI[A-Za-z0-9+/]{43} alice@laptop$/.test(line) &&
        /^SHA256:[A-Za-z0-9+/]{43}$/.test(sha ?? '') &&
        (await page.getByText('Hidden. Copy and Save work without showing it.').count()) === 1 &&
        (await page.getByLabel('Private key', { exact: true }).count()) === 0,
      line,
    );
    await shot('tool-keys-02-generated.png');
    await page.locator('[data-show-private]').click();
    const privatePem = await page.getByLabel('Private key', { exact: true }).inputValue();
    secrets.push(privatePem.split('\n')[1]);
    await form('Private key form', 'OpenSSH').click();
    const opensshPrivate = await page.getByLabel('Private key', { exact: true }).inputValue();
    secrets.push(opensshPrivate.split('\n')[2]);
    check(
      `${T}: Show private key shows PKCS#8, and the OpenSSH file form`,
      privatePem.startsWith('-----BEGIN PRIVATE KEY-----\nMC4CAQAwBQYDK2VwBCIEI') && // gitleaks:allow — a prefix check, no key
        opensshPrivate.startsWith('-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQ'),
    );
    await page.locator('[data-copy-public]').click();
    await sleep(100);
    check(`${T}: Copy copies the public key line`, (await clipboard.copied()).at(-1) === `${line}\n`);
    await page.locator('[data-show-private]').click();
    await inDarkTheme(ctx, base, page, () => shot('tool-keys-03-generated-dark.png'));

    // The record is written, with the public key only.
    const record = await waitForHistoryRecord(page, 'keys', r => r.kind === 'generated' && r.label?.endsWith(sha));
    check(
      `${T}: Generate writes a history record "generated" labelled with the kind and fingerprint`,
      record.label === `Ed25519 key pair · ${sha}`,
      record.label,
    );

    // RSA 4096: the browser makes it off the page's thread; the page answers ("Generating…", its frames).
    await choose('Algorithm', 'RSA');
    await page.getByRole('radio', { name: '4096', exact: true }).click();
    await page.evaluate(() => {
      const gaps = [];
      let last = performance.now();
      let on = true;
      const tick = t => {
        gaps.push(t - last);
        last = t;
        if (on) requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
      globalThis.__keysFrames = () => {
        on = false;
        return gaps;
      };
    });
    const started = Date.now();
    await page.getByRole('button', { name: 'Generate', exact: true }).click();
    const sawBusy = await page
      .locator('[data-busy]')
      .waitFor({ timeout: 2000 })
      .then(() => true)
      .catch(() => false);
    await page.waitForFunction(
      () => document.querySelector('[data-summary]')?.textContent === 'RSA 4096-bit key pair',
      null,
      { timeout: 30_000 },
    );
    const elapsed = Date.now() - started;
    const gaps = await page.evaluate(() => globalThis.__keysFrames());
    const longest = Math.round(Math.max(...gaps.slice(1)));
    report.keys = { ...(report.keys ?? {}), rsa4096Ms: elapsed, longestFrameMs: longest, busyShown: sawBusy };
    check(
      `${T}: RSA 4096 — the browser makes it while the page answers (longest frame ${longest} ms, ${elapsed} ms in all)`,
      longest < 200,
      `${elapsed} ms, longest frame ${longest} ms, "Generating…" seen: ${sawBusy}`,
    );
    await page.locator('[data-show-private]').click();
    secrets.push((await page.getByLabel('Private key', { exact: true }).inputValue()).split('\n')[5]);
    await page.locator('[data-show-private]').click();
    await shot('tool-keys-04-rsa.png');

    // §2.5: Inspect a private key (made here, thrown away): its public key, the private forms hidden.
    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
    const sec1 = ec.privateKey.export({ type: 'sec1', format: 'pem' }).toString();
    secrets.push(sec1.split('\n')[1], ec.privateKey.export({ format: 'jwk' }).d);
    await page.getByRole('radio', { name: 'Inspect', exact: true }).click();
    const field = page.getByLabel('Key', { exact: true });
    await field.fill(sec1);
    await page.waitForFunction(
      () => document.querySelector('[data-summary]')?.textContent === 'EC P-256 private key (SEC1)',
    );
    const derived = (await publicField.inputValue()).trim();
    const theirs = ec.publicKey.export({ type: 'spki', format: 'pem' }).toString().trim();
    await form('Public key form', 'PEM').click();
    check(
      `${T}: §2.5 a pasted SEC1 private key — its public key is node:crypto's, the private key hidden`,
      derived.startsWith('ecdsa-sha2-nistp256 ') &&
        (await publicField.inputValue()).trim() === theirs &&
        (await page.getByText('Hidden. Copy and Save work without showing it.').count()) === 1,
    );
    await form('Public key form', 'OpenSSH').click();
    await shot('tool-keys-05-inspect-private.png');
    await page.locator('[data-show-private]').click();
    await form('Private key form', 'JWK').click();
    await inDarkTheme(ctx, base, page, () => shot('tool-keys-06-inspect-private-dark.png'));
    await page.locator('[data-show-private]').click();
    // Its record is the public key: Copy commits it at once.
    await page.locator('[data-copy-public]').click();
    await waitForHistoryRecord(page, 'keys', r => r.kind === 'inspected');

    // §2.4 a JWK Set; §6 messages next to the field.
    const ed = generateKeyPairSync('ed25519').publicKey.export({ format: 'jwk' });
    await field.fill(
      JSON.stringify({
        keys: [
          { ...ed, kid: 'a' },
          { kty: 'RSA', e: 'AQAB' },
        ],
      }),
    );
    await page.getByText('2 keys', { exact: true }).waitFor();
    check(
      `${T}: §2.4 a JWK Set — a switch "2 keys", the bad key's message in its place`,
      (await page.locator('[data-message="error"]').textContent()) === 'Key 2: The JWK has no "n".' &&
        (await summary()) === 'Ed25519 public key (JWK Set), kid "a"',
    );
    await field.fill('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----');
    await page.waitForFunction(() =>
      document.querySelector('[data-message="error"]')?.textContent?.startsWith('This is a certificate'),
    );
    check(
      `${T}: §6 a certificate is named and sent to the X.509 tool, in a polite status`,
      (await page.locator('[data-message="error"]').textContent()) ===
        'This is a certificate, not a key. The X.509 Certificate tool reads certificates and shows their public key.' &&
        (await page.locator('[data-message="error"]').getAttribute('role')) === 'status',
    );
    await field.fill('');

    // Leaving the page: the generated pair is gone.
    await go('#/tools/json');
    await page.locator('#json-input').waitFor();
    await go('#/tools/keys');
    await page.locator('[data-inspect]').waitFor({ timeout: 10_000 });
    await page.getByRole('radio', { name: 'Generate', exact: true }).click();
    check(
      `${T}: after leaving the page and coming back, the generated pair is gone`,
      (await page.locator('[data-key]').count()) === 0,
    );

    // The history entry opens back into the tool with the public key only.
    await go('#/history');
    await page.locator('[data-page="history"]').waitFor();
    const entry = page.locator('.kit-history-entry[data-kind="generated"]', { hasText: sha });
    await entry.first().waitFor({ timeout: 5000 });
    await entry.first().getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor({ timeout: 5000 });
    await page.locator('[data-summary]').waitFor();
    check(
      `${T}: a "generated" entry opens in Inspect with its public key; the page says only the public key was kept`,
      (await page.getByLabel('Key', { exact: true }).inputValue()).trim() === line &&
        /Only the public key was kept\.$/.test((await page.locator('[data-restored]').textContent()) ?? '') &&
        (await page.locator('[data-private]').count()) === 0,
    );
    await page.getByRole('button', { name: 'Clear', exact: true }).click();

    // Saved parameters: changed, reopened — as left.
    await page.getByRole('radio', { name: 'Generate', exact: true }).click();
    await choose('Algorithm', 'ECDSA P-384');
    await go('#/tools/json');
    await page.locator('#json-input').waitFor();
    await go('#/tools/keys');
    await page.locator('[data-generate]').waitFor({ timeout: 10_000 });
    check(
      `${T}: saved parameters — changed to ECDSA P-384 in Generate, reopened as left`,
      (await page.getByLabel('Algorithm', { exact: true }).textContent()) === 'ECDSA P-384',
    );

    // §7: the start page's field.
    const paste = async value => {
      await go('#/start');
      const f = page.getByRole('combobox', { name: 'Find a tool or search the web' });
      await f.waitFor();
      await f.focus();
      await page.evaluate(v => {
        const data = new DataTransfer();
        data.setData('text/plain', v);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, value);
      await page.waitForFunction(() => location.hash !== '#/start', null, { timeout: 3_000 }).catch(() => {});
      await sleep(200);
      return page.evaluate(() => location.hash);
    };
    const pkcs8 = generateKeyPairSync('ed25519').privateKey.export({ type: 'pkcs8', format: 'pem' }).toString();
    secrets.push(pkcs8.split('\n')[1]);
    const opened = {
      privateKey: await paste(pkcs8),
      sshLine: await paste(line),
      jwk: await paste(JSON.stringify(ed)),
      certificate: await paste('-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n'),
    };
    check(
      `${T}: §7 the start page opens this tool for a private key and an OpenSSH line, X.509 for a certificate, JSON for a JWK`,
      opened.privateKey === '#/tools/keys' &&
        opened.sshLine === '#/tools/keys' &&
        opened.certificate === '#/tools/x509' &&
        opened.jwk === '#/tools/json',
      JSON.stringify(opened),
    );

    // After generating, converting and leaving: nothing of a private key anywhere the extension keeps things.
    await go('#/tools/json');
    await page.locator('#json-input').waitFor();
    await sleep(3500); // past the history's 3 s snapshot rest
    const dump = await storageDump(page);
    const found = secrets.filter(s => s && dump.includes(s));
    check(
      `${T}: no private key (${secrets.length} probes) in chrome.storage, localStorage or any IndexedDB of the extension; the public key is in the history`,
      secrets.length === 6 && found.length === 0 && !dump.includes('PRIVATE KEY') && dump.includes(line.split(' ')[1]),
      `${dump.length} characters read; found ${found.length}`,
    );

    const outside = requests.filter(u => !u.startsWith('chrome-extension://') && !u.startsWith('data:'));
    check(
      `${T}: nothing is fetched — every request is to the extension itself`,
      outside.length === 0,
      outside.join(', '),
    );
  } finally {
    page.off('request', onRequest);
    await clipboard.restore().catch(() => undefined);
    await forgetSavedParameters(page, 'keys');
  }
};
