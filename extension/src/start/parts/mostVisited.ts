/** Most visited: Chrome's most visited sites (row, optional `topSites`; read after the first paint). */
import { afterFirstPaint } from '../tileSources';
import type { RowPart } from '../part';
import type { PartDeps } from './deps';

export const mostVisitedPart = (deps: PartDeps): RowPart => ({
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
  tiles: {
    tiles: async () => {
      await (deps.afterPaint ?? afterFirstPaint)();
      // `chrome.topSites` exists only while the permission is held; without it nothing is read or loaded.
      if (!deps.chrome.topSites) return [];
      const { pickMostVisited } = await import('./mostVisited.data');
      return pickMostVisited(await deps.chrome.topSites.get());
    },
  },
});
