// The keys of scratch files and of the Projects section in the built extension (D38; extension/src/shortcuts/,
// src/app/projects/LanguagePicker.tsx, src/app/shell/sectionKeys.ts), with the default keys of a Mac (Chrome for Testing
// on macOS reports a Mac): "New scratch file" from another section, the start page and the palette opens the
// language popup in Projects — filter and Enter make the scratch in that language and open it with the keyboard in the
// editor, Escape makes nothing; the same key from inside the editor of an open scratch and of a project's file (demo
// data); the open scratch's keys (rename, delete) from the editor; each part of an open project by its key (Files,
// Commit, History, Find in files, Go to file, the file / diff switch, the next change, back to the list); a key
// recorded again in Settings works, the old one no longer does, and the control's tooltip says the new one; at the
// scratch limit the popup's choice says so. Screenshots of the popup and of the Settings groups, light and dark, wide
// and narrow, where --shots says. Not one console error or page error. Run by scripts/e2e-check.mjs (step `project-keys`).
//
// Keys sent through CDP reach the page without passing the browser's own shortcut handling (docs/research/hotkeys.md
// §2), so this shows what the page does with a key, not whether a real Chrome would hand it over.

/* global document, location, chrome, window -- page.evaluate callbacks run in the pages */

import { themeMode, withSettings } from './e2e-theme.mjs';

const LEDGER = 'p_demo0ledgr';
const NEW_SCRATCH = 'Meta+Alt+Shift+N';

