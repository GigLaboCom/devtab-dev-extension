/** The data code of "Most visited", loaded only when the part is on. */
import { MAX_TILES, webPage } from '../tileSources';
import type { Tile } from '../tileSources';

/** Chrome's list → tiles. The shortcuts the user added by hand on Chrome's page are not in it (chrome.topSites cannot read them). */
export const pickMostVisited = (sites: readonly chrome.topSites.MostVisitedURL[]): Tile[] =>
  sites
    .filter(site => webPage(site.url))
    .slice(0, MAX_TILES)
    .map(site => ({ id: site.url, title: site.title || new URL(site.url).hostname, href: site.url, site: site.url }));
