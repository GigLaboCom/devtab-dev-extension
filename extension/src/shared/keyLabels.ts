/**
 * How a shortcut (keys.ts) is shown: in a `Kbd`, in a tooltip and in `aria-keyshortcuts`. The platform decides — the
 * UI kit's hotkey field shows combinations the same way (@workspace/ui/hotkey-input, `formatHotkey`): on a Mac the
 * symbols in Apple's order (⌥⇧⌘K), elsewhere the names joined by `+` (Ctrl+Alt+Shift+K). Only the shell draws
 * shortcuts, so this is not part of the start route.
 */
import { formatHotkey, hotkeyKeyName } from '@workspace/ui/hotkey-input';
import type { KeyChord } from './keys';

/** How the chord is shown: `⇧⌘S` on a Mac, `Ctrl+Shift+S` elsewhere. */
export const keyLabel = (chord: KeyChord, mac: boolean): string => formatHotkey(chord, mac ? 'mac' : 'other');

/** The chord in `aria-keyshortcuts` form: `Meta+K`, `Control+Shift+S`. */
export const ariaKeys = (chord: KeyChord, mac: boolean): string =>
  [
    chord.mod ? (mac ? 'Meta' : 'Control') : '',
    chord.alt ? 'Alt' : '',
    chord.shift ? 'Shift' : '',
    hotkeyKeyName(chord),
  ]
    .filter(Boolean)
    .join('+');
