/**
 * Recently opened's code, loaded only while the part is on: reads the browser after the first paint and only while Chrome holds
 * the permission; what it reads lives in the page's memory (recentlyOpened.data.ts).
 */
import { HISTORY_WINDOW, pickRecentSites } from './recentlyOpened.data';
import { afterFirstPaint } from '../tileSources';
import type { RowCode } from '../part';
import type { PartDeps } from './deps';

export const create = (deps: PartDeps): RowCode => ({
  tiles: {
    tiles: async () => {
      await (deps.afterPaint ?? afterFirstPaint)();
      if (!deps.chrome.history) return [];
      return pickRecentSites(await deps.chrome.history.search({ text: '', startTime: 0, maxResults: HISTORY_WINDOW }));
    },
  },
});
