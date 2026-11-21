/** My shortcuts: the sites the user adds on the page — title and address, stored as a setting (row, no permission). */
import { MAX_SHORTCUTS } from '../settings';
import { saveShortcuts } from '../store';
import { settled } from '../tileSources';
import type { RowPart } from '../part';
import type { PartDeps } from './deps';

export const shortcutsPart = (deps: PartDeps): RowPart => ({
  id: 'shortcuts',
  kind: 'row',
  title: 'My shortcuts',
  description: 'Sites you add on the start page.',
  defaultOn: true,
  permissions: [],
  empty: 'No shortcuts yet.',
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
