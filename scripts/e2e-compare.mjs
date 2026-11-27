// The e2e checks of «Compare code» (D11: drop, edit, save), run by scripts/e2e-check.mjs:
//   - the empty page opens on the example of the selected language, marked as an example; choosing a language switches
//     the example; every language of the list is coloured by the module (its example compared as that language has
//     clearly more coloured text than the same texts as plain text) — in the mixed tree-sitter build, exactly the
//     languages its split table gives a grammar, a grammar file's language looked at once its file arrived;
//   - drops go through Chrome's own drag pipeline (CDP Input.dispatchDragEvent with real files on disk — synthetic
//     only in that DevTools sends the events instead of a mouse): over the editor the editor page hands the drag up
//     and the page covers it with one drop target per side; one file goes on the side it was dropped on, two are the
//     original and the changed text, one beside both goes nowhere and the page says why; three items, a folder, a
//     binary file, text that is not UTF-8 and a file over the limit change nothing and are named;
//   - swap; copy (the test browser's own clipboard — never the system's, see the report); paste refused (what
//     Chrome says without the permission) and paste once allowed (CDP grants what a user's "Allow" would);
//   - edit mode: typing re-compares by itself (no button), the side is marked edited, undo and redo, select all and
//     copy, the keyboard's paste, read-only again keeps the text and takes no typing; the re-compare time while typing
//     into a 50 000-line pair;
//   - Save through the download fallback (a page without File System Access): the edited text is downloaded under the
//     side's file name, ⌘S inside the editor saves too, the side is no longer marked edited; Save as with File System
//     Access in a browser without a window — Chrome closes its picker at once, the page says nothing was saved; Open
//     through the plain file input;
//   - the empty state after Clear on both sides, and the example back from it;
//   - the keyboard: every toolbar action is reached by Tab in the order of the bars; Enter runs it; Tab into the
//     editor and out of a read-only side;
//   - a reload and a close of the page while the editor's module is still arriving log and record no error.
// Screenshots: compare-*.png, light and dark, each state.

/* global document, window, location, addEventListener, removeEventListener, createImageBitmap, OffscreenCanvas -- page.evaluate callbacks run in the pages */

import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { at, readDefinitions, ROOT } from './read-definitions.mjs';
import { themeMode } from './e2e-theme.mjs';
import { recordedErrors } from './e2e-tools.mjs';
import { readTable } from '../crates/review-wasm/grammars/build.mjs';

const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];

