// «Projects» on its demo data in the built extension (the companion's specification §12, stage 1, row 1.5): the list of
// projects grouped by trusted folder, a project's tree, a file in the editor module (`show_file`), its diff with HEAD
// (`show_diff` with the demo's hunks) and back to the file (`set_mode`), an edit that saves itself (the save state goes
// through «Edited» to «Saved»), the Commit window (check, message, Commit, the hooks' output, the files leave the
// changes) and the undo of that commit, find in files, the file's history compared with the current file and two of
// its points compared — and not one console error or page error. The demo needs no permission and no companion; the
// manifest is the store build's. Screenshots in light and dark go where --shots says. Run by scripts/e2e-check.mjs.

/* global document, location, MutationObserver -- page.evaluate callbacks run in the pages */

import { themeMode } from './e2e-theme.mjs';

export const runProjectsDemoChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const errors = [];
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  const result = (report.projectsDemo = {});
  const frame = page.locator('iframe.kit-projects-frame');
  const shownCount = () => frame.evaluate(el => Number(el.dataset.shown ?? 0));
  /** Waits until the editor has answered once more than `n` times, in the mode wanted. */
  const editorShows = (n, mode) =>
    page.waitForFunction(
      ([n, mode]) => {
        const el = document.querySelector('iframe.kit-projects-frame');
        return el && Number(el.dataset.shown ?? 0) > n && (!mode || el.dataset.mode === mode);
      },
      [n, mode],
      { timeout: 45_000 },
    );

  // ---- the list ---------------------------------------------------------------------------------------------------
  await page.goto(`${base}#/projects`);
  await page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor({ timeout: 15_000 });
  const groups = await page.locator('.kit-projects-group-title').allInnerTexts();
  result.groups = groups;
  check(
    'projects: the list groups the demo projects by trusted folder, the ones outside last',
    groups.length === 3 &&
      groups[0].startsWith('Work') &&
      groups[1].startsWith('Self') &&
      groups[2] === 'Outside trusted folders',
    groups.join(' | '),
  );
  const note = await page.getByRole('note').innerText();
  check('projects: the demo says it is an example', note.includes('invented projects'), note.slice(0, 80));
  await shoot(page, 'projects-list-light.png');

  // ---- a project, its tree, a file ------------------------------------------------------------------------------
  await page.getByRole('link', { name: /ledger-api/ }).click();
  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.locator('[data-path="src"]').waitFor({ timeout: 10_000 });
  const ignored = await tree.locator('[data-path="node_modules"]').getAttribute('data-ignored');
  check('projects: ignored folders are in the tree, dimmed', ignored === '');
  await tree.locator('[data-path="src"]').click();
  await tree.locator('[data-path="src/server.ts"]').click();
  await page.waitForFunction(() => location.hash === '#/projects/p_demo0ledgr/src%2Fserver.ts');
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0, 'file');
  check('projects: a file opens alone in the editor (show_file)', true, await frame.getAttribute('data-mode'));
  await shoot(page, 'projects-file-light.png');

  // ---- its diff with HEAD, and back -----------------------------------------------------------------------------
  let n = await shownCount();
  await page.getByRole('radio', { name: 'Diff', exact: true }).click();
  await editorShows(n, 'diff');
  const changes = Number(await frame.getAttribute('data-changes'));
  check('projects: its diff with HEAD shows the demo’s hunks (show_diff)', changes === 3, `${changes} changes`);
  await sleep(500);
  await shoot(page, 'projects-diff-light.png');
  n = await shownCount();
  await page.getByRole('radio', { name: 'File', exact: true }).click();
  await editorShows(n, 'file');
  check('projects: back to the file without a new text (set_mode)', true);

  // ---- an edit that saves itself ----------------------------------------------------------------------------------
  await page.evaluate(() => {
    globalThis.__saves = [];
    const target = document.querySelector('.kit-projects-editor-bar');
    new MutationObserver(() => {
      const state = document.querySelector('.kit-projects-save')?.getAttribute('data-state');
      if (state && globalThis.__saves.at(-1) !== state) globalThis.__saves.push(state);
    }).observe(target, { subtree: true, attributes: true, childList: true, characterData: true });
  });
  const box = await frame.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 40);
  for (const key of ['End', 'Enter', 'Slash', 'Slash', 'Space', 'e', '2', 'e']) await page.keyboard.press(key);
  await page.waitForFunction(() => globalThis.__saves.includes('pending'), null, { timeout: 10_000 });
  await page.waitForFunction(() => globalThis.__saves.at(-1) === 'saved', null, { timeout: 10_000 });
  const saves = await page.evaluate(() => globalThis.__saves);
  result.saves = saves;
  check('projects: an edit saves itself (Edited → Saved)', saves.at(-1) === 'saved', saves.join(' → '));

  // ---- commit what is checked, and undo it -----------------------------------------------------------------------
  const commit = page.getByRole('region', { name: 'Commit' });
  await commit.getByRole('checkbox', { name: 'README.md' }).waitFor({ timeout: 10_000 });
  await commit.getByPlaceholder('Commit message').fill('Route invoices');
  await shoot(page, 'projects-commit-light.png');
  await commit.getByRole('button', { name: 'Commit', exact: true }).click();
  const committed = commit.getByText(/^Committed \d+ files as [0-9a-f]{7}\.$/);
  await committed.waitFor({ timeout: 15_000 });
  const output = await commit.locator('.kit-projects-output').innerText();
  await commit.getByRole('checkbox', { name: 'README.md' }).waitFor({ state: 'detached', timeout: 10_000 });
  check(
    'projects: Commit commits the checked files with the hooks’ output; they leave the changes',
    output.includes('pre-commit: passed'),
    `${await committed.innerText()} ${output.split('\n').join(' / ')}`,
  );
  await commit.getByRole('button', { name: 'Undo last commit' }).click();
  await commit.getByRole('checkbox', { name: 'README.md' }).waitFor({ timeout: 10_000 });
  const message = await commit.getByPlaceholder('Commit message').inputValue();
  check('projects: Undo last commit brings the files and the message back', message === 'Route invoices', message);

  // ---- find in files --------------------------------------------------------------------------------------------
  await page.getByRole('radio', { name: 'Find in files', exact: true }).click();
  await page.getByRole('textbox', { name: 'Find in files' }).fill('formatAmount');
  await page.getByRole('button', { name: 'Find', exact: true }).click();
  const found = page.getByText(/^\d+ match(es)? in \d+ files?/);
  await found.waitFor({ timeout: 10_000 });
  check('projects: find in files streams its matches', true, await found.innerText());

  // ---- history: a point with the current file, two points -----------------------------------------------------------
  await page.getByRole('radio', { name: 'History', exact: true }).click();
  const history = page.getByRole('region', { name: 'History' });
  const rows = history.getByRole('listitem');
  await rows.first().waitFor({ timeout: 10_000 });
  const labels = await history.locator('.kit-projects-point-label').allInnerTexts();
  result.history = labels;
  n = await shownCount();
  await rows.filter({ hasText: 'Commit' }).last().getByRole('button', { name: 'Compare with current' }).click();
  await editorShows(n, 'diff');
  check('projects: a point of the history compared with the current file', true, labels.join(' | '));
  n = await shownCount();
  const boxes = history.getByRole('checkbox');
  await boxes.nth(0).click();
  await boxes.nth((await boxes.count()) - 1).click();
  await history.getByRole('button', { name: 'Compare the two selected' }).click();
  await editorShows(n, 'diff');
  check('projects: two points of the history compared', true);
  await sleep(500);
  await shoot(page, 'projects-history-light.png');

  // ---- dark ----------------------------------------------------------------------------------------------------------
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
  await page.frameLocator('iframe.kit-projects-frame').locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
  await sleep(800);
  await shoot(page, 'projects-history-dark.png');
  n = await shownCount();
  await page.getByRole('button', { name: 'Back to the file' }).click();
  await editorShows(n, 'file');
  n = await shownCount();
  await page.getByRole('radio', { name: 'Diff', exact: true }).click();
  await editorShows(n, 'diff');
  await sleep(500);
  await shoot(page, 'projects-diff-dark.png');
  // Leaving a page that hosts the editor only once the editor has answered.
  await editorShows(0);
  await page.goto(`${base}#/projects`);
  await page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor({ timeout: 10_000 });
  await shoot(page, 'projects-list-dark.png');
  await themeMode(ctx, base, 'System');

  check('projects: no console error or page error', errors.length === 0, errors.join(' | '));
  await page.close();
};
