/** Tools: our sections and tools, the ones used last first (row, no permission). */
import { MAX_TILES, settled } from '../tileSources';
import type { RowPart } from '../part';
import type { PartDeps, Place } from './deps';

export const toolsPart = (deps: PartDeps): RowPart => ({
  id: 'tools',
  kind: 'row',
  title: 'Tools',
  description: 'Tools and sections, the ones you used last first.',
  defaultOn: true,
  permissions: [],
  empty: 'No tools.',
  tiles: {
    tiles: state => {
      // The "Tools" and "Settings" entries are left out: the field and the page's corner lead there.
      const places = deps.destinations.filter(d => d.id !== 'tools' && d.id !== 'settings');
      const rank = (d: Place): number => {
        const i = state.recent.used.indexOf(d.hash);
        return i === -1 ? state.recent.used.length + places.indexOf(d) : i;
      };
      return settled(
        [...places]
          .sort((a, b) => rank(a) - rank(b))
          .slice(0, MAX_TILES)
          .map(d => ({ id: d.id, title: d.title, href: d.hash, destination: d.id })),
      );
    },
  },
});
