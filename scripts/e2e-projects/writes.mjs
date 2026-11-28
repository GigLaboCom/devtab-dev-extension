// «Projects» with a companion of stages 4–6 (the companion's specification §12, rows 4.5, 5.4, 6.5), in the built
// extension against the fake host (./fake-host.mjs, the scripted companion of ./companion.mjs), run by
// scripts/e2e-projects.mjs: the trusted folders; «Add project…» inside a trusted folder (at once) and outside one (the
// command for Terminal shown verbatim; the companion's window answered yes and no); the class both ways; a file saved
// by itself and by ⌘S, a conflict after an outside edit and its choices, every refusal of the write policy in the
// page's words; new file, folder, rename, delete without a Trash; a commit of chosen hunks with the hooks' output
// streamed, hooks off, every commit error of §6.1–§6.8, undo, rollback; then an older companion (stage 3) that still
// reads and shows every write inactive. Screenshots of the new states, light and dark, wide and narrow.

/* global document, location -- page.evaluate callbacks run in the page */

import { TRUSTED_ROOT } from './companion.mjs';

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

export const runCompanionWrites = async ({ page, check, shoot, sleep, command, logOf, setMode, waitState }) => {
  const shots = shotsOf(page, shoot, sleep);
  const calls = (from, method) =>
    logOf()
      .slice(from)
      .filter(r => r.event === 'in' && r.type === 'call' && (!method || r.method === method));
  const said = (root, kind) => root.locator(`[data-said="${kind}"]`);
  const tree = page.getByRole('tree', { name: 'Files' });
  const frame = page.locator('iframe.kit-projects-frame');
  const shownCount = () => frame.evaluate(el => Number(el.dataset.shown ?? 0));
  const editorShows = (n, mode) =>
    page.waitForFunction(
      ([n, mode]) => {
        const el = document.querySelector('iframe.kit-projects-frame');
        return el && Number(el.dataset.shown ?? 0) > n && (!mode || el.dataset.mode === mode);
      },
      [n, mode],
      { timeout: 45_000 },
    );
  const saveText = () => page.locator('.kit-projects-save').innerText();
  const waitSave = (state, timeout = 10_000) =>
    page.waitForFunction(w => document.querySelector('.kit-projects-save')?.getAttribute('data-state') === w, state, {
      timeout,
    });
  // Within the section by the address alone: the page keeps its one port, so the fake host keeps what happened.
  const go = async hash => {
    await page.evaluate(h => (location.hash = h), hash);
    await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
    await waitState(page, 'ready');
  };
  /** Opens a file of the project from its address; resolves once the editor shows it, saved. */
  const openFile = async path => {
    await go(`#/projects/${PROJECT}`);
    await tree.locator('[data-path]').first().waitFor({ timeout: 10_000 });
    const n = await shownCount().catch(() => 0);
    await go(`#/projects/${PROJECT}/${encodeURIComponent(path)}`);
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await editorShows(n, 'file');
    await waitSave('saved');
  };
  /** Types into the editor at the end of its first line. */
  const typeInEditor = async keys => {
    const box = await frame.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    for (const key of ['End', ...keys]) await page.keyboard.press(key);
  };
  const addDialog = async () => {
    await page.getByRole('button', { name: /^Add project/ }).click();
    return page.getByRole('dialog', { name: 'Add a project' });
  };
  const add = async (dialog, path) => {
    await dialog.getByLabel('Full path of the folder').fill(path);
    await dialog.getByRole('button', { name: 'Add', exact: true }).click();
  };
  const settle = () => sleep(250);
  /** The Commit view, shown (its switch pressed once if it is not). */
  const showCommit = async () => {
    const commitSwitch = page
      .locator('.kit-projects-switches')
      .getByRole('button', { name: /^Commit/ })
      .and(page.locator('[aria-pressed]'));
    if ((await commitSwitch.getAttribute('aria-pressed')) !== 'true') await commitSwitch.click();
  };

  // ---- the trusted folders, read only ---------------------------------------------------------------------------------
  await go('#/projects');
  await page.getByRole('heading', { name: 'Trusted folders', exact: true }).waitFor({ timeout: 10_000 });
  const folders = await page.locator('.kit-projects-folder').allInnerTexts();
  const folderButtons = await page
    .locator('section[aria-labelledby="projects-folders-title"]')
    .getByRole('button')
    .count();
  check(
    'projects: the trusted folders (locations.list) listed read only — name, folder, its projects — no button changes one',
    folders.length === 1 && folders[0].includes('fx') && folders[0].includes('~/fx') && folderButtons === 0,
    folders.join(' | ').replace(/\s+/g, ' '),
  );
  await shots('trusted-folders');

  // ---- «Add project…» inside a trusted folder: at once, writable, opened ------------------------------------------------
  let mark = logOf().length;
  let dialog = await addDialog();
  await add(dialog, `${TRUSTED_ROOT}/second`);
  await page.waitForFunction(() => /^#\/projects\/p_[a-z0-9]{10}$/.test(location.hash), null, { timeout: 10_000 });
  await page.locator('.kit-projects-class[data-class="mine"]').waitFor({ timeout: 10_000 });
  const addedClass = await page.locator('.kit-projects-class').innerText();
  check(
    'projects: «Add project…» inside a trusted folder: added at once, writable through the folder, and opened',
    addedClass.includes('Writable') && addedClass.includes('via fx') && calls(mark, 'project.requestAdd').length === 1,
    addedClass.replace(/\s+/g, ' '),
  );

  // ---- outside: the command for Terminal, verbatim ---------------------------------------------------------------------
  await go('#/projects');
  dialog = await addDialog();
  await add(dialog, '/elsewhere/app');
  const shownCommand = await dialog.locator('[data-command]').innerText({ timeout: 10_000 });
  const sentence = await dialog.locator('.kit-projects-said-text').innerText();
  check(
    'projects: outside a trusted folder without the companion’s window — the command it sent, verbatim, with one sentence',
    shownCommand === 'cd /elsewhere/app && devtab add' && sentence.includes('cannot ask you in a window'),
    `${sentence} ${shownCommand}`,
  );
  await shots('add-project-command');
  await dialog.getByRole('button', { name: 'Cancel' }).click();

  // ---- the companion's window: yes, then no --------------------------------------------------------------------------
  command({ confirm: 'yes' });
  await settle();
  dialog = await addDialog();
  await add(dialog, '/elsewhere/confirmed');
  await dialog.getByText('Confirm in the companion’s window.').waitFor({ timeout: 5_000 });
  await shots('add-project-awaiting');
  await page.waitForFunction(() => /^#\/projects\/p_[a-z0-9]{10}$/.test(location.hash), null, { timeout: 10_000 });
  await page.locator('.kit-projects-class[data-class="view"]').waitFor({ timeout: 10_000 });
  const confirmedClass = await page.locator('.kit-projects-class').innerText();
  command({ confirm: 'no' });
  await settle();
  await go('#/projects');
  dialog = await addDialog();
  await add(dialog, '/elsewhere/declined');
  const declined = await said(dialog, 'add').innerText({ timeout: 10_000 });
  check(
    'projects: the window answered yes — added read only, confirmed in the window; answered no — said, nothing added',
    confirmedClass.includes('Read only') &&
      confirmedClass.includes('confirmed in the companion’s window') &&
      declined.includes('declined in the companion’s window'),
    `${confirmedClass.replace(/\s+/g, ' ')}; ${declined}`,
  );
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  command({ confirm: 'unavailable' });
  await settle();

  // ---- the class: read only at once; writable again through the window ---------------------------------------------
  await go(`#/projects/${PROJECT}`);
  await page.getByRole('button', { name: 'Make read only' }).click();
  await page.locator('.kit-projects-class[data-class="view"]').waitFor({ timeout: 10_000 });
  const viewClass = await page.locator('.kit-projects-class').innerText();
  await page.getByRole('button', { name: 'Make writable…' }).click();
  const mineCommand = await page.locator('[data-said="class"] [data-command]').innerText({ timeout: 10_000 });
  await shots('make-writable-command');
  command({ confirm: 'yes' });
  await settle();
  await page.getByRole('button', { name: 'Make writable…' }).click();
  await page.locator('[data-request="awaiting-confirmation"]').waitFor({ timeout: 5_000 });
  await page.locator('.kit-projects-class[data-class="mine"]').waitFor({ timeout: 10_000 });
  check(
    'projects: «Make read only» at once (made read only by you); «Make writable…» — the command without a window, the window’s yes with it',
    viewClass.includes('made read only by you') && mineCommand === 'cd ~/fx/repo && devtab add --write',
    `${viewClass.replace(/\s+/g, ' ')}; ${mineCommand}`,
  );
  command({ confirm: 'unavailable' });
  await settle();
  await shots('class-and-folder');

  // ---- saving: by itself after the pause, and at once by ⌘S --------------------------------------------------------------
  await openFile('src/new.txt');
  mark = logOf().length;
  await typeInEditor(['Space', 'a']);
  await waitSave('pending', 5_000);
  await waitSave('saved');
  const auto = calls(mark, 'file.save');
  mark = logOf().length;
  await typeInEditor(['Space', 'b']);
  await waitSave('pending', 5_000);
  await page.keyboard.press('Meta+s');
  await waitSave('saved', 900);
  const explicit = calls(mark, 'file.save');
  check(
    'projects: an edit saves itself through file.save (the version read as baseHash); ⌘S saves at once',
    auto.length === 1 &&
      auto[0].params.reason === 'auto' &&
      /^[0-9a-f]{64}$/.test(auto[0].params.baseHash) &&
      explicit.some(c => c.params.reason === 'explicit'),
    JSON.stringify([...auto, ...explicit].map(c => c.params.reason)),
  );

  // ---- a conflict after an outside edit: the three choices -----------------------------------------------------------
  await typeInEditor(['Space', 'c']);
  // The outside edit arrives while the keystroke may not have reached the page yet: it still counts as unsaved.
  command({ changeOnDisk: { project: PROJECT, path: 'src/new.txt', text: 'changed outside\n' } });
  await page.getByText('The file changed on disk while you were editing it.').waitFor({ timeout: 10_000 });
  const conflictState = await saveText();
  await shots('conflict');
  let n = await shownCount();
  await page.getByRole('button', { name: 'Show the comparison' }).click();
  await editorShows(n);
  await shots('conflict-comparison');
  mark = logOf().length;
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSave('saved');
  const kept = calls(mark, 'file.save');
  check(
    'projects: a change on disk under an unsaved edit stops the saving and offers keep mine / apply / compare; «Keep mine» writes over',
    conflictState === 'Not saved: conflict' && kept.length === 1 && kept[0].params.reason === 'explicit',
    `${conflictState}; ${kept.length} save(s)`,
  );

  // ---- every refusal of the write policy, in the page's words ----------------------------------------------------------
  const refusals = [
    ['not-encodable', { encoding: 'windows-1252' }, 'The text has characters windows-1252 cannot hold.'],
    ['protected-path', { rule: 'read-only-file' }, 'The file is read only on disk.'],
    ['protected-path', { rule: 'symlink' }, 'This is a link: the page does not write through links.'],
    ['protected-path', { rule: 'git-dir' }, 'Files inside .git are never written from the page.'],
    ['secret-file', undefined, 'This file holds secrets: it is read only from the page.'],
    ['outside-project', undefined, 'The path leads outside the project, through a link.'],
    ['not-mine', undefined, 'The project is read only. Make it writable first.'],
    [
      'disk-low',
      { freeBytes: 1_048_576, floorBytes: 2_147_483_648, usedBytes: 0, budgetBytes: 2_147_483_648 },
      'Too little free disk space',
    ],
    ['too-large', { size: 6_000_000, limit: 5_242_880 }, 'The text is larger than the companion takes (5.0 MB).'],
  ];
  const refused = [];
  for (const [code, data, words] of refusals) {
    await openFile('crlf.txt');
    command({ failNext: { method: 'file.save', code, data } });
    await settle();
    await typeInEditor(['Space', 'r']);
    await waitSave('refused');
    const text = await page.locator('[data-refused]').innerText();
    refused.push([code, text.startsWith('Not saved: ') && text.includes(words), text]);
    if (code === 'not-encodable') await shots('refused-save');
  }
  check(
    'projects: each refusal of the write policy is its own plain text (encoding, read-only file, link, .git, secret, outside, read-only project, disk, size)',
    refused.every(([, ok]) => ok),
    refused
      .filter(([, ok]) => !ok)
      .map(([c, , t]) => `${c}: ${t}`)
      .join(' | ') || `${refused.length} refusals`,
  );

  // ---- a file that runs code keeps its mark after a save ---------------------------------------------------------------
  await go(`#/projects/${PROJECT}`);
  await page.getByRole('button', { name: 'New file…' }).click();
  dialog = page.getByRole('dialog', { name: 'New file' });
  await dialog.getByLabel('Path in the project').fill('.husky/pre-commit');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => location.hash.endsWith('.husky%2Fpre-commit'), null, { timeout: 10_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await waitSave('saved');
  await typeInEditor(['e', 'c', 'h', 'o']);
  await waitSave('saved');
  const runsCode = await page.locator('.kit-projects-editor-bar [data-mark="runs-code"]').count();
  check(
    'projects: a file that runs code (a hook) is marked, and keeps the mark after a save',
    runsCode === 1,
    `${runsCode}`,
  );

  // ---- new file, new folder, rename; delete without a Trash; a secret's name refused ------------------------------------
  await go(`#/projects/${PROJECT}`);
  await page.getByRole('button', { name: 'New folder…' }).click();
  dialog = page.getByRole('dialog', { name: 'New folder' });
  await dialog.getByLabel('Path in the project').fill('notes/e2e');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.locator('[data-said="files"]').filter({ hasText: 'Created notes/e2e.' }).waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'New file…' }).click();
  dialog = page.getByRole('dialog', { name: 'New file' });
  await dialog.getByLabel('Path in the project').fill('notes/e2e/first.txt');
  await dialog.getByRole('button', { name: 'Create' }).click();
  await page.waitForFunction(() => location.hash.endsWith('notes%2Fe2e%2Ffirst.txt'), null, { timeout: 10_000 });
  await page.getByRole('button', { name: 'Rename…' }).click();
  dialog = page.getByRole('dialog', { name: /^Rename / });
  await dialog.getByLabel('Path in the project').fill('notes/e2e/renamed.txt');
  await dialog.getByRole('button', { name: 'Rename', exact: true }).click();
  await page.waitForFunction(() => location.hash.endsWith('notes%2Fe2e%2Frenamed.txt'), null, { timeout: 10_000 });
  await tree.locator('[data-path="notes/e2e/renamed.txt"]').waitFor({ timeout: 10_000 });
  await page.getByRole('button', { name: 'Delete…' }).click();
  const noTrash = await page.locator('[data-said="files"]').innerText({ timeout: 5_000 });
  await page.getByRole('button', { name: 'New file…' }).click();
  dialog = page.getByRole('dialog', { name: 'New file' });
  await dialog.getByLabel('Path in the project').fill('.env.local');
  await dialog.getByRole('button', { name: 'Create' }).click();
  const secretName = await said(dialog, 'write').innerText({ timeout: 5_000 });
  await shots('file-actions');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  check(
    'projects: new folder, new file (opened), rename; Delete says the companion has no Trash yet; a secret’s name is refused in words',
    noTrash.includes('cannot move files to the Trash yet') && secretName.includes('holds secrets'),
    `${noTrash}; ${secretName}`,
  );

  // ---- commit chosen hunks with a passing hook, its output streamed ----------------------------------------------------
  await go(`#/projects/${PROJECT}`);
  await showCommit();
  const commit = page.getByRole('region', { name: 'Commit' });
  await commit.getByRole('group', { name: 'Changes' }).waitFor({ timeout: 10_000 });
  // Nothing checked, then the second hunk of src/app.txt only.
  for (const group of ['Changes', 'Unversioned Files']) {
    const box = commit.getByRole('checkbox', { name: group, exact: true });
    if ((await box.count()) && (await box.getAttribute('data-state')) !== 'unchecked') {
      await box.click();
      if ((await box.getAttribute('data-state')) !== 'unchecked') await box.click();
    }
  }
  n = await shownCount();
  await commit.getByRole('button', { name: /^src\/app\.txt/ }).click();
  const chunks = commit.getByRole('group', { name: 'Chunks of src/app.txt' });
  await chunks.getByRole('checkbox').nth(2).waitFor({ timeout: 10_000 });
  await chunks.getByRole('checkbox').nth(1).click();
  await commit.getByPlaceholder('Commit message').fill('Change line 15 only');
  const checkedLine = await commit.getByText(/files? checked/).innerText();
  const hooksLine = await commit.locator('[data-hooks]').innerText();
  await shots('commit-hunks');
  mark = logOf().length;
  await commit.getByRole('button', { name: 'Commit', exact: true }).click();
  await commit.locator('[data-output]').waitFor({ timeout: 5_000 });
  await commit.getByText(/^Committed 1 file as [0-9a-f]{7}\./).waitFor({ timeout: 15_000 });
  const output = await commit.locator('[data-output]').innerText();
  const sentCommit = calls(mark, 'git.commit')[0]?.params;
  await shots('commit-output');
  check(
    'projects: a commit of one chosen hunk — the selection and expect sent, the hook’s output streamed into a live region',
    checkedLine === '1 file checked, 1 chunk' &&
      hooksLine.includes('pre-commit') &&
      output.includes('pre-commit: passed') &&
      JSON.stringify(sentCommit?.selection) === JSON.stringify([{ path: 'src/app.txt', chunks: [1] }]) &&
      sentCommit?.runHooks === true &&
      /^[0-9a-f]{40}$/.test(sentCommit?.expect?.headSha ?? '') &&
      sentCommit?.expect?.files?.[0]?.path === 'src/app.txt' &&
      (await commit.locator('[data-output]').getAttribute('role')) === 'log',
    `${checkedLine}; ${hooksLine}; ${JSON.stringify(sentCommit?.selection)}; ${output.replace(/\n/g, ' / ')}`,
  );

  // ---- undo the commit ---------------------------------------------------------------------------------------------
  await commit.getByRole('button', { name: 'Undo last commit' }).click();
  await commit.getByText('The last commit is undone; its changes are back.').waitFor({ timeout: 10_000 });
  const back = await commit.getByPlaceholder('Commit message').inputValue();
  await shots('undo-commit');
  check(
    'projects: «Undo last commit» (offered for the commit this page made) undoes it; the message comes back',
    back === 'Change line 15 only' && calls(mark, 'git.undoCommit').length === 1,
    back,
  );

  // ---- hooks off ---------------------------------------------------------------------------------------------------
  await commit.getByRole('checkbox', { name: 'Run Git hooks' }).click();
  const skipsLine = await commit.getByText(/^Skips pre-commit and commit-msg/).innerText();
  const appBox = commit.getByRole('checkbox', { name: 'src/app.txt', exact: true });
  if ((await appBox.getAttribute('data-state')) !== 'checked') await appBox.click();
  if ((await appBox.getAttribute('data-state')) !== 'checked') await appBox.click();
  mark = logOf().length;
  await commit.getByRole('button', { name: 'Commit', exact: true }).click();
  const skipped = await commit
    .getByText(/^Committed 1 file as [0-9a-f]{7}\. Skipped: pre-commit\./)
    .innerText({ timeout: 15_000 });
  const hooksAgain = await commit.getByRole('checkbox', { name: 'Run Git hooks' }).getAttribute('data-state');
  check(
    'projects: «Run Git hooks» unchecked says what it skips, commits with runHooks:false (hooksSkipped said), and is on again after',
    skipsLine.length > 0 && calls(mark, 'git.commit')[0]?.params.runHooks === false && hooksAgain === 'checked',
    `${skipped}; after: ${hooksAgain}`,
  );

  // ---- every commit error of §6.1–§6.8 -------------------------------------------------------------------------------
  const errors = [
    [
      'hook-failed',
      { hook: 'pre-commit', exitCode: 1, output: 'lint: 1 problem\n' },
      ['lint: 1 problem\n'],
      'pre-commit failed. Nothing was committed.',
    ],
    [
      'hook-tool-missing',
      { hook: 'pre-commit', tool: 'npx', output: 'npx: command not found\n', pathCapturedAt: null },
      ['pre-commit: npx: command not found\n'],
      'pre-commit did not find npx',
    ],
    ['hook-timeout', { hook: 'pre-commit', afterMs: 300_000 }, ['pre-commit: running\n'], 'ran longer than 5 minutes'],
    ['signing-failed', { output: 'error: gpg failed to sign the data\n' }, [], 'Signing the commit failed.'],
    ['index-locked', undefined, [], 'Another git holds the repository’s lock file'],
    ['operation-in-progress', { operation: 'rebase' }, [], 'A rebase is in progress in this repository.'],
    ['stale-selection', { paths: ['src/app.txt'] }, [], 'Files changed since they were shown.'],
    ['stale-selection', { paths: [] }, [], 'The repository moved on since the changes were shown.'],
    [
      'hunks-unsupported',
      { reason: 'not-utf8', path: 'latin1.txt' },
      [],
      'latin1.txt can only be committed whole: it is not UTF-8.',
    ],
    ['nothing-selected', undefined, [], 'Nothing to commit: the checked files hold no change against HEAD.'],
    ['identity-missing', undefined, [], 'Git has no name or e-mail for commits.'],
    [
      'rate-limited',
      { retryAfterMs: 2_000 },
      [],
      'Another git operation is running in this project. Try again in 2 s.',
    ],
    ['not-mine', undefined, [], 'The project is read only.'],
    ['internal', undefined, [], 'The companion failed.'],
  ];
  const commitErrors = [];
  // A file still changed after the commits above; a failed commit leaves it so.
  const readme = commit.getByRole('checkbox', { name: 'docs/readme.md', exact: true });
  await commit.getByPlaceholder('Commit message').fill('Try the errors');
  for (const [code, data, stream, words] of errors) {
    if ((await readme.getAttribute('data-state')) !== 'checked') await readme.click();
    command({ failNext: { method: 'git.commit', code, data, stream, pauseMs: 120 } });
    await settle();
    await commit.getByRole('button', { name: 'Commit', exact: true }).click();
    const note = said(commit, code);
    await note.waitFor({ timeout: 10_000 });
    const text = await note.innerText();
    const streamed = stream.length ? await commit.locator('[data-output]').innerText() : '';
    const keptMessage = await commit.getByPlaceholder('Commit message').inputValue();
    commitErrors.push([
      code,
      text.includes(words) && keptMessage === 'Try the errors' && stream.every(s => streamed.includes(s.trim())),
      text.replace(/\s+/g, ' '),
    ]);
    if (code === 'hook-failed') await shots('commit-hook-failed');
    if (code === 'hook-tool-missing') await shots('commit-tool-missing');
  }
  check(
    'projects: every commit error is its own plain text with what to do; the hook’s output streamed; the message kept',
    commitErrors.every(([, ok]) => ok),
    commitErrors
      .filter(([, ok]) => !ok)
      .map(([c, , t]) => `${c}: ${t}`)
      .join(' | ') || `${commitErrors.length} errors`,
  );

  // ---- a commit cancelled while its hook runs --------------------------------------------------------------------------
  command({
    failNext: {
      method: 'git.commit',
      code: 'hook-timeout',
      data: { afterMs: 1 },
      stream: ['slow hook\n'],
      hang: true,
      pauseMs: 100,
    },
  });
  await settle();
  mark = logOf().length;
  await commit.getByRole('button', { name: 'Commit', exact: true }).click();
  await commit.getByRole('button', { name: 'Cancel', exact: true }).click({ timeout: 5_000 });
  const cancelled = await said(commit, 'cancelled').innerText({ timeout: 10_000 });
  await sleep(300);
  check(
    'projects: Cancel stops a running commit — the `cancel` frame sent, «cancelled, nothing committed»',
    cancelled.includes('cancelled') &&
      logOf()
        .slice(mark)
        .some(r => r.event === 'in' && r.type === 'cancel'),
    cancelled,
  );

  // ---- identity missing: Commit inactive with the command ------------------------------------------------------------
  command({ identity: null });
  await settle();
  await commit.getByRole('button', { name: 'Refresh' }).click();
  await commit.locator('[data-said="identity"]').waitFor({ timeout: 10_000 });
  const identityCommand = await commit.locator('[data-said="identity"] [data-command]').innerText();
  command({ identity: { name: 'Fixture Person', email: 'person@example.invalid' } });
  await settle();
  check(
    'projects: git without a name or e-mail — Commit inactive, the command to set them',
    identityCommand.startsWith('git config --global user.email'),
    identityCommand,
  );

  // ---- rollback: no Trash, the line instead of «Delete local copies»; a file back to HEAD ------------------------------
  await commit.getByRole('button', { name: 'Refresh' }).click();
  await commit.getByRole('group', { name: 'Changes' }).waitFor({ timeout: 10_000 });
  for (const group of ['Changes', 'Unversioned Files']) {
    const box = commit.getByRole('checkbox', { name: group, exact: true });
    if ((await box.count()) && (await box.getAttribute('data-state')) !== 'unchecked') {
      await box.click();
      if ((await box.getAttribute('data-state')) !== 'unchecked') await box.click();
    }
  }
  await commit.getByRole('checkbox', { name: 'docs/readme.md', exact: true }).click();
  await commit.getByRole('button', { name: 'Rollback…' }).click();
  const rollback = page.getByRole('dialog', { name: 'Rollback' });
  const noTrashLine = await rollback.locator('[data-no-trash]').innerText();
  const deleteBox = await rollback.getByRole('checkbox').count();
  await shots('rollback');
  mark = logOf().length;
  await rollback.getByRole('button', { name: 'Rollback', exact: true }).click();
  await said(commit, 'rolled-back').waitFor({ timeout: 10_000 });
  await commit
    .getByRole('checkbox', { name: 'docs/readme.md', exact: true })
    .waitFor({ state: 'detached', timeout: 10_000 });
  const sentRollback = calls(mark, 'git.rollback')[0]?.params;
  check(
    'projects: Rollback — the files, no «Delete local copies» without a Trash (one line why); the file leaves the changes',
    deleteBox === 0 &&
      noTrashLine.includes('added files stay on disk') &&
      JSON.stringify(sentRollback?.paths) === '["docs/readme.md"]' &&
      sentRollback?.deleteAdded === false,
    `${noTrashLine}; ${JSON.stringify(sentRollback)}`,
  );

  // ---- an older companion (stage 3): reads, and every write inactive ----------------------------------------------------
  setMode({ mode: 'normal', methods: 'stage3' });
  command({ exit: true });
  await page.waitForFunction(
    () => document.querySelector('.kit-projects')?.getAttribute('data-connection') === 'reconnecting',
    null,
    {
      timeout: 10_000,
    },
  );
  await waitState(page, 'ready');
  mark = logOf().length;
  await openOld();
  async function openOld() {
    await go(`#/projects/${PROJECT}/src%2Fapp.txt`);
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    // The file itself (the Commit view may have left the editor on its diff).
    const fileMode = page.getByRole('radio', { name: 'File', exact: true });
    if ((await fileMode.count()) && (await fileMode.getAttribute('aria-checked')) !== 'true') await fileMode.click();
    await page
      .locator('.kit-projects-editor-bar')
      .getByText('This companion cannot do this yet.')
      .waitFor({ timeout: 10_000 });
  }
  const old = {
    makeView: await page.getByRole('button', { name: 'Make read only' }).isDisabled(),
    newFile: await page.getByRole('button', { name: 'New file…', includeHidden: true }).isDisabled(),
    folders: await go('#/projects').then(() =>
      page
        .getByText('This companion does not list trusted folders yet.')
        .waitFor({ timeout: 10_000 })
        .then(
          () => true,
          () => false,
        ),
    ),
    add: await page.getByRole('button', { name: /^Add project/ }).isDisabled(),
  };
  await go(`#/projects/${PROJECT}`);
  await showCommit();
  const oldLine = await commit.locator('[data-read-only]').innerText({ timeout: 10_000 });
  const writes = calls(mark).filter(r =>
    [
      'locations.list',
      'project.requestAdd',
      'project.requestMine',
      'project.setView',
      'project.remove',
      'file.save',
      'file.create',
      'folder.create',
      'file.rename',
      'git.commit',
      'git.rollback',
      'git.undoCommit',
      'git.messages',
    ].includes(r.method),
  );
  await shots('older-companion');
  check(
    'projects: an older companion (stage-3 welcome) still reads; the editor read only and every write inactive with why; none sent',
    old.makeView &&
      old.newFile &&
      old.folders &&
      old.add &&
      oldLine.includes('cannot commit yet') &&
      writes.length === 0,
    `${JSON.stringify(old)}; ${oldLine}; sent: ${writes.map(w => w.method).join(', ')}`,
  );
  setMode({ mode: 'normal' });
  command({ exit: true });
  await page.waitForFunction(
    () => document.querySelector('.kit-projects')?.getAttribute('data-connection') === 'reconnecting',
    null,
    {
      timeout: 10_000,
    },
  );
  await waitState(page, 'ready');
};
