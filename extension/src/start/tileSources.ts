/**
 * Seam `TileSource` — where a row's tiles come from (docs/replaceable-behaviors.md). Each row part of the start page
 * (parts/*.ts) has one. Asynchronous (a row may come from Chrome, later from the companion). A source that already has
 * its tiles answers with `settled(…)`, a promise React's `use()` reads without suspending, so the rows the page knows
 * are drawn in the first frame; only a source that really waits shows its placeholder. Sources that read the browser
 * start only after the first paint (`afterFirstPaint`) and load their data code then.
 */
import type { StartState } from './settings';

export interface Tile {
  id: string;
  title: string;
  /** Where the tile leads: a web address or one of our route hashes. */
  href: string;
  /** A web address the tile stands for (for SiteIcons); absent on our own places. */
  site?: string;
  /** One of our places (for its icon); absent on websites. */
  destination?: string;
}

export interface TileSource {
  tiles(state: StartState): Promise<readonly Tile[]>;
}

export const MAX_TILES = 8;

type Settled<T> = Promise<T> & { status: 'fulfilled'; value: T };

/** An already-resolved promise marked the way React's `use()` reads synchronously. */
export const settled = <T>(value: T): Settled<T> =>
  Object.assign(Promise.resolve(value), { status: 'fulfilled', value }) as Settled<T>;

/** Resolves once the page has painted: a frame, then a task after it. */
export const afterFirstPaint = (): Promise<void> =>
  new Promise(resolve => {
    const next = (): void => void setTimeout(resolve, 0);
    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(next);
    else next();
  });

/** A web address as a URL, or null when it is not an http(s) page (our pages, chrome://, files, nothing). */
export const webPage = (address: string | undefined): URL | null => {
  try {
    const url = new URL(address ?? '');
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null;
  } catch {
    return null;
  }
};
