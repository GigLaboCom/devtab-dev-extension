/**
 * Keyboard shortcuts of our pages: a chord is a key with or without the platform's command modifier (⌘ on a Mac, Ctrl
 * elsewhere), Alt (⌥) and Shift. A module of its own, with nothing else in it, because the start page reads it too and
 * the start route has a byte budget (scripts/validate-build.sh, Check 15); the editor's protocol (viewerProtocol.ts)
 * re-exports it, and how a chord is shown is keyLabels.ts (the shell's alone).
 *
 * The same chord means the same on every platform: `mod` is the platform's command modifier, so ⌘K recorded on a Mac
 * is Ctrl+K on Windows and Linux. The other modifier — ⌃ on a Mac, the Windows or Super key elsewhere — has no
 * counterpart on the other side; a chord with it (`other`) is never bound (src/shortcuts/bindings.ts). A recorded chord
 * keeps the physical key (`code`, `KeyK`), so it does not change with the keyboard layout; a page's fixed shortcut
 * («Compare code»'s ⌘S) may name the key only.
 */

export interface KeyChord {
  /** `KeyboardEvent.key`, lower case. */
  key: string;
  /** `KeyboardEvent.code`: the physical key, the same under any layout; compared when both chords have it. */
  code?: string;
  mod: boolean;
  shift: boolean;
  alt?: boolean;
  /** The platform's other modifier is held (⌃ on a Mac, Windows / Super elsewhere). */
  other?: boolean;
}

/**
 * "Go to a place": opens the shell's palette, or focuses the start page's field where that field is the page — the
 * default of the `find` shortcut (src/shortcuts/actions.ts), which the user may change. ⌘K is what the established
 * palettes take (GitHub, Slack, Linear, documentation sites); Ctrl+K elsewhere is Chrome's "search from the address
 * bar", which a page may take by cancelling the key (it is not one of the keys Chrome keeps for itself).
 */
export const FIND_SHORTCUT: KeyChord = { key: 'k', code: 'KeyK', mod: true, shift: false };

/**
 * The shortcuts the frame around a page owns (the shell's: the palette and the user's shortcuts). A page whose iframe
 * keeps its keys («Compare code»'s editor) asks the iframe to hand these up too, and gives them back here; `run`
 * answers whether it took one.
 */
export interface FrameKeys {
  keys: readonly KeyChord[];
  run: (chord: KeyChord) => boolean;
}

/** The chord of a key event: the command modifier is ⌘ on a Mac and Ctrl elsewhere. */
export const chordOf = (
  event: Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'shiftKey'> &
    Partial<Pick<KeyboardEvent, 'code' | 'altKey'>>,
  mac: boolean,
): KeyChord => ({
  key: event.key.toLowerCase(),
  ...(event.code ? { code: event.code } : {}),
  mod: mac ? event.metaKey : event.ctrlKey,
  shift: event.shiftKey,
  ...(event.altKey ? { alt: true } : {}),
  ...((mac ? event.ctrlKey : event.metaKey) ? { other: true } : {}),
});

export const sameChord = (a: KeyChord, b: KeyChord): boolean =>
  (a.code && b.code ? a.code === b.code : a.key === b.key) &&
  a.mod === b.mod &&
  a.shift === b.shift &&
  !!a.alt === !!b.alt &&
  !!a.other === !!b.other;

/** Whether this browser runs on a Mac (the command modifier is ⌘). */
export const isMac = (nav: Pick<Navigator, 'platform' | 'userAgent'> = navigator): boolean =>
  /Mac|iPhone|iPad/.test(nav.platform || nav.userAgent);
