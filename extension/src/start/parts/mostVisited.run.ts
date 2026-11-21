/**
 * Most visited's code, loaded only while the part is on: reads the browser after the first paint and only while Chrome holds
 * the permission; what it reads lives in the page's memory (mostVisited.data.ts).
 */
import { pickMostVisited } from './mostVisited.data';
import { afterFirstPaint } from '../tileSources';
import type { RowCode } from '../part';
import type { PartDeps } from './deps';

export const create = (deps: PartDeps): RowCode => ({
  tiles: {
    tiles: async () => {
      await (deps.afterPaint ?? afterFirstPaint)();
      // `chrome.topSites` exists only while the permission is held; without it nothing is read.
      if (!deps.chrome.topSites) return [];
      return pickMostVisited(await deps.chrome.topSites.get());
    },
  },
});
