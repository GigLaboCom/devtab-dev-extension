/** The extension's own pages (built by vite.config.ts as inputs; the main page is also the New Tab page). */
export const APP_PAGE = 'src/app/index.html';
export const VIEWER_PAGE = 'src/viewer/index.html';

/**
 * The query flag of the options page's address (src/options): it makes the address differ from a new tab's, which
 * Chrome would otherwise take for an open options page (docs/research/new-tab-probe.md §5). The page reads its route
 * from the hash; on any route but the settings it drops the flag, so the tab is no longer the options page.
 */
export const OPTIONS_FLAG = 'options';

/**
 * The query flag that draws a route without the app's frame (the sidebar): for a page shown in a small frame of
 * Chrome's own — the options dialog of chrome://extensions (src/options/optionsEmbedded.ts).
 */
export const BARE_FLAG = 'bare';

export const hasFlag = (search: string, flag: string): boolean => new URLSearchParams(search).has(flag);

/** What a page needs to open, focus or create tabs. None of it needs a permission (not even `tabs`). */
export interface TabsApi {
  runtime: Pick<typeof chrome.runtime, 'getURL'>;
  tabs: Pick<typeof chrome.tabs, 'create'>;
  windows: Pick<typeof chrome.windows, 'update'>;
}

/** The tab a toolbar action came from, as much of it as Chrome gives without the `tabs` permission. */
export type FromTab = Pick<chrome.tabs.Tab, 'windowId' | 'index' | 'incognito'> & { id?: number };

/**
 * Opens `url` (or, without one, a new tab: the browser's New Tab page) next to the tab the action came from. Our pages
 * never open in an incognito window: the extension runs there in spanning mode (the default), and Chrome puts a tab of
 * ours asked for there into a regular window (probe, docs/research/new-tab-probe.md §11) — so from an incognito window
 * the tab goes to Chrome's choice of regular window, without a position, and that window comes to the front.
 */
export const openTab = async (api: TabsApi, url: string | undefined, from?: FromTab): Promise<void> => {
  if (from?.incognito) {
    const tab = await api.tabs.create({ url: url ?? api.runtime.getURL(APP_PAGE) });
    await api.windows.update(tab.windowId, { focused: true });
    return;
  }
  await api.tabs.create({
    ...(from ? { windowId: from.windowId, index: from.index + 1 } : {}),
    ...(url ? { url } : {}),
  });
};

/**
 * A new tab from the toolbar (the button without a menu, the menu's "New tab"): the browser's New Tab page, next to the
 * tab the toolbar was used in, as Chrome's own new tab — its address bar stays empty. It is ours when the build overrides
 * the New Tab page (src/newTab) and no extension installed later took it over; nothing tells which before the tab opens
 * (probe), and a tab is never redirected to our page afterwards (the Chrome Web Store allows no override but the URL
 * Overrides API). In an incognito window the override does not apply (Chrome's rule), so there it opens the main page
 * by its address (with no route: what a new tab shows), in a regular window as every page of ours.
 */
export const openNewTab = (api: TabsApi, from?: FromTab): Promise<void> => openTab(api, undefined, from);
