// The editor's settings in the built extension with the rebuilt editor module (D39, stages 1a and 1b;
// extension/src/editorSettings/, src/app/editor/, src/app/settings/EditorSettingsGroup.tsx): Tab inserts what applies —
// in a scratch, in a project's file of the demo and on a side of «Compare code» (the text read back from the module,
// `viewer/read`); a Go file gets tabs and a YAML file two spaces by the built-in language rows; a file indented by four
// spaces is detected as four; the indent indicator says what applies and where it came from, and a choice made there
// wins for that file (one side of «Compare code» only) and goes back to automatic; a value changed in Settings → Editor
// (in another tab) reaches the open editor without a reload; a stored value survives a reload of both pages. Settings →
// Editor and the indicator with its popup in light and dark, wide and narrow, with nothing cut off; not one console
// error or page error. Screenshots where --shots says. Run by scripts/e2e-check.mjs (step `editor-settings`).
//
// Stages 2 and 3 (Pro, the default build): a profile made in Settings → Editor from the active one reaches the open
// scratch at once, switching follows at once, rename / duplicate / delete (asked first) and the stored record
// `editorProfiles`; Export saves a profile file, importing it adds a copy, a hostile file is refused in one line; a
// project's file chooses the project's own profile in its popup while a scratch keeps the active one; a demo project's
// `.editorconfig` (pixel-garden) decides a file's indentation — “EditorConfig”, the popup names the file, Tab follows it —
// a choice in the indicator still wins, and the `.editorconfig` edited in the demo's editor changes the next file.
// Then the free build (DEVTAB_VARIANT=edition:fixedFree) in a browser of its own: stages 1a/1b as before, the one line
// in Settings and the one in a project file's popup, no profiles' record and no `.editorconfig` read
// (`runFreeChecks`, below). Screenshots of the profiles, the EditorConfig popup and the free lines, light and dark, wide
// and narrow.

/* global document, location, chrome, addEventListener, removeEventListener -- page.evaluate callbacks run in the pages */

import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { themeMode } from './e2e-theme.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

// The store's record (extension/src/editorSettings/storage.ts) and the scratches' records (src/projects/scratch/).
const SETTINGS_KEY = 'editorSettings';
// The profiles' record (src/editorSettings/profilesStore.ts), read only by the Pro edition.
const PROFILES_KEY = 'editorProfiles';
const SCRATCHES = [
  { id: 's_edset0go00', name: 'tabs', language: 'go', text: '' },
  { id: 's_edset0yml0', name: 'two', language: 'yaml', text: '' },
  {
    id: 's_edset0ym40',
    name: 'four',
    language: 'yaml',
    text: 'a:\n    b: 1\n    c:\n        d: 2\n    e: 3\n    f: 4\n    g: 5\n',
  },
  { id: 's_edset0rs00', name: 'live', language: 'rust', text: '' },
];
const MOVE_TO_START = process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home';
const MOVE_TO_END = process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End';
const LINE_END = process.platform === 'darwin' ? 'Meta+ArrowRight' : 'End';

