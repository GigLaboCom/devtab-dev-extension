/**
 * What a toolbar action opens, as data — so a menu item or a button says what it opens, the tests and the e2e check
 * read it, and one function here does it:
 *   { newTab: true }   a new tab — the browser's New Tab page, ours when the build overrides it (src/newTab)
 *   { route: '#/…' }   the main page at that route, by its address, through the chosen PageOpener (./opener.ts)
 *   { options: true }  the extension's options page (runtime.openOptionsPage: Chrome finds an open one, src/options)
 *
 * Only relative imports of plain modules: scripts/e2e-toolbar.mjs reads the menu's items outside the app.
 */
import { openNewTab } from '../shared/pages';
import type { FromTab } from '../shared/pages';
import type { OpenerApi, PageOpener } from './opener';

export type Target =
  | { newTab: true; route?: never; options?: never }
  | { route: string; newTab?: never; options?: never }
  | { options: true; newTab?: never; route?: never };

/** The browser's APIs a toolbar action may use (none needs a permission), and the opener of pages at a route. */
export interface OpenDeps extends OpenerApi {
  runtime: Pick<typeof chrome.runtime, 'getURL' | 'getContexts' | 'openOptionsPage'>;
  opener: PageOpener;
}

export const openTarget = (target: Target, deps: OpenDeps, from?: FromTab): Promise<void> => {
  if (target.options) return deps.runtime.openOptionsPage();
  if (target.route) return deps.opener.open(deps, target.route, from);
  return openNewTab(deps, from);
};

/** For reports and e2e: what a target opens, in words. */
export const describeTarget = (target: Target): string =>
  target.options ? 'the options page' : target.route ? `the main page at ${target.route}` : 'a new tab';
