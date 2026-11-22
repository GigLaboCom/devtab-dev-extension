// What every tool's e2e module needed and wrote for itself (scripts/e2e-tools/<id>.mjs; docs/tools/adding-a-tool.md §8):
// one copy here. A module imports what it uses — `import { inDarkTheme, stubClipboard } from '../e2e-helpers.mjs';` —
// and passes the arguments scripts/e2e-tools.mjs gave it.
//
//   extensionOrigin(base)                     'chrome-extension://<id>' from the module's `base`
//   inDarkTheme(ctx, base, page, fn)          the default dark theme (chosen in Settings, in a tab of its own, as a person
//                                             would), `fn()`, then back to the theme mode that was set — also when `fn`
//                                             throws
//   stubClipboard(page) → { copied, restore } the page's own clipboard: `navigator.clipboard.writeText` records instead of
//                                             writing (nothing reaches the machine's clipboard); `copied()` — the texts,
//                                             oldest first; `restore()` puts the browser's back
//   historyRecords(page, owner)               the tool's records in the history's IndexedDB, parsed (envelope fields:
//                                             owner, kind, label, …)
//   waitForHistoryRecord(page, owner, test)   resolves with the first record of the tool that passes `test` (by default
//                                             any) — the history writes after its debounce; throws after `timeout`
//   settledShot(shoot, target, file)          blurs the focused element, waits for transitions and animations on the page
//                                             to finish, then the screenshot (an element or the page)
//   forgetSavedParameters(page, ...ids)       removes these tools' saved parameters (D21, docs/tools/settings.md) from
//                                             chrome.storage.local — a module that changed a tool's options calls it
//                                             before it ends, so the next module opens the tool with its defaults

/* global document, indexedDB, requestAnimationFrame, chrome -- page.evaluate callbacks run in the pages */

import { themeMode, withSettings } from './e2e-theme.mjs';

export const extensionOrigin = base => new URL(base).origin;

/** The theme mode Settings shows now: 'system', 'light' or 'dark' (its note under the choice says it). */
const currentMode = (ctx, base) =>
  withSettings(ctx, base, settings => settings.locator('[data-theme-note]').getAttribute('data-theme-note'));

export const inDarkTheme = async (ctx, base, page, fn) => {
  const before = await currentMode(ctx, base).catch(() => 'System');
  const mode = ['System', 'Light', 'Dark'].find(m => m.toLowerCase() === String(before).toLowerCase()) ?? 'System';
  await themeMode(ctx, base, 'Dark');
  await page.locator('html[data-mode="dark"]').waitFor({ timeout: 5_000 });
  try {
    return await fn();
  } finally {
    await themeMode(ctx, base, mode);
  }
};

export const stubClipboard = async page => {
  await page.evaluate(() => {
    const copied = [];
    Object.defineProperty(navigator.clipboard, 'writeText', {
      configurable: true,
      value: text => {
        copied.push(String(text));
        return Promise.resolve();
      },
    });
    document.documentElement.__e2eCopied = copied;
  });
  return {
    copied: () => page.evaluate(() => [...(document.documentElement.__e2eCopied ?? [])]),
    restore: () =>
      page.evaluate(() => {
        delete navigator.clipboard.writeText;
        delete document.documentElement.__e2eCopied;
      }),
  };
};

export const historyRecords = (page, owner) =>
  page
    .evaluate(async () => {
      const db = await new Promise(resolve => {
        const r = indexedDB.open('tool-history');
        r.onupgradeneeded = () => r.transaction.abort();
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => resolve(null);
      });
      if (!db) return [];
      const lines = await new Promise((resolve, reject) => {
        const r = db.transaction('records').objectStore('records').getAll();
        r.onsuccess = () => resolve(r.result.map(x => x.line));
        r.onerror = () => reject(r.error);
      });
      db.close();
      return lines;
    })
    .then(lines => lines.map(line => JSON.parse(line)).filter(r => r.owner === owner));

export const waitForHistoryRecord = async (page, owner, test = () => true, { timeout = 10_000 } = {}) => {
  const until = Date.now() + timeout;
  for (;;) {
    const found = (await historyRecords(page, owner)).find(test);
    if (found) return found;
    if (Date.now() > until) throw new Error(`no history record of ${owner} in ${timeout} ms`);
    await new Promise(r => setTimeout(r, 200));
  }
};

export const settledShot = async (shoot, target, file) => {
  const page = typeof target.page === 'function' ? target.page() : target;
  await page.evaluate(async () => {
    document.activeElement?.blur?.();
    await Promise.all(document.getAnimations().map(a => a.finished.catch(() => undefined)));
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  });
  await shoot(target, file);
};

export const forgetSavedParameters = (page, ...toolIds) =>
  page.evaluate(async ids => {
    const { toolSettings: record } = await chrome.storage.local.get('toolSettings');
    if (!record?.params) return;
    const params = Object.fromEntries(Object.entries(record.params).filter(([id]) => !ids.includes(id)));
    const rest = { ...record };
    delete rest.params;
    await chrome.storage.local.set({ toolSettings: Object.keys(params).length ? { ...rest, params } : rest });
  }, toolIds);
