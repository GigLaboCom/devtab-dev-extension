// Scratch files in the built extension (D34; extension/src/projects/scratch/, src/app/projects/Scratch*.tsx): with no
// companion and no `nativeMessaging` permission — the store build's manifest as it is, the Projects section showing its
// demo — the «Scratches» group next to the projects; a scratch made in a language and typed into, the text saving
// itself; after a reload the text and the language are back; a new language re-highlights the same text in the editor
// module (the frame's pixels: plain text has no colour, Python has); a rename whose extension changes the language;
// Download — through the browser's file picker (played by the page) and as a download where the browser has none —
// gives the scratch's file name, its language's extension and the editor's bytes; Delete asks, then the scratch and its
// text go; at the limits — a text too long, one scratch too many (said in the language popup) — one plain line, and
// what was stored stays. A new scratch is made through the language popup of «New scratch…» (D38). Nothing
// cut off at 1440×900 and 800×700, light and dark, and not one console error or page error. Screenshots where --shots
// says. Run by scripts/e2e-check.mjs (step `scratches`).

/* global document, window, location, chrome, addEventListener, removeEventListener, createImageBitmap, OffscreenCanvas -- page.evaluate callbacks run in the pages */

import { readFileSync } from 'node:fs';
import { themeMode } from './e2e-theme.mjs';

// The store's limits and records (extension/src/projects/scratch/store.ts, storage.ts).
const MAX_CHARS = 262_144;
const MAX_COUNT = 20;
const LIST_KEY = 'scratches';
const TEXT_PREFIX = 'scratch:';

