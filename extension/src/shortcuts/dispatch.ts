/**
 * The one listener for the user's shortcuts on a page of ours (the shell, and the start page, which loads it after its
 * first paint): it follows the stored shortcuts live (store.ts), matches each key against them (bindings.ts) and runs
 * the action with what the page can do (actions.ts, `ShortcutContext`). A key typed into a field counts only with ⌘ /
 * Ctrl. A key pressed in «Compare code»'s editor never reaches this page — the editor keeps its keys — so the page asks
 * the editor to hand up the bound ⌘ / Ctrl chords (`frameKeys`) and passes them to `press`. A command of a section
 * that no part of the page offers now (actions.ts, `isAvailable`) does not take its key: the event goes on untouched.
 */
import { isAvailable } from './actions';
import { actionFor, DEFAULT_SHORTCUTS, resolveBindings } from './bindings';
import { watchShortcuts } from './store';
import { chordOf, isMac } from '@src/shared/keys';
import type { ShortcutAction, ShortcutContext } from './actions';
import type { Bindings, Resolved, ShortcutSettings } from './bindings';
import type { ShortcutStoreDeps } from './store';
import type { KeyChord } from '@src/shared/keys';

/** Whether a key event is typing: its target is a text field, a select or an editable element. */
export const isTyping = (target: EventTarget | null): boolean =>
  target instanceof Element &&
  target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]') !== null;

export interface KeyDispatcher {
  /** The bindings now (they change when the user changes a shortcut on any page). */
  bindings(): Bindings;
  /** Runs the action bound to a chord; true when there was one. */
  press(chord: KeyChord, typing: boolean): boolean;
  stop(): void;
}

/**
 * Listens on `win` for the stored shortcuts. `onBindings` hears every change (the toolbar's and the palette's labels,
 * the keys the editor hands up).
 */
export const listenShortcuts = (
  deps: ShortcutStoreDeps & { win: Pick<Window, 'addEventListener' | 'removeEventListener'>; mac?: boolean },
  actions: readonly ShortcutAction[],
  context: ShortcutContext,
  onBindings?: (resolved: Resolved, settings: ShortcutSettings) => void,
): KeyDispatcher => {
  const mac = deps.mac ?? isMac();
  let resolved = resolveBindings(actions, DEFAULT_SHORTCUTS, mac);
  let bindings = resolved.bindings;
  let stopped = false;
  let unwatch: (() => void) | undefined;
  const press = (chord: KeyChord, typing: boolean): boolean => {
    const action = actionFor(chord, bindings, actions, typing);
    if (!action || !isAvailable(action, context)) return false;
    action.run(context);
    return true;
  };
  const onKey = (event: KeyboardEvent): void => {
    if (event.defaultPrevented || event.isComposing) return;
    if (press(chordOf(event, mac), isTyping(event.target))) event.preventDefault();
  };
  deps.win.addEventListener('keydown', onKey);
  onBindings?.(resolved, DEFAULT_SHORTCUTS);
  watchShortcuts(deps, settings => {
    resolved = resolveBindings(actions, settings, mac);
    bindings = resolved.bindings;
    onBindings?.(resolved, settings);
  })
    .then(stop => (stopped ? stop() : (unwatch = stop)))
    .catch(() => undefined);
  return {
    bindings: () => bindings,
    press,
    stop: () => {
      stopped = true;
      deps.win.removeEventListener('keydown', onKey);
      unwatch?.();
    },
  };
};
