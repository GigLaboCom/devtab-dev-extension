import { APP_PAGE, openNewTab, openTab } from './pages';
import { fakeTabs } from '@src/test/fakes';
import { describe, expect, it } from 'vitest';

const ORIGIN = 'chrome-extension://test/';

describe('openNewTab (the toolbar’s "New tab")', () => {
  it('opens a new tab — the browser’s New Tab page — next to the tab the toolbar was used in', async () => {
    const api = fakeTabs();
    await openNewTab(api, { windowId: 3, index: 4, incognito: false });
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 3, index: 5 });
    expect(api.windows.update).not.toHaveBeenCalled();
  });

  it('never looks for an open main page: a second click opens a second tab', async () => {
    const api = fakeTabs();
    await openNewTab(api, { windowId: 3, index: 0, incognito: false });
    await openNewTab(api, { windowId: 3, index: 1, incognito: false });
    expect(api.tabs.create).toHaveBeenCalledTimes(2);
  });

  it('from an incognito window: the main page by its address, in the regular window Chrome picks, brought forward', async () => {
    const api = fakeTabs([], null, 7);
    await openNewTab(api, { windowId: 9, index: 0, incognito: true });
    expect(api.tabs.create).toHaveBeenCalledWith({ url: ORIGIN + APP_PAGE });
    expect(api.windows.update).toHaveBeenCalledWith(7, { focused: true });
  });

  it('opens a new tab in the current window without a tab to start from', async () => {
    const api = fakeTabs();
    await openNewTab(api);
    expect(api.tabs.create).toHaveBeenCalledWith({});
  });
});

describe('openTab', () => {
  it('opens the address next to the tab, or in a regular window from an incognito one', async () => {
    const api = fakeTabs();
    await openTab(api, `${ORIGIN}${APP_PAGE}#/tools`, { windowId: 1, index: 0, incognito: false });
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, index: 1, url: `${ORIGIN}${APP_PAGE}#/tools` });
    await openTab(api, `${ORIGIN}${APP_PAGE}#/tools`, { windowId: 5, index: 0, incognito: true });
    expect(api.tabs.create).toHaveBeenLastCalledWith({ url: `${ORIGIN}${APP_PAGE}#/tools` });
  });
});
