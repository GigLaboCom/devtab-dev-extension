/** My shortcuts' code: the user's tiles, answered without waiting, and how the page edits and stores them. */
import { MAX_SHORTCUTS } from '../settings';
import { saveShortcuts } from '../store';
import { settled } from '../tileSources';
import type { RowCode } from '../part';
import type { PartDeps } from './deps';

export const create = (deps: PartDeps): RowCode => ({
  tiles: {
    tiles: state => settled(state.shortcuts.map(s => ({ id: s.id, title: s.title, href: s.url, site: s.url }))),
  },
  editor: {
    items: state => state.shortcuts,
    save: items => saveShortcuts(deps.area, items),
    max: MAX_SHORTCUTS,
    addLabel: 'Add shortcut',
  },
});
