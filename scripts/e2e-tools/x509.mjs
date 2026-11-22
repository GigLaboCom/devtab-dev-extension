// The X.509 Certificate tool in the built extension (docs/tools/specs/x509.md): its scenarios (§2) with the page's real
// controls, in a page of its own whose time zone and locale are set through CDP and whose clock is its own (so the
// validity lines are stable), closed at the end — the shared tab keeps its history length and its real clock:
//   - a certificate, a chain from `openssl s_client -showcerts`, a DER file, an expired CA, a private key pasted with a
//     certificate, a request, broken Base64 and a truncated certificate;
//   - the status ticks with the clock; Copy copies (a stand-in for navigator.clipboard.writeText, nothing reaches the
//     machine's clipboard);
//   - the history keeps the certificates and never the private key (records and blobs read back from IndexedDB);
//   - the start page's field opens the tool for a pasted certificate, not for a public key;
//   - nothing goes to the network: every request the page makes is to the extension itself.
// Certificates are the generated fixtures of packages/tools/logic/x509/fixtures (invented names); the private key is
// made here by node:crypto and thrown away. Screenshots light and dark: tool-x509-NN-….png. Run by scripts/e2e-tools.mjs.

/* global document, location, DataTransfer, ClipboardEvent, indexedDB -- page.evaluate callbacks run in the page */

import { generateKeyPairSync } from 'node:crypto';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inDarkTheme, settledShot, stubClipboard } from '../e2e-helpers.mjs';

const T = 'X.509 Certificate';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..');
const FIXTURES = join(ROOT, 'packages/tools/logic/x509/fixtures');
const pem = name => readFileSync(join(FIXTURES, `${name}.pem`), 'utf8');
const LEAF = pem('spec-leaf');
const CA = pem('spec-ca');
const CHAIN = `${pem('leaf-p256')}${pem('issuing-rsa4096')}${pem('root-rsa2048')}`;
const SHA256 = '9A:0F:75:02:BB:18:B0:85:BB:8F:7C:81:F8:9A:05:CB:44:22:5A:D9:B7:48:50:01:7F:E2:C4:80:07:35:D9:BD';
const derOf = text => Buffer.from(text.replace(/-----[^-]+-----/g, '').replace(/\s/g, ''), 'base64');

/** Every row of the history's records and blobs (blob contents as text), read without creating the database. */
const historyDump = page =>
  page.evaluate(async () => {
    const db = await new Promise(resolve => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => resolve(null);
    });
    if (!db) return { records: [], blobs: [] };
    const all = name =>
      new Promise((resolve, reject) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
      });
    const records = (await all('records')).map(r => ({ owner: r.owner, line: r.line, blobs: r.blobs ?? [] }));
    const blobs = await Promise.all((await all('blobs')).map(async b => ({ hash: b.hash, text: await b.data.text() })));
    db.close();
    return { records, blobs };
  });

/**
 * A clock of this page alone. Playwright's own clock belongs to the whole browser context and cannot be taken back: a
 * fixed time set through it stayed for every later page of the run, and the history checks that follow this module met
 * 19 November (their "last 24 hours" and the vault's unlock both went wrong). This replaces `Date` in the one page, from
 * its first script on; timers keep running.
 */
const pageClock = fixed => {
  const RealDate = Date;
  let now = fixed;
  class PageDate extends RealDate {
    constructor(...args) {
      if (args.length === 0) super(now);
      else super(...args);
    }
    static now() {
      return now;
    }
  }
  globalThis.__setNow = value => {
    now = value;
  };
  globalThis.Date = PageDate;
};
const setNow = (page, time) => page.evaluate(ms => globalThis.__setNow(ms), Date.parse(time));

