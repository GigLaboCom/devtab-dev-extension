/**
 * The person's shortcuts as pure logic: what is stored, which chord each action has now and where it came from, which
 * chords may not be taken and why, which action a pressed chord runs. No storage, no DOM (store.ts keeps them;
 * dispatch.ts listens).
 *
 * Stored (version 2) per action, only what the person did — three states, distinct:
 *   - never set   — the action is not named: it has its default (actions.ts), if the default is free;
 *   - their own   — a chord they recorded: it holds over every default, now and in later versions;
 *   - cleared     — `null`: no key, and it stays so even when a later version gives the action a default.
 * "Reset" removes the entry (never set again). A chord is stored in the portable form of shared/keys.ts — `mod` is the
 * platform's command modifier and the key is the physical key — so ⌘⇧1 recorded on a Mac is Ctrl+Shift+1 elsewhere.
 * Version 1 (2026-11-21, the first build) had the same three values but cleared an action without a default by removing
 * its entry, so "cleared" and "never set" could not be told apart for those; it migrates as it is (`migrateShortcuts`).
 *
 * Who holds a chord (`resolveBindings`): first the person's own chords, in the actions' order; then each default in
 * the actions' order (the registry's), if no one holds its chord yet — a default that meets the person's key or an
 * earlier default starts unbound, and the options say so (`blocked`).
 *
 * Refused (docs/research/hotkeys.md):
 *   - a chord without ⌘ / Ctrl or ⌥ / Alt: a plain or Shift-only key types into fields;
 *   - ⌃ on a Mac, the Windows / Super key elsewhere: no counterpart on the other platforms;
 *   - what Chrome keeps for itself and never hands to a page (new tab or window, close, reopen, switch tabs, quit);
 *   - what the browser, the system or the editor needs on our pages — editing keys, find, print, reload, zoom, back and
 *     forward, the tab numbers, devtools, Chrome's own menu keys and the system's on that platform — a page could take
 *     some of them, but a shortcut that breaks ⌘C or Chrome's History is a trap.
 * A chord another action has, or a fixed shortcut of a page has («Compare code»'s ⌘S), is a conflict, said at once.
 */
import { defaultFor } from './actions';
import { sameChord } from '@src/shared/keys';
import type { ShortcutAction } from './actions';
import type { KeyChord } from '@src/shared/keys';

export interface ShortcutSettings {
  version: 2;
  /** By action id: the chord the person set, or null when they cleared it; not named: never set. */
  keys: Record<string, KeyChord | null>;
}

export const SHORTCUTS_VERSION = 2;

export const DEFAULT_SHORTCUTS: ShortcutSettings = { version: 2, keys: {} };

/** The chord each action has now (actions without one are absent). */
export type Bindings = ReadonlyMap<string, KeyChord>;

const isRecord = (raw: unknown): raw is Record<string, unknown> => !!raw && typeof raw === 'object';

/** A stored chord in the portable form, or null when it is not one. */
export const normalizeChord = (raw: unknown): KeyChord | null => {
  if (!isRecord(raw) || typeof raw.key !== 'string' || typeof raw.mod !== 'boolean' || typeof raw.shift !== 'boolean')
    return null;
  if (raw.code !== undefined && typeof raw.code !== 'string') return null;
  return {
    key: raw.key.toLowerCase(),
    ...(typeof raw.code === 'string' && raw.code ? { code: raw.code } : {}),
    mod: raw.mod,
    shift: raw.shift,
    ...(raw.alt === true ? { alt: true } : {}),
  };
};

/** Version 1 → 2: the values mean the same; what version 1 removed on "clear" is "never set" here (see above). */
export const migrateShortcuts = (raw: Record<string, unknown>): Record<string, unknown> =>
  raw.version === SHORTCUTS_VERSION ? raw : { ...raw, version: SHORTCUTS_VERSION };

