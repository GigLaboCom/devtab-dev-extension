// «Projects» with a companion, in the built extension (the companion's specification §11.4, stage 3, row 3.5): the
// store build's manifest as it is — `nativeMessaging` optional —, a fake Native Messaging host speaking the contract
// (scripts/e2e-projects/fake-host.mjs, seeded from the contract's vectors), and every state of §8.5 this stage reaches:
//   no permission → the demo with «Connect the companion»; the permission granted → not installed (no host); not running
//   and its retry every 5 s; another API version; no project; ready — the tree (ignored dimmed, the secret marked, a
//   link out of the project not opened), a file, find in files and its cancel, the changes, a diff, the history, an event
//   that reads the tree again, a long answer in pieces (a folder of 5000 names, a 2 MiB file); the port lost →
//   reconnecting → back; the installation's number each `hello` says (./e2e-projects/install.mjs, the companion's step
//   O3); the server restarted; the repository's strings (HTML, a terminal's escape sequences) drawn as
//   text (З3, S17); the address never triggers an action (F6); then stages 4–6 (./e2e-projects/writes.mjs: trusted
//   folders, adding, classes, saving, conflicts, the write policy's refusals, committing, its errors, undo, rollback,
//   and an older companion with every write inactive) and stage 7 (./e2e-projects/history.mjs: the history, restore and
//   its undo, the gap, deleted files, clearing, «Open in Compare code» saving back, an older companion) and files opened
//   from the system (./e2e-projects/openFiles.mjs, D42 step O2: a companion without the methods, the event, the address
//   and its token, a conflict, read-only reasons, the «Files» group, an expired token, a project's file); the permission
//   removed → the page closes its port, and a file that arrives waits beside «Connect the companion»; «Connect the
//   companion» → connected again; then the free build's opened file (read only, «Copy to a scratch») and its own
//   installation's number.
//
// The browser is its own: Chrome for Testing without a window and a throwaway profile under .state/e2e/, the extension
// loaded by CDP (Extensions.loadUnpacked) from a copy of the build. The host's manifest goes only into that profile's
// NativeMessagingHosts/ (Chrome looks there, spikes/extension-e2e finding 5) — never into the person's folders.
//
// The permission: Chrome's prompt cannot be answered without a person (finding 8). The copy is installed once with
// `nativeMessaging` required (granted at install), then reloaded as built (optional) — Chrome keeps the grant, so the
// permission is optional and held, `permissions.remove` works, and a later request is granted without a prompt; the
// click path itself is the page's real one. A fresh install shows the not-granted state first.
//
// Run by scripts/e2e-check.mjs (`--only=projects`).

/* global document, window, chrome, MutationObserver -- page.evaluate callbacks run in the pages */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { HOSTILE_STRINGS, METHODS } from './e2e-projects/companion.mjs';
import { runCompanionHistory } from './e2e-projects/history.mjs';
import { SHAPE as INSTALL_SHAPE, installsOf, runCompanionInstall } from './e2e-projects/install.mjs';
import { runCompanionOpenedFiles, runOpenedFilesFree } from './e2e-projects/openFiles.mjs';
import { runCompanionWrites } from './e2e-projects/writes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '..');
const HOST_NAME = 'dev.devtab.companion';

