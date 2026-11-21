/** Most visited: Chrome's most visited sites (row, optional `topSites`; read after the first paint). */
import type { RowPart } from '../part';

export const mostVisitedPart: RowPart = {
  id: 'mostVisited',
  kind: 'row',
  title: 'Most visited',
  description: 'Your most visited sites, from Chrome.',
  defaultOn: false,
  permissions: [
    {
      name: 'topSites',
      optional: true,
      reason: 'the "Most visited" tiles (chrome.topSites), read on the device, never stored',
      warning: 'Read a list of your most frequently visited websites',
    },
  ],
  prompt: 'Read a list of your most frequently visited websites',
  privacy:
    'Most visited: your most visited sites are read from Chrome only while this is on, to draw the tiles; they are not stored, logged or sent.',
  empty: 'Chrome has no most visited sites yet.',
  loadAt: 'start',
  load: () => import('./mostVisited.run'),
};
