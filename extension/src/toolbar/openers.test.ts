/**
 * Seam `PageOpener`: the shared contract, run against every implementation — the page ends up shown at the route, from
 * a regular or an incognito window — and what reuseTab adds: an open tab of ours at the route comes forward, our blank
 * new tab is used, nothing else of ours is taken over.
 */
import { alwaysNewTab } from './alwaysNewTab';
import { isInside, routeOf } from './opener';
import { reuseTab } from './reuseTab';
import { fakeTabs } from '@src/test/fakes';
import { describe, expect, it } from 'vitest';
import type { PageOpener } from './opener';

const IMPLEMENTATIONS: readonly PageOpener[] = [reuseTab, alwaysNewTab];
const PAGE = 'chrome-extension://test/src/app/index.html';
const FROM = { id: 10, windowId: 1, index: 2, incognito: false };
const INCOGNITO = { id: 20, windowId: 5, index: 0, incognito: true };

describe.each(IMPLEMENTATIONS.map(o => [o.id, o] as const))('PageOpener %s', (_id, opener) => {
  it('with no tab of ours, opens the main page at the route next to the current tab', async () => {
    const api = fakeTabs();
    await opener.open(api, '#/tools', FROM);
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, index: 3, url: `${PAGE}#/tools` });
  });

  it('from an incognito window, opens it in a regular window (spanning mode) and brings that window forward', async () => {
    const api = fakeTabs([], null, 3);
    await opener.open(api, '#/compare', INCOGNITO);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: `${PAGE}#/compare` });
    expect(api.windows.update).toHaveBeenCalledWith(3, { focused: true });
  });

  it('without a current tab, still opens it', async () => {
    const api = fakeTabs();
    await opener.open(api, '#/tools');
    expect(api.tabs.create).toHaveBeenCalledWith({ url: `${PAGE}#/tools` });
  });
});

describe('reuseTab', () => {
  it('brings an open tab of ours at that route in this window to the front, and opens nothing', async () => {
    const api = fakeTabs([
      { tabId: 4, windowId: 1, documentUrl: `${PAGE}#/compare` },
      { tabId: 5, windowId: 1, documentUrl: `${PAGE}#/tools` },
    ]);
    await reuseTab.open(api, '#/tools', FROM);
    expect(api.tabs.update).toHaveBeenCalledWith(5, { active: true });
    expect(api.windows.update).not.toHaveBeenCalled();
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('a tool counts as the Tools page; the options page’s flag does not change the route', async () => {
    const api = fakeTabs([{ tabId: 6, windowId: 1, documentUrl: `${PAGE}#/tools/json` }]);
    await reuseTab.open(api, '#/tools', FROM);
    expect(api.tabs.update).toHaveBeenCalledWith(6, { active: true });
    const settings = fakeTabs([{ tabId: 7, windowId: 1, documentUrl: `${PAGE}?options#/settings` }]);
    await reuseTab.open(settings, '#/settings', FROM);
    expect(settings.tabs.update).toHaveBeenCalledWith(7, { active: true });
  });

  it('leaves a tab of ours in another regular window alone, as Chrome does with its own pages', async () => {
    const api = fakeTabs([{ tabId: 8, windowId: 2, documentUrl: `${PAGE}#/tools` }]);
    await reuseTab.open(api, '#/tools', FROM);
    expect(api.tabs.update).not.toHaveBeenCalled();
    expect(api.tabs.create).toHaveBeenCalled();
  });

  it('from an incognito window, finds the tab in a regular window and brings tab and window forward', async () => {
    const api = fakeTabs([{ tabId: 8, windowId: 2, documentUrl: `${PAGE}#/compare` }]);
    await reuseTab.open(api, '#/compare', INCOGNITO);
    expect(api.tabs.update).toHaveBeenCalledWith(8, { active: true });
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('uses the current tab when it is our new tab with nothing opened yet (the same document: no reload)', async () => {
    const api = fakeTabs([{ tabId: 10, windowId: 1, documentUrl: PAGE }]);
    await reuseTab.open(api, '#/tools', FROM);
    expect(api.tabs.update).toHaveBeenCalledWith(10, { url: `${PAGE}#/tools` });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('does not take over a current tab of ours that shows something (a tool, the start page by address)', async () => {
    for (const documentUrl of [`${PAGE}#/tools/json`, `${PAGE}#/start`]) {
      const api = fakeTabs([{ tabId: 10, windowId: 1, documentUrl }]);
      await reuseTab.open(api, '#/compare', FROM);
      expect(api.tabs.update).not.toHaveBeenCalled();
      expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, index: 3, url: `${PAGE}#/compare` });
    }
  });

  it('the start page: an open new tab of ours showing it counts', async () => {
    const api = fakeTabs([{ tabId: 3, windowId: 1, documentUrl: PAGE }]);
    await reuseTab.open(api, '#/start', FROM);
    expect(api.tabs.update).toHaveBeenCalledWith(3, { active: true });
  });
});

describe('the route of a document of ours', () => {
  const api = fakeTabs();
  it('is its hash; no hash is the start page; another page of ours is none', () => {
    expect(routeOf(api, `${PAGE}#/tools/json`)).toBe('#/tools/json');
    expect(routeOf(api, `${PAGE}?options#/settings`)).toBe('#/settings');
    expect(routeOf(api, PAGE)).toBe('#/start');
    expect(routeOf(api, 'chrome-extension://test/src/viewer/index.html')).toBeNull();
    expect(routeOf(api, undefined)).toBeNull();
  });
  it('inside: the route itself or below it, not a prefix of a word', () => {
    expect(isInside('#/tools', '#/tools')).toBe(true);
    expect(isInside('#/tools/json', '#/tools')).toBe(true);
    expect(isInside('#/toolsx', '#/tools')).toBe(false);
  });
});