export const runEditorSettingsChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const errors = [];
  const result = (report.editorSettings = {});
  const watch = page => {
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(String(e)));
    return page;
  };
  const page = watch(await ctx.newPage());

  /** The text a side's editor holds now, asked as the page asks it (`viewer/read`). */
  const editorText = (target, frameClass, side = 'new') =>
    target.evaluate(
      ([frameClass, side]) =>
        new Promise((resolve, reject) => {
          const el = document.querySelector(`iframe.${frameClass}`);
          const asked = 800_000 + Math.floor(Math.random() * 1000);
          const on = event => {
            if (event.source !== el.contentWindow || event.data?.type !== 'viewer/text' || event.data.id !== asked)
              return;
            removeEventListener('message', on);
            resolve(event.data.text);
          };
          addEventListener('message', on);
          el.contentWindow.postMessage({ type: 'viewer/read', id: asked, side }, location.origin);
          setTimeout(() => reject(new Error('the editor did not answer')), 10_000);
        }),
      [frameClass, side],
    );
  const indicator = (target, scope = '') => target.locator(`${scope} button.kit-indent-indicator`.trim());
  const indentOf = async (target, scope) => {
    const button = indicator(target, scope);
    return {
      indent: await button.getAttribute('data-indent'),
      source: await button.getAttribute('data-source'),
      text: (await button.innerText()).replace(/\s+/g, ' ').trim(),
    };
  };
  /** Waits until the indicator in `scope` says `indent` (`space:2`). */
  const indicatorSays = (target, indent, scope = '', timeout = 10_000) =>
    target.waitForFunction(
      ([selector, indent]) => document.querySelector(selector)?.getAttribute('data-indent') === indent,
      [`${scope} button.kit-indent-indicator`.trim(), indent],
      { timeout },
    );
  const openScratch = async (target, scratch) => {
    await target.goto(`${base}#/projects/scratches/${scratch.id}`);
    const frame = target.locator('iframe.kit-projects-frame');
    await frame.and(target.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await target.waitForFunction(
      () => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown ?? 0) > 0,
      null,
      { timeout: 45_000 },
    );
    await indicator(target).waitFor({ timeout: 10_000 });
    return frame;
  };
  /**
   * Waits until a project's file named `path` is shown: its path in the bar, its text in the editor (the frame shows a
   * new text after the mark set before the address changed) and the indicator there.
   */
  const projectFileShown = async (target, path) => {
    await target.waitForFunction(
      path => {
        const frame = document.querySelector('iframe.kit-projects-frame');
        const shown = Number(frame?.dataset.shown ?? 0);
        const before = frame?.dataset.e2eBefore;
        return (
          document.querySelector('.kit-projects-editor-path')?.textContent === path &&
          frame?.dataset.mode === 'file' &&
          (before === undefined ? shown > 0 : shown > Number(before)) &&
          !!document.querySelector('button.kit-indent-indicator')
        );
      },
      path,
      { timeout: 45_000 },
    );
    await target.evaluate(() => {
      const frame = document.querySelector('iframe.kit-projects-frame');
      if (frame) frame.dataset.e2eBefore = frame.dataset.shown ?? '0';
    });
    await sleep(500);
  };
  const openProjectFile = async (target, project, path) => {
    await target.evaluate(() => {
      const frame = document.querySelector('iframe.kit-projects-frame');
      if (frame) frame.dataset.e2eBefore = frame.dataset.shown ?? '0';
    });
    await target.goto(`${base}#/projects/${project}/${path}`);
    await projectFileShown(target, path);
    return target.locator('iframe.kit-projects-frame');
  };
  /** Clicks into the editor, the caret to the start of the text, then the keys. */
  const pressIn = async (target, frame, keys, { start = true } = {}) => {
    const box = await frame.boundingBox();
    await target.mouse.click(box.x + box.width / 2, box.y + Math.min(60, box.height / 3));
    if (start) await target.keyboard.press(MOVE_TO_START);
    for (const key of keys) await target.keyboard.press(key);
    await sleep(300);
  };
  /**
   * Nothing of the page overflows sideways; no control or label is cut off (its text wider than its box). A switch is
   * left out: its larger press target (an `::after` past its edges) counts in its scroll width without being seen.
   */
  const fits = (target, selector) =>
    target.evaluate(selector => {
      const vw = document.documentElement.clientWidth;
      const outside = el => {
        const r = el.getBoundingClientRect();
        return r.left < -1 || r.right > vw + 1;
      };
      const parts = [...document.querySelectorAll(selector)];
      const clipped = [
        ...parts.filter(outside),
        ...parts
          .flatMap(part => [...part.querySelectorAll('button:not([role="switch"]), span, label, p, h2, h3, a')])
          .filter(el => el.getClientRects().length > 0 && !el.classList.contains('sr-only'))
          .filter(el => outside(el) || el.scrollWidth > el.clientWidth + 1),
      ].map(el => el.textContent.trim().slice(0, 40) || el.outerHTML.slice(0, 60));
      return { overflowX: document.documentElement.scrollWidth > vw + 1, clipped };
    }, selector);

  // ---- a clean start: nothing stored, the scratches of this step --------------------------------------------------
  await page.goto(`${base}#/settings`);
  await page.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
  await page.evaluate(
    async ([items, key]) => {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(
        Object.keys(all).filter(k => k === key || k === 'scratches' || k.startsWith('scratch:')),
      );
      const now = Date.now();
      await chrome.storage.local.set({
        scratches: {
          version: 1,
          lastLanguage: 'text',
          items: items.map(i => ({
            id: i.id,
            name: i.name,
            language: i.language,
            createdMs: now,
            updatedMs: now,
            chars: i.text.length,
          })),
        },
        ...Object.fromEntries(items.map(i => [`scratch:${i.id}`, i.text])),
      });
    },
    [SCRATCHES, SETTINGS_KEY],
  );

  // ---- built-in language rows: Go — tabs, YAML — two spaces; Tab inserts that in a scratch ------------------------
  let frame = await openScratch(page, SCRATCHES[0]);
  const go = await indentOf(page);
  await pressIn(page, frame, ['Tab']);
  const goText = await editorText(page, 'kit-projects-frame');
  result.goScratch = { ...go, text: goText };
  check(
    'editor settings: a Go scratch indents with a tab by the built-in Go row; the indicator says “Tab: 4 · Go”',
    go.indent === 'tab:4' && go.source === 'language' && go.text === 'Tab: 4 Go' && goText === '\t',
    JSON.stringify(result.goScratch),
  );

  frame = await openScratch(page, SCRATCHES[1]);
  const yaml = await indentOf(page);
  await pressIn(page, frame, ['Tab']);
  const yamlText = await editorText(page, 'kit-projects-frame');
  result.yamlScratch = { ...yaml, text: yamlText };
  check(
    'editor settings: a YAML scratch indents by two spaces by the built-in YAML row',
    yaml.indent === 'space:2' && yaml.source === 'language' && yamlText === '  ',
    JSON.stringify(result.yamlScratch),
  );

  // ---- detected: a file indented by four spaces is four, over YAML's two --------------------------------------------
  frame = await openScratch(page, SCRATCHES[2]);
  const four = await indentOf(page);
  await pressIn(page, frame, ['Tab']);
  const fourText = await editorText(page, 'kit-projects-frame');
  result.detected = { ...four, start: JSON.stringify(fourText.slice(0, 8)) };
  check(
    'editor settings: a file indented by four spaces is detected as four (the indicator: “detected”), and Tab inserts four',
    four.indent === 'space:4' && four.source === 'detected' && fourText.startsWith('    a:\n'),
    JSON.stringify(result.detected),
  );

  // ---- the indicator's choice wins for this file, then back to automatic -------------------------------------------
  frame = await openScratch(page, SCRATCHES[0]);
  // What the scratch holds now (the tab typed above, saved by itself).
  const startText = await editorText(page, 'kit-projects-frame');
  await indicator(page).click();
  const popup = page.getByRole('dialog', { name: 'Indentation of this file' });
  await popup.waitFor({ timeout: 5_000 });
  const said = await popup.locator('[data-slot="popover-description"]').innerText();
  await popup.getByRole('radio', { name: 'Spaces', exact: true }).click();
  await popup.getByRole('radio', { name: '8', exact: true }).click();
  await indicatorSays(page, 'space:8');
  const chosen = await indentOf(page);
  await sleep(300);
  await shoot(page, 'indicator-popup-light-wide.png');
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached', timeout: 5_000 });
  const focusBack = await page
    .waitForFunction(() => document.activeElement?.classList.contains('kit-indent-indicator'), null, { timeout: 3_000 })
    .then(
      () => true,
      () => false,
    );
  await sleep(1000);
  await pressIn(page, frame, ['Tab']);
  const chosenText = await editorText(page, 'kit-projects-frame');
  await indicator(page).click();
  await popup.getByRole('button', { name: 'Back to automatic' }).click();
  await indicatorSays(page, 'tab:4');
  await page.keyboard.press('Escape');
  // The change crosses to the editor's page and into the module; a person's next key comes later than a script's.
  await sleep(1000);
  await pressIn(page, frame, ['Tab']);
  const automaticText = await editorText(page, 'kit-projects-frame');
  result.choice = {
    said,
    chosen,
    focusBack,
    chosenText: JSON.stringify(chosenText),
    automatic: JSON.stringify(automaticText),
  };
  check(
    'editor settings: the indicator’s popup chooses for this file (Spaces, 8 — “this file”) and goes back to automatic; Escape gives the focus back',
    said === 'Go’s value in Settings → Editor.' &&
      chosen.indent === 'space:8' &&
      chosen.source === 'file' &&
      focusBack === true &&
      chosenText === `${' '.repeat(8)}${startText}` &&
      automaticText === `\t${chosenText}`,
    JSON.stringify(result.choice),
  );

  // ---- a project's file of the demo: Go by its row, Tab a tab ------------------------------------------------------
  await page.goto(`${base}#/projects/p_demo0settl/main.go`);
  frame = page.locator('iframe.kit-projects-frame');
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await page.waitForFunction(() => document.querySelector('iframe.kit-projects-frame')?.dataset.mode === 'file', null, {
    timeout: 45_000,
  });
  await indicator(page).waitFor({ timeout: 10_000 });
  const project = await indentOf(page);
  await pressIn(page, frame, ['Tab']);
  const projectText = await editorText(page, 'kit-projects-frame');
  result.projectFile = { ...project, start: JSON.stringify(projectText.slice(0, 14)) };
  check(
    'editor settings: a Go file of a demo project opens with tabs, and Tab inserts a tab',
    project.indent === 'tab:4' && projectText.startsWith('\tpackage main'),
    JSON.stringify(result.projectFile),
  );
  await sleep(300);
  await shoot(page, 'indicator-project-file-light.png');

  // ---- «Compare code»: each side its own; Tab on an edited side; a choice for one side only -----------------------
  await page.goto(`${base}#/compare`);
  const counts = page.locator('.kit-compare-counts');
  await counts.and(page.locator('[data-viewer-state="ready"]')).waitFor({ timeout: 45_000 });
  let shown = Number(await counts.getAttribute('data-shown'));
  await page.getByRole('combobox', { name: 'Language', exact: true }).click();
  await page.getByRole('option', { name: 'Go', exact: true }).click();
  await page.waitForFunction(
    n => Number(document.querySelector('.kit-compare-counts')?.dataset.shown ?? 0) > n,
    shown,
    { timeout: 20_000 },
  );
  const oldSide = '.kit-compare-side[data-side="old"]';
  const newSide = '.kit-compare-side[data-side="new"]';
  await indicatorSays(page, 'tab:4', oldSide);
  await indicatorSays(page, 'tab:4', newSide);
  const compareBefore = { old: await indentOf(page, oldSide), new: await indentOf(page, newSide) };
  await page.locator(`${newSide} button[data-action="edit"]`).click();
  await sleep(300);
  const compareBox = await page.locator('iframe.kit-compare-frame').boundingBox();
  await page.mouse.click(compareBox.x + (compareBox.width * 3) / 4, compareBox.y + 60);
  await page.keyboard.press(MOVE_TO_START);
  await page.keyboard.press('Tab');
  await sleep(300);
  const compareText = await editorText(page, 'kit-compare-frame', 'new');
  await page.keyboard.press('Escape');
  await indicator(page, oldSide).click();
  const sidePopup = page.getByRole('dialog', { name: 'Indentation of the original side' });
  await sidePopup.waitFor({ timeout: 5_000 });
  await sidePopup.getByRole('radio', { name: 'Spaces', exact: true }).click();
  await indicatorSays(page, 'space:4', oldSide);
  await sleep(300);
  await shoot(page, 'indicator-compare-light.png');
  await page.keyboard.press('Escape');
  const compareAfter = { old: await indentOf(page, oldSide), new: await indentOf(page, newSide) };
  result.compare = { before: compareBefore, after: compareAfter, start: JSON.stringify(compareText.slice(0, 10)) };
  check(
    'editor settings: «Compare code» gives each side its own indentation (Go: tabs), Tab on an edited side inserts a tab, and a choice on one side leaves the other',
    compareText.startsWith('\t') &&
      compareAfter.old.indent === 'space:4' &&
      compareAfter.old.source === 'file' &&
      compareAfter.new.indent === 'tab:4' &&
      compareAfter.new.source !== 'file',
    JSON.stringify(result.compare),
  );

  // ---- a change in Settings (another tab) reaches the open editor without a reload; it survives a reload ----------
  frame = await openScratch(page, SCRATCHES[3]);
  const before = await indentOf(page);
  const settings = watch(await ctx.newPage());
  await settings.goto(`${base}#/settings`);
  await settings.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
  await settings.getByRole('combobox', { name: 'Indent size', exact: true }).click();
  await settings.getByRole('option', { name: '2', exact: true }).click();
  await settings.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  await indicatorSays(page, 'space:2');
  await sleep(1000);
  await pressIn(page, frame, ['Tab']);
  const liveText = await editorText(page, 'kit-projects-frame');
  const stored = await page.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, SETTINGS_KEY);
  result.live = { before, after: await indentOf(page), text: JSON.stringify(liveText), stored };
  check(
    'editor settings: Indent size 2 chosen in Settings (another tab) reaches the open scratch without a reload; Tab inserts two',
    before.indent === 'space:4' &&
      result.live.after.indent === 'space:2' &&
      result.live.after.source === 'general' &&
      liveText === '  ' &&
      stored?.version === 1 &&
      stored?.base?.indentSize === 2,
    JSON.stringify(result.live),
  );
  await settings.reload();
  await settings.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
  const sizeAfterReload = await settings.getByRole('combobox', { name: 'Indent size', exact: true }).innerText();
  await openScratch(page, SCRATCHES[3]);
  const scratchAfterReload = await indentOf(page);
  result.reloaded = { settings: sizeAfterReload, scratch: scratchAfterReload };
  check(
    'editor settings: the stored value survives a reload of Settings and of the editor’s page',
    sizeAfterReload.trim() === '2' && scratchAfterReload.indent === 'space:2',
    JSON.stringify(result.reloaded),
  );
  await settings.close();

  // ---- profiles (Pro, stage 2): make, switch, rename, duplicate, delete in Settings; the open editor follows -------
  await page.evaluate(key => chrome.storage.local.remove(key), PROFILES_KEY);
  // The Default set says 2 now (the step above).
  frame = await openScratch(page, SCRATCHES[3]);
  const prof = watch(await ctx.newPage());
  await prof.goto(`${base}#/settings`);
  await prof.getByRole('heading', { name: 'Profiles', level: 3 }).waitFor({ timeout: 15_000 });
  await prof.getByRole('textbox', { name: 'New profile', exact: true }).fill('Work');
  await prof.getByRole('button', { name: 'Create', exact: true }).click();
  await prof.getByText('Created “Work”.', { exact: true }).waitFor({ timeout: 5_000 });
  await prof.getByRole('combobox', { name: 'Indent size', exact: true }).click();
  await prof.getByRole('option', { name: '6', exact: true }).click();
  await prof.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  await indicatorSays(page, 'space:6');
  const onWork = await indentOf(page);
  await prof.getByRole('radio', { name: 'Use Default', exact: true }).check();
  await indicatorSays(page, 'space:2');
  const onDefault = await indentOf(page);
  await prof.getByRole('radio', { name: 'Use Work', exact: true }).check();
  await indicatorSays(page, 'space:6');
  await sleep(1000);
  const beforeWork = await editorText(page, 'kit-projects-frame');
  await pressIn(page, frame, ['Tab']);
  const workText = await editorText(page, 'kit-projects-frame');
  // Rename by the keyboard: Enter saves, and the keyboard is back on Rename.
  await prof.getByRole('button', { name: 'Rename Work', exact: true }).click();
  await prof.getByRole('textbox', { name: 'New name for Work', exact: true }).fill('Office');
  await prof.keyboard.press('Enter');
  await prof.getByRole('button', { name: 'Rename Office', exact: true }).waitFor({ timeout: 5_000 });
  const renameFocus = await prof
    .waitForFunction(() => document.activeElement?.getAttribute('aria-label') === 'Rename Office', null, {
      timeout: 3_000,
    })
    .then(
      () => true,
      () => false,
    );
  await page.waitForFunction(
    () =>
      document.querySelector('button.kit-indent-indicator')?.innerText.replace(/\s+/g, ' ').trim() ===
      'Spaces: 6 Office',
    null,
    { timeout: 5_000 },
  );
  await prof.getByRole('button', { name: 'Duplicate Office', exact: true }).click();
  await prof.getByText('Created “Office (2)”.', { exact: true }).waitFor({ timeout: 5_000 });
  await prof.getByRole('button', { name: 'Delete Office (2)', exact: true }).click();
  const deleteDialog = prof.getByRole('dialog', { name: 'Delete the profile “Office (2)”?' });
  await deleteDialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await prof.getByText('Deleted “Office (2)”.', { exact: true }).waitFor({ timeout: 5_000 });
  const profileNames = await prof.locator('[data-profile]').allInnerTexts();
  const storedProfiles = await prof.evaluate(
    async key => (await chrome.storage.local.get(key))[key] ?? null,
    PROFILES_KEY,
  );
  const storedDefault = await prof.evaluate(
    async key => (await chrome.storage.local.get(key))[key] ?? null,
    SETTINGS_KEY,
  );
  result.profiles = {
    onWork,
    onDefault,
    workText: JSON.stringify(workText),
    renameFocus,
    profileNames,
    stored: storedProfiles,
  };
  check(
    'editor settings (Pro): a profile made in Settings from the active one, given Indent size 6, reaches the open scratch at once (“Spaces: 6 Work”, Tab inserts six); switching to Default and back follows at once; the Default set’s record keeps its own value',
    onWork.indent === 'space:6' &&
      onWork.text === 'Spaces: 6 Work' &&
      onDefault.indent === 'space:2' &&
      workText === `${' '.repeat(6)}${beforeWork}` &&
      storedDefault?.base?.indentSize === 2,
    JSON.stringify({ onWork, onDefault, workText: JSON.stringify(workText), storedDefault: storedDefault?.base }),
  );
  check(
    'editor settings (Pro): rename (Enter saves, the keyboard back on Rename, the editor says the new name), duplicate and delete (asked first) — the list and the stored record `editorProfiles` (version 1) follow',
    renameFocus &&
      JSON.stringify(profileNames) === JSON.stringify(['Default', 'Office']) &&
      storedProfiles?.version === 1 &&
      storedProfiles.profiles.length === 1 &&
      storedProfiles.profiles[0].name === 'Office' &&
      storedProfiles.active === storedProfiles.profiles[0].id,
    JSON.stringify(result.profiles),
  );

  // ---- export, then import (and a hostile file refused in one line) ------------------------------------------------
  const [download] = await Promise.all([
    prof.waitForEvent('download', { timeout: 10_000 }),
    prof.getByRole('button', { name: 'Export Office', exact: true }).click(),
  ]);
  const exported = await readFile(await download.path(), 'utf8');
  const fileInput = prof.locator('[data-editor-profile-file]');
  await fileInput.setInputFiles({
    name: download.suggestedFilename(),
    mimeType: 'application/json',
    buffer: Buffer.from(exported),
  });
  await prof.getByText('Imported “Office (2)”.', { exact: true }).waitFor({ timeout: 5_000 });
  await fileInput.setInputFiles({
    name: 'evil.json',
    mimeType: 'application/json',
    buffer: Buffer.from('{"format":"devtab-editor-profile","version":1,"profile":"<img src=x onerror=alert(1)>"}'),
  });
  const refusal = 'Not imported: the file is not an editor profile exported from this extension.';
  const refused = await prof
    .getByText(refusal, { exact: true })
    .waitFor({ timeout: 5_000 })
    .then(
      () => true,
      () => false,
    );
  const afterImport = await prof.evaluate(
    async key => (await chrome.storage.local.get(key))[key] ?? null,
    PROFILES_KEY,
  );
  const parsedExport = JSON.parse(exported);
  result.exportImport = {
    file: download.suggestedFilename(),
    exported: parsedExport,
    refused,
    names: afterImport?.profiles.map(p => p.name),
  };
  check(
    'editor settings (Pro): Export saves a profile file (format devtab-editor-profile, version 1, the profile’s values); importing it adds “Office (2)” with the same values; a hostile file is refused in one line and adds nothing',
    download.suggestedFilename() === 'office.editor-profile.json' &&
      parsedExport.format === 'devtab-editor-profile' &&
      parsedExport.version === 1 &&
      parsedExport.profile?.name === 'Office' &&
      parsedExport.profile?.base?.indentSize === 6 &&
      refused &&
      JSON.stringify(afterImport?.profiles.map(p => p.name)) === JSON.stringify(['Office', 'Office (2)']) &&
      afterImport.profiles[1].base.indentSize === 6,
    JSON.stringify(result.exportImport),
  );

  // ---- a project names a profile of its own (in its file's indicator); scratches keep the active one --------------
  await prof.getByRole('radio', { name: 'Use Default', exact: true }).check();
  await sleep(300);
  await page.goto(`${base}#/projects/p_demo0settl/README.md`);
  await projectFileShown(page, 'README.md');
  await indicatorSays(page, 'space:2');
  await indicator(page).click();
  await popup.waitFor({ timeout: 5_000 });
  await popup.getByRole('combobox', { name: 'Profile of this project', exact: true }).click();
  await page.getByRole('option', { name: 'Office', exact: true }).first().click();
  await indicatorSays(page, 'space:6');
  await page.keyboard.press('Escape');
  const projectOwn = await indentOf(page);
  const projectsStored = await page.evaluate(
    async key => (await chrome.storage.local.get(key))[key]?.projects ?? null,
    PROFILES_KEY,
  );
  await openScratch(page, SCRATCHES[3]);
  const scratchGlobal = await indentOf(page);
  result.projectProfile = { projectOwn, projectsStored, scratchGlobal };
  check(
    'editor settings (Pro): a project’s file chooses the project’s own profile in its popup (Office: “Spaces: 6 Office”), stored for that project; a scratch keeps the active one (Default: 2)',
    projectOwn.indent === 'space:6' &&
      projectOwn.text === 'Spaces: 6 Office' &&
      projectsStored?.p_demo0settl === afterImport.profiles[0].id &&
      scratchGlobal.indent === 'space:2',
    JSON.stringify(result.projectProfile),
  );
  await prof.close();

  // ---- a demo project's .editorconfig (Pro, stage 3): it decides, a choice for the file still wins, an edit counts --
  // A new document, so that the reader's chunk (loaded once per document) is fetched again where it is seen.
  const readerRequests = [];
  const noteReader = request => request.url().includes('editorConfigReader') && readerRequests.push(request.url());
  page.on('request', noteReader);
  await page.reload();
  frame = await openProjectFile(page, 'p_demo0garden', 'Cargo.toml');
  await indicatorSays(page, 'space:2');
  const fromConfig = await indentOf(page);
  await indicator(page).click();
  await popup.waitFor({ timeout: 5_000 });
  const configSaid = await popup.locator('[data-slot="popover-description"]').innerText();
  await popup.getByRole('radio', { name: 'Tabs', exact: true }).click();
  await indicatorSays(page, 'tab:2');
  const chosenOverConfig = await indentOf(page);
  await popup.getByRole('button', { name: 'Back to automatic' }).click();
  await indicatorSays(page, 'space:2');
  await page.keyboard.press('Escape');
  await sleep(1000);
  await pressIn(page, frame, ['Tab']);
  const configText = await editorText(page, 'kit-projects-frame');
  const readerLoaded = readerRequests.length > 0;
  page.off('request', noteReader);
  result.editorConfig = {
    fromConfig,
    configSaid,
    chosenOverConfig,
    text: JSON.stringify(configText.slice(0, 12)),
    readerLoaded,
  };
  check(
    'editor settings (Pro): a demo project’s file whose .editorconfig says 2 (Cargo.toml) shows “Spaces: 2 EditorConfig”, its popup names the file that decided, and Tab inserts two',
    fromConfig.indent === 'space:2' &&
      fromConfig.source === 'project' &&
      fromConfig.text === 'Spaces: 2 EditorConfig' &&
      configSaid === 'Set by .editorconfig.' &&
      configText.startsWith('  [package]') &&
      readerLoaded,
    JSON.stringify(result.editorConfig),
  );
  check(
    'editor settings (Pro): a choice in the indicator still wins over the .editorconfig (Tabs — “this file”), and back to automatic the .editorconfig decides again',
    chosenOverConfig.indent === 'tab:2' && chosenOverConfig.source === 'file',
    JSON.stringify(chosenOverConfig),
  );
  // The .editorconfig edited in the demo's editor and saved by itself: the `files.changed` event drops what was read.
  await page.evaluate(() => {
    location.hash = '#/projects/p_demo0garden/.editorconfig';
  });
  await projectFileShown(page, '.editorconfig');
  await sleep(1000);
  await pressIn(page, frame, [MOVE_TO_END, 'ArrowUp', LINE_END, 'Backspace', '3']);
  const edited = await editorText(page, 'kit-projects-frame');
  await page.waitForFunction(
    () => document.querySelector('.kit-projects-save')?.getAttribute('data-state') === 'saved',
    null,
    {
      timeout: 10_000,
    },
  );
  await page.evaluate(() => {
    location.hash = '#/projects/p_demo0garden/Cargo.toml';
  });
  await projectFileShown(page, 'Cargo.toml');
  const afterEdit = await indicatorSays(page, 'space:3', '', 10_000).then(
    async () => indentOf(page),
    async () => indentOf(page),
  );
  result.editorConfigEdit = { edited: JSON.stringify(edited.slice(-40)), afterEdit };
  check(
    'editor settings (Pro): the demo’s .editorconfig edited in its editor (indent_size = 3 for TOML) and saved: Cargo.toml then indents by 3 from EditorConfig',
    edited.endsWith('[*.{toml,md}]\nindent_size = 3\n') &&
      afterEdit.indent === 'space:3' &&
      afterEdit.source === 'project',
    JSON.stringify(result.editorConfigEdit),
  );

  // ---- how it looks: Settings → Editor and the indicator's popup, light and dark, wide and narrow -----------------
  // With the defaults again, and two profiles besides Default so that the list shows: what a person sees first.
  await page.evaluate(async key => chrome.storage.local.remove(key), SETTINGS_KEY);
  await page.evaluate(
    async key =>
      chrome.storage.local.set({
        [key]: {
          version: 1,
          profiles: [
            { id: 'ep_look000001', name: 'Work', base: { indentSize: 2 }, languages: {} },
            {
              id: 'ep_look000002',
              name: 'Reading, with a large font and wrapped lines',
              base: { fontSize: 18, softWrap: true },
              languages: {},
            },
          ],
          active: 'default',
          projects: {},
        },
      }),
    PROFILES_KEY,
  );
  const looks = [];
  for (const mode of ['Light', 'Dark']) {
    if (mode === 'Dark') await themeMode(ctx, base, 'Dark');
    for (const [width, height, size] of [
      [1440, 900, 'wide'],
      [800, 700, 'narrow'],
    ]) {
      await page.setViewportSize({ width, height });
      await page.goto(`${base}#/settings`);
      const group = page.locator('[data-settings="editor"]');
      await group.waitFor({ timeout: 15_000 });
      const settingsFit = await fits(page, '[data-settings="editor"]');
      // The whole group in one picture: the same width, a window tall enough, the group just under the toolbar.
      await page.setViewportSize({ width, height: 2400 });
      await page.evaluate(() => {
        const g = document.querySelector('[data-settings="editor"]');
        const main = document.querySelector('.kit-main');
        main.scrollTop += g.getBoundingClientRect().top - main.getBoundingClientRect().top - 16;
      });
      await sleep(300);
      const box = await group.boundingBox();
      await shoot(
        {
          screenshot: options =>
            page.screenshot({ ...options, clip: { x: 0, y: Math.max(0, box.y - 16), width, height: box.height + 32 } }),
        },
        `editor-settings-${mode.toLowerCase()}-${size}.png`,
      );
      const profilesBox = await page.locator('[data-editor-profiles]').boundingBox();
      await shoot(
        {
          screenshot: options =>
            page.screenshot({
              ...options,
              clip: { x: 0, y: Math.max(0, profilesBox.y - 16), width, height: profilesBox.height + 32 },
            }),
        },
        `editor-profiles-${mode.toLowerCase()}-${size}.png`,
      );
      await page.setViewportSize({ width, height });
      await openScratch(page, SCRATCHES[0]);
      await indicator(page).click();
      await popup.waitFor({ timeout: 5_000 });
      await sleep(300);
      if (!(mode === 'Light' && size === 'wide'))
        await shoot(page, `indicator-popup-${mode.toLowerCase()}-${size}.png`);
      const popupFit = await page.evaluate(() => {
        const r = document.querySelector('.kit-indent-popup')?.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        return r ? { inside: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh } : null;
      });
      const barFit = await fits(page, '.kit-projects-editor-bar');
      await page.keyboard.press('Escape');
      // A project's file whose .editorconfig decides: the popup names the file.
      await openProjectFile(page, 'p_demo0garden', 'Cargo.toml');
      await indicatorSays(page, 'space:2');
      await indicator(page).click();
      await popup.waitFor({ timeout: 5_000 });
      await sleep(300);
      await shoot(page, `indicator-editorconfig-${mode.toLowerCase()}-${size}.png`);
      const configFit = await page.evaluate(() => {
        const r = document.querySelector('.kit-indent-popup')?.getBoundingClientRect();
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        return r ? { inside: r.left >= 0 && r.right <= vw && r.top >= 0 && r.bottom <= vh } : null;
      });
      const configBarFit = await fits(page, '.kit-projects-editor-bar, .kit-indent-popup');
      await page.keyboard.press('Escape');
      looks.push({ mode, size, settingsFit, popupFit, barFit, configFit, configBarFit });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await themeMode(ctx, base, 'System');
  result.looks = looks;
  check(
    'editor settings: Settings → Editor (with its profiles), the indicator and its popups (the EditorConfig one too) fit — nothing cut off — at 1440×900 and 800×700, light and dark',
    looks.every(
      l =>
        !l.settingsFit.overflowX &&
        l.settingsFit.clipped.length === 0 &&
        l.popupFit?.inside &&
        l.barFit.clipped.length === 0 &&
        l.configFit?.inside &&
        l.configBarFit.clipped.length === 0,
    ),
    JSON.stringify(looks),
  );

  // ---- tidy: this step's records go ---------------------------------------------------------------------------------
  await page.evaluate(
    async ([ids, keys]) => chrome.storage.local.remove([...keys, 'scratches', ...ids.map(i => `scratch:${i}`)]),
    [SCRATCHES.map(s => s.id), [SETTINGS_KEY, PROFILES_KEY]],
  );
  await page.close();

  // ---- the free edition: built with the root reading `fixedFree`, in a browser of its own ---------------------------
  await runFreeChecks({ check, shoot, report: result, sleep, watch, errors });
  check('editor settings: no console error or page error', errors.length === 0, errors.slice(0, 5).join(' | '));
};

/**
 * The free edition (D39, D40): the same sources built with the edition's root reading `fixedFree`
 * (DEVTAB_VARIANT=edition:fixedFree, as scripts/e2e-tools/saved-settings.mjs builds it) into a folder of its own, loaded in
 * a browser of its own. Stages 1a/1b as before (a Go scratch: “Tab: 4 Go”, Tab a tab); Settings → Editor has the one
 * line “Profiles are part of Pro.” and nothing else of profiles; a project's file with an `.editorconfig` is not
 * changed by it and its popup has the one line about it; a profiles' record a Pro build left is never asked for (every
 * `chrome.storage.local.get` of the pages is noted by an init script) and stays as it was, and the `.editorconfig`
 * reader's chunk is never loaded, so no `.editorconfig` is read. Screenshots of both lines, light and dark, wide and
 * narrow.
 */
/** JSON with every object's keys in order: two values stored and read back compare equal (Chrome sorts keys). */
const canonical = value =>
  JSON.stringify(value, (_, v) =>
    v && typeof v === 'object' && !Array.isArray(v)
      ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => (a < b ? -1 : 1)))
      : v,
  );

