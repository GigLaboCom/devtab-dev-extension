/**
 * Where the page is, in the places' tree (shared/destinations.ts): the sidebar marks the current place, the toolbar's
 * breadcrumb shows the way to it. Pure.
 */
import type { Destination } from '@src/shared/destinations';

/** The place the route shows: its own hash, or the section of the route (an unknown tool's address is Tools). */
export const currentOf = (hash: string, places: readonly Destination[]): Destination | undefined =>
  places.find(d => d.hash === hash) ?? places.find(d => d.parent === undefined && hash.startsWith(`${d.hash}/`));

/** From the top-level place down to the current one (`Tools`, `Base64`); empty where no place is shown. */
export const trailOf = (hash: string, places: readonly Destination[]): Destination[] => {
  const trail: Destination[] = [];
  for (let d = currentOf(hash, places); d && !trail.includes(d); d = places.find(p => p.id === d!.parent))
    trail.unshift(d);
  return trail;
};
