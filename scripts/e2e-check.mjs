#!/usr/bin/env node
// The e2e check: the BUILT extension (dist/) in Chrome for Testing without a window — the way spikes/extension-e2e
// loads one (new headless, its own throwaway profile, --load-extension) — then every part of the main page:
//   1. the extension loads: no manifest errors, install warnings or runtime errors (chrome://extensions' own data);
//      the service worker runs;
//   1b. the New Tab page (scripts/e2e-start.mjs): a new tab is the start page and stays light; its field opens tools,
//      pasted JSON and web searches; shortcuts persist; each switch of Settings hides its part; "last opened tool";
//      the options entry; the start route's chunks and open time;
//   1b'. our page opened by its address and the options page (scripts/e2e-own-page.mjs): titles, routes, back and
//      forward, reload, route-boot.js never redirecting an explicit route, the install warnings, "Extension options"
//      and openOptionsPage with tabs of ours open;
//   1c. the toolbar button as its chosen definition says (scripts/e2e-toolbar.mjs): the menu in the real popup — its
//      items, focus and keys, "New tab" and "Settings", the theme, what it loads and its first paint — or, without a
//      popup, a new tab;
//   2. «Compare code» in the default light theme: the wasm editor draws the opening example, then two files dropped on
//      the page (language from their names, then from the shadcn Select) give a coloured diff in the editor (the editor
//      reports `shown` for the right path; the iframe's pixels have the added-green and removed-red of the diff). The
//      drops, the toolbar, edit mode, saving and the examples have their own checks (scripts/e2e-compare.mjs). The
//      comparison runs in
//      the module: the editor page receives the two texts and no hunks, the counts on the page are the ones the module
//      answers with, a request may name a built-in differ (`myers`), an unknown differ name or option comes back as an
//      error, and a 50 000-line pair is timed in the browser (the report's `browserTiming`);
//      the end of a long file: scrolled to the end by wheel, by the scroll bar's thumb and by the keyboard, both sides
//      draw the last line of the 50 000-line pair, level; the pairs next to it (spacer rows at the start, a file ending
//      with spacer rows, a short file, no spacer rows, an insertion or a deletion at the end) leave neither side blank
//      (the report's `endOfFile`);
//      a request before the first frame: the module on a page of its own refuses it with an error before run() and
//      while its window opens, shows one it took before the first frame in that frame, and takes calls from inside its
//      own callbacks; the editor page answers a request sent before its module has loaded;
//   2d. the build with the mixed tree-sitter highlighter (DEVTAB_VARIANT=highlighter:treeSitter, run with the same
//      variable): its grammar files (scripts/e2e-grammars.mjs) — and «Compare code» expects the colours its split table
//      gives (crates/review-wasm/grammars.json);
//   3. «Tools»: every tool's own checks (scripts/e2e-tools/<id>.mjs, run by scripts/e2e-tools.mjs — a new tool adds a
//      file there, nothing here); then the JSON tool's controls measured against gpui-kit;
//   3b. the shell (scripts/e2e-shell.mjs): the tools nested under Tools in the sidebar, the toolbar and the palette (by
//      click and by ⌘K / Ctrl+K, «Compare code» with the editor focused included, keyboard only, focus back), the start
//      page's field taking the same shortcut, the editor's height under the toolbar, the theme following the system
//      when none is chosen (CDP emulates the scheme), the user's shortcuts set in Settings;
//   4. «Projects»: the section opens on its demo (its own checks: scripts/e2e-projects-demo.mjs, step projects-demo);
//   4a. scratch files in «Projects» (scripts/e2e-scratches.mjs, step scratches): with no companion and no permission —
//      made in a language, typed, read back after a reload, re-highlighted in another language, renamed, downloaded
//      (picker and download), deleted, and the limits said;
//   4a'. the keys of scratch files and of «Projects» (scripts/e2e-keys.mjs, step project-keys): "New scratch file" from another
//      section, the start page, the palette and both editors opens the language popup; the open scratch's keys and the
//      parts of a project by their keys; a key recorded again in Settings; the popup at the scratch limit;
//   4a''. the editor's settings (scripts/e2e-editor-settings.mjs, step editor-settings, D39): Tab inserts what applies in a
//      scratch, a demo project's file and a side of «Compare code»; the built-in language rows (Go tabs, YAML 2); a
//      four-space file detected as four; the indent indicator and its choice for one file; Settings → Editor changing
//      the open editors without a reload and surviving a reload; how both look, light and dark, wide and narrow;
//   4a'''. the strip of the editor's buttons (scripts/e2e-editor-strip.mjs, step editor-strip): on a scratch, a demo
//      project's file and a side of «Compare code» each button does what its key does; Paste refused and allowed; the
//      toggles; read only; Save; the more menu at a narrow width; light and dark;
//   4b. «Projects» with a companion (scripts/e2e-projects.mjs, step projects): a browser of its own, the build's copy
//      loaded by CDP, a fake Native Messaging host speaking the companion's contract — every state of the connection,
//      the tree, a file, find, changes, diff, history, events, long answers, the permission removed and granted;
//   5. the default dark theme repaints the page and the editor; every part again;
//   6. a theme that is not a default (Tokyo Night) chosen from the theme list reaches the page AND the editor (the
//      editor's background is that theme's); every part again;
//   7. the controls measured against gpui-kit (docs/theming-specs): sizes, radii, colours → the report's `measure`;
//   8. the tool history (scripts/e2e-history.mjs): record, list, open, filter, delete by interval, export, delete
//      everything, restore byte for byte, the master switch, a master password across two tabs, incognito;
//   and not a single console error or page error on the way (the CSP's violations land there too).
// Screenshots of each step go to --shots=<dir> (docs/screenshots/extension-dna/ for the record).
//
// Usage:
//   pnpm test:e2e [-- <dist>] [--shots=<dir>] [--json=<file>] [--only=<step or tool>,…]
//   --only  run only these after the extension has loaded: a tool's id (its module of scripts/e2e-tools/, e.g.
//           `--only=jwt`), or a step — start, own-page, toolbar, compare (2–2c), tools (3: every tool and the JSON
//           controls), shell, themes (4–6), projects-demo, scratches, project-keys, editor-settings, editor-strip, projects, history. The console-error check runs over what
//           ran.
// Needs a build (pnpm build) and Playwright with Chrome for Testing: `pnpm e2e:setup` puts both under .state/
// (Playwright is NOT a workspace dependency, as in the second sibling extension). Elsewhere: PLAYWRIGHT_DIR=<a
// directory with node_modules/playwright>, PLAYWRIGHT_BROWSERS_PATH=<its browsers>.

import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dropFiles, fixtures, pointOn, runCompareChecks } from './e2e-compare.mjs';
import { forgetSavedParameters } from './e2e-helpers.mjs';
import { runOwnPageChecks } from './e2e-own-page.mjs';
import { runHistoryChecks } from './e2e-history.mjs';
import { runStartChecks } from './e2e-start.mjs';
import { recordedErrors, runToolChecks, toolCheckModules } from './e2e-tools.mjs';
import { runToolbarChecks } from './e2e-toolbar.mjs';
import { themeFromList, themeMode, withSettings } from './e2e-theme.mjs';
import { runShellChecks } from './e2e-shell.mjs';
import { runProjectsDemoChecks } from './e2e-projects-demo.mjs';
import { runProjectsChecks } from './e2e-projects.mjs';
import { runScratchesChecks } from './e2e-scratches.mjs';
import { runKeysChecks } from './e2e-keys.mjs';
import { runEditorSettingsChecks } from './e2e-editor-settings.mjs';
import { runEditorStripChecks } from './e2e-editor-strip.mjs';
import { runGrammarChecks } from './e2e-grammars.mjs';

