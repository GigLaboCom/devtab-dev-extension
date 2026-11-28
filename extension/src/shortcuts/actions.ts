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
 *
 * Besides the places there are the commands of a section (`command`: a new scratch file, the open scratch's download,
 * rename, language and delete, the Projects section's panels, quick open and changes — D38): such an action has a
 * target only while a part of the page offers it (the shell's `ShortcutTargets`, shortcuts/targets.ts) — a project
 * open, a scratch open, an edition with scratch files; the indent indicator of an open editor (D39); Commit while the
 * keyboard is in an open project's Commit view, Undo last commit while it is offered, Add project on the list of projects. Without one the action does not take its key: the key goes on to
 * the page, and the editor is not asked to hand it up. Why each default: docs/research/hotkeys.md §9.
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
  /** Whether a part of the page offers this command of a section now (`ShortcutAction.command`). */
  offers(id: string): boolean;
  /** Runs a command of a section on the part that offers it; false when none does. */
  command(id: string): boolean;
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
  /**
   * A command of a section rather than a place: it acts only while a part of the page offers it
   * (`context.offers(id)`), and takes its key only then. The palette lists it while it is offered.
   */
  command?: boolean;
  /** More words the palette finds a command by. */
  keywords?: readonly string[];
  run(context: ShortcutContext): void;
}

/** Whether the action has something to act on now: a place always; a command while a part of the page offers it. */
export const isAvailable = (action: Pick<ShortcutAction, 'id' | 'command'>, context: ShortcutContext): boolean =>
  !action.command || context.offers(action.id);

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
/** With the command modifier, without Shift. */
const plain = (code: string, key: string): KeyChord => ({ key, code, mod: true, shift: false });

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
  // L — the list of projects (and back to it from a project or a scratch). Ctrl+Shift+P is Chrome's printing through
  // the system dialog on Windows and Linux, so P is not one family on both; ⇧⌘L is a macOS service, hence ⌥ there.
  projects: { mac: shifted('KeyL', 'l', true), other: shifted('KeyL', 'l') },
};

/** The commands of a section (D38), in the order the options list them. */
interface CommandDefinition {
  id: string;
  title: string;
  group: string;
  keywords: readonly string[];
}

export const SCRATCH_GROUP = 'Scratch files';
export const PROJECTS_GROUP = 'Projects';
export const EDITOR_GROUP = 'Editor';

export const COMMANDS: readonly CommandDefinition[] = [
  { id: 'scratch:new', title: 'New scratch file', group: SCRATCH_GROUP, keywords: ['scratch', 'new file', 'note'] },
  { id: 'scratch:download', title: 'Download scratch', group: SCRATCH_GROUP, keywords: ['save as', 'export'] },
  { id: 'scratch:rename', title: 'Rename scratch', group: SCRATCH_GROUP, keywords: ['name', 'file name'] },
  { id: 'scratch:language', title: 'Change scratch language', group: SCRATCH_GROUP, keywords: ['highlighting'] },
  { id: 'scratch:delete', title: 'Delete scratch', group: SCRATCH_GROUP, keywords: ['remove'] },
  { id: 'projects:files', title: 'Files panel', group: PROJECTS_GROUP, keywords: ['tree', 'explorer', 'project'] },
  { id: 'projects:commit', title: 'Commit panel', group: PROJECTS_GROUP, keywords: ['changes', 'git', 'stage'] },
  { id: 'projects:history', title: 'History panel', group: PROJECTS_GROUP, keywords: ['local history', 'git log'] },
  { id: 'projects:find', title: 'Find in files', group: PROJECTS_GROUP, keywords: ['search', 'grep'] },
  { id: 'projects:go-to-file', title: 'Go to file', group: PROJECTS_GROUP, keywords: ['quick open', 'open file'] },
  { id: 'projects:next-change', title: 'Next change', group: PROJECTS_GROUP, keywords: ['diff', 'hunk'] },
  { id: 'projects:previous-change', title: 'Previous change', group: PROJECTS_GROUP, keywords: ['diff', 'hunk'] },
  { id: 'projects:view', title: 'Switch file and diff', group: PROJECTS_GROUP, keywords: ['diff', 'mode'] },
  // Stages 4–6 of the companion: what a person does often enough to want a key for it.
  { id: 'projects:commit-checked', title: 'Commit', group: PROJECTS_GROUP, keywords: ['git', 'commit checked'] },
  {
    id: 'projects:undo-commit',
    title: 'Undo last commit',
    group: PROJECTS_GROUP,
    keywords: ['git', 'reset', 'revert'],
  },
  {
    id: 'projects:add-project',
    title: 'Add project',
    group: PROJECTS_GROUP,
    keywords: ['repository', 'folder', 'open'],
  },
  // D39: the indent indicator of the editor that has the keyboard (or was used last); no default key — neither IDE
  // has one for its indicator.
  {
    id: 'editor:indentation',
    title: 'Indentation of this file',
    group: EDITOR_GROUP,
    keywords: ['indent', 'tabs', 'spaces', 'tab size'],
  },
];

