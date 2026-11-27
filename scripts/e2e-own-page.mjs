// The e2e checks of our page opened by its address and of the options page (D16, 2026-11-21), run by
// scripts/e2e-check.mjs after the New Tab page and before the toolbar. What our page must be where it is not the New Tab
// page — another extension's New Tab, an incognito window, a build without the override — so the checks open it the way
// the toolbar does, by its address:
//   - install warnings, as Chrome words them (management.getPermissionWarningsByManifest) for the built manifest: the
//     override's own line exactly when the build has it (scripts/entry-pages.mjs reads the choice);
//   - every route by its address: the right title, the right part, never the start page painted first; a deep link to a
//     tool; an unknown tool falls back to the Tools page;
//   - route-boot.js never redirects a page opened on a route, nor a reload or a step back, even with "Last opened tool"
//     chosen; a new tab of ours still is (where the build is the New Tab page);
//   - back and forward between routes; reload keeps the route; the chosen theme before the first paint; the editor page
//     taking a theme chosen while its module starts;
//   - the options page: "Extension options" on the extension's details page in chrome://extensions (the real link);
//     runtime.openOptionsPage() with the options page already open (that tab, no second one), with a tab of ours at
//     another route in front (a tab of its own, the other untouched), and after the options tab went to another route
//     through its sidebar (the options flag is dropped, so the settings open again instead of that tab on Tools).
// Screenshots: a tool by address (own-page-01-tool-by-address.png), the options page from the details page
// (own-page-02-options-from-details.png).

/* global document, window, location, chrome -- page.evaluate callbacks run in the pages */

import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Chrome's own install warning for the New Tab override (docs/research/new-tab-probe.md §6). */
const OVERRIDE_WARNING = 'Replace the page you see when opening a new tab';
/** The JSON tool's input: the mark that a tool page is ready. */
const INPUT = 'Input';