/* global document, window, addEventListener, chrome, createImageBitmap, OffscreenCanvas, getComputedStyle, location -- page.evaluate callbacks run in the pages */

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2).filter(a => a !== '--');
const flag = name => argv.find(a => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DIST = resolve(argv.find(a => !a.startsWith('--')) ?? join(ROOT, 'dist'));
const SHOTS = flag('shots') ? resolve(flag('shots')) : null;
const ONLY = flag('only')
  ?.split(',')
  .map(s => s.trim())
  .filter(Boolean);
/** Does this run include the step (all of them without --only)? */
const want = step => !ONLY || ONLY.includes(step);
const JSON_OUT = resolve(flag('json') ?? join(ROOT, '.state/e2e/report.json'));
process.env.PLAYWRIGHT_BROWSERS_PATH ??= join(ROOT, '.state/extension-e2e/browsers');

if (!existsSync(join(DIST, 'manifest.json'))) {
  console.error(`No built extension in ${DIST} (run pnpm build, or pass the dist path).`);
  process.exit(2);
}

// The editor's highlighter of the build under test: the root as written, or the DEVTAB_VARIANT it was built with
// (scripts/highlighter-config.mjs) — `DEVTAB_VARIANT=highlighter:treeSitter pnpm test:e2e -- dist-tree-sitter`. Which
// module the module-page checks load, which colours the list must have, and whether the grammar files are checked.
const HIGHLIGHTER = JSON.parse(
  execFileSync(process.execPath, [join(ROOT, 'scripts/highlighter-config.mjs')], { encoding: 'utf8' }),
);
if (existsSync(join(DIST, 'grammars/index.json')) !== (HIGHLIGHTER.highlighter === 'treeSitter')) {
  console.error(
    `${DIST} is ${existsSync(join(DIST, 'grammars/index.json')) ? '' : 'not '}a tree-sitter build, but the highlighter ` +
      `is ${HIGHLIGHTER.highlighter}: run with the DEVTAB_VARIANT the build was made with.`,
  );
  process.exit(2);
}

const loadPlaywright = () => {
  for (const dir of [process.env.PLAYWRIGHT_DIR, join(ROOT, '.state/e2e/node')].filter(Boolean)) {
    try {
      return createRequire(join(resolve(dir), 'package.json'))('playwright');
    } catch {
      // the next place
    }
  }
  console.error('Playwright not found. Run `pnpm e2e:setup` (or set PLAYWRIGHT_DIR).');
  process.exit(2);
};
const { chromium } = loadPlaywright();

const report = { dist: DIST, startedAt: new Date().toISOString(), checks: [], console: [], shots: [] };
const check = (name, ok, detail = '') => {
  report.checks.push({ name, ok, detail });
  console.log(`${ok ? '✓' : '✗'} ${name}${detail ? ` — ${detail}` : ''}`);
  return ok;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));

mkdirSync(join(ROOT, '.state/e2e/profiles'), { recursive: true });
const profile = mkdtempSync(join(ROOT, '.state/e2e/profiles/run-'));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  ignoreDefaultArgs: ['--disable-extensions'],
  // --enable-unsafe-extension-debugging: CDP Extensions.triggerAction, to press the toolbar button (e2e-toolbar.mjs).
  args: [
    `--disable-extensions-except=${DIST}`,
    `--load-extension=${DIST}`,
    '--lang=en-US',
    '--enable-unsafe-extension-debugging',
  ],
  viewport: { width: 1440, height: 900 },
  colorScheme: 'light',
});

// The module the extension ships (validate-build checks that dist carries exactly this wasm), on a page of its own for
// the checks that call it directly. Served by route: nothing goes to the network.
const MODULE_ORIGIN = 'https://review-module.test';
const MODULE_DIR = join(ROOT, HIGHLIGHTER.pkg);
await ctx.route(`${MODULE_ORIGIN}/**`, route => {
  const path = new URL(route.request().url()).pathname;
  if (path === '/') {
    return route.fulfill({ contentType: 'text/html', body: '<!doctype html><meta charset="utf-8"><body></body>' });
  }
  const file = { '/review_wasm.js': 'text/javascript', '/review_wasm_bg.wasm': 'application/wasm' }[path];
  return file
    ? route.fulfill({ contentType: file, body: readFileSync(join(MODULE_DIR, path.slice(1))) })
    : route.fulfill({ status: 404, body: '' });
});

const shoot = async (target, name) => {
  if (!SHOTS) return;
  mkdirSync(SHOTS, { recursive: true });
  const file = join(SHOTS, name);
  await target.screenshot({ path: file });
  report.shots.push(file);
};

/** Pixel statistics of a PNG, decoded in a blank page (the spike's method). */
const pixelStats = async png => {
  const page = await ctx.newPage();
  try {
    return await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
      let green = 0;
      let red = 0;
      let lum = 0;
      for (let i = 0; i < data.length; i += 4) {
        const [r, gg, b] = [data[i], data[i + 1], data[i + 2]];
        if (gg > r + 12 && gg > b + 4) green++;
        if (r > gg + 12 && r > b + 12) red++;
        lum += 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      }
      const total = data.length / 4;
      return {
        greenishPct: +((green / total) * 100).toFixed(2),
        reddishPct: +((red / total) * 100).toFixed(2),
        meanLuminance: Math.round(lum / total),
      };
    }, png.toString('base64'));
  } finally {
    await page.close();
  }
};

/** The most frequent colour of a PNG (`#rrggbb`) and its share — the editor's background. */
const dominantColor = async png => {
  const page = await ctx.newPage();
  try {
    return await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const { data } = g.getImageData(0, 0, bmp.width, bmp.height);
      const counts = new Map();
      for (let i = 0; i < data.length; i += 4) {
        const key = (data[i] << 16) | (data[i + 1] << 8) | data[i + 2];
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      const all = data.length / 4;
      const top = [...counts]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 3)
        .map(([key, n]) => ({ color: `#${key.toString(16).padStart(6, '0')}`, share: +(n / all).toFixed(3) }));
      return { ...top[0], top };
    }, png.toString('base64'));
  } finally {
    await page.close();
  }
};

/**
 * What each half of the editor's frame shows at its bottom: the lowest row with text on it (`ink`, dark on the
 * background), the lowest row tinted as a modified line (`blue`, a band across the pane), and how many rows are filled
 * with anything but the background (text rows, spacer rows, tinted rows). The scroll bars at the outer edges, the
 * divider and the module's status line are left out.
 */