export const normalizeShortcuts = (raw: unknown): ShortcutSettings => {
  const source = migrateShortcuts(isRecord(raw) ? raw : {});
  const keys = isRecord(source.keys) ? source.keys : {};
  return {
    version: 2,
    keys: Object.fromEntries(
      Object.entries(keys)
        .filter(([id]) => /^[a-z][a-z0-9:/-]*$/.test(id))
        .flatMap(([id, value]): Array<[string, KeyChord | null]> => {
          if (value === null) return [[id, null]];
          const chord = normalizeChord(value);
          return chord ? [[id, chord]] : [];
        }),
    ),
  };
};

export type Origin = 'own' | 'default';

export interface Resolved {
  bindings: Bindings;
  /** Where each bound chord came from. */
  origin: ReadonlyMap<string, Origin>;
  /** Actions whose default was not given: the chord, and the action that holds it. */
  blocked: ReadonlyMap<string, { chord: KeyChord; by: string }>;
}

export const resolveBindings = (
  actions: readonly ShortcutAction[],
  settings: ShortcutSettings,
  mac: boolean,
): Resolved => {
  const bindings = new Map<string, KeyChord>();
  const origin = new Map<string, Origin>();
  const blocked = new Map<string, { chord: KeyChord; by: string }>();
  const holder = (chord: KeyChord): string | undefined => [...bindings].find(([, c]) => sameChord(c, chord))?.[0];
  for (const action of actions) {
    const own = settings.keys[action.id];
    if (!own || holder(own)) continue;
    bindings.set(action.id, own);
    origin.set(action.id, 'own');
  }
  for (const action of actions) {
    if (action.id in settings.keys) continue;
    const chord = defaultFor(action, mac);
    if (!chord) continue;
    const by = holder(chord);
    if (by) blocked.set(action.id, { chord, by });
    else {
      bindings.set(action.id, chord);
      origin.set(action.id, 'default');
    }
  }
  // The map in the actions' order, whoever came first.
  const ordered = new Map(actions.flatMap(a => (bindings.has(a.id) ? [[a.id, bindings.get(a.id)!] as const] : [])));
  return { bindings: ordered, origin, blocked };
};

export const bindingsOf = (actions: readonly ShortcutAction[], settings: ShortcutSettings, mac: boolean): Bindings =>
  resolveBindings(actions, settings, mac).bindings;

/** The settings with one action's chord set, cleared (null), or back to never set — its default (undefined). */
export const withKey = (
  settings: ShortcutSettings,
  id: string,
  chord: KeyChord | null | undefined,
): ShortcutSettings => {
  const keys = { ...settings.keys };
  if (chord === undefined) delete keys[id];
  else keys[id] = chord;
  return { ...settings, keys };
};

const chord = (code: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  key: code.replace(/^(?:Key|Digit)/, '').toLowerCase(),
  code,
  mod: true,
  shift: false,
  ...mods,
});
const digits = Array.from({ length: 10 }, (_, i) => `Digit${i}`);
const letters = (codes: string, mods: Partial<KeyChord> = {}): KeyChord[] =>
  codes.split(' ').map(c => chord(c.length === 1 ? `Key${c}` : c, mods));

/**
 * What Chrome keeps for itself: it acts on these before a page sees them (Chromium,
 * `BrowserCommandController::IsReservedCommandOrKey`: new tab, new window, new incognito window, close tab, close
 * window, reopen a closed tab, next and previous tab; and quit). The macOS and the Windows / Linux keys alike, in the
 * portable form.
 */
export const CHROME_KEEPS: readonly KeyChord[] = [
  ...letters('T N W Q'),
  ...letters('N W T Q', { shift: true }),
  chord('Tab'),
  chord('Tab', { shift: true }),
  chord('PageUp'),
  chord('PageDown'),
  chord('BracketLeft', { shift: true }),
  chord('BracketRight', { shift: true }),
  chord('ArrowLeft', { alt: true }),
  chord('ArrowRight', { alt: true }),
  chord('F4'),
];

