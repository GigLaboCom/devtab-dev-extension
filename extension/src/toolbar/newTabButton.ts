/**
 * `ToolbarButton`: a click opens the start page, nothing else — no popup (the behaviour before the menu; D16). How it
 * reaches the start page is the build's New Tab override's (src/newTab): a new tab when the build is the New Tab page
 * (next to the clicked tab; by address in an incognito window), the page by its address when it is not.
 */
import { openTarget } from './target';
import { newTab } from '../newTab';
import type { ClickButton } from './button';

export const newTabButton: ClickButton = {
  id: 'newTab',
  click: (api, tab) => openTarget(newTab.start.opens, api, tab),
};