const paneEnds = async png => {
  const page = await ctx.newPage();
  try {
    return await page.evaluate(async b64 => {
      const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
      const bmp = await createImageBitmap(new Blob([bytes], { type: 'image/png' }));
      const canvas = new OffscreenCanvas(bmp.width, bmp.height);
      const g = canvas.getContext('2d');
      g.drawImage(bmp, 0, 0);
      const { data, width, height } = g.getImageData(0, 0, bmp.width, bmp.height);
      const at = (x, y) => {
        const i = (y * width + x) * 4;
        return [data[i], data[i + 1], data[i + 2]];
      };
      const lum = ([r, gg, b]) => 0.2126 * r + 0.7152 * gg + 0.0722 * b;
      const bottom = height - 40;
      const pane = (x0, x1) => {
        const counts = new Map();
        for (let y = 0; y < bottom; y += 2)
          for (let x = x0; x < x1; x += 2) {
            const key = at(x, y).join(',');
            counts.set(key, (counts.get(key) ?? 0) + 1);
          }
        const background = [...counts]
          .sort((a, b) => b[1] - a[1])[0][0]
          .split(',')
          .map(Number);
        const backgroundLum = lum(background);
        let ink = null;
        let blue = null;
        let filled = 0;
        for (let y = 0; y < bottom; y++) {
          const row = new Map();
          let dark = false;
          for (let x = x0; x < x1; x++) {
            const c = at(x, y);
            if (lum(c) < backgroundLum - 80) dark = true;
            const key = c.join(',');
            row.set(key, (row.get(key) ?? 0) + 1);
          }
          if (dark) ink = y;
          const [key, n] = [...row].sort((a, b) => b[1] - a[1])[0];
          const c = key.split(',').map(Number);
          if (n > (x1 - x0) * 0.4 && c.some((v, i) => Math.abs(v - background[i]) > 4)) {
            filled++;
            if (c[2] > c[0] + 8 && c[2] > c[1] + 3) blue = y;
          }
        }
        return { ink, blue, filled };
      };
      const half = Math.floor(width / 2);
      // The new side's scroll-bar thumb: the dark run in the frame's right-most 16 columns, from the top.
      const backgroundLum = lum(at(width - 40, 10));
      let thumb = null;
      for (let x = width - 16; x < width && !thumb; x++)
        for (let y = 0; y < bottom; y++)
          if (lum(at(x, y)) < backgroundLum - 20) {
            let end = y;
            while (end + 1 < bottom && lum(at(x, end + 1)) < backgroundLum - 20) end++;
            if (end - y >= 8) {
              thumb = { x: x + 2, y: Math.round((y + end) / 2) };
              break;
            }
            y = end;
          }
      return { old: pane(16, half - 4), new: pane(half + 4, width - 16), height, thumb };
    }, png.toString('base64'));
  } finally {
    await page.close();
  }
};