/** Files on disk for the drops: written once into a temporary directory, removed by `cleanup`. */
export const fixtures = () => {
  const dir = mkdtempSync(join(tmpdir(), 'compare-e2e-'));
  return {
    dir,
    file: (name, content) => {
      const path = join(dir, name);
      mkdirSync(join(path, '..'), { recursive: true });
      writeFileSync(path, content);
      return path;
    },
    folder: name => {
      const path = join(dir, name);
      mkdirSync(path, { recursive: true });
      writeFileSync(join(path, 'inside.txt'), 'x\n');
      return path;
    },
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
};

/**
 * Drops files (paths on disk) at a point of the page through Chrome's drag pipeline. Between entering and dropping
 * it notes whether the page showed its drop targets — over the editor that needs the editor page to hand the drag up.
 */
export const dropFiles = async (page, paths, point, sleep, { shot } = {}) => {
  const cdp = await page.context().newCDPSession(page);
  const data = { items: [], files: paths, dragOperationsMask: 1 };
  // Which document took the drag events: the page (its drop targets) or the editor page.
  const log = async target =>
    target.evaluate(() => {
      globalThis.__dragLog = [];
      if (globalThis.__dragLogging) return;
      globalThis.__dragLogging = true;
      for (const type of ['dragenter', 'dragover', 'drop'])
        addEventListener(
          type,
          e => globalThis.__dragLog.push(`${type}:${e.target?.className || e.target?.tagName}`),
          true,
        );
    });
  const viewer = page.frames().find(f => f.url().endsWith('/src/viewer/index.html'));
  await log(page);
  if (viewer) await log(viewer);
  try {
    await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', ...point, data });
    await sleep(250);
    // A mouse sends a drag update every few milliseconds: the first after the targets appear enters one, the next
    // are over it.
    for (let i = 0; i < 3; i++) {
      await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', ...point, data });
      await sleep(80);
    }
    const targets = await page.locator('.kit-compare-drop').count();
    const over = await page.evaluate(
      () => document.querySelector('.kit-compare-drop-target[data-over]')?.getAttribute('data-side') ?? null,
    );
    if (shot) await shot();
    await cdp.send('Input.dispatchDragEvent', { type: 'drop', ...point, data });
    await new Promise(r => setTimeout(r, 100));
    const page_ = await page.evaluate(() => globalThis.__dragLog.join(' '));
    const editor = viewer ? await viewer.evaluate(() => globalThis.__dragLog.join(' ')) : '';
    return { targets: targets > 0, over, events: { page: page_, editor } };
  } finally {
    await cdp.detach();
  }
};

/** Where to drop on a side: the middle of that half of the editor. */
export const pointOn = async (page, side) => {
  const box = await page.locator('iframe.kit-compare-frame').boundingBox();
  return { x: box.x + box.width * (side === 'old' ? 0.25 : 0.75), y: box.y + box.height / 2 };
};

/**
 * How the same texts look coloured against plain: the pixels whose colour differs between the two screenshots (the
 * layout is the same, so only the text's colour can differ), and how many of them are strongly coloured.
 */
export const colourDifference = async (ctx, coloured, plain) => {
  const page = await ctx.newPage();
  try {
    return await page.evaluate(
      async ([a, b]) => {
        const pixels = async b64 => {
          const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
          const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
          const canvas = new OffscreenCanvas(bmp.width, bmp.height);
          const g = canvas.getContext('2d');
          g.drawImage(bmp, 0, 0);
          return g.getImageData(0, 0, bmp.width, bmp.height).data;
        };
        const [x, y] = [await pixels(a), await pixels(b)];
        let changed = 0;
        let vivid = 0;
        for (let i = 0; i < x.length; i += 4) {
          const delta = Math.max(Math.abs(x[i] - y[i]), Math.abs(x[i + 1] - y[i + 1]), Math.abs(x[i + 2] - y[i + 2]));
          if (delta > 40) {
            changed++;
            if (Math.max(x[i], x[i + 1], x[i + 2]) - Math.min(x[i], x[i + 1], x[i + 2]) > 60) vivid++;
          }
        }
        return { changed, vivid };
      },
      [coloured.toString('base64'), plain.toString('base64')],
    );
  } finally {
    await page.close();
  }
};

const EXAMPLES_DIR = join(ROOT, 'extension/src/compare/examples');
const examplePair = language => {
  const files = readdirSync(join(EXAMPLES_DIR, language));
  const read = side => {
    const file = files.find(f => f.startsWith(`${side}.`));
    return { name: file.replace(/\.txt$/, ''), text: readFileSync(join(EXAMPLES_DIR, language, file), 'utf8') };
  };
  return { before: read('before'), after: read('after') };
};

/**
 * `highlighter` is what scripts/highlighter-config.mjs says of the build under test; for the mixed tree-sitter build
 * the colours are expected as its split table (crates/review-wasm/grammars.json) gives each language a grammar.
 */
export const runCompareChecks = async ({ ctx, id, check, shoot, report, sleep, highlighter }) => {
  const table = highlighter?.highlighter === 'treeSitter' ? readTable() : null;
  const base = `chrome-extension://${id}/src/app/index.html`;
  const origin = `chrome-extension://${id}`;
  const files = fixtures();
  report.compare = {};
  const pages = [];
  const watch = p => {
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    pages.push(p);
    return p;
  };

  const counts = page => page.locator('.kit-compare-counts');
  const shownCount = async page => Number(await counts(page).getAttribute('data-shown'));
  const waitShown = (page, n, timeout = 20_000) =>
    page.waitForFunction(n => Number(document.querySelector('.kit-compare-counts')?.dataset.shown) > n, n, { timeout });
  const numbers = async page =>
    counts(page).evaluate(el => ({
      changes: Number(el.dataset.changes),
      added: Number(el.dataset.added),
      removed: Number(el.dataset.removed),
    }));
  const name = (page, side) => page.locator(`[data-side="${side}"] .kit-compare-side-name`).innerText();
  const names = async page => [await name(page, 'old'), await name(page, 'new')];
  const notice = page => page.getByRole('status').innerText();
  const action = (page, side, id) =>
    page.locator(`${side ? `.kit-compare-side[data-side="${side}"]` : '.kit-compare-tools'} [data-action="${id}"]`);
  const badges = async (page, side) =>
    page.locator(`.kit-compare-side[data-side="${side}"] .kit-compare-badge`).allInnerTexts();
  const openCompare = async page => {
    await page.goto(`${base}#/compare`);
    await page.waitForFunction(
      () => {
        const el = document.querySelector('.kit-compare-counts');
        return el?.dataset.viewerState === 'ready' && Number(el.dataset.shown) > 0;
      },
      null,
      { timeout: 45_000 },
    );
    await page.evaluate(() => {
      globalThis.__answers = [];
      addEventListener('message', e => globalThis.__answers.push({ ...e.data, at: Date.now() }));
    });
    await sleep(400);
  };
  /** Runs an action and waits for the editor's answer to it. */
  const press = async (page, side, id, { wait = true } = {}) => {
    const n = await shownCount(page);
    await action(page, side, id).click();
    if (wait)
      await waitShown(page, n).catch(async error => {
        throw new Error(`${side ?? 'common'} ${id}: no answer from the editor; the page said: ${await notice(page)}`, {
          cause: error,
        });
      });
    await sleep(250);
  };
  /** The side's text as the editor holds it, asked the way the page asks. */
  const sideText = (page, side) =>
    page.evaluate(
      side =>
        new Promise(resolve => {
          const frame = document.querySelector('iframe.kit-compare-frame');
          const id = 9_000_000 + Math.floor(Math.random() * 1000);
          const onMessage = e => {
            if (e.data?.id === id) {
              removeEventListener('message', onMessage);
              resolve(e.data.text ?? e.data.message);
            }
          };
          addEventListener('message', onMessage);
          frame.contentWindow.postMessage({ type: 'viewer/read', id, side }, location.origin);
        }),
      side,
    );
  const drop = async (page, paths, side, options) => {
    const n = await shownCount(page);
    const point = side ? await pointOn(page, side) : { x: 100, y: 300 };
    const seen = await dropFiles(page, paths, point, sleep, options);
    return { ...seen, n };
  };
  // DevTools' permission overrides last as long as the session that set them: it stays open until the end.
  const sessions = [];
  const clipboard = {
    grant: async page => {
      const cdp = await page.context().newCDPSession(page);
      sessions.push(cdp);
      await cdp.send('Browser.grantPermissions', { permissions: ['clipboardReadWrite'], origin });
    },
    read: page => page.evaluate(() => navigator.clipboard.readText()),
    write: (page, text) => page.evaluate(t => navigator.clipboard.writeText(t), text),
  };

  try {
    const page = watch(await ctx.newPage());
    // Clear on an edited side asks first (ConfirmDiscard: the browser's own question); the run answers yes.
    const questions = [];
    page.on('dialog', dialog => {
      questions.push(dialog.message());
      void dialog.accept().catch(() => {});
    });
    await openCompare(page);
    const frame = page.locator('iframe.kit-compare-frame');

    // ---- the example ------------------------------------------------------------------------------------------------
    check(
      'compare: the empty page shows the example, both sides marked as the example',
      (await counts(page).getAttribute('data-shown-path')) === 'after.rs' &&
        (await names(page)).join(' | ') === 'before.rs | after.rs' &&
        (await badges(page, 'old')).includes('Example') &&
        (await badges(page, 'new')).includes('Example') &&
        /This is an example/.test(await notice(page)) &&
        (await page.locator('textarea').count()) === 0,
      `${(await names(page)).join(' | ')}; ${JSON.stringify(await numbers(page))}`,
    );
    await shoot(page, 'compare-01-example-light.png');

    const languages = await readDefinitions(
      `import { LANGUAGES } from ${at('extension/src/compare/languages.ts')}; export default LANGUAGES;`,
    );
    // Through the page: the language list switches the example while it is shown.
    const pick = async label => {
      const n = await shownCount(page);
      await page.getByLabel('Language', { exact: true }).click();
      await page.getByRole('option', { name: label, exact: true }).click();
      await page.getByRole('listbox').waitFor({ state: 'detached', timeout: 5_000 });
      await waitShown(page, n);
      await sleep(300);
    };
    await pick('Python');
    check(
      'compare: choosing a language switches the example',
      (await names(page)).join(' | ') === 'before.py | after.py' &&
        (await counts(page).getAttribute('data-shown-path')) === 'after.py',
      (await names(page)).join(' | '),
    );
    await shoot(page, 'compare-02-example-python-light.png');

    // Every language of the list is coloured by the module: its example as that language against the same texts as
    // plain text (sent straight to the editor page, as the page sends texts).
    let probeId = 5_000_000;
    const showRaw = async (pair, language) => {
      const id = ++probeId;
      await page.evaluate(
        ({ id, request }) =>
          document
            .querySelector('iframe.kit-compare-frame')
            .contentWindow.postMessage({ type: 'viewer/compare', id, request }, location.origin),
        {
          id,
          request: { path: pair.after.name, language, oldText: pair.before.text, newText: pair.after.text },
        },
      );
      await page.waitForFunction(id => globalThis.__answers.some(m => m.id === id), id, { timeout: 15_000 });
      await sleep(350);
      return frame.screenshot();
    };
    // The mixed tree-sitter build colours what its split table gives a grammar (built in or a file) and leaves the
    // rest plain; a grammar file arrives after the text is shown, so its language is looked at once the editor page
    // has noted the file (`viewer/grammar`). Every other build colours the whole list.
    const grammarOf = language =>
      language === 'text'
        ? 'none'
        : table
          ? (table.languages.find(e => e.id === language)?.grammar ?? 'none')
          : 'builtIn';
    const colours = {};
    for (const { id: language } of languages) {
      const pair = examplePair(language);
      let coloured = await showRaw(pair, language);
      if (grammarOf(language) === 'file') {
        await page
          .waitForFunction(
            l => globalThis.__answers.some(m => m.type === 'viewer/grammar' && m.language === l),
            language,
            { timeout: 20_000 },
          )
          .catch(() => {});
        await sleep(350);
        coloured = await frame.screenshot();
      }
      const plain = await showRaw(pair, 'text');
      colours[language] = { ...(await colourDifference(ctx, coloured, plain)), grammar: grammarOf(language) };
    }
    report.compare.colours = colours;
    const unexpected = Object.entries(colours).filter(
      ([language, c]) => language !== 'text' && (c.grammar !== 'none') !== c.vivid > 500,
    );
    const count = grammar => languages.filter(l => l.id !== 'text' && grammarOf(l.id) === grammar).length;
    check(
      table
        ? `compare: the module colours the languages of the list as the split table says (${languages.length - 1} besides plain text: ${count('builtIn')} built in, ${count('file')} grammar files, ${count('none')} plain)`
        : `compare: the module colours every language of the list (${languages.length - 1} besides plain text)`,
      unexpected.length === 0 && colours.text.changed === 0,
      `strongly coloured pixels that plain text does not have: ${Object.entries(colours)
        .map(([l, c]) => `${l} ${c.vivid}${table ? ` (${c.grammar})` : ''}`)
        .join(', ')}`,
    );
    await pick('Rust');

    // ---- drops ------------------------------------------------------------------------------------------------------
    const right = files.file('drops/server.rs', 'fn serve() {\n    listen(8080);\n}\n');
    const left = files.file('drops/server-old.rs', 'fn serve() {\n    listen(80);\n}\n');
    const one = await drop(page, [right], 'new', { shot: () => shoot(page, 'compare-03-drop-targets-light.png') });
    await waitShown(page, one.n);
    await sleep(300);
    check(
      'compare: a file dragged over the editor shows a drop target per side; dropped on the right, it is the changed text',
      one.targets &&
        one.over === 'new' &&
        (await names(page)).join(' | ') === 'Empty | server.rs' &&
        !(await badges(page, 'old')).includes('Example'),
      `targets ${one.targets}, over ${one.over}; ${(await names(page)).join(' | ')}; ${await notice(page)}; ` +
        `events — page: ${one.events.page}; editor: ${one.events.editor}`,
    );
    const second = await drop(page, [left], 'old');
    await waitShown(page, second.n);
    await sleep(300);
    const afterOne = await numbers(page);
    check(
      'compare: one file dropped on the left is the original; the counts are the module’s',
      (await names(page)).join(' | ') === 'server-old.rs | server.rs' && afterOne.changes === 1,
      `${(await names(page)).join(' | ')}; ${JSON.stringify(afterOne)}`,
    );
    await shoot(page, 'compare-04-two-files-light.png');

    // Two files at once, dropped on the right: the first is the original anyway.
    const a = files.file('pair/a.py', 'def f(x):\n    return x\n');
    const b = files.file('pair/b.py', 'def f(x):\n    return x * 2\n\nprint(f(2))\n');
    const pair = await drop(page, [a, b], 'new');
    await waitShown(page, pair.n);
    await sleep(300);
    check(
      'compare: two files in one drop — the first is the original, the second the changed text; the language follows',
      (await names(page)).join(' | ') === 'a.py | b.py' &&
        (await page.getByLabel('Language', { exact: true }).innerText()).trim() === 'Python',
      `${(await names(page)).join(' | ')}; ${JSON.stringify(await numbers(page))}`,
    );
    report.compare.dropPath = { one, pair };

    // Beside both sides (the navigation): one file goes nowhere, and the page says where to drop it.
    const beside = await drop(page, [right], null);
    await sleep(500);
    check(
      'compare: one file dropped beside both sides changes nothing and says where to drop it',
      (await shownCount(page)) === beside.n &&
        (await names(page)).join(' | ') === 'a.py | b.py' &&
        /left \(original\) or the right \(changed\)/.test(await notice(page)),
      await notice(page),
    );

    // What cannot become a side's text: nothing changes, each problem named.
    const refusals = {
      'three files': [[a, b, right], /3 items at once/],
      'a folder': [[files.folder('drops/src')], /src is a folder/],
      'a binary file': [
        [files.file('drops/logo.png', Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 1, 2]))],
        /logo\.png looks like a binary file/,
      ],
      'text that is not UTF-8': [
        [files.file('drops/latin.txt', Buffer.from([0x63, 0x61, 0x66, 0xe9, 0x0a]))],
        /latin\.txt is not UTF-8/,
      ],
      'a file over the limit': [
        [files.file('drops/huge.log', Buffer.alloc(6 * 1024 * 1024, 0x61))],
        /huge\.log is too large \(6\.0 MB; the limit is 5\.0 MB\)/,
      ],
    };
    const refused = {};
    for (const [what, [paths]] of Object.entries(refusals)) {
      const r = await drop(page, paths, 'old');
      await sleep(500);
      refused[what] = { notice: await notice(page), shown: (await shownCount(page)) !== r.n };
    }
    report.compare.refused = refused;
    check(
      'compare: three items, a folder, a binary file, non-UTF-8 text and a file over 5 MB change nothing and are named',
      Object.entries(refusals).every(
        ([what, [, expected]]) => !refused[what].shown && expected.test(refused[what].notice),
      ) && (await names(page)).join(' | ') === 'a.py | b.py',
      Object.entries(refused)
        .map(([what, r]) => `${what}: ${r.notice}`)
        .join(' | '),
    );
    await shoot(page, 'compare-05-refused-light.png');

    // ---- swap -------------------------------------------------------------------------------------------------------
    const beforeSwap = await numbers(page);
    await press(page, null, 'swap');
    const afterSwap = await numbers(page);
    check(
      'compare: swap trades the sides — names, texts, added and removed',
      (await names(page)).join(' | ') === 'b.py | a.py' &&
        afterSwap.added === beforeSwap.removed &&
        afterSwap.removed === beforeSwap.added &&
        (await sideText(page, 'old')).includes('print(f(2))'),
      `${JSON.stringify(beforeSwap)} → ${JSON.stringify(afterSwap)}`,
    );
    await press(page, null, 'swap');

    // ---- paste and copy ---------------------------------------------------------------------------------------------
    // Without the permission: Chrome refuses the read (a browser without a window answers its own prompt with "deny").
    await action(page, 'old', 'paste').click();
    await page.waitForFunction(
      () => /did not allow/.test(document.querySelector('[role=status]')?.textContent ?? ''),
      null,
      {
        timeout: 5_000,
      },
    );
    const refusedPaste = await notice(page);
    const clipboardState = await page.evaluate(
      async () => (await navigator.permissions.query({ name: 'clipboard-read' })).state,
    );
    check(
      'compare: Paste without the clipboard permission is refused by Chrome; the page says what to do instead',
      /Chrome did not allow reading the clipboard/.test(refusedPaste) &&
        (await names(page)).join(' | ') === 'a.py | b.py',
      `${refusedPaste} (clipboard-read: ${clipboardState})`,
    );
    report.compare.pasteRefused = { notice: refusedPaste, clipboardRead: clipboardState };
    // The user's "Allow" in Chrome's prompt, given by CDP: Paste replaces the side with the clipboard's text.
    await clipboard.grant(page);
    await clipboard.write(page, 'def f(x):\n    return x + 1\n');
    await press(page, 'old', 'paste');
    check(
      'compare: Paste, once Chrome allows it, puts the clipboard’s text on the side',
      (await name(page, 'old')) === 'Pasted text' && (await sideText(page, 'old')) === 'def f(x):\n    return x + 1\n',
      `${(await names(page)).join(' | ')}; ${JSON.stringify(await numbers(page))}`,
    );
    await action(page, 'new', 'copy').click();
    await sleep(300);
    check(
      'compare: Copy puts the side’s text on the clipboard',
      (await clipboard.read(page)) === (await sideText(page, 'new')) &&
        /Copied 5 lines of the changed side/.test(await notice(page)),
      await notice(page),
    );

    // ---- edit mode --------------------------------------------------------------------------------------------------
    const typeInto = async (side, keys) => {
      const point = await pointOn(page, side);
      await page.mouse.click(point.x, point.y - 200);
      for (const key of keys) await page.keyboard.press(key);
    };
    const editShown = async n => {
      await page.waitForFunction(
        n => globalThis.__answers.filter(m => m.type === 'viewer/shown' && m.shown?.cause === 'edit').length > n,
        n,
        { timeout: 10_000 },
      );
      await sleep(200);
    };
    const edits = () => page.evaluate(() => globalThis.__answers.filter(m => m.shown?.cause === 'edit').length);
    const readOnlyText = await sideText(page, 'new');
    let e0 = await edits();
    await typeInto('new', ['x']);
    await sleep(600);
    check(
      'compare: sides are read-only by default — typing changes nothing',
      (await edits()) === e0 && (await sideText(page, 'new')) === readOnlyText,
      `edits ${await edits()}`,
    );
    await action(page, 'new', 'edit').click();
    await sleep(300);
    const pressed = await action(page, 'new', 'edit').getAttribute('aria-pressed');
    const beforeEdit = await numbers(page);
    e0 = await edits();
    await typeInto('new', ['Meta+ArrowUp', 'Z', 'Z']);
    await editShown(e0);
    const afterEdit = await numbers(page);
    const editedText = await sideText(page, 'new');
    check(
      'compare: Edit makes a side editable; the comparison follows the typing with no button; the side is marked edited',
      pressed === 'true' &&
        editedText !== readOnlyText &&
        (await badges(page, 'new')).includes('Edited') &&
        (await page.getByRole('button', { name: 'Compare', exact: true }).count()) === 0,
      `${JSON.stringify(beforeEdit)} → ${JSON.stringify(afterEdit)}; first line now ${JSON.stringify(editedText.split('\n')[0])}`,
    );
    await shoot(page, 'compare-06-editing-light.png');
    // Undo and redo (the Mac bindings the module adds; Ctrl on other systems is gpui-kit's own).
    e0 = await edits();
    await page.keyboard.press('Meta+Z');
    await editShown(e0);
    const undone = await sideText(page, 'new');
    const undoneBadges = await badges(page, 'new');
    e0 = await edits();
    await page.keyboard.press('Meta+Shift+Z');
    await editShown(e0);
    const redone = await sideText(page, 'new');
    check(
      'compare: undo takes the typing back (and the edited mark with it), redo brings it again',
      undone === readOnlyText && !undoneBadges.includes('Edited') && redone === editedText,
      `undo ${JSON.stringify(undone.split('\n')[0])}, redo ${JSON.stringify(redone.split('\n')[0])}`,
    );
    // Select all and copy inside the editor; the keyboard's paste (the browser's paste event, no permission).
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Meta+C');
    await sleep(200);
    const copiedInEditor = await clipboard.read(page);
    await clipboard.write(page, 'pasted by the keyboard\n');
    e0 = await edits();
    await page.keyboard.press('Meta+A');
    await page.keyboard.press('Meta+V');
    await editShown(e0);
    const pastedText = await sideText(page, 'new');
    check(
      'compare: select all and copy inside the editor, then the keyboard’s paste over the selection',
      copiedInEditor === editedText && pastedText === 'pasted by the keyboard\n',
      `copied ${copiedInEditor.length} characters; side now ${JSON.stringify(pastedText)}`,
    );
    await action(page, 'new', 'edit').click();
    await sleep(300);
    e0 = await edits();
    await typeInto('new', ['Q']);
    await sleep(600);
    check(
      'compare: back to read-only, the text stays and typing is refused again',
      (await action(page, 'new', 'edit').getAttribute('aria-pressed')) === 'false' &&
        (await sideText(page, 'new')) === pastedText &&
        (await edits()) === e0,
      await notice(page),
    );

    // Save as with File System Access, in a browser without a window: Chrome closes its picker at once.
    await action(page, 'new', 'saveAs').click();
    await page.waitForFunction(
      () => /Not saved/.test(document.querySelector('[role=status]')?.textContent ?? ''),
      null,
      {
        timeout: 5_000,
      },
    );
    check(
      'compare: Save as with File System Access — a closed picker saves nothing and says so',
      true,
      await notice(page),
    );

    // ---- the empty state --------------------------------------------------------------------------------------------
    await press(page, 'old', 'clear');
    await press(page, 'new', 'clear');
    const emptyShown = await page.getByText('Nothing to compare').isVisible();
    await shoot(page, 'compare-07-empty-light.png');
    await page.getByRole('button', { name: 'Show the example' }).click();
    await page.waitForFunction(() => document.querySelectorAll('.kit-compare-badge').length >= 2, null, {
      timeout: 10_000,
    });
    check(
      'compare: Clear on both sides leaves the empty state (an edited side asks first); the example is one click away',
      emptyShown &&
        (await badges(page, 'old')).includes('Example') &&
        questions.some(q => /Replace the unsaved edits of the changed side/.test(q)),
      `${(await names(page)).join(' | ')}; asked: ${questions.join(' | ')}`,
    );

    // ---- the keyboard -----------------------------------------------------------------------------------------------
    await page.getByLabel('Language', { exact: true }).focus();
    const focused = () =>
      page.evaluate(() =>
        document.activeElement?.tagName === 'IFRAME'
          ? 'editor'
          : (document.activeElement?.getAttribute('aria-label') ?? document.activeElement?.textContent?.trim()),
      );
    const order = [];
    while (order.length < 24 && order.at(-1) !== 'editor') {
      await page.keyboard.press('Tab');
      order.push(await focused());
    }
    const expected = [
      'Swap sides',
      ...['original', 'changed'].flatMap(side =>
        ['Open file…', 'Paste from the clipboard', 'Copy the text', 'Save', 'Save as…', 'Edit', 'Clear'].map(
          t => `${t} (${side} side)`,
        ),
      ),
    ];
    // With the example shown every action is enabled, so Tab stops on each.
    check(
      'compare: Tab reaches every toolbar action in the order of the bars, then the editor',
      JSON.stringify(order) === JSON.stringify([...expected, 'editor']),
      order.join(' → '),
    );
    report.compare.tabOrder = order;
    // Tab out of a read-only editor, both sides, back to the page.
    await page.keyboard.press('Tab');
    await page.keyboard.press('Tab');
    await sleep(200);
    const leftEditor = await page.evaluate(() => document.activeElement?.tagName);
    check(
      'compare: Tab leaves a read-only editor (both sides) back to the page',
      leftEditor !== 'IFRAME',
      `focus on ${leftEditor}`,
    );
    // Enter on a focused action runs it.
    await action(page, 'new', 'copy').focus();
    await page.keyboard.press('Enter');
    await sleep(300);
    check(
      'compare: Enter on a focused toolbar action runs it',
      (await clipboard.read(page)) === (await sideText(page, 'new')) && /Copied \d+ lines/.test(await notice(page)),
      await notice(page),
    );

    // ---- dark -------------------------------------------------------------------------------------------------------
    // Chosen in Settings in another tab: the page and its editor follow through chrome.storage.
    await themeMode(ctx, base, 'Dark');
    await page.frameLocator('iframe.kit-compare-frame').locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
    await sleep(600);
    await shoot(page, 'compare-11-example-dark.png');
    const darkDrop = await drop(page, [right], 'new', { shot: () => shoot(page, 'compare-12-drop-targets-dark.png') });
    await waitShown(page, darkDrop.n);
    await action(page, 'new', 'edit').click();
    await sleep(200);
    e0 = await edits();
    await typeInto('new', ['Meta+ArrowUp', 'Z']);
    await editShown(e0);
    await shoot(page, 'compare-13-editing-dark.png');
    await action(page, 'new', 'edit').click();
    await press(page, 'new', 'clear');
    await sleep(300);
    await shoot(page, 'compare-14-empty-dark.png');
    await themeMode(ctx, base, 'System');
    await page.close();

    // ---- Save through the download fallback, Open through the file input --------------------------------------------
    const plain = watch(await ctx.newPage());
    await plain.addInitScript(() => {
      // A browser without File System Access: the page saves by download and opens with a file input.
      delete window.showSaveFilePicker;
      delete window.showOpenFilePicker;
    });
    await openCompare(plain);
    const chooser = plain.waitForEvent('filechooser', { timeout: 5_000 });
    await action(plain, 'old', 'open').click();
    await (await chooser).setFiles([left, right]);
    await waitShown(plain, 1);
    await sleep(300);
    check(
      'compare: Open with the file input — two files picked at once are the original and the changed text',
      (await names(plain)).join(' | ') === 'server-old.rs | server.rs',
      (await names(plain)).join(' | '),
    );
    await action(plain, 'new', 'edit').click();
    await sleep(200);
    const plainPoint = await pointOn(plain, 'new');
    await plain.mouse.click(plainPoint.x, plainPoint.y - 200);
    const p0 = await plain.evaluate(() => globalThis.__answers.filter(m => m.shown?.cause === 'edit').length);
    await plain.keyboard.press('Meta+ArrowUp');
    await plain.keyboard.type('// saved');
    await plain.keyboard.press('Enter');
    await plain.waitForFunction(n => globalThis.__answers.filter(m => m.shown?.cause === 'edit').length > n, p0, {
      timeout: 10_000,
    });
    await sleep(300);
    const edited = await sideText(plain, 'new');
    const download = plain.waitForEvent('download', { timeout: 10_000 });
    await action(plain, 'new', 'save').click();
    const saved = await download;
    const savedText = readFileSync(await saved.path(), 'utf8');
    await sleep(400);
    check(
      'compare: Save without File System Access downloads the edited text under the side’s file name; not edited any more',
      saved.suggestedFilename() === 'server.rs' &&
        savedText === edited &&
        savedText.startsWith('// saved\n') &&
        !(await badges(plain, 'new')).includes('Edited'),
      `${saved.suggestedFilename()}: ${JSON.stringify(savedText.slice(0, 40))}; ${await notice(plain)}`,
    );
    await shoot(plain, 'compare-08-saved-light.png');
    // ⌘S inside the editor (the browser's "Save page" otherwise): the page saves the side that has the keyboard.
    await plain.mouse.click(plainPoint.x, plainPoint.y - 200);
    await plain.keyboard.type('x');
    await sleep(400);
    const keyDownload = plain.waitForEvent('download', { timeout: 10_000 });
    await plain.keyboard.press('Meta+S');
    const keySaved = await keyDownload.catch(e => ({ error: String(e) }));
    check(
      'compare: ⌘S inside the editor saves the side being edited',
      !keySaved.error && keySaved.suggestedFilename() === 'server.rs',
      keySaved.error ?? keySaved.suggestedFilename(),
    );
    await plain.close();

    // ---- typing into a 50 000-line pair -----------------------------------------------------------------------------
    const big = watch(await ctx.newPage());
    await openCompare(big);
    const line = i => `    let value_${i} = compute(${i}, "row ${i}");`;
    const oldLines = [];
    const newLines = [];
    for (let i = 0; i < 50_000; i++) {
      oldLines.push(line(i));
      const k = i % 1000;
      if (k === 100) newLines.push(`    let value_${i} = compute(${i}, "row ${i}") + 1;`);
      else if (k === 400) continue;
      else if (k === 700) newLines.push(line(i), `    log("inserted after ${i}");`);
      else newLines.push(line(i));
    }
    const bigOld = files.file('big/large-old.txt', oldLines.join('\n') + '\n');
    const bigNew = files.file('big/large-new.txt', newLines.join('\n') + '\n');
    const bigDrop = await drop(big, [bigOld, bigNew], 'new');
    await waitShown(big, bigDrop.n, 30_000);
    await sleep(500);
    const bigCounts = await numbers(big);
    await action(big, 'new', 'edit').click();
    await sleep(300);
    const bigPoint = await pointOn(big, 'new');
    await big.mouse.click(bigPoint.x, bigPoint.y - 200);
    const viewerFrame = big.frames().find(f => f.url().endsWith('/src/viewer/index.html'));
    await viewerFrame.evaluate(() => {
      globalThis.__keys = [];
      addEventListener('keydown', () => globalThis.__keys.push(Date.now()), true);
    });
    const runs = [];
    for (let i = 0; i < 6; i++) {
      const before = await big.evaluate(() => globalThis.__answers.filter(m => m.shown?.cause === 'edit').length);
      await big.keyboard.press('a');
      await big.waitForFunction(n => globalThis.__answers.filter(m => m.shown?.cause === 'edit').length > n, before, {
        timeout: 15_000,
      });
      const answer = await big.evaluate(() => globalThis.__answers.filter(m => m.shown?.cause === 'edit').at(-1));
      const keyAt = await viewerFrame.evaluate(() => globalThis.__keys.at(-1));
      runs.push({
        updateMs: +answer.shown.updateMs.toFixed(1),
        compareMs: +answer.shown.compareMs.toFixed(1),
        keyToCountsMs: answer.at - keyAt,
        changes: answer.shown.changes,
      });
      await sleep(250);
    }
    report.compare.typingLarge = {
      lines: 50_000,
      counts: bigCounts,
      runs,
      median: {
        updateMs: median(runs.map(r => r.updateMs)),
        compareMs: median(runs.map(r => r.compareMs)),
        keyToCountsMs: median(runs.map(r => r.keyToCountsMs)),
      },
    };
    const m = report.compare.typingLarge.median;
    check(
      'compare: typing into the changed side of a 50 000-line pair re-compares once per pause (timed)',
      bigCounts.changes === 150 && runs.every(r => r.changes === 151 || r.changes === 150),
      `re-compare in the module ${m.updateMs} ms (differ ${m.compareMs} ms); key to new counts ${m.keyToCountsMs} ms ` +
        `(of which ${150} ms is the pause it waits for)`,
    );
    await big.close();

    // ---- a reload while the editor's module is still arriving --------------------------------------------------------
    // A reload or a close of the main page while the module is still arriving makes Chrome abort its load, and the
    // module's compilation rejects ("WebAssembly compilation aborted: Network error: Response body loading was aborted")
    // while the editor page is going away — before its pagehide. Not the editor's failure: nothing may be logged or
    // recorded. The moment is made, not waited for: in this tab the editor page's compilation never finishes and
    // rejects as Chrome's does when its page starts to go away (beforeunload).
    const errorsBefore = (await recordedErrors({ ctx, id }))?.length ?? 0;
    const leaving = await ctx.newPage();
    const leavingConsole = [];
    leaving.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning') leavingConsole.push(`${m.type()}: ${m.text()}`);
    });
    leaving.on('pageerror', e => leavingConsole.push(`pageerror: ${e}`));
    await leaving.addInitScript(() => {
      if (!location.pathname.includes('/src/viewer/')) return;
      for (const name of ['instantiateStreaming', 'compileStreaming', 'instantiate', 'compile'])
        WebAssembly[name] = () =>
          new Promise((_resolve, reject) => {
            globalThis.__moduleHeld = true;
            addEventListener('beforeunload', () =>
              reject(
                new TypeError('WebAssembly compilation aborted: Network error: Response body loading was aborted'),
              ),
            );
          });
    });
    const held = () =>
      leaving.waitForFunction(
        () => document.querySelector('iframe.kit-compare-frame')?.contentWindow?.__moduleHeld === true,
        null,
        { timeout: 30_000, polling: 100 },
      );
    await leaving.goto(`${base}#/compare`);
    await held();
    await leaving.reload();
    await held();
    await leaving.close();
    await sleep(1_500); // longer than an abort waits before it counts as the editor's failure (src/viewer/pageLife.ts)
    const errorsAfter = await recordedErrors({ ctx, id });
    const added = (errorsAfter ?? []).slice(errorsBefore);
    report.console.push(...leavingConsole.map(text => ({ type: text.split(':')[0], text })));
    check(
      'compare: a reload and a close while the editor’s module is still arriving log and record no error (the aborted load is not the editor’s failure)',
      errorsAfter !== undefined && added.length === 0 && leavingConsole.length === 0,
      [...added, ...leavingConsole].join(' | ') || 'none',
    );
  } finally {
    for (const cdp of sessions) await cdp.detach().catch(() => {});
    files.cleanup();
    for (const p of pages) if (!p.isClosed()) await p.close();
  }
};
