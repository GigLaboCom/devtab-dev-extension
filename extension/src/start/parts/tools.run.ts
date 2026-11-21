/** Tools' code: our places as tiles, the ones used last first, then in the registry's order. */
import { tilePlaces } from './tools';
import { MAX_TILES, settled } from '../tileSources';
import type { RowCode } from '../part';
import type { PartDeps, Place } from './deps';

export const create = (deps: PartDeps): RowCode => ({
  tiles: {
    tiles: state => {
      const places = tilePlaces(deps.destinations);
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