export const runProjectsChecks = async ({ chromium, dist, check, shoot, report, sleep }) => {
  const result = (report.projects = { states: [] });
  const state = join(ROOT, '.state/e2e');
  mkdirSync(state, { recursive: true });
  const ext = join(state, 'projects-ext');
  rmSync(ext, { recursive: true, force: true });
  cpSync(dist, ext, { recursive: true });
  const built = readFileSync(join(ext, 'manifest.json'), 'utf8');
  const host = join(state, 'projects-host');
  rmSync(host, { recursive: true, force: true });
  mkdirSync(host, { recursive: true });
  const profile = mkdtempSync(join(state, 'projects-profile-'));

  // The fake host and how it is steered.
  const setMode = mode => writeFileSync(join(host, 'mode.json'), JSON.stringify({ hostile: true, big: true, ...mode }));
  let commands = 0;
  const command = c => writeFileSync(join(host, `cmd-${String(++commands).padStart(4, '0')}.json`), JSON.stringify(c));
  const logOf = () =>
    existsSync(join(host, 'log.jsonl'))
      ? readFileSync(join(host, 'log.jsonl'), 'utf8')
          .split('\n')
          .filter(Boolean)
          .map(line => JSON.parse(line))
      : [];
  const wrapper = join(host, 'host.sh');
  writeFileSync(
    wrapper,
    `#!/bin/sh\nDEVTAB_FAKE_HOST_DIR='${host}' exec '${process.execPath}' '${join(HERE, 'e2e-projects/fake-host.mjs')}' "$@"\n`,
    { mode: 0o755 },
  );
  setMode({ mode: 'normal' });

  const ctx = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: ['--enable-unsafe-extension-debugging', '--lang=en-US'],
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  const errors = [];
  try {
    const cdp = await ctx.browser().newBrowserCDPSession();
    const load = async () => (await cdp.send('Extensions.loadUnpacked', { path: ext })).id;
    const id = await load();
    const base = `chrome-extension://${id}/src/app/index.html`;
    const registerHost = () => {
      mkdirSync(join(profile, 'NativeMessagingHosts'), { recursive: true });
      writeFileSync(
        join(profile, 'NativeMessagingHosts', `${HOST_NAME}.json`),
        JSON.stringify({
          name: HOST_NAME,
          description: 'fake companion for the e2e',
          path: wrapper,
          type: 'stdio',
          allowed_origins: [`chrome-extension://${id}/`],
        }),
      );
    };

    const open = async hash => {
      const page = await ctx.newPage();
      page.on('console', m => m.type() === 'error' && errors.push(m.text()));
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto(`${base}${hash}`);
      await page.locator('.kit-projects').waitFor({ timeout: 15_000 });
      // Every state the section passes through.
      await page.evaluate(() => {
        window.__states = [];
        const note = () => {
          const value = document.querySelector('.kit-projects')?.getAttribute('data-connection');
          if (value && window.__states.at(-1) !== value) window.__states.push(value);
        };
        note();
        new MutationObserver(note).observe(document.body, { subtree: true, attributes: true, childList: true });
      });
      return page;
    };
    const connection = page => page.locator('.kit-projects').getAttribute('data-connection');
    const waitState = (page, wanted, timeout = 20_000) =>
      page.waitForFunction(
        w => document.querySelector('.kit-projects')?.getAttribute('data-connection') === w,
        wanted,
        {
          timeout,
        },
      );
    const statesOf = page => page.evaluate(() => window.__states);
    /** A panel's switch (D35): a toggle button of the panels' groups. */
    const switchOf = (page, name) =>
      page
        .locator('.kit-projects-switches')
        .getByRole('button', { name, exact: typeof name === 'string' })
        .and(page.locator('[aria-pressed]'));
    const bar = page => page.getByRole('group', { name: 'Companion' });
    const starts = () => logOf().filter(r => r.event === 'start').length;

    // ---- no permission: the demo ------------------------------------------------------------------------------------
    let page = await open('#/projects');
    await waitState(page, 'no-permission');
    const note = await page.getByRole('note').innerText();
    const connect = bar(page).getByRole('button', { name: 'Connect the companion' });
    check(
      'projects: without the permission, the demo with its notice and «Connect the companion»',
      note.includes('invented projects') && (await connect.isVisible()) && starts() === 0,
      note.slice(0, 60),
    );
    const optional = await page.evaluate(async () => ({
      held: await chrome.permissions.contains({ permissions: ['nativeMessaging'] }),
      connect: typeof chrome.runtime.connectNative,
    }));
    check(
      'projects: the store build’s nativeMessaging is optional and not granted at install',
      !optional.held && optional.connect === 'undefined',
      JSON.stringify(optional),
    );
    await shoot(page, 'projects-companion-no-permission.png');
    await page.close();

    // ---- the permission granted (installed once with it required, then as built) -------------------------------------
    const manifest = JSON.parse(built);
    const grant = async () => {
      writeFileSync(
        join(ext, 'manifest.json'),
        JSON.stringify({
          ...manifest,
          permissions: [...manifest.permissions, 'nativeMessaging'],
          optional_permissions: manifest.optional_permissions.filter(p => p !== 'nativeMessaging'),
        }),
      );
      await load();
      writeFileSync(join(ext, 'manifest.json'), built);
      await load();
    };
    await grant();

    // ---- not installed: no host's manifest yet --------------------------------------------------------------------------
    page = await open('#/projects');
    await waitState(page, 'not-installed');
    const notInstalled = await bar(page).innerText();
    check(
      'projects: granted, no host registered → «not installed», with Chrome’s words and «Check again»',
      notInstalled.includes('not installed') && notInstalled.includes('Check again'),
      notInstalled.replace(/\s+/g, ' '),
    );

    // ---- not running, tried again every 5 s ------------------------------------------------------------------------------
    setMode({ mode: 'not-running' });
    registerHost();
    await bar(page).getByRole('button', { name: 'Check again' }).click();
    await waitState(page, 'not-running');
    const firstStarts = starts();
    await sleep(11_000);
    const retried = starts() - firstStarts;
    const notRunning = await bar(page).innerText();
    check(
      'projects: the relay’s `not-running` → «not running», `devtab doctor`, tried again every 5 s by itself',
      notRunning.includes('devtab doctor') &&
        retried >= 2 &&
        retried <= 3 &&
        (await connection(page)) === 'not-running',
      `${retried} tries in 11 s; ${notRunning.replace(/\s+/g, ' ')}`,
    );
    await shoot(page, 'projects-companion-not-running.png');

    // ---- another version: the next automatic try meets it ------------------------------------------------------------
    setMode({ mode: 'version' });
    await waitState(page, 'version-mismatch', 8_000);
    const version = await bar(page).innerText();
    check(
      'projects: no API version in common → «version-mismatch», saying which side to update',
      version.includes('update the extension'),
      version.replace(/\s+/g, ' '),
    );

    // ---- connected, no project ---------------------------------------------------------------------------------------
    setMode({ mode: 'empty' });
    await bar(page).getByRole('button', { name: 'Check again' }).click();
    await waitState(page, 'ready-empty');
    const empty = await page.locator('.kit-projects-home').innerText();
    check(
      'projects: connected without a project → «ready-empty», saying how to add one',
      empty.includes('cd <project> && devtab add') && (await page.getByRole('note').count()) === 0,
      empty.replace(/\s+/g, ' ').slice(0, 120),
    );

    // ---- ready (the empty host's port is lost: the section wins it back from a host with projects) --------------------
    setMode({ mode: 'normal' });
    command({ exit: true });
    await waitState(page, 'ready');
    await page.getByRole('link', { name: /^repo/ }).waitFor({ timeout: 10_000 });
    const listed = await page.locator('.kit-projects-item-name').allInnerTexts();
    check(
      'projects: the companion’s projects listed; the lost port came back (reconnecting → ready)',
      listed.includes('repo') && (await statesOf(page)).includes('reconnecting'),
      `${listed.join(' | ')}; ${(await statesOf(page)).join(' → ')}`,
    );
    check(
      'projects: the hostile project’s name and branch are text, no element made from them (S17)',
      listed.includes(HOSTILE_STRINGS.name) &&
        (await page.evaluate(() => document.querySelectorAll('.kit-projects img, .kit-projects script').length)) ===
          0 &&
        (await page.evaluate(() => window.__pwned)) === undefined,
      listed.join(' | '),
    );
    await shoot(page, 'projects-companion-list.png');

    // ---- a project: its tree ------------------------------------------------------------------------------------------------
    await page.getByRole('link', { name: /^repo/ }).click();
    const tree = page.getByRole('tree', { name: 'Files' });
    await tree.locator('[data-path="src"]').waitFor({ timeout: 10_000 });
    const marks = {
      ignored: await tree.locator('[data-path="build"]').getAttribute('data-ignored'),
      secret: await tree.locator('[data-path=".env"] [data-mark="secret"]').count(),
      linkOut: await tree.locator('[data-path="link-out"]').isDisabled(),
      linkMark: await tree.locator('[data-path="link-out"] [data-mark="link"]').count(),
      git: await tree.locator('[data-path=".git"]').count(),
    };
    check(
      'projects: the tree — ignored dimmed, the secret marked, a link out of the project shown and not opened, no .git',
      marks.ignored === '' && marks.secret === 1 && marks.linkOut && marks.linkMark === 1 && marks.git === 0,
      JSON.stringify(marks),
    );

    // ---- a file ----------------------------------------------------------------------------------------------------------
    const frame = page.locator('iframe.kit-projects-frame');
    const shown = () => frame.evaluate(el => Number(el.dataset.shown ?? 0));
    const editorShows = (n, mode) =>
      page.waitForFunction(
        ([n, mode]) => {
          const el = document.querySelector('iframe.kit-projects-frame');
          return el && Number(el.dataset.shown ?? 0) > n && (!mode || el.dataset.mode === mode);
        },
        [n, mode],
        { timeout: 45_000 },
      );
    await tree.locator('[data-path="src"]').click();
    await tree.locator('[data-path="src/app.txt"]').click();
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await editorShows(0, 'file');
    await page.locator('.kit-projects-save[data-state="saved"]').waitFor({ timeout: 10_000 });
    const writable = await page.locator('.kit-projects-editor-bar').innerText();
    check(
      'projects: a file of a writable project opens in the editor, editable (saved by itself)',
      !writable.includes('Read only') && writable.includes('Saved'),
      writable.replace(/\s+/g, ' '),
    );

    // ---- its diff with HEAD ------------------------------------------------------------------------------------------------
    let n = await shown();
    await page.getByRole('radio', { name: 'Diff', exact: true }).click();
    await editorShows(n, 'diff');
    const changes = Number(await frame.getAttribute('data-changes'));
    check('projects: its diff with HEAD (diff.sides) shows the companion’s three hunks', changes === 3, `${changes}`);
    await shoot(page, 'projects-companion-diff.png');

    // ---- the changes --------------------------------------------------------------------------------------------------
    await switchOf(page, /^Commit/).click();
    const commit = page.getByRole('region', { name: 'Commit' });
    await commit.locator('.kit-projects-change').first().waitFor({ timeout: 10_000 });
    const groups = await commit.locator('.kit-projects-change-group-title').allInnerTexts();
    const files = await commit.locator('.kit-projects-change .kit-projects-row-name').allInnerTexts();
    check(
      'projects: the changes (git.status) in «Changes» and «Unversioned Files»',
      groups.includes('Changes') && groups.includes('Unversioned Files') && files.includes('src/app.txt'),
      `${groups.join(', ')}: ${files.join(', ')}`,
    );
    await commit.getByRole('button', { name: /^src\/app\.txt/ }).click();
    await commit.getByRole('group', { name: 'Chunks of src/app.txt' }).waitFor({ timeout: 10_000 });
    const chunks = await commit
      .getByRole('group', { name: 'Chunks of src/app.txt' })
      .locator('.kit-projects-chunk')
      .count();
    check('projects: a changed file’s hunks (git.hunks) listed', chunks === 3, `${chunks} chunks`);
    await shoot(page, 'projects-companion-commit.png');
    await switchOf(page, 'Files').click();
    await tree.locator('[data-path="src"]').waitFor({ timeout: 10_000 });

    // ---- find in files, and its cancel ---------------------------------------------------------------------------------
    await page.getByRole('button', { name: 'Find in files…', exact: true }).click();
    const field = page.getByRole('textbox', { name: 'Find in files' });
    await field.fill('line 0');
    await page.locator('.kit-projects-search-form').getByRole('button', { name: 'Find', exact: true }).click();
    const found = page.getByText(/^\d+ match(es)? in \d+ files?/);
    await found.waitFor({ timeout: 10_000 });
    check('projects: find in files streams the companion’s matches', true, await found.innerText());
    await field.fill('slow-search');
    await page.locator('.kit-projects-search-form').getByRole('button', { name: 'Find', exact: true }).click();
    await page.getByText('Searching…').waitFor({ timeout: 5_000 });
    await sleep(600);
    await page.getByRole('button', { name: 'Cancel', exact: true }).click();
    await page.getByText('Cancelled.').waitFor({ timeout: 5_000 });
    await sleep(500);
    const cancelSent = logOf().some(r => r.event === 'in' && r.type === 'cancel');
    check('projects: a search cancelled — the `cancel` frame sent, «Cancelled.» shown', cancelSent);

    // ---- history ---------------------------------------------------------------------------------------------------------
    await tree.locator('[data-path="docs"]').click();
    await tree.locator('[data-path="docs/readme.md"]').click();
    await page.getByRole('button', { name: 'Show history', exact: true }).click();
    const history = page.getByRole('region', { name: 'History' });
    await history.getByRole('listitem').first().waitFor({ timeout: 10_000 });
    const labels = await history.locator('.kit-projects-point-label').allInnerTexts();
    n = await shown();
    await history.getByRole('listitem').first().getByRole('button', { name: 'Compare with current' }).click();
    await editorShows(n, 'diff');
    await history.getByRole('radio', { name: 'Project' }).click();
    await history.getByRole('listitem').first().waitFor({ timeout: 10_000 });
    const projectLabels = await history.locator('.kit-projects-point-label').allInnerTexts();
    check(
      'projects: the history of a file (history.file) compared with the current file (diff.sides with a point); the project’s',
      labels.join('|') === 'External change|Second commit|First commit' && projectLabels.length > 0,
      `${labels.join(' | ')}; project: ${projectLabels.join(' | ')}`,
    );

    // ---- an event reads the tree again -------------------------------------------------------------------------------
    command({ addFile: { project: 'p_abcdefgh23', path: 'added-by-event.txt', text: 'new\n' } });
    command({
      event: { name: 'files.changed', project: 'p_abcdefgh23', data: { paths: ['added-by-event.txt'], more: false } },
    });
    await tree.locator('[data-path="added-by-event.txt"]').waitFor({ timeout: 10_000 });
    check('projects: `files.changed` reads the tree again (a new file appears)', true);

    // ---- the server restarted ------------------------------------------------------------------------------------------
    await page.evaluate(() => (window.__states = []));
    command({ event: { name: 'server.restarted', project: null, data: {} } });
    await page.waitForFunction(() => window.__states.includes('reconnecting'), null, { timeout: 10_000 });
    await waitState(page, 'ready');
    await tree.locator('[data-path="added-by-event.txt"]').waitFor({ timeout: 10_000 });
    check(
      'projects: `server.restarted` → reconnecting while it reads again → ready',
      true,
      (await statesOf(page)).join(' → '),
    );

    // ---- the port lost, won back ------------------------------------------------------------------------------------------
    await page.evaluate(() => (window.__states = []));
    const before = starts();
    command({ exit: true });
    await page.waitForFunction(() => window.__states.includes('reconnecting'), null, { timeout: 10_000 });
    await waitState(page, 'ready');
    await tree.locator('[data-path="src/app.txt"]').waitFor({ timeout: 10_000 });
    check(
      'projects: the port lost → «reconnecting» → a new port, everything read again',
      starts() === before + 1 && (await page.getByRole('note').count()) === 0,
      `${(await statesOf(page)).join(' → ')}; ${starts() - before} new host(s)`,
    );
    await shoot(page, 'projects-companion-project.png');

    // ---- the installation's number in `hello` (D42, the companion's step O3) --------------------------------------
    const install = await runCompanionInstall({
      page,
      origin: `chrome-extension://${id}/`,
      check,
      command,
      logOf,
      waitState,
    });

    // ---- the address shows, it does not act (F6) -----------------------------------------------------------------------
    const beforeAddresses = logOf().length;
    for (const hash of [
      '#/projects/p_abcdefgh23/src%2Fapp.txt%3Fsave%3D1',
      '#/projects/p_abcdefgh23/..%2F..%2Fetc%2Fhosts',
      '#/projects/p_abcdefgh23/commit',
      '#/projects/p_abcdefgh23/.git%2Fconfig',
    ]) {
      await page.goto(`${base}${hash}`);
      await page.locator('.kit-projects').waitFor({ timeout: 10_000 });
      await sleep(400);
    }
    // The reads of stage 3 and the two of stages 4–6 that change nothing (the trusted folders, the recent messages).
    const reads = [...METHODS, 'locations.list', 'git.messages'];
    const methods = [
      ...new Set(
        logOf()
          .filter(r => r.event === 'in' && r.type === 'call')
          .map(r => r.method),
      ),
    ];
    const fromAddresses = logOf()
      .slice(beforeAddresses)
      .filter(r => r.event === 'in' && r.type === 'call' && !reads.includes(r.method));
    check(
      'projects: the address never triggers an action — only reads were ever called, none from the addresses (F6)',
      methods.every(m => reads.includes(m)) && fromAddresses.length === 0,
      methods.join(', '),
    );

    // ---- the second project: a long answer in pieces, hostile strings ----------------------------------------------------
    await page.goto(`${base}#/projects/p_hostile001`);
    await tree.locator('[data-path="many"]').waitFor({ timeout: 15_000 });
    const chunkedBefore = logOf().filter(r => r.event === 'out' && r.type === 'chunk').length;
    await tree.locator('[data-path="many"]').click();
    const last = tree.locator('[data-path^="many/4999-"]');
    await last.waitFor({ timeout: 20_000 });
    const entries = await tree.locator('[data-path^="many/"]').count();
    const truncated = await tree.getByText('Not every entry is shown.').count();
    const chunkFrames = logOf().filter(r => r.event === 'out' && r.type === 'chunk').length - chunkedBefore;
    check(
      'projects: a folder answered in pieces (> 1 MiB) is joined whole: 5000 entries, the last one there, «not every entry»',
      entries === 5000 && truncated === 1 && chunkFrames >= 2,
      `${entries} entries, ${chunkFrames} chunk frames`,
    );
    n = await shown();
    await tree.locator('[data-path="large.txt"]').click();
    await editorShows(n, 'file');
    const largeFrames =
      logOf().filter(r => r.event === 'out' && r.type === 'chunk').length - chunkedBefore - chunkFrames;
    check(
      'projects: a 2 MiB file answered in pieces opens in the editor',
      largeFrames >= 2,
      `${largeFrames} chunk frames`,
    );
    const hostileTree = await tree.innerText();
    const branch = await page.locator('.kit-projects-bar-branch').innerText();
    await page.getByRole('button', { name: 'Find in files…', exact: true }).click();
    await page.getByRole('textbox', { name: 'Find in files' }).fill('hostile');
    await page.locator('.kit-projects-search-form').getByRole('button', { name: 'Find', exact: true }).click();
    await page.locator('.kit-projects-result-line').first().waitFor({ timeout: 10_000 });
    const line = await page.locator('.kit-projects-result-text').first().innerText();
    await tree.locator('[data-path="notes.txt"]').click();
    await page.getByRole('button', { name: 'Show history', exact: true }).click();
    const label = await page.locator('.kit-projects-point-label').first().innerText({ timeout: 10_000 });
    const injected = await page.evaluate(() => ({
      pwned: window.__pwned ?? null,
      elements: document.querySelectorAll('.kit-projects img, .kit-projects svg[onload], .kit-projects b').length,
      escapes: document.body.innerText.includes('\u001b'),
      links: [...document.querySelectorAll('.kit-projects a')].filter(a => a.href.includes('evil')).length,
    }));
    check(
      'projects: hostile file names, branch, history labels and lines are drawn as text; escape sequences as symbols (З3, S17)',
      hostileTree.includes(HOSTILE_STRINGS.file) &&
        branch === HOSTILE_STRINGS.branch &&
        line.includes('␛[31mhostile') &&
        label.includes('␛]8;;https://evil.invalid/␇click me') &&
        injected.pwned === null &&
        injected.elements === 0 &&
        !injected.escapes &&
        injected.links === 0,
      `${JSON.stringify(injected)}; ${line}; ${label}`,
    );
    await shoot(page, 'projects-companion-hostile.png');

    // ---- stages 4–6: classes, adding, writing files, committing (rows 4.5, 5.4, 6.5) ------------------------------------
    await runCompanionWrites({ page, check, shoot, sleep, command, logOf, setMode, waitState });

    // ---- stage 7: the local history, restore, clearing, «Open in Compare code» (row 7.5) ---------------------------
    await runCompanionHistory({ page, check, shoot, sleep, command, logOf, setMode, waitState });

    // ---- files opened from the system (D42, step O2) -----------------------------------------------------------------
    await runCompanionOpenedFiles({ page, base, check, shoot, sleep, command, logOf, setMode, waitState });

    // ---- the permission removed: the page closes its port ------------------------------------------------------------------
    const live = logOf()
      .filter(r => r.event === 'start')
      .at(-1).pid;
    await page.evaluate(() => chrome.permissions.remove({ permissions: ['nativeMessaging'] }));
    await waitState(page, 'no-permission');
    await page.getByRole('note').waitFor({ timeout: 10_000 });
    await sleep(1_000);
    const ended = logOf().some(r => r.pid === live && r.event === 'stdin-end');
    check(
      'projects: the permission removed → «no permission», the demo, and the page closed its port',
      ended,
      `host ${live}`,
    );
    // A file that arrives now waits beside «Connect the companion» (D42): the token leaves the address all the same.
    await page.goto(`${base}#/projects/open/ee0000000000000000000000000000ff`);
    const waiting = page.locator('[data-arrival]');
    await waiting.waitFor({ timeout: 10_000 });
    const waits = await waiting.innerText();
    check(
      'open files: without the permission a file waits — one sentence beside «Connect the companion», the token gone from the address',
      waits === 'A file waits to open here. Connect the companion to open it.' &&
        (await bar(page).getByRole('button', { name: 'Connect the companion' }).isVisible()) &&
        (await page.evaluate(() => window.location.hash)) === '#/projects',
      waits,
    );
    await shoot(page, 'open-files-waiting-permission.png');

    // ---- «Connect the companion»: the click asks Chrome; granted, the section connects -----------------------------------
    // Chrome's prompt has no answer here (finding 8): the click's request stays open, the page says Chrome asks.
    await bar(page).getByRole('button', { name: 'Connect the companion' }).click();
    const asked = await bar(page).getByText('Chrome asks whether to allow it.').isVisible();
    check(
      'projects: «Connect the companion» asks Chrome from the click (the prompt stays open without a person)',
      asked && (await connection(page)) === 'no-permission',
      await bar(page).innerText(),
    );
    result.states = await statesOf(page);
    await page.close();
    // The grant the person would give, given the way this e2e can: the section connects with it.
    await grant();
    page = await open('#/projects');
    const reconnected = await waitState(page, 'ready', 15_000).then(
      () => true,
      () => false,
    );
    check(
      'projects: granted again → the section connects and shows the companion’s projects',
      reconnected && (await page.getByRole('link', { name: /^repo/ }).count()) === 1,
      await connection(page),
    );
    await page.close();

    // ---- the free build's opened file (D42): read only, «Copy to a scratch» --------------------------------------------
    await runOpenedFilesFree({
      ctx,
      cdp,
      root: ROOT,
      profile,
      wrapper,
      storeId: id,
      check,
      shoot,
      sleep,
      command,
      setMode,
    });
    // The free build says its own number the same way (not a Pro feature).
    const free = installsOf(logOf).filter(h => h.origin !== null && h.origin !== `chrome-extension://${id}/`);
    check(
      'companion install (free): the free build’s page says a number of its own in `hello` too',
      free.length > 0 &&
        free.every(h => typeof h.install === 'string' && INSTALL_SHAPE.test(h.install)) &&
        new Set(free.map(h => h.install)).size === 1 &&
        free[0].install !== install,
      `${free.length} hellos, ${new Set(free.map(h => h.install)).size} number(s)`,
    );
  } finally {
    result.hostLog = logOf().length;
    await ctx.close();
    rmSync(profile, { recursive: true, force: true });
  }
  check('projects: no console error or page error', errors.length === 0, errors.join(' | '));
};
