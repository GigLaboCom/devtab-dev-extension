/**
 * `PageOpener`: every time a new tab at the route, next to the tab the toolbar was used in — two "Tools" give two tabs.
 * The alternative to reuseTab.ts: useful when one wants a page of each kind side by side, at the price of a new tab per
 * click.
 */
import { pageAddress } from './opener';
import { openTab } from '../shared/pages';
import type { PageOpener } from './opener';

export const alwaysNewTab: PageOpener = {
  id: 'alwaysNewTab',
  open: (api, route, from) => openTab(api, pageAddress(api, route), from),
};
