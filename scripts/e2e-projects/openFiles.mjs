// «Projects»: files opened from the system (D42, step O2), in the built extension against the fake host (./fake-host.mjs,
// the scripted companion of ./companion.mjs with `openFiles` — its part ./openFileMethods.mjs), run by
// scripts/e2e-projects.mjs. A companion without the methods first: no «Files» group, an address with a token says one
// sentence and nothing of the methods is sent. Then a companion that offers them: no group while nothing was opened,
// the page's activity told; a file arriving by the event `open.requested` (its own address, the editor, saved by itself);
// a conflict and «Keep mine»; read-only reasons (a secret) and «runs on its own»; the group with its marks, the command
// (Pro) and «Forget»; a file arriving by the address (the token gone from the address and from the history); an
// expired token; a file inside an added project opening as the project's. `runOpenedFilesFree` repeats the arrival
// in the free build (DEVTAB_VARIANT=edition:fixedFree), loaded next to the store build in the same browser: the file
// read only with one quiet line, «Copy to a scratch», no command. Screenshots light and dark, wide and narrow.

/* global document, location, chrome -- page.evaluate callbacks run in the page */

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const PROJECT = 'p_abcdefgh23';
const HOST_NAME = 'dev.devtab.companion';

/** The four looks of one state: light and dark, wide and narrow. */
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
    await shoot(page, `open-files-${name}-${scheme}-${width === 1440 ? 'wide' : 'narrow'}.png`);
  }
  await page.emulateMedia({ colorScheme: 'light' });
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(200);
};

/** A token in the contract's shape (32 lowercase hexadecimal characters), apart from the scripted companion's own. */
const token = n => `ee${n.toString(16).padStart(30, '0')}`;

