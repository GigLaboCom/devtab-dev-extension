/**
 * Seam `ShortcutAction` — what a keyboard shortcut of our pages can be bound to, as a list of definitions, the way the
 * start page's parts and «Compare code»'s actions are. Built from the places (shared/destinations.ts), so every tool
 * gets an entry by itself, and the list names none of them: the palette ("Find a tool or section"), the start page,
 * each section, Settings, each tool. The shortcuts are the application's, handled inside our pages (D16: the owner
 * chose them over Chrome's browser-wide commands).
 *
 * Defaults are part of the definitions too: an action may carry one, the same on every platform or one per platform
 * where they must differ, and a tool may suggest one in its own definition (`ToolDescription.shortcut`; most have
 * none). A default is only a starting value — bindings.ts decides what holds when the person has keys of their own or
 * two defaults meet — and every default must pass the rules a recorded key passes, on macOS and elsewhere
 * (shortcuts.test.ts proves it for every definition). Why each key: docs/research/hotkeys.md §7.
 *
 * A definition says what runs; the page that caught the key says how (`ShortcutContext`): the shell opens its palette,
 * the start page focuses its field, both go to a route.
 */
import { FIND_SHORTCUT } from '@src/shared/keys';
import type { Destination } from '@src/shared/destinations';
import type { KeyChord } from '@src/shared/keys';

/** What the page that caught a shortcut can do. */
export interface ShortcutContext {
  /** Goes to one of our places (a route hash). */
  go(hash: string): void;
  /** The search: the shell's palette, or the start page's field. */
  find(): void;
}

/** One combination for every platform, or one per platform where they must differ (null: none there). */
export type DefaultKey = KeyChord | { mac: KeyChord | null; other: KeyChord | null };

export interface ShortcutAction {
  /** Stable: what the stored shortcuts are keyed by (`find`, `start`, `open:tools/json`). */
  id: string;
  /** What the options call it. */
  title: string;
  /** The group it is listed under in the options. */
  group: string;
  /** The key it starts with until the person changes it; null: none. */
  defaultKey: DefaultKey | null;
  run(context: ShortcutContext): void;
}

/** The action's default on this platform, or null. */
export const defaultFor = (action: Pick<ShortcutAction, 'defaultKey'>, mac: boolean): KeyChord | null => {
  const d = action.defaultKey;
  if (!d) return null;
  return 'mac' in d ? (mac ? d.mac : d.other) : d;
};

const shifted = (code: string, key: string, alt = false): KeyChord => ({
  key,
  code,
  mod: true,
  shift: true,
  ...(alt ? { alt: true } : {}),
});

/**
 * The defaults of the places a person jumps to all the time, by the place's id (`start` is the start page's action).
 * ⇧ with the command modifier keeps clear of Chrome's own ⌘ letters; each was checked against Chrome's menus and the
 * system's on both platforms (docs/research/hotkeys.md §7). History differs on a Mac: ⇧⌘H is Chrome's Home there.
 */
export const PLACE_DEFAULTS: Readonly<Record<string, DefaultKey>> = {
  start: shifted('KeyK', 'k'),
  compare: shifted('KeyE', 'e'),
  tools: shifted('KeyX', 'x'),
  history: { mac: shifted('KeyH', 'h', true), other: shifted('KeyH', 'h') },
  settings: shifted('Comma', ','),
};

export const shortcutActions = (
  destinations: readonly Destination[],
  /** The keys tools suggest, by tool id (`ToolDescription.shortcut`). */
  suggested: Readonly<Record<string, DefaultKey | undefined>> = {},
  defaults: Readonly<Record<string, DefaultKey>> = PLACE_DEFAULTS,
): readonly ShortcutAction[] => {
  const parent = (d: Destination): Destination | undefined => destinations.find(p => p.id === d.parent);
  return [
    {
      id: 'find',
      title: 'Find a tool or section',
      group: 'Search',
      defaultKey: FIND_SHORTCUT,
      run: context => context.find(),
    },
    {
      id: 'start',
      title: 'Start page',
      group: 'Go to',
      defaultKey: defaults.start ?? null,
      run: context => context.go('#/start'),
    },
    ...destinations.map(d => ({
      id: `open:${d.id}`,
      title: d.title,
      group: parent(d)?.title ?? 'Go to',
      defaultKey: defaults[d.id] ?? (d.kind === 'tool' ? suggested[d.id.replace(/^tools\//, '')] : undefined) ?? null,
      run: (context: ShortcutContext) => context.go(d.hash),
    })),
  ];
};

/** The keys the tools suggest, by tool id, from their definitions. */
export const suggestedKeys = (
  tools: ReadonlyArray<{ id: string; shortcut?: DefaultKey }>,
): Record<string, DefaultKey | undefined> => Object.fromEntries(tools.map(t => [t.id, t.shortcut]));
