/**
 * The data code of "Recently opened", loaded only when the part is on. What is read lives in the page's memory: never
 * written to storage or to the localStorage copy, never logged, never sent.
 */
import { MAX_TILES, webPage } from '../tileSources';
import type { Tile } from '../tileSources';

/** How far back the read goes, in entries: enough for 8 sites after the exclusions below. */
export const HISTORY_WINDOW = 200;

const SEARCH_PARAMS = ['q', 'query', 'text', 'wd', 'p', 'search_query', 'search'];

/**
 * A search engine's results page: a path that names a search (or the site's root, as `/?q=…`) and a query parameter
 * with a value. Left out so that the searches made from the start page do not fill the row.
 */
export const isSearchResults = (url: URL): boolean =>
  /^\/?$|(?:^|\/)(?:search|s|results|web)\/?$/i.test(url.pathname) &&
  SEARCH_PARAMS.some(name => (url.searchParams.get(name) ?? '').trim() !== '');

/**
 * History entries → one tile per site (its host without `www.`), the most recently visited first: the site's latest
 * page, titled by the page (its host when it has none). Left out: anything that is not http(s) — our own pages,
 * chrome:// and other browser pages, files — and search results pages.
 */
export const pickRecentSites = (items: readonly chrome.history.HistoryItem[], limit = MAX_TILES): Tile[] => {
  const seen = new Set<string>();
  const tiles: Tile[] = [];
  const latestFirst = [...items].sort((a, b) => (b.lastVisitTime ?? 0) - (a.lastVisitTime ?? 0));
  for (const item of latestFirst) {
    if (tiles.length >= limit) break;
    const url = webPage(item.url);
    if (!url || isSearchResults(url)) continue;
    const site = url.hostname.replace(/^www\./, '');
    if (seen.has(site)) continue;
    seen.add(site);
    tiles.push({ id: `recent:${site}`, title: item.title?.trim() || site, href: url.href, site: url.href });
  }
  return tiles;
};