export const runCompanionOpenedFiles = async ({
  page,
  base,
  check,
  shoot,
  sleep,
  command,
  logOf,
  setMode,
  waitState,
}) => {
  const shots = shotsOf(page, shoot, sleep);
  const calls = (from, method) =>
    logOf()
      .slice(from)
      .filter(r => r.event === 'in' && r.type === 'call' && (!method || r.method === method));
  const frame = page.locator('iframe.kit-projects-frame');
  const group = page.getByRole('region', { name: 'Files' });
  const arrival = page.locator('[data-arrival]');
  const waitSave = (state, timeout = 15_000) =>
    page.waitForFunction(w => document.querySelector('.kit-projects-save')?.getAttribute('data-state') === w, state, {
      timeout,
    });
  const go = async hash => {
    await page.evaluate(h => (location.hash = h), hash);
    await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
    await waitState(page, 'ready');
  };
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
  const fileOpened = async name => {
    await page.waitForFunction(() => location.hash.startsWith('#/projects/files/'), null, { timeout: 15_000 });
    await page.getByRole('heading', { name, level: 1 }).waitFor({ timeout: 15_000 });
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await page.waitForFunction(
      () => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown) > 0,
      null,
      {
        timeout: 45_000,
      },
    );
  };
  const typeInEditor = async keys => {
    const box = await frame.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 20);
    for (const key of ['End', ...keys]) await page.keyboard.press(key);
  };

  // ---- a companion without the methods: nothing shown, nothing sent ----------------------------------------------
  await freshHost({ mode: 'normal' });
  let mark = logOf().length;
  await go('#/projects');
  await page.getByRole('region', { name: 'Scratches' }).waitFor({ timeout: 10_000 });
  await page.goto(`${base}#/projects/open/${token(1)}`);
  await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
  await arrival.waitFor({ timeout: 15_000 });
  const notOffered = await arrival.innerText();
  check(
    'open files: a companion without `openFile.*` — no «Files» group; an address with a token says one sentence; none of the methods sent',
    notOffered === 'This companion cannot open files from your computer yet.' &&
      (await group.count()) === 0 &&
      !(await page.evaluate(() => location.hash.includes('/open/'))) &&
      calls(mark).every(c => !c.method.startsWith('openFile.') && c.method !== 'page.activity'),
    notOffered,
  );
  await shoot(page, 'open-files-not-offered.png');

  // ---- a companion that offers them: no group yet, the page's activity told ------------------------------------
  await freshHost({ mode: 'normal', openFiles: true });
  await go('#/projects');
  await page.getByRole('region', { name: 'Scratches' }).waitFor({ timeout: 10_000 });
  await sleep(500);
  check(
    'open files: offered, nothing ever opened → no «Files» group; the list asked, the page’s visibility and focus told',
    (await group.count()) === 0 &&
      calls(mark, 'openFile.list').length > 0 &&
      calls(mark, 'page.activity').some(c => typeof c.params?.visible === 'boolean'),
    JSON.stringify(calls(mark, 'page.activity').at(-1)?.params),
  );

  // ---- by the event: claimed, its own address, editable, saved by itself -----------------------------------------
  mark = logOf().length;
  command({
    openFile: { name: 'todo.md', displayPath: '~/notes/todo.md', text: '# Todo\n\n- one\n', line: 2, emit: true },
  });
  await fileOpened('todo.md');
  await waitSave('saved');
  const bar = await page.locator('.kit-projects-bar').innerText();
  check(
    'open files: `open.requested` → claimed once, opened on #/projects/files/<id> with its name and ~/ path, editable',
    calls(mark, 'openFile.claim').length === 1 && bar.includes('~/notes/todo.md') && bar.includes('File'),
    bar.replace(/\s+/g, ' '),
  );
  await shots('editor');
  await typeInEditor([' ', 'x']);
  for (let waited = 0; calls(mark, 'openFile.save').length === 0 && waited < 10_000; waited += 100) await sleep(100);
  await waitSave('saved');
  const saves = calls(mark, 'openFile.save');
  check(
    'open files: an edit saves itself through `openFile.save` from the version read',
    saves.length >= 1,
    `${saves.length}`,
  );

  // ---- a conflict: changed on disk under an edit ---------------------------------------------------------------
  const fileId = await page.evaluate(() => decodeURIComponent(location.hash.split('/')[3]));
  command({ changeOpenedOnDisk: { file: fileId, text: 'changed outside\n' } });
  await sleep(300);
  mark = logOf().length;
  await typeInEditor(['y']);
  await waitSave('conflict');
  const conflict = await page.getByRole('alert').innerText();
  await shots('conflict');
  await page.getByRole('button', { name: 'Keep mine' }).click();
  await waitSave('saved');
  check(
    'open files: changed on disk under an edit → the conflict and its three choices; «Keep mine» writes over',
    conflict.includes('The file changed on disk') && calls(mark, 'openFile.save').length >= 2,
    conflict.replace(/\s+/g, ' '),
  );

  // ---- replaced since it was opened: the save refused, read only from then on ---------------------------------------
  await sleep(700);
  command({ replaceOpened: { file: fileId } });
  await sleep(300);
  await typeInEditor(['z']);
  const replacedNote = page.locator('[data-read-only]');
  await replacedNote.waitFor({ timeout: 15_000 });
  const replaced = await replacedNote.innerText();
  check(
    'open files: a file replaced since it was opened — the save refused (`not-editable`), read only from then on, «Copy to a scratch» offered',
    replaced.startsWith('Read only: the file was replaced') &&
      (await page.getByRole('button', { name: 'Copy to a scratch' }).count()) === 1 &&
      (await page.locator('.kit-projects-save').count()) === 0,
    replaced,
  );
  await shots('replaced');

  // ---- read-only reasons and the mark «runs on its own» ------------------------------------------------------------
  command({
    openFile: {
      name: 'id_ed25519',
      displayPath: '~/.ssh/id_ed25519',
      reason: 'secret',
      text: 'dummy\n',
      emit: true,
    },
  });
  await fileOpened('id_ed25519');
  const secret = await page.locator('[data-read-only]').innerText();
  check(
    'open files: a file the companion keeps read only says why (a secret); no save state',
    secret === 'Read only: this file holds secrets.' && (await page.locator('.kit-projects-save').count()) === 0,
    secret,
  );
  await shots('read-only');
  command({
    openFile: {
      name: '.zshrc',
      displayPath: '~/.zshrc',
      executes: true,
      text: 'export A=1\n',
      via: 'open-with',
      emit: true,
    },
  });
  await fileOpened('.zshrc');
  const executes = await page.locator('.kit-projects-bar [data-mark="executes"]').innerText();
  check('open files: a file that runs on its own is marked and editable', executes === 'runs on its own', executes);

  // ---- the group: marks, the command (Pro), the settings, Forget ---------------------------------------------------
  await go('#/projects');
  await group.waitFor({ timeout: 10_000 });
  const rows = await group.getByRole('listitem').allInnerTexts();
  const command_ = await group.locator('[data-command-hint]').innerText();
  await shots('group');
  mark = logOf().length;
  await group.getByRole('button', { name: 'Forget todo.md' }).click();
  const forgetDialog = page.getByRole('dialog', { name: 'Forget todo.md?' });
  const forgetBody = await forgetDialog.innerText();
  await forgetDialog.getByRole('button', { name: 'Forget', exact: true }).click();
  await page.waitForFunction(() => document.querySelectorAll('.kit-projects-opened').length === 2, null, {
    timeout: 10_000,
  });
  check(
    'open files: the «Files» group lists name, ~/ path and marks; Pro names `devtab open <file>`; «Forget» asks (the companion’s copies go too) and removes one',
    rows.length === 3 &&
      rows.some(r => r.includes('id_ed25519') && r.includes('read only')) &&
      rows.some(r => r.includes('.zshrc') && r.includes('runs on its own')) &&
      command_.includes('devtab open <file>') &&
      forgetBody.includes('deletes the copies') &&
      calls(mark, 'openFile.forget').length === 1,
    rows.map(r => r.replace(/\s+/g, ' ')).join(' | '),
  );

  // ---- by the address: the token leaves the address and the history ----------------------------------------------
  mark = logOf().length;
  command({ openFile: { token: token(2), name: 'notes.txt', displayPath: '~/notes.txt', text: 'a\nb\nc\n', line: 2 } });
  await sleep(300);
  await page.goto(`${base}#/projects/open/${token(2)}`);
  await fileOpened('notes.txt');
  const afterClaim = await page.evaluate(() => location.href);
  await page.goBack();
  await sleep(500);
  const back = await page.evaluate(() => location.href);
  check(
    'open files: #/projects/open/<token> → claimed once, the file opens; the token is in neither the address nor the history',
    calls(mark, 'openFile.claim').length === 1 && !afterClaim.includes(token(2)) && !back.includes(token(2)),
    `${afterClaim.slice(afterClaim.indexOf('#'))} ← back: ${back.slice(back.indexOf('#'))}`,
  );

  // ---- an expired token -------------------------------------------------------------------------------------------
  command({ openFile: { token: token(3), name: 'late.txt' } });
  command({ expireTokens: true });
  await sleep(300);
  await page.goto(`${base}#/projects/open/${token(3)}`);
  await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
  await arrival.waitFor({ timeout: 15_000 });
  const expired = await arrival.innerText();
  check(
    'open files: an expired token says so in one sentence; nothing opens',
    expired.startsWith('The link to this file has expired') &&
      (await page.evaluate(() => location.hash)) === '#/projects',
    expired,
  );
  await shots('expired');

  // ---- a file inside an added project opens as the project's ---------------------------------------------------------
  command({ openFile: { project: PROJECT, path: 'src/app.txt', emit: true } });
  await page.waitForFunction(h => location.hash === h, `#/projects/${PROJECT}/src%2Fapp.txt`, { timeout: 15_000 });
  check('open files: a file inside an added project opens as that project’s file', true);
  await go('#/projects');
};

