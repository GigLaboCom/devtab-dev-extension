// The strip of the editor's buttons in the built extension with the rebuilt editor module (src/app/editor/EditorStrip.tsx,
// crates/review-view/src/editor_commands.rs): on a scratch, a demo project's file and a side of «Compare code» each
// button does what its key does — Undo and Redo, Select all and Copy, Cut, Paste, Indent and Outdent, Find — read back
// from the module (`viewer/read`) and from the test browser's own clipboard (never the system's: the permission is
// given by CDP to this browser, as scripts/e2e-compare.mjs does); Paste refused by Chrome says the seam's sentence and
// inserts nothing; Copy all; the two toggles change the editor and not the saved settings; Wrap is greyed side by side;
// a read-only file keeps only what makes sense; the project file's Save is ⌘S's; at a narrow width the rest goes into
// the more menu, which runs the same commands. Screenshots of the strip — wide, narrow with the menu open, read only,
// «Compare code» — light and dark, where --shots says. Run by scripts/e2e-check.mjs (step `editor-strip`); the opened
// file's strip is checked with the companion (scripts/e2e-projects/openFiles.mjs, `exerciseStrip`).

/* global document, location, addEventListener, removeEventListener, chrome -- page.evaluate callbacks run in the pages */

const MAC = process.platform === 'darwin';
const MOD = MAC ? 'Meta' : 'Control';
const KEY = {
  undo: `${MOD}+KeyZ`,
  redo: MAC ? 'Meta+Shift+KeyZ' : 'Control+KeyY',
  selectAll: `${MOD}+KeyA`,
  copy: `${MOD}+KeyC`,
  cut: `${MOD}+KeyX`,
  paste: `${MOD}+KeyV`,
  indent: `${MOD}+BracketRight`,
  outdent: `${MOD}+BracketLeft`,
  find: `${MOD}+KeyF`,
  start: MAC ? 'Meta+ArrowUp' : 'Control+Home',
};
const NAMES = {
  save: 'Save now',
  undo: 'Undo',
  redo: 'Redo',
  cut: 'Cut',
  copy: 'Copy',
  copyAll: 'Copy all',
  paste: 'Paste',
  selectAll: 'Select all',
  indent: 'Indent',
  outdent: 'Outdent',
  find: 'Find',
  softWrap: 'Wrap long lines',
  whitespace: 'Show whitespace',
  more: 'More',
};
const ORDER = [
  'Undo',
  'Redo',
  'Cut',
  'Copy',
  'Copy all',
  'Paste',
  'Select all',
  'Indent',
  'Outdent',
  'Find',
  'Wrap long lines',
  'Show whitespace',
];

/** The test browser's own clipboard for the extension's pages: read and written there, allowed by CDP. */
export const clipboardOf = (page, origin) => {
  const sessions = [];
  return {
    grant: async () => {
      const cdp = await page.context().newCDPSession(page);
      sessions.push(cdp);
      await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });
    },
    read: () => page.evaluate(() => navigator.clipboard.readText()),
    write: text => page.evaluate(t => navigator.clipboard.writeText(t), text),
  };
};

