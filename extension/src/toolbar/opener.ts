/**
 * Seam `PageOpener` — how the toolbar opens a page of ours at a route (docs/replaceable-behaviors.md): the menu's
 * "Tools", "Compare code", "Start page", and the button without a menu when the build is not the New Tab page. The
 * composition root (index.ts) picks the implementation; the popup page and the service worker receive it as an argument.
 *
 * What an implementation may use needs no permission: runtime.getContexts lists the tabs that show a page of ours, with
 * their address — the hash included, kept current through same-document navigation — their tab and window; tabs.update
 * and windows.update bring one to the front (probe, docs/research/new-tab-probe.md §11). Asynchronous: the browser
 * answers.
 *
 * Only relative imports of plain modules: the composition root is read outside the app.
 */
import { APP_PAGE } from '../shared/pages';
import type { FromTab, TabsApi } from '../shared/pages';

export interface OpenerApi extends TabsApi {
  runtime: Pick<typeof chrome.runtime, 'getURL' | 'getContexts'>;
  tabs: Pick<typeof chrome.tabs, 'create' | 'update'>;
}

export interface PageOpener {
  id: string;
  /** Shows the main page at `route` (`#/tools`) to the user, from the tab the toolbar was used in. */
  open(api: OpenerApi, route: string, from?: FromTab): Promise<void>;
}

/** The main page's address at a route. */
export const pageAddress = (api: Pick<OpenerApi, 'runtime'>, route: string): string =>
  api.runtime.getURL(APP_PAGE) + route;

/**
 * The route a document of ours shows, or null when it is not the main page. A new tab opens the main page with no hash,
 * which is the start page; the query (the options page's flag) does not change the route.
 */
export const routeOf = (api: Pick<OpenerApi, 'runtime'>, documentUrl: string | undefined): string | null => {
  if (!documentUrl) return null;
  const [noHash, hash = ''] = documentUrl.split('#');
  if (noHash!.split('?')[0] !== api.runtime.getURL(APP_PAGE)) return null;
  return hash ? `#${hash}` : '#/start';
};

/** Is the route the one asked for, or inside it (`#/tools/json` is inside `#/tools`)? */
export const isInside = (route: string, asked: string): boolean => route === asked || route.startsWith(`${asked}/`);

/** The tabs of ours: every tab whose document is a page of this extension. */
export const tabsOfOurs = (api: Pick<OpenerApi, 'runtime'>): Promise<chrome.runtime.ExtensionContext[]> =>
  api.runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] });
