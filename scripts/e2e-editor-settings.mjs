// The editor's settings in the built extension with the rebuilt editor module (D39, stages 1a and 1b;
// extension/src/editorSettings/, src/app/editor/, src/app/settings/EditorSettingsGroup.tsx): Tab inserts what applies —
// in a scratch, in a project's file of the demo and on a side of «Compare code» (the text read back from the module,
// `viewer/read`); a Go file gets tabs and a YAML file two spaces by the built-in language rows; a file indented by four
// spaces is detected as four; the indent indicator says what applies and where it came from, and a choice made there
// wins for that file (one side of «Compare code» only) and goes back to automatic; a value changed in Settings → Editor
// (in another tab) reaches the open editor without a reload; a stored value survives a reload of both pages. Settings →
// Editor and the indicator with its popup in light and dark, wide and narrow, with nothing cut off; not one console
// error or page error. Screenshots where --shots says. Run by scripts/e2e-check.mjs (step `editor-settings`).

/* global document, location, chrome, addEventListener, removeEventListener -- page.evaluate callbacks run in the pages */

import { themeMode } from './e2e-theme.mjs';

// The store's record (extension/src/editorSettings/storage.ts) and the scratches' records (src/projects/scratch/).
const SETTINGS_KEY = 'editorSettings';
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

  // ---- how it looks: Settings → Editor and the indicator's popup, light and dark, wide and narrow -----------------
  // With the defaults again: what a person sees first.
  await page.evaluate(async key => chrome.storage.local.remove(key), SETTINGS_KEY);
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
      looks.push({ mode, size, settingsFit, popupFit, barFit });
    }
  }
  await page.setViewportSize({ width: 1440, height: 900 });
  await themeMode(ctx, base, 'System');
  result.looks = looks;
  check(
    'editor settings: Settings → Editor, the indicator and its popup fit — nothing cut off — at 1440×900 and 800×700, light and dark',
    looks.every(
      l =>
        !l.settingsFit.overflowX &&
        l.settingsFit.clipped.length === 0 &&
        l.popupFit?.inside &&
        l.barFit.clipped.length === 0,
    ),
    JSON.stringify(looks),
  );

  // ---- tidy: this step's records go ---------------------------------------------------------------------------------
  await page.evaluate(
    async ([ids, key]) => chrome.storage.local.remove([key, 'scratches', ...ids.map(i => `scratch:${i}`)]),
    [SCRATCHES.map(s => s.id), SETTINGS_KEY],
  );
  check('editor settings: no console error or page error', errors.length === 0, errors.slice(0, 5).join(' | '));
  await page.close();
};
