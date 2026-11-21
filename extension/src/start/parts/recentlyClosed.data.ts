/**
 * The data code of "Recently closed", loaded only when the part is on. What is read lives in the page's memory: never
 * written to storage or to the localStorage copy, never logged, never sent.
 */
import { MAX_TILES, webPage } from '../tileSources';
import type { Tile } from '../tileSources';

/** How many closed tabs and windows Chrome is asked for: its maximum (getRecentlyClosed refuses more than 25). */
export const CLOSED_WINDOW = 25;

/**
 * Closed tabs and windows, newest first → one tile per page: a closed window brings its tabs, in their order, at the
 * window's place. The same address closed twice is one tile. Left out: anything that is not http(s) — our own pages,
 * chrome:// and other browser pages, files — and a tab Chrome gave no address (without `tabs`). A tile opens the address
 * in this tab, like every tile; it does not restore the tab's session.
 */
export const pickRecentlyClosed = (sessions: readonly chrome.sessions.Session[], limit = MAX_TILES): Tile[] => {
  const tiles: Tile[] = [];
  const seen = new Set<string>();
  const newestFirst = [...sessions].sort((a, b) => b.lastModified - a.lastModified);
  for (const tab of newestFirst.flatMap(s => (s.tab ? [s.tab] : (s.window?.tabs ?? [])))) {
    if (tiles.length >= limit) break;
    const url = webPage(tab.url);
    if (!url || seen.has(url.href)) continue;
    seen.add(url.href);
    tiles.push({ id: `closed:${url.href}`, title: tab.title?.trim() || url.hostname, href: url.href, site: url.href });
  }
  return tiles;
};