export default async ({ ctx, base, check, shoot, sleep, report }) => {
  const p = await ctx.newPage();
  // Tall enough for a whole certificate: the screenshots are of the tool's frame, which must fit in the viewport.
  await p.setViewportSize({ width: 1280, height: 2400 });
  p.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
  });
  p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  const requests = [];
  p.on('request', r => requests.push(r.url()));
  const dir = join(ROOT, '.state/e2e/x509');
  mkdirSync(dir, { recursive: true });

  try {
    const cdp = await ctx.newCDPSession(p);
    await cdp.send('Emulation.setTimezoneOverride', { timezoneId: 'Europe/Berlin' });
    await cdp.send('Emulation.setLocaleOverride', { locale: 'en-US' });
    await p.addInitScript(pageClock, Date.parse('2026-11-19T00:00:00Z'));
    await p.goto(`${base}#/tools/x509`);
    const field = p.getByLabel('Input', { exact: true });
    await field.waitFor();
    const frame = p.locator('[data-slot="tool-page"]');
    const text = selector => p.locator(selector).first().innerText();
    const messages = () => p.locator('[data-message]').allInnerTexts();
    const shot = file => settledShot(shoot, frame, file);
    const clipboard = await stubClipboard(p);

    // The page frame and the empty state (§8).
    check(
      `${T}: the page opens empty with the hint that it reads and does not check`,
      (await frame.locator('h2').first().innerText()) === T &&
        (await p.locator('[data-slot="tool-empty"]').innerText()) ===
          'Paste a certificate or open a .pem, .crt, .cer or .der file.' &&
        (await text('[data-hint]')) ===
          'This tool reads certificates. It does not check signatures, trust or revocation.',
    );

    // §2.1: LEAF — name, status, self-issued, key, names, fingerprint with Copy.
    await field.fill(LEAF);
    await p
      .getByRole('status', { name: 'SHA-256', exact: true })
      .filter({ hasText: SHA256 })
      .waitFor({ timeout: 10_000 });
    const san = await p.locator('[data-extension="2.5.29.17"] li').allInnerTexts();
    check(
      `${T}: §2.1 the LEAF certificate — name, "Valid: expires in 23 years", Self-issued, EC P-256, its names`,
      (await text('[data-subject-display]')) === 'test.example.com' &&
        (await text('[data-validity]')) === 'Valid: expires in 23 years' &&
        (await p.getByText('Self-issued', { exact: true }).count()) === 1 &&
        (await text('[data-key]')) === 'EC P-256' &&
        san.join('|') ===
          'DNS test.example.com|DNS *.test.example.com|IP 192.0.2.10|IP 2001:db8::1|Email admin@example.com|URI https://example.com/',
      san.join('|'),
    );
    await p.getByRole('button', { name: 'Copy SHA-256', exact: true }).click();
    check(`${T}: §2.1 Copy beside the SHA-256 fingerprint copies it`, (await clipboard.copied()).at(-1) === SHA256);
    const local = (await p.locator('[data-section="Validity"] dd').first().innerText()).replace(/\u202f/g, ' ');
    check(
      `${T}: times in three lines — ISO, local (Europe/Berlin, en-US) and relative`,
      local.split('\n').join('|') === '2025-11-19T12:00:00Z|Nov 19, 2025, 1:00:00 PM GMT+1|12 months ago',
      local,
    );
    await shot('tool-x509-01-leaf-light.png');

    // §2.2: the output of openssl s_client -showcerts — 3 certificates, a switch, the chain line.
    await field.fill(`CONNECTED(00000003)\ndepth=2 C = DE\n---\nCertificate chain\n${CHAIN}---\nServer certificate\n`);
    await p.getByText('3 certificates', { exact: true }).waitFor();
    const chainLine = await text('[data-chain]');
    await p.getByRole('radio', { name: 'Certificate 2', exact: true }).click();
    const second = await text('[data-subject-display]');
    check(
      `${T}: §2.2 three certificates, "Issued by certificate 2 (names match; signature not checked)", a switch`,
      chainLine === 'Issued by certificate 2 (names match; signature not checked)' &&
        second === 'Example Test Issuing CA 1',
      `${chainLine} / ${second}`,
    );
    await p.getByRole('radio', { name: 'Certificate 1', exact: true }).click();
    await shot('tool-x509-02-chain-light.png');

    // §2.3: Open file — DER, the same reading; the file line under the field.
    const der = join(dir, 'server.der');
    writeFileSync(der, derOf(LEAF));
    await p.locator('input[type="file"]').setInputFiles(der);
    await p.locator('[data-file]').waitFor();
    check(
      `${T}: §2.3 a DER file reads as the PEM did, its name and size under the field`,
      (await text('[data-file]')) === 'server.der — 703 bytes' &&
        (await text('[data-subject-display]')) === 'test.example.com' &&
        (await field.inputValue()) === '',
    );
    await p.getByRole('button', { name: 'Clear', exact: true }).click();

    // §2.4: the CA in November 2025 — expired, with an icon and the word; basic constraints, key usage.
    // The page's clock moves on the next tick of useNow (each second): wait for the line rather than read it at once.
    const status = want => p.locator('[data-validity]').filter({ hasText: want }).waitFor({ timeout: 5_000 });
    await setNow(p, '2025-11-19T00:00:00Z');
    await field.fill(CA);
    await status('Expired 10 months ago');
    await p.locator('[data-validity="expired"] svg').waitFor();
    const ext = oid => text(`[data-extension="${oid}"]`);
    check(
      `${T}: §2.4 the CA: "Expired 10 months ago", CA: yes, path length 0, Certificate signing, CRL signing`,
      (await text('[data-validity]')) === 'Expired 10 months ago' &&
        (await ext('2.5.29.19')).endsWith('CA: yes, path length 0') &&
        (await ext('2.5.29.15')).endsWith('Certificate signing, CRL signing'),
    );
    await shot('tool-x509-03-expired-light.png');

    // The status ticks with the clock (useNow).
    await setNow(p, '2026-11-22T12:00:00Z');
    await field.fill(pem('leaf-p256'));
    const ticks = [];
    for (const [time, want] of [
      ['2026-11-22T12:00:00Z', 'Valid: expires in 9 days'],
      ['2026-11-25T12:00:00Z', 'Valid: expires in 6 days'],
      ['2026-12-02T12:00:00Z', 'Expired 1 day ago'],
    ]) {
      await setNow(p, time);
      ticks.push(
        await status(want).then(
          () => want,
          () => `not ${want}`,
        ),
      );
    }
    check(
      `${T}: the status moves with the clock — "expires in 9 days", 6 days, then "Expired 1 day ago"`,
      ticks.every(t => !t.startsWith('not ')),
      ticks.join(' → '),
    );
    await setNow(p, '2026-11-19T00:00:00Z');

    // §2.5: a private key with a certificate — read, warned, never kept.
    const key = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({ type: 'pkcs8', format: 'pem' });
    const keyBody = key.split('\n')[1];
    await p.getByRole('button', { name: 'Clear', exact: true }).click();
    await sleep(4_000); // what the earlier steps left to the history's checkpoint (3 s of quiet) is written now
    const beforeKey = await historyDump(p);
    await field.fill(key);
    await sleep(4_000);
    const keyAlone = await historyDump(p);
    await field.fill(`${key}\n${LEAF}`);
    const warned = await messages();
    await p.getByRole('button', { name: 'Copy serial number', exact: true }).click();
    let kept = { records: [], blobs: [] };
    for (let i = 0; i < 50 && !kept.records.some(r => r.owner === 'x509' && r.line.includes('test.example.com')); i++) {
      await sleep(200);
      kept = await historyDump(p);
    }
    const everything = [...kept.records.map(r => r.line), ...kept.blobs.map(b => b.text)].join('\n');
    check(
      `${T}: §2.5 a PRIVATE KEY block with the certificate: the certificate read, the warning above`,
      warned.join('|') ===
        'Line 1: A private key block was ignored. This tool never reads private keys; remove it from the field.' &&
        (await text('[data-subject-display]')) === 'test.example.com',
      warned.join('|'),
    );
    check(
      `${T}: a pasted private key leaves nothing in the history: no record for the key alone, none of it beside a certificate`,
      keyAlone.records.length === beforeKey.records.length &&
        keyAlone.blobs.length === beforeKey.blobs.length &&
        kept.records.some(r => r.owner === 'x509') &&
        kept.blobs.some(b => b.text === LEAF) &&
        !everything.includes(keyBody) &&
        !everything.includes('PRIVATE KEY'),
      `${kept.records.length} records, ${kept.blobs.length} blobs`,
    );

    // §2.6, §2.7: a request; broken Base64; a truncated certificate.
    const said = async input => {
      await field.fill(input);
      return (await messages()).join('|');
    };
    const csr = await said('-----BEGIN CERTIFICATE REQUEST-----\nMIIB\n-----END CERTIFICATE REQUEST-----');
    const base64 = await said(LEAF.replace('REUxGzAZ', 'REUx!zAZ'));
    const cut = Buffer.from(derOf(LEAF).subarray(0, 400)).toString('base64');
    const truncated = await said(`-----BEGIN CERTIFICATE-----\n${cut}\n-----END CERTIFICATE-----`);
    check(
      `${T}: §2.6–2.7 a request, broken Base64 and a truncated certificate are said in words, with the place`,
      csr === 'Certificate requests (CSR) are not supported.' &&
        base64 === 'The CERTIFICATE block is not valid Base64. Line 3, column 5: invalid character "!".' &&
        truncated === 'Byte 0: the element is longer than the data left (truncated certificate?).',
      `${csr} / ${base64} / ${truncated}`,
    );
    await shot('tool-x509-04-errors-light.png');

    // Dark: the certificate and the chain.
    await inDarkTheme(ctx, base, p, async () => {
      await field.fill(LEAF);
      await p.getByRole('status', { name: 'SHA-256', exact: true }).filter({ hasText: SHA256 }).waitFor();
      await shot('tool-x509-05-leaf-dark.png');
      await field.fill(CHAIN);
      await p.getByText('3 certificates', { exact: true }).waitFor();
      await shot('tool-x509-06-chain-dark.png');
      await setNow(p, '2026-11-19T00:00:00Z');
      await field.fill(pem('weak-v1'));
      await shot('tool-x509-07-weak-dark.png');
    });
    await clipboard.restore();

    // §7: the start page's field opens this tool for a certificate (the tools before it do not take it), not for a
    // public key. In place (location.replace): no new entries in the page's history.
    const paste = async value => {
      await p.evaluate(url => location.replace(url), `${base}#/start`);
      const f = p.getByRole('combobox', { name: 'Find a tool or search the web' });
      await f.waitFor();
      await f.focus();
      await p.evaluate(v => {
        const data = new DataTransfer();
        data.setData('text/plain', v);
        document.activeElement.dispatchEvent(
          new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
        );
      }, value);
      await p.waitForFunction(() => location.hash !== '#/start', null, { timeout: 3_000 }).catch(() => {});
      await sleep(200);
      return p.evaluate(() => location.hash);
    };
    const opened = await paste(`depth=0\n${LEAF}`);
    const handed = opened === '#/tools/x509' ? await field.inputValue() : '';
    const publicKey = generateKeyPairSync('ec', { namedCurve: 'P-256' }).publicKey.export({
      type: 'spki',
      format: 'pem',
    });
    const notOurs = await paste(publicKey);
    check(
      `${T}: §7 a certificate pasted on the start page opens this tool with it; a public key does not`,
      opened === '#/tools/x509' && handed === `depth=0\n${LEAF}` && notOurs !== '#/tools/x509',
      `${opened} / ${notOurs}`,
    );

    // No network: everything the page loaded came from the extension.
    const outside = requests.filter(u => !u.startsWith('chrome-extension://') && !u.startsWith('data:'));
    check(
      `${T}: nothing is fetched — every request is to the extension itself`,
      outside.length === 0,
      outside.join(', '),
    );
  } finally {
    await p.close();
    rmSync(dir, { recursive: true, force: true });
  }
};