/**
 * The free edition: built from the same sources with the edition's root reading `fixedFree`, loaded next to the store
 * build in the same browser (the fake host allows both), the permission granted the way this e2e grants it.
 */
export const runOpenedFilesFree = async ({
  ctx,
  cdp,
  root,
  profile,
  wrapper,
  storeId,
  check,
  shoot,
  sleep,
  command,
  setMode,
}) => {
  const freeDist = join(root, '.state/e2e/dist-free-open');
  const built = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: join(root, 'extension'),
    env: { ...process.env, CLI_CEB_DEV: 'false', DEVTAB_VARIANT: 'edition:fixedFree', DEVTAB_OUT_DIR: freeDist },
    encoding: 'utf8',
    timeout: 600_000,
  });
  writeFileSync(join(root, '.state/e2e/free-open-build.log'), `${built.stdout ?? ''}\n${built.stderr ?? ''}`);
  if (!check('open files (free): the free edition builds', built.status === 0, `exit ${built.status}`)) return;
  const ext = join(root, '.state/e2e/projects-ext-free');
  rmSync(ext, { recursive: true, force: true });
  cpSync(freeDist, ext, { recursive: true });
  const manifestText = readFileSync(join(ext, 'manifest.json'), 'utf8');
  const manifest = JSON.parse(manifestText);
  const load = async () => (await cdp.send('Extensions.loadUnpacked', { path: ext })).id;
  writeFileSync(
    join(ext, 'manifest.json'),
    JSON.stringify({
      ...manifest,
      permissions: [...manifest.permissions, 'nativeMessaging'],
      optional_permissions: manifest.optional_permissions.filter(p => p !== 'nativeMessaging'),
    }),
  );
  await load();
  writeFileSync(join(ext, 'manifest.json'), manifestText);
  const id = await load();
  mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
  writeFileSync(
    join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`),
    JSON.stringify({
      name: HOST_NAME,
      description: 'fake companion for the e2e',
      path: wrapper,
      type: 'stdio',
      allowed_origins: [`chrome-extension://${storeId}/`, `chrome-extension://${id}/`],
    }),
  );
  setMode({ mode: 'normal', openFiles: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  const shots = shotsOf(page, shoot, sleep);
  try {
    await page.goto(`chrome-extension://${id}/src/app/index.html#/projects`);
    await page.waitForFunction(
      () => document.querySelector('.kit-projects')?.getAttribute('data-connection') === 'ready',
      null,
      {
        timeout: 20_000,
      },
    );
    command({ openFile: { name: 'todo.md', displayPath: '~/notes/todo.md', text: '# Todo\n\n- one\n', emit: true } });
    await page.waitForFunction(() => location.hash.startsWith('#/projects/files/'), null, { timeout: 15_000 });
    await page.getByRole('heading', { name: 'todo.md', level: 1 }).waitFor({ timeout: 15_000 });
    const frame = page.locator('iframe.kit-projects-frame');
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await page.waitForFunction(
      () => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown) > 0,
      null,
      {
        timeout: 45_000,
      },
    );
    const line = await page.locator('[data-free-line]').innerText();
    check(
      'open files (free): the file opens read only — one quiet line, «Copy to a scratch», no save state',
      line === 'Editing files opened from your computer is part of Pro.' &&
        (await page.getByRole('button', { name: 'Copy to a scratch' }).count()) === 1 &&
        (await page.locator('.kit-projects-save').count()) === 0,
      line,
    );
    await shots('free-editor');
    await page.getByRole('button', { name: 'Copy to a scratch' }).click();
    await page.waitForFunction(() => location.hash.startsWith('#/projects/scratches/'), null, { timeout: 15_000 });
    await page.getByRole('heading', { name: 'todo.md', level: 1 }).waitFor({ timeout: 15_000 });
    const kept = await page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      return Object.entries(all)
        .filter(([k]) => k.startsWith('scratch:'))
        .map(([, v]) => v);
    });
    check(
      'open files (free): «Copy to a scratch» makes an editable scratch with the file’s name and text',
      kept.some(v => typeof v === 'string' && v.includes('# Todo')) ||
        kept.some(v => JSON.stringify(v).includes('# Todo')),
      JSON.stringify(kept).slice(0, 80),
    );
    await page.evaluate(() => (location.hash = '#/projects'));
    const group = page.getByRole('region', { name: 'Files' });
    await group.waitFor({ timeout: 10_000 });
    check(
      'open files (free): the «Files» group lists the file and names no command',
      (await group.getByRole('listitem').count()) === 1 && (await group.locator('[data-command-hint]').count()) === 0,
    );
    await shots('free-group');
  } finally {
    await page.close();
  }
  check('open files (free): no console error or page error', errors.length === 0, errors.join(' | '));
};
