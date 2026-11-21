/**
 * The start page's listener for the user's shortcuts: a chunk of its own that the start page loads after its first
 * paint (the start route has a byte budget, scripts/validate-build.sh Check 15). The same list of actions as the shell's
 * (actions.ts over shared/destinations.ts and the tools' suggested keys from the catalogue); here `find` focuses the start page's field instead of opening a palette.
 */
import { shortcutActions, suggestedKeys } from './actions';
import { listenShortcuts } from './dispatch';
import { DESTINATIONS } from '@src/shared/destinations';
import { TOOL_CATALOGUE } from '@src/tools/catalogue';
import type { ShortcutContext } from './actions';
import type { KeyDispatcher } from './dispatch';
import type { ShortcutStoreDeps } from './store';

export const listenStartKeys = (deps: ShortcutStoreDeps, context: ShortcutContext): KeyDispatcher =>
  listenShortcuts({ ...deps, win: window }, shortcutActions(DESTINATIONS, suggestedKeys(TOOL_CATALOGUE)), context);
