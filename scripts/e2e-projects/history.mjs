// «Projects» with a companion of stage 7 (the companion's specification §12, row 7.5), in the built extension against
// the fake host (./fake-host.mjs, the scripted companion of ./companion.mjs), run by scripts/e2e-projects.mjs: a
// file's history opened in «Compare code» next to the current file, edited there and saved back into the project
// through a connection of its own; a file's points with its commits; a restore asked with the comparison shown, written
// from the version shown, and undone; the stretch the companion did not watch, told by its event; the project's feed
// with its deleted files and a deleted file's history; a file a commit deleted, whose points without a text the
// companion names (`content`); clearing the history answered with the command for Terminal; then a companion of stage
// 6, whose feeds read while restoring and clearing are inactive and never sent, and one older than `content`, whose
// moments without a text are known by their labels. Screenshots of the new states, light and dark, wide and narrow.

/* global document, location -- page.evaluate callbacks run in the page */

const PROJECT = 'p_abcdefgh23';

/** The four looks of one state: light and dark, wide and narrow (the page follows the system's scheme). */
const shotsOf = (page, shoot, sleep) => async name => {
  for (const [scheme, width] of [
    ['light', 1440],
    ['light', 860],
    ['dark', 1440],
    ['dark', 860],
  ]) {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });
    await sleep(350);
    await shoot(page, `projects-${name}-${scheme}-${width === 1440 ? 'wide' : 'narrow'}.png`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(200);
};