/**
 * The commands' defaults (docs/research/hotkeys.md §9): the IDEs' key where Chrome and the system leave it to the
 * page; otherwise on a Mac that key with ⌥ added, as History has (⌥⇧⌘), and on Windows and Linux Ctrl+Shift with
 * the same key where it is free — never Ctrl+Alt there (AltGr). None where neither IDE has a key or nothing near is
 * free: the action is listed in the options and the palette, and the person records one.
 */
export const COMMAND_DEFAULTS: Readonly<Record<string, DefaultKey>> = {
  // ⇧⌘N (IntelliJ) is Chrome's incognito window; IntelliJ's Ctrl+Alt+Shift+Insert without Alt elsewhere.
  'scratch:new': { mac: shifted('KeyN', 'n', true), other: shifted('Insert', 'insert') },
  // "Save as": ⇧⌘S and Ctrl+Shift+S are «Compare code»'s own.
  'scratch:download': { mac: shifted('KeyS', 's', true), other: null },
  // ⇧F6 (IntelliJ) has no command modifier; ⇧⌘R / Ctrl+Shift+R reload.
  'scratch:rename': { mac: shifted('KeyR', 'r', true), other: shifted('F6', 'f6') },
  // ⇧⌘⌫ is Chrome's "Clear browsing data" on a Mac, Ctrl+Shift+Delete elsewhere.
  'scratch:delete': { mac: shifted('Backspace', 'backspace', true), other: shifted('Backspace', 'backspace') },
  // IntelliJ's tool windows ⌘1 / Alt+1, ⌘9 / Alt+9 with ⇧ (⌘1–⌘9 are the tab numbers); Commit (⌘0 / Alt+0) is 2,
  // the side panel's second view: Ctrl+Shift+0 is the keyboard-layout switch of Windows.
  'projects:files': shifted('Digit1', '1'),
  'projects:commit': shifted('Digit2', '2'),
  'projects:history': shifted('Digit9', '9'),
  // ⇧⌘F is Chrome's full-screen toolbar on a Mac; Ctrl+Shift+F is the IDEs' own key elsewhere.
  'projects:find': { mac: shifted('KeyF', 'f', true), other: shifted('KeyF', 'f') },
  // ⇧⌘O (IntelliJ) is Chrome's bookmark manager; Ctrl+Shift+N (IntelliJ) and Ctrl+P (VS Code) are Chrome's.
  'projects:go-to-file': { mac: shifted('KeyO', 'o', true), other: shifted('KeyY', 'y') },
  // IntelliJ's ⌃⌥⇧↓ with ⌘ for ⌃ on a Mac; elsewhere its Ctrl+Alt+Shift+↓ has Ctrl+Alt, Ctrl+Shift+↓ selects text,
  // so the diff viewers' F7 / ⇧F7 with Ctrl.
  'projects:next-change': { mac: shifted('ArrowDown', 'arrowdown', true), other: plain('F7', 'f7') },
  'projects:previous-change': { mac: shifted('ArrowUp', 'arrowup', true), other: shifted('F7', 'f7') },
  // IntelliJ's ⌘D (show diff); ⇧⌘D and Ctrl+Shift+D bookmark all tabs.
  'projects:view': { mac: shifted('KeyD', 'd', true), other: null },
  // IntelliJ's Commit in its commit window, ⌘Enter / Ctrl+Enter (VS Code's too, in the message box): free in Chrome and
  // in the editor, and offered only while the keyboard is in the Commit view. Undo last commit and Add project have no
  // key in either IDE: none here.
  'projects:commit-checked': { key: 'enter', code: 'Enter', mod: true, shift: false },
};

export const shortcutActions = (
  destinations: readonly Destination[],
  /** The keys tools suggest, by tool id (`ToolDescription.shortcut`). */
  suggested: Readonly<Record<string, DefaultKey | undefined>> = {},
  defaults: Readonly<Record<string, DefaultKey>> = PLACE_DEFAULTS,
  commandDefaults: Readonly<Record<string, DefaultKey>> = COMMAND_DEFAULTS,
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
    ...COMMANDS.map(c => ({
      ...c,
      command: true,
      defaultKey: commandDefaults[c.id] ?? null,
      run: (context: ShortcutContext) => void context.command(c.id),
    })),
  ];
};

/** The keys the tools suggest, by tool id, from their definitions. */
export const suggestedKeys = (
  tools: ReadonlyArray<{ id: string; shortcut?: DefaultKey }>,
): Record<string, DefaultKey | undefined> => Object.fromEntries(tools.map(t => [t.id, t.shortcut]));
