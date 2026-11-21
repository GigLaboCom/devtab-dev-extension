// The e2e checks of the toolbar button (seam `ToolbarButton`), run by scripts/e2e-check.mjs after the New Tab page. What
// is checked follows the definition chosen in extension/src/toolbar/index.ts (scripts/toolbar-button.mjs):
//   - always: the built manifest's `action.default_popup` is the definition's popup page or absent, and the service
//     worker listens for clicks exactly when there is no popup;
//   - a button without a popup: pressing it (CDP Extensions.triggerAction) opens the start page — a new tab where the
//     build is the New Tab page, the page by its address where it is not (extension/src/newTab, entry-pages.mjs);
//   - a button with a popup (the menu): pressing it opens the REAL popup, which this file drives through CDP (a page
//     target Playwright does not attach to; reached with Target.attachToTarget and Target.sendMessageToTarget): the
//     items are the list's (extension/src/popup/items.ts), in order; the first has the focus; the arrow keys, Home and
//     End move it; Enter on the first item opens the start page as the build reaches it (a new tab next to the current
//     one, or the page by its address) and closes the popup; Enter on "Settings" opens the options page and closes the
//     popup; "Tools" and "Compare code" open the main page at their route next to the current tab, a second time bring
//     that tab forward instead of opening another, and use our blank new tab when it is the current one; Escape closes
//     it; it opens in the chosen theme (dark) and follows a change while open; it loads none of the main page's or the
//     editor's scripts and no wasm; no console errors; its first paint is timed over 10 opens against a budget;
//   - incognito (the extension allowed there, spanning mode): the menu opens in an incognito window and every item
//     opens our page in a regular window — Tools (and a second time, the same tab), the start page, Settings.
// Screenshots: the popup, light and dark (toolbar-menu-01-light.png, toolbar-menu-02-dark.png).

/* global document, window, chrome -- page.evaluate callbacks run in the pages */

import { at, readDefinitions } from './read-definitions.mjs';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** p90 of the popup's first paint over 10 opens in headless Chrome for Testing, ms. */
const POPUP_PAINT_BUDGET = 150;

const quantile = (values, q) => {
  const sorted = [...values].sort((a, b) => a - b);
  return +sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * q))].toFixed(1);
};

