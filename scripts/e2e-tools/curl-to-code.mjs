// The cURL to Code tool in the built extension (docs/tools/specs/curl-to-code.md): where the host lists it, its
// scenarios (§2) with the page's real controls, the errors next to the command (§6), the large-input steps (§12, with
// timings), detection from the start page's field (§7), that no request leaves the extension while commands with
// real-looking addresses are pasted and converted, and its secret history kind (D17) end to end:
//   - without a master password nothing of a command is written;
//   - with a throwaway master password made here, Copy writes one encrypted entry (nothing of the command, its host, its
//     credentials or the code in clear in IndexedDB — records and blobs);
//   - locked, the entry does not open and Copy writes nothing;
//   - unlocked, History's "Open" brings the command and the language back;
//   - the master password is turned off again (its encrypted entries go with it), so later steps start as before.
// Copy is checked against a stand-in for navigator.clipboard.writeText in the page (the system clipboard is not touched),
// restored before the module ends. The master password is never written to the report or the console. Run by
// scripts/e2e-tools.mjs; alone: pnpm test:e2e -- --only=curl-to-code.

/* global document, indexedDB, location, DataTransfer, ClipboardEvent, requestAnimationFrame, KeyboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard } from '../e2e-helpers.mjs';

const T = 'cURL to Code';
const ID = 'curl-to-code';

const BASH = `curl 'https://api.github.com/user/repos?per_page=5' \\
  -H 'accept: application/vnd.github+json' \\
  -H 'authorization: Bearer e2e-not-a-token-0000' \\
  -b 'logged_in=yes; tz=Europe' \\
  --data-raw $'{"name":"demo","note":"it\\'s"}'`; // gitleaks:allow

/** Every row of the history database (owner, kind, key id, line) and every blob's bytes as text, read without creating it. */
const historyDump = page =>
  page.evaluate(async () => {
    const db = await new Promise(res => {
      const r = indexedDB.open('tool-history');
      r.onupgradeneeded = () => r.transaction.abort();
      r.onsuccess = () => res(r.result);
      r.onerror = () => res(null);
    });
    if (!db) return { rows: [], blobs: '' };
    const all = store =>
      new Promise((res, rej) => {
        const r = db.transaction(store).objectStore(store).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    const rows = (await all('records')).map(row => ({
      owner: row.owner,
      kind: row.kind,
      kid: row.kid ?? null,
      line: row.line,
    }));
    let blobs = '';
    for (const b of await all('blobs')) {
      const data = b.data instanceof Blob ? new Uint8Array(await b.data.arrayBuffer()) : new Uint8Array(b.data ?? []);
      blobs += new TextDecoder('latin1').decode(data);
    }
    db.close();
    return { rows, blobs };
  });

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

  // Every request of the browser context that is not a file of the extension itself.
  const origin = new URL(base).origin;
  const outside = [];
  const onRequest = request => {
    if (!request.url().startsWith(origin) && !request.url().startsWith('devtools:')) outside.push(request.url());
  };
  ctx.on('request', onRequest);

  const command = p => p.locator('#curl-to-code-input');
  const code = p => p.locator('#curl-to-code-output');
  const state = p => p.locator('[data-part="status"]');
  const warnings = p => p.locator('[data-part="warning"]').allInnerTexts();
  const note = p => p.locator('[data-part="credentials"]');
  const hint = p => p.locator('[data-hint]');
  const copyButton = p => p.getByRole('button', { name: /^Cop(y|ied)$/ });
  const chooseTarget = async (p, name) => {
    await p.locator('#curl-to-code-target').click();
    await p.getByRole('option', { name, exact: true }).click();
    await p.waitForFunction(n => document.querySelector('#curl-to-code-target')?.textContent === n, name);
  };
  /** Sets the command and waits for code that only this command produces. */
  const enter = async (p, text, expect) => {
    await command(p).fill(text);
    await p.waitForFunction(
      want => (document.querySelector('#curl-to-code-output')?.value ?? '').includes(want),
      expect,
      { timeout: 5_000 },
    );
  };

  // Where the host lists the tool, with no list edited.
  await page.goto(`${base}#/tools/${ID}`);
  await command(page).waitFor();
  check(
    `${T}: listed in Tools, its page titled and summarised by its definition`,
    (await page
      .getByRole('navigation', { name: 'Sections' })
      .getByRole('list', { name: 'Tools' })
      .getByRole('link', { name: T, exact: true })
      .count()) === 1 &&
      (await page.getByRole('heading', { name: T, exact: true }).count()) === 1 &&
      (await page.locator('.kit-tool-page-summary').innerText()) ===
        'Turn a curl command into fetch, Python, Go or Rust code.',
  );
  check(
    `${T}: empty — the placeholder of §8, JavaScript (fetch), Copy off, nothing under the panes`,
    (await command(page).getAttribute('placeholder')) ===
      "curl https://example.com/users -H 'Accept: application/json'" &&
      (await command(page).getAttribute('spellcheck')) === 'false' &&
      (await command(page).getAttribute('autocomplete')) === 'off' &&
      (await code(page).getAttribute('readonly')) !== null &&
      (await page.locator('#curl-to-code-target').innerText()) === 'JavaScript (fetch)' &&
      (await copyButton(page).isDisabled()) &&
      (await page.locator('[data-part="warning"]').count()) === 0,
  );
  const start = await open('#/start');
  const field = start.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.fill('reqwest');
  const firstRow = await start.getByRole('option').first().innerText();
  check(`${T}: the start page's field finds it by a keyword`, firstRow.includes(T), firstRow.split('\n')[0]);
  const settings = await open('#/settings');
  const group = settings.locator('[data-settings="history"]');
  await group.waitFor();
  const groupText = await group.innerText();
  check(
    `${T}: Settings → History says what it keeps and never keeps`,
    groupText.includes(
      'Commands you converted, with the language and the code — only encrypted, with a master password.',
    ) && groupText.includes('Commands without an unlocked master password, and never in clear.'),
  );
  const shortcut = settings.locator(`[data-shortcut="open:tools/${ID}"] input`);
  check(
    `${T}: Settings → Shortcuts lists it, with no default shortcut`,
    (await shortcut.count()) === 1 && (await shortcut.inputValue()) === '',
  );

  await page.bringToFront();
  const clipboard = await stubClipboard(page);
  try {
    // §2.1 "Copy as cURL (bash)".
    await enter(page, BASH, "const response = await fetch('https://api.github.com/user/repos?per_page=5', {");
    const js = await code(page).inputValue();
    check(
      `${T}: §2.1 bash — fetch with method, headers and body; the Cookie warning; the credentials note last`,
      js.includes("  method: 'POST',") &&
        js.includes("    'Cookie': 'logged_in=yes; tz=Europe',") &&
        js.includes(`  body: '{"name":"demo","note":"it\\'s"}'`) &&
        JSON.stringify(await warnings(page)) ===
          JSON.stringify(['A browser does not let fetch set the Cookie header (Node does).']) &&
        (await note(page).innerText()) === 'The code contains credentials from the command. Do not share it as is.',
      (await warnings(page)).join(' | '),
    );
    check(
      `${T}: the line under the panes says nothing is sent and commands are not kept without a master password`,
      (await hint(page).innerText()) ===
        'Nothing is sent: the command is read in this tab and the code is never run. Commands are not kept (no master password).' &&
        /nothing is kept without a master password\./.test(await page.locator('.kit-tool-history-line').innerText()),
      await page.locator('.kit-tool-history-line').innerText(),
    );
    await settledShot(shoot, page, `tool-${ID}-01-fetch.png`);

    // Copy: the code as shown.
    await copyButton(page).click();
    await page.getByRole('button', { name: 'Copied' }).waitFor();
    const copied = await clipboard.copied();
    check(`${T}: Copy copies the code, with its final line break`, copied.at(-1) === js && js.endsWith('});\n'));

    // §2.2 Python, Go, Rust.
    await chooseTarget(page, 'Python (requests)');
    const py = await code(page).inputValue();
    check(
      `${T}: §2.2 Python — import requests, headers, data with .encode() for non-ASCII or as is, requests.post`,
      py.startsWith('import requests\n\nheaders = {\n') && py.includes('response = requests.post(\n'),
    );
    await settledShot(shoot, page, `tool-${ID}-02-python.png`);
    await chooseTarget(page, 'Go (net/http)');
    check(`${T}: Go — a whole program`, (await code(page).inputValue()).startsWith('package main\n\nimport (\n'));
    await chooseTarget(page, 'Rust (reqwest)');
    check(
      `${T}: Rust — reqwest, blocking`,
      (await code(page).inputValue()).startsWith(
        '// Cargo.toml: reqwest = { version = "0.12", features = ["blocking"] }',
      ),
    );
    await settledShot(shoot, page, `tool-${ID}-03-rust.png`);

    // §2.3 -u in Go.
    await chooseTarget(page, 'Go (net/http)');
    await enter(page, "curl -u 'ann:pa:ss' https://api.example.com/me", 'req.SetBasicAuth("ann", "pa:ss")');
    check(`${T}: §2.3 -u — SetBasicAuth with the password split as curl splits it`, true);

    // §2.4 cmd form: the same code as bash.
    await chooseTarget(page, 'JavaScript (fetch)');
    await enter(page, "curl 'https://api.example.com/api?q=1&x=2' -H 'accept: application/json'", "q=1&x=2'");
    const fromBash = await code(page).inputValue();
    await command(page).fill('curl ^"https://api.example.com/api?q=1^&x=2^" ^\n  -H ^"accept: application/json^"');
    await sleep(100);
    check(
      `${T}: §2.4 "Copy as cURL (cmd)" — the same code as its bash form`,
      (await code(page).inputValue()) === fromBash,
    );

    // §2.5, §2.6: variables, a pipe.
    await enter(page, 'curl "https://api.example.com/users/$ID" -H "Authorization: Bearer $TOKEN"', "'Bearer $TOKEN'");
    check(
      `${T}: §2.5 shell variables stay as written, with the warning`,
      (await warnings(page)).includes('Shell variables and $(…) are not expanded; they stay in the code as written.'),
    );
    await enter(page, 'curl -s https://api.example.com/feed | jq .', "fetch('https://api.example.com/feed')");
    check(
      `${T}: §2.6 a pipe — only curl, the warning`,
      (await warnings(page)).includes('Only the curl command is translated; "| jq ." after it is ignored.'),
    );

    // §2.7 and §6: errors under the command, the error puts the caret on its place.
    await command(page).fill('wget https://api.example.com/');
    const error = page.getByRole('button', { name: 'Line 1, column 1: the command must start with curl' });
    await error.waitFor({ timeout: 3_000 });
    check(
      `${T}: §2.7 wget — the error under the command (role status), no code, Copy off`,
      (await state(page).getAttribute('role')) === 'status' &&
        (await code(page).inputValue()) === '' &&
        (await copyButton(page).isDisabled()),
    );
    await settledShot(shoot, page, `tool-${ID}-04-error.png`);
    await command(page).fill("curl -H 'X: 1' 'https://api");
    await page.getByRole('button', { name: 'Line 1, column 16: unterminated single quote' }).click();
    check(
      `${T}: §6 unterminated quote — the error link puts the caret on the quote`,
      await page.evaluate(
        () => document.activeElement?.id === 'curl-to-code-input' && document.activeElement.selectionStart === 15,
      ),
    );

    // Real-looking addresses, every client: nothing leaves the extension.
    const before = outside.length;
    for (const cmd of [
      'curl https://api.github.com/user -H "Authorization: token e2e-not-a-token"', // gitleaks:allow
      'curl -X POST https://example.org/login -d user=a -d pass=b',
      'curl http://169.254.169.254/latest/meta-data/ -m 1',
      'curl -k https://localhost:8443/health -F file=@/etc/hosts',
      'curl ^"https://www.google.com/search?q=curl^" ^\n  -H ^"accept: */*^"',
    ]) {
      for (const target of ['Python (requests)', 'Go (net/http)', 'Rust (reqwest)', 'JavaScript (fetch)']) {
        await chooseTarget(page, target);
        await command(page).fill(cmd);
        await sleep(50);
      }
    }
    await sleep(500);
    check(
      `${T}: no request leaves the extension while 5 commands with real addresses are converted to 4 clients`,
      outside.length === before,
      outside.slice(before).join(', '),
    );

    // §12: large commands — Convert in the worker, its time and the field's.
    const big = n => `curl --data-raw '${'x'.repeat(n)}' https://api.example.com/big`;
    const live = await page.evaluate(
      async text => {
        const el = document.querySelector('#curl-to-code-input');
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        const t0 = performance.now();
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        return Math.round(performance.now() - t0);
      },
      big(1000 * 1000),
    );
    await page.waitForFunction(() => (document.querySelector('#curl-to-code-output')?.value ?? '').length > 1_000_000);
    report.curlToCode = { liveOneMegabyteMs: live };
    await command(page).fill(big(2 * 1024 * 1024));
    await page.getByText('Large command: press Convert (Ctrl+Enter).', { exact: true }).waitFor();
    const convert = page.getByRole('button', { name: 'Convert', exact: true });
    const t0 = Date.now();
    await convert.click();
    await page.waitForFunction(
      () => (document.querySelector('#curl-to-code-output')?.value ?? '').length > 2_000_000,
      null,
      {
        timeout: 15_000,
      },
    );
    const convertMs = Date.now() - t0;
    // A body in $'…' (the slowest form) of 15 MiB, by Ctrl+Enter, timed in the page with the main thread's longest task.
    const slow = await page.evaluate(
      async n => {
        const el = document.querySelector('#curl-to-code-input');
        const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set;
        const text = `curl --data-raw $'${'x\\n'.repeat(n)}' https://api.example.com/big`;
        const t0 = performance.now();
        setter.call(el, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
        const field = performance.now() - t0;
        let longest = 0;
        const observer = new PerformanceObserver(list => {
          for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
        });
        observer.observe({ entryTypes: ['longtask'] });
        const t1 = performance.now();
        el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', ctrlKey: true, bubbles: true }));
        await new Promise(resolve => {
          const tick = () =>
            (document.querySelector('#curl-to-code-output')?.value ?? '').length > n ? resolve() : setTimeout(tick, 20);
          tick();
        });
        const work = performance.now() - t1;
        observer.disconnect();
        return {
          chars: text.length,
          fieldMs: Math.round(field),
          convertMs: Math.round(work),
          longestTaskMs: Math.round(longest),
        };
      },
      Math.floor((15 * 1024 * 1024) / 3),
    );
    report.curlToCode = { ...report.curlToCode, convertTwoMiBMs: convertMs, fifteenMiBAnsiC: slow };
    check(
      `${T}: §12 above 1 MiB — Convert works in the worker; 15 MiB in $'…' by Ctrl+Enter`,
      slow.chars > 15_000_000,
      `live 1 MB ${live} ms; Convert 2 MiB ${convertMs} ms; 15 MiB $'…': field ${slow.fieldMs} ms, convert ${slow.convertMs} ms, longest main-thread task during it ${slow.longestTaskMs} ms`,
    );
    await command(page).fill(`curl -d '${'x'.repeat(16 * 1024 * 1024 + 1)}' https://a.example/`);
    await page.getByText('Command is larger than 16 MB.', { exact: true }).waitFor();
    check(`${T}: §12 above 16 MiB — refused`, true);
    await command(page).fill('');

    // Dark.
    await inDarkTheme(ctx, base, page, async () => {
      await command(page).fill('');
      await chooseTarget(page, 'JavaScript (fetch)');
      await enter(page, BASH, "  method: 'POST',");
      await settledShot(shoot, page, `tool-${ID}-05-fetch-dark.png`);
      await command(page).fill('wget https://api.example.com/');
      await page.getByRole('button', { name: 'Line 1, column 1: the command must start with curl' }).waitFor();
      await settledShot(shoot, page, `tool-${ID}-06-error-dark.png`);
    });
    await command(page).fill('');

    // §7: pasted on the start page.
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
    const ours = {};
    for (const text of [
      'curl https://api.example.com/users',
      '$ curl -X POST api.example.com/x -d a=1',
      'curl ^"https://x.example/^" ^',
      "curl 'https://api.example.com/api' \\\n  -H 'accept: application/json' \\\n  -b 'sid=abc'",
      'curl -s https://api.example.com/users | jq .',
    ]) {
      ours[text] = await paste(text);
      if (ours[text] === `#/tools/${ID}`) {
        await command(page).waitFor();
        if ((await command(page).inputValue()) !== text) ours[text] += ' (field differs)';
      }
    }
    check(
      `${T}: §7 commands pasted on the start page open this tool with the command`,
      Object.values(ours).every(h => h === `#/tools/${ID}`),
      JSON.stringify(ours),
    );
    const others = {};
    for (const text of [
      'curl up with a book',
      'curling.example.com',
      '{"curl": "-X"}',
      'https://api.example.com/?a=1',
      'wget https://x.example/',
    ])
      others[text] = await paste(text);
    check(
      `${T}: §7 prose, a host name, JSON, a URL and wget do not open it (the URL opens URL)`,
      Object.values(others).every(h => h !== `#/tools/${ID}`) &&
        others['https://api.example.com/?a=1'] === '#/tools/url',
      JSON.stringify(others),
    );
    // A command whose body looks like code is still a command: the formatter, earlier in the registry, leaves it.
    const json = await paste(`curl --json '{"a":1}' https://api.example.com/x`);
    report.curlToCode = { ...report.curlToCode, jsonBodyPasteOpens: json };
    check(
      `${T}: §7 a command with a JSON body pasted on the start page opens this tool`,
      json === `#/tools/${ID}`,
      json,
    );

    // D17. No master password: nothing is written.
    await page.goto(`${base}#/tools/${ID}`);
    await command(page).waitFor();
    await stubClipboard(page);
    await enter(page, BASH, "  method: 'POST',");
    await copyButton(page).click();
    await sleep(600);
    const mine = async () => (await historyDump(page)).rows.filter(r => r.owner === ID);
    check(`${T}: without a master password a command is not written at all`, (await mine()).length === 0);

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
        ?.textContent?.endsWith('Commands and code are kept encrypted in this browser.'),
    );
    check(`${T}: unlocked, the page says commands and code are kept encrypted`, true);
    await chooseTarget(page, 'Python (requests)');
    await copyButton(page).click();
    let rows = [];
    for (let i = 0; i < 50 && rows.length === 0; i++) {
      await sleep(100);
      rows = await mine();
    }
    const dump = await historyDump(page);
    const record = rows[0] ? JSON.parse(rows[0].line) : {};
    const secrets = ['api.github.com', 'e2e-not-a-token-0000', 'logged_in=yes', 'per_page', 'requests.post', 'demo'];
    const inClear = secrets.filter(s => dump.rows.some(r => r.line.includes(s)) || dump.blobs.includes(s));
    check(
      `${T}: unlocked, Copy writes one encrypted entry — nothing of the command, its credentials or the code in clear (records and blobs)`,
      rows.length === 1 &&
        rows[0].kind === 'converted' &&
        !!rows[0].kid &&
        typeof record.sealed === 'object' &&
        record.payload === undefined &&
        record.label === undefined &&
        inClear.length === 0,
      rows.length === 1 ? `in clear: ${inClear.join(', ') || 'nothing'}` : `${rows.length} entries`,
    );

    // Locked: the entry stays shut, nothing new is written.
    const history = await open('#/history');
    await history.locator('[data-page="history"]').waitFor();
    await history.getByRole('button', { name: 'Lock now' }).click();
    await history.locator('.kit-history-lock[data-vault="locked"]').waitFor();
    const entry = history.locator('.kit-history-entry[data-kind="converted"]');
    await entry.waitFor();
    check(`${T}: History lists it as an encrypted entry`, /Encrypted entry/.test(await entry.innerText()));
    await entry.getByRole('button', { name: 'Open' }).click();
    await history.locator('[data-restored]').waitFor();
    const lockedText = await history.locator('[data-restored]').innerText();
    check(
      `${T}: locked, opening the entry says it is encrypted and brings no command back`,
      lockedText === 'This entry is encrypted: unlock the history to open it.' &&
        (await command(history).inputValue()) === '',
      lockedText,
    );
    const historyClipboard = await stubClipboard(history);
    await command(history).fill('curl https://api.example.com/locked');
    await history.waitForFunction(() =>
      document
        .querySelector('[data-hint]')
        ?.textContent?.endsWith('Commands are not kept while the history is locked.'),
    );
    await copyButton(history).click();
    await sleep(600);
    check(`${T}: locked, Copy writes nothing`, (await mine()).length === 1);
    await historyClipboard.restore();

    // Unlocked again: Open brings the command and the language back.
    await settings.bringToFront();
    await group.getByLabel('Master password', { exact: true }).fill(master);
    await group.getByRole('button', { name: 'Unlock' }).click();
    await group.getByText('Unlocked.', { exact: true }).waitFor();
    await history.bringToFront();
    await history.goto(`${base}#/history`);
    await history.locator('.kit-history-entry[data-kind="converted"]').getByRole('button', { name: 'Open' }).click();
    await history.locator('[data-restored]').waitFor();
    const restoredText = await history.locator('[data-restored]').innerText();
    check(
      `${T}: unlocked, History's Open brings the command and the language back`,
      (await command(history).inputValue()) === BASH &&
        (await history.locator('#curl-to-code-target').innerText()) === 'Python (requests)' &&
        (await code(history).inputValue()).startsWith('import requests') &&
        restoredText === 'Opened from History: api.github.com → Python (requests).',
      restoredText,
    );

    // The master password off again: its encrypted entries go.
    await settings.bringToFront();
    await group.getByRole('button', { name: 'Turn off…' }).click();
    await group.getByRole('button', { name: 'Delete the encrypted history' }).click();
    await group.getByText(/^The master password is off/).waitFor();
    await page.bringToFront();
    await page.reload();
    await command(page).waitFor();
    check(`${T}: with the master password off again, its entries are gone`, (await mine()).length === 0);
  } finally {
    await clipboard.restore().catch(() => {});
    ctx.off('request', onRequest);
    for (const p of opened) await p.close();
  }
};