const runFreeChecks = async ({ check, shoot, report, sleep, watch, errors }) => {
  const freeDist = join(ROOT, '.state/e2e/dist-free-editor');
  mkdirSync(join(ROOT, '.state/e2e'), { recursive: true });
  const built = spawnSync('pnpm', ['exec', 'vite', 'build'], {
    cwd: join(ROOT, 'extension'),
    env: { ...process.env, CLI_CEB_DEV: 'false', DEVTAB_VARIANT: 'edition:fixedFree', DEVTAB_OUT_DIR: freeDist },
    encoding: 'utf8',
    timeout: 600_000,
  });
  writeFileSync(join(ROOT, '.state/e2e/free-editor-build.log'), `${built.stdout ?? ''}\n${built.stderr ?? ''}`);
  if (
    !check(
      'editor settings (free): the free edition builds (DEVTAB_VARIANT=edition:fixedFree)',
      built.status === 0,
      `exit ${built.status}`,
    )
  )
    return;
  let chromium;
  for (const dir of [process.env.PLAYWRIGHT_DIR, join(ROOT, '.state/e2e/node')].filter(Boolean)) {
    try {
      ({ chromium } = createRequire(join(resolve(dir), 'package.json'))('playwright'));
      break;
    } catch {
      // the next place
    }
  }
  mkdirSync(join(ROOT, '.state/e2e/profiles'), { recursive: true });
  const profile = mkdtempSync(join(ROOT, '.state/e2e/profiles/free-editor-'));
  const free = await chromium.launchPersistentContext(profile, {
    channel: 'chromium',
    headless: true,
    ignoreDefaultArgs: ['--disable-extensions'],
    args: [`--disable-extensions-except=${freeDist}`, `--load-extension=${freeDist}`, '--lang=en-US'],
    viewport: { width: 1440, height: 900 },
    colorScheme: 'light',
  });
  try {
    // Every key a page of ours asks chrome.storage.local for, noted in its tab's sessionStorage.
    await free.addInitScript(() => {
      const local = globalThis.chrome?.storage?.local;
      if (!local) return;
      const get = local.get.bind(local);
      local.get = (keys, ...rest) => {
        const seen = JSON.parse(sessionStorage.getItem('e2eStorageGets') ?? '[]');
        sessionStorage.setItem('e2eStorageGets', JSON.stringify([...seen, keys ?? null]));
        return get(keys, ...rest);
      };
    });
    // Every file a page of ours fetches (the reader's chunk is a file of its own).
    const fetched = [];
    free.on('request', request => fetched.push(request.url()));
    let [sw] = free.serviceWorkers();
    sw ??= await free.waitForEvent('serviceworker');
    const freeBase = `chrome-extension://${new URL(sw.url()).host}/src/app/index.html`;
    const p = watch(await free.newPage());
    await p.goto(`${freeBase}#/settings`);
    await p.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
    // What a Pro build left in this browser: a profile in force, 7 wide.
    const left = {
      version: 1,
      profiles: [{ id: 'ep_left000001', name: 'Left by Pro', base: { indentSize: 7 }, languages: {} }],
      active: 'ep_left000001',
      projects: {},
    };
    const scratch = { id: 's_edfree0go0', name: 'free', language: 'go', text: '' };
    await p.evaluate(
      async ([left, s]) => {
        const now = Date.now();
        await chrome.storage.local.set({
          editorProfiles: left,
          scratches: {
            version: 1,
            lastLanguage: 'go',
            items: [{ id: s.id, name: s.name, language: s.language, createdMs: now, updatedMs: now, chars: 0 }],
          },
          [`scratch:${s.id}`]: s.text,
        });
      },
      [left, scratch],
    );
    await p.reload();
    await p.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
    const line = await p.locator('[data-editor-profiles]').evaluate(el => ({
      state: el.getAttribute('data-editor-profiles'),
      text: el.textContent.trim(),
      controls: el.querySelectorAll('button, a, input').length,
    }));
    const profileParts = {
      heading: await p.getByRole('heading', { name: 'Profiles' }).count(),
      create: await p.getByRole('button', { name: 'Create', exact: true }).count(),
      radios: await p.locator('[data-profile]').count(),
      lockOrBadge: await p
        .locator('[data-settings="editor"] [data-badge], [data-settings="editor"] svg.lucide-lock')
        .count(),
    };
    check(
      'editor settings (free): Settings → Editor says “Profiles are part of Pro.” in one quiet line where the profiles would be — no list, no controls, no lock or badge',
      line.state === 'excluded' &&
        line.text === 'Profiles are part of Pro.' &&
        line.controls === 0 &&
        profileParts.heading === 0 &&
        profileParts.create === 0 &&
        profileParts.radios === 0 &&
        profileParts.lockOrBadge === 0,
      JSON.stringify({ line, profileParts }),
    );

    // Stages 1a/1b as before: the Default set, not the profile a Pro build left.
    await p.goto(`${freeBase}#/projects/scratches/${scratch.id}`);
    const sframe = p.locator('iframe.kit-projects-frame');
    await sframe.and(p.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await p.waitForFunction(
      () => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown ?? 0) > 0,
      null,
      {
        timeout: 45_000,
      },
    );
    const goButton = p.locator('button.kit-indent-indicator');
    await goButton.waitFor({ timeout: 10_000 });
    const go = {
      indent: await goButton.getAttribute('data-indent'),
      text: (await goButton.innerText()).replace(/\s+/g, ' ').trim(),
    };
    const box = await sframe.boundingBox();
    await p.mouse.click(box.x + box.width / 2, box.y + Math.min(60, box.height / 3));
    await p.keyboard.press(MOVE_TO_START);
    await p.keyboard.press('Tab');
    await sleep(300);
    const goText = await p.evaluate(
      () =>
        new Promise((resolveText, reject) => {
          const el = document.querySelector('iframe.kit-projects-frame');
          const asked = 810_000;
          const on = event => {
            if (event.source !== el.contentWindow || event.data?.type !== 'viewer/text' || event.data.id !== asked)
              return;
            removeEventListener('message', on);
            resolveText(event.data.text);
          };
          addEventListener('message', on);
          el.contentWindow.postMessage({ type: 'viewer/read', id: asked, side: 'new' }, location.origin);
          setTimeout(() => reject(new Error('the editor did not answer')), 10_000);
        }),
    );
    check(
      'editor settings (free): stages 1a/1b as before — a Go scratch is “Tab: 4 Go” by the Default set (not the profile a Pro build left), and Tab inserts a tab',
      go.indent === 'tab:4' && go.text === 'Tab: 4 Go' && goText === '\t',
      JSON.stringify({ go, goText: JSON.stringify(goText) }),
    );

    // A demo project's file with an .editorconfig: not read; the popup says so in one line.
    await p.goto(`${freeBase}#/projects/p_demo0garden/Cargo.toml`);
    await p.waitForFunction(
      () =>
        document.querySelector('.kit-projects-editor-path')?.textContent === 'Cargo.toml' &&
        document.querySelector('iframe.kit-projects-frame')?.dataset.mode === 'file' &&
        !!document.querySelector('button.kit-indent-indicator'),
      null,
      { timeout: 45_000 },
    );
    await sleep(500);
    const toml = p.locator('button.kit-indent-indicator');
    const tomlSays = {
      indent: await toml.getAttribute('data-indent'),
      source: await toml.getAttribute('data-source'),
      text: (await toml.innerText()).replace(/\s+/g, ' ').trim(),
    };
    await toml.click();
    const popup = p.getByRole('dialog', { name: 'Indentation of this file' });
    await popup.waitFor({ timeout: 5_000 });
    const popupLine = await popup.locator('[data-project-note]').evaluate(el => ({
      state: el.getAttribute('data-project-note'),
      text: el.textContent.trim(),
    }));
    const projectProfile = await popup.getByRole('combobox', { name: 'Profile of this project' }).count();
    await sleep(300);
    await shoot(p, 'free-indicator-project-light-wide.png');
    await p.keyboard.press('Escape');
    const resources = [...fetched];
    const gets = await p.evaluate(() => JSON.parse(sessionStorage.getItem('e2eStorageGets') ?? '[]'));
    const stillLeft = await p.evaluate(async () => (await chrome.storage.local.get('editorProfiles')).editorProfiles);
    report.free = { line, go, tomlSays, popupLine, projectProfile, gets: [...new Set(gets.flat().map(String))] };
    check(
      'editor settings (free): a demo project’s file with an .editorconfig keeps the Default set’s indentation (“Spaces: 4 default”), and its popup says “Settings from a project’s .editorconfig are part of Pro.” in one line, with no profile choice',
      tomlSays.indent === 'space:4' &&
        tomlSays.source !== 'project' &&
        tomlSays.text === 'Spaces: 4 default' &&
        popupLine.state === 'excluded' &&
        popupLine.text === 'Settings from a project’s .editorconfig are part of Pro.' &&
        projectProfile === 0,
      JSON.stringify({ tomlSays, popupLine, projectProfile }),
    );
    check(
      'editor settings (free): nothing is read — no page asks chrome.storage.local for `editorProfiles` (nor for everything), the record a Pro build left is as it was, and the .editorconfig reader’s chunk is never loaded',
      gets.length > 0 &&
        !gets.flat().includes('editorProfiles') &&
        !gets.some(k => k === null) &&
        canonical(stillLeft) === canonical(left) &&
        // The Projects section's own chunk was fetched and seen: the reader's would have been too.
        resources.some(name => name.includes('ProjectsPage')) &&
        !resources.some(name => name.includes('editorConfigReader')),
      JSON.stringify({
        gets: report.free.gets,
        stillLeft,
        projectsChunk: resources.some(name => name.includes('ProjectsPage')),
        reader: resources.filter(n => n.includes('editorConfig')),
      }),
    );

    // How both lines look: light and dark, wide and narrow.
    const looks = [];
    for (const mode of ['Light', 'Dark']) {
      if (mode === 'Dark') await themeMode(free, freeBase, 'Dark');
      for (const [width, height, size] of [
        [1440, 900, 'wide'],
        [800, 700, 'narrow'],
      ]) {
        await p.setViewportSize({ width, height });
        await p.goto(`${freeBase}#/settings`);
        const group = p.locator('[data-settings="editor"]');
        await group.waitFor({ timeout: 15_000 });
        await p.evaluate(() => {
          const g = document.querySelector('[data-settings="editor"]');
          const main = document.querySelector('.kit-main');
          main.scrollTop += g.getBoundingClientRect().top - main.getBoundingClientRect().top - 16;
        });
        await sleep(300);
        const box = await group.boundingBox();
        await shoot(
          {
            screenshot: options =>
              p.screenshot({
                ...options,
                clip: { x: 0, y: Math.max(0, box.y - 16), width, height: Math.min(360, height - box.y) },
              }),
          },
          `free-editor-settings-${mode.toLowerCase()}-${size}.png`,
        );
        const lineFits = await p.locator('[data-editor-profiles]').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
        await p.goto(`${freeBase}#/projects/p_demo0garden/Cargo.toml`);
        await p.locator('button.kit-indent-indicator').waitFor({ timeout: 45_000 });
        await sleep(500);
        await p.locator('button.kit-indent-indicator').click();
        await popup.waitFor({ timeout: 5_000 });
        await sleep(300);
        if (!(mode === 'Light' && size === 'wide'))
          await shoot(p, `free-indicator-project-${mode.toLowerCase()}-${size}.png`);
        const popupFit = await p.evaluate(() => {
          const r = document.querySelector('.kit-indent-popup')?.getBoundingClientRect();
          const note = document.querySelector('.kit-indent-note');
          return r
            ? {
                inside:
                  r.left >= 0 &&
                  r.right <= document.documentElement.clientWidth &&
                  r.top >= 0 &&
                  r.bottom <= document.documentElement.clientHeight,
                note: !!note && note.scrollWidth <= note.clientWidth + 1,
              }
            : null;
        });
        await p.keyboard.press('Escape');
        looks.push({ mode, size, lineFits, popupFit });
      }
    }
    await themeMode(free, freeBase, 'System');
    report.freeLooks = looks;
    check(
      'editor settings (free): both lines fit — nothing cut off — at 1440×900 and 800×700, light and dark',
      looks.every(l => l.lineFits && l.popupFit?.inside && l.popupFit.note),
      JSON.stringify(looks),
    );
    await p.close();
  } catch (error) {
    errors.push(`the free edition's checks stopped: ${String(error?.stack ?? error)}`);
  } finally {
    await free.close();
    rmSync(profile, { recursive: true, force: true });
  }
};
