/** My shortcuts: the sites the user adds on the page — title and address, stored as a setting (row, no permission). */
import { MAX_SHORTCUTS } from '../settings';
import type { RowPart } from '../part';

export const shortcutsPart: RowPart = {
  id: 'shortcuts',
  kind: 'row',
  title: 'My shortcuts',
  description: 'Sites you add on the start page.',
  defaultOn: true,
  permissions: [],
  empty: 'No shortcuts yet.',
  loadAt: 'start',
  // The user's tiles and the add tile while there is room for another.
  reserve: state => state.shortcuts.length + (state.shortcuts.length < MAX_SHORTCUTS ? 1 : 0),
  load: () => import('./shortcuts.run'),
};
