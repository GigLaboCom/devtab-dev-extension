// «Projects» on its demo data in the built extension (the companion's specification §12, stage 1, row 1.5; the layout of
// D35): the list of projects grouped by trusted folder, a project's tree, a file in the editor module (`show_file`), its
// diff with HEAD (`show_diff` with the demo's hunks) and back to the file (`set_mode`), an edit that saves itself (the
// save state goes through «Edited» to «Saved»), the Commit window (check, message, Commit, the hooks' output, the files
// leave the changes) and the undo of that commit, find in files, the file's history compared with the current file and
// two of its points compared — and not one console error or page error. The demo needs no permission and no companion;
// the manifest is the store build's. Screenshots in light and dark go where --shots says. Run by scripts/e2e-check.mjs.
//
// The panels around the editor (D35, src/app/projects/SidePanels.tsx): Files open and the bottom panel collapsed at
// first; the Commit view's switch and its count; the view that shows collapses its panel when pressed; each border
// dragged across the editor's iframe (the editor still `ready`); the layout read back after a reload; a search opening
// the bottom panel; a read-only project's Commit view; nothing cut off at 1280×800 and 1024×700 (the Commit window's
// buttons whole in the viewport); a narrow window starting with the side panel collapsed.

/* global document, location, MutationObserver, chrome -- page.evaluate callbacks run in the pages */

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
  /** A panel's switch: a toggle button (aria-pressed) of the panels' groups. */
  const switchOf = name =>
    page
      .locator('.kit-projects-switches')
      .getByRole('button', { name, exact: typeof name === 'string' })
      .and(page.locator('[aria-pressed]'));
  const pressed = async name => (await switchOf(name).getAttribute('aria-pressed')) === 'true';
  const sideOpen = async () => (await page.locator('#projects-side').getAttribute('data-open')) === 'true';
  const bottomOpen = async () => (await page.locator('#projects-bottom').getAttribute('data-open')) === 'true';
  const sideSplitter = page.getByRole('separator', { name: 'Resize the side panel' });
  const bottomSplitter = page.getByRole('separator', { name: 'Resize the bottom panel' });
  const valueOf = async locator => Number(await locator.getAttribute('aria-valuenow'));
  const forgetLayout = () =>
    page.evaluate(async () => {
      await chrome.storage.local.remove('projectsLayout');
      localStorage.removeItem('projects-layout-cache');
    });
  const ledger = `${base}#/projects/p_demo0ledgr`;

  // ---- the list ---------------------------------------------------------------------------------------------------
  await page.goto(`${base}#/projects`);
  await page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor({ timeout: 15_000 });
  await forgetLayout();
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

  // ---- a project: the panels as they start --------------------------------------------------------------------------
  await page.getByRole('link', { name: /ledger-api/ }).click();
  const tree = page.getByRole('tree', { name: 'Files' });
  await tree.locator('[data-path="src"]').waitFor({ timeout: 10_000 });
  const commitSwitch = switchOf(/^Commit/);
  const commitName = await commitSwitch.getAttribute('aria-label');
  const badge = Number(await commitSwitch.locator('.kit-projects-badge').innerText());
  const start = {
    files: await pressed('Files'),
    commit: await pressed(/^Commit/),
    side: await sideOpen(),
    bottom: await bottomOpen(),
    bottomSplitter: await bottomSplitter.count(),
    history: await pressed('History'),
    find: await pressed('Find in files'),
  };
  result.start = start;
  check(
    'projects: a project opens with Files showing and the bottom panel collapsed',
    start.files && !start.commit && start.side && !start.bottom && start.bottomSplitter === 0 && !start.history,
    JSON.stringify(start),
  );

  // ---- its tree, a file -----------------------------------------------------------------------------------------------
  const ignored = await tree.locator('[data-path="node_modules"]').getAttribute('data-ignored');
  check('projects: ignored folders are in the tree, dimmed', ignored === '');
  // The narrowest side panel: a marked file's name stays whole, its mark gives way; the name's tooltip is the name.
  await sideSplitter.focus();
  await page.keyboard.press('Home');
  const marked = await tree.locator('[data-path=".env.example"]').evaluate(row => {
    const name = row.querySelector('.kit-projects-row-name');
    const mark = row.querySelector('.kit-projects-mark');
    return {
      whole: name.scrollWidth <= name.clientWidth,
      title: name.getAttribute('title'),
      name: Math.round(name.getBoundingClientRect().width),
      mark: Math.round(mark.getBoundingClientRect().width),
    };
  });
  check(
    'projects: in the narrowest side panel a marked file’s name stays whole, the mark giving way (title: the name)',
    marked.whole && marked.title === '.env.example',
    JSON.stringify(marked),
  );
  await sideSplitter.dblclick();
  await tree.locator('[data-path="src"]').click();
  await tree.locator('[data-path="src/server.ts"]').click();
  await page.waitForFunction(() => location.hash === '#/projects/p_demo0ledgr/src%2Fserver.ts');
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0, 'file');
  check('projects: a file opens alone in the editor (show_file)', true, await frame.getAttribute('data-mode'));
  await sleep(500);
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

  // ---- the Commit view: its switch and count, a changed file's diff -------------------------------------------------
  await commitSwitch.click();
  const commit = page.getByRole('region', { name: 'Commit' });
  await commit.getByRole('checkbox', { name: 'README.md' }).waitFor({ timeout: 10_000 });
  const listed = await commit.locator('.kit-projects-change').count();
  const switched = { commit: await pressed(/^Commit/), files: await pressed('Files'), tree: await tree.count() };
  check(
    'projects: the Commit switch shows the Commit window in the side panel; its count is the changed files',
    switched.commit && !switched.files && switched.tree === 0 && badge === listed && commitName.includes(`${badge}`),
    `${commitName}; ${listed} listed; ${JSON.stringify(switched)}`,
  );
  n = await shownCount();
  await commit.getByRole('button', { name: /^src\/server\.ts/ }).click();
  await editorShows(n, 'diff');
  await commit.getByRole('group', { name: 'Chunks of src/server.ts' }).waitFor({ timeout: 10_000 });
  const chunkBoxes = await commit.getByRole('group', { name: 'Chunks of src/server.ts' }).getByRole('checkbox').count();
  check(
    'projects: a changed file opens its diff; its chunks’ checkboxes in the Commit view',
    chunkBoxes === 3,
    `${chunkBoxes}`,
  );

  // ---- commit what is checked, and undo it -----------------------------------------------------------------------
  await commit.getByPlaceholder('Commit message').fill('Route invoices');
  await sleep(400);
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

  // ---- the view that shows, pressed, collapses its panel ----------------------------------------------------------
  await commitSwitch.click();
  await page.locator('#projects-side[data-open="false"]').waitFor({ timeout: 5_000 });
  const strip = {
    files: await switchOf('Files').isVisible(),
    commit: await commitSwitch.isVisible(),
    badge: await commitSwitch.locator('.kit-projects-badge').isVisible(),
    width: Math.round((await page.locator('#projects-side').boundingBox()).width),
    splitter: await sideSplitter.count(),
  };
  check(
    'projects: pressing the Commit switch again collapses the side panel to a strip of both switches and the count',
    strip.files && strip.commit && strip.badge && strip.width < 64 && strip.splitter === 0,
    JSON.stringify(strip),
  );
  await sleep(300);
  await shoot(page, 'projects-side-collapsed-light.png');
  await commitSwitch.click();
  await commit.getByPlaceholder('Commit message').waitFor({ timeout: 5_000 });
  const kept = await commit.getByPlaceholder('Commit message').inputValue();
  check('projects: opened again, the Commit view kept its message', kept === 'Route invoices', kept);

  // ---- find in files: a search opens the bottom panel ----------------------------------------------------------------
  await page.getByRole('button', { name: 'Find in files…', exact: true }).click();
  const field = page.getByRole('textbox', { name: 'Find in files' });
  await field.waitFor({ timeout: 5_000 });
  const opened = {
    bottom: await bottomOpen(),
    find: await pressed('Find in files'),
    focused: await field.evaluate(el => el === document.activeElement),
  };
  check(
    'projects: «Find in files…» opens the bottom panel on Find, the field taking the keys',
    opened.bottom && opened.find && opened.focused,
    JSON.stringify(opened),
  );
  await page.keyboard.type('formatAmount');
  await page.keyboard.press('Enter');
  const found = page.getByText(/^\d+ match(es)? in \d+ files?/);
  await found.waitFor({ timeout: 10_000 });
  check('projects: find in files streams its matches', true, await found.innerText());
  await sleep(300);
  await shoot(page, 'projects-find-light.png');

  // ---- history: a point with the current file, two points -----------------------------------------------------------
  await switchOf('History').click();
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

  // ---- the borders dragged across the editor's iframe -------------------------------------------------------------------
  // The pointer jumps ahead of the border into the iframe's area (a fast drag), then on: while held, what lies under
  // the pointer must be the cover, not the iframe, or the iframe would take the moves and the drag would be lost.
  const drag = async (splitter, dx, dy) => {
    const s = await splitter.boundingBox();
    const from = { x: s.x + s.width / 2, y: s.y + s.height / 2 };
    const f = await frame.boundingBox();
    const inFrame = (x, y) => x > f.x && x < f.x + f.width && y > f.y && y < f.y + f.height;
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + dx * 0.75, from.y + dy * 0.75);
    const under = await page.evaluate(
      ([x, y]) => document.elementFromPoint(x, y)?.className ?? '',
      [from.x + dx * 0.75, from.y + dy * 0.75],
    );
    for (let i = 8; i <= 10; i++) await page.mouse.move(from.x + (dx * i) / 10, from.y + (dy * i) / 10);
    await page.mouse.up();
    return { over: inFrame(from.x + dx * 0.75, from.y + dy * 0.75), under };
  };
  const sideBefore = await valueOf(sideSplitter);
  const sideOver = await drag(sideSplitter, 160, 0);
  const sideAfter = await valueOf(sideSplitter);
  const sideDrawn = Math.round((await page.locator('#projects-side').boundingBox()).width);
  const bottomBefore = await valueOf(bottomSplitter);
  const bottomOver = await drag(bottomSplitter, 0, -120);
  const bottomAfter = await valueOf(bottomSplitter);
  const bottomDrawn = Math.round((await page.locator('#projects-bottom').boundingBox()).height);
  const alive = await frame.getAttribute('data-ready');
  n = await shownCount();
  await page.getByRole('button', { name: 'Back to the file' }).click();
  await editorShows(n, 'file');
  result.drag = { sideBefore, sideAfter, sideDrawn, sideOver, bottomBefore, bottomAfter, bottomDrawn, bottomOver };
  const covered = d => d.over && d.under.includes('kit-projects-drag-cover');
  check(
    'projects: the side border dragged 160 px, the pointer over the editor’s iframe (the cover under it), moves 160 px',
    covered(sideOver) && sideAfter - sideBefore === 160 && Math.abs(sideDrawn - sideAfter) <= 1,
    `${sideBefore} → ${sideAfter} (drawn ${sideDrawn}); ${JSON.stringify(sideOver)}`,
  );
  check(
    'projects: the bottom border dragged 120 px up over the editor’s iframe (the cover under the pointer) grows by 120 px',
    covered(bottomOver) && bottomAfter - bottomBefore === 120 && Math.abs(bottomDrawn - bottomAfter) <= 1,
    `${bottomBefore} → ${bottomAfter} (drawn ${bottomDrawn}); ${JSON.stringify(bottomOver)}`,
  );
  check('projects: after the drags the editor is alive (ready, it answers)', alive === '', `ready: ${alive}`);

  // ---- a border by the keyboard, and the layout read back after a reload ---------------------------------------------
  await sideSplitter.focus();
  await page.keyboard.press('ArrowLeft');
  const keyed = await valueOf(sideSplitter);
  check('projects: the side border moves by the arrow keys', keyed === sideAfter - 16, `${sideAfter} → ${keyed}`);
  await page.reload();
  await page.locator('#projects-bottom[data-open="true"]').waitFor({ timeout: 10_000 });
  await history.waitFor({ timeout: 10_000 });
  const back = {
    side: await valueOf(sideSplitter),
    bottom: await valueOf(bottomSplitter),
    history: await pressed('History'),
    commit: await pressed(/^Commit/),
  };
  check(
    'projects: after a reload the panels are as left — sizes, the open bottom panel on History, the Commit view',
    back.side === keyed && back.bottom === bottomAfter && back.history && back.commit,
    JSON.stringify(back),
  );
  await bottomSplitter.dblclick();
  const reset = await valueOf(bottomSplitter);
  check('projects: a double click puts a border back to its default', reset === 240, `${reset}`);

  // ---- nothing cut off at 1280×800 and 1024×700 ------------------------------------------------------------------------
  const fits = async () =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const main = document.querySelector('.kit-main');
      const commitView = document.querySelector('.kit-projects-commit');
      // Whole in the viewport, not clipped by the Commit window's scrolling, and nothing else over it (a disabled
      // button takes no pointer, so the point may find the row it stands in).
      const visible = el => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return false;
        if (r.left < 0 || r.top < 0 || r.right > vw || r.bottom > vh) return false;
        const box = el.closest('.kit-projects-commit, .kit-projects-side-head, .kit-projects-bottom-head');
        const c = box?.getBoundingClientRect();
        if (c && (r.top < c.top - 1 || r.bottom > c.bottom + 1 || r.left < c.left - 1 || r.right > c.right + 1))
          return false;
        const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
        return el === hit || el.contains(hit) || hit === el.parentElement;
      };
      const buttons = [...commitView.querySelectorAll('button')].filter(b =>
        ['Commit', 'Commit and Push…', 'Undo last commit', 'Push…'].includes(b.textContent.trim()),
      );
      return {
        overflowX: main.scrollWidth > main.clientWidth + 1 || document.documentElement.scrollWidth > vw + 1,
        sectionInside: document.querySelector('.kit-projects').getBoundingClientRect().bottom <= vh + 1,
        commitScrolls: commitView.scrollHeight > commitView.clientHeight + 1,
        buttons: buttons.map(b => [b.textContent.trim(), visible(b)]),
        switches: [...document.querySelectorAll('.kit-projects-switch')].every(visible),
        editor: document.querySelector('iframe.kit-projects-frame').getBoundingClientRect().width,
      };
    });
  await bottomSplitter.dblclick();
  await sideSplitter.dblclick();
  await switchOf('History').click(); // collapsed again: the most height for the Commit window
  for (const [width, height] of [
    [1280, 800],
    [1024, 700],
  ]) {
    await page.setViewportSize({ width, height });
    await sleep(400);
    const fit = await fits();
    result[`fit${width}`] = fit;
    check(
      `projects: at ${width}×${height} nothing overflows; the Commit window’s four buttons are whole in the viewport`,
      !fit.overflowX &&
        fit.sectionInside &&
        fit.buttons.length === 4 &&
        fit.buttons.every(([, ok]) => ok) &&
        fit.switches &&
        fit.editor >= 320,
      JSON.stringify(fit),
    );
    if (width === 1024) await shoot(page, 'projects-commit-1024x700-light.png');
  }

  // ---- a read-only project: the changes, one line instead of the commit ------------------------------------------------
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Make read only' }).click();
  await page.getByRole('button', { name: 'Make writable…' }).waitFor({ timeout: 10_000 });
  await commit.locator('[data-read-only]').waitFor({ timeout: 10_000 });
  n = await shownCount();
  await commit.getByRole('button', { name: /^src\/server\.ts/ }).click();
  await editorShows(n, 'diff');
  const readOnly = {
    line: await commit.locator('[data-read-only]').innerText(),
    changes: await commit.locator('.kit-projects-change').count(),
    checkboxes: await commit.getByRole('checkbox').count(),
    message: await commit.getByRole('textbox').count(),
    buttons: await commit.getByRole('button', { name: /^Commit/ }).count(),
    rollback: await commit.getByRole('button', { name: 'Rollback…' }).count(),
  };
  check(
    'projects: a read-only project’s Commit view shows its changes and diffs, one line of why, no commit controls',
    readOnly.line.includes('read only') &&
      readOnly.changes > 0 &&
      readOnly.checkboxes === 0 &&
      readOnly.message === 0 &&
      readOnly.buttons === 0 &&
      readOnly.rollback === 0,
    JSON.stringify(readOnly),
  );
  await sleep(500);
  await shoot(page, 'projects-commit-readonly-light.png');
  await page.getByRole('button', { name: 'Make writable…' }).click();
  await page.getByRole('button', { name: 'Make read only' }).waitFor({ timeout: 10_000 });

  // ---- a narrow window: the side panel starts collapsed -----------------------------------------------------------------
  await page.setViewportSize({ width: 800, height: 700 });
  await page.goto(`${ledger}/src%2Fserver.ts`);
  await page.reload();
  await page.locator('#projects-side').waitFor({ timeout: 10_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  const narrow = {
    side: await sideOpen(),
    editor: Math.round((await frame.boundingBox()).width),
    remembered: await page.evaluate(
      async () => (await chrome.storage.local.get('projectsLayout')).projectsLayout?.side,
    ),
  };
  check(
    'projects: in a narrow window the side panel starts collapsed (what is remembered stays open)',
    !narrow.side && narrow.remembered?.open === true && narrow.editor >= 320,
    JSON.stringify(narrow),
  );
  await sleep(500);
  await shoot(page, 'projects-narrow-light.png');
  await page.setViewportSize({ width: 1440, height: 900 });

  // ---- dark ----------------------------------------------------------------------------------------------------------
  await page.goto(`${ledger}/src%2Fserver.ts`);
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  await switchOf('History').click();
  await history.getByRole('listitem').first().waitFor({ timeout: 10_000 });
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
  await page.frameLocator('iframe.kit-projects-frame').locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
  await sleep(800);
  await shoot(page, 'projects-history-dark.png');
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
  await forgetLayout();

  check('projects: no console error or page error', errors.length === 0, errors.join(' | '));
  await page.close();
};
