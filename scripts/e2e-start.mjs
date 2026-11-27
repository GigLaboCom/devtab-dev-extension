// The e2e checks of the New Tab page (D16), run by scripts/e2e-check.mjs right after the extension has loaded. They
// follow the build's New Tab override (extension/src/newTab/index.ts, read by scripts/entry-pages.mjs): where the build
// is the New Tab page, "a new tab" below is chrome.tabs.create({}); where it is not, the start page opened by its
// address (#/start), and the checks of "what a new tab opens" become checks that it is not offered:
//   - the manifest: `storage` and `search` required, `topSites` and `favicon` optional only; the main page is the New
//     Tab page and, at ?options#/settings, the options page; with most visited off the extension holds no topSites;
//   - a new tab (chrome.tabs.create with no address — what Chrome opens for Ctrl/Cmd+T) is the start page, titled
//     "New Tab", and loads none of the page's lazy chunks, the editor page or the wasm; its first paint and the
//     moment its field listens are timed over 20 opens against a budget;
//   - typing a tool's name and Enter opens the tool; pasting JSON opens the JSON tool with it; Enter on other text
//     hands it to Chrome's search API — the tab goes to the search engine's address, answered here, so the check
//     needs no network — and nothing leaves the page while typing;
//   - a shortcut added on the page is there in the next new tab;
//   - the manifest holds exactly what the start page's parts and the sections declare (scripts/permissions.mjs reads
//     the definitions);
//   - each switch of Settings → Start page hides its part; with web search off Enter does nothing else; most visited,
//     recently opened and recently closed ask Chrome for their permissions (headless: the prompt stays open, nothing is
//     granted); switched on without their permissions they read nothing and say why; the rows follow the stored order,
//     which a move in settings changes and the reset restores;
//   - "Last opened tool": a new tab opens that tool and never inserts the start page (watched from before the first
//     script of the page);
//   - the options entry (chrome://extensions → details → "Extension options" = runtime.openOptionsPage) reaches the
//     settings route.
// Screenshots: the start page and the settings page, light, dark and Tokyo Night, wide and narrow, and with every part
// off.

/* global document, window, location, chrome, DataTransfer, ClipboardEvent, MutationObserver -- page.evaluate callbacks run in the pages */

import { runAssemblyChecks } from './e2e-start-assembly.mjs';
import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const WIDE = { width: 1440, height: 900 };
const NARROW = { width: 420, height: 900 };
/** Budgets for a new tab in headless Chrome for Testing (p90 of 20 opens, ms); measured 60 and 39 at the start. */
const FIRST_PAINT_BUDGET = 150;
const READY_BUDGET = 150;

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
};

