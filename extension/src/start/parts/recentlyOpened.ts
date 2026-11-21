/** Recently opened: the sites opened last, from the browser's history (row, optional `history`; after the first paint). */
import type { RowPart } from '../part';

export const recentlyOpenedPart: RowPart = {
  id: 'recentlyOpened',
  kind: 'row',
  title: 'Recently opened',
  description:
    'The sites you opened last, from your browsing history: one tile per site, newest first. Read only while this is on, only to show the tiles; never stored or sent.',
  defaultOn: false,
  permissions: [
    {
      name: 'history',
      optional: true,
      reason:
        'the "Recently opened" tiles (chrome.history.search), read only while the switch is on and only to draw the tiles — never stored, logged or sent; the extension never changes history',
      warning: 'Read and change your browsing history on all your signed-in devices',
    },
  ],
  prompt: 'Read and change your browsing history on all your signed-in devices',
  privacy:
    'Recently opened: your browsing history is read only while this is on, and only to show its tiles on the start page. It is not stored, not copied, not logged and not sent anywhere; switching it off gives the permission back to Chrome.',
  empty: 'Your history has no sites to show yet.',
  loadAt: 'start',
  load: () => import('./recentlyOpened.run'),
};