export const runOwnPageChecks = async ({ ctx, sw, id, dist, check, shoot, report }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  const entry = JSON.parse(
    execFileSync('node', [join(dirname(fileURLToPath(import.meta.url)), 'entry-pages.mjs')]).toString(),
  );
  const ours = !!entry.newTab.newtab;
  const name = manifest.name;
  const optionsUrl = `chrome-extension://${id}/${entry.options.page}`;
  report.ownPage = { newTab: entry.newTab.id, options: entry.options.id };
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
  const open = async url => {
    const p = watch(await ctx.newPage());
    await p.goto(url);
    await p.waitForLoadState('load');
    return p;
  };
  const closeAll = async () => {
    for (const p of opened) if (!p.isClosed()) await p.close();
    opened.length = 0;
  };
  const tick = () => new Promise(r => setTimeout(r, 150));

  // Install warnings.
  const warnings = await sw.evaluate(
    m => chrome.management.getPermissionWarningsByManifest(m),
    JSON.stringify(manifest),
  );
  report.ownPage.installWarnings = warnings;
  check(
    `install warnings: ${ours ? 'only the New Tab override’s' : 'none (no override, and the required permissions warn of nothing)'}`,
    JSON.stringify(warnings) === JSON.stringify(ours ? [OVERRIDE_WARNING] : []),
    JSON.stringify(warnings),
  );

  // Every route by its address.
  const routes = [
    ['#/start', `Start page — ${name}`, '[data-page="start"]'],
    ['#/tools', `Tools — ${name}`, 'h1:has-text("Tools")'],
    ['#/tools/json', `JSON — ${name}`, INPUT],
    // An address naming no tool: the Tools overview, which says so.
    ['#/tools/nope', `Tools — ${name}`, '.kit-tools-note'],
    ['#/compare', `Compare code — ${name}`, 'h1:has-text("Compare code")'],
    ['#/projects', `Projects — ${name}`, 'h1:has-text("Projects")'],
    ['#/settings', `Settings — ${name}`, 'h1:has-text("Settings")'],
    ['#/history', `History — ${name}`, 'h1:has-text("History")'],
  ];
  const seen = [];
  for (const [route, title, ready] of routes) {
    const p = await open(base + route);
    await (ready === INPUT ? p.getByLabel('Input') : p.locator(ready).first()).waitFor({ timeout: 10_000 });
    const trace = await p.evaluate(() => window.__newTabTrace);
    seen.push({
      route,
      title: await p.title(),
      ok: (await p.title()) === title && !trace.startInserted === (route !== '#/start') && p.url() === base + route,
    });
    if (route === '#/tools/json') await shoot(p, 'own-page-01-tool-by-address.png');
    await p.close();
  }
  report.ownPage.routes = seen;
  check(
    'every route opened by its address: its title, its part, and no start page painted before it',
    seen.every(r => r.ok),
    seen.map(r => `${r.route} "${r.title}"${r.ok ? '' : ' ✗'}`).join('; '),
  );

  // "Last opened tool" chosen: an address with a route stays where it is; a reload too.
  const setChoice = (p, newTab) =>
    p.evaluate(async choice => {
      const { startSettings = {} } = await chrome.storage.local.get('startSettings');
      await chrome.storage.local.set({
        startSettings: { version: 2, parts: {}, order: [], ...startSettings, newTab: choice },
        recent: { last: '#/tools/json', used: ['#/tools/json'] },
      });
    }, newTab);
  const settingsTab = await open(`${base}#/settings`);
  await settingsTab.getByRole('heading', { name: 'Settings', level: 1 }).waitFor();
  await setChoice(settingsTab, 'last');
  await tick();
  const explicit = [];
  for (const route of ['#/start', '#/compare']) {
    const p = await open(base + route);
    await p.reload();
    await p.waitForLoadState('load');
    explicit.push(`${route} → ${new URL(p.url()).hash}`);
    await p.close();
  }
  let newTabLine = 'not the New Tab page';
  let newTabOk = true;
  if (ours) {
    // A new tab of ours on the start page; "Last opened tool" is chosen only now — its reload stays the start page.
    await setChoice(settingsTab, 'start');
    await tick();
    const event = ctx.waitForEvent('page', { timeout: 10_000 });
    await sw.evaluate(() => chrome.tabs.create({}));
    const tab = watch(await event);
    await tab.locator('[data-page="start"]').waitFor({ timeout: 10_000 });
    await setChoice(settingsTab, 'last');
    await tick();
    await tab.reload();
    await tab.locator('[data-page="start"]').waitFor({ timeout: 10_000 });
    const afterReload = new URL(tab.url()).hash;
    const event2 = ctx.waitForEvent('page', { timeout: 10_000 });
    await sw.evaluate(() => chrome.tabs.create({}));
    const fresh = watch(await event2);
    await fresh.getByLabel('Input').waitFor({ timeout: 10_000 });
    const freshHash = new URL(fresh.url()).hash;
    newTabOk = afterReload === '' && freshHash === '#/tools/json';
    newTabLine = `new tab reloaded → "${afterReload}"; a fresh new tab → ${freshHash}`;
  }
  await setChoice(settingsTab, 'start');
  check(
    'with "Last opened tool" chosen, a page opened on a route and its reload stay where they are; a reload of a new tab too, while a fresh new tab opens the tool',
    explicit.every(line => line.endsWith(line.split(' → ')[0])) && newTabOk,
    `${explicit.join(', ')}; ${newTabLine}`,
  );
  await closeAll();

  // Back and forward; the theme before the first paint.
  const nav = await open(`${base}#/tools`);
  await nav.getByRole('heading', { name: 'Tools', level: 1 }).waitFor();
  await nav.getByRole('link', { name: 'Compare code' }).first().click();
  await nav.getByRole('heading', { name: 'Compare code' }).first().waitFor();
  await nav.goBack();
  await nav.getByRole('heading', { name: 'Tools', level: 1 }).waitFor();
  const back = [new URL(nav.url()).hash, await nav.title()];
  await nav.goForward();
  await nav.getByRole('heading', { name: 'Compare code' }).first().waitFor();
  const forward = [new URL(nav.url()).hash, await nav.title()];
  check(
    'back and forward move between the routes of a page opened by its address, with their titles',
    back[0] === '#/tools' && back[1] === `Tools — ${name}` && forward[0] === '#/compare',
    `back: ${back.join(' ')}; forward: ${forward.join(' ')}`,
  );
  // The theme check below is about the main page; the editor page has its own check (a theme chosen while it starts).
  await nav.evaluate(() => (location.hash = '#/tools'));
  await nav.getByRole('heading', { name: 'Tools', level: 1 }).waitFor();
  await nav.evaluate(async () => {
    const pref = { mode: 'dark', light: 'default-light', dark: 'default-dark' };
    localStorage.setItem('theme-cache', JSON.stringify(pref));
    await chrome.storage.local.set({ theme: pref });
  });
  const dark = await open(`${base}#/tools/json`);
  await dark.addInitScript(() => {
    document.addEventListener('DOMContentLoaded', () => (window.__modeAtDcl = document.documentElement.dataset.mode));
  });
  await dark.reload();
  await dark.getByLabel('Input').waitFor();
  const modeAtDcl = await dark.evaluate(() => window.__modeAtDcl);
  check(
    'a page opened by its address is in the chosen theme before its first paint (dark)',
    modeAtDcl === 'dark',
    modeAtDcl,
  );
  await dark.evaluate(async () => {
    localStorage.removeItem('theme-cache');
    await chrome.storage.local.set({ theme: { mode: 'system', light: 'default-light', dark: 'default-dark' } });
  });
  await closeAll();

  // A theme chosen while the editor page's module is still starting (gpui launches only once the browser's graphics are
  // up, after run() has returned) is applied when it launches — it once panicked: no state of type ThemeRegistry.
  const editor = watch(await ctx.newPage());
  const panics = [];
  editor.on('console', m => /panicked|ThemeRegistry/.test(m.text()) && panics.push(m.text().slice(0, 120)));
  await editor.goto(`chrome-extension://${id}/src/viewer/index.html`);
  await editor.evaluate(() =>
    chrome.storage.local.set({ theme: { mode: 'dark', light: 'default-light', dark: 'default-dark' } }),
  );
  await editor.locator('#placeholder[hidden]').waitFor({ state: 'attached', timeout: 15_000 });
  await tick();
  check(
    'the editor page takes a theme chosen while its module starts, without a panic',
    panics.length === 0 && (await editor.evaluate(() => document.documentElement.dataset.mode)) === 'dark',
    panics[0] ?? 'dark, no panic',
  );
  await editor.evaluate(() =>
    chrome.storage.local.set({ theme: { mode: 'system', light: 'default-light', dark: 'default-dark' } }),
  );
  await closeAll();

  // The options page.
  if (!entry.options.openInTab) {
    check('the options page opens in Chrome’s dialog: checked by the probe, not here', true, entry.options.page);
    return;
  }
  const optionsTabs = () => ctx.pages().filter(p => !p.isClosed() && p.url().startsWith(`${base}?options`));
  const waitFor = async (predicate, ms = 5_000) => {
    for (let waited = 0; waited < ms; waited += 50) {
      const found = predicate();
      if (found) return found;
      await new Promise(r => setTimeout(r, 50));
    }
    return null;
  };
  // (b) The real link on the details page.
  const details = watch(await ctx.newPage());
  await details.goto(`chrome://extensions/?id=${id}`);
  await details.getByText('Extension options', { exact: true }).click();
  const fromDetails = await waitFor(() => ctx.pages().find(p => p.url() === optionsUrl));
  if (fromDetails) watch(fromDetails);
  await fromDetails?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  if (fromDetails) await shoot(fromDetails, 'own-page-02-options-from-details.png');
  check(
    '"Extension options" on the extension’s details page opens the settings in a tab',
    !!fromDetails && (await fromDetails.title()) === `Settings — ${name}`,
    fromDetails?.url() ?? 'no tab',
  );
  // (e) Already open: the same tab, no second one.
  await details.bringToFront();
  await sw.evaluate(() => chrome.runtime.openOptionsPage());
  await tick();
  check(
    'with the options page open, opening it again brings that tab forward — no second one',
    optionsTabs().length === 1,
    `${optionsTabs().length} options tab(s)`,
  );
  // (e) A tab of ours at another route in front.
  const tools = await open(`${base}#/tools`);
  await tools.bringToFront();
  await fromDetails?.close();
  await sw.evaluate(() => chrome.runtime.openOptionsPage());
  const overTools = await waitFor(() => optionsTabs()[0]);
  if (overTools) watch(overTools);
  await overTools?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  check(
    'with a tab of ours at another route in front, the options page opens in a tab of its own; the other stays',
    !!overTools && overTools !== tools && new URL(tools.url()).hash === '#/tools',
    `${overTools?.url()}; the other: ${tools.url()}`,
  );
  // (e) The options tab went to another route through its sidebar: the flag goes, the settings open again.
  await overTools.getByRole('link', { name: 'Tools' }).first().click();
  await overTools.getByRole('heading', { name: 'Tools', level: 1 }).waitFor();
  const leftAt = overTools.url();
  await tools.bringToFront();
  await sw.evaluate(() => chrome.runtime.openOptionsPage());
  const again = await waitFor(() => optionsTabs().find(p => p.url() === optionsUrl));
  if (again) watch(again);
  await again?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  check(
    'after the options tab went to Tools, it is no longer the options page: opening the options shows the settings, not that tab on Tools',
    leftAt === `${base}#/tools` && !!again && again !== overTools && new URL(overTools.url()).hash === '#/tools',
    `options tab left at ${leftAt}; then ${again?.url() ?? 'no settings'}`,
  );
  await closeAll();
};