export const runStartChecks = async ({ ctx, sw, id, dist, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const opened = [];
  const watch = p => {
    p.on('console', m => {
      if (m.type() === 'error' || m.type() === 'warning')
        report.console.push({ type: m.type(), text: m.text(), url: m.location().url });
    });
    p.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e) }));
    opened.push(p);
    return p;
  };

  // Every http(s) request of the run's pages, answered here: nothing reaches the network.
  const network = [];
  await ctx.route(
    url => /^https?:$/.test(url.protocol) && !url.hostname.endsWith('.test'),
    route => {
      network.push(route.request().url());
      return route.fulfill({ contentType: 'text/html', body: '<!doctype html><title>stub</title><p>stub</p>' });
    },
  );
  // What each page loaded from the extension.
  const loads = new Map();
  ctx.on('request', r => {
    if (r.serviceWorker()) return;
    try {
      const p = r.frame().page();
      if (!loads.has(p)) loads.set(p, []);
      loads.get(p).push(new URL(r.url()).pathname);
    } catch {
      // a request of a frame already gone
    }
  });
  // From before the first script of every main page: was the start page ever inserted, and what was the hash.
  await ctx.addInitScript(() => {
    if (!location.pathname.endsWith('/src/app/index.html')) return;
    const trace = { startInserted: false, hashAtStart: location.hash, hashAtDcl: null };
    window.__newTabTrace = trace;
    new MutationObserver(() => {
      if (document.querySelector('[data-page="start"]')) trace.startInserted = true;
    }).observe(document, { childList: true, subtree: true });
    document.addEventListener('DOMContentLoaded', () => (trace.hashAtDcl = location.hash));
  });

  // How the build enters its pages (the definitions the manifest is derived from).
  const entry = JSON.parse(
    execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'entry-pages.mjs')]).toString(),
  );
  const ours = !!entry.newTab.newtab;
  const startUrl = ours ? base : `${base}#/start`;
  const newTab = async (ready = '[data-page="start"]') => {
    const event = ctx.waitForEvent('page', { timeout: 10_000 });
    await sw.evaluate(url => chrome.tabs.create(url ? { url } : {}), ours ? null : startUrl);
    const p = watch(await event);
    await p.waitForLoadState('load');
    await p.locator(ready).first().waitFor({ timeout: 10_000 });
    return p;
  };
  const field = p => p.getByRole('combobox', { name: 'Find a tool or search the web' });
  const region = (p, name) => p.getByRole('region', { name, exact: true });

  // The manifest.
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  // What the start page's parts and the main page's sections declare, read from their definitions (the manifest is
  // derived from them).
  const declared = JSON.parse(
    execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'permissions.mjs')]).toString(),
  );
  const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
  check(
    'the manifest holds exactly what the start page’s parts and the sections declare; nothing optional is required',
    same(manifest.permissions, ['storage', ...declared.required]) &&
      same(manifest.optional_permissions, declared.optional) &&
      !manifest.permissions.some(p => declared.optional.includes(p)),
    `required ${manifest.permissions}; optional ${manifest.optional_permissions}`,
  );
  check(
    `the New Tab override is '${entry.newTab.id}' (${ours ? 'the main page' : 'none'}), the options page '${entry.options.id}' (${entry.options.page}, ${entry.options.openInTab ? 'in a tab' : 'in Chrome’s dialog'})`,
    JSON.stringify(manifest.chrome_url_overrides ?? null) ===
      JSON.stringify(ours ? { newtab: 'src/app/index.html' } : null) &&
      manifest.options_ui?.page === entry.options.page &&
      manifest.options_ui?.open_in_tab === entry.options.openInTab,
    JSON.stringify({ chrome_url_overrides: manifest.chrome_url_overrides, options_ui: manifest.options_ui }),
  );

  // A new tab is the start page.
  const first = await newTab();
  const held = (await first.evaluate(() => chrome.permissions.getAll())).permissions;
  check(
    'with every part that reads the browser off, the extension holds none of their optional permissions',
    !held.some(p => declared.optional.includes(p)),
    held.join(', '),
  );
  const title = await first.title();
  check(
    ours
      ? 'a new tab is the start page, titled "New Tab", with no route in its address'
      : `the start page by its address (#/start), titled "Start page — ${manifest.name}"`,
    first.url() === startUrl &&
      title === (ours ? 'New Tab' : `Start page — ${manifest.name}`) &&
      (await field(first).isVisible()),
    `${first.url()} — "${title}"`,
  );
  const lazy = new Set(
    readdirSync(join(dist, 'assets'))
      .filter(f => f.endsWith('.js'))
      .flatMap(f => [...readFileSync(join(dist, 'assets', f), 'utf8').matchAll(/import\(\s*["']\.\/([^"']+\.js)["']/g)])
      .map(m => m[1]),
  );
  // The one chunk the start page loads by design after its first paint: the listener for the user's shortcuts
  // (extension/src/shortcuts/startKeys.ts) and what it imports. It must come after the first paint, never before.
  const afterPaintEntry = readdirSync(join(dist, 'assets')).find(f => /^startKeys-.*\.js$/.test(f));
  const afterPaint = new Set(
    afterPaintEntry
      ? [
          afterPaintEntry,
          ...[
            ...readFileSync(join(dist, 'assets', afterPaintEntry), 'utf8').matchAll(/from\s*["']\.\/([^"']+\.js)["']/g),
          ].map(m => m[1]),
        ]
      : [],
  );
  const loaded = loads.get(first) ?? [];
  // After its first load the start page loads the code of the parts that are on and, after its first paint, the
  // shortcut listener and the tools' `detect` (scripts/e2e-start-assembly.mjs checks each); never the shell, the tools'
  // definitions or components, the history, the editor page or the wasm.
  const extra = loaded.filter(
    path =>
      (lazy.has(path.split('/').pop()) &&
        /^(Shell|registry|behaviors|viewer)-|Tool-[\w-]{8}\.js$/.test(path.split('/').pop())) ||
      path.endsWith('.wasm') ||
      path.startsWith('/src/viewer/'),
  );
  // When it comes cannot be timed from here: resource timing leaves chrome-extension:// files out, and the request
  // event's clock in Node and the page's clock differ by tens of milliseconds. What is checked: the page asked for it
  // (the listener is there) and the page's first load does not name it — no <script> or modulepreload in the HTML
  // (validate-build.sh Check 15 holds the static import graph). That it waits for the first paint is the code's
  // (StartPage.tsx: afterFirstPaint, then import()).
  const html = readFileSync(join(dist, 'src/app/index.html'), 'utf8');
  const lateTiming = {
    requested: [...afterPaint].filter(n => loaded.some(path => path.endsWith(`/${n}`))),
    // Its own chunk; what it imports from the first load (the entry chunk) is there already.
    namedInHtml: afterPaintEntry && html.includes(afterPaintEntry),
  };
  report.startRoute = { loaded, lazyChunks: lazy.size, afterPaint: [...afterPaint], lateTiming };
  check(
    'the start route loads no shell, no tool’s definition or component, no history, no editor page and no wasm',
    loaded.length > 0 && extra.length === 0,
    extra.length ? extra.join(', ') : `${loaded.length} files: ${loaded.join(' ')}`,
  );
  check(
    'the start page loads its shortcut listener lazily, never in its first load',
    !!afterPaintEntry && lateTiming.requested.includes(afterPaintEntry) && !lateTiming.namedInHtml,
    JSON.stringify(lateTiming),
  );
  await shoot(first, 'start-01-light-wide.png');

  // Open time over 20 new tabs.
  const runs = [];
  for (let i = 0; i < 21; i++) {
    const p = await newTab();
    await sleep(150);
    const t = await p.evaluate(() => ({
      fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
      ready: performance.getEntriesByName('start-ready')[0]?.startTime,
      dcl: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd,
    }));
    if (i > 0) runs.push(t); // the first open after the shot above may still be warming caches
    await p.close();
  }
  const timing = Object.fromEntries(
    ['fcp', 'ready', 'dcl'].map(k => {
      const values = runs.map(r => r[k]).filter(v => typeof v === 'number');
      return [k, { median: quantile(values, 0.5), p90: quantile(values, 0.9), max: quantile(values, 1) }];
    }),
  );
  report.startTiming = { opens: runs.length, ...timing };
  check(
    `${ours ? 'a new tab' : 'the start page by its address'} paints within ${FIRST_PAINT_BUDGET} ms and its field listens within ${READY_BUDGET} ms (p90 of 20 opens)`,
    timing.fcp.p90 <= FIRST_PAINT_BUDGET && timing.ready.p90 <= READY_BUDGET,
    `first paint median ${timing.fcp.median} / p90 ${timing.fcp.p90} ms; field ready median ${timing.ready.median} / p90 ${timing.ready.p90} ms`,
  );

  // Assembled from what is kept: what loads when, no layout jump, the sets of pieces, a paste before `detect`.
  await runAssemblyChecks({ ctx, dist, base, newTab, field, region, loads, check, shoot, sleep, report });

  // Typing a tool's name opens it.
  await field(first).fill('json');
  const firstRow = first.getByRole('option').first();
  const rowText = await firstRow.innerText();
  await field(first).press('Enter');
  await first.waitForFunction(() => location.hash === '#/tools/json');
  await first.getByLabel('Input').waitFor({ timeout: 5_000 });
  check(
    'typing a tool’s name shows it first, marked Enter, and Enter opens it',
    /JSON/.test(rowText) && /Enter/.test(rowText) && (await first.title()).startsWith('JSON'),
    rowText.replace(/\s+/g, ' '),
  );

  // Pasting JSON opens the JSON tool with it.
  const pasteTab = await newTab();
  const json = '{"name":"example","tags":["new","tab"]}';
  await field(pasteTab).focus();
  await pasteTab.evaluate(text => {
    const data = new DataTransfer();
    data.setData('text/plain', text);
    document.activeElement.dispatchEvent(
      new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }),
    );
  }, json);
  await pasteTab.getByLabel('Input').waitFor({ timeout: 5_000 });
  const pasted = await pasteTab.getByLabel('Input').inputValue();
  check(
    'pasting JSON into the field opens the JSON tool with it (not through the address)',
    pasted === json && new URL(pasteTab.url()).hash === '#/tools/json',
    pasteTab.url(),
  );

  // Enter on other text goes to Chrome's search API.
  const searchTab = await newTab();
  const before = network.length;
  await field(searchTab).pressSequentially('kittens 42', { delay: 20 });
  await sleep(300);
  const whileTyping = network.slice(before);
  const navigated = searchTab.waitForURL(/^https?:/, { timeout: 10_000 });
  await field(searchTab).press('Enter');
  await navigated;
  const searchUrl = new URL(searchTab.url());
  report.webSearch = { url: searchTab.url(), requestsWhileTyping: whileTyping };
  check(
    'nothing leaves the page while typing; Enter on text nothing of ours matches searches through Chrome',
    whileTyping.length === 0 && [...searchUrl.searchParams.values()].includes('kittens 42'),
    `→ ${searchUrl.origin}${searchUrl.pathname}?…${searchUrl.search.includes('kittens') ? ' (the query is there)' : ''}`,
  );

  // A shortcut added on the page is there in the next new tab.
  const shortcutTab = await newTab();
  await shortcutTab.getByRole('button', { name: 'Add shortcut' }).click();
  await shortcutTab.getByLabel('Title').fill('Docs');
  await shortcutTab.getByLabel('Address').fill('docs.example.com');
  await shortcutTab.getByRole('button', { name: 'Add', exact: true }).click();
  await region(shortcutTab, 'My shortcuts').getByRole('link', { name: 'Docs' }).waitFor({ timeout: 5_000 });
  const nextTab = await newTab();
  const tile = region(nextTab, 'My shortcuts').getByRole('link', { name: 'Docs' });
  check(
    'a shortcut added on the page is there in the next new tab',
    (await tile.count()) === 1 && (await tile.getAttribute('href')) === 'https://docs.example.com/',
  );
  await shoot(nextTab, 'start-02-light-wide-shortcut.png');
  await nextTab.getByRole('button', { name: 'Edit Docs' }).click();
  await shoot(nextTab, 'start-03-light-wide-editing.png');

  // Settings: each switch hides its part.
  const settings = watch(await ctx.newPage());
  await settings.goto(`${base}#/settings`);
  await settings.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  await shoot(settings, 'settings-01-light-wide.png');
  const flip = async (name, on) => {
    const toggle = settings.getByRole('switch', { name, exact: true });
    if ((await toggle.getAttribute('aria-checked')) !== String(on)) await toggle.click();
    await settings.waitForFunction(
      ([el, value]) => el.getAttribute('aria-checked') === value,
      [await toggle.elementHandle(), String(on)],
    );
    await sleep(100); // storage → the copy route-boot.js reads
  };

  await flip('Web search', false);
  const noSearch = await newTab();
  const placeholder = await field(noSearch).getAttribute('placeholder');
  const beforeOff = network.length;
  await field(noSearch).fill('kittens');
  await field(noSearch).press('Enter');
  await sleep(600);
  check(
    'web search off: the field still finds our places; Enter on anything else does nothing',
    placeholder === 'Find a tool, or paste text' &&
      noSearch.url() === startUrl &&
      network.length === beforeOff &&
      (await noSearch.getByText('Nothing here matches').isVisible()),
    `placeholder "${placeholder}"`,
  );
  await flip('My shortcuts', false);
  const noShortcuts = await newTab();
  check(
    'shortcuts off: no shortcuts row',
    (await region(noShortcuts, 'My shortcuts').count()) === 0 && (await region(noShortcuts, 'Tools').count()) === 1,
  );
  await flip('Tools', false);
  const allOff = await newTab();
  check(
    'tools off: no tools row; with every part off the page keeps the field and says what is off',
    (await region(allOff, 'Tools').count()) === 0 &&
      (await field(allOff).isVisible()) &&
      (await allOff.getByText('Every row of the start page is off').isVisible()),
  );
  await shoot(allOff, 'start-04-light-wide-all-off.png');
  await allOff.setViewportSize(NARROW);
  await shoot(allOff, 'start-05-light-narrow-all-off.png');

  // Most visited asks Chrome; headless, the prompt stays open and nothing is granted.
  await settings.getByRole('switch', { name: 'Most visited', exact: true }).click();
  await settings.getByText('Waiting for your answer in Chrome’s prompt…').waitFor({ timeout: 5_000 });
  const heldWhileAsking = (await settings.evaluate(() => chrome.permissions.getAll())).permissions;
  check(
    'turning most visited on asks Chrome for topSites (and holds nothing until it is allowed)',
    !heldWhileAsking.includes('topSites'),
    heldWhileAsking.join(', '),
  );
  await settings.reload();
  await settings.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();

  // Recently opened (history) the same way: the prompt stays open, nothing is granted, nothing is read.
  await settings.getByRole('switch', { name: 'Recently opened', exact: true }).click();
  await settings.getByText('Waiting for your answer in Chrome’s prompt…').waitFor({ timeout: 5_000 });
  const heldWhileAskingHistory = (await settings.evaluate(() => chrome.permissions.getAll())).permissions;
  check(
    'turning recently opened on asks Chrome for history (and holds nothing until it is allowed)',
    !heldWhileAskingHistory.includes('history') &&
      (await settings.getByText('Read and change your browsing history on all your signed-in devices').count()) === 1,
    heldWhileAskingHistory.join(', '),
  );
  await settings.reload();
  await settings.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();

  // Switched on with the permission gone (as after removing it in chrome://extensions): one line and a way back.
  await settings.evaluate(async () => {
    const { startSettings } = await chrome.storage.local.get('startSettings');
    await chrome.storage.local.set({
      startSettings: { ...startSettings, parts: { ...startSettings?.parts, recentlyOpened: true } },
    });
  });
  await sleep(150);
  const removed = await newTab();
  const removedRow = region(removed, 'Recently opened');
  check(
    'recently opened without its permission reads nothing and says why, with a link back to the switch',
    (await removedRow.getByText('The permission this row needs was removed').count()) === 1 &&
      (await removedRow.getByRole('link', { name: 'Turn it on again in Settings' }).getAttribute('href')) ===
        '#/settings' &&
      (await removed.evaluate(() => typeof chrome.history)) === 'undefined',
  );
  await shoot(removed, 'start-10-light-wide-history-permission-removed.png');
  await settings.evaluate(async () => {
    const { startSettings } = await chrome.storage.local.get('startSettings');
    await chrome.storage.local.set({
      startSettings: { ...startSettings, parts: { ...startSettings.parts, recentlyOpened: false } },
    });
  });

  // Recently closed, the alternative: asks for `sessions` and `tabs` in one prompt; without them, one line.
  await settings.getByRole('switch', { name: 'Recently closed', exact: true }).click();
  await settings.getByText('Waiting for your answer in Chrome’s prompt…').waitFor({ timeout: 5_000 });
  const heldWhileAskingClosed = (await settings.evaluate(() => chrome.permissions.getAll())).permissions;
  check(
    'turning recently closed on asks Chrome for sessions and tabs (and holds neither until allowed)',
    !heldWhileAskingClosed.includes('sessions') &&
      !heldWhileAskingClosed.includes('tabs') &&
      (await settings.getByText('Read your browsing history on all your signed-in devices').count()) === 1,
    heldWhileAskingClosed.join(', '),
  );
  await settings.reload();
  await settings.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  await settings.evaluate(async () => {
    const { startSettings } = await chrome.storage.local.get('startSettings');
    await chrome.storage.local.set({
      startSettings: { ...startSettings, parts: { ...startSettings?.parts, recentlyClosed: true } },
    });
  });
  await sleep(150);
  const closedRemoved = await newTab();
  check(
    'recently closed without its permissions reads nothing and says why in one line',
    (await region(closedRemoved, 'Recently closed').getByText('The permission this row needs was removed').count()) ===
      1 && (await closedRemoved.evaluate(() => typeof chrome.sessions)) === 'undefined',
  );
  await settings.evaluate(async () => {
    const { startSettings } = await chrome.storage.local.get('startSettings');
    await chrome.storage.local.set({
      startSettings: { ...startSettings, parts: { ...startSettings.parts, recentlyClosed: false } },
    });
  });

  for (const name of ['Web search', 'My shortcuts', 'Tools']) await flip(name, true);

  // The order of the rows is a setting: moving one changes the page; the reset brings the default back.
  const rowOrder = async p => p.locator('.kit-tile-rows > [data-row]').evaluateAll(els => els.map(e => e.dataset.row));
  const defaultOrder = await rowOrder(await newTab());
  await settings.getByRole('button', { name: 'Move Tools up' }).click();
  await sleep(150);
  const moved = await rowOrder(await newTab());
  await shoot(settings, 'settings-06-light-wide-order-moved.png');
  await settings.getByRole('button', { name: 'Reset order' }).click();
  await sleep(150);
  const reset = await rowOrder(await newTab());
  check(
    'the rows appear in the stored order: a move in settings changes it, the reset brings the default back',
    defaultOrder.join() === 'shortcuts,tools' &&
      moved.join() === 'tools,shortcuts' &&
      reset.join() === defaultOrder.join(),
    `${defaultOrder} → ${moved} → ${reset}`,
  );

  // The narrow and the dark shots.
  const lightNarrow = await newTab();
  await lightNarrow.setViewportSize(NARROW);
  await shoot(lightNarrow, 'start-06-light-narrow.png');
  await settings.setViewportSize(NARROW);
  await shoot(settings, 'settings-02-light-narrow.png');
  await settings.setViewportSize(WIDE);
  await settings.getByRole('radio', { name: 'Dark' }).first().click();
  await settings.locator('html[data-mode="dark"]').waitFor();
  await sleep(150);
  await shoot(settings, 'settings-03-dark-wide.png');
  await settings.setViewportSize(NARROW);
  await shoot(settings, 'settings-04-dark-narrow.png');
  await settings.setViewportSize(WIDE);
  const dark = await newTab();
  check(
    'a new tab opens in the chosen theme',
    (await dark.evaluate(() => document.documentElement.dataset.mode)) === 'dark',
  );
  await shoot(dark, 'start-07-dark-wide.png');
  await field(dark).fill('js');
  await shoot(dark, 'start-08-dark-wide-typing.png');
  await dark.setViewportSize(NARROW);
  await field(dark).fill('');
  await shoot(dark, 'start-09-dark-narrow.png');
  // A coloured theme that is not a default: Tokyo Night.
  await settings.getByLabel('Dark theme', { exact: true }).first().click();
  await settings.getByRole('option', { name: 'Tokyo Night', exact: true }).click();
  await settings.locator('html[data-theme="tokyo-night"]').waitFor();
  await sleep(150);
  await shoot(settings, 'settings-05-tokyo-night-wide.png');
  const tokyo = await newTab();
  await field(tokyo).fill('js');
  await shoot(tokyo, 'start-11-tokyo-night-wide-typing.png');
  await settings.getByLabel('Dark theme', { exact: true }).first().click();
  await settings.getByRole('option', { name: 'Default Dark', exact: true }).click();
  await settings.getByRole('radio', { name: 'System' }).first().click();
  await settings.locator('html[data-mode="light"]').waitFor();

  if (!ours) {
    // Not the New Tab page: nothing to choose about a new tab, and the address with no route stays the start page.
    await settings.goto(`${base}#/settings`);
    await settings.getByRole('heading', { name: 'Start page', level: 2 }).waitFor();
    await settings.evaluate(async () => {
      const cache = JSON.parse(localStorage.getItem('start-cache') ?? '{}');
      localStorage.setItem(
        'start-cache',
        JSON.stringify({
          ...cache,
          settings: { ...cache.settings, newTab: 'last' },
          recent: { last: '#/tools/json', used: [] },
        }),
      );
    });
    const plain = watch(await ctx.newPage());
    await plain.goto(base);
    await plain.locator('[data-page="start"]').waitFor();
    check(
      'not the New Tab page: Settings has no "A new tab opens", and the main page with no route is never redirected',
      (await settings.getByRole('heading', { name: 'General' }).count()) === 0 &&
        (await settings.getByRole('radio', { name: 'Last opened tool' }).count()) === 0 &&
        new URL(plain.url()).hash === '' &&
        (await plain.evaluate(() => window.__newTabTrace.startInserted)) === true,
      plain.url(),
    );
    await settings.evaluate(() => localStorage.removeItem('start-cache'));
  } else {
    // "Last opened tool": a new tab opens it, and the start page is never inserted.
    await settings.getByRole('radio', { name: 'Last opened tool' }).click();
    await settings.goto(`${base}#/tools/json`);
    await settings.getByLabel('Input').waitFor();
    await sleep(200);
    const last = await newTab('.kit-shell');
    await last.getByLabel('Input').waitFor({ timeout: 5_000 });
    const trace = await last.evaluate(() => window.__newTabTrace);
    report.lastOpened = { url: last.url(), trace };
    check(
      '"Last opened tool": a new tab opens that tool, with no start page painted first',
      trace.hashAtStart === '' && trace.hashAtDcl === '#/tools/json' && trace.startInserted === false,
      JSON.stringify(trace),
    );
    await settings.goto(`${base}#/settings`);
    await settings.getByRole('radio', { name: 'Start page' }).click();
    await sleep(200);
    const backToStart = await newTab();
    check(
      'back on "Start page", a new tab is the start page again',
      (await backToStart.evaluate(() => window.__newTabTrace.startInserted)) === true,
    );
  }

  // The options entry reaches the settings. (The toolbar button: scripts/e2e-toolbar.mjs.)
  const startTab = await newTab();
  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  const options = await ext.evaluate(
    async extId =>
      (await chrome.developerPrivate.getExtensionsInfo({ includeDisabled: true })).find(x => x.id === extId)
        ?.optionsPage,
    id,
  );
  await ext.close();
  // Chrome opens options over a new tab when one is focused (its "singleton tab overwriting the New Tab page"), else in
  // a tab of its own; either way the settings route. Only the start page is left open here.
  for (const p of opened) if (p !== startTab && !p.isClosed()) await p.close();
  const pagesBefore = new Set(ctx.pages());
  await startTab.evaluate(() => chrome.runtime.openOptionsPage());
  const optionsUrl = `chrome-extension://${id}/${entry.options.page}`;
  let optionsPage = null;
  for (let i = 0; i < 50 && !optionsPage; i++) {
    optionsPage = ctx.pages().find(p => p.url() === optionsUrl) ?? null;
    if (!optionsPage) await sleep(100);
  }
  await optionsPage?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  report.options = {
    manifest: options,
    tab: optionsPage?.url(),
    reused: optionsPage ? pagesBefore.has(optionsPage) : null,
  };
  check(
    'the options entry (chrome://extensions → Extension options) opens the settings route in a tab',
    options?.openInTab === entry.options.openInTab && options?.url === optionsUrl && !!optionsPage,
    `${JSON.stringify(options)} → ${optionsPage ? (pagesBefore.has(optionsPage) ? 'the open tab, now at #/settings' : 'a new tab') : 'no tab'}`,
  );

  for (const p of opened) if (!p.isClosed()) await p.close();
};
