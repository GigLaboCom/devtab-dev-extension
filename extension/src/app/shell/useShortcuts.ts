/**
 * The user's shortcuts in the shell (src/shortcuts/): one listener for the page (dispatch.ts), the bindings now — for
 * the toolbar's label, the palette's rows and the options — and the keys «Compare code»'s editor must hand up
 * (`frameKeys`: every bound chord with ⌘ / Ctrl). All of it follows a change made on any page, without a reload.
 */
import { isMac } from '@src/shared/keys';
import { DEFAULT_SHORTCUTS, resolveBindings } from '@src/shortcuts/bindings';
import { listenShortcuts } from '@src/shortcuts/dispatch';
import { saveShortcuts } from '@src/shortcuts/store';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FrameKeys } from '@src/shared/keys';
import type { ShortcutAction, ShortcutContext } from '@src/shortcuts/actions';
import type { Bindings, Resolved, ShortcutSettings } from '@src/shortcuts/bindings';
import type { KeyDispatcher } from '@src/shortcuts/dispatch';
import type { ShortcutStoreDeps } from '@src/shortcuts/store';

export interface Shortcuts {
  actions: readonly ShortcutAction[];
  bindings: Bindings;
  /** Where each key came from, and the defaults someone else holds. */
  resolved: Resolved;
  settings: ShortcutSettings;
  save: (settings: ShortcutSettings) => Promise<void>;
  frameKeys: FrameKeys;
}

export const useShortcuts = (
  deps: ShortcutStoreDeps & { win: Pick<Window, 'addEventListener' | 'removeEventListener'> },
  actions: readonly ShortcutAction[],
  context: ShortcutContext,
): Shortcuts => {
  const latest = useRef(context);
  latest.current = context;
  const [state, setState] = useState<{ resolved: Resolved; settings: ShortcutSettings }>(() => ({
    resolved: resolveBindings(actions, DEFAULT_SHORTCUTS, isMac()),
    settings: DEFAULT_SHORTCUTS,
  }));
  const dispatcher = useRef<KeyDispatcher | null>(null);
  useEffect(() => {
    const live = listenShortcuts(
      deps,
      actions,
      { go: hash => latest.current.go(hash), find: () => latest.current.find() },
      (resolved, settings) => setState({ resolved, settings }),
    );
    dispatcher.current = live;
    return () => {
      live.stop();
      dispatcher.current = null;
    };
  }, [deps, actions]);
  const save = useCallback((settings: ShortcutSettings) => saveShortcuts(deps.area, settings), [deps]);
  const frameKeys = useMemo<FrameKeys>(
    () => ({
      keys: [...state.resolved.bindings.values()].filter(chord => chord.mod),
      run: chord => dispatcher.current?.press(chord, true) ?? false,
    }),
    [state.resolved],
  );
  return {
    actions,
    bindings: state.resolved.bindings,
    resolved: state.resolved,
    settings: state.settings,
    save,
    frameKeys,
  };
};