export const runKeysChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const errors = [];
  const result = (report.projectKeys = {});
  const watch = page => {
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(String(e)));
    return page;
  };
  const page = watch(await ctx.newPage());
  await page.setViewportSize({ width: 1440, height: 900 });
  const popup = page.getByRole('dialog', { name: 'New scratch file' });
  const filter = popup.getByRole('combobox', { name: 'Filter languages' });
  const frame = page.locator('iframe.kit-projects-frame');
  const focusTag = () => page.evaluate(() => document.activeElement?.tagName ?? null);
  const scratches = () =>
    page.evaluate(async () => (await chrome.storage.local.get('scratches')).scratches?.items ?? []);
  const forget = () =>
    page.evaluate(async () => {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(
        Object.keys(all).filter(k => k === 'scratches' || k.startsWith('scratch:') || k === 'keyShortcuts'),
      );
    });
  const appears = (locator, timeout = 5_000) =>
    locator
      .waitFor({ timeout })
      .then(() => true)
      .catch(() => false);
  const editorReady = () => frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  /** Gives the editor the keyboard (a click into its text). */
  const intoEditor = async () => {
    const box = await frame.boundingBox();
    await page.mouse.click(box.x + box.width / 2, box.y + 40);
    await sleep(200);
  };

  // ---- from another section: Projects opens with the popup; filter + Enter makes and opens the scratch --------------
  await page.goto(`${base}#/history`);
  await page.getByRole('heading', { name: 'History', level: 1 }).waitFor({ timeout: 15_000 });
  await forget();
  await page.reload();
  await page.getByRole('heading', { name: 'History', level: 1 }).waitFor({ timeout: 15_000 });
  await sleep(300);
  await page.keyboard.press(NEW_SCRATCH);
  const fromOther = {
    popup: await appears(popup, 10_000),
    hash: await page.evaluate(() => location.hash),
  };
  fromOther.filterFocused = await filter.evaluate(el => el === document.activeElement).catch(() => false);
  fromOther.options = await popup.getByRole('option').count();
  await shoot(page, 'keys-popup-wide-light.png');
  await filter.fill('go');
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => /^#\/projects\/scratches\/s_[a-z2-7]{10}$/.test(location.hash), null, {
    timeout: 10_000,
  });
  await page.getByRole('heading', { name: 'scratch.go', level: 1 }).waitFor({ timeout: 10_000 });
  await editorReady();
  await sleep(500);
  fromOther.made = (await scratches()).map(s => s.language);
  fromOther.focus = await focusTag();
  result.fromOther = fromOther;
  check(
    'project keys: ⌥⇧⌘N in another section opens Projects with the language popup (filter focused, every language); “go” + Enter makes scratch.go and opens it with the keyboard in the editor',
    fromOther.popup &&
      fromOther.hash === '#/projects' &&
      fromOther.filterFocused &&
      fromOther.options === 23 &&
      fromOther.made.join() === 'go' &&
      fromOther.focus === 'IFRAME',
    JSON.stringify(fromOther),
  );

  // ---- from inside the open scratch's editor: the popup, Escape gives the editor back; the scratch's own keys ------
  await intoEditor();
  await page.keyboard.press(NEW_SCRATCH);
  const inScratch = { popup: await appears(popup) };
  inScratch.first = await popup
    .getByRole('option')
    .first()
    .getAttribute('data-language')
    .catch(() => null);
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached', timeout: 5_000 });
  await sleep(300);
  inScratch.backTo = await focusTag();
  inScratch.count = (await scratches()).length;
  await page.keyboard.press('Meta+Alt+Shift+R');
  inScratch.rename = await page
    .getByRole('textbox', { name: 'Scratch name' })
    .evaluate(el => el === document.activeElement)
    .catch(() => false);
  await page.keyboard.press('Escape');
  await intoEditor();
  await page.keyboard.press('Meta+Alt+Shift+Backspace');
  const deleteDialog = page.getByRole('dialog', { name: 'Delete scratch.go?' });
  inScratch.delete = await appears(deleteDialog);
  await deleteDialog.getByRole('button', { name: 'Cancel' }).click();
  result.inScratch = inScratch;
  check(
    'project keys: in the open scratch’s editor ⌥⇧⌘N opens the popup (the last language first), Escape closes it with nothing made and gives the editor back; ⌥⇧⌘R renames, ⌥⇧⌘⌫ asks to delete',
    inScratch.popup &&
      inScratch.first === 'go' &&
      inScratch.backTo === 'IFRAME' &&
      inScratch.count === 1 &&
      inScratch.rename &&
      inScratch.delete,
    JSON.stringify(inScratch),
  );

  // ---- the popup on the section's home: Escape makes nothing; screenshots light and dark, wide and narrow ---------
  await page.goto(`${base}#/projects`);
  await page.getByRole('region', { name: 'Scratches' }).waitFor({ timeout: 15_000 });
  const newButton = page.getByRole('button', { name: 'New scratch…' });
  await newButton.waitFor();
  const hint = await newButton.getAttribute('title');
  await page.keyboard.press(NEW_SCRATCH);
  const onHome = { popup: await appears(popup), hint };
  await filter.fill('script');
  await sleep(200);
  onHome.filtered = await popup.getByRole('option').evaluateAll(els => els.map(el => el.dataset.language));
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached', timeout: 5_000 });
  onHome.count = (await scratches()).length;
  for (const mode of ['Light', 'Dark']) {
    if (mode === 'Dark') {
      await themeMode(ctx, base, 'Dark');
      await page.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
    }
    const suffix = mode.toLowerCase();
    for (const [size, viewport] of [
      ['wide', { width: 1440, height: 900 }],
      ['narrow', { width: 800, height: 700 }],
    ]) {
      await page.setViewportSize(viewport);
      await newButton.click();
      await popup.waitFor();
      await sleep(300);
      const fit = await popup.evaluate(el => {
        const r = el.getBoundingClientRect();
        const clipped = [...el.querySelectorAll('[role="option"] span, p, h2')]
          .filter(e => e.getClientRects().length && e.scrollWidth > e.clientWidth + 1)
          .map(e => e.textContent.trim().slice(0, 30));
        return {
          inside: r.left >= 0 && r.right <= window.innerWidth && r.bottom <= window.innerHeight,
          clipped,
        };
      });
      onHome[`${size}-${suffix}`] = fit;
      await shoot(page, `keys-popup-${size}-${suffix}.png`);
      await page.keyboard.press('Escape');
      await popup.waitFor({ state: 'detached', timeout: 5_000 });
    }
  }
  await themeMode(ctx, base, 'Light');
  await page.setViewportSize({ width: 1440, height: 900 });
  result.onHome = onHome;
  const fits = Object.entries(onHome)
    .filter(([k]) => k.includes('-'))
    .every(([, v]) => v.inside && v.clipped.length === 0);
  check(
    'project keys: on the section’s home the key opens the popup (its key in the button’s tooltip); a word narrows the list; Escape makes nothing; the popup fits, nothing cut off, light and dark, 1440×900 and 800×700',
    onHome.popup &&
      /\(⌥⇧⌘N\)$/.test(onHome.hint ?? '') &&
      onHome.filtered.join() === 'javascript,typescript' &&
      onHome.count === 1 &&
      fits,
    JSON.stringify(onHome),
  );

  // ---- a project's file (demo): the popup from its editor; each part by its key ------------------------------------
  // The panels as they start: Files open, the bottom panel collapsed (what another check left is forgotten).
  await page.evaluate(async () => {
    await chrome.storage.local.remove('projectsLayout');
    localStorage.removeItem('projects-layout-cache');
  });
  await page.goto(`${base}#/projects/${LEDGER}/src%2Fserver.ts`);
  await editorReady();
  await page.waitForFunction(
    () => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown ?? 0) > 0,
    null,
    {
      timeout: 45_000,
    },
  );
  await sleep(500);
  // The editor's page notes what it is asked to show (a change brought into view).
  const viewer = page.frames().find(f => f.url().includes('/viewer'));
  await viewer?.evaluate(() => {
    window.__asked = [];
    window.addEventListener('message', e => window.__asked.push(e.data?.type));
  });
  const parts = {};
  await intoEditor();
  await page.keyboard.press(NEW_SCRATCH);
  parts.popupFromFile = await appears(popup);
  await page.keyboard.press('Escape');
  await popup.waitFor({ state: 'detached', timeout: 5_000 });
  await sleep(300);
  parts.backTo = await focusTag();
  const inView = view =>
    page.evaluate(v => document.getElementById(`projects-view-${v}`)?.contains(document.activeElement) ?? false, view);
  // Files is showing: its key from the editor puts the keyboard into it; again, the side panel hides.
  await page.keyboard.press('Meta+Shift+1');
  await sleep(300);
  parts.filesFocused = await inView('files');
  if (!parts.filesFocused)
    parts.focusedInstead = await page.evaluate(() => {
      const el = document.activeElement;
      return `${el?.tagName}#${el?.id}.${el?.className} side=${document.querySelector('#projects-side')?.dataset.open}`;
    });
  await page.keyboard.press('Meta+Shift+1');
  await sleep(200);
  parts.sideHidden = (await page.locator('#projects-side').getAttribute('data-open')) === 'false';
  await page.keyboard.press('Meta+Shift+2');
  await sleep(300);
  parts.commit =
    (await page.locator('#projects-side').getAttribute('data-open')) === 'true' && (await inView('commit'));
  await intoEditor();
  await page.keyboard.press('Meta+Shift+9');
  await sleep(300);
  parts.history = (await page.locator('#projects-view-history').isVisible()) && (await inView('history'));
  await intoEditor();
  await page.keyboard.press('Meta+Alt+Shift+F');
  await sleep(300);
  parts.find = (await inView('find')) && (await focusTag()) === 'INPUT';
  await intoEditor();
  await page.keyboard.press('Meta+Alt+Shift+O');
  parts.goToFile = await appears(page.getByRole('dialog', { name: 'Go to file' }));
  await page.keyboard.press('Escape');
  await intoEditor();
  let n = await frame.evaluate(el => Number(el.dataset.shown ?? 0));
  await page.keyboard.press('Meta+Alt+Shift+D');
  await page.waitForFunction(
    n => {
      const el = document.querySelector('iframe.kit-projects-frame');
      return Number(el?.dataset.shown ?? 0) > n && el?.dataset.mode === 'diff';
    },
    n,
    { timeout: 15_000 },
  );
  parts.diff = await frame.getAttribute('data-mode');
  await intoEditor();
  await page.keyboard.press('Meta+Alt+Shift+ArrowDown');
  await page.keyboard.press('Meta+Alt+Shift+ArrowUp');
  await sleep(300);
  parts.asked = ((await viewer?.evaluate(() => window.__asked)) ?? []).filter(t => t === 'viewer/reveal-hunk').length;
  const switchTitle = await page.locator('#projects-switch-files').getAttribute('title');
  parts.switchTitle = switchTitle;
  await shoot(page, 'keys-project-light.png');
  await intoEditor();
  await page.keyboard.press('Meta+Alt+Shift+L');
  parts.backToList = await page
    .waitForFunction(() => location.hash === '#/projects', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  result.parts = parts;
  check(
    'project keys: in a project’s file (demo) ⌥⇧⌘N opens the popup from the editor; ⇧⌘1 focuses Files and hides it, ⇧⌘2 Commit, ⇧⌘9 History, ⌥⇧⌘F Find in files, ⌥⇧⌘O Go to file, ⌥⇧⌘D the diff, ⌥⇧⌘↓ / ↑ the changes, ⌥⇧⌘L back to the list; the switch says its key',
    parts.popupFromFile &&
      parts.backTo === 'IFRAME' &&
      parts.filesFocused &&
      parts.sideHidden &&
      parts.commit &&
      parts.history &&
      parts.find &&
      parts.goToFile &&
      parts.diff === 'diff' &&
      parts.asked === 2 &&
      /\(⇧⌘1\)$/.test(switchTitle ?? '') &&
      parts.backToList,
    JSON.stringify(parts),
  );

  // ---- the palette and the start page --------------------------------------------------------------------------------
  await page.goto(`${base}#/compare`);
  await page.getByRole('button', { name: /Find a tool or section/ }).waitFor({ timeout: 15_000 });
  await sleep(300);
  await page.keyboard.press('Meta+K');
  const palette = page
    .getByRole('dialog')
    .filter({ has: page.getByRole('combobox', { name: 'Find a tool or section' }) });
  await palette.getByRole('combobox').fill('new scratch');
  const row = palette.getByRole('option').first();
  await row.waitFor({ timeout: 5_000 });
  const others = { row: (await row.innerText()).replace(/\s+/g, ' ') };
  await page.keyboard.press('Enter');
  others.palette = await appears(popup, 10_000);
  others.paletteHash = await page.evaluate(() => location.hash);
  await page.keyboard.press('Escape');
  await page.goto(`${base}#/start`);
  await page.locator('input').first().waitFor({ timeout: 15_000 });
  await sleep(1500);
  await page.keyboard.press(NEW_SCRATCH);
  others.start = await appears(popup, 15_000);
  others.startHash = await page.evaluate(() => location.hash);
  await page.keyboard.press('Escape');
  result.others = others;
  check(
    'project keys: the palette finds “New scratch file” as a command with its key, Enter opens the popup in Projects; on the start page ⌥⇧⌘N does too',
    /New scratch file/.test(others.row) &&
      /Command/.test(others.row) &&
      /⌥⇧⌘N/.test(others.row) &&
      others.palette &&
      others.paletteHash === '#/projects' &&
      others.start &&
      others.startHash === '#/projects',
    JSON.stringify(others),
  );

  // ---- Settings: the groups; a key recorded again works and is shown, the old one no longer works --------------------
  const settingsShots = await withSettings(ctx, base, async settings => {
    const block = settings.locator('[data-settings="shortcuts"]');
    const groups = await block.locator('h3').allInnerTexts();
    const field = block.getByLabel('New scratch file', { exact: true });
    const before = await field.inputValue();
    await field.click();
    await settings.keyboard.press('Meta+Shift+7');
    await settings.waitForFunction(
      () => document.querySelector('[data-shortcut="scratch:new"] input')?.value === '⇧⌘7',
      null,
      { timeout: 5_000 },
    );
    // A key the browser needs is refused, as for any other action.
    const files = block.getByLabel('Files panel', { exact: true });
    await files.click();
    await settings.keyboard.press('Meta+Shift+ArrowLeft');
    const refused = await block.locator('[data-shortcut="projects:files"] [role="alert"]').innerText();
    await settings.keyboard.press('Escape');
    const group = block.getByRole('group', { name: 'Scratch files' });
    await group.scrollIntoViewIfNeeded();
    const shots = [];
    for (const mode of ['Light', 'Dark']) {
      if (mode === 'Dark') {
        await settings
          .getByRole('radiogroup', { name: 'Theme mode' })
          .getByRole('radio', { name: 'Dark', exact: true })
          .click();
        await settings.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
      }
      for (const [size, viewport] of [
        ['wide', { width: 1440, height: 900 }],
        ['narrow', { width: 800, height: 700 }],
      ]) {
        await settings.setViewportSize(viewport);
        await group.scrollIntoViewIfNeeded();
        await sleep(300);
        const clipped = await block.evaluate(el =>
          [...el.querySelectorAll('[data-shortcut^="scratch:"], [data-shortcut^="projects:"]')]
            .flatMap(row => [...row.querySelectorAll('label, p, input, button')])
            .filter(e => {
              const r = e.getBoundingClientRect();
              return r.right > window.innerWidth + 1 || e.scrollWidth > e.clientWidth + 1;
            })
            .map(e => e.textContent.trim().slice(0, 30) || e.value),
        );
        shots.push({ name: `${size}-${mode.toLowerCase()}`, clipped });
        await shoot(settings, `keys-settings-${size}-${mode.toLowerCase()}.png`);
      }
    }
    await settings
      .getByRole('radiogroup', { name: 'Theme mode' })
      .getByRole('radio', { name: 'Light', exact: true })
      .click();
    return { groups, before, refused, shots };
  });
  await page.goto(`${base}#/projects`);
  await page.getByRole('region', { name: 'Scratches' }).waitFor({ timeout: 15_000 });
  await sleep(300);
  await page.keyboard.press(NEW_SCRATCH);
  await sleep(500);
  const recorded = { ...settingsShots, oldKey: await popup.isVisible() };
  recorded.hint = await page.getByRole('button', { name: 'New scratch…' }).getAttribute('title');
  await page.keyboard.press('Meta+Shift+7');
  recorded.newKey = await appears(popup);
  await page.keyboard.press('Escape');
  result.recorded = recorded;
  check(
    'project keys: Settings lists “Scratch files” and “Projects” as groups of their own; “New scratch file” recorded as ⇧⌘7 opens the popup, ⌥⇧⌘N no longer does, the button says ⇧⌘7; a browser key is refused',
    recorded.groups.includes('Scratch files') &&
      recorded.groups.includes('Projects') &&
      recorded.before === '⌥⇧⌘N' &&
      /browser’s or the editor’s/.test(recorded.refused) &&
      !recorded.oldKey &&
      recorded.newKey &&
      /\(⇧⌘7\)$/.test(recorded.hint ?? '') &&
      recorded.shots.every(s => s.clipped.length === 0),
    JSON.stringify(recorded),
  );

  // ---- at the limit: the popup's choice says so ------------------------------------------------------------------------
  await page.evaluate(async () => {
    const list = (await chrome.storage.local.get('scratches')).scratches;
    const now = Date.now();
    const extra = {};
    for (let i = list.items.length; i < 20; i++) {
      const id = `s_keys${String(i)
        .padStart(6, 'a')
        .replace(/[0-9]/g, d => 'abcdefghij'[d])}`;
      list.items.push({ id, name: `filler_${i}`, language: 'text', createdMs: now, updatedMs: now, chars: 0 });
      extra[`scratch:${id}`] = '';
    }
    await chrome.storage.local.set({ scratches: list, ...extra });
  });
  await page.reload();
  await page.getByRole('region', { name: 'Scratches' }).getByRole('link').nth(19).waitFor({ timeout: 10_000 });
  await page.keyboard.press('Meta+Shift+7');
  await popup.waitFor({ timeout: 5_000 });
  await page.keyboard.press('Enter');
  const limit = await popup
    .getByRole('alert')
    .innerText()
    .catch(() => '');
  const kept = (await scratches()).length;
  await shoot(page, 'keys-popup-limit-light.png');
  await page.keyboard.press('Escape');
  result.limit = { limit, kept };
  check(
    'project keys: at 20 scratches the popup’s choice says so in one line and makes nothing',
    limit === '20 scratches are kept at most. Delete one to make another.' && kept === 20,
    JSON.stringify(result.limit),
  );

  await forget();
  check('project keys: no console error or page error', errors.length === 0, errors.join(' | '));
  await page.close();
};