export const runCompanionHistory = async ({ page, check, shoot, sleep, command, logOf, setMode, waitState }) => {
  const shots = shotsOf(page, shoot, sleep);
  const calls = (from, method) =>
    logOf()
      .slice(from)
      .filter(r => r.event === 'in' && r.type === 'call' && (!method || r.method === method));
  const frame = page.locator('iframe.kit-projects-frame');
  const history = page.getByRole('region', { name: 'History' });
  const labels = () => history.locator('.kit-projects-point-label').allInnerTexts();
  const row = label =>
    history
      .locator('.kit-projects-point')
      .filter({ has: page.locator('.kit-projects-point-label', { hasText: label }) });
  const go = async hash => {
    await page.evaluate(h => (location.hash = h), hash);
    await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
    await waitState(page, 'ready');
  };
  /** A fresh companion (a new host, its repository as the vectors saw it), as a lost port brings. */
  const freshHost = async mode => {
    setMode(mode);
    command({ exit: true });
    await page.waitForFunction(
      () => document.querySelector('.kit-projects')?.getAttribute('data-connection') === 'reconnecting',
      null,
      { timeout: 10_000 },
    );
    await waitState(page, 'ready');
  };
  const openFile = async path => {
    await go(`#/projects/${PROJECT}`);
    await go(`#/projects/${PROJECT}/${encodeURIComponent(path)}`);
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await page.locator('.kit-projects-save[data-state="saved"]').waitFor({ timeout: 15_000 });
  };
  const openWithHistory = async path => {
    await openFile(path);
    await page.getByRole('button', { name: 'Show history', exact: true }).click();
    await history.locator('.kit-projects-point').first().waitFor({ timeout: 10_000 });
  };
  const typeInEditor = async keys => {
    const box = await frame.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    for (const key of ['End', ...keys]) await page.keyboard.press(key);
  };

  await freshHost({ mode: 'normal' });

  // ---- «Open in Compare code»: the version and the current file; the current side saved back into the project -----
  await openWithHistory('docs/readme.md');
  const fileLabels = await labels();
  const commitMarks = await history.locator('.kit-projects-point[data-source="commit"] .kit-projects-mark').count();
  check(
    'projects: a file’s history (history.file) — the server’s point and the commits that changed it, marked',
    fileLabels.join('|') === 'External change|Second commit|First commit' && commitMarks === 2,
    `${fileLabels.join(' | ')}; ${commitMarks} commit marks`,
  );
  const hostsBefore = new Set(
    logOf()
      .filter(r => r.event === 'start')
      .map(r => r.pid),
  );
  let mark = logOf().length;
  await row('External change').getByRole('button', { name: 'Open in Compare code' }).click();
  await page.waitForFunction(() => location.hash === '#/compare', null, { timeout: 10_000 });
  await page.waitForFunction(
    () => {
      const el = document.querySelector('.kit-compare-counts');
      return el?.dataset.viewerState === 'ready' && Number(el.dataset.shown) > 0;
    },
    null,
    { timeout: 45_000 },
  );
  const side = side => page.locator(`.kit-compare-side[data-side="${side}"]`);
  const names = [
    await side('old').locator('.kit-compare-side-name').innerText(),
    await side('new').locator('.kit-compare-side-name').innerText(),
  ];
  const projectBadge = await side('new').locator('[data-badge="project"]').count();
  await side('new').locator('[data-action="edit"]').click();
  await sleep(300);
  const compareFrame = page.locator('iframe.kit-compare-frame');
  const box = await compareFrame.boundingBox();
  await page.mouse.click(box.x + box.width * 0.75, box.y + 24);
  for (const key of ['End', 'Z']) await page.keyboard.press(key);
  await side('new').locator('[data-badge="modified"]').waitFor({ timeout: 10_000 });
  await side('new').locator('[data-action="save"]').click();
  await page.locator('.kit-compare-notice', { hasText: 'Saved readme.md.' }).waitFor({ timeout: 20_000 });
  const saves = calls(mark, 'file.save');
  const saverHost = saves.at(-1)?.pid;
  await sleep(600);
  const saverEnded = logOf().some(r => r.pid === saverHost && r.event === 'stdin-end');
  await shoot(page, 'projects-history-compare-saved-light-wide.png');
  check(
    'projects: «Open in Compare code» — the version on the left, the current file on the right as the project’s file; edited there, Save writes it back (file.save from the version shown, a port of its own, let go)',
    names[0].startsWith('readme.md (External change') &&
      names[1] === 'readme.md' &&
      projectBadge === 1 &&
      saves.length === 1 &&
      saves[0].params.path === 'docs/readme.md' &&
      typeof saves[0].params.baseHash === 'string' &&
      !hostsBefore.has(saverHost) &&
      saverEnded,
    `${names.join(' ↔ ')}; ${JSON.stringify(saves.map(s => ({ pid: s.pid, ...s.params })))}; ended ${saverEnded}`,
  );

  // ---- a restore, asked with the comparison shown, written from the version shown, undone ---------------------------
  // The page's own host (fresh) knows nothing of the save above: its file still holds the vectors' text.
  await openFile('src/new.txt');
  await typeInEditor(['X']);
  await page.locator('.kit-projects-save[data-state="saved"]').waitFor({ timeout: 15_000 });
  await page.getByRole('button', { name: 'Show history', exact: true }).click();
  await row('Before edit').first().waitFor({ timeout: 10_000 });
  mark = logOf().length;
  await row('Before edit').first().getByRole('button', { name: 'Restore…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Restore this version?' });
  await dialog.waitFor({ timeout: 10_000 });
  await page.waitForFunction(() => document.querySelector('iframe.kit-projects-frame')?.dataset.mode === 'diff', null, {
    timeout: 20_000,
  });
  const body = await dialog.innerText();
  await shots('history-restore');
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  await history.getByText('Restored. The version it replaced is in the history.').waitFor({ timeout: 10_000 });
  const restore = calls(mark, 'history.restore').at(-1);
  const read = calls(mark, 'file.read').find(r => r.params?.path === 'src/new.txt');
  await row('Before restore').first().waitFor({ timeout: 10_000 });
  await shots('history-restored');
  check(
    'projects: a restore asks with the comparison in the editor, sends the version shown (currentHash), and the companion’s «Before restore» appears',
    body.includes('The current version is kept in the history.') &&
      restore?.params.path === 'src/new.txt' &&
      typeof restore?.params.currentHash === 'string' &&
      !!read,
    `${body.replace(/\s+/g, ' ')}; ${JSON.stringify(restore?.params)}`,
  );
  mark = logOf().length;
  await history.getByRole('button', { name: 'Undo restore' }).click();
  await history.getByText('The restore is undone.').waitFor({ timeout: 10_000 });
  const undo = calls(mark, 'history.restore').at(-1);
  check(
    'projects: «Undo restore» restores the companion’s copy of what was replaced, from the version the restore wrote',
    undo?.params.point?.startsWith('c:') && typeof undo?.params.currentHash === 'string',
    JSON.stringify(undo?.params),
  );

  // ---- a refusal of the write policy, in the page's words ------------------------------------------------------------
  command({ failNext: { method: 'history.restore', code: 'protected-path', data: { rule: 'read-only-file' } } });
  await sleep(200);
  await row('Before edit').first().getByRole('button', { name: 'Restore…' }).click();
  await dialog.getByRole('button', { name: 'Restore', exact: true }).click();
  const refused = await history.locator('[data-said="restore"]').innerText({ timeout: 10_000 });
  check(
    'projects: a refused restore is said in the page’s words (protected-path, read-only-file)',
    refused.includes('The file is read only on disk.'),
    refused,
  );

  // ---- the stretch the companion did not watch, told by its event ----------------------------------------------------
  command({
    gap: { project: PROJECT, from: Date.now() - 6 * 3_600_000, to: Date.now() - 3_600_000, paths: 1 },
  });
  const gap = await history.locator('[data-gap]').first().innerText({ timeout: 10_000 });
  await shots('history-gap');
  check(
    'projects: `history.gap` — the history says it may be incomplete, and from when to when',
    /^The history may be incomplete: the companion was not running from .+ to .+\.$/.test(gap),
    gap,
  );

  // ---- the project's feed, its deleted files, a deleted file's history ------------------------------------------------
  await history.getByRole('radio', { name: 'Project' }).click();
  const deleted = history.getByRole('group', { name: 'Deleted files' });
  await deleted.waitFor({ timeout: 10_000 });
  const projectRows = await history.locator('.kit-projects-point:not([data-deleted])').count();
  await shots('history-project');
  await deleted.getByRole('button', { name: 'History of gone.txt, deleted' }).click();
  await history.locator('[data-deleted-subject]').waitFor({ timeout: 10_000 });
  // Another feed is not shown until it is read: wait for the deleted file's own points.
  await row('Deleted while away').waitFor({ timeout: 10_000 });
  const goneLabels = await labels();
  const noText = await row('Deleted while away').innerText();
  await shots('history-deleted');
  check(
    'projects: the project’s feed (history.project) with its deleted files; a deleted file’s history — a moment kept without its text offers nothing to open',
    projectRows > 0 &&
      goneLabels.join('|') === 'Deleted while away|Saved' &&
      noText.includes('No version kept') &&
      (await row('Deleted while away').getByRole('button').count()) === 0 &&
      (await row('Saved').getByRole('button', { name: 'Restore…' }).count()) === 1,
    `${projectRows} points; ${goneLabels.join(' | ')}`,
  );

  // ---- a file a commit deleted: the points without a text are the companion's word (`content`), not a label --------
  await history.getByRole('radio', { name: 'Project' }).click();
  await deleted.getByRole('button', { name: 'History of retired.txt, deleted' }).click();
  await row('Add retired.txt').waitFor({ timeout: 10_000 });
  const retiredLabels = await labels();
  const textless = [];
  for (const label of ['Remove retired.txt', 'Before rollback'])
    textless.push({
      label,
      none: (await row(label).getAttribute('data-text')) === 'none',
      said: (await row(label).innerText()).includes('No version kept'),
      buttons: await row(label).getByRole('button').count(),
    });
  check(
    'projects: a file a commit deleted — the deleting commit and a copy kept without its text say «No version kept» by the companion’s `content` and offer nothing; the commit that added it can be restored',
    retiredLabels.join('|') === 'Remove retired.txt|Before rollback|Add retired.txt' &&
      textless.every(t => t.none && t.said && t.buttons === 0) &&
      (await row('Add retired.txt').getByRole('button', { name: 'Restore…' }).count()) === 1,
    `${retiredLabels.join(' | ')}; ${JSON.stringify(textless)}`,
  );

  // ---- clearing: the companion without its window answers with the command ----------------------------------------
  await history.getByRole('radio', { name: 'Project' }).click();
  mark = logOf().length;
  await history.getByRole('button', { name: 'Clear history…' }).click();
  const purge = history.locator('[data-said="purge"]');
  const command_ = await purge.locator('[data-command]').innerText({ timeout: 10_000 });
  const copy = await purge.getByRole('button', { name: /^Copy the command/ }).count();
  await shots('history-purge');
  check(
    'projects: «Clear history…» asks the companion (history.requestPurge); without its window — its command for Terminal, verbatim, with Copy',
    command_ === 'devtab history purge ~/fx/repo' &&
      copy === 1 &&
      (await purge.getAttribute('data-tone')) === 'info' &&
      calls(mark, 'history.requestPurge').length === 1,
    command_,
  );

  // ---- a companion of stage 6: the feeds read; restore and clearing inactive, never sent ---------------------------
  await freshHost({ mode: 'normal', methods: 'stage6' });
  mark = logOf().length;
  await openWithHistory('docs/readme.md');
  const quiet = await history.locator('[data-history="quiet"]').innerText({ timeout: 10_000 });
  const restoreButtons = await history.getByRole('button', { name: 'Restore…' }).count();
  await history.getByRole('radio', { name: 'Project' }).click();
  await history.locator('.kit-projects-point').first().waitFor({ timeout: 10_000 });
  const clearButtons = await history.getByRole('button', { name: 'Clear history…' }).count();
  await shots('history-older-companion');
  check(
    'projects: a companion of stage 6 — the history reads; restoring and clearing inactive with one sentence; neither sent',
    quiet === 'This companion cannot restore versions or clear the history yet.' &&
      restoreButtons === 0 &&
      clearButtons === 0 &&
      calls(mark, 'history.restore').length === 0 &&
      calls(mark, 'history.requestPurge').length === 0,
    quiet,
  );

  // ---- a companion older than `content` and the full `welcome.limits`: labels tell, pages of 100 -------------------
  await freshHost({ mode: 'normal', contentFlag: false });
  mark = logOf().length;
  await openWithHistory('docs/readme.md');
  await history.getByRole('radio', { name: 'Project' }).click();
  await deleted.waitFor({ timeout: 10_000 });
  const firstPage = calls(mark, 'history.project').find(c => c.params.since === undefined);
  await deleted.getByRole('button', { name: 'History of gone.txt, deleted' }).click();
  await row('Deleted while away').waitFor({ timeout: 10_000 });
  const olderNoText = await row('Deleted while away').innerText();
  check(
    'projects: a companion older than `content` — «Deleted while away» known by its label, «No version kept», nothing to open; the project’s feed asked 100 at a time',
    olderNoText.includes('No version kept') &&
      (await row('Deleted while away').getByRole('button').count()) === 0 &&
      firstPage?.params.limit === 100,
    `${olderNoText.replace(/\s+/g, ' ')}; ${JSON.stringify(firstPage?.params)}`,
  );
  await freshHost({ mode: 'normal' });
};
