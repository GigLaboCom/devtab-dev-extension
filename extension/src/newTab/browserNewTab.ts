/**
 * `NewTabOverride`: the browser keeps its own New Tab page — no `chrome_url_overrides`, no install warning for it, no
 * "Change back to Google?" dialog. The start page is a page of ours like the others, reached by its address: the menu's
 * first item is "Start page" (and the button without a menu opens it). A new tab is not ours, so Settings has no "A new
 * tab opens".
 */
import type { KeepingNewTab } from './override';

export const browserNewTab: KeepingNewTab = {
  id: 'browser',
  start: { id: 'start', title: 'Start page', opens: { route: '#/start' } },
};