export const runToolbarChecks = async ({ ctx, sw, id, dist, check, shoot, report, sleep }) => {
  const base = `chrome-extension://${id}/src/app/index.html`;
  const button = await readDefinitions(`
    import { toolbarButton } from ${at('extension/src/toolbar/index.ts')};
    export default { id: toolbarButton.id, popup: toolbarButton.popup ?? null };
  `);
  const { newTab } = await readDefinitions(`
    import { newTab } from ${at('extension/src/newTab/index.ts')};
    export default { newTab: { id: newTab.id, newtab: newTab.newtab ?? null, start: newTab.start } };
  `);
  report.toolbar = { button, newTab: newTab.id };
  /** Where the start entry lands: a new tab (the main page with no route) or the page at its route. */
  const startUrl = newTab.start.opens.route ? `${base}${newTab.start.opens.route}` : base;

  const manifest = JSON.parse(readFileSync(join(dist, 'manifest.json'), 'utf8'));
  check(
    `the toolbar button is '${button.id}': the manifest's default_popup is ${button.popup ?? 'absent'}`,
    (manifest.action?.default_popup ?? null) === button.popup,
    JSON.stringify(manifest.action),
  );
  const listens = await sw.evaluate(() => chrome.action.onClicked.hasListeners());
  check(
    `the service worker ${button.popup ? 'does not listen' : 'listens'} for the button (Chrome sends no click with a popup)`,
    listens === !button.popup,
  );

  const cdp = await ctx.browser().newBrowserCDPSession();
  const tabTarget = async url => {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    return (url ? targetInfos.find(t => t.url === url) : targetInfos[0])?.targetId;
  };

  if (!button.popup) {
    const pressed = ctx.waitForEvent('page', { timeout: 10_000 });
    await cdp.send('Extensions.triggerAction', { id, targetId: await tabTarget() });
    const fromButton = await pressed;
    await fromButton.locator('[data-page="start"]').waitFor({ timeout: 10_000 });
    check(
      `the toolbar button opens the start page (${newTab.start.opens.route ? 'by its address' : 'a new tab'})`,
      fromButton.url() === startUrl,
      fromButton.url(),
    );
    await fromButton.close();
    await cdp.detach();
    return;
  }

  // The menu.
  const items = await readDefinitions(`
    import { menuItems } from ${at('extension/src/popup/items.ts')};
    export default menuItems.map(({ id, title, opens }) => ({ id, title, opens }));
  `);
  const popupUrl = `chrome-extension://${id}/${button.popup}`;

  // Messages of the popup's CDP sessions (not flattened: Playwright's session sends no sessionId).
  const sessions = new Map();
  const detached = new Map();
  cdp.on('Target.receivedMessageFromTarget', ({ sessionId, message }) =>
    sessions.get(sessionId)?.(JSON.parse(message)),
  );
  // A popup that closes (a chosen item, Escape) answers nothing more: what waits on it fails instead of hanging.
  cdp.on('Target.detachedFromTarget', ({ sessionId }) => detached.get(sessionId)?.());
  const pageTargets = async () =>
    (await cdp.send('Target.getTargets')).targetInfos.filter(t => t.type === 'page').map(t => t.targetId);

  /** Presses the button in the tab at `fromUrl` (or the tab target given) and attaches to the popup it opens. */
  const openPopup = async (fromUrl, tabId) => {
    const before = new Set(await pageTargets());
    await cdp.send('Extensions.triggerAction', { id, targetId: tabId ?? (await tabTarget(fromUrl)) });
    let target;
    for (let i = 0; i < 100 && !target; i++) {
      target = (await cdp.send('Target.getTargets')).targetInfos.find(
        t => t.type === 'page' && t.url === popupUrl && !before.has(t.targetId),
      );
      if (!target) await sleep(20);
    }
    if (!target) throw new Error('pressing the toolbar button opened no popup');
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId: target.targetId, flatten: false });
    let next = 1;
    const waiting = new Map();
    sessions.set(sessionId, m => {
      if (m.id && waiting.has(m.id)) {
        waiting.get(m.id)(m);
        waiting.delete(m.id);
      } else if (m.method === 'Runtime.exceptionThrown') {
        report.console.push({ type: 'pageerror', text: m.params.exceptionDetails.text, url: popupUrl });
      } else if (m.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(m.params.type)) {
        report.console.push({ type: m.params.type, text: JSON.stringify(m.params.args), url: popupUrl });
      } else if (m.method === 'Log.entryAdded' && ['error', 'warning'].includes(m.params.entry.level)) {
        report.console.push({ type: m.params.entry.level, text: m.params.entry.text, url: popupUrl });
      }
    });
    detached.set(sessionId, () => {
      for (const [n, answer] of waiting) {
        waiting.delete(n);
        answer({ error: { message: 'the popup closed' } });
      }
    });
    const send = (method, params = {}) =>
      new Promise((resolve, reject) => {
        const n = next++;
        waiting.set(n, m => (m.error ? reject(new Error(`${method}: ${m.error.message}`)) : resolve(m.result)));
        cdp
          .send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id: n, method, params }) })
          .catch(error => {
            waiting.delete(n);
            reject(error);
          });
      });
    const evaluate = async fn =>
      (await send('Runtime.evaluate', { expression: `(${fn})()`, returnByValue: true, awaitPromise: true })).result
        .value;
    // Both replay what was logged before the attach (a CSP violation while loading, say).
    await send('Runtime.enable');
    await send('Log.enable');
    for (let i = 0; i < 100; i++) {
      if (await evaluate(() => document.querySelectorAll('[data-item]').length > 0)) break;
      await sleep(20);
    }
    const key = async (name, vk) => {
      // A key that closes the popup (Enter on an item, Escape) may get no answer, and leaves no page for its keyUp.
      const down = send('Input.dispatchKeyEvent', {
        type: 'keyDown',
        key: name,
        code: name,
        windowsVirtualKeyCode: vk,
        ...(name === 'Enter' ? { text: '\r' } : {}),
      });
      await Promise.race([down.catch(() => undefined), sleep(2_000)]);
      await send('Input.dispatchKeyEvent', { type: 'keyUp', key: name, code: name, windowsVirtualKeyCode: vk }).catch(
        () => undefined,
      );
    };
    const gone = async () => {
      for (let i = 0; i < 100; i++) {
        if (!(await pageTargets()).includes(target.targetId)) return true;
        await sleep(20);
      }
      return false;
    };
    // `shoot` takes anything with screenshot({ path }).
    const shot = {
      screenshot: async ({ path }) =>
        writeFileSync(path, Buffer.from((await send('Page.captureScreenshot', { format: 'png' })).data, 'base64')),
    };
    const state = () =>
      evaluate(() =>
        JSON.stringify({
          items: [...document.querySelectorAll('[data-item]')].map(b => ({ id: b.dataset.item, title: b.textContent })),
          incognito: chrome.extension.inIncognitoContext,
          focused: document.activeElement?.dataset.item ?? null,
          mode: document.documentElement.dataset.mode,
          size: [window.innerWidth, window.innerHeight],
        }),
      ).then(JSON.parse);
    return { evaluate, key, gone, shot, state, close: () => evaluate(() => window.close()) };
  };

  // The tab the button is pressed in: an extension page of ours, so its index is readable without `tabs`.
  const anchorUrl = `${base}#/review`;
  const anchor = await ctx.newPage();
  await anchor.goto(anchorUrl);
  await anchor.bringToFront();
  const anchorTab = await anchor.evaluate(() => chrome.tabs.getCurrent());

  // Light: items, focus, keys.
  const light = await openPopup(anchorUrl);
  const first = await light.state();
  report.toolbar.popup = first;
  check(
    'the toolbar button opens the menu: the list’s items, in order, the first one focused',
    JSON.stringify(first.items) === JSON.stringify(items.map(({ id: i, title }) => ({ id: i, title }))) &&
      first.focused === items[0].id,
    `${first.items.map(i => i.title).join(', ')}; focus on ${first.focused}; ${first.size.join(' × ')} px`,
  );
  const focusAfter = async (name, vk) => {
    await light.key(name, vk);
    return (await light.state()).focused;
  };
  const moves = [
    await focusAfter('ArrowDown', 40),
    await focusAfter('ArrowUp', 38),
    await focusAfter('End', 35),
    await focusAfter('Home', 36),
    await focusAfter('ArrowUp', 38),
  ];
  const last = items.at(-1).id;
  check(
    'the arrow keys move the focus and wrap; End and Home go to the ends',
    moves.join() === [items[1].id, items[0].id, last, items[0].id, last].join(),
    moves.join(' → '),
  );
  await light.key('Home', 36);
  await shoot(light.shot, 'toolbar-menu-01-light.png');

  // Enter on the first item: the start page as the build reaches it, next to the current tab; the popup closes.
  const opened = ctx.waitForEvent('page', { timeout: 10_000 });
  await light.key('Enter', 13);
  const startTab = await opened;
  await startTab.locator('[data-page="start"]').waitFor({ timeout: 10_000 });
  const startAt = await startTab.evaluate(() => chrome.tabs.getCurrent());
  check(
    `Enter on "${items[0].title}" opens the start page (${startUrl === base ? 'a new tab' : 'by its address'}) next to the current tab, and closes the menu`,
    (await light.gone()) &&
      startTab.url() === startUrl &&
      startAt.windowId === anchorTab.windowId &&
      startAt.index === anchorTab.index + 1,
    `tab ${anchorTab.index} → tab at ${startAt.index}, ${startTab.url()}`,
  );
  await startTab.close();

  /** Opens the menu in the tab at `fromUrl`, moves to the item and presses Enter. */
  const choose = async (fromUrl, itemId, tabId) => {
    const menu = await openPopup(fromUrl, tabId);
    for (let i = 0; i < items.findIndex(it => it.id === itemId); i++) await menu.key('ArrowDown', 40);
    await menu.key('Enter', 13);
    await menu.gone();
  };
  const tabsAt = url => ctx.pages().filter(p => !p.isClosed() && p.url() === url);
  const waitForPage = async (predicate, ms = 5_000) => {
    for (let waited = 0; waited < ms; waited += 50) {
      const found = predicate();
      if (found) return found;
      await sleep(50);
    }
    return null;
  };

  // "Tools" and "Compare code": the page at the route, next to the current tab; a second time, that tab again.
  for (const item of items.filter(it => it.opens.route)) {
    if (item === items[0]) continue;
    const url = `${base}${item.opens.route}`;
    await anchor.bringToFront();
    await choose(anchorUrl, item.id);
    const page = await waitForPage(() => tabsAt(url)[0]);
    const at = page && (await page.evaluate(() => chrome.tabs.getCurrent()));
    await anchor.bringToFront();
    await choose(anchorUrl, item.id);
    await sleep(300);
    const active = page && (await page.evaluate(() => chrome.tabs.getCurrent()));
    check(
      `"${item.title}" opens the main page at ${item.opens.route} next to the current tab; a second time brings that tab forward instead of opening another`,
      !!page && at.index === anchorTab.index + 1 && tabsAt(url).length === 1 && active.active === true,
      page
        ? `tab at ${at.index}; ${tabsAt(url).length} tab(s) at ${item.opens.route}; active again: ${active.active}`
        : 'no tab',
    );
    await page?.close();
  }
  if (newTab.newtab) {
    // Our blank new tab, current: "Tools" takes it over (the same document — Chrome's own pages do the same). The only
    // new tab open, so its tab target is the one at chrome://newtab/.
    for (const p of ctx.pages()) if (p.url() === base) await p.close();
    const blankEvent = ctx.waitForEvent('page', { timeout: 10_000 });
    await sw.evaluate(() => chrome.tabs.create({}));
    const blank = await blankEvent;
    await blank.locator('[data-page="start"]').waitFor({ timeout: 10_000 });
    const before = ctx.pages().length;
    const blankTarget = (await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] })).targetInfos.find(
      t => t.url === 'chrome://newtab/',
    )?.targetId;
    await choose(null, 'tools', blankTarget);
    await blank.waitForURL(`${base}#/tools`, { timeout: 5_000 }).catch(() => undefined);
    check(
      '"Tools" from our blank new tab goes there in that tab, opening none',
      blank.url() === `${base}#/tools` && ctx.pages().length === before,
      blank.url(),
    );
    await blank.close();
  }

  // "Settings" (the last item here): the options page; the popup closes.
  await anchor.bringToFront();
  const settingsMenu = await openPopup(anchorUrl);
  const settingsIndex = items.findIndex(i => i.id === 'settings');
  for (let i = 0; i < settingsIndex; i++) await settingsMenu.key('ArrowDown', 40);
  const optionsUrl = `${base}?options#/settings`;
  await settingsMenu.key('Enter', 13);
  let options = null;
  for (let i = 0; i < 100 && !options; i++) {
    options = ctx.pages().find(p => p.url() === optionsUrl) ?? null;
    if (!options) await sleep(50);
  }
  await options?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  check(
    'Enter on "Settings" opens the options page (the settings route) and closes the menu',
    !!options && (await settingsMenu.gone()),
    options?.url() ?? 'no options page',
  );
  if (options && options !== anchor) await options.close();

  // Dark: the popup opens in the chosen theme (theme-boot.js before the first paint) and follows a change.
  await anchor.bringToFront();
  const setTheme = mode =>
    anchor.evaluate(async m => {
      const pref = { mode: m, light: 'default-light', dark: 'default-dark' };
      localStorage.setItem('theme-cache', JSON.stringify(pref));
      await chrome.storage.local.set({ theme: pref });
    }, mode);
  await setTheme('dark');
  const dark = await openPopup(anchorUrl);
  const darkState = await dark.state();
  await shoot(dark.shot, 'toolbar-menu-02-dark.png');
  await setTheme('light');
  let followed = null;
  for (let i = 0; i < 50 && followed !== 'light'; i++) {
    followed = (await dark.state()).mode;
    if (followed !== 'light') await sleep(50);
  }
  check(
    'the menu opens in the chosen theme (dark) and follows a change while open (→ light)',
    darkState.mode === 'dark' && followed === 'light',
    `${darkState.mode} → ${followed}`,
  );
  await dark.key('Escape', 27);
  check('Escape closes the menu', await dark.gone());
  await setTheme('system');

  // What it loads — the page by its address in a tab, where every request is visible (Resource Timing lists none of an
  // extension's files) — and how soon the real popup paints.
  const byAddress = await ctx.newPage();
  const loads = [];
  byAddress.on('request', r => loads.push(new URL(r.url()).pathname));
  byAddress.on('console', m => {
    if (m.type() === 'error' || m.type() === 'warning')
      report.console.push({ type: m.type(), text: m.text(), url: popupUrl });
  });
  byAddress.on('pageerror', e => report.console.push({ type: 'pageerror', text: String(e), url: popupUrl }));
  await byAddress.goto(popupUrl);
  await byAddress.locator('[data-item]').first().waitFor();
  await byAddress.waitForLoadState('load');
  await byAddress.close();
  const paints = [];
  for (let i = 0; i < 11; i++) {
    const p = await openPopup(anchorUrl);
    const t = await p.evaluate(async () => {
      for (let j = 0; j < 100 && !performance.getEntriesByName('first-contentful-paint').length; j++) {
        await new Promise(r => setTimeout(r, 10));
      }
      return {
        fcp: performance.getEntriesByName('first-contentful-paint')[0]?.startTime,
        dcl: performance.getEntriesByType('navigation')[0]?.domContentLoadedEventEnd,
      };
    });
    if (i > 0) paints.push(t); // the first open may still be warming caches
    await p.close();
    await p.gone();
  }
  const bytes = loads.reduce((sum, path) => {
    try {
      return sum + statSync(join(dist, path)).size;
    } catch {
      return sum;
    }
  }, 0);
  const fcp = paints.map(t => t.fcp).filter(v => typeof v === 'number');
  const dcl = paints.map(t => t.dcl).filter(v => typeof v === 'number');
  const timing = {
    opens: fcp.length,
    median: quantile(fcp, 0.5),
    p90: quantile(fcp, 0.9),
    max: quantile(fcp, 1),
    domContentLoaded: { median: quantile(dcl, 0.5), p90: quantile(dcl, 0.9) },
  };
  report.toolbar.loads = { files: loads, bytes };
  report.toolbar.firstPaint = timing;
  const heavy = loads.filter(path => /\/assets\/(app|Shell|viewer)-|\.wasm$|\/src\/(app|viewer)\//.test(path));
  check(
    'the menu loads none of the main page’s or the editor’s scripts and no wasm',
    loads.length > 1 && heavy.length === 0,
    heavy.length ? heavy.join(', ') : `${loads.length} files, ${bytes} bytes: ${loads.join(' ')}`,
  );
  check(
    `the menu paints within ${POPUP_PAINT_BUDGET} ms (p90 of ${timing.opens} opens)`,
    timing.p90 <= POPUP_PAINT_BUDGET,
    `first paint median ${timing.median} / p90 ${timing.p90} / max ${timing.max} ms`,
  );

  await anchor.close();
  await runIncognitoChecks({ ctx, id, base, items, startUrl, check, report, sleep, cdp, openPopup, waitForPage });
  await cdp.detach();
};

