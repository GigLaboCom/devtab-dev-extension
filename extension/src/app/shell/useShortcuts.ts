/**
 * The user's shortcuts in the shell (src/shortcuts/): one listener for the page (dispatch.ts), the bindings now — for
 * the toolbar's label, the palette's rows and the options — and the keys «Compare code»'s editor must hand up
 * (`frameKeys`: every bound chord with ⌘ / Ctrl whose action has a target now). All of it follows a change made on
 * any page, without a reload.
 *
 * The commands of a section (D38) run on the part of the page that offers them (`targets`, shortcuts/targets.ts): the
 * parts offer and take back their handlers (`useOffer`, sectionKeys.ts), and what the editor hands up follows.
 */
import { isMac } from '@src/shared/keys';
import { isAvailable } from '@src/shortcuts/actions';
import { DEFAULT_SHORTCUTS, resolveBindings } from '@src/shortcuts/bindings';
import { listenShortcuts } from '@src/shortcuts/dispatch';
import { saveShortcuts } from '@src/shortcuts/store';
import { createTargets } from '@src/shortcuts/targets';
import { startTransition, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { FrameKeys } from '@src/shared/keys';
import type { ShortcutAction, ShortcutContext } from '@src/shortcuts/actions';
import type { Bindings, Resolved, ShortcutSettings } from '@src/shortcuts/bindings';
import type { KeyDispatcher } from '@src/shortcuts/dispatch';
import type { ShortcutStoreDeps } from '@src/shortcuts/store';
import type { ShortcutTargets } from '@src/shortcuts/targets';

export interface Shortcuts {
  actions: readonly ShortcutAction[];
  bindings: Bindings;
  /** Where each key came from, and the defaults someone else holds. */
  resolved: Resolved;
  settings: ShortcutSettings;
  save: (settings: ShortcutSettings) => Promise<void>;
  frameKeys: FrameKeys;
  /** Which parts of the page offer the sections' commands now. */
  targets: ShortcutTargets;
  /** The commands that have a target now (the palette lists them), in the registry's order. */
  commands: readonly ShortcutAction[];
}

export const useShortcuts = (
  deps: ShortcutStoreDeps & { win: Pick<Window, 'addEventListener' | 'removeEventListener'> },
  actions: readonly ShortcutAction[],
  context: Pick<ShortcutContext, 'go' | 'find'>,
): Shortcuts => {
  const latest = useRef(context);
  latest.current = context;
  const targets = useMemo(() => createTargets(), []);
  // What has a target changed: the editor's keys and the palette's commands are worked out again. Kept as the list of
  // the commands offered, so a part that takes its offer back and gives it again (a new handler) changes nothing here.
  // A transition: it is never urgent, and a section still arriving (a lazy chunk) is not put back behind its fallback.
  const [offered, setOffered] = useState('');
  useEffect(() => {
    const update = (): void => startTransition(() => setOffered(targets.offered().join(' ')));
    update();
    return targets.watch(update);
  }, [targets]);
  const full = useMemo<ShortcutContext>(
    () => ({
      go: hash => latest.current.go(hash),
      find: () => latest.current.find(),
      offers: id => targets.offers(id),
      command: id => targets.run(id),
    }),
    [targets],
  );
  const [state, setState] = useState<{ resolved: Resolved; settings: ShortcutSettings }>(() => ({
    resolved: resolveBindings(actions, DEFAULT_SHORTCUTS, isMac()),
    settings: DEFAULT_SHORTCUTS,
  }));
  const dispatcher = useRef<KeyDispatcher | null>(null);
  useEffect(() => {
    const live = listenShortcuts(deps, actions, full, (resolved, settings) => setState({ resolved, settings }));
    dispatcher.current = live;
    return () => {
      live.stop();
      dispatcher.current = null;
    };
  }, [deps, actions, full]);
  const save = useCallback((settings: ShortcutSettings) => saveShortcuts(deps.area, settings), [deps]);
  const frameKeys = useMemo<FrameKeys>(
    () => ({
      keys: actions.flatMap(action => {
        const chord = state.resolved.bindings.get(action.id);
        return chord?.mod && isAvailable(action, full) ? [chord] : [];
      }),
      run: chord => dispatcher.current?.press(chord, true) ?? false,
    }),
    // `offered`: what has a target changed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [state.resolved, actions, full, offered],
  );
  const commands = useMemo(
    () => actions.filter(a => a.command && isAvailable(a, full)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [actions, full, offered],
  );
  return {
    actions,
    bindings: state.resolved.bindings,
    resolved: state.resolved,
    settings: state.settings,
    save,
    frameKeys,
    targets,
    commands,
  };
};
