// The shell around the sections in the built extension (docs/decisions.md D16, 2026-11-21): the tools nested under
// Tools in the sidebar (every tool, the current one marked, opened and closed by its button and remembered across
// reloads, a long list scrolling inside the sidebar with Settings still in reach), the toolbar and the palette (by its
// button and by ⌘K / Ctrl+K on several routes — «Compare code» with the editor focused included —, keyboard only, the
// focus going back, kept inside while open, the page behind hidden), the start page's field taking the same shortcut,
// «Compare code»'s editor height under the toolbar, the theme following the system's light or dark setting live when
// none is chosen (CDP emulates the system's scheme), and the user's shortcuts (set in Settings → Shortcuts, live on
// another page and in the editor, gone when cleared), and the palette opened at the worst moment (`runPaletteRace`: before
// «Compare code»'s editor has started, which focuses itself when it does). Run by scripts/e2e-check.mjs.

/* global document, window, location, chrome, createImageBitmap, OffscreenCanvas -- page.evaluate callbacks run in the pages */

import { readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ROOT } from './read-definitions.mjs';
import { themeMode, withSettings } from './e2e-theme.mjs';

/** The tools the build should offer: every `ui` package with a definition (what extension/src/tools/registry.ts finds). */
const toolPackages = () =>
  readdirSync(join(ROOT, 'packages/tools/ui')).filter(id =>
    existsSync(join(ROOT, 'packages/tools/ui', id, 'src/definition.ts')),
  );

/**
 * The palette at the worst moment: «Compare code» opened and the palette opened at once, before its editor reports
 * ready — the editor's module focuses its own text input when it starts. Letters are typed one by one until the editor
 * is ready and two more after, then Escape. Every letter must land in the palette's field, the editor's frame must never
 * hold the focus while the dialog is open, and Escape must close it at once. Each run is a fresh tab. Returns one row
 * per run; `runShellChecks` runs it a few times, scripts outside the run can repeat it (`runs`). The editor's start is
 * held back (`hold`), so the palette is open when the editor focuses itself, every run.
 */
export const runPaletteRace = async ({ ctx, base, runs = 3, sleep, hold = 2_000 }) => {
  const results = [];
  for (let run = 0; run < runs; run++) {
    const page = await ctx.newPage();
    // The editor starts in a moment once its module is cached; to keep the window open on every run, the editor page's
    // WebAssembly is held back `hold` ms (only in this tab, only the editor page's frame).
    await page.addInitScript(ms => {
      if (!location.pathname.includes('/src/viewer/')) return;
      for (const name of ['instantiateStreaming', 'compileStreaming', 'instantiate', 'compile']) {
        const original = WebAssembly[name];
        if (typeof original === 'function')
          WebAssembly[name] = (...args) =>
            new Promise(r => setTimeout(r, ms)).then(() => original.apply(WebAssembly, args));
      }
    }, hold);
    const errors = [];
    page.on('pageerror', e => errors.push(String(e)));
    await page.goto(`${base}#/compare`);
    const button = page.getByRole('button', { name: 'Find a tool or section…' });
    await button.waitFor({ timeout: 10_000 });
    const stateAtOpen = await page.evaluate(
      () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') ?? 'not drawn',
    );
    await button.click();
    const dialog = page.getByRole('dialog', { name: 'Find a tool or section' });
    await dialog.waitFor({ timeout: 5_000 });
    const field = dialog.getByRole('combobox', { name: 'Find a tool or section' });
    const letters = 'abcdefghijklmnopqrstuvwxyz';
    let typed = '';
    let readyAfter = -1;
    const stolen = [];
    for (let i = 0; i < 40; i++) {
      const letter = letters[i % letters.length];
      await page.keyboard.type(letter);
      typed += letter;
      const frame = page.frames().find(f => f.url().includes('/src/viewer/'));
      const frameFocus = frame ? await frame.evaluate(() => document.hasFocus()).catch(() => false) : false;
      const parentFocus = await page.evaluate(() => document.activeElement?.className ?? '');
      if (frameFocus || !parentFocus.includes('kit-palette-input')) stolen.push({ i, frameFocus, parentFocus });
      const ready = await page.evaluate(
        () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') === 'ready',
      );
      if (ready && readyAfter < 0) readyAfter = i;
      if (readyAfter >= 0 && i >= readyAfter + 2) break;
      await sleep(120);
    }
    const value = await field.inputValue();
    await page.keyboard.press('Escape');
    const closed = await dialog
      .waitFor({ state: 'detached', timeout: 1_000 })
      .then(() => true)
      .catch(() => false);
    const focusAfter = closed
      ? await page
          .waitForFunction(
            () => {
              const a = document.activeElement;
              return a?.tagName === 'IFRAME' || a?.classList.contains('kit-toolbar-find');
            },
            null,
            { timeout: 1_000 },
          )
          .then(() => page.evaluate(() => document.activeElement?.tagName))
          .catch(() => page.evaluate(() => document.activeElement?.tagName))
      : null;
    const inertLeft = await page.evaluate(() => document.querySelectorAll('[inert]').length);
    results.push({
      run,
      stateAtOpen,
      readyAfter,
      typed: typed.length,
      landed: value === typed,
      stolen,
      closed,
      focusAfter,
      inertLeft,
      errors,
      ok:
        stateAtOpen !== 'ready' &&
        readyAfter >= 0 &&
        value === typed &&
        stolen.length === 0 &&
        closed &&
        (focusAfter === 'BUTTON' || focusAfter === 'IFRAME') &&
        inertLeft === 0 &&
        errors.length === 0,
    });
    await page.close();
  }
  return results;
};

