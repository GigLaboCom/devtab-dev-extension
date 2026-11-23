// The URL tool in the built extension (docs/tools/specs/url.md): its scenarios (§2) the way a person does them — the
// page's real controls and the test browser's own clipboard (granted to the extension's origin through DevTools; the
// headless browser keeps it to itself, never the system's) — plus what only the real browser can show: Chrome's URL
// parser held to the URL Standard where it differs from Node's (a space in a host, file://localhost, the origin of an
// extension URL), the keyboard path, long values in the parameters table, and an entry of History opening back into
// the tool, and the mode kept as a saved parameter (D21). Run by scripts/e2e-tools.mjs. Screenshots: tool-url-NN-…,
// light and dark.

/* global document, chrome -- page.evaluate callbacks run in the page */

import { forgetSavedParameters } from '../e2e-helpers.mjs';

export default async ({ page, base, check, shoot, sleep }) => {
  // Not `new URL(base).origin`: by the URL Standard (and in Node) a chrome-extension: URL's origin is opaque, "null".
  const origin = /^[a-z-]+:\/\/[^/]+/.exec(base)[0];
  const cdp = await page.context().newCDPSession(page);
  await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });
  const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
  const status = name => page.getByRole('status', { name, exact: true }).innerText();

  try {
    await page.goto(`${base}#/tools/url`);
    const input = page.getByLabel('Input', { exact: true });
    await input.waitFor();
    const result = page.getByLabel('Result', { exact: true });

    // §2.2 — a return address as a Component, copied.
    await input.fill('https://example.com/a?b=1');
    check(
      'URL: Encode as Component (§2.2)',
      (await result.inputValue()) === 'https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
      await result.inputValue(),
    );
    await page.getByRole('button', { name: 'Copy', exact: true }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    check(
      'URL: Copy puts the result on the clipboard',
      (await clipboard()) === 'https%3A%2F%2Fexample.com%2Fa%3Fb%3D1',
    );

    // §2.4 — a typed address as a Whole URL.
    await page.getByLabel('Encode as').click();
    await page.getByRole('option', { name: 'Whole URL' }).click();
    await input.fill('https://example.com/мой файл.pdf');
    check(
      'URL: Encode as Whole URL keeps the colon and the slashes (§2.4)',
      (await result.inputValue()) === 'https://example.com/%D0%BC%D0%BE%D0%B9%20%D1%84%D0%B0%D0%B9%D0%BB.pdf',
      await result.inputValue(),
    );
    await page.mouse.move(0, 0);
    await shoot(page, 'tool-url-01-encode-light.png');

    // §2.3 — a form body decoded with + as a space; §2.7 — Latin-1 bytes.
    await page.getByRole('radio', { name: 'Decode' }).click();
    await input.fill('name=John+Smith%21');
    await page.getByLabel('Decode + as space').click();
    check('URL: Decode with + as a space (§2.3)', (await result.inputValue()) === 'name=John Smith!');
    await input.fill('%E9t%E9 100%');
    await page.getByText('Invalid UTF-8 replaced with U+FFFD.').waitFor();
    check(
      'URL: invalid UTF-8 and a malformed escape are notes under the result (§2.7, §6)',
      (await result.inputValue()) === '�t� 100%' &&
        (await page.getByText('1 malformed % sequence left as is.').count()) === 1,
      await result.inputValue(),
    );
    await shoot(page, 'tool-url-02-decode-notes-light.png');

    // §2.1 — Parse: host, path, four parameters, their JSON.
    await page.getByRole('radio', { name: 'Parse' }).click();
    const url = page.getByLabel('URL', { exact: true });
    await url.fill('https://api.example.com/search?q=%D0%9F%D1%80%D0%B8%D0%B2%D0%B5%D1%82&page=2&tag=a&tag=b');
    const table = page.getByRole('table', { name: 'Query parameters' });
    await table.waitFor();
    const rows = await table
      .locator('tbody tr')
      .evaluateAll(trs => trs.map(tr => [...tr.cells].map(td => td.innerText.trim()).join(' ')));
    check(
      'URL: Parse shows the host, the path and four parameters decoded (§2.1)',
      (await status('Host')) === 'api.example.com' &&
        (await status('Path')) === '/search' &&
        rows.join('|') === '1 q Привет|2 page 2|3 tag a|4 tag b',
      rows.join('|'),
    );
    await page.getByRole('button', { name: 'Copy JSON' }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    check(
      'URL: Copy JSON copies the parameters, a repeated name as an array (§2.1)',
      (await clipboard()) === '{\n  "q": "Привет",\n  "page": "2",\n  "tag": [\n    "a",\n    "b"\n  ]\n}',
      await clipboard(),
    );

    // §2.5 — a connection string; an icon button copies one part and says so for 1.5 s.
    await url.fill('postgres://admin:secret@db.internal:5432/app?sslmode=require');
    await page.getByRole('button', { name: 'Copy Host' }).click();
    await page.getByRole('button', { name: 'Copied', exact: true }).waitFor();
    const copiedHost = await clipboard();
    await page.getByRole('button', { name: 'Copy Host' }).waitFor({ timeout: 3000 });
    check(
      'URL: a connection string in parts; the icon button copies the host and says Copied for a moment (§2.5)',
      [await status('Username'), await status('Password'), await status('Port'), await status('Origin')].join(' ') ===
        'admin secret 5432 null' && copiedHost === 'db.internal',
      copiedHost,
    );

    // §2.6 — no scheme.
    await url.fill('example.com/path');
    await page.getByText('Not an absolute URL: add a scheme such as https://').waitFor();
    check(
      'URL: an address without a scheme is refused, nothing shown (§2.6)',
      (await page.getByLabel('Parts').count()) === 0,
    );

    // Chrome's own URL parser, held to the URL Standard where it differs from Node's (logic.ts, `platformParse`).
    const raw = await page.evaluate(() => {
      const read = s => {
        try {
          const u = new URL(s);
          return `${u.hostname} ${u.origin}`;
        } catch {
          return 'throws';
        }
      };
      return ['https://exa mple.com/', 'file://localhost/etc/hosts', `${document.location.origin}/x`].map(read);
    });
    await url.fill('https://exa mple.com/');
    await page.getByText('Not a valid URL.').waitFor();
    const spaceRefused = (await page.getByLabel('Parts').count()) === 0;
    await url.fill('file://localhost/etc/hosts');
    const fileHost = await status('Host');
    const fileHref = await status('Normalized URL');
    await url.fill(`${origin}/src/app/index.html`);
    const extensionOrigin = await status('Origin');
    check(
      'URL: where Chrome’s URL differs from the URL Standard, the tool gives the standard’s answer',
      spaceRefused && fileHost === 'empty' && fileHref === 'file:///etc/hosts' && extensionOrigin === 'null',
      `Chrome itself: ${raw.join(' | ')}; the tool: ${[spaceRefused, fileHost, fileHref, extensionOrigin].join(' | ')}`,
    );

    // Long values: 1,001 parameters, one of them 3,000 characters; the table wraps, the page does not scroll sideways.
    const long = 'x'.repeat(3000);
    const many = Array.from({ length: 1000 }, (_, i) => `p${i}=${i}`).join('&');
    await url.fill(`https://example.com/a%20b/?token=${long}&empty=&=v&${many}#top`);
    await page.getByText('Showing the first 1,000 of 1,003 parameters. Copy JSON copies all.').waitFor();
    const layout = await table.evaluate(t => {
      const box = t.closest('[data-slot="table-container"]');
      return {
        rows: t.tBodies[0].rows.length,
        sideways: box.scrollWidth - box.clientWidth,
        page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      };
    });
    check(
      'URL: 1,000 rows of 1,003; a 3,000-character value wraps inside the table, nothing scrolls sideways',
      layout.rows === 1000 && layout.sideways <= 0 && layout.page <= 0,
      JSON.stringify(layout),
    );
    await page.evaluate(() => document.documentElement.scrollTo(0, 0));
    await url.fill('https://user:p%40ss@例え.テスト:8080/a/../b/./c%20d?q=1&q=2&x=a+b&empty=&flag#top');
    await page.mouse.move(0, 0);
    await shoot(page, 'tool-url-03-parse-light.png');

    // Keyboard (§8): Tab goes mode → URL → copy buttons; arrows move between the modes.
    await page.getByRole('radio', { name: 'Parse' }).focus();
    await page.keyboard.press('Tab');
    const afterMode = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab');
    const afterUrl = await page.evaluate(() => document.activeElement?.textContent);
    await page.getByRole('radio', { name: 'Parse' }).focus();
    await page.keyboard.press('ArrowLeft');
    await sleep(100); // the roving focus moves on the next frame
    await page.keyboard.press('Space');
    const decodeOn = await page.getByRole('radio', { name: 'Decode' }).getAttribute('aria-checked');
    await page.keyboard.press('ArrowLeft');
    await sleep(100); // the roving focus moves on the next frame
    await page.keyboard.press('Space');
    await page.keyboard.press('Tab');
    const afterEncode = await page.evaluate(() => document.activeElement?.id);
    await page.keyboard.press('Tab');
    const swapNext = await page.evaluate(() => document.activeElement?.textContent);
    await page.keyboard.press('Tab');
    const inputNext = await page.evaluate(() => document.activeElement?.id);
    check(
      'URL: the keyboard reaches mode, option, Swap, input and copy buttons in that order; arrows switch modes',
      afterMode === 'url-input' &&
        afterUrl === 'Copy' &&
        decodeOn === 'true' &&
        afterEncode === 'url-style' &&
        swapNext === 'Swap' &&
        inputNext === 'url-input',
      JSON.stringify({ afterMode, afterUrl, decodeOn, afterEncode, swapNext, inputNext }),
    );

    // Dark: the same pages under the system's dark scheme (the theme preference follows the system by default).
    await page.emulateMedia({ colorScheme: 'dark' });
    await sleep(200);
    const mode = await page.evaluate(() => document.documentElement.dataset.mode);
    await page.mouse.move(0, 0);
    await shoot(page, 'tool-url-04-encode-dark.png');
    await page.getByRole('radio', { name: 'Parse' }).click();
    await page.mouse.move(0, 0);
    await shoot(page, 'tool-url-05-parse-dark.png');
    await page.emulateMedia({ colorScheme: 'light' });
    check('URL: the dark screenshots are dark', mode === 'dark', mode);

    // History: Swap commits the step; the History page opens it back into the tool.
    await page.getByRole('radio', { name: 'Encode' }).click();
    await page.getByLabel('Encode as').click();
    await page.getByRole('option', { name: 'Component' }).click();
    await input.fill('e2e history: a b');
    await page.getByRole('button', { name: 'Swap' }).click();
    await sleep(300);
    await page.goto(`${base}#/history`);
    const entry = page.locator('.kit-history-entry[data-kind="encode"]', { hasText: 'Encode · Component' }).first();
    await entry.waitFor({ timeout: 5000 });
    await entry.getByRole('button', { name: 'Open' }).click();
    await page.locator('[data-restored]').waitFor();
    check(
      'URL: an entry of History opens back into the tool with its text, mode and option',
      (await page.getByLabel('Input', { exact: true }).inputValue()) === 'e2e history: a b' &&
        (await page.getByLabel('Result', { exact: true }).inputValue()) === 'e2e%20history%3A%20a%20b' &&
        (await page.getByRole('radio', { name: 'Encode' }).getAttribute('aria-checked')) === 'true',
      await page.getByLabel('Input', { exact: true }).inputValue(),
    );

    // Saved parameters (D21): the mode the person chose is kept (written 400 ms after the change); the page opened
    // again is in that mode, without the text.
    const stored = () =>
      page.evaluate(async () => (await chrome.storage.local.get('toolSettings')).toolSettings?.params?.url);
    await page.getByRole('radio', { name: 'Parse' }).click();
    for (let i = 0; i < 25 && (await stored())?.values?.mode !== 'parse'; i++) await sleep(200);
    await page.reload();
    await page.getByLabel('URL', { exact: true }).waitFor({ timeout: 15_000 });
    check(
      'URL: Parse chosen, the page opened again — still Parse, the field empty (saved parameter)',
      (await page.getByRole('radio', { name: 'Parse' }).getAttribute('aria-checked')) === 'true' &&
        (await page.getByLabel('URL', { exact: true }).inputValue()) === '',
      JSON.stringify(await stored()),
    );
    // The mode and options it chose are saved parameters: the next module opens URL with its defaults.
    await forgetSavedParameters(page, 'url');
  } finally {
    await page.emulateMedia({ colorScheme: 'light' }).catch(() => {});
    await cdp.detach().catch(() => {});
  }
};
