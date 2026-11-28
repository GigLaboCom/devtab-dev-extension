/**
 * The main page's address: one hash per section and per tool (roadmap 1B: `#/tools/json`), so a section can be
 * bookmarked, reloaded and opened from elsewhere. The page is also the browser's New Tab page: a new tab opens it with
 * no hash, which is the start page (public/route-boot.js may first turn it into the last opened tool). On a new tab
 * the address bar stays empty however the hash changes (a same-document navigation keeps Chrome's New Tab address).
 *
 * The Projects section has three depths (the companion's specification §8.4): `#/projects` — the projects;
 * `#/projects/<id>` — one project; `#/projects/<id>/<path, URL-encoded>` — a file open in it. A scratch file (D34) is
 * `#/projects/scratches/<id>` (a project's id is `p_` and ten base32 characters, so `scratches` is never one). A file
 * opened from the system (D42) is `#/projects/files/<the companion's id>`; `#/projects/open/<token>` is how the companion
 * sends a new tab to a file that waits — the page takes the token, removes it from the address at once and redeems it
 * once (`routeHash` never writes a token back). The address only shows: nothing is written, committed or asked for from
 * an address — a token only says «ask the companion». `#/review` (the section's former stub) opens Projects.
 */
import { BARE_FLAG, OPTIONS_FLAG, hasFlag } from '@src/shared/pages';
import { useSyncExternalStore } from 'react';

export type SectionId = 'start' | 'settings' | 'compare' | 'tools' | 'projects' | 'history';

export interface Route {
  section: SectionId;
  /** The tool's id in the tools section. */
  tool?: string;
  /** The project's id in the Projects section. */
  project?: string;
  /** The file open in that project: a path inside it. */
  path?: string;
  /** The scratch file open in the Projects section (D34): its id. */
  scratch?: string;
  /** A file opened from the system, open in the Projects section (D42): the companion's id of it. */
  file?: string;
  /** A one-time token of a file that waits to be opened (D42): taken from the address and redeemed once. */
  open?: string;
}

/** The second part of a scratch's address: `#/projects/scratches/<id>`. */
const SCRATCHES = 'scratches';
/** The second part of an opened file's address and of a waiting file's token. */
const FILES = 'files';
const OPEN = 'open';
/** What a token looks like (the companion's contract): 32 lowercase hexadecimal characters; anything else is not taken. */
const TOKEN = /^[0-9a-f]{32}$/;

export const DEFAULT_ROUTE: Route = { section: 'start' };

const SECTIONS: readonly SectionId[] = ['start', 'settings', 'compare', 'tools', 'projects', 'history'];

const decoded = (part: string): string | undefined => {
  try {
    return decodeURIComponent(part) || undefined;
  } catch {
    return undefined;
  }
};

export const parseRoute = (hash: string): Route => {
  const [section, tool, ...rest] = hash.replace(/^#\/?/, '').split('/');
  if (section === 'tools') return tool ? { section, tool } : { section };
  if (section === 'review') return { section: 'projects' };
  if (section === 'projects') {
    if (tool === SCRATCHES || tool === FILES) {
      const id = rest[0] ? decoded(rest[0]) : undefined;
      return id ? { section, [tool === FILES ? 'file' : 'scratch']: id } : { section };
    }
    if (tool === OPEN) return rest.length === 1 && TOKEN.test(rest[0]!) ? { section, open: rest[0] } : { section };
    const project = tool ? decoded(tool) : undefined;
    const path = project && rest.length ? decoded(rest.join('/')) : undefined;
    return { section, ...(project && { project }), ...(path && { path }) };
  }
  if (SECTIONS.includes(section as SectionId)) return { section: section as SectionId };
  return DEFAULT_ROUTE;
};

export const routeHash = (route: Route): string => {
  if (route.section === 'tools' && route.tool) return `#/tools/${route.tool}`;
  if (route.section === 'projects' && route.scratch)
    return `#/projects/${SCRATCHES}/${encodeURIComponent(route.scratch)}`;
  if (route.section === 'projects' && route.file) return `#/projects/${FILES}/${encodeURIComponent(route.file)}`;
  if (route.section === 'projects' && route.project) {
    const project = `#/projects/${encodeURIComponent(route.project)}`;
    return route.path ? `${project}/${encodeURIComponent(route.path)}` : project;
  }
  return `#/${route.section}`;
};

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