/** What the browser, the editor and the system need on our pages, on every platform; a page could take some. */
const NEEDED: readonly KeyChord[] = [
  // editing (fields and the editor), find, print, reload, bookmark, the address bar
  ...letters('L F G P R D A C V X Z Y'),
  ...letters('R Z G V', { shift: true }),
  // devtools and view source
  ...letters('I J C U', { alt: true }),
  // Chrome's menus: bookmarks bar and manager, bookmark all tabs, tab search, profiles, clear browsing data
  ...letters('B O D A M Delete', { shift: true }),
  chord('KeyB', { alt: true }),
  // tab numbers, zoom, back and forward, the editor's comment and moves
  ...digits.map(c => chord(c)),
  ...['Equal', 'Minus', 'BracketLeft', 'BracketRight', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Slash'].map(
    c => chord(c),
  ),
];

/** On a Mac only: Chrome's History, Downloads, Home, settings, open file, full-screen toolbar; the system's. */
const NEEDED_MAC: readonly KeyChord[] = [
  ...letters('Y E O H M Comma'),
  ...letters('J H F L Y Slash Digit3 Digit4 Digit5 Digit6', { shift: true }),
  chord('KeyL', { alt: true }),
  chord('KeyH', { alt: true }),
  chord('Space'),
];

/**
 * On Windows and Linux only: Chrome's History, Downloads, view source, search box (Ctrl+E; Ctrl+K is the palette's,
 * taken on purpose), open file; IBus Unicode entry.
 */
const NEEDED_OTHER: readonly KeyChord[] = [...letters('H J U E O'), chord('KeyU', { shift: true })];

/** What the browser, the system and the editor need on this platform. */
export const browserNeeds = (mac: boolean): readonly KeyChord[] => [...NEEDED, ...(mac ? NEEDED_MAC : NEEDED_OTHER)];

export type Refusal =
  | { kind: 'no-modifier' }
  | { kind: 'other-modifier' }
  | { kind: 'chrome' }
  | { kind: 'browser' }
  | { kind: 'conflict'; with: string };

/** Why a chord may not be bound to `id` on this platform, or null when it may. `fixed`: the pages' own shortcuts. */
export const refusalOf = (
  candidate: KeyChord,
  id: string,
  context: {
    actions: readonly ShortcutAction[];
    bindings: Bindings;
    fixed?: ReadonlyArray<{ chord: KeyChord; title: string }>;
    mac: boolean;
  },
): Refusal | null => {
  if (candidate.other) return { kind: 'other-modifier' };
  if (!candidate.mod && !candidate.alt) return { kind: 'no-modifier' };
  if (CHROME_KEEPS.some(c => sameChord(c, candidate))) return { kind: 'chrome' };
  if (browserNeeds(context.mac).some(c => sameChord(c, candidate))) return { kind: 'browser' };
  for (const [other, bound] of context.bindings)
    if (other !== id && sameChord(bound, candidate))
      return { kind: 'conflict', with: context.actions.find(a => a.id === other)?.title ?? other };
  const page = context.fixed?.find(f => sameChord(f.chord, candidate));
  return page ? { kind: 'conflict', with: page.title } : null;
};

/**
 * Defaults that meet on this platform: [the action that keeps the chord, the one that starts unbound], in the actions'
 * order. The test of the definitions reports every pair; `resolveBindings` settles them the same way.
 */
export const defaultCollisions = (actions: readonly ShortcutAction[], mac: boolean): Array<[string, string]> => {
  const out: Array<[string, string]> = [];
  actions.forEach((a, i) => {
    const mine = defaultFor(a, mac);
    if (!mine) return;
    const earlier = actions.slice(0, i).find(b => {
      const theirs = defaultFor(b, mac);
      return theirs && sameChord(theirs, mine);
    });
    if (earlier) out.push([earlier.id, a.id]);
  });
  return out;
};

/**
 * The action a pressed chord runs, or undefined. In a text field (`typing`) only a chord with ⌘ / Ctrl counts: ⌥ with a
 * letter types a character there on a Mac.
 */
export const actionFor = (
  pressed: KeyChord,
  bindings: Bindings,
  actions: readonly ShortcutAction[],
  typing: boolean,
): ShortcutAction | undefined => {
  if (pressed.other || (typing && !pressed.mod)) return undefined;
  for (const [id, bound] of bindings) if (sameChord(bound, pressed)) return actions.find(a => a.id === id);
  return undefined;
};