export const runScratchesChecks = async ({ ctx, id, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const errors = [];
  const result = (report.scratches = {});
  const watch = page => {
    page.on('console', m => m.type() === 'error' && errors.push(m.text()));
    page.on('pageerror', e => errors.push(String(e)));
    return page;
  };
  const page = watch(await ctx.newPage());
  // Where the browser has a file picker, Download asks it where to save: the picker is played here, and what is written
  // through its handle is kept for the check.
  await page.addInitScript(() => {
    window.showSaveFilePicker = async options => {
      window.__picked = options;
      return {
        name: options.suggestedName,
        createWritable: async () => ({
          write: async blob => {
            window.__written = new Uint8Array(await blob.arrayBuffer());
          },
          close: async () => undefined,
        }),
      };
    };
  });
  const frame = page.locator('iframe.kit-projects-frame');
  const status = page.locator('.kit-projects-save');
  const group = page.getByRole('region', { name: 'Scratches' });
  /** Waits until the editor has answered more than `n` times. */
  const editorShows = (n, target = page) =>
    target.waitForFunction(
      n => Number(document.querySelector('iframe.kit-projects-frame')?.dataset.shown ?? 0) > n,
      n,
      { timeout: 45_000 },
    );
  const shownCount = () => frame.evaluate(el => Number(el.dataset.shown ?? 0));
  /** The text the editor holds now (`viewer/read`, as the section asks it). */
  const editorText = (target = page) =>
    target.evaluate(
      () =>
        new Promise((resolve, reject) => {
          const el = document.querySelector('iframe.kit-projects-frame');
          const asked = 900_000 + Math.floor(Math.random() * 1000);
          const on = event => {
            if (event.source !== el.contentWindow || event.data?.type !== 'viewer/text' || event.data.id !== asked)
              return;
            removeEventListener('message', on);
            resolve(event.data.text);
          };
          addEventListener('message', on);
          el.contentWindow.postMessage({ type: 'viewer/read', id: asked, side: 'new' }, location.origin);
          setTimeout(() => reject(new Error('the editor did not answer')), 10_000);
        }),
    );
  const stored = (target = page) =>
    target.evaluate(async key => (await chrome.storage.local.get(null))[key] ?? null, LIST_KEY);
  const storedText = (scratch, target = page) =>
    target.evaluate(async key => (await chrome.storage.local.get(key))[key] ?? null, `${TEXT_PREFIX}${scratch}`);
  const forget = () =>
    page.evaluate(async prefix => {
      const all = await chrome.storage.local.get(null);
      await chrome.storage.local.remove(Object.keys(all).filter(k => k === 'scratches' || k.startsWith(prefix)));
    }, TEXT_PREFIX);
  /** How coloured the ink of the text's first lines is on average (0: grey) — the highlighting's colours. */
  const colour = async () => {
    // The first lines of the text, where the typed code is: the caret and the status line stay out of the count.
    const box = await frame.boundingBox();
    const png = await page.screenshot({
      clip: { x: box.x + 40, y: box.y, width: Math.min(560, box.width - 40), height: 64 },
      caret: 'initial',
    });
    const blank = await ctx.newPage();
    try {
      return await blank.evaluate(async b64 => {
        const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
        const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
        const canvas = new OffscreenCanvas(bmp.width, bmp.height);
        const g = canvas.getContext('2d');
        g.drawImage(bmp, 0, 0);
        const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
        // Ink: what differs from the background (its corner). A glyph's edges are tinted both ways by the font's
        // smoothing, which cancels out on average; the highlighting's colours do not.
        const bg = [data[0], data[1], data[2]];
        let ink = 0;
        let rg = 0;
        let gb = 0;
        for (let i = 0; i < data.length; i += 4) {
          const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
          if (Math.abs(r - bg[0]) + Math.abs(gg - bg[1]) + Math.abs(b - bg[2]) < 90) continue;
          ink++;
          rg += r - gg;
          gb += gg - b;
        }
        return { ink, tint: ink ? Math.round(Math.hypot(rg / ink, gb / ink) * 10) / 10 : 0 };
      }, png.toString('base64'));
    } finally {
      await blank.close();
    }
  };
  /** Nothing of the page overflows sideways or is cut off at the window's bottom; the editor keeps its least width. */
  const fits = () =>
    page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const main = document.querySelector('.kit-main');
      const parts = '.kit-projects-bar, .kit-projects-editor-bar, [aria-labelledby="scratches-title"]';
      const clipped = [...document.querySelectorAll(parts)]
        .flatMap(part => [...part.querySelectorAll('button, a, h1, h2, span, p, input')])
        .filter(el => el.getClientRects().length > 0 && !el.classList.contains('sr-only'))
        .filter(el => {
          const r = el.getBoundingClientRect();
          return r.left < -1 || r.right > vw + 1 || el.scrollWidth > el.clientWidth + 1;
        })
        .map(el => el.textContent.trim().slice(0, 40));
      const editor = document.querySelector('iframe.kit-projects-frame')?.getBoundingClientRect();
      return {
        overflowX:
          (main?.scrollWidth ?? 0) > (main?.clientWidth ?? 0) + 1 || document.documentElement.scrollWidth > vw + 1,
        sectionInside: document.querySelector('.kit-projects').getBoundingClientRect().bottom <= vh + 1,
        clipped,
        editor: editor ? Math.round(editor.width) : null,
      };
    });
  const choose = async (field, option, target = page) => {
    await target.getByRole('combobox', { name: field, exact: true }).click();
    await target.getByRole('option', { name: option, exact: true }).click();
    await target.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
  };
  /** «New scratch…»: the language popup (D38) — the language typed into its filter, Enter. */
  const newScratch = async language => {
    await group.getByRole('button', { name: 'New scratch…' }).click();
    const popup = page.getByRole('dialog', { name: 'New scratch file' });
    await popup.getByRole('combobox', { name: 'Filter languages' }).fill(language);
    await popup.getByRole('option', { name: language }).first().waitFor({ timeout: 5_000 });
    await page.keyboard.press('Enter');
  };
  /** Waits until the scratch's stored text is `want` and the bar says it is saved. */
  const savedAs = async (scratch, want, timeout = 15_000) => {
    const until = Date.now() + timeout;
    while (Date.now() < until) {
      const text = await storedText(scratch);
      if ((typeof want === 'function' ? want(text) : text === want) && (await status.innerText()) === 'Saved')
        return true;
      await sleep(100);
    }
    return false;
  };
  const typeInEditor = async (keys, target = page) => {
    const box = await target.locator('iframe.kit-projects-frame').boundingBox();
    await target.mouse.click(box.x + box.width / 2, box.y + 30);
    for (const part of keys) {
      if (part.startsWith('#')) await target.keyboard.press(part.slice(1));
      else await target.keyboard.type(part, { delay: 15 });
    }
  };

  // ---- no companion, no permission; the group next to the projects -----------------------------------------------
  await page.goto(`${base}#/projects`);
  await page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor({ timeout: 15_000 });
  await forget();
  await page.reload();
  await group.waitFor({ timeout: 10_000 });
  const setting = await page.evaluate(async () => ({
    permission: await chrome.permissions.contains({ permissions: ['nativeMessaging'] }),
    required: chrome.runtime.getManifest().permissions?.includes('nativeMessaging') ?? false,
    connection: document.querySelector('.kit-projects')?.dataset.connection,
    backend: document.querySelector('.kit-projects')?.dataset.backend,
  }));
  result.setting = setting;
  const parts = await page
    .locator('.kit-projects-home > section')
    .evaluateAll(els => els.map(el => el.getAttribute('aria-labelledby')));
  check(
    'scratches: with no nativeMessaging permission and no companion (the demo shown), the group is next to the projects',
    !setting.permission &&
      !setting.required &&
      setting.backend === 'demo' &&
      parts[0] === 'projects-list-title' &&
      parts[1] === 'scratches-title' &&
      (await group.getByText('No scratches yet.').count()) === 1,
    `${JSON.stringify(setting)}; ${parts.join(', ')}`,
  );

  // ---- made in a language, typed into, saved by itself --------------------------------------------------------------
  await newScratch('Python');
  await page.waitForFunction(() => /^#\/projects\/scratches\/s_[a-z2-7]{10}$/.test(location.hash), null, {
    timeout: 10_000,
  });
  const scratchId = await page.evaluate(() => location.hash.split('/').pop());
  await page.getByRole('heading', { name: 'scratch.py', level: 1 }).waitFor({ timeout: 10_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  const typed = 'import os\nvalue = 42  # the answer';
  await typeInEditor(['import os', '#Enter', 'value = 42  # the answer']);
  await savedAs(scratchId, typed);
  const afterTyping = { editor: await editorText(), stored: await storedText(scratchId), list: await stored() };
  result.made = { id: scratchId, list: afterTyping.list };
  check(
    'scratches: «New scratch» in Python makes scratch.py and opens it; what is typed saves itself into the extension’s storage',
    afterTyping.editor === typed &&
      afterTyping.stored === typed &&
      afterTyping.list?.items?.[0]?.language === 'python' &&
      afterTyping.list?.items?.[0]?.name === 'scratch',
    JSON.stringify({ editor: afterTyping.editor, stored: afterTyping.stored }),
  );
  await sleep(500);
  const python = await colour();
  await shoot(page, 'scratches-open-light.png');

  // ---- a reload: the text and the language are back --------------------------------------------------------------
  await page.reload();
  await page.getByRole('heading', { name: 'scratch.py', level: 1 }).waitFor({ timeout: 15_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  await sleep(500);
  const reloaded = {
    text: await editorText(),
    language: await page.getByRole('combobox', { name: 'Language', exact: true }).innerText(),
    colour: await colour(),
  };
  result.reloaded = reloaded;
  check(
    'scratches: after a reload the text and the language are back (highlighted as Python)',
    reloaded.text === typed && reloaded.language === 'Python' && reloaded.colour.tint > 8,
    JSON.stringify(reloaded),
  );

  // ---- a new language re-highlights the same text -------------------------------------------------------------------
  let n = await shownCount();
  await choose('Language', 'Plain text');
  await editorShows(n);
  await page.getByRole('heading', { name: 'scratch.txt', level: 1 }).waitFor({ timeout: 5_000 });
  await sleep(600);
  const plain = await colour();
  const plainText = await editorText();
  await shoot(page, 'scratches-plain-light.png');
  n = await shownCount();
  await choose('Language', 'Python');
  await editorShows(n);
  await page.getByRole('heading', { name: 'scratch.py', level: 1 }).waitFor({ timeout: 5_000 });
  await sleep(600);
  const again = await colour();
  result.colour = { python, plain, again };
  check(
    'scratches: changing the language changes the highlighting of the same text (Python coloured, plain text not)',
    plainText === typed &&
      python.ink > 0 &&
      plain.ink > 0 &&
      python.tint > plain.tint * 2 + 8 &&
      again.tint > plain.tint * 2 + 8 &&
      (await stored()).items[0].language === 'python',
    JSON.stringify(result.colour),
  );

  // ---- Download through the file picker ---------------------------------------------------------------------------
  await page.getByRole('button', { name: 'Download' }).click();
  await page.getByText('Saved as scratch.py.').waitFor({ timeout: 10_000 });
  const picked = await page.evaluate(() => ({
    suggestedName: window.__picked?.suggestedName,
    bytes: window.__written ? [...window.__written] : null,
  }));
  const typedBytes = [...Buffer.from(typed, 'utf8')];
  check(
    'scratches: Download asks the browser’s file picker with scratch.py and writes the editor’s bytes (no BOM)',
    picked.suggestedName === 'scratch.py' && JSON.stringify(picked.bytes) === JSON.stringify(typedBytes),
    `${picked.suggestedName}; ${picked.bytes?.length} bytes`,
  );

  // ---- Download where the browser has no file picker: a download ----------------------------------------------------
  const plainPage = watch(await ctx.newPage());
  await plainPage.addInitScript(() => {
    delete window.showSaveFilePicker;
  });
  await plainPage.goto(`${base}#/projects/scratches/${scratchId}`);
  await plainPage.getByRole('heading', { name: 'scratch.py', level: 1 }).waitFor({ timeout: 15_000 });
  await plainPage.locator('iframe.kit-projects-frame[data-ready]').waitFor({ timeout: 45_000 });
  await editorShows(0, plainPage);
  const download = plainPage.waitForEvent('download', { timeout: 10_000 });
  await plainPage.getByRole('button', { name: 'Download' }).click();
  const saved = await download;
  const savedBytes = readFileSync(await saved.path());
  check(
    'scratches: without a file picker Download downloads scratch.py with the editor’s bytes',
    saved.suggestedFilename() === 'scratch.py' && savedBytes.equals(Buffer.from(typed, 'utf8')),
    `${saved.suggestedFilename()}; ${savedBytes.length} bytes`,
  );
  await plainPage.getByText('Downloaded scratch.py.').waitFor({ timeout: 5_000 });
  await plainPage.close();

  // ---- rename in place: a known extension changes the language -----------------------------------------------------
  await page.getByRole('button', { name: 'Rename…' }).click();
  const nameField = page.getByRole('textbox', { name: 'Scratch name' });
  await nameField.waitFor({ timeout: 5_000 });
  const selected = await nameField.evaluate(el => el.value.slice(el.selectionStart, el.selectionEnd));
  await shoot(page, 'scratches-rename-light.png');
  await nameField.fill('notes.md');
  n = await shownCount();
  await nameField.press('Enter');
  await page
    .getByRole('heading', { name: 'notes.md', level: 1 })
    .waitFor({ timeout: 5_000 })
    .catch(async error => {
      const state = await page.evaluate(() => ({
        h1: document.querySelector('.kit-projects-bar h1')?.textContent,
        field: document.querySelector('.kit-projects-bar-name')?.value ?? null,
        note: document.querySelector('.kit-projects-note')?.textContent ?? null,
      }));
      throw new Error(`${error.message}; ${JSON.stringify(state)}; stored ${JSON.stringify(await stored())}`);
    });
  await editorShows(n);
  const renamed = {
    selected,
    language: await page.getByRole('combobox', { name: 'Language', exact: true }).innerText(),
    stored: (await stored()).items[0],
    focus: await page.evaluate(() => document.activeElement?.textContent),
  };
  check(
    'scratches: renamed in place (the name without its extension selected); «notes.md» makes it Markdown',
    selected === 'scratch' &&
      renamed.language === 'Markdown' &&
      renamed.stored.name === 'notes' &&
      renamed.stored.language === 'markdown' &&
      renamed.focus === 'Rename…',
    JSON.stringify(renamed),
  );
  await choose('Language', 'Python');

  // ---- the home with scratches; wide and narrow, light and dark ------------------------------------------------------
  await page.getByRole('link', { name: 'All projects' }).click();
  await group.getByRole('link').first().waitFor({ timeout: 10_000 });
  await newScratch('Rust');
  await page.getByRole('heading', { name: 'scratch.rs', level: 1 }).waitFor({ timeout: 10_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  const rustId = await page.evaluate(() => location.hash.split('/').pop());
  await typeInEditor(['fn main', '#Enter']);
  await savedAs(rustId, text => typeof text === 'string' && text.startsWith('fn main'));
  await page.getByRole('link', { name: 'All projects' }).click();
  await group.getByRole('link').nth(1).waitFor({ timeout: 10_000 });
  const listed = await group.locator('.kit-projects-item-name').allInnerTexts();
  const homeWide = await fits();
  result.home = { listed, fits: homeWide };
  check(
    'scratches: the group lists the scratches by name with their language; nothing cut off at 1440×900',
    listed.length === 2 &&
      listed.includes('notes.py') &&
      listed.includes('scratch.rs') &&
      !homeWide.overflowX &&
      homeWide.clipped.length === 0,
    JSON.stringify(result.home),
  );
  await shoot(page, 'scratches-home-light.png');
  for (const mode of ['Dark', 'Light']) {
    if (mode === 'Dark') {
      await themeMode(ctx, base, 'Dark');
      await page.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
      await sleep(400);
      await shoot(page, 'scratches-home-dark.png');
    }
    const suffix = mode.toLowerCase();
    await page.setViewportSize({ width: 800, height: 700 });
    await sleep(400);
    const homeNarrow = await fits();
    await shoot(page, `scratches-home-narrow-${suffix === 'dark' ? 'dark' : 'light'}.png`);
    await group.getByRole('link', { name: /notes\.py/ }).click();
    await page.getByRole('heading', { name: 'notes.py', level: 1 }).waitFor({ timeout: 10_000 });
    await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
    await editorShows(0);
    await sleep(600);
    const openNarrow = await fits();
    await shoot(page, `scratches-open-narrow-${suffix}.png`);
    await page.setViewportSize({ width: 1440, height: 900 });
    await sleep(600);
    const openWide = await fits();
    if (mode === 'Dark') {
      await page
        .frameLocator('iframe.kit-projects-frame')
        .locator('html[data-mode="dark"]')
        .waitFor({ timeout: 5_000 });
      await sleep(400);
      await shoot(page, 'scratches-open-dark.png');
    }
    result[`fit${mode}`] = { homeNarrow, openNarrow, openWide };
    check(
      `scratches (${suffix}): nothing cut off at 800×700 and 1440×900 — the home, an open scratch’s bar and its editor`,
      [homeNarrow, openNarrow, openWide].every(f => !f.overflowX && f.sectionInside && f.clipped.length === 0) &&
        openNarrow.editor >= 320,
      JSON.stringify(result[`fit${mode}`]),
    );
    if (mode === 'Dark') {
      await themeMode(ctx, base, 'Light');
      await page.locator('html[data-mode="light"]').waitFor({ timeout: 5_000 });
    }
    await page.getByRole('link', { name: 'All projects' }).click();
    await group.getByRole('link').first().waitFor({ timeout: 10_000 });
  }
  await themeMode(ctx, base, 'System');

  // ---- a text too long: one line, the stored text stays; Delete asks, then it goes ------------------------------------
  const longId = 's_longlonglo';
  const line = `${'x'.repeat(79)}\n`;
  // Four units short of the limit: thirty more characters typed take it over.
  const whole = Math.floor(MAX_CHARS / line.length);
  const longText = line.repeat(whole) + 'x'.repeat(MAX_CHARS - whole * line.length - 4);
  await page.evaluate(
    async ([listKey, key, scratch, text]) => {
      const list = (await chrome.storage.local.get(listKey))[listKey];
      const now = Date.now();
      list.items.push({
        id: scratch,
        name: 'long',
        language: 'text',
        createdMs: now,
        updatedMs: now,
        chars: text.length,
      });
      await chrome.storage.local.set({ [listKey]: list, [key]: text });
    },
    [LIST_KEY, `${TEXT_PREFIX}${longId}`, longId, longText],
  );
  await page.goto(`${base}#/projects/scratches/${longId}`);
  await page.getByRole('heading', { name: 'long.txt', level: 1 }).waitFor({ timeout: 15_000 });
  await frame.and(page.locator('[data-ready]')).waitFor({ timeout: 45_000 });
  await editorShows(0);
  const box = await frame.boundingBox();
  await page.mouse.click(box.x + box.width / 2, box.y + 30);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
  await page.keyboard.type('y'.repeat(30), { delay: 10 });
  const tooLong = page.locator('.kit-projects-save[data-state="refused"]');
  await tooLong.waitFor({ timeout: 15_000 });
  const sizeLine = await tooLong.innerText();
  const kept = await storedText(longId);
  check(
    'scratches: a text over the limit is not saved and says so in one line; the stored text stays as it was',
    sizeLine === 'Not saved: longer than 262,144 characters. Shorten it, or download it to keep it.' &&
      kept === longText,
    `${sizeLine}; stored ${kept?.length} units`,
  );
  await shoot(page, 'scratches-too-long-light.png');
  await page.setViewportSize({ width: 800, height: 700 });
  await sleep(400);
  const longNarrow = await fits();
  check(
    'scratches: at 800×700 the refusal wraps in the editor’s bar; nothing cut off',
    !longNarrow.overflowX && longNarrow.clipped.length === 0,
    JSON.stringify(longNarrow),
  );
  await shoot(page, 'scratches-too-long-narrow-light.png');
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('button', { name: 'Delete…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Delete long.txt?' });
  await dialog.waitFor({ timeout: 5_000 });
  await shoot(page, 'scratches-delete-light.png');
  await dialog.getByRole('button', { name: 'Delete', exact: true }).click();
  await page.waitForFunction(() => location.hash === '#/projects', null, { timeout: 10_000 });
  const afterDelete = { list: (await stored()).items.map(i => i.id), text: await storedText(longId) };
  check(
    'scratches: Delete asks first; then the scratch and its text leave the storage and the page goes back to the list',
    !afterDelete.list.includes(longId) && afterDelete.text === null && afterDelete.list.length === 2,
    JSON.stringify(afterDelete),
  );

  // ---- one scratch too many --------------------------------------------------------------------------------------
  await page.evaluate(
    async ([listKey, prefix, max]) => {
      const list = (await chrome.storage.local.get(listKey))[listKey];
      const now = Date.now();
      const extra = {};
      for (let i = list.items.length; i < max; i++) {
        const scratch = `s_fill${String(i)
          .padStart(6, 'a')
          .replace(/[0-9]/g, d => 'abcdefghij'[d])}`;
        list.items.push({
          id: scratch,
          name: `filler_${i}`,
          language: 'text',
          createdMs: now,
          updatedMs: now,
          chars: 0,
        });
        extra[`${prefix}${scratch}`] = '';
      }
      await chrome.storage.local.set({ [listKey]: list, ...extra });
    },
    [LIST_KEY, TEXT_PREFIX, MAX_COUNT],
  );
  await page.reload();
  await group
    .getByRole('link')
    .nth(MAX_COUNT - 1)
    .waitFor({ timeout: 10_000 });
  await newScratch('Plain text');
  const tooMany = page.getByRole('dialog', { name: 'New scratch file' });
  const countLine = await tooMany.getByRole('alert').innerText();
  const count = (await stored()).items.length;
  check(
    `scratches: at ${MAX_COUNT} scratches the popup’s choice is refused in one plain line; none is made`,
    countLine === `${MAX_COUNT} scratches are kept at most. Delete one to make another.` && count === MAX_COUNT,
    `${countLine}; ${count} kept`,
  );
  await shoot(page, 'scratches-too-many-light.png');
  await page.keyboard.press('Escape');
  await tooMany.waitFor({ state: 'detached', timeout: 5_000 });

  await forget();
  check('scratches: no console error or page error', errors.length === 0, errors.join(' | '));
  await page.close();
};
