// The UUID / ULID tool in the built extension (docs/tools/specs/uuid.md): its scenarios (§2) the way a person does
// them — the page's real controls — run by scripts/e2e-tools.mjs. The clipboard is the page's own stand-in for the
// length of this module (what was copied is read from it, nothing reaches the machine's clipboard); it is put back at
// the end. Screenshots: tool-uuid-01 … (light), tool-uuid-0N-dark-… (the default dark theme).

/* global document, location, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

const A6 = '017F22E2-79B0-7CC3-98C4-DC0C0C07398F';
const V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const V7 = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export default async ({ page, base, check, shoot, sleep }) => {
  const tool = async () => {
    await page.goto(`${base}#/tools/uuid`);
    await page.getByLabel('Generated identifiers').waitFor();
  };
  const result = () => page.getByLabel('Generated identifiers').inputValue();
  const choose = async (label, option) => {
    await page.getByLabel(label, { exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  const row = name => page.locator(`[aria-label="Inspection"] [data-row="${name}"] dd > span`).first();
  const copied = () => page.evaluate(() => document.documentElement.dataset.e2eCopied ?? '');
  const inspect = page.getByLabel('Paste a UUID or ULID');
  // The tool's whole page (its frame, both cards), however tall: the screenshots of the record.
  const frame = page.locator('[data-slot="tool-page"]');

  await tool();
  await page.evaluate(() => {
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: text => {
        document.documentElement.dataset.e2eCopied = text;
        return Promise.resolve();
      },
    });
  });

  // §2.1: one UUID v4 on opening; Copy.
  const first = await result();
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await page.getByRole('button', { name: 'Copied', exact: true }).waitFor({ timeout: 2000 });
  check('UUID / ULID: opens with one UUID v4, Copy copies it', V4.test(first) && (await copied()) === first, first);
  await shoot(frame, 'tool-uuid-01-opened.png');

  // §2.2: UUID v7 × 5 — ascending.
  await choose('Type', 'UUID v7 (time-ordered)');
  await page.getByLabel('How many').fill('5');
  const v7 = (await result()).split('\n');
  check(
    'UUID / ULID: UUID v7, How many 5 — five v7 in ascending order',
    v7.length === 5 && v7.every(l => V7.test(l)) && v7.every((l, i) => i === 0 || l > v7[i - 1]),
    v7.join(' '),
  );
  await page.getByRole('button', { name: 'Copy all', exact: true }).click();
  await sleep(100);
  check('UUID / ULID: Copy all copies every line', (await copied()) === v7.join('\n'));
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const again = (await result()).split('\n');
  check('UUID / ULID: Generate makes a new batch that sorts after the last', again.length === 5 && again[0] > v7[4]);
  await shoot(frame, 'tool-uuid-02-v7-batch.png');

  // §2.3: name-based — RFC 9562 A.4 and A.2.
  await choose('Type', 'UUID v5 (name, SHA-1)');
  await page.getByLabel('Name', { exact: true }).fill('www.example.com');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Generated identifiers"]')?.value === '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    null,
    { timeout: 3000 },
  );
  check('UUID / ULID: UUID v5, DNS, www.example.com (RFC 9562 A.4)', true);
  await choose('Type', 'UUID v3 (name, MD5)');
  await page.waitForFunction(
    () =>
      document.querySelector('[aria-label="Generated identifiers"]')?.value === '5df41881-3aed-3515-88a7-2f4a814cf09e',
    null,
    { timeout: 3000 },
  );
  check(
    'UUID / ULID: UUID v3 of the same name (RFC 9562 A.2), with the remark that v5 is preferred',
    await page.getByText('UUID v5 is preferred over v3 (RFC 9562 §5.3).').isVisible(),
  );
  await shoot(frame, 'tool-uuid-03-v3.png');

  // §2.4: inspect a v7 from a log.
  await inspect.fill(A6);
  const v7Rows = {
    version: await row('Version').innerText(),
    variant: await row('Variant').innerText(),
    time: await row('Time').innerText(),
    asUlid: await row('As ULID').innerText(),
  };
  check(
    'UUID / ULID: Inspect a v7 — version, variant, time, as ULID',
    v7Rows.version === '7 — Unix time-based' &&
      v7Rows.variant === 'RFC 9562' &&
      v7Rows.time === '2022-02-22T19:22:22Z' &&
      v7Rows.asUlid === '01FWHE4YDGFK1SHH6W1G60EECF',
    JSON.stringify(v7Rows),
  );
  await page.getByRole('button', { name: 'Copy as ULID' }).click();
  await sleep(100);
  check('UUID / ULID: the ULID notation is copied with its icon button', (await copied()) === v7Rows.asUlid);
  await shoot(frame, 'tool-uuid-04-inspect-v7.png');

  // §2.5, §2.6: a ULID and a v1.
  await inspect.fill('01ARZ3NDEKTSV4RRFFQ69G5FAV');
  const ulid = { time: await row('Time').innerText(), asUuid: await row('As UUID').innerText() };
  check(
    'UUID / ULID: Inspect a ULID — time and UUID notation',
    ulid.time === '2016-07-30T23:54:10.259Z' && ulid.asUuid === '01563e3a-b5d3-d676-4c61-efb99302bd5b',
    JSON.stringify(ulid),
  );
  await inspect.fill('C232AB00-9414-11EC-B3C8-9F6BDECED846');
  const v1 = { clock: await row('Clock sequence').innerText(), node: await row('Node').innerText() };
  check(
    'UUID / ULID: Inspect a v1 — clock sequence and node',
    v1.clock === '13256 (0x33c8)' && v1.node === '9f:6b:de:ce:d8:46',
    JSON.stringify(v1),
  );

  // §2.8: a typo — the error next to the field.
  await inspect.fill('017F22E2-79B0-7CC3-98C4-DC0C0C07398');
  const error = await page.locator('#uuid-inspect-error').innerText();
  check(
    'UUID / ULID: a 35-character typo says what is wrong',
    error === 'Not a UUID or ULID: 35 characters; a UUID has 36 with hyphens or 32 without, a ULID has 26.',
    error,
  );
  await shoot(frame, 'tool-uuid-05-inspect-error.png');

  // History: Generate is recorded; the tool's Recent entries opens it back.
  await choose('Type', 'UUID v4 (random)');
  await page.getByLabel('How many').fill('3');
  await page.getByRole('button', { name: 'Generate', exact: true }).click();
  const generated = await result();
  await inspect.fill('');
  await sleep(300); // the commit is written to IndexedDB
  await page.reload();
  await page.getByLabel('Generated identifiers').waitFor();
  await page.locator('.kit-tool-history-recent summary').click();
  const recent = page.locator('.kit-tool-history-recent .kit-history-entry', { hasText: 'UUID v4 · 3 identifiers' });
  await recent.first().waitFor({ timeout: 3000 });
  await recent.first().getByRole('button', { name: 'Open' }).click();
  await page.locator('[data-restored]').waitFor({ timeout: 3000 });
  check(
    'UUID / ULID: a Generate is kept in History and opens back into the tool',
    (await result()) === generated,
    generated.replaceAll('\n', ' '),
  );

  // From the start page: pasting a UUID opens the tool with Inspect filled (§8, D16).
  await page.goto(`${base}#/start`);
  const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.waitFor();
  await field.focus();
  await page.evaluate(text => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.activeElement.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, A6);
  await page.waitForFunction(() => location.hash === '#/tools/uuid', null, { timeout: 5000 });
  await inspect.waitFor();
  check(
    'UUID / ULID: a UUID pasted on the start page opens the tool with Inspect filled',
    (await inspect.inputValue()) === A6 && (await row('Version').innerText()) === '7 — Unix time-based',
  );

  // Dark: the default dark theme, then back to the system's.
  await page.goto(`${base}#/settings`);
  await page.getByRole('radio', { name: 'Dark' }).first().click();
  await page.locator('html[data-mode="dark"]').waitFor();
  await tool();
  await shoot(frame, 'tool-uuid-06-dark-opened.png');
  await inspect.fill(A6);
  await shoot(frame, 'tool-uuid-07-dark-inspect-v7.png');
  await choose('Type', 'UUID v5 (name, SHA-1)');
  await page.getByLabel('Name', { exact: true }).fill('www.example.com');
  await sleep(200);
  await shoot(frame, 'tool-uuid-08-dark-v5.png');
  await page.goto(`${base}#/settings`);
  await page.getByRole('radio', { name: 'System' }).first().click();
  await page.locator('html[data-mode="light"]').waitFor();

  await page.evaluate(() => {
    delete navigator.clipboard.writeText;
    delete document.documentElement.dataset.e2eCopied;
  });
};
