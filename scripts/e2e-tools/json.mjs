// The JSON tool in the built extension (docs/tools/specs/json.md): an error with its position, then formatting with
// sorted keys (the shadcn Checkbox). Run by scripts/e2e-tools.mjs.

export default async ({ page, base, check }) => {
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
};