/** The text a side's editor holds now, asked as the page asks it (`viewer/read`). */
export const editorText = (page, frameSelector, side = 'new') =>
  page.evaluate(
    ([selector, side]) =>
      new Promise((resolve, reject) => {
        const el = document.querySelector(selector);
        const asked = 700_000 + Math.floor(Math.random() * 1000);
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
    [frameSelector, side],
  );

/** The strip's buttons, in order, and which are live. */
export const stripState = async toolbar =>
  toolbar.evaluate(el =>
    [...el.querySelectorAll(':scope > button')].map(b => ({
      name: b.getAttribute('aria-label'),
      live: b.getAttribute('aria-disabled') !== 'true',
      pressed: b.getAttribute('aria-pressed'),
    })),
  );

/**
 * Every button of a strip against its key, on an editable editor (`frame`: its iframe; `side`: which half takes the
 * click). Each command starts from the same text, by the key and by the button, and the two results must be equal —
 * read back from the module and from the clipboard. Returns what was seen.
 */
export const exerciseStrip = async ({ page, frame, frameSelector, toolbar, side = 'new', clipboard, sleep }) => {
  const seen = {};
  const button = name => toolbar.getByRole('button', { name, exact: true });
  const text = () => editorText(page, frameSelector, side);
  const settle = () => sleep(350);
  const press = async key => {
    await page.keyboard.press(key);
    await settle();
  };
  const click = async name => {
    await button(name).click();
    await settle();
  };
  /** Waits (a little) until the button is live: the module's standing has come back. */
  const live = name =>
    toolbar
      .locator(`:scope > button[aria-label="${name}"]:not([aria-disabled="true"])`)
      .waitFor({ timeout: 5_000 })
      .catch(() => undefined);
  /** Into the editor, the caret at the start of the text. */
  const intoEditor = async () => {
    const box = await frame.boundingBox();
    // «Compare code» shows both sides in one frame: the half of the side; a project's frame shows the file alone.
    const share = frameSelector.includes('compare') ? (side === 'old' ? 0.25 : 0.75) : 0.5;
    const x = box.x + box.width * share;
    await page.mouse.click(x, box.y + 10);
    await press(KEY.start);
  };

  await intoEditor();
  const start = await text();
  seen.start = start;
  seen.cutCopyGreyedWithoutSelection =
    !(await button(NAMES.cut).evaluate(el => el.getAttribute('aria-disabled') !== 'true')) &&
    !(await button(NAMES.copy).evaluate(el => el.getAttribute('aria-disabled') !== 'true'));

  // Undo and Redo.
  await page.keyboard.type('X');
  await settle();
  const typed = await text();
  await press(KEY.undo);
  const undoneByKey = await text();
  await press(KEY.redo);
  const redoneByKey = await text();
  await click(NAMES.undo);
  const undoneByButton = await text();
  await click(NAMES.redo);
  const redoneByButton = await text();
  await press(KEY.undo);
  seen.undo = {
    ok: undoneByKey === start && undoneByButton === undoneByKey && redoneByKey === typed && redoneByButton === typed,
    typed: JSON.stringify(typed.slice(0, 12)),
  };

  // Select all, then Copy.
  await clipboard.write('nothing yet');
  await press(KEY.selectAll);
  await press(KEY.copy);
  const copiedByKey = await clipboard.read();
  await clipboard.write('nothing yet');
  await intoEditor();
  await click(NAMES.selectAll);
  await live(NAMES.copy);
  const copyLive = await button(NAMES.copy).evaluate(el => el.getAttribute('aria-disabled') !== 'true');
  await click(NAMES.copy);
  const copiedByButton = await clipboard.read();
  seen.copy = { ok: copiedByKey === start && copiedByButton === start && copyLive, copyLive };

  // Cut, and one Undo brings it back.
  await clipboard.write('nothing yet');
  await press(KEY.selectAll);
  await press(KEY.cut);
  const cutByKey = { text: await text(), clipboard: await clipboard.read() };
  await press(KEY.undo);
  const afterKeyUndo = await text();
  await clipboard.write('nothing yet');
  await click(NAMES.selectAll);
  await click(NAMES.cut);
  const cutByButton = { text: await text(), clipboard: await clipboard.read() };
  await click(NAMES.undo);
  const afterButtonUndo = await text();
  seen.cut = {
    ok:
      cutByKey.text === '' &&
      cutByButton.text === '' &&
      cutByKey.clipboard === start &&
      cutByButton.clipboard === start &&
      afterKeyUndo === start &&
      afterButtonUndo === start,
  };

  // Paste at the caret, one edit: Undo takes it back.
  await clipboard.write('pasted\n');
  await intoEditor();
  await press(KEY.paste);
  const pastedByKey = await text();
  await press(KEY.undo);
  await intoEditor();
  await click(NAMES.paste);
  const pastedByButton = await text();
  await click(NAMES.undo);
  const afterPasteUndo = await text();
  seen.paste = {
    ok: pastedByKey === `pasted\n${start}` && pastedByButton === pastedByKey && afterPasteUndo === start,
    pasted: JSON.stringify(pastedByButton.slice(0, 16)),
  };

  // Indent and Outdent.
  await intoEditor();
  await press(KEY.indent);
  const indentedByKey = await text();
  await press(KEY.outdent);
  const outdentedByKey = await text();
  await click(NAMES.indent);
  const indentedByButton = await text();
  await click(NAMES.outdent);
  const outdentedByButton = await text();
  seen.indent = {
    ok:
      indentedByKey !== start &&
      indentedByButton === indentedByKey &&
      outdentedByKey === start &&
      outdentedByButton === start,
    indented: JSON.stringify(indentedByButton.slice(0, 12)),
  };

  // Copy all: the whole text, nothing selected.
  await clipboard.write('nothing yet');
  await intoEditor();
  await click(NAMES.copyAll);
  seen.copyAll = { ok: (await clipboard.read()) === start };

  // Find opens the editor's own search, as its key does: the panel appears over the text, and what is typed then goes
  // into its field (it finds and marks the matches), not into the text.
  const band = async () => {
    const box = await frame.boundingBox();
    return page.screenshot({ clip: { x: box.x, y: box.y, width: box.width, height: 40 } });
  };
  const findBy = async open => {
    await intoEditor();
    const before = await band();
    await open();
    await page.keyboard.type('zq');
    await settle();
    const opened = !(await band()).equals(before);
    const untouched = (await text()) === start;
    await press('Escape');
    const closed = (await band()).equals(before) || (await text()) === start;
    return { opened, untouched, closed };
  };
  const findByButton = await findBy(() => click(NAMES.find));
  const findByKey = await findBy(() => press(KEY.find));
  seen.find = {
    ok: findByButton.opened && findByButton.untouched && findByKey.opened && findByKey.untouched,
    button: findByButton,
    key: findByKey,
  };
  seen.end = (await text()) === start;
  return seen;
};

/** The four commands every strip must keep live on a read-only editor, and the toggles. */
const READ_ONLY_LIVE = ['Copy all', 'Select all', 'Find', 'Show whitespace'];

export const runEditorStripChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const origin = `chrome-extension://${id}`;
  const errors = [];
  const result = (report.editorStrip = {});
  const page = await ctx.newPage();
  page.on('console', m => m.type() === 'error' && errors.push(m.text()));
  page.on('pageerror', e => errors.push(String(e)));
  const clipboard = clipboardOf(page, origin);
  const projectsFrame = 'iframe.kit-projects-frame';
  const frame = page.locator(projectsFrame);
  const editorStrip = page.getByRole('toolbar', { name: 'Editor', exact: true });
  const shots = async (name, target = page) => {
    for (const scheme of ['light', 'dark']) {
      await page.emulateMedia({ colorScheme: scheme });
      await sleep(400);
      await shoot(target, `strip-${name}-${scheme}.png`);
    }
    await page.emulateMedia({ colorScheme: 'light' });
    await sleep(200);
  };
  const shown = async () => {
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await page.waitForFunction(sel => Number(document.querySelector(sel)?.dataset.shown ?? 0) > 0, projectsFrame, {
      timeout: 45_000,
    });
    await editorStrip.waitFor({ timeout: 10_000 });
    await sleep(500);
  };
  const storedSettings = () =>
    page.evaluate(async () => (await chrome.storage.local.get('editorSettings')).editorSettings ?? null);

  // ---- a scratch: the set, Paste refused, every button against its key, the toggles, the more menu ----------------
  const LONG = `fn main() {\n    let greeting = "hello world";\n    println!("{greeting}");\n}\n// ${'a long comment line that runs past the edge of the editor and wraps when wrapping is on, '.repeat(4)}\n`;
  const scratch = { id: 's_strip00rs0', name: 'strip', language: 'rust', text: LONG };
  await page.goto(`${base}#/settings`);
  await page.getByRole('heading', { name: 'Editor', level: 2 }).waitFor({ timeout: 15_000 });
  await page.evaluate(async s => {
    const now = Date.now();
    const kept = (await chrome.storage.local.get('scratches')).scratches;
    const items = (kept?.items ?? []).filter(i => i.id !== s.id);
    await chrome.storage.local.set({
      scratches: {
        version: 1,
        lastLanguage: kept?.lastLanguage ?? 'text',
        items: [
          ...items,
          { id: s.id, name: s.name, language: s.language, createdMs: now, updatedMs: now, chars: s.text.length },
        ],
      },
      [`scratch:${s.id}`]: s.text,
    });
  }, scratch);
  await page.goto(`${base}#/projects/scratches/${scratch.id}`);
  await shown();
  const scratchSet = await stripState(editorStrip);
  result.scratchSet = scratchSet;
  check(
    'editor strip: a scratch — a toolbar named “Editor” with the buttons in their order and groups, no Save (a scratch saves itself)',
    JSON.stringify(scratchSet.map(b => b.name)) === JSON.stringify(ORDER) &&
      (await editorStrip.locator(':scope > .kit-editor-strip-line').count()) === 4 &&
      scratchSet.find(b => b.name === 'Wrap long lines')?.pressed === 'false',
    scratchSet.map(b => `${b.name}${b.live ? '' : ' (greyed)'}`).join(', '),
  );
  await shots('scratch-wide');

  // Paste refused: Chrome has not allowed reading the clipboard here.
  const beforeRefused = await editorText(page, projectsFrame);
  await editorStrip.getByRole('button', { name: 'Paste', exact: true }).click();
  const refusedNote = page.locator('.kit-projects-note[role="status"]');
  const refused = await refusedNote
    .waitFor({ timeout: 10_000 })
    .then(() => refusedNote.innerText())
    .catch(() => '');
  const readState = await page.evaluate(
    async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state,
  );
  result.pasteRefused = { refused, readState };
  check(
    'editor strip: Paste refused by Chrome — the seam’s own sentence, quietly (not an error); nothing inserted; no permission asked',
    /Chrome did not allow reading the clipboard/.test(refused) &&
      (await refusedNote.getAttribute('data-tone')) === 'info' &&
      (await editorText(page, projectsFrame)) === beforeRefused,
    `${refused} (clipboard-read: ${readState})`,
  );

  await clipboard.grant();
  const settingsBefore = JSON.stringify(await storedSettings());
  const scratchSeen = await exerciseStrip({
    page,
    frame,
    frameSelector: projectsFrame,
    toolbar: editorStrip,
    clipboard,
    sleep,
  });
  result.scratch = scratchSeen;
  for (const [command, label] of [
    ['undo', 'Undo and Redo'],
    ['copy', 'Select all and Copy (Copy greyed until something is selected)'],
    ['cut', 'Cut (one Undo brings it back)'],
    ['paste', 'Paste, once Chrome allows it (one edit: one Undo)'],
    ['indent', 'Indent and Outdent'],
    ['find', 'Find (the editor’s own search opens over the text; what is typed goes into its field, not the text)'],
  ])
    check(
      `editor strip: a scratch — ${label} by the button is what the key does`,
      scratchSeen[command]?.ok,
      JSON.stringify(scratchSeen[command]),
    );
  check('editor strip: a scratch — Copy all puts the whole text on the clipboard', scratchSeen.copyAll.ok);
  check(
    'editor strip: a scratch — Cut and Copy greyed while nothing is selected; the text as it was after every pair',
    scratchSeen.cutCopyGreyedWithoutSelection && scratchSeen.end,
  );

  // The toggles: the editor changes, the saved settings do not.
  const shot = () => frame.screenshot();
  const plain = await shot();
  await editorStrip.getByRole('button', { name: 'Wrap long lines', exact: true }).click();
  await sleep(600);
  const wrapped = await shot();
  const wrapPressed = await editorStrip
    .getByRole('button', { name: 'Wrap long lines', exact: true })
    .getAttribute('aria-pressed');
  await editorStrip.getByRole('button', { name: 'Show whitespace', exact: true }).click();
  await sleep(600);
  const dotted = await shot();
  const whitespacePressed = await editorStrip
    .getByRole('button', { name: 'Show whitespace', exact: true })
    .getAttribute('aria-pressed');
  await shots('scratch-toggles-on');
  const settingsAfter = JSON.stringify(await storedSettings());
  result.toggles = { wrapPressed, whitespacePressed, settingsBefore, settingsAfter };
  check(
    'editor strip: Wrap long lines and Show whitespace change the editor (pressed, the text drawn otherwise) and not the saved settings',
    wrapPressed === 'true' &&
      whitespacePressed === 'true' &&
      !plain.equals(wrapped) &&
      !wrapped.equals(dotted) &&
      settingsBefore === settingsAfter,
    JSON.stringify(result.toggles),
  );
  // Back off for the next checks; a reload forgets the choice (it lasts while the file is open).
  await page.reload();
  await shown();
  const afterReload = await stripState(editorStrip);
  check(
    'editor strip: the toggles’ choice lasts while the file is open — after a reload the saved setting holds again',
    afterReload.find(b => b.name === 'Wrap long lines')?.pressed === 'false' &&
      afterReload.find(b => b.name === 'Show whitespace')?.pressed === 'false',
  );

  // Narrow: the rest goes into the more menu, in order, and its lines run the commands.
  let narrowWidth = 0;
  for (const width of [760, 640, 560, 480, 420, 380, 340]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(500);
    if ((await editorStrip.getByRole('button', { name: 'More', exact: true }).count()) > 0) {
      narrowWidth = width;
      break;
    }
  }
  const kept = (await stripState(editorStrip)).map(b => b.name);
  const more = editorStrip.getByRole('button', { name: 'More', exact: true });
  await more.click();
  const menu = page.getByRole('menu');
  await menu.waitFor({ timeout: 5_000 });
  const lines = await menu.evaluate(el =>
    [...el.querySelectorAll('[role^="menuitem"]')].map(item => ({
      id: item.getAttribute('data-control'),
      text: item.textContent,
      disabled: item.hasAttribute('data-disabled'),
      checked: item.getAttribute('aria-checked'),
    })),
  );
  await sleep(300);
  await shoot(page, 'strip-scratch-narrow-menu-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(400);
  await shoot(page, 'strip-scratch-narrow-menu-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  const keptNames = kept.filter(n => n !== 'More');
  const expectedRest = ORDER.slice(keptNames.length);
  result.narrow = { width: narrowWidth, kept, lines };
  const whitespaceLine = lines.find(l => l.id === 'whitespace');
  check(
    'editor strip: at a narrow width the controls left off from the end are the more menu’s lines, in order, with their keys; the toggles checkable',
    narrowWidth > 0 &&
      JSON.stringify(keptNames) === JSON.stringify(ORDER.slice(0, keptNames.length)) &&
      lines.length === expectedRest.length &&
      whitespaceLine?.checked === 'false' &&
      // Every line of a command with a key names it (the toggles have none).
      lines.filter(l => !['copyAll', 'softWrap', 'whitespace'].includes(l.id)).every(l => /⌘|Ctrl/.test(l.text ?? '')),
    `${narrowWidth}px: kept ${keptNames.join(', ')}; menu ${lines.map(l => l.id).join(', ')}`,
  );
  // A line pressed is its button pressed: Show whitespace from the menu turns the toggle on.
  await menu.locator('[data-control="whitespace"]').click();
  await sleep(500);
  await more.click();
  await menu.waitFor({ timeout: 5_000 });
  const checkedNow = await menu.locator('[data-control="whitespace"]').getAttribute('aria-checked');
  await page.keyboard.press('Escape');
  check(
    'editor strip: a line of the more menu does what its button does (Show whitespace, checked after)',
    checkedNow === 'true',
    checkedNow,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(400);

  // ---- a demo project's file: Save is ⌘S's, and every button against its key ---------------------------------------
  await page.goto(`${base}#/projects/p_demo0settl/main.go`);
  await page.waitForFunction(sel => document.querySelector(sel)?.dataset.mode === 'file', projectsFrame, {
    timeout: 45_000,
  });
  await shown();
  const projectSet = await stripState(editorStrip);
  const save = editorStrip.getByRole('button', { name: 'Save now', exact: true });
  check(
    'editor strip: a project’s file — Save first, apart, greyed while nothing new waits; then the editor’s buttons in order',
    projectSet[0]?.name === 'Save now' &&
      projectSet[0]?.live === false &&
      JSON.stringify(projectSet.slice(1).map(b => b.name)) === JSON.stringify(ORDER),
    projectSet.map(b => `${b.name}${b.live ? '' : ' (greyed)'}`).join(', '),
  );
  const projectSeen = await exerciseStrip({
    page,
    frame,
    frameSelector: projectsFrame,
    toolbar: editorStrip,
    clipboard,
    sleep,
  });
  result.project = projectSeen;
  const projectOk = ['undo', 'copy', 'cut', 'paste', 'indent', 'copyAll', 'find'].every(k => projectSeen[k]?.ok);
  check(
    'editor strip: a project’s file — every button (Undo, Redo, Select all, Copy, Cut, Paste, Indent, Outdent, Copy all, Find) does what its key does',
    projectOk && projectSeen.end,
    JSON.stringify(projectSeen),
  );
  // An edit, then Save: the strip's Save is the save shortcut's action.
  const box = await frame.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 10);
  await page.keyboard.press('End');
  await page.keyboard.type(' // saved');
  await page
    .waitForFunction(
      () => document.querySelector('[data-control="save"]')?.getAttribute('aria-disabled') !== 'true',
      null,
      {
        timeout: 5_000,
      },
    )
    .catch(() => undefined);
  // At once: the section's autosave writes by itself a second after the typing pauses.
  const saveLive = (await save.getAttribute('aria-disabled')) !== 'true';
  if (saveLive) await save.click({ timeout: 2_000 });
  const saved = await page
    .waitForFunction(() => document.querySelector('.kit-projects-save')?.getAttribute('data-state') === 'saved', null, {
      timeout: 10_000,
    })
    .then(
      () => true,
      () => false,
    );
  await sleep(500);
  const saveGreyedAgain = (await save.getAttribute('aria-disabled')) === 'true';
  await shots('project-file');
  check(
    'editor strip: a project’s file — after an edit Save is live; pressed, the file is saved (as ⌘S does) and Save greys again',
    saveLive && saved && saveGreyedAgain,
    JSON.stringify({ saveLive, saved, saveGreyedAgain }),
  );

  // Narrower, beside the side panel: more of the strip goes into its menu — Save stays at the head, each line names its
  // key, a greyed line says why under its label.
  let projectWidth = 0;
  const hiddenAt = {};
  for (const width of [1100, 1000, 900, 820, 760, 700, 640, 580]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(500);
    hiddenAt[width] = Number((await editorStrip.getAttribute('data-hidden')) ?? 0);
    if (hiddenAt[width] >= 4) {
      projectWidth = width;
      break;
    }
  }
  if (!projectWidth) {
    // The narrowest that hid anything.
    projectWidth = Number(Object.keys(hiddenAt).find(w => hiddenAt[w] > 0) ?? 0);
    if (projectWidth) await page.setViewportSize({ width: projectWidth, height: 900 });
    await sleep(500);
  }
  const projectKept = (await stripState(editorStrip)).map(b => b.name);
  await editorStrip.getByRole('button', { name: 'More', exact: true }).click();
  const projectMenu = page.getByRole('menu');
  await projectMenu.waitFor({ timeout: 5_000 });
  const projectLines = await projectMenu.evaluate(el =>
    [...el.querySelectorAll('[role^="menuitem"]')].map(item => ({
      id: item.getAttribute('data-control'),
      text: item.textContent,
      disabled: item.hasAttribute('data-disabled'),
    })),
  );
  await sleep(300);
  await shoot(page, 'strip-project-narrow-menu-light.png');
  await page.emulateMedia({ colorScheme: 'dark' });
  await sleep(400);
  await shoot(page, 'strip-project-narrow-menu-dark.png');
  await page.emulateMedia({ colorScheme: 'light' });
  await page.keyboard.press('Escape');
  result.projectNarrow = { width: projectWidth, kept: projectKept, lines: projectLines };
  check(
    'editor strip: a project’s file beside the side panel — Save and the start of the strip kept, the rest in the more menu in order with their keys and separators',
    projectWidth > 0 &&
      projectKept[0] === 'Save now' &&
      projectKept.at(-1) === 'More' &&
      JSON.stringify([...projectKept.slice(1, -1), ...projectLines.map(l => NAMES[l.id])]) === JSON.stringify(ORDER) &&
      projectLines
        .filter(l => !['copyAll', 'softWrap', 'whitespace'].includes(l.id))
        .every(l => /⌘|Ctrl/.test(l.text ?? '')),
    `${projectWidth}px (hidden by width ${JSON.stringify(hiddenAt)}): kept ${projectKept.join(', ')}; menu ${projectLines.map(l => `${l.id}${l.disabled ? ' (greyed)' : ''}`).join(', ')}`,
  );
  await page.setViewportSize({ width: 1440, height: 900 });
  await sleep(400);

  // The same file as a diff: read only, Wrap greyed with the reason.
  await page.getByRole('radio', { name: 'Diff', exact: true }).click();
  await page.waitForFunction(sel => document.querySelector(sel)?.dataset.mode === 'diff', projectsFrame, {
    timeout: 20_000,
  });
  await sleep(700);
  const diffSet = await stripState(editorStrip);
  await editorStrip.getByRole('button', { name: 'Wrap long lines', exact: true }).hover();
  const wrapTip = await page
    .getByRole('tooltip')
    .first()
    .innerText({ timeout: 3_000 })
    .catch(() => '');
  check(
    'editor strip: a diff (side by side) — no Save (a diff is not the file); Copy all, Select all, Find and Show whitespace live; Wrap long lines greyed with the reason in its tooltip',
    !diffSet.some(b => b.name === 'Save now') &&
      READ_ONLY_LIVE.every(name => diffSet.find(b => b.name === name)?.live) &&
      diffSet.find(b => b.name === 'Wrap long lines')?.live === false &&
      /do not wrap/.test(wrapTip),
    `${diffSet
      .filter(b => b.live)
      .map(b => b.name)
      .join(', ')}; ${wrapTip}`,
  );

  // ---- a read-only project's file ----------------------------------------------------------------------------------
  await page.goto(`${base}#/projects/p_demo0notes/README.md`);
  await page.waitForFunction(sel => document.querySelector(sel)?.dataset.mode === 'file', projectsFrame, {
    timeout: 45_000,
  });
  await shown();
  const readOnlySet = await stripState(editorStrip);
  await save.hover();
  const saveTip = await page
    .getByRole('tooltip')
    .first()
    .innerText({ timeout: 3_000 })
    .catch(() => '');
  await page.mouse.move(0, 0);
  await sleep(300);
  await shots('read-only');
  check(
    'editor strip: a read-only file — Save greyed with the page’s own reason; Copy all, Select all, Find and the toggles live, the rest greyed',
    readOnlySet[0]?.name === 'Save now' &&
      !readOnlySet[0].live &&
      /read only/i.test(saveTip) &&
      JSON.stringify(readOnlySet.filter(b => b.live).map(b => b.name)) ===
        JSON.stringify(['Copy all', 'Select all', 'Find', 'Wrap long lines', 'Show whitespace']),
    `${readOnlySet
      .filter(b => b.live)
      .map(b => b.name)
      .join(', ')}; Save: ${saveTip}`,
  );
  // On it, Select all makes Copy live; Copy copies.
  await clipboard.write('nothing yet');
  await editorStrip.getByRole('button', { name: 'Select all', exact: true }).click();
  await sleep(400);
  await editorStrip.getByRole('button', { name: 'Copy', exact: true }).click();
  await sleep(400);
  const readOnlyCopied = await clipboard.read();
  check(
    'editor strip: a read-only file — Select all, then Copy copies the text',
    readOnlyCopied === (await editorText(page, projectsFrame)),
    JSON.stringify(readOnlyCopied.slice(0, 20)),
  );

  // ---- «Compare code»: a strip over each side, under the side's own bar ---------------------------------------------
  await page.goto(`${base}#/compare`);
  const counts = page.locator('.kit-compare-counts');
  await counts.and(page.locator('[data-viewer-state="ready"]')).waitFor({ timeout: 45_000 });
  await sleep(800);
  const oldStrip = page.getByRole('toolbar', { name: 'Editor of the original side', exact: true });
  const newStrip = page.getByRole('toolbar', { name: 'Editor of the changed side', exact: true });
  const compareSets = { old: await stripState(oldStrip), new: await stripState(newStrip) };
  await newStrip.getByRole('button', { name: 'Wrap long lines', exact: true }).hover();
  const compareWrapTip = await page
    .getByRole('tooltip')
    .first()
    .innerText({ timeout: 3_000 })
    .catch(() => '');
  await page.mouse.move(0, 0);
  await page
    .getByRole('tooltip')
    .waitFor({ state: 'detached', timeout: 5_000 })
    .catch(() => undefined);
  check(
    'editor strip: «Compare code» — a strip over each side, read only by default (Copy all, Select all, Find, Show whitespace live), no Save (the side bar has it), Wrap greyed with the reason',
    ['old', 'new'].every(
      side =>
        JSON.stringify(compareSets[side].map(b => b.name)) === JSON.stringify(ORDER) &&
        JSON.stringify(compareSets[side].filter(b => b.live).map(b => b.name)) === JSON.stringify(READ_ONLY_LIVE),
    ) && /do not wrap/.test(compareWrapTip),
    `${compareSets.new
      .filter(b => b.live)
      .map(b => b.name)
      .join(', ')}; ${compareWrapTip}`,
  );
  await page.locator('.kit-compare-side[data-side="new"] button[data-action="edit"]').click();
  await sleep(600);
  const compareFrame = page.locator('iframe.kit-compare-frame');
  const compareSeen = await exerciseStrip({
    page,
    frame: compareFrame,
    frameSelector: 'iframe.kit-compare-frame',
    toolbar: newStrip,
    side: 'new',
    clipboard,
    sleep,
  });
  result.compare = compareSeen;
  check(
    'editor strip: «Compare code», the changed side in Edit — every button (Undo, Redo, Select all, Copy, Cut, Paste, Indent, Outdent, Copy all, Find) does what its key does',
    ['undo', 'copy', 'cut', 'paste', 'indent', 'copyAll', 'find'].every(k => compareSeen[k]?.ok) && compareSeen.end,
    JSON.stringify(compareSeen),
  );
  // Copy all of the original side: its own text.
  await clipboard.write('nothing yet');
  await oldStrip.getByRole('button', { name: 'Copy all', exact: true }).click();
  await sleep(400);
  check(
    'editor strip: «Compare code» — Copy all of the original side copies that side',
    (await clipboard.read()) === (await editorText(page, 'iframe.kit-compare-frame', 'old')),
  );
  await page.mouse.move(0, 0);
  await sleep(300);
  await shots('compare');
  let compareWidth = 0;
  for (const width of [1000, 900, 800, 720, 640]) {
    await page.setViewportSize({ width, height: 900 });
    await sleep(500);
    if ((await newStrip.getByRole('button', { name: 'More', exact: true }).count()) > 0) {
      compareWidth = width;
      break;
    }
  }
  const compareNarrow = await stripState(newStrip);
  check(
    'editor strip: «Compare code» narrower — a side keeps the start of its strip and the rest goes into its more menu; the side bar keeps its actions',
    compareWidth > 0 &&
      compareNarrow.at(-1)?.name === 'More' &&
      JSON.stringify(compareNarrow.slice(0, -1).map(b => b.name)) ===
        JSON.stringify(ORDER.slice(0, compareNarrow.length - 1)) &&
      (await page.locator('.kit-compare-side[data-side="new"] .kit-compare-side-actions button').count()) === 7,
    `${compareWidth}px: ${compareNarrow.map(b => b.name).join(', ')}`,
  );
  await shots('compare-narrow');
  await page.setViewportSize({ width: 1440, height: 900 });

  await page.close();
  check('editor strip: no console error or page error', errors.length === 0, errors.join(' | '));
};
