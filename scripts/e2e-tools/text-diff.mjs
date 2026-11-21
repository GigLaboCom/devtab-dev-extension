// The Text Diff tool in the built extension (docs/tools/specs/text-diff.md): the way to «Compare code» from the tools.
// Its scenarios (§2) the way a person does them — the start page's field and the palette find it by "diff",
// "compare" and "text diff"; the Tools overview and the sidebar list it; opening it, from a list or by a bookmarked
// address, lands on «Compare code» in place of the tool's own address (one entry in the tab's history, Back returns
// to where the person was) — then two texts brought to the comparison show in the editors with the module's counts
// (§10, the last two rows). Light and dark. Run by scripts/e2e-tools.mjs.

/* global document, location, history, addEventListener, removeEventListener -- page.evaluate callbacks run in the page */

import { dropFiles, fixtures, pointOn } from '../e2e-compare.mjs';
import { themeMode, withSettings } from '../e2e-theme.mjs';

export default async ({ ctx, page, base, check, shoot, sleep }) => {
  const hash = () => page.evaluate(() => location.hash);
  const entries = () => page.evaluate(() => history.length);
  const waitHash = (want, timeout = 10_000) =>
    page
      .waitForFunction(w => location.hash === w, want, { timeout })
      .then(
        () => true,
        () => false,
      );
  const counts = page.locator('.kit-compare-counts');
  const compareReady = async () => {
    await page.getByRole('heading', { name: 'Compare code', level: 1 }).waitFor({ timeout: 15_000 });
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.kit-compare-counts');
        return el?.dataset.viewerState === 'ready' && Number(el.dataset.shown) > 0;
      },
      null,
      { timeout: 45_000 },
    );
    await sleep(400);
  };
  const shownCount = async () => Number(await counts.getAttribute('data-shown'));
  const numbers = () =>
    counts.evaluate(el => ({
      changes: Number(el.dataset.changes),
      added: Number(el.dataset.added),
      removed: Number(el.dataset.removed),
    }));
  const sideName = side => page.locator(`[data-side="${side}"] .kit-compare-side-name`).innerText();
  /** The side's text as the editor holds it, asked the way the page asks. */
  const sideText = side =>
    page.evaluate(
      side =>
        new Promise(resolve => {
          const frame = document.querySelector('iframe.kit-compare-frame');
          const id = 8_000_000 + Math.floor(Math.random() * 1000);
          const onMessage = e => {
            if (e.data?.id === id) {
              removeEventListener('message', onMessage);
              resolve(e.data.text ?? e.data.message);
            }
          };
          addEventListener('message', onMessage);
          frame.contentWindow.postMessage({ type: 'viewer/read', id, side }, location.origin);
        }),
      side,
    );
  const currentNav = () =>
    page
      .getByRole('navigation', { name: 'Sections' })
      .locator('[aria-current="page"]')
      .allInnerTexts()
      .then(texts => texts.map(t => t.trim()));

  // ---- §10 row 10, §2: found by search ------------------------------------------------------------------------------
  await page.goto(`${base}#/start`);
  const field = page.getByRole('combobox', { name: 'Find a tool or search the web' });
  await field.waitFor({ timeout: 10_000 });
  const rowsFor = async query => {
    await field.fill(query);
    await sleep(150);
    return (await page.getByRole('option').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  };
  const found = {};
  for (const query of ['diff', 'compare', 'text diff', 'difference', 'side by side', 'merge'])
    found[query] = await rowsFor(query);
  check(
    'Text Diff: the start page’s field finds it by “diff”, “compare”, “text diff” and the specification’s keywords',
    Object.values(found).every(rows => rows.some(r => r.startsWith('Text Diff'))) &&
      found.compare.some(r => r.startsWith('Compare code')),
    JSON.stringify(Object.fromEntries(Object.entries(found).map(([q, rows]) => [q, rows.slice(0, 3)]))),
  );
  await rowsFor('text diff');
  const firstRow = (await page.getByRole('option').first().innerText()).replace(/\s+/g, ' ');
  await shoot(page, 'tool-text-diff-01-search-light.png');
  const fromStart = await entries();
  await field.press('Enter');
  const enterWent = await waitHash('#/compare');
  await compareReady();
  check(
    'Text Diff: Enter on it in the field opens «Compare code» — one entry in the tab’s history',
    firstRow.startsWith('Text Diff') && enterWent && (await entries()) === Math.min(fromStart + 1, 50), // 50: as §2.2 below
    `${firstRow}; ${await hash()}; entries ${fromStart} → ${await entries()}`,
  );
  await page.evaluate(() => history.back());
  check(
    'Text Diff: Back from there returns to the start page, not to the tool',
    await waitHash('#/start'),
    await hash(),
  );

  // The palette (⌘K / Ctrl+K) over another section.
  await page.goto(`${base}#/settings`);
  await page.getByRole('heading', { name: 'Appearance' }).waitFor({ timeout: 10_000 });
  await page.keyboard.press('ControlOrMeta+k');
  const dialog = page.getByRole('dialog', { name: 'Find a tool or section' });
  const palette = dialog.getByRole('combobox', { name: 'Find a tool or section' });
  await palette.waitFor({ timeout: 5_000 });
  await palette.fill('diff');
  await sleep(150);
  const paletteRows = (await dialog.getByRole('option').allInnerTexts()).map(t => t.replace(/\s+/g, ' ').trim());
  await dialog.getByRole('option', { name: /^Text Diff/ }).click();
  const paletteWent = await waitHash('#/compare');
  await compareReady();
  check(
    'Text Diff: the palette finds it by “diff” and opens «Compare code»',
    paletteRows.some(r => r.startsWith('Text Diff')) && paletteWent && (await dialog.count()) === 0,
    `${JSON.stringify(paletteRows.slice(0, 4))}; ${await hash()}`,
  );

  // ---- §2.1, §10 rows 6–8: the Tools overview and the sidebar -------------------------------------------------------
  await page.goto(`${base}#/tools`);
  const overview = page.getByRole('navigation', { name: 'All tools' });
  await overview.waitFor({ timeout: 10_000 });
  const card = overview.getByRole('link', { name: /^Text Diff/ });
  const cardText = (await card.innerText()).replace(/\s+/g, ' ');
  // The sidebar's Tools list (folded unless it holds the current page: read whether shown or not).
  const sidebarTools = await page
    .locator('ul.kit-nav-sub[aria-label="Tools"] a')
    .evaluateAll(links => links.map(a => `${a.textContent.trim()} ${a.getAttribute('href')}`));
  check(
    'Text Diff: `#/tools` is the overview (no going to «Compare code»), Text Diff in it with its summary and in the sidebar',
    (await hash()) === '#/tools' &&
      cardText.includes('Compare two texts side by side. Opens Compare code.') &&
      (await card.getAttribute('href')) === '#/tools/text-diff' &&
      sidebarTools.includes('Text Diff #/tools/text-diff'),
    `${cardText}; sidebar ${JSON.stringify(sidebarTools)}`,
  );
  await card.scrollIntoViewIfNeeded();
  await shoot(page, 'tool-text-diff-02-overview-light.png');
  const fromTools = await entries();
  await card.click();
  const cardWent = await waitHash('#/compare');
  await compareReady();
  const current = await currentNav();
  check(
    'Text Diff: §2.1 its entry opens «Compare code», marked current in the sidebar; one entry in the history',
    cardWent &&
      (await entries()) === Math.min(fromTools + 1, 50) && // Chrome keeps 50 entries: as §2.2 below
      current.includes('Compare code') &&
      !current.includes('Text Diff'),
    `${await hash()}; entries ${fromTools} → ${await entries()}; current ${JSON.stringify(current)}`,
  );
  check(
    'Text Diff: «Compare code» opens as it always does — the example, both sides marked so',
    (await sideName('old')) !== '' &&
      (await page.locator('.kit-compare-side[data-side="old"] .kit-compare-badge').allInnerTexts()).includes('Example'),
    `${await sideName('old')} | ${await sideName('new')}`,
  );
  await shoot(page, 'tool-text-diff-03-compare-light.png');
  await page.evaluate(() => history.back());
  check('Text Diff: Back returns to the Tools overview', await waitHash('#/tools'), await hash());

  const unknownPage = async () => {
    await page.goto(`${base}#/tools/nope`);
    return page.getByRole('status').filter({ hasText: 'There is no tool' }).innerText({ timeout: 5_000 });
  };
  check(
    'Text Diff: §10 row 8 (corrected) — an unknown tool shows the overview and says so',
    /There is no tool/.test(await unknownPage()) && (await hash()) === '#/tools/nope',
    await hash(),
  );

  // ---- §2.2, §10 row 5: a bookmarked address ------------------------------------------------------------------------
  await page.goto(`${base}#/settings`);
  await page.getByRole('heading', { name: 'Appearance' }).waitFor({ timeout: 10_000 });
  const fromSettings = await entries();
  await page.goto(`${base}#/tools/text-diff`);
  const bookmarkWent = await waitHash('#/compare');
  await compareReady();
  check(
    'Text Diff: §2.2 the address `#/tools/text-diff` opens «Compare code» in its place — the history grows by one',
    // Chrome keeps at most 50 entries of a tab's history; late in a long run the tab is already there, and the next
    // check (Back leads to where the person was) is what proves the address was replaced.
    bookmarkWent &&
      (await entries()) === Math.min(fromSettings + 1, 50) &&
      (await page.title()).startsWith('Compare code'),
    `${await hash()}; entries ${fromSettings} → ${await entries()}; title ${await page.title()}`,
  );
  await page.evaluate(() => history.back());
  check(
    'Text Diff: Back from there leads to where the person was before the address, not to the tool',
    await waitHash('#/settings'),
    await hash(),
  );

  // ---- §10 rows 11–12: two texts brought to «Compare code» after arriving through Text Diff ---------------------
  const files = fixtures();
  const pair = async (original, changed, name) => {
    const paths = [files.file(`${name}/original.txt`, original), files.file(`${name}/changed.txt`, changed)];
    const n = await shownCount();
    await dropFiles(page, paths, await pointOn(page, 'old'), sleep);
    await page.waitForFunction(n => Number(document.querySelector('.kit-compare-counts')?.dataset.shown) > n, n, {
      timeout: 20_000,
    });
    await sleep(400);
    return {
      numbers: await numbers(),
      texts: [await sideText('old'), await sideText('new')],
      names: [await sideName('old'), await sideName('new')],
      shown: (await counts.innerText()).replace(/\s+/g, ' '),
    };
  };
  try {
    await page.goto(`${base}#/tools/text-diff`);
    await waitHash('#/compare');
    await compareReady();
    const eol = await pair('a\nb', 'a\nb\n', 'eol');
    check(
      'Text Diff: two texts in «Compare code» — "a\\nb" against "a\\nb\\n": an empty last line added (1 change +1 −0)',
      eol.texts[0] === 'a\nb' &&
        eol.texts[1] === 'a\nb\n' &&
        eol.names.join(' | ') === 'original.txt | changed.txt' &&
        eol.numbers.changes === 1 &&
        eol.numbers.added === 1 &&
        eol.numbers.removed === 0,
      JSON.stringify(eol),
    );
    await shoot(page, 'tool-text-diff-04-two-texts-light.png');
    const crlf = await pair('a\r\nb\r\n', 'a\nb\n', 'crlf');
    check(
      'Text Diff: two texts in «Compare code» — CRLF against LF: both lines changed (1 change +2 −2)',
      crlf.texts[0] === 'a\r\nb\r\n' &&
        crlf.texts[1] === 'a\nb\n' &&
        crlf.numbers.changes === 1 &&
        crlf.numbers.added === 2 &&
        crlf.numbers.removed === 2,
      JSON.stringify(crlf),
    );

    // ---- the dark theme -------------------------------------------------------------------------------------------
    const modeBefore = await withSettings(ctx, base, settings =>
      settings
        .getByRole('radiogroup', { name: 'Theme mode' })
        .locator('[role="radio"][aria-checked="true"]')
        .innerText(),
    );
    await themeMode(ctx, base, 'Dark');
    await page.waitForFunction(() => document.documentElement.dataset.theme?.endsWith('dark'), null, {
      timeout: 5_000,
    });
    await sleep(600);
    await shoot(page, 'tool-text-diff-08-two-texts-dark.png');
    await page.goto(`${base}#/start`);
    await field.waitFor({ timeout: 10_000 });
    await rowsFor('text diff');
    await sleep(300);
    await shoot(page, 'tool-text-diff-05-search-dark.png');
    await page.goto(`${base}#/tools`);
    await overview.waitFor({ timeout: 10_000 });
    await card.scrollIntoViewIfNeeded();
    await sleep(300);
    await shoot(page, 'tool-text-diff-06-overview-dark.png');
    await card.click();
    await waitHash('#/compare');
    await compareReady();
    await shoot(page, 'tool-text-diff-07-compare-dark.png');
    await themeMode(ctx, base, modeBefore.trim());
  } finally {
    files.cleanup();
  }
  await page.goto(`${base}#/tools`);
};
