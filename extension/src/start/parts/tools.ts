/** Tools: our sections and tools, the ones used last first (row, no permission). */
import { MAX_TILES } from '../tileSources';
import type { RowPart } from '../part';
import type { Place } from './deps';

/** The places the row shows: all but "Tools" and "Settings" — the field and the page's corner lead there. */
export const tilePlaces = (destinations: readonly Place[]): Place[] =>
  destinations.filter(d => d.id !== 'tools' && d.id !== 'settings');

export const toolsPart: RowPart = {
  id: 'tools',
  kind: 'row',
  title: 'Tools',
  description: 'Tools and sections, the ones you used last first.',
  defaultOn: true,
  permissions: [],
  empty: 'No tools.',
  loadAt: 'start',
  reserve: (_state, places) => Math.min(MAX_TILES, tilePlaces(places).length),
  load: () => import('./tools.run'),
};
