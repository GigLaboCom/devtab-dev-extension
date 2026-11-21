/**
 * Recently closed: the tabs closed last in this browser, from chrome.sessions (row, optional `sessions` + `tabs`; read
 * after the first paint). An alternative to "Recently opened" — the user may switch on one, the other or both.
 * `sessions` alone returns closed tabs without their address or title, so `tabs` comes with it; Chrome then words the
 * two as one warning. Only this browser's closed tabs: getRecentlyClosed returns those, and getDevices (other signed-in
 * devices) is never called.
 */
import { afterFirstPaint } from '../tileSources';
import type { RowPart } from '../part';
import type { PartDeps } from './deps';

export const recentlyClosedPart = (deps: PartDeps): RowPart => ({
  id: 'recentlyClosed',
  kind: 'row',
  title: 'Recently closed',
  description:
    'The tabs you closed last in this browser, newest first; a closed window brings its tabs. A click opens the page here. Read only while this is on; never stored or sent.',
  defaultOn: false,
  permissions: [
    {
      name: 'sessions',
      optional: true,
      reason:
        'the "Recently closed" tiles (chrome.sessions.getRecentlyClosed), read only while the switch is on and only to draw the tiles — never stored, logged or sent; other devices are never read',
      warning: null,
    },
    {
      name: 'tabs',
      optional: true,
      reason: 'without it chrome.sessions returns closed tabs with no address or title, so there is nothing to draw',
      warning: 'Read your browsing history',
    },
  ],
  prompt: 'Read your browsing history on all your signed-in devices',
  privacy:
    'Recently closed: the tabs you closed in this browser are read only while this is on, and only to show their tiles. They are not stored, not copied, not logged and not sent anywhere; your other devices are never read; switching it off gives the permissions back to Chrome.',
  empty: 'No tabs were closed recently.',
  tiles: {
    tiles: async () => {
      await (deps.afterPaint ?? afterFirstPaint)();
      // `chrome.sessions` exists only while the permission is held; without it nothing is read or loaded.
      if (!deps.chrome.sessions) return [];
      const { CLOSED_WINDOW, pickRecentlyClosed } = await import('./recentlyClosed.data');
      return pickRecentlyClosed(await deps.chrome.sessions.getRecentlyClosed({ maxResults: CLOSED_WINDOW }));
    },
  },
});
