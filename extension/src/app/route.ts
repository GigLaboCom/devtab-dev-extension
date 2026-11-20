/**
 * The main page's address: one hash per section and per tool (roadmap 1B: `#/tools/json`), so a section can be
 * bookmarked, reloaded and opened from elsewhere.
 */
import { useSyncExternalStore } from 'react';

export type SectionId = 'compare' | 'tools' | 'review';

export interface Route {
  section: SectionId;
  /** The tool's id in the tools section. */
  tool?: string;
}

export const DEFAULT_ROUTE: Route = { section: 'compare' };

export const parseRoute = (hash: string): Route => {
  const [section, tool] = hash.replace(/^#\/?/, '').split('/');
  if (section === 'tools') return tool ? { section, tool } : { section };
  if (section === 'compare' || section === 'review') return { section };
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
