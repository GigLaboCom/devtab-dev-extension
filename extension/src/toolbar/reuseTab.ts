/**
 * `PageOpener`: as Chrome opens its own pages from its menu and the extension's options page
 * (runtime.openOptionsPage) — one tab per page, and a blank new tab is used rather than left behind:
 *   1. a tab of ours already at that route (or inside it: a tool for "Tools") in this window comes to the front — what
 *      the user typed or pasted there is still there;
 *   2. otherwise, when the tab the toolbar was used in is our new tab with nothing opened yet (the main page with no
 *      hash), that tab goes to the route — the same document, so a new tab's address bar stays empty;
 *   3. otherwise a new tab at the route, next to that tab.
 * From an incognito window the tabs of ours are in regular windows (spanning mode), so step 1 looks in every window and
 * brings the window to the front too; step 3 then opens in a regular window (shared/pages.ts, openTab).
 */
import { isInside, pageAddress, routeOf, tabsOfOurs } from './opener';
import { openTab } from '../shared/pages';
import type { PageOpener } from './opener';

export const reuseTab: PageOpener = {
  id: 'reuseTab',
  open: async (api, route, from) => {
    const ours = await tabsOfOurs(api);
    const open = ours.find(c => {
      const at = routeOf(api, c.documentUrl);
      return at !== null && isInside(at, route) && (from?.incognito || c.windowId === from?.windowId);
    });
    if (open) {
      // The tab first: bringing another window forward closes the popup this may run in.
      await api.tabs.update(open.tabId, { active: true });
      if (open.windowId !== from?.windowId) await api.windows.update(open.windowId, { focused: true });
      return;
    }
    const blank =
      from?.id !== undefined &&
      !from.incognito &&
      ours.some(c => c.tabId === from.id && !c.documentUrl?.includes('#') && routeOf(api, c.documentUrl) !== null);
    if (blank) {
      await api.tabs.update(from.id!, { url: pageAddress(api, route) });
      return;
    }
    await openTab(api, pageAddress(api, route), from);
  },
};