/**
 * The menu in an incognito window. The extension is allowed there (chrome://extensions → "Allow in Incognito"; that
 * reloads it) and runs in spanning mode, the default: its pages never open in an incognito window, Chrome puts them in a
 * regular one (docs/research/new-tab-probe.md §11). Leaves the extension as it found it: not allowed in incognito.
 */
const runIncognitoChecks = async ({
  ctx,
  id,
  base,
  items,
  startUrl,
  check,
  report,
  sleep,
  cdp,
  openPopup,
  waitForPage,
}) => {
  const ext = await ctx.newPage();
  await ext.goto('chrome://extensions/');
  const allow = value =>
    ext.evaluate(
      ([extId, on]) =>
        chrome.developerPrivate.updateExtensionConfiguration({ extensionId: extId, incognitoAccess: on }),
      [id, value],
    );
  await allow(true);
  let sw = null;
  for (let i = 0; i < 100 && !sw; i++) {
    await sleep(100);
    sw = ctx.serviceWorkers().find(w => w.url().startsWith(`chrome-extension://${id}/`)) ?? null;
    if (sw && !(await sw.evaluate(() => chrome.extension.isAllowedIncognitoAccess()).catch(() => false))) sw = null;
  }
  const win = await sw.evaluate(async () => (await chrome.windows.create({ incognito: true, url: 'about:blank' })).id);
  await sleep(500);
  const incognitoTab = async () => {
    const { targetInfos } = await cdp.send('Target.getTargets', { filter: [{ type: 'tab' }] });
    // The incognito window's tab: the one whose browser context no page of the regular profile shares.
    const regular = new Set(
      (await cdp.send('Target.getTargets')).targetInfos
        .filter(t => t.url.startsWith('chrome://extensions'))
        .map(t => t.browserContextId),
    );
    return { targetId: targetInfos.find(t => !regular.has(t.browserContextId))?.targetId };
  };
  const results = {};
  const regularPages = url => ctx.pages().filter(p => !p.isClosed() && p.url() === url);
  const chooseIn = async itemId => {
    const { targetId } = await incognitoTab();
    const menu = await openPopup(null, targetId);
    const state = await menu.state();
    for (let i = 0; i < items.findIndex(it => it.id === itemId); i++) await menu.key('ArrowDown', 40);
    await menu.key('Enter', 13);
    await menu.gone();
    return state;
  };
  const state = await chooseIn('tools');
  const tools = await waitForPage(() => regularPages(`${base}#/tools`)[0]);
  results.menu = { items: state.items.length, popupInIncognitoContext: state.incognito };
  // Recorded, not required: without a window Chrome reports every window focused and getLastFocused never moves
  // (docs/research/new-tab-probe.md §11), so bringing the regular window forward is held by the unit tests.
  results.windows = await sw.evaluate(async () =>
    (await chrome.windows.getAll()).map(w => ({ incognito: w.incognito, focused: w.focused })),
  );
  await chooseIn('tools');
  await sleep(300);
  results.toolsTabs = regularPages(`${base}#/tools`).length;
  check(
    'in an incognito window the menu opens; "Tools" opens our page in a regular window, a second time the same tab',
    state.items.length === items.length && !!tools && results.toolsTabs === 1,
    JSON.stringify(results),
  );
  await chooseIn(items[0].id);
  const start = await waitForPage(() => regularPages(startUrl).find(p => p !== tools));
  await chooseIn('settings');
  const options = await waitForPage(() => ctx.pages().find(p => p.url().startsWith(`${base}?options`)));
  await options?.getByRole('heading', { name: 'Settings', level: 1 }).waitFor({ timeout: 5_000 });
  check(
    `from an incognito window "${items[0].title}" and "Settings" open the start page and the options page in a regular window`,
    !!start && !!options,
    `${start?.url() ?? 'no start page'}; ${options?.url() ?? 'no options page'}`,
  );
  report.toolbar.incognito = { ...results, start: start?.url(), options: options?.url() };
  await sw.evaluate(w => chrome.windows.remove(w), win);
  await allow(false);
  await sleep(500);
  await ext.close();
};
