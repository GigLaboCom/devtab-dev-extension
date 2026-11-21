/**
 * The toolbar menu's items: the one list of what the menu offers, in its order. The popup page renders this list and
 * names no item. Adding an item is one entry here: an id, the title the menu shows, and what choosing it opens (a
 * `Target`, src/toolbar/target.ts — data, so the tests and the e2e check read what each item opens).
 *
 *   start     the start page as the build reaches it (src/newTab): "New tab" when the build is the New Tab page,
 *             "Start page" by its address when it is not
 *   Tools, Compare code, History
 *             the main page at that route by its address — always ours, also where our page is not the New Tab page
 *             (incognito, another extension's New Tab, a build without the override); an open tab of ours at that
 *             route comes to the front (seam PageOpener, src/toolbar/index.ts)
 *   Settings  the extension's options page (runtime.openOptionsPage)
 *
 * Live review is not here while it is a stub (the sidebar leads to it). The titles are the sections' own
 * (src/shared/destinations.ts; items.test.ts holds them together) — that module is not imported: it brings the tools'
 * registry with React, and the menu stays light.
 *
 * Only relative imports of plain modules: scripts/e2e-toolbar.mjs reads the list outside the app.
 */
import { newTab } from '../newTab';
import { openTarget } from '../toolbar/target';
import type { FromTab } from '../shared/pages';
import type { OpenDeps, Target } from '../toolbar/target';

/** What an item may use: the APIs of the popup page (none of them needs a permission) and the page opener. */
export interface MenuApi extends OpenDeps {
  tabs: OpenDeps['tabs'] & Pick<typeof chrome.tabs, 'query'>;
}

export interface MenuItem {
  /** Stable, for tests and the page's `data-item`. */
  id: string;
  /** What the menu shows. */
  title: string;
  /** What choosing it opens. */
  opens: Target;
  /** Opens it, from the current tab. The popup closes once it has resolved. */
  open(api: MenuApi): Promise<void>;
}

const item = (id: string, title: string, opens: Target): MenuItem => ({
  id,
  title,
  opens,
  open: async api => {
    // The current tab: where a new tab goes next to, and whether it is incognito (both come without `tabs`).
    const [current] = await api.tabs.query({ active: true, currentWindow: true });
    await openTarget(opens, api, current as FromTab | undefined);
  },
});

export const menuItems: readonly MenuItem[] = [
  item(newTab.start.id, newTab.start.title, newTab.start.opens),
  item('tools', 'Tools', { route: '#/tools' }),
  item('compare', 'Compare code', { route: '#/compare' }),
  item('history', 'History', { route: '#/history' }),
  item('settings', 'Settings', { options: true }),
];