const hexToRgb = hex => [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
const near = (a, b, tolerance = 3) => hexToRgb(a).every((v, i) => Math.abs(v - hexToRgb(b)[i]) <= tolerance);
const THEME_INDEX = JSON.parse(readFileSync(join(ROOT, 'packages/dna/themes.index.json'), 'utf8'));
const TOKENS = JSON.parse(readFileSync(join(ROOT, 'packages/dna/tokens.json'), 'utf8'));
const OTHER_THEME = THEME_INDEX.find(t => t.id === 'tokyo-night');
/** `#rrggbbaa` over an opaque `#rrggbb`. */
const over = (top, bottom) => {
  const a = top.length === 9 ? parseInt(top.slice(7), 16) / 255 : 1;
  const [t, b] = [hexToRgb(top.slice(0, 7)), hexToRgb(bottom)];
  return `#${t
    .map((v, i) =>
      Math.round(v * a + b[i] * (1 - a))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
};
// The editor in the wasm paints its background with gpui-kit's input_background() (the highlight theme's
// `editor.background` is not read without tree-sitter — docs/theming.md §1.8): `--input-background` over `--background`.
// A tree-sitter build reads it (gpui-kit's editor_background(): the highlight theme's, else input_background()).
const otherTokens = TOKENS.themes[OTHER_THEME.id].tokens;
const OTHER_HIGHLIGHT_BG =
  HIGHLIGHTER.highlighter === 'treeSitter'
    ? JSON.parse(readFileSync(join(ROOT, 'packages/theme/gpui-themes', OTHER_THEME.source), 'utf8'))
        .themes.find(t => t.name === OTHER_THEME.name)
        ?.highlight?.['editor.background']?.toLowerCase()
    : undefined;
const OTHER_EDITOR_BG = OTHER_HIGHLIGHT_BG ?? over(otherTokens['--input-background'], otherTokens['--background']);

/** Box, spacing, type and colours of one element, as the browser computed them. */
const measureOf = locator =>
  locator.evaluate(el => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return {
      width: +r.width.toFixed(2),
      height: +r.height.toFixed(2),
      top: +r.top.toFixed(2),
      bottom: +r.bottom.toFixed(2),
      paddingLeft: cs.paddingLeft,
      paddingRight: cs.paddingRight,
      paddingTop: cs.paddingTop,
      borderRadius: cs.borderTopLeftRadius,
      borderWidth: cs.borderTopWidth,
      borderColor: cs.borderTopColor,
      background: cs.backgroundColor,
      color: cs.color,
      fontFamily: cs.fontFamily.split(',')[0],
      fontSize: cs.fontSize,
      fontWeight: cs.fontWeight,
      lineHeight: cs.lineHeight,
      boxShadow: cs.boxShadow,
      gap: cs.columnGap,
    };
  });

/** The theme's variables as the page resolved them. */
const tokensOf = (page, names) =>
  page.evaluate(
    list =>
      Object.fromEntries(list.map(n => [n, getComputedStyle(document.documentElement).getPropertyValue(n).trim()])),
    names,
  );

let failed = false;
let files = null;
try {
  // 1. The extension loads.
  const sw =
    ctx.serviceWorkers().find(w => w.url().endsWith('/service-worker-loader.js')) ??
    (await ctx.waitForEvent('serviceworker', { timeout: 20_000 }));
  const id = new URL(sw.url()).host;
  check('service worker runs', true, sw.url());

  const extPage = await ctx.newPage();
  await extPage.goto('chrome://extensions/');
  const info = await extPage.evaluate(async extId => {
    await chrome.developerPrivate.updateProfileConfiguration({ inDeveloperMode: true });
    const all = await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true, includeTerminated: true });
    const e = all.find(x => x.id === extId);
    return (
      e && {
        name: e.name,
        version: e.version,
        state: e.state,
        manifestErrors: e.manifestErrors,
        installWarnings: e.installWarnings,
        runtimeErrors: e.runtimeErrors,
        permissions: e.permissions,
      }
    );
  }, id);
  await extPage.close();
  report.extension = info;
  check(
    'loaded without manifest errors or install warnings',
    !!info && info.state === 'ENABLED' && !info.manifestErrors.length && !info.installWarnings.length,
    info ? `${info.name} ${info.version}, ${info.state}` : 'not found',
  );

  // 1b. The New Tab page.
  if (want('start')) await runStartChecks({ ctx, sw, id, dist: DIST, check, shoot, report, sleep });
  // 1b'. Our page by its address, the options page.
  if (want('own-page')) await runOwnPageChecks({ ctx, sw, id, dist: DIST, check, shoot, report, sleep });
  // 1c. The toolbar button.
  if (want('toolbar')) await runToolbarChecks({ ctx, sw, id, dist: DIST, check, shoot, report, sleep });

  const page = await ctx.newPage();
  page.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
  });
  page.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
  const base = `chrome-extension://${id}/src/app/index.html`;

  const openSection = async (section, ready) => {
    await page.goto(`${base}#/${section}`);
    await ready();
  };
  const status = page.locator('.kit-compare-counts');
  const frameEl = page.locator('iframe.kit-compare-frame');
  const frame = page.frameLocator('iframe.kit-compare-frame');
  const editorReady = async () => {
    await status.and(page.locator('[data-viewer-state="ready"]')).waitFor({ timeout: 30_000 });
    await page.waitForFunction(() => Number(document.querySelector('.kit-compare-counts')?.dataset.shown) > 0, null, {
      timeout: 15_000,
    });
    await sleep(500); // two frames after show_diff, and the scroll sync settling
  };
  /** The counts on the page, as the module answered them. */
  const countsOf = () =>
    status.evaluate(el => `${el.dataset.changes} changes · +${el.dataset.added} −${el.dataset.removed} lines`);
  files = fixtures();
  const toolsReady = async () => {
    const input = page.getByLabel('Input');
    await input.waitFor({ timeout: 5_000 });
    await input.fill('{"name":"example","tags":["diff","tools"],"nested":{"b":2,"a":1},"ok":true}');
    // The JSON tool formats as the text changes: the result is there once the status says so.
    await page.locator('[data-part="status"]', { hasText: 'Valid JSON' }).waitFor({ timeout: 5_000 });
  };
  const projectsReady = () => page.getByRole('heading', { name: 'Projects', level: 1 }).waitFor({ timeout: 10_000 });

  if (want('compare')) {
    // 2. Compare code — the default light theme.
    await page.goto(`${base}#/compare`);
    await page.waitForFunction(
      () => document.querySelector('.kit-compare-counts')?.getAttribute('data-shown-path') === 'after.rs',
      null,
      { timeout: 45_000 },
    );
    await editorReady();
    check('the editor starts and shows the opening example', true, await countsOf());
    check(
      'the page starts in the default light theme',
      (await page.evaluate(() => document.documentElement.dataset.theme)) === 'default-light',
    );
    await shoot(page, '01-compare-light.png');

    const before = Number(await status.getAttribute('data-shown'));
    const oldText = [
      'def greet(name):',
      '    """Say hello."""',
      "    print('Hello, ' + name)",
      '',
      'def unused():',
      '    return None',
      '',
      "greet('world')",
      '',
    ].join('\n');
    const newText = [
      'def greet(name: str) -> None:',
      '    """Say hello."""',
      "    print(f'Hello, {name}!')",
      '',
      "greet('world')",
      "greet('reviewer')",
      '',
    ].join('\n');
    // What crosses the iframe boundary, recorded on both sides: the editor page's inbox, the main page's answers.
    const viewerFrame = page.frames().find(f => f.url().endsWith('/src/viewer/index.html'));
    await viewerFrame.evaluate(() => {
      globalThis.__inbox = [];
      globalThis.addEventListener('message', e => globalThis.__inbox.push(e.data));
    });
    await page.evaluate(() => {
      globalThis.__answers = [];
      globalThis.addEventListener('message', e => globalThis.__answers.push(e.data));
    });
    /** Two texts as two files dropped over the editor: the first is the original. */
    const compareThroughPage = async (before, after, name = 'probe.py') => {
      const n = Number(await status.getAttribute('data-shown'));
      const paths = [files.file(`two/old-${name}`, before), files.file(`two/${name}`, after)];
      await dropFiles(page, paths, await pointOn(page, 'new'), sleep);
      await page.waitForFunction(n => Number(document.querySelector('.kit-compare-counts')?.dataset.shown) > n, n, {
        timeout: 30_000,
      });
      await sleep(400);
      return countsOf();
    };
    const summary = await compareThroughPage(oldText, newText);

    // The language list open: measured against gpui-kit's Select (docs/theming-specs/gpui-kit-form-controls.md §7).
    // At rest first: an open list hides the rest of the page from the accessibility tree (Radix's aria-hidden).
    const language = page.getByLabel('Language', { exact: true });
    report.measure = {
      theme: 'default-light',
      tokens: await tokensOf(page, [
        '--primary',
        '--primary-foreground',
        '--button',
        '--button-foreground',
        '--input',
        '--input-background',
        '--foreground',
        '--popover',
        '--accent',
        '--muted-foreground',
        '--radius-md',
      ]),
      buttonGhostIconSmall: await measureOf(page.locator('[data-side="old"] [data-action="open"]')),
      selectTrigger: await measureOf(language),
      selectChevron: await measureOf(language.locator('svg')),
      navItemActive: await measureOf(page.locator('.kit-nav-item[aria-current="page"]')),
      // The theme's mode bar lives in Settings → Appearance (no picker in the sidebar).
      segmentActive: await withSettings(ctx, base, settings =>
        measureOf(settings.getByRole('radio', { name: 'System' })),
      ),
    };
    await language.click();
    const listbox = page.getByRole('listbox');
    await listbox.waitFor({ timeout: 5_000 });
    await sleep(250); // the 150 ms entrance
    await page.mouse.move(0, 0);
    const content = page.locator('[data-slot="select-content"]');
    report.measure.selectContent = await measureOf(content);
    report.measure.selectViewport = await measureOf(content.locator('[data-radix-select-viewport]'));
    report.measure.selectItemChecked = await measureOf(page.getByRole('option', { name: 'Rust', exact: true }));
    report.measure.selectItem = await measureOf(page.getByRole('option', { name: 'Python', exact: true }));
    await page.getByRole('option', { name: 'Python', exact: true }).hover();
    await sleep(100);
    report.measure.selectItemHover = await measureOf(page.getByRole('option', { name: 'Python', exact: true }));
    await shoot(page, '02-compare-language-list.png');
    await page.getByRole('option', { name: 'Python', exact: true }).click();
    await listbox.waitFor({ state: 'detached', timeout: 5_000 });
    check('the language comes from the shadcn Select', (await language.innerText()).trim() === 'Python');
    check(
      'two different texts are compared',
      Number(await status.getAttribute('data-shown')) > before && /\d+ changes · \+\d+ −\d+ lines/.test(summary),
      summary,
    );
    const [sent] = await viewerFrame.evaluate(() => globalThis.__inbox.filter(m => m?.type === 'viewer/compare'));
    check(
      'the page sends the two texts and no hunks',
      sent?.request?.oldText === oldText &&
        sent.request.newText === newText &&
        sent.request.language === 'python' &&
        !('hunks' in sent.request) &&
        !('options' in sent.request),
      JSON.stringify({ id: sent?.id, keys: Object.keys(sent?.request ?? {}) }),
    );
    const answer = (await page.evaluate(() => globalThis.__answers)).find(
      m => m?.type === 'viewer/shown' && m.id === sent?.id,
    )?.shown;
    report.compareAnswer = answer;
    check(
      // Lines 2–6 of the old text become line 2 of the new one: one modification, not a modification and a deletion.
      'the counts on the page are the module’s answer (Histogram: 3 changes, +3 −5)',
      answer?.lineDiffer === 'histogram' &&
        answer.changes === 3 &&
        answer.added === 3 &&
        answer.removed === 5 &&
        summary === `${answer.changes} changes · +${answer.added} −${answer.removed} lines`,
      JSON.stringify(answer),
    );

    // Requests the page itself never makes, sent to the editor page the way the page does: named variants as data.
    let probeId = 1_000_000;
    const probe = async (request, timeout = 20_000) => {
      const id = ++probeId;
      const started = await page.evaluate(
        ({ id, request }) => {
          globalThis.__answers = [];
          const frame = document.querySelector('iframe.kit-compare-frame');
          const started = performance.now();
          frame.contentWindow.postMessage({ type: 'viewer/compare', id, request }, location.origin);
          return started;
        },
        { id, request },
      );
      await page.waitForFunction(
        id => globalThis.__answers.some(m => m?.id === id && (m.type === 'viewer/shown' || m.type === 'viewer/error')),
        id,
        { timeout },
      );
      const answered = await page.evaluate(() => performance.now());
      const message = (await page.evaluate(() => globalThis.__answers)).find(m => m?.id === id);
      return { ...message, roundTripMs: +(answered - started).toFixed(1) };
    };
    const pythonRequest = { path: 'probe.py', language: 'python', oldText, newText };
    const myers = await probe({ ...pythonRequest, options: { lineDiffer: 'myers' } });
    check(
      'a request can name a built-in differ (myers)',
      myers.type === 'viewer/shown' && myers.shown.lineDiffer === 'myers' && myers.shown.changes === 3,
      JSON.stringify(myers.shown ?? myers),
    );
    const shownBefore = await status.getAttribute('data-shown');
    const unknown = await probe({ ...pythonRequest, options: { lineDiffer: 'nope' } });
    check(
      'an unknown differ name is an error reported to the page, not a fallback',
      unknown.type === 'viewer/error' &&
        unknown.message.includes('unknown lineDiffer "nope"; built in: histogram, myers') &&
        !(await page.evaluate(() => globalThis.__answers)).some(m => m?.type === 'viewer/shown'),
      unknown.message,
    );
    const typo = await probe({ ...pythonRequest, options: { lineDifer: 'myers' } });
    check(
      'an unknown option is refused too',
      typo.type === 'viewer/error' && typo.message.includes('unknown field `lineDifer`'),
      typo.message,
    );
    check(
      'the page ignores answers to requests it did not make',
      (await status.getAttribute('data-shown')) === shownBefore,
    );

    // The cost of the comparison on the editor page's thread: a 50 000-line pair, unique lines, in every thousand a
    // modification, a deletion and an insertion (crates/review-view/examples/measure.rs times the same pair natively).
    const [bigOld, bigNew] = await page.evaluate(lines => {
      const base = i => `    let value_${i} = compute(${i}, "row ${i}");`;
      const before = [];
      const after = [];
      for (let i = 0; i < lines; i++) {
        before.push(base(i));
        const k = i % 1000;
        if (k === 100) after.push(`    let value_${i} = compute(${i}, "row ${i}") + 1;`);
        else if (k === 400) continue;
        else if (k === 700) after.push(base(i), `    log("inserted after ${i}");`);
        else after.push(base(i));
      }
      return [before.join('\n') + '\n', after.join('\n') + '\n'];
    }, 50_000);
    report.browserTiming = { lines: 50_000, bytes: [bigOld.length, bigNew.length], runs: {} };
    for (const lineDiffer of ['histogram', 'myers']) {
      const runs = [];
      for (let run = 0; run < 5; run++) {
        const result = await probe({
          path: 'large.rs',
          language: 'text',
          oldText: bigOld,
          newText: bigNew,
          options: { lineDiffer },
        });
        runs.push({
          changes: result.shown?.changes,
          compareMs: result.shown?.compareMs,
          roundTripMs: result.roundTripMs,
        });
      }
      report.browserTiming.runs[lineDiffer] = runs;
    }
    const median = values => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)];
    const timing = Object.fromEntries(
      Object.entries(report.browserTiming.runs).map(([name, runs]) => [
        name,
        {
          compareMs: +median(runs.map(r => r.compareMs)).toFixed(1),
          roundTripMs: median(runs.map(r => r.roundTripMs)),
        },
      ]),
    );
    report.browserTiming.median = timing;
    check(
      'a 50 000-line pair is compared in the browser (150 changes)',
      Object.values(report.browserTiming.runs).every(runs => runs.every(r => r.changes === 150)),
      Object.entries(timing)
        .map(([name, t]) => `${name}: compare ${t.compareMs} ms, request to answer ${t.roundTripMs} ms`)
        .join('; '),
    );
    // The same pair through the page itself: two files dropped, the counts on the page.
    const bigSummary = await compareThroughPage(bigOld, bigNew, 'large.txt');
    check(
      'the page shows the module’s counts for the large pair',
      bigSummary === '150 changes · +100 −100 lines',
      bigSummary,
    );
    // Scroll the editor to the first changes (rows 100–130): both sides move together, the rows stay level.
    const box = await frameEl.boundingBox();
    await page.mouse.move(box.x + box.width * 0.75, box.y + box.height / 2);
    await page.mouse.wheel(0, 1980);
    await sleep(600);
    await shoot(page, '13-compare-50000-lines.png');
    // The end of a long file. The view keeps both sides level with blank spacer rows; the editor once laid out the rows
    // of its viewport as if those rows were not there, so at the end of a long file it drew too few lines, or none
    // (docs/extension-structure.md §11.8). The large pair with its last line modified: that line's tint must stand at
    // the bottom of both sides, on one row, however the side is scrolled to the end.
    const scrollToEnd = async how => {
      const frameBox = await frameEl.boundingBox();
      const right = { x: frameBox.x + frameBox.width * 0.75, y: frameBox.y + frameBox.height / 2 };
      if (how === 'wheel') {
        await page.mouse.move(right.x, right.y);
        for (let i = 0; i < 30; i++) await page.mouse.wheel(0, 100_000);
      } else if (how === 'top') {
        await page.mouse.move(right.x, right.y);
        for (let i = 0; i < 30; i++) await page.mouse.wheel(0, -100_000);
      } else if (how === 'drag') {
        // The thumb of the new side's scroll bar, at the top of the track at the frame's right edge. A turn of the wheel
        // shows the bar; the frame's pixels tell where the thumb is. Then the thumb is dragged past the track's end.
        await page.mouse.move(right.x, right.y);
        await page.mouse.wheel(0, 200);
        await sleep(150);
        const found = (await paneEnds(await frameEl.screenshot())).thumb;
        report.endOfFile.dragThumb = found;
        const thumb = found
          ? { x: frameBox.x + found.x, y: frameBox.y + found.y }
          : { x: frameBox.x + frameBox.width - 8, y: frameBox.y + 20 };
        await page.mouse.move(thumb.x, thumb.y, { steps: 3 });
        await page.mouse.down();
        await page.mouse.move(thumb.x, frameBox.y + frameBox.height + 40, { steps: 20 });
        await page.mouse.up();
      } else {
        // The editor in wasm takes the bindings of a platform other than macOS.
        await page.mouse.click(right.x, right.y);
        await page.keyboard.press('Control+End');
      }
      await sleep(700);
    };
    const endPair = [bigOld, bigNew.replace(/\);\n$/, ') + 1;\n')];
    report.endOfFile = {};
    for (const how of ['wheel', 'drag', 'keys']) {
      const shown = await probe({ path: 'large-end.rs', language: 'text', oldText: endPair[0], newText: endPair[1] });
      await sleep(400);
      // A new comparison keeps the offset the editors had; each way starts from the top.
      const thumbAtShow = (await paneEnds(await frameEl.screenshot())).thumb;
      await scrollToEnd('top');
      await scrollToEnd(how);
      const ends = await paneEnds(await frameEl.screenshot());
      report.endOfFile[how] = { ...ends, thumbAtShow };
      await shoot(page, `15-end-of-large-pair-${how}.png`);
      check(
        `scrolled to the end by ${how}, the last line of the 50 000-line pair is drawn on both sides, level`,
        shown.shown?.changes === 151 &&
          ends.old.blue !== null &&
          ends.new.blue !== null &&
          Math.abs(ends.old.blue - ends.new.blue) <= 1,
        `the last line's tint ends at y=${ends.old.blue} (old) and y=${ends.new.blue} (new) of ${ends.height}; ` +
          `text ends at y=${ends.old.ink} and y=${ends.new.ink}`,
      );
    }
    // The cases next to it, each scrolled to the end by the wheel: spacer rows at the very start, a file that ends with
    // a spacer block (no newline at the end), a file shorter than the editor, no spacer rows at all, a pure insertion
    // and a pure deletion at the end, and 60 deleted lines 40 lines before the end (crates/review-view/examples/window.rs
    // has the same pairs). Neither side may be blank at the end.
    const numbered = (from, to) =>
      Array.from(
        { length: to - from },
        (_, k) => `    let value_${from + k} = compute(${from + k}, "row ${from + k}");`,
      );
    const lines = list => list.join('\n') + '\n';
    const added = n => Array.from({ length: n }, (_, k) => `    // added ${k}`);
    const shortNew = numbered(0, 10);
    shortNew.splice(3, 1);
    shortNew.splice(6, 0, ...added(3));
    const endCases = {
      'delete-near-end': [lines(numbered(0, 50_000)), lines([...numbered(0, 49_900), ...numbered(49_960, 50_000)])],
      'delete-end': [lines(numbered(0, 50_000)), lines(numbered(0, 49_940))],
      'insert-end': [lines(numbered(0, 49_940)), lines(numbered(0, 50_000))],
      start: [lines(numbered(0, 2_000)), lines([...added(60), ...numbered(0, 2_000)])],
      'end-block': [numbered(0, 2_000).join('\n'), numbered(0, 2_060).join('\n')],
      short: [lines(numbered(0, 10)), lines(shortNew)],
      'no-spacers': [
        lines(numbered(0, 2_000)),
        lines(numbered(0, 2_000).map((l, i) => (i % 100 === 50 ? `${l} // changed` : l))),
      ],
    };
    for (const [name, [before, after]] of Object.entries(endCases)) {
      await probe({ path: `${name}.rs`, language: 'text', oldText: before, newText: after });
      await sleep(400);
      await scrollToEnd('wheel');
      const ends = await paneEnds(await frameEl.screenshot());
      report.endOfFile[name] = ends;
      await shoot(page, `16-end-${name}.png`);
      // Text, or a band of spacer or changed rows; a stray line of a border is neither.
      const drawn = side => side.ink !== null || side.filled > 4;
      check(
        `the end of ${name}.rs is drawn on both sides`,
        drawn(ends.old) && drawn(ends.new),
        `old: text to y=${ends.old.ink}, ${ends.old.filled} filled rows; new: text to y=${ends.new.ink}, ` +
          `${ends.new.filled} filled rows`,
      );
    }
    // Back to the two texts, for the screenshot of them.
    await compareThroughPage(oldText, newText);
    const light = await pixelStats(await frameEl.screenshot());
    report.compareLight = light;
    check(
      'the editor shows a coloured diff (added green, removed red)',
      // The editor has the whole section now (no fields above it): the same diff covers a smaller share of the frame.
      light.greenishPct > 0.5 && light.reddishPct > 0.1,
      JSON.stringify(light),
    );
    await shoot(page, '03-compare-two-texts.png');

    // 2b. A request that arrives before the editor's first frame. The module first, called as early as a page can call
    // it: on a page of its own (the module files served by route, never fetched from the network).
    const earlyRequest = { path: 'early.py', language: 'python', oldText, newText };
    const moduleRun = async (body, shot) => {
      const modulePage = await ctx.newPage();
      const messages = [];
      modulePage.on('console', m => messages.push(`${m.type()}: ${m.text()}`));
      modulePage.on('pageerror', e => messages.push(`pageerror: ${e}`));
      await modulePage.goto(`${MODULE_ORIGIN}/`);
      try {
        const result = await modulePage.evaluate(body, earlyRequest);
        await sleep(600);
        const pixels = shot ? await pixelStats(await modulePage.screenshot()) : null;
        if (shot) await shoot(modulePage, shot);
        return { ...result, pixels, panics: messages.filter(m => /panicked|RuntimeError|unreachable/.test(m)) };
      } finally {
        await modulePage.close();
      }
    };
    // Before init, after init, right after run(), then every task until the module takes the request.
    const polled = await moduleRun(async request => {
      const events = [];
      globalThis.__reviewEvent = (name, detail) => events.push({ name, detail, at: performance.now() });
      const m = await import('/review_wasm.js');
      const attempt = () => {
        try {
          m.compare_texts(JSON.stringify(request));
          return null;
        } catch (error) {
          return String(error);
        }
      };
      const beforeInit = attempt();
      await m.default({ module_or_path: '/review_wasm_bg.wasm' });
      const beforeRun = attempt();
      m.run(JSON.stringify({}));
      const afterRun = attempt();
      const tick = () =>
        new Promise(resolve => {
          const channel = new MessageChannel();
          channel.port1.onmessage = () => resolve();
          channel.port2.postMessage(0);
        });
      let refused = 0;
      let lastRefusal = null;
      for (let i = 0; i < 20_000; i++) {
        await tick();
        const error = attempt();
        if (!error) break;
        refused++;
        lastRefusal = error;
      }
      const acceptedAt = performance.now();
      const firstFrameBefore = events.some(e => e.name === 'first-frame');
      while (!events.some(e => e.name === 'first-frame') && performance.now() - acceptedAt < 10_000) await tick();
      return {
        beforeInit,
        beforeRun,
        afterRun,
        refused,
        lastRefusal,
        acceptedBeforeFirstFrame: !firstFrameBefore,
        events: events.map(e => ({ name: e.name, detail: e.detail })),
      };
    }, '14-module-request-before-first-frame.png');
    report.earlyModule = polled;
    const polledShown = polled.events.find(e => e.name === 'shown');
    // What the sides offer the editor's commands (`standing`, the strip's) is told apart from what is shown: left out of
    // the order checked here.
    const polledOrder = polled.events.filter(e => e.name !== 'standing').map(e => e.name);
    check(
      'the module refuses a request before run() with an error, never a panic',
      /__wbindgen|undefined/.test(polled.beforeInit ?? '') &&
        polled.beforeRun === 'compare_texts: the window is not open yet' &&
        polled.afterRun === 'compare_texts: the window is not open yet' &&
        polled.panics.length === 0,
      JSON.stringify({ beforeInit: polled.beforeInit, beforeRun: polled.beforeRun, afterRun: polled.afterRun }),
    );
    check(
      'a request the module takes before its first frame is shown in that frame',
      polled.acceptedBeforeFirstFrame &&
        JSON.parse(polledShown?.detail ?? '{}').changes === 3 &&
        polledOrder.join(',') === 'shown,first-frame' &&
        polled.pixels.greenishPct > 0.5,
      `refused ${polled.refused}× while the window opened; then ${polled.events.map(e => e.name).join(' → ')}; ` +
        JSON.stringify(polled.pixels),
    );
    // From inside the module's own callbacks: `first-frame` and `shown` reach the page after the module's call returns,
    // so the page may answer synchronously with another export.
    const nested = await moduleRun(async request => {
      const events = [];
      const results = [];
      const m = await import('/review_wasm.js');
      globalThis.__reviewEvent = (name, detail) => {
        events.push(name === 'shown' ? `shown ${JSON.parse(detail).path}` : name);
        const next =
          name === 'first-frame' ? 'from-first-frame.py' : detail.includes('from-first-frame') ? 'from-shown.py' : null;
        if (!next) return;
        try {
          m.compare_texts(JSON.stringify({ ...request, path: next }));
          results.push(`${next}: ok`);
        } catch (error) {
          results.push(`${next}: ${error}`);
        }
      };
      await m.default({ module_or_path: '/review_wasm_bg.wasm' });
      m.run(JSON.stringify({}));
      const started = performance.now();
      while (!events.includes('shown from-shown.py') && performance.now() - started < 10_000)
        await new Promise(resolve => setTimeout(resolve, 20));
      return { events, results };
    });
    report.earlyNested = nested;
    check(
      'the page may call the module from inside its first-frame and shown callbacks',
      nested.events.filter(e => e !== 'standing').join(',') ===
        'first-frame,shown from-first-frame.py,shown from-shown.py' &&
        [...nested.results].sort().join(',') === 'from-first-frame.py: ok,from-shown.py: ok' &&
        nested.panics.length === 0,
      `${nested.events.join(' → ')}; ${nested.results.join(', ')}${nested.panics.length ? `; ${nested.panics[0]}` : ''}`,
    );

    // Then the editor page of the extension, asked before its module has even loaded: the main page posts the request
    // the moment the editor page's script has run (its DOMContentLoaded, seen from inside the frame), long before the
    // first frame and `viewer/ready`. A message posted before any script of the page runs has no listener to reach.
    const earlyPage = await ctx.newPage();
    earlyPage.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    await earlyPage.addInitScript(request => {
      if (window === window.top) {
        globalThis.__answers = [];
        addEventListener('message', e => globalThis.__answers.push({ ...e.data, at: performance.now() }));
        // Called from the frame; runs in this (the parent's) realm, so the message's source is the parent window.
        globalThis.__postEarly = () => {
          const target = document.querySelector('iframe.kit-compare-frame').contentWindow;
          globalThis.__earlySent = { at: performance.now(), readyState: target.document.readyState };
          target.postMessage({ type: 'viewer/compare', id: 777, request }, location.origin);
        };
      } else if (location.pathname.endsWith('/src/viewer/index.html')) {
        addEventListener('DOMContentLoaded', () => window.parent.__postEarly(), { once: true });
      }
    }, earlyRequest);
    await earlyPage.goto(`${base}#/compare`);
    const early = await earlyPage
      .waitForFunction(() => globalThis.__answers.some(m => m.id === 777), null, { timeout: 30_000 })
      .then(() => earlyPage.evaluate(() => ({ sent: globalThis.__earlySent, answers: globalThis.__answers })))
      .catch(async () => ({
        timedOut: true,
        ...(await earlyPage.evaluate(() => ({ sent: globalThis.__earlySent, answers: globalThis.__answers }))),
      }));
    await earlyPage.close();
    const earlyAnswer = early.answers?.find(m => m.id === 777);
    const readyAt = early.answers?.find(m => m.type === 'viewer/ready')?.at;
    report.earlyPage = { sent: early.sent, answer: earlyAnswer, readyAt, timedOut: !!early.timedOut };
    check(
      'the editor page answers a request sent before its module loaded',
      !early.timedOut &&
        early.sent?.at < readyAt &&
        earlyAnswer?.type === 'viewer/shown' &&
        earlyAnswer.shown.path === 'early.py' &&
        earlyAnswer.shown.changes === 3,
      early.timedOut
        ? `no answer in 30 s (sent at ${early.sent?.at?.toFixed(0)} ms, page ${early.sent?.readyState}; ` +
            `viewer/ready at ${readyAt?.toFixed(0)} ms)`
        : `sent at ${early.sent.at.toFixed(0)} ms (${early.sent.readyState}), viewer/ready at ${readyAt.toFixed(0)} ms, ` +
            `answered at ${earlyAnswer?.at.toFixed(0)} ms: ${JSON.stringify(earlyAnswer?.shown ?? earlyAnswer)}`,
    );

    // 2c. «Compare code»: drops, the toolbar, edit mode, saving, the examples, the keyboard.
    await runCompareChecks({ ctx, id, check, shoot, report, sleep, highlighter: HIGHLIGHTER });
    // 2d. The mixed tree-sitter build's grammar files (scripts/e2e-grammars.mjs).
    if (HIGHLIGHTER.highlighter === 'treeSitter') await runGrammarChecks({ ctx, id, check, shoot, report, sleep });
  }

  // 3. The tools: each tool's own checks (scripts/e2e-tools/<id>.mjs, found by scripts/e2e-tools.mjs), then the
  // controls of the JSON tool's page measured against gpui-kit.
  if (want('tools') || ONLY?.some(name => toolCheckModules().includes(`${name}.mjs`)))
    await runToolChecks({ ctx, page, base, id, check, shoot, sleep, report, only: want('tools') ? undefined : ONLY });
  if (want('tools')) {
    await page.goto(`${base}#/tools/json`);
    const input = page.getByLabel('Input');
    await input.fill('{"name":"example","tags":["diff","tools"],"nested":{"b":2,"a":1},"ok":true}');
    report.measure ??= {};
    report.measure.textarea = await measureOf(input);
    if (!(await page.getByLabel('Sort keys').isChecked())) await page.getByLabel('Sort keys').check();
    await page.mouse.move(0, 0);
    await sleep(400); // the checkbox's 180 ms colour transition
    report.measure.buttonOutline = await measureOf(page.getByRole('button', { name: 'Open file' }));
    report.measure.checkboxChecked = await measureOf(page.getByLabel('Sort keys'));
    // The current tool in the sidebar's Tools list (the Tools page has no list of its own since 2026-11-21).
    report.measure.navSubItemActive = await measureOf(page.locator('.kit-nav-sub-item[aria-current="page"]'));
    await shoot(page, '04-tools-light.png');
    // Sort keys was switched on for the measurements, and a tool keeps its options between uses (D21): the steps
    // after this one open the JSON tool expecting its defaults.
    await forgetSavedParameters(page, 'json');
  }

  // What Chrome has recorded for the extension is asked after each of the last groups too, so that an error found at
  // the end of a long run is named with the group it appeared in (as scripts/e2e-tools.mjs does per tool module).
  let knownErrors = (await recordedErrors({ ctx, id }))?.length ?? 0;
  const noteErrors = async group => {
    const now = await recordedErrors({ ctx, id });
    if (now && now.length > knownErrors) {
      const added = now.slice(knownErrors);
      (report.runtimeErrorsByGroup ??= {})[group] = added;
      console.log(`  (Chrome recorded ${added.length} error(s) during ${group}: ${added.join(' | ').slice(0, 300)})`);
    }
    knownErrors = now?.length ?? knownErrors;
  };

  // 3b. The shell: the tools nested under Tools, the toolbar and the palette, the theme by the system, the shortcuts.
  if (want('shell')) await runShellChecks({ ctx, id, check, shoot, report, sleep });
  await noteErrors('shell');

  if (want('themes')) {
    // 4. Projects.
    await openSection('projects', projectsReady);
    check('Projects opens on its demo', true);
    await shoot(page, '05-projects-light.png');

    // 5. The default dark theme, chosen in Settings in another tab: the page and the editor follow the switch (through
    // chrome.storage) without a reload.
    await openSection('compare', editorReady);
    const lightExample = await pixelStats(await frameEl.screenshot());
    await themeMode(ctx, base, 'Dark');
    await frame.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
    await sleep(500);
    const dark = await pixelStats(await frameEl.screenshot());
    report.compareDark = dark;
    const pageDark = await page.evaluate(() => document.documentElement.dataset.theme);
    check(
      'the dark theme repaints the page and the editor',
      pageDark === 'default-dark' && dark.meanLuminance < lightExample.meanLuminance - 60 && dark.greenishPct > 0.1,
      `page ${pageDark}; editor luminance ${lightExample.meanLuminance} → ${dark.meanLuminance}`,
    );
    await shoot(page, '06-compare-dark.png');
    await openSection('tools/json', toolsReady);
    await shoot(page, '07-tools-dark.png');
    await openSection('projects', projectsReady);
    await shoot(page, '08-projects-dark.png');

    // 6. A theme that is not a default, from the list in Settings: the page and the editor (with gpui-kit's theme file).
    await openSection('compare', editorReady);
    const darkOptions = await withSettings(ctx, base, async settings => {
      await settings.getByLabel('Dark theme', { exact: true }).click();
      await settings.getByRole('listbox').waitFor({ timeout: 5_000 });
      await sleep(250);
      await shoot(settings, '09-theme-list-open.png');
      const count = await settings.getByRole('option').count();
      await settings.getByRole('option', { name: OTHER_THEME.name, exact: true }).click();
      return count;
    });
    check(
      'the dark theme list offers every dark theme of themes.index.json',
      darkOptions === THEME_INDEX.filter(t => t.mode === 'dark').length,
      `${darkOptions} options`,
    );
    await frame.locator(`html[data-theme="${OTHER_THEME.id}"]`).waitFor({ timeout: 5_000 });
    await sleep(800);
    const pageOther = await page.evaluate(() => document.documentElement.dataset.theme);
    const editorBg = await dominantColor(await frameEl.screenshot());
    report.otherTheme = { id: OTHER_THEME.id, page: pageOther, editorDominant: editorBg, expected: OTHER_EDITOR_BG };
    check(
      `a theme from the list (${OTHER_THEME.name}) reaches the page and the editor`,
      // The background is the most common colour of the frame, or the second after the example's changed-line bands:
      // with the strip of buttons over each side the frame is a row shorter, and the bands may cover more of it.
      pageOther === OTHER_THEME.id &&
        editorBg.top.slice(0, 2).some(c => near(c.color, OTHER_EDITOR_BG) && c.share > 0.2),
      `page ${pageOther}; editor colours ${editorBg.top.map(c => `${c.color} ${Math.round(c.share * 100)} %`).join(', ')}, ` +
        (OTHER_HIGHLIGHT_BG
          ? `the theme's editor.background (a tree-sitter build reads it) ${OTHER_EDITOR_BG}`
          : `the theme's input_background over background ${OTHER_EDITOR_BG}`),
    );
    await shoot(page, '10-compare-tokyo-night.png');
    await openSection('tools/json', toolsReady);
    await shoot(page, '11-tools-tokyo-night.png');
    await openSection('projects', projectsReady);
    await shoot(page, '12-projects-tokyo-night.png');

    // Back to the defaults for the next run's profile (each run has its own profile; this only tidies the report).
    await themeFromList(ctx, base, 'Dark theme', 'Default Dark');
    await themeMode(ctx, base, 'System');
  }
  await noteErrors('themes');

  // «Projects» on its demo data (scripts/e2e-projects-demo.mjs).
  if (want('projects-demo')) await runProjectsDemoChecks({ ctx, id, check, shoot, report, sleep });
  await noteErrors('projects-demo');

  // Scratch files in «Projects», with no companion and no permission (scripts/e2e-scratches.mjs).
  if (want('scratches')) await runScratchesChecks({ ctx, id, check, shoot, report, sleep });
  if (want('project-keys')) await runKeysChecks({ ctx, id, check, shoot, report, sleep });
  await noteErrors('scratches');

  // The editor's settings: Settings → Editor, the indent indicator, Tab in every editor (scripts/e2e-editor-settings.mjs).
  if (want('editor-settings')) await runEditorSettingsChecks({ ctx, id, check, shoot, report, sleep });
  await noteErrors('editor-settings');

  // The strip of the editor's buttons over every editor (scripts/e2e-editor-strip.mjs).
  if (want('editor-strip')) await runEditorStripChecks({ ctx, id, check, shoot, report, sleep });
  await noteErrors('editor-strip');

  // «Projects» with a companion (scripts/e2e-projects.mjs): in a browser of its own, so this one's profile stays as it is.
  if (want('projects')) await runProjectsChecks({ chromium, dist: DIST, check, shoot, report, sleep });

  // 8. The tool history (scripts/e2e-history.mjs). Last: allowing incognito there reloads the extension.
  if (want('history')) await runHistoryChecks({ ctx, sw, id, check, shoot, report, sleep, root: ROOT });

  // The service worker's own errors, after everything ran.
  const after = await (async () => {
    const p = await ctx.newPage();
    await p.goto('chrome://extensions/');
    const e = await p.evaluate(
      async extId =>
        (await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true })).find(x => x.id === extId),
      id,
    );
    await p.close();
    return e;
  })();
  // A check that provokes an error on purpose (a blocked image proving the policy) names its message in
  // report.expectedRuntimeErrors; everything else Chrome recorded is a failure.
  const provoked = report.expectedRuntimeErrors ?? [];
  const recorded = after?.runtimeErrors ?? [];
  const unexpected = recorded.filter(e => !provoked.some(text => e.message?.includes(text)));
  check(
    'no runtime errors recorded for the extension',
    unexpected.length === 0,
    `${JSON.stringify(unexpected)}; provoked on purpose and recognised: ${recorded.length - unexpected.length}`,
  );

  const errors = report.console.filter(m => m.type !== 'warning');
  check('no console errors or page errors', errors.length === 0, errors.map(e => e.text).join(' | '));
  const warnings = report.console.filter(m => m.type === 'warning');
  if (warnings.length) console.log(`  (console warnings: ${warnings.map(w => w.text).join(' | ')})`);
} catch (error) {
  check('the run finished', false, String(error?.stack ?? error));
} finally {
  files?.cleanup();
  await ctx.close();
  rmSync(profile, { recursive: true, force: true });
  failed = report.checks.some(c => !c.ok);
  report.ok = !failed;
  mkdirSync(dirname(JSON_OUT), { recursive: true });
  writeFileSync(JSON_OUT, JSON.stringify(report, null, 2) + '\n');
  console.log(`\n${failed ? 'E2E FAILED' : 'E2E PASSED'} — report: ${JSON_OUT}`);
}
process.exit(failed ? 1 : 0);
