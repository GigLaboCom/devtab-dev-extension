// The Number Bases tool in the built extension (docs/tools/specs/number-base.md): its scenarios (§2) the way a person
// does them — the page's real controls — run by scripts/e2e-tools.mjs. The clipboard is the page's own stand-in for the
// length of this module (scripts/e2e-helpers.mjs), put back at the end, also when a check throws. Then: a copy is a
// history record, 10,000 digits are converted as they are typed (the time is in the check's detail), a prefixed number
// pasted on the start page opens the tool, and the page in the default dark theme.
// Screenshots: tool-number-base-01 … (light), tool-number-base-0N-dark-… (dark).

/* global document, location, DataTransfer, ClipboardEvent -- page.evaluate callbacks run in the page */

import { inDarkTheme, settledShot, stubClipboard, waitForHistoryRecord } from '../e2e-helpers.mjs';

const T = 'Number Bases';
const LABELS = ['Binary', 'Octal', 'Decimal', 'Hexadecimal'];

export default async ({ ctx, page, base, check, shoot }) => {
  const field = label => page.locator(`input#number-base-${label.toLowerCase()}`);
  const baseField = page.locator('input#number-base-base');
  const radix = page.getByRole('textbox', { name: 'Base', exact: true });
  const frame = page.locator('[data-slot="tool-page"]');
  const values = () => Promise.all([...LABELS.map(l => field(l).inputValue()), baseField.inputValue()]);
  const message = id => page.locator(`#number-base-${id}-message`).innerText();
  const details = () =>
    page.evaluate(() =>
      Object.fromEntries(
        [...document.querySelectorAll('[aria-label="Details"] [data-row]')].map(row => [
          row.getAttribute('data-row'),
          row.querySelector('output')?.textContent ?? '',
        ]),
      ),
    );
  const choose = async (label, option) => {
    await page.getByRole('combobox', { name: label, exact: true }).click();
    await page.getByRole('option', { name: option, exact: true }).click();
  };
  // Chrome keeps at most 50 entries of a tab's history, and the modules after this one count them: go by replacing the
  // current entry, so this module adds one entry at most (the start page's own move to the tool).
  const go = async hash => {
    await page.evaluate(url => location.replace(url), `${base}${hash}`);
    await page.waitForFunction(h => location.hash === h, hash, { timeout: 5000 });
  };
  const tool = async () => {
    await go('#/tools/number-base');
    await field('Decimal').waitFor();
  };

  await tool();
  const clipboard = await stubClipboard(page);
  try {
    check(
      `${T}: the empty page — five fields with their placeholders, no details`,
      JSON.stringify(await Promise.all([...LABELS.map(l => field(l).getAttribute('placeholder'))])) ===
        JSON.stringify(['0b1010', '0o12', '10', '0xa']) &&
        (await baseField.getAttribute('placeholder')) === 'a' &&
        (await radix.inputValue()) === '36' &&
        (await page.locator('[aria-label="Details"]').count()) === 0,
    );
    await settledShot(shoot, frame, 'tool-number-base-01-empty.png');

    // §2.1 — 0xFF in Hexadecimal.
    await field('Hexadecimal').fill('0xFF');
    const first = await values();
    const firstDetails = await details();
    check(
      `${T}: 0xFF in Hexadecimal — 11111111 / 377 / 255 / 73, 8 bits, 1 byte, ff (§2.1)`,
      JSON.stringify(first) === JSON.stringify(['11111111', '377', '255', '0xFF', '73']) &&
        JSON.stringify(firstDetails) ===
          JSON.stringify({ 'bit-length': '8', 'byte-length': '1', 'bytes-be': 'ff', 'bytes-le': 'ff' }),
      `${first.join(' / ')} · ${JSON.stringify(firstDetails)}`,
    );
    await page.getByRole('button', { name: 'Copy binary', exact: true }).click();
    await page.locator('[data-field="binary"] button[aria-label="Copied"]').waitFor({ timeout: 2000 });
    check(`${T}: a field's icon copies its value`, (await clipboard.copied()).at(-1) === '11111111');
    const record = await waitForHistoryRecord(page, 'number-base', r => r.kind === 'convert').catch(() => null);
    check(
      `${T}: the copy is a history record (commit)`,
      record?.label === 'Hexadecimal 0xFF = 255' && record?.payload?.decimal === '255',
      record?.label,
    );
    await settledShot(shoot, frame, 'tool-number-base-02-hex.png');

    // §2.4 — 1,000,000 with commas; Group digits.
    await field('Decimal').fill('1,000,000');
    const plain = await field('Binary').inputValue();
    await page.getByRole('checkbox', { name: 'Group digits', exact: true }).click();
    const grouped = await values();
    check(
      `${T}: 1,000,000 in Decimal, then Group digits (§2.4)`,
      plain === '11110100001001000000' &&
        JSON.stringify(grouped) ===
          JSON.stringify(['1111 0100 0010 0100 0000', '3 641 100', '1,000,000', 'f 4240', 'lfls']),
      grouped.join(' / '),
    );
    await page.getByRole('button', { name: 'Copy binary', exact: true }).click();
    await page.locator('[data-field="binary"] button[aria-label="Copied"]').waitFor({ timeout: 2000 });
    check(`${T}: a grouped field copies its digits without groups`, (await clipboard.copied()).at(-1) === plain);
    await page.getByRole('checkbox', { name: 'Group digits', exact: true }).click();

    // §2.5, §2.6 — errors under the source field, the other fields empty.
    await field('Decimal').fill('12.5');
    const fraction = await message('decimal');
    const afterError = await values();
    await field('Decimal').fill('0xff');
    const hint = await message('decimal');
    check(
      `${T}: 12.5 and 0xff in Decimal — the error under it, the rest empty (§2.5, §2.6)`,
      fraction === 'Column 3: only whole numbers: fractions are not supported' &&
        JSON.stringify(afterError) === JSON.stringify(['', '', '12.5', '', '']) &&
        hint === 'Column 2: "x" is not a base-10 digit; 0x… numbers go in the Hexadecimal field' &&
        (await page.locator('[aria-label="Details"]').count()) === 0,
      `${fraction} | ${hint}`,
    );
    await settledShot(shoot, frame, 'tool-number-base-03-error.png');

    // §2.7 — 30 digits, exactly.
    await field('Decimal').fill('123456789012345678901234567890');
    const exact = await field('Hexadecimal').inputValue();
    check(
      `${T}: 30 digits are exact — hex and bit length (§2.7)`,
      exact === '18ee90ff6c373e0ee4e3f0ad2' && (await details())['bit-length'] === '97',
      exact,
    );

    // §2.2, §2.3 — two's complement, 32 bits.
    await choose('Negative numbers', "Two's complement");
    await field('Decimal').fill('-2147024891');
    const windows = await field('Hexadecimal').inputValue();
    const windowsDetails = await details();
    await field('Hexadecimal').fill('ffffffff');
    const minusOne = await values();
    const minusOneDetails = await details();
    check(
      `${T}: two's complement 32 bits — -2147024891 is 80070005; ffffffff is -1 / 4294967295 (§2.2, §2.3)`,
      windows === '80070005' &&
        windowsDetails.unsigned === '2147942405' &&
        windowsDetails['bytes-le'] === '05 00 07 80' &&
        minusOne[2] === '-1' &&
        minusOne[0] === '1'.repeat(32) &&
        minusOneDetails.signed === '-1' &&
        minusOneDetails.unsigned === '4294967295',
      `${windows} ${JSON.stringify(windowsDetails)} | ${minusOne.join(' / ')}`,
    );
    await choose('Width', '8 bits');
    const overflow = await message('hexadecimal');
    check(
      `${T}: a narrower width re-reads the source — ffffffff does not fit in 8 bits`,
      overflow === 'Column 1: does not fit in 8 bits: the range is -128 to 255',
      overflow,
    );
    await field('Hexadecimal').fill('80');
    await page.getByRole('checkbox', { name: 'Uppercase', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Prefixes', exact: true }).click();
    await settledShot(shoot, frame, 'tool-number-base-04-twos-complement.png');
    const eightBits = await values();
    check(
      `${T}: 80 at 8 bits with Uppercase and Prefixes — 0b10000000 / 0o200 / -128`,
      JSON.stringify(eightBits) === JSON.stringify(['0b10000000', '0o200', '-128', '80', '3K']) &&
        (await details()).unsigned === '128',
      eightBits.join(' / '),
    );
    await page.getByRole('checkbox', { name: 'Uppercase', exact: true }).click();
    await page.getByRole('checkbox', { name: 'Prefixes', exact: true }).click();
    await choose('Negative numbers', 'Minus sign');

    // §4 — N: a new base keeps the number; an invalid one switches the Base field off.
    await baseField.fill('zz');
    await radix.fill('');
    const invalid = await message('radix');
    const disabled = await baseField.isDisabled();
    await radix.fill('16');
    check(
      `${T}: a new N keeps the number; an invalid N says so and switches the Base field off (§4, §6)`,
      invalid === 'Base must be a whole number from 2 to 36' &&
        disabled &&
        (await baseField.inputValue()) === '50f' &&
        (await field('Decimal').inputValue()) === '1295',
      invalid,
    );
    await radix.fill('36');

    // §12 — 10,000 digits recompute as they are typed; 10,001 are refused.
    const timed = async (fill, done) => {
      const started = Date.now();
      await fill();
      await page.waitForFunction(done, null, { timeout: 5000 });
      return Date.now() - started;
    };
    const decimalDigits = `9${'7'.repeat(9_999)}`;
    const decimalMs = await timed(
      () => field('Decimal').fill(decimalDigits),
      () => document.querySelector('#number-base-hexadecimal').value.length > 8000,
    );
    const zMs = await timed(
      () => baseField.fill('z'.repeat(10_000)),
      () => document.querySelector('#number-base-binary').value.length > 50_000,
    );
    await field('Binary').fill('1'.repeat(10_001));
    const tooLong = await message('binary');
    check(
      `${T}: 10,000 digits are converted as typed; 10,001 are too long (§12)`,
      decimalMs < 2000 && zMs < 2000 && tooLong === 'Column 10001: too long: up to 10,000 digits',
      `10,000 decimal digits ${decimalMs} ms, 10,000 base-36 digits ${zMs} ms (fill and render)`,
    );
    await field('Binary').fill('');

    // From the start page: a prefixed number pasted opens the tool in the field of its prefix (§7, D16).
    await go('#/start');
    const start = page.getByRole('combobox', { name: 'Find a tool or search the web' });
    await start.waitFor();
    await start.focus();
    await page.evaluate(text => {
      const data = new DataTransfer();
      data.setData('text/plain', text);
      document.activeElement.dispatchEvent(
        new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
      );
    }, '0b1010_1010');
    await page.waitForFunction(() => location.hash === '#/tools/number-base', null, { timeout: 5000 });
    await field('Binary').waitFor();
    const pasted = await values();
    check(
      `${T}: 0b1010_1010 pasted on the start page opens the tool in Binary`,
      JSON.stringify(pasted) === JSON.stringify(['0b1010_1010', '252', '170', 'aa', '4q']),
      pasted.join(' / '),
    );

    // Dark: the default dark theme, then back.
    await tool();
    await inDarkTheme(ctx, base, page, async () => {
      await field('Hexadecimal').fill('0xFF');
      await settledShot(shoot, frame, 'tool-number-base-05-dark-hex.png');
      await choose('Negative numbers', "Two's complement");
      await field('Decimal').fill('-2147024891');
      await page.getByRole('checkbox', { name: 'Group digits', exact: true }).click();
      await settledShot(shoot, frame, 'tool-number-base-06-dark-twos-complement.png');
      await field('Decimal').fill('1e3');
      await settledShot(shoot, frame, 'tool-number-base-07-dark-error.png');
    });
  } finally {
    await clipboard.restore().catch(() => undefined);
  }
};
