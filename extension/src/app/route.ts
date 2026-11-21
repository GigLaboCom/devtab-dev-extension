/**
 * The main page's address: one hash per section and per tool (roadmap 1B: `#/tools/json`), so a section can be
 * bookmarked, reloaded and opened from elsewhere. The page is also the browser's New Tab page: a new tab opens it with
 * no hash, which is the start page (public/route-boot.js may first turn it into the last opened tool). On a new tab
 * the address bar stays empty however the hash changes (a same-document navigation keeps Chrome's New Tab address).
 */
import { BARE_FLAG, OPTIONS_FLAG, hasFlag } from '@src/shared/pages';
import { useSyncExternalStore } from 'react';

export type SectionId = 'start' | 'settings' | 'compare' | 'tools' | 'review' | 'history';

export interface Route {
  section: SectionId;
  /** The tool's id in the tools section. */
  tool?: string;
}

export const DEFAULT_ROUTE: Route = { section: 'start' };

const SECTIONS: readonly SectionId[] = ['start', 'settings', 'compare', 'tools', 'review', 'history'];

export const parseRoute = (hash: string): Route => {
  const [section, tool] = hash.replace(/^#\/?/, '').split('/');
  if (section === 'tools') return tool ? { section, tool } : { section };
  if (SECTIONS.includes(section as SectionId)) return { section: section as SectionId };
  return DEFAULT_ROUTE;
};

export const routeHash = (route: Route): string =>
  route.section === 'tools' && route.tool ? `#/tools/${route.tool}` : `#/${route.section}`;

const subscribe = (onChange: () => void): (() => void) => {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
};

export const useRoute = (): Route => {
  const hash = useSyncExternalStore(subscribe, () => window.location.hash);
  return parseRoute(hash);
};

/** Goes to a route in this tab (a hash change: same document, no reload). */
export const go = (hash: string): void => {
  window.location.hash = hash;
};

/**
 * Is this the address a new tab opens — the main page with no route and no query? (Where the build is the New Tab
 * page; elsewhere nothing opens it so.) A page opened by its address on a route is never treated as a new tab.
 */
export const isNewTabLoad = (at: Pick<Location, 'hash' | 'search'>): boolean =>
  ['', '#', '#/'].includes(at.hash) && at.search === '';

/** Does the address ask for the route without the app's frame (the options page in Chrome's dialog, src/options)? */
export const isBare = (search: string): boolean => hasFlag(search, BARE_FLAG);

/**
 * The address without the options flag, when the options page has gone to another route — or null when it stays as
 * it is. Chrome finds an open options page by its address without the hash, and would bring that tab forward on the
 * other route instead of opening the settings (probe, docs/research/new-tab-probe.md §11).
 */
export const addressLeavingOptions = (
  at: Pick<Location, 'pathname' | 'search' | 'hash'>,
  route: Route,
): string | null => {
  if (route.section === 'settings' || !hasFlag(at.search, OPTIONS_FLAG)) return null;
  const query = new URLSearchParams(at.search);
  query.delete(OPTIONS_FLAG);
  const rest = query.toString();
  return `${at.pathname}${rest ? `?${rest}` : ''}${at.hash}`;
};