export const runShellChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const errors = [];
  const watch = p => {
    p.on('console', m => m.type() === 'error' && errors.push(m.text()));
    p.on('pageerror', e => errors.push(String(e)));
    return p;
  };
  const open = async (hash, viewport) => {
    const p = watch(await ctx.newPage());
    if (viewport) await p.setViewportSize(viewport);
    await p.goto(base + hash);
    return p;
  };
  const shell = (report.shell = {});
  const dialog = p => p.getByRole('dialog', { name: 'Find a tool or section' });
  const field = p => dialog(p).getByRole('combobox', { name: 'Find a tool or section' });
  const toggle = p => p.getByRole('navigation', { name: 'Sections' }).getByRole('button', { name: 'Tools list' });
  const expanded = async p => (await toggle(p).getAttribute('aria-expanded')) === 'true';
  const focusTag = p => p.evaluate(() => document.activeElement?.tagName ?? null);
  const mod = 'ControlOrMeta';

  // ---- the sidebar: the tools nested under Tools ---------------------------------------------------------------
  const tool = await open('#/tools/base64');
  await tool.getByRole('heading', { name: 'Base64', level: 2 }).waitFor({ timeout: 10_000 });
  const nested = tool.getByRole('navigation', { name: 'Sections' }).getByRole('list', { name: 'Tools' });
  const nestedTitles = await nested.getByRole('link').allInnerTexts();
  const current = await nested.locator('[aria-current="page"]').allInnerTexts();
  await tool.goto(`${base}#/tools`);
  const overviewTitles = await tool
    .getByRole('navigation', { name: 'All tools' })
    .locator('.kit-tools-index-title')
    .allInnerTexts();
  shell.nested = nestedTitles;
  check(
    'shell: the sidebar nests every tool under Tools, from the registry, and marks the current one',
    nestedTitles.length === toolPackages().length &&
      JSON.stringify(nestedTitles) === JSON.stringify(overviewTitles) &&
      JSON.stringify(current) === JSON.stringify(['Base64']),
    `${nestedTitles.length} tools (${toolPackages().length} packages); current ${JSON.stringify(current)}`,
  );
  await shoot(tool, 'shell-02-tools-overview-light.png');
  await tool.close();

  // Opened and closed by its button, from the keyboard; remembered across reloads; opens by itself on a tool's page.
  const page = await open('#/compare');
  await page.getByRole('heading', { name: 'Compare code' }).waitFor();
  const atStart = await expanded(page);
  await toggle(page).focus();
  await page.keyboard.press(atStart ? 'Enter' : 'Space');
  const afterKey = await expanded(page);
  await page.reload();
  await page.getByRole('heading', { name: 'Compare code' }).waitFor();
  const afterReload = await expanded(page);
  await toggle(page).focus();
  await page.keyboard.press('Enter');
  const closedAgain = await expanded(page);
  await page.reload();
  await page.getByRole('heading', { name: 'Compare code' }).waitFor();
  const closedAfterReload = await expanded(page);
  await page.evaluate(() => (location.hash = '#/tools/json'));
  await page.getByLabel('Input').waitFor();
  const openForTool = await expanded(page);
  const stored = await page.evaluate(async () => (await chrome.storage.local.get('shellSettings')).shellSettings);
  check(
    'shell: the Tools group opens and closes by its button (keyboard), stays as left across reloads, opens for a tool',
    !atStart &&
      afterKey &&
      afterReload &&
      !closedAgain &&
      !closedAfterReload &&
      openForTool &&
      stored?.open?.tools === false,
    JSON.stringify({ atStart, afterKey, afterReload, closedAgain, closedAfterReload, openForTool, stored }),
  );

  // A list longer than the window: it scrolls inside the sidebar; Settings stays in view; the current tool is in view.
  await page.setViewportSize({ width: 1280, height: 380 });
  await page.evaluate(() => (location.hash = '#/tools/hash'));
  await page.getByRole('heading', { name: 'Hash', level: 2 }).waitFor();
  await sleep(200);
  const layout = await page.evaluate(() => {
    const nav = document.querySelector('.kit-sidebar-nav');
    const foot = document.querySelector('.kit-sidebar-foot a').getBoundingClientRect();
    const box = nav.getBoundingClientRect();
    const cur = document.querySelector('.kit-nav-sub-item[aria-current="page"]').getBoundingClientRect();
    return {
      scrolls: nav.scrollHeight > nav.clientHeight,
      footInView: foot.bottom <= window.innerHeight && foot.top >= 0,
      currentInView: cur.top >= box.top - 1 && cur.bottom <= box.bottom + 1,
      pageScrolls: document.documentElement.scrollHeight > window.innerHeight,
    };
  });
  shell.longList = layout;
  check(
    'shell: a long list scrolls inside the sidebar, Settings stays in reach and the current tool is scrolled into view',
    layout.scrolls && layout.footInView && layout.currentInView && !layout.pageScrolls,
    JSON.stringify(layout),
  );
  await page.setViewportSize({ width: 1280, height: 800 });

  // ---- the palette at the worst moment: opened before «Compare code»'s editor has started ------------------------
  const race = await runPaletteRace({ ctx, base, runs: 3, sleep });
  shell.paletteRace = race;
  check(
    'shell: the palette opened while the editor starts keeps every key and Escape; the editor never takes the focus',
    race.every(r => r.ok),
    JSON.stringify(
      race.map(({ run, stateAtOpen, readyAfter, typed, landed, stolen, closed, focusAfter }) => ({
        run,
        stateAtOpen,
        readyAfter,
        typed,
        landed,
        stolen: stolen.length,
        closed,
        focusAfter,
      })),
    ),
  );

  // ---- the palette ----------------------------------------------------------------------------------------------
  const byClick = [];
  for (const [route, ready] of [
    ['#/tools/json', p => p.getByLabel('Input')],
    ['#/history', p => p.getByRole('heading', { name: 'History', level: 1 })],
    ['#/settings', p => p.getByRole('heading', { name: 'Settings', level: 1 })],
    ['#/compare', p => p.getByRole('heading', { name: 'Compare code' })],
  ]) {
    await page.evaluate(r => (location.hash = r), route);
    await ready(page).waitFor();
    await page.getByRole('button', { name: 'Find a tool or section…' }).click();
    await dialog(page).waitFor({ timeout: 5_000 });
    const ok =
      (await field(page).evaluate(el => el === document.activeElement)) &&
      (await dialog(page).getByRole('listbox').count()) === 1 &&
      (await dialog(page).getByRole('group', { name: 'Go to' }).count()) === 1;
    if (route === '#/tools/json') await shoot(page, 'shell-03-palette-light.png');
    await page.keyboard.press('Escape');
    const closed = await dialog(page)
      .waitFor({ state: 'detached', timeout: 5_000 })
      .then(() => true)
      .catch(async () => `still open; focus on ${await page.evaluate(() => document.activeElement?.className)}`);
    byClick.push([route, ok, closed]);
    if (closed !== true) await page.keyboard.press('Escape');
  }
  check(
    'shell: the toolbar’s button opens the palette — a dialog, its field focused, a listbox — on every route',
    byClick.every(([, ok, closed]) => ok && closed === true),
    JSON.stringify(byClick),
  );

  // By the shortcut, from a text field; keyboard only: type, arrows, Enter; focus goes into the opened page.
  await page.evaluate(() => (location.hash = '#/tools/json'));
  const input = page.getByLabel('Input');
  await input.waitFor();
  await input.focus();
  await page.keyboard.press(`${mod}+K`);
  await dialog(page).waitFor({ timeout: 5_000 });
  // Kept inside: Tab and Shift+Tab stay in the dialog; the page behind is hidden from assistive technology.
  await page.keyboard.press('Tab');
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  const trapped = await dialog(page).evaluate(d => d.contains(document.activeElement));
  const hidden = await page.evaluate(() => !!document.querySelector('.kit-shell').closest('[aria-hidden="true"]'));
  await field(page).focus();
  await page.keyboard.type('base');
  await shoot(page, 'shell-04-palette-query-light.png');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('Enter');
  await page.getByRole('heading', { name: 'Base64', level: 2 }).waitFor();
  await dialog(page).waitFor({ state: 'detached' });
  // Radix hands the focus over just after the dialog leaves the page.
  await page
    .waitForFunction(() => document.activeElement?.matches('main.kit-main'), null, { timeout: 2_000 })
    .catch(() => undefined);
  const went = await page.evaluate(() => ({
    hash: location.hash,
    focus: document.activeElement?.matches('main.kit-main') ?? false,
  }));
  check(
    'shell: ⌘K / Ctrl+K from a text field opens it; focus is kept inside, the page behind hidden; arrows and Enter go',
    trapped && hidden && went.hash === '#/tools/base64' && went.focus,
    JSON.stringify({ trapped, hidden, went }),
  );

  // Escape closes and gives the focus back where it was.
  const b64 = page.getByLabel('Input', { exact: true });
  await b64.focus();
  await page.keyboard.press(`${mod}+K`);
  await dialog(page).waitFor();
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  // Radix hands the focus back just after the dialog leaves the page.
  const back = await b64
    .evaluate(el => new Promise(r => setTimeout(() => r(el === document.activeElement), 300)))
    .catch(() => false);
  check('shell: Escape closes the palette and puts the focus back where it was', back);

  // «Compare code» with the editor focused: the editor hands the shortcut up; Escape gives the focus back to it.
  await page.evaluate(() => (location.hash = '#/compare'));
  await page.waitForFunction(
    () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') === 'ready',
    null,
    { timeout: 45_000 },
  );
  await sleep(500);
  const frameBox = await page.locator('iframe.kit-compare-frame').boundingBox();
  await page.mouse.click(frameBox.x + frameBox.width * 0.25, frameBox.y + 60);
  await sleep(200);
  const inEditor = await focusTag(page);
  await page.keyboard.press(`${mod}+K`);
  const opened = await dialog(page)
    .waitFor({ timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await page.keyboard.press('Escape');
  await dialog(page)
    .waitFor({ state: 'detached' })
    .catch(() => undefined);
  // Radix hands the focus back just after the dialog leaves the page.
  await page
    .waitForFunction(() => document.activeElement?.tagName === 'IFRAME', null, { timeout: 2_000 })
    .catch(() => undefined);
  const backInEditor = await focusTag(page);
  check(
    'shell: in «Compare code» the shortcut opens the palette while the editor has focus; Escape gives it back',
    inEditor === 'IFRAME' && opened && backInEditor === 'IFRAME',
    JSON.stringify({ inEditor, opened, backInEditor }),
  );

  // The editor's height under the toolbar.
  const heights = [];
  for (const [w, h] of [
    [1440, 900],
    [1280, 800],
    [1280, 720],
    [1024, 640],
    [1024, 600],
  ]) {
    await page.setViewportSize({ width: w, height: h });
    await sleep(250);
    heights.push(
      await page.evaluate(
        size => ({
          viewport: size,
          editor: Math.round(document.querySelector('.kit-compare-frame').getBoundingClientRect().height),
          toolbar: Math.round(document.querySelector('.kit-toolbar').getBoundingClientRect().height),
        }),
        `${w}x${h}`,
      ),
    );
  }
  shell.compareHeights = heights;
  await page.setViewportSize({ width: 1280, height: 800 });
  check(
    'shell: the toolbar leaves «Compare code»’s editor a usable height (at least 360 px at 1024 × 600)',
    heights.at(-1).editor >= 360,
    heights.map(x => `${x.viewport}: editor ${x.editor}, toolbar ${x.toolbar}`).join('; '),
  );
  await shoot(page, 'shell-05-compare-light.png');

  // The start page: the same shortcut focuses its field; no palette there.
  const start = await open('#/start');
  await start.getByRole('combobox', { name: 'Find a tool or search the web' }).waitFor();
  await sleep(300);
  await start.locator('h1').click();
  await start.keyboard.press(`${mod}+K`);
  await sleep(200);
  const startOk = await start.evaluate(
    () =>
      document.activeElement?.getAttribute('aria-label') === 'Find a tool or search the web' &&
      !document.querySelector('[role="dialog"]'),
  );
  check('shell: on the start page ⌘K / Ctrl+K focuses its own field — one search, not two', startOk);

  // Fuzzy matching, the same finder in both: an abbreviation on the start page, a misspelling in the palette.
  const startField = start.getByRole('combobox', { name: 'Find a tool or search the web' });
  await startField.fill('b64');
  const startRow = start.getByRole('option').first();
  const startFuzzy = { row: await startRow.innerText(), marked: await startRow.locator('mark').allInnerTexts() };
  await startField.fill('');
  await page.evaluate(() => (location.hash = '#/history'));
  await page.getByRole('heading', { name: 'History', level: 1 }).waitFor();
  await page.keyboard.press(`${mod}+K`);
  await dialog(page).waitFor();
  await field(page).fill('pswd');
  const paletteRow = dialog(page).getByRole('option').first();
  const paletteFuzzy = { row: await paletteRow.innerText(), marked: await paletteRow.locator('mark').allInnerTexts() };
  await shoot(page, 'shell-07-palette-fuzzy-light.png');
  await field(page).fill('pasword');
  const misspelt = await dialog(page).getByRole('option').first().innerText();
  await page.keyboard.press('Escape');
  await dialog(page).waitFor({ state: 'detached' });
  shell.fuzzy = { startFuzzy, paletteFuzzy, misspelt };
  check(
    "fuzzy: 'b64' finds Base64 on the start page, 'pswd' and 'pasword' find Password Generator in the palette; matched letters marked",
    /Base64/.test(startFuzzy.row) &&
      startFuzzy.marked.join('') === 'B64' &&
      /Password Generator/.test(paletteFuzzy.row) &&
      paletteFuzzy.marked.join('').toLowerCase() === 'pswd' &&
      /Password Generator/.test(misspelt),
    JSON.stringify(shell.fuzzy),
  );
  await start.close();

  // ---- the theme: none chosen = the system's light or dark, live ---------------------------------------------------
  await page.evaluate(async () => {
    localStorage.removeItem('theme-cache');
    await chrome.storage.local.remove('theme');
  });
  const system = watch(await ctx.newPage());
  await system.emulateMedia({ colorScheme: 'dark' });
  await system.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => (window.__modeAtDcl = document.documentElement.dataset.mode));
  });
  await system.goto(`${base}#/compare`);
  await system.waitForFunction(
    () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') === 'ready',
    null,
    { timeout: 45_000 },
  );
  await sleep(600);
  const editorFrame = system.frameLocator('iframe.kit-compare-frame');
  const darkAtLoad = {
    dcl: await system.evaluate(() => window.__modeAtDcl),
    page: await system.evaluate(() => document.documentElement.dataset.mode),
    editor: await editorFrame.locator('html').getAttribute('data-mode'),
  };
  // The editor's canvas repainted: the mean luminance of its frame (decoded in a page, as e2e-check.mjs does).
  const lum = async () => {
    const png = await system.locator('iframe.kit-compare-frame').screenshot();
    return page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
      let sum = 0;
      for (let i = 0; i < data.length; i += 4) sum += 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
      return Math.round(sum / (data.length / 4));
    }, png.toString('base64'));
  };
  const darkBytes = await lum();
  await system.emulateMedia({ colorScheme: 'light' });
  await editorFrame
    .locator('html[data-mode="light"]')
    .waitFor({ timeout: 5_000 })
    .catch(() => undefined);
  await sleep(600);
  const lightLive = {
    page: await system.evaluate(() => document.documentElement.dataset.mode),
    editor: await editorFrame.locator('html').getAttribute('data-mode'),
    sameDocument: await system.evaluate(() => window.__modeAtDcl !== undefined),
  };
  const lightBytes = await lum();
  const popup = watch(await ctx.newPage());
  await popup.emulateMedia({ colorScheme: 'dark' });
  await popup.goto(`chrome-extension://${id}/src/popup/index.html`);
  await popup.locator('html[data-mode]').waitFor();
  const popupDark = await popup.evaluate(() => document.documentElement.dataset.mode);
  await popup.emulateMedia({ colorScheme: 'light' });
  await sleep(300);
  const popupLight = await popup.evaluate(() => document.documentElement.dataset.mode);
  await popup.close();
  const note = await withSettings(ctx, base, async settings => ({
    checked: await settings
      .getByRole('radiogroup', { name: 'Theme mode' })
      .getByRole('radio', { checked: true })
      .innerText(),
    note: await settings.locator('[data-theme-note]').innerText(),
  }));
  shell.systemTheme = { darkAtLoad, lightLive, popupDark, popupLight, note, editorLuminance: [darkBytes, lightBytes] };
  check(
    'theme: none chosen follows the system — dark before the first paint, then light live on the page, in the editor ' +
      'and in the popup; Settings shows System',
    darkAtLoad.dcl === 'dark' &&
      darkAtLoad.page === 'dark' &&
      darkAtLoad.editor === 'dark' &&
      lightLive.page === 'light' &&
      lightLive.editor === 'light' &&
      lightLive.sameDocument &&
      lightBytes > darkBytes + 60 &&
      popupDark === 'dark' &&
      popupLight === 'light' &&
      /System/.test(note.checked) &&
      /^Follows your system/.test(note.note),
    JSON.stringify(shell.systemTheme),
  );
  await system.close();

  // ---- the user's shortcuts --------------------------------------------------------------------------------------
  const chosen = 'ControlOrMeta+Shift+U';
  const label = await withSettings(ctx, base, async settings => {
    const block = settings.locator('[data-settings="shortcuts"]');
    const json = block.getByLabel('JSON', { exact: true });
    await json.click();
    await settings.keyboard.press(chosen);
    await settings.waitForFunction(
      () => document.querySelector('[data-shortcut="open:tools/json"] input')?.value !== '',
    );
    // A conflict is said and not saved.
    const b64Field = block.getByLabel('Base64', { exact: true });
    await b64Field.click();
    await settings.keyboard.press(`${mod}+K`);
    const conflict = await block.locator('[data-shortcut="open:tools/base64"] [role="alert"]').innerText();
    await settings.keyboard.press('Escape');
    await block.scrollIntoViewIfNeeded();
    await shoot(settings, 'shell-06-settings-shortcuts-light.png');
    return { value: await json.inputValue(), conflict };
  });
  const other = await open('#/history');
  await other.getByRole('heading', { name: 'History', level: 1 }).waitFor();
  await other.keyboard.press(chosen);
  const fromOther = await other
    .waitForFunction(() => location.hash === '#/tools/json', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await other.evaluate(() => (location.hash = '#/compare'));
  await other.waitForFunction(
    () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') === 'ready',
    null,
    { timeout: 45_000 },
  );
  await sleep(500);
  const box2 = await other.locator('iframe.kit-compare-frame').boundingBox();
  await other.mouse.click(box2.x + box2.width * 0.75, box2.y + 60);
  await sleep(200);
  const focusedEditor = await focusTag(other);
  await other.keyboard.press(chosen);
  const fromEditor = await other
    .waitForFunction(() => location.hash === '#/tools/json', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  // Cleared in Settings: the open page stops taking it, without a reload.
  await withSettings(ctx, base, settings =>
    settings
      .locator('[data-settings="shortcuts"]')
      .getByRole('button', { name: 'Clear the shortcut for JSON', exact: true })
      .click(),
  );
  await other.evaluate(() => (location.hash = '#/history'));
  await other.getByRole('heading', { name: 'History', level: 1 }).waitFor();
  await sleep(300);
  await other.keyboard.press(chosen);
  await sleep(400);
  const afterClear = await other.evaluate(() => location.hash);
  shell.shortcuts = { label, fromOther, focusedEditor, fromEditor, afterClear };
  check(
    'shortcuts: one set in Settings opens its tool from another page and from the focused editor, and stops when cleared',
    /U$/.test(label.value) &&
      /already “Find a tool or section”/.test(label.conflict) &&
      fromOther &&
      focusedEditor === 'IFRAME' &&
      fromEditor &&
      afterClear === '#/history',
    JSON.stringify(shell.shortcuts),
  );
  await other.close();

  // ---- default shortcuts: nothing stored, the place opens — from another page and from the focused editor ------------
  const viaDefault = await open('#/history');
  await viaDefault.getByRole('heading', { name: 'History', level: 1 }).waitFor();
  await viaDefault.keyboard.press(`${mod}+Shift+E`);
  const compareByDefault = await viaDefault
    .waitForFunction(() => location.hash === '#/compare', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  await viaDefault.waitForFunction(
    () => document.querySelector('.kit-compare-counts')?.getAttribute('data-viewer-state') === 'ready',
    null,
    { timeout: 45_000 },
  );
  await sleep(500);
  const box3 = await viaDefault.locator('iframe.kit-compare-frame').boundingBox();
  await viaDefault.mouse.click(box3.x + box3.width * 0.25, box3.y + 60);
  await sleep(200);
  const editorFocused = await focusTag(viaDefault);
  await viaDefault.keyboard.press(`${mod}+Shift+X`);
  const toolsFromEditor = await viaDefault
    .waitForFunction(() => location.hash === '#/tools', null, { timeout: 5_000 })
    .then(() => true)
    .catch(() => false);
  const tooltip = await viaDefault
    .getByRole('navigation', { name: 'Sections' })
    .getByRole('link', { name: 'Compare code' })
    .getAttribute('title');
  shell.defaults = { compareByDefault, editorFocused, toolsFromEditor, tooltip };
  check(
    'default shortcuts: ⇧⌘E opens Compare code from another page, ⇧⌘X opens Tools from the focused editor; the sidebar says the key',
    compareByDefault &&
      editorFocused === 'IFRAME' &&
      toolsFromEditor &&
      /\(⇧⌘E\)$|\(Ctrl\+Shift\+E\)$/.test(tooltip ?? ''),
    JSON.stringify(shell.defaults),
  );

  // ---- the breadcrumb: where the page is; the page's title for the eye; switchable, live ------------------------------
  await viaDefault.evaluate(() => (location.hash = '#/tools/base64'));
  await viaDefault.getByRole('heading', { name: 'Base64', level: 2 }).waitFor();
  const crumb = viaDefault.getByRole('navigation', { name: 'Breadcrumb' });
  const crumbState = await viaDefault.evaluate(() => {
    const nav = document.querySelector('nav.kit-breadcrumb');
    const title = document.querySelector('.kit-tool-page-title').getBoundingClientRect();
    return {
      items: [...(nav?.querySelectorAll('li') ?? [])].map(li => li.textContent),
      list: nav?.querySelector('ol') !== null,
      current: nav?.querySelector('[aria-current="page"]')?.textContent ?? null,
      link: nav?.querySelector('a')?.getAttribute('href') ?? null,
      titleForTheEye: title.width > 1 && title.height > 1,
    };
  });
  await shoot(viaDefault, 'shell-08-breadcrumb-light.png');
  // A narrow window: one row, the find button whole.
  await viaDefault.setViewportSize({ width: 600, height: 700 });
  await sleep(250);
  const narrow = await viaDefault.evaluate(() => {
    const bar = document.querySelector('.kit-toolbar').getBoundingClientRect();
    const find = document.querySelector('.kit-toolbar-find').getBoundingClientRect();
    return {
      bar: Math.round(bar.height),
      findInside: find.left >= bar.left && find.right <= bar.right + 0.5,
      findWidth: Math.round(find.width),
    };
  });
  await shoot(viaDefault, 'shell-09-breadcrumb-narrow-light.png');
  await viaDefault.setViewportSize({ width: 1280, height: 800 });
  // Off in Settings: gone from this open page without a reload, the title shown again; then on again.
  await withSettings(ctx, base, settings => settings.getByRole('switch', { name: 'Breadcrumb' }).click());
  await crumb.waitFor({ state: 'detached', timeout: 5_000 }).catch(() => undefined);
  const off = await viaDefault.evaluate(() => ({
    crumb: !!document.querySelector('nav.kit-breadcrumb'),
    titleWidth: Math.round(document.querySelector('.kit-tool-page-title').getBoundingClientRect().width),
    stored: undefined,
  }));
  off.stored = (
    await viaDefault.evaluate(async () => (await chrome.storage.local.get('shellSettings')).shellSettings)
  )?.breadcrumb;
  await shoot(viaDefault, 'shell-10-breadcrumb-off-light.png');
  await withSettings(ctx, base, async settings => {
    await settings.getByRole('switch', { name: 'Breadcrumb' }).click();
    await settings.locator('[data-setting="breadcrumb"]').scrollIntoViewIfNeeded();
    await shoot(settings, 'shell-11-settings-breadcrumb-light.png');
  });
  await crumb.waitFor({ timeout: 5_000 });
  shell.breadcrumb = { on: crumbState, narrow, off };
  check(
    'breadcrumb: an ordered list in a labelled nav, Tools a link, the tool the current page, its heading for screen ' +
      'readers only; one row in a narrow window; off in Settings — gone live, the title back; on again',
    JSON.stringify(crumbState.items) === JSON.stringify(['Tools', 'Base64']) &&
      crumbState.list &&
      crumbState.current === 'Base64' &&
      crumbState.link === '#/tools' &&
      !crumbState.titleForTheEye &&
      narrow.bar === 40 &&
      narrow.findInside &&
      !off.crumb &&
      off.titleWidth > 1 &&
      off.stored === false,
    JSON.stringify(shell.breadcrumb),
  );
  await viaDefault.close();

  // ---- screenshots in the default dark theme ---------------------------------------------------------------------
  await themeMode(ctx, base, 'Dark');
  await page.evaluate(() => (location.hash = '#/tools/base64'));
  await page.getByRole('heading', { name: 'Base64', level: 2 }).waitFor();
  await sleep(300);
  await shoot(page, 'shell-01-tool-dark.png');
  await page.getByRole('button', { name: 'Find a tool or section…' }).click();
  await dialog(page).waitFor();
  await shoot(page, 'shell-03-palette-dark.png');
  await page.keyboard.press('Escape');
  await page.evaluate(() => (location.hash = '#/tools'));
  await page.getByRole('navigation', { name: 'All tools' }).waitFor();
  await shoot(page, 'shell-02-tools-overview-dark.png');
  await page.evaluate(() => (location.hash = '#/compare'));
  await sleep(1500);
  await shoot(page, 'shell-05-compare-dark.png');
  await withSettings(ctx, base, async settings => {
    await settings.locator('[data-settings="shortcuts"]').scrollIntoViewIfNeeded();
    await shoot(settings, 'shell-06-settings-shortcuts-dark.png');
  });
  await themeMode(ctx, base, 'Light');
  await page.evaluate(() => (location.hash = '#/tools/base64'));
  await page.getByRole('heading', { name: 'Base64', level: 2 }).waitFor();
  await sleep(300);
  await shoot(page, 'shell-01-tool-light.png');
  await themeMode(ctx, base, 'System');
  await page.close();

  shell.errors = errors;
  check('shell: no console errors on the way', errors.length === 0, errors.join(' | '));
};
