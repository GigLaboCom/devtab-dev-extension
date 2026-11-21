// The JSON tool in the built extension (docs/tools/specs/json.md): an error with its position, then formatting with
// sorted keys (the shadcn Checkbox), the copy, the history record and the page in the dark theme — the last three
// through the shared helpers (scripts/e2e-helpers.mjs), which every tool's module may take. Run by scripts/e2e-tools.mjs.

/* global document -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

export default async ({ ctx, page, base, check, shoot }) => {
  await page.goto(`${base}#/tools/json`);
  const input = page.getByLabel('Input');
  await input.fill('{"name": "gpui", "tags": ["diff", "tools",], "ok": true}');
  const invalid = await page.locator('.validity').first().innerText();
  check('JSON: an error with its position', /Line 1, column 43: trailing comma/.test(invalid), invalid);
  await input.fill('{"name":"example","tags":["diff","tools"],"nested":{"b":2,"a":1},"ok":true}');
  await page.getByLabel('Sort keys').check();
  await page.getByRole('button', { name: 'Format' }).click();
  const formatted = await page.getByLabel('Result').inputValue();
  check(
    'JSON: format with sorted keys',
    formatted.includes('"nested": {\n    "a": 1,\n    "b": 2\n  }') &&
      formatted.indexOf('"ok"') < formatted.indexOf('"tags"'),
  );

  // The shared helpers: the page's clipboard stub, the history record, the dark theme and back, a settled shot.
  const clipboard = await stubClipboard(page);
  await page.getByRole('button', { name: 'Copy', exact: true }).first().click();
  const copied = await clipboard.copied();
  await clipboard.restore();
  const record = await waitForHistoryRecord(page, 'json', r => r.kind === 'result').catch(() => null);
  const mode = await inDarkTheme(ctx, base, page, async () => {
    await settledShot(shoot, page, 'tool-json-01-dark.png');
    return page.evaluate(() => document.documentElement.dataset.mode);
  });
  const after = await page.evaluate(() => document.documentElement.dataset.mode);
  check(
    'JSON: Copy copies the result (the page’s clipboard stub); Format is recorded; the dark theme and back',
    copied.length === 1 && copied[0] === formatted && record?.kind === 'result' && mode === 'dark' && after !== 'dark',
    `copied ${copied.length}; record ${record?.kind}; ${mode} → ${after}`,
  );
};
