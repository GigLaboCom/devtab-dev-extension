/**
 * `NewTabOverride`: the build is the browser's New Tab page (D16) — every new tab opens the main page, which shows the
 * start page or the last opened tool (Settings → General). The menu's first item is "New tab" (the owner's item: a new
 * tab next to the current one, as Chrome's own).
 */
import { APP_PAGE } from '../shared/pages';
import type { OverridingNewTab } from './override';

export const ownNewTab: OverridingNewTab = {
  id: 'own',
  newtab: APP_PAGE,
  start: { id: 'newTab', title: 'New tab', opens: { newTab: true } },
};
