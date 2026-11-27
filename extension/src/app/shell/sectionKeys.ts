/**
 * What a section gets of the user's shortcuts (D38): it offers the commands it has a target for (`useOffer` — a new
 * scratch file, the open scratch's actions, the panels of an open project), and it shows the key each of its controls
 * has now, as the person set it, never the default (`hintOf`: the control's tooltip and `aria-keyshortcuts`, as the
 * sidebar's links do). The shell makes it from its shortcuts (Shell.tsx); a section drawn without the shell gets none
 * and works the same, without keys.
 */
import { ariaKeys, keyLabel } from '@src/shared/keyLabels';
import { useEffect, useRef } from 'react';
import type { KeyChord } from '@src/shared/keys';
import type { CommandHandlers } from '@src/shortcuts/targets';

export interface SectionKeys {
  /** Offers commands until the returned undo is called (shortcuts/targets.ts). */
  offer(handlers: CommandHandlers): () => void;
  /** The key an action has now, or undefined. */
  keyOf(id: string): KeyChord | undefined;
  mac: boolean;
}

/** A control's tooltip with the action's key now, and the key for a screen reader. */
export interface KeyHint {
  title: string;
  'aria-keyshortcuts'?: string;
}

export const hintOf = (keys: SectionKeys | undefined, id: string, title: string): KeyHint => {
  const chord = keys?.keyOf(id);
  return chord
    ? { title: `${title} (${keyLabel(chord, keys!.mac)})`, 'aria-keyshortcuts': ariaKeys(chord, keys!.mac) }
    : { title };
};

/** The key an action has now, as the platform shows it, or undefined. */
export const keyTextOf = (keys: SectionKeys | undefined, id: string): string | undefined => {
  const chord = keys?.keyOf(id);
  return chord && keyLabel(chord, keys!.mac);
};

/**
 * Offers the commands whose handler is given (a falsy one: no target now) while the component is there. The latest
 * handler runs; the offer changes only when which commands have a target changes.
 */
export const useOffer = (
  keys: SectionKeys | undefined,
  handlers: Readonly<Record<string, (() => void) | false | null | undefined>>,
): void => {
  const latest = useRef(handlers);
  latest.current = handlers;
  const ids = Object.keys(handlers)
    .filter(id => handlers[id])
    .join(' ');
  useEffect(() => {
    if (!keys || !ids) return;
    return keys.offer(
      Object.fromEntries(
        ids.split(' ').map(id => [
          id,
          () => {
            const handler = latest.current[id];
            if (handler) handler();
          },
        ]),
      ),
    );
  }, [keys, ids]);
};
