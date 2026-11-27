/**
 * The person's shortcuts: the `ShortcutAction` contract every action passes — its default valid on macOS and on
 * Windows / Linux —, defaults that meet reported, the three stored states and a later version's defaults, the pure
 * rules (portable chords, what is refused, conflicts, matching in and out of text fields), the storage subscription
 * across two pages, and the listener's dispatch.
 */
import { COMMANDS, COMMAND_DEFAULTS, PLACE_DEFAULTS, defaultFor, shortcutActions, suggestedKeys } from './actions';
import {
  CHROME_KEEPS,
  DEFAULT_SHORTCUTS,
  actionFor,
  bindingsOf,
  browserNeeds,
  defaultCollisions,
  normalizeShortcuts,
  refusalOf,
  resolveBindings,
  withKey,
} from './bindings';
import { isTyping, listenShortcuts } from './dispatch';
import { ask, onAsk, take } from './intent';
import { SHORTCUT_KEYS_KEY, saveShortcuts, watchShortcuts } from './store';
import { createTargets } from './targets';
import { compareActions } from '@src/compare/actions';
import { DESTINATIONS } from '@src/shared/destinations';
import { keyLabel } from '@src/shared/keyLabels';
import { FIND_SHORTCUT, chordOf, sameChord } from '@src/shared/keys';
import { fakeStorage } from '@src/test/fakes';
import { TOOLS } from '@src/tools/registry';
import { describe, expect, it, vi } from 'vitest';
import type { DefaultKey, ShortcutAction } from './actions';
import type { KeyChord } from '@src/shared/keys';

/** The actions exactly as the shell builds them: places, their defaults, the tools' suggested keys. */
const ACTIONS = shortcutActions(DESTINATIONS, suggestedKeys(TOOLS));
const k = (code: string, mods: Partial<KeyChord> = {}): KeyChord => ({
  key: code.replace(/^(?:Key|Digit)/, '').toLowerCase(),
  code,
  mod: false,
  shift: false,
  ...mods,
});
const FIXED = compareActions.flatMap(a => (a.shortcut ? [{ chord: a.shortcut, title: a.title }] : []));
/** A page's context; `offered`: the commands a part of the page offers (by default every one). */
const context = (offered: (id: string) => boolean = () => true) => ({
  go: vi.fn(),
  find: vi.fn(),
  offers: vi.fn(offered),
  command: vi.fn((id: string) => offered(id)),
});
const PLATFORMS = [
  ['macOS', true],
  ['Windows / Linux', false],
] as const;

/**
 * The editor's own keys, as gpui binds them (crates/review-wasm/src/lib.rs adds the Mac ones; gpui-kit's input binds
 * the rest, and the module in a browser is never built for macOS, so they hold on a Mac too): in the portable form of
 * the platform. A Ctrl binding on a Mac and a Cmd binding elsewhere are the other modifier, which no shortcut uses.
 */
const EDITOR_MAC = [
  'cmd-c cmd-x cmd-a cmd-z cmd-shift-z cmd-left cmd-right cmd-up cmd-down shift-cmd-left shift-cmd-right',
  'cmd-shift-up cmd-shift-down cmd-backspace cmd-delete cmd-. cmd-f cmd-shift-f',
];
const EDITOR_ALL = [
  'alt-left alt-right alt-shift-left alt-shift-right shift-alt-up shift-alt-down alt-backspace alt-delete',
  'ctrl-backspace ctrl-delete ctrl-] ctrl-[ ctrl-alt-up ctrl-alt-down ctrl-home ctrl-end ctrl-shift-home ctrl-shift-end',
  'ctrl-shift-a ctrl-shift-e ctrl-shift-left ctrl-shift-right ctrl-a ctrl-c ctrl-x ctrl-v ctrl-e ctrl-left ctrl-right',
  'ctrl-z ctrl-y ctrl-. ctrl-f ctrl-h',
];
const CODES: Record<string, string> = {
  '.': 'Period',
  ']': 'BracketRight',
  '[': 'BracketLeft',
  left: 'ArrowLeft',
  right: 'ArrowRight',
  up: 'ArrowUp',
  down: 'ArrowDown',
  backspace: 'Backspace',
  delete: 'Delete',
  home: 'Home',
  end: 'End',
};
const editorKeys = (mac: boolean): KeyChord[] =>
  [...(mac ? EDITOR_MAC : []), ...EDITOR_ALL]
    .flatMap(line => line.split(' '))
    .flatMap(binding => {
      const parts = binding.split('-');
      const key = parts.pop()!;
      const command = mac ? 'cmd' : 'ctrl';
      if (parts.includes(mac ? 'ctrl' : 'cmd')) return [];
      const code = CODES[key] ?? `Key${key.toUpperCase()}`;
      return [
        {
          key,
          code,
          mod: parts.includes(command),
          shift: parts.includes('shift'),
          ...(parts.includes('alt') ? { alt: true } : {}),
        },
      ];
    });
/** The definitions that came with the sections' commands (D38): their defaults must leave the editor's keys alone. */
const NEW_IN_D38 = new Set([...COMMANDS.map(c => c.id), 'open:projects']);

describe.each(ACTIONS.map(a => [a.id, a] as const))('ShortcutAction contract: %s', (_id, action: ShortcutAction) => {
  it('has a stable id, a title and a group, and runs through the page’s context alone', () => {
    expect(action.id).toMatch(/^[a-z][a-z0-9:/-]*$/);
    expect(action.title.trim()).not.toBe('');
    expect(action.group.trim()).not.toBe('');
    const ctx = context();
    action.run(ctx);
    expect(ctx.go.mock.calls.length + ctx.find.mock.calls.length + ctx.command.mock.calls.length).toBe(1);
    for (const [hash] of ctx.go.mock.calls) expect(hash).toMatch(/^#\//);
    // A command of a section runs as itself, on the part that offers it; a place never asks for one.
    if (action.command) expect(ctx.command).toHaveBeenCalledWith(action.id);
    else expect(ctx.command).not.toHaveBeenCalled();
  });

  it.each(PLATFORMS)('its default, if any, is none of the editor’s own keys on %s', (_name, mac) => {
    const chord = defaultFor(action, mac);
    // Of the defaults before D38, «Compare code»'s Ctrl+Shift+E is the editor's "select to the line's end" elsewhere
    // (the page takes it first): kept as it is — moving a default would move a key people have learnt.
    if (!chord || !NEW_IN_D38.has(action.id)) return;
    expect(editorKeys(mac).filter(c => sameChord(c, chord))).toEqual([]);
  });

  it.each(PLATFORMS)('its default, if any, passes every rule a recorded key passes, on %s', (_name, mac) => {
    const chord = defaultFor(action, mac);
    if (!chord) return;
    // Against the rules and the pages' own keys; meeting another default is the next test's.
    expect(refusalOf(chord, action.id, { actions: ACTIONS, bindings: new Map(), fixed: FIXED, mac })).toBeNull();
  });
});

describe('the defaults', () => {
  it.each(PLATFORMS)('no two definitions suggest the same key on %s (each pair is reported)', (_name, mac) => {
    expect(defaultCollisions(ACTIONS, mac)).toEqual([]);
  });

  it('the places a person jumps to all the time have one; tools have none unless they suggest one', () => {
    const withDefault = ACTIONS.filter(a => a.defaultKey && !a.command).map(a => a.id);
    expect(withDefault).toEqual([
      'find',
      'start',
      'open:compare',
      'open:tools',
      'open:projects',
      'open:history',
      'open:settings',
    ]);
    expect(ACTIONS.find(a => a.id === 'find')!.defaultKey).toEqual(FIND_SHORTCUT);
    expect(Object.keys(PLACE_DEFAULTS).sort()).toEqual([
      'compare',
      'history',
      'projects',
      'settings',
      'start',
      'tools',
    ]);
    // History differs on a Mac (⇧⌘H is Chrome's Home there).
    const history = ACTIONS.find(a => a.id === 'open:history')!;
    expect([defaultFor(history, true)?.alt, defaultFor(history, false)?.alt]).toEqual([true, undefined]);
  });

  it('a tool’s suggested key comes from its definition; two tools suggesting one key: the earlier keeps it, reported', () => {
    // A key no definition has (Ctrl+Shift+Y is «Go to file»'s on Windows and Linux since D38).
    const key: DefaultKey = k('Digit7', { mod: true, shift: true });
    const tools = [
      { id: 'json', shortcut: key },
      { id: 'base64', shortcut: key },
    ];
    const actions = shortcutActions(DESTINATIONS, suggestedKeys(tools));
    expect(defaultCollisions(actions, false)).toEqual([['open:tools/json', 'open:tools/base64']]);
    const resolved = resolveBindings(actions, DEFAULT_SHORTCUTS, false);
    expect(resolved.bindings.get('open:tools/json')).toEqual(key);
    expect(resolved.bindings.has('open:tools/base64')).toBe(false);
    expect(resolved.blocked.get('open:tools/base64')).toEqual({ chord: key, by: 'open:tools/json' });
    // And a suggestion that breaks a rule fails the contract above for that tool: ⌘C is the browser's.
    const bad = shortcutActions(DESTINATIONS, { hash: k('KeyC', { mod: true }) }).find(
      a => a.id === 'open:tools/hash',
    )!;
    expect(
      refusalOf(defaultFor(bad, true)!, bad.id, { actions: ACTIONS, bindings: new Map(), fixed: FIXED, mac: true }),
    ).toEqual({ kind: 'browser' });
  });
});

describe('the three stored states, and a later version', () => {
  const settingsKey: KeyChord = { key: ',', code: 'Comma', mod: true, shift: true };

  it('never set: the default; their own: theirs; cleared: none — and reset goes back to never set', () => {
    const never = resolveBindings(ACTIONS, DEFAULT_SHORTCUTS, true);
    expect(never.bindings.get('open:settings')).toEqual(settingsKey);
    expect(never.origin.get('open:settings')).toBe('default');

    const own = resolveBindings(
      ACTIONS,
      withKey(DEFAULT_SHORTCUTS, 'open:settings', k('KeyP', { mod: true, alt: true })),
      true,
    );
    expect(own.bindings.get('open:settings')?.code).toBe('KeyP');
    expect(own.origin.get('open:settings')).toBe('own');

    const cleared = withKey(DEFAULT_SHORTCUTS, 'open:settings', null);
    expect(resolveBindings(ACTIONS, cleared, true).bindings.has('open:settings')).toBe(false);
    expect(normalizeShortcuts(JSON.parse(JSON.stringify(cleared)))).toEqual({
      version: 2,
      keys: { 'open:settings': null },
    });

    const reset = withKey(cleared, 'open:settings', undefined);
    expect(resolveBindings(ACTIONS, reset, true).origin.get('open:settings')).toBe('default');
  });

  it('a default added later does not take a key the person gave to something else, nor bring back a cleared one', () => {
    // The person's settings, made before the actions had defaults.
    const before = shortcutActions(DESTINATIONS, {}, {});
    let stored = withKey(DEFAULT_SHORTCUTS, 'open:tools/json', settingsKey); // ⇧⌘, for JSON
    stored = withKey(stored, 'open:compare', null); // cleared, when it had no default
    expect(resolveBindings(before, stored, true).bindings.get('open:tools/json')).toEqual(settingsKey);
    // The next version gives Settings ⇧⌘, and Compare code ⇧⌘E.
    const after = resolveBindings(ACTIONS, stored, true);
    expect(after.bindings.get('open:tools/json')).toEqual(settingsKey);
    expect(after.bindings.has('open:settings')).toBe(false);
    expect(after.blocked.get('open:settings')).toEqual({ chord: settingsKey, by: 'open:tools/json' });
    expect(after.bindings.has('open:compare')).toBe(false);
    expect(after.blocked.has('open:compare')).toBe(false);
  });

  it('version 1 migrates: a chord stays theirs, null stays cleared', () => {
    const v1 = {
      version: 1,
      keys: { 'open:tools/json': { key: 'u', code: 'KeyU', mod: true, shift: true }, find: null },
    };
    expect(normalizeShortcuts(v1)).toEqual({
      version: 2,
      keys: { 'open:tools/json': { key: 'u', code: 'KeyU', mod: true, shift: true }, find: null },
    });
    expect(normalizeShortcuts(undefined)).toEqual(DEFAULT_SHORTCUTS);
  });
});

describe('the rules', () => {
  const bindings = bindingsOf(
    ACTIONS,
    withKey(DEFAULT_SHORTCUTS, 'open:tools/json', k('KeyJ', { mod: true, alt: true, shift: true })),
    true,
  );
  const refuse = (chord: KeyChord, id = 'open:tools/base64', mac = true) =>
    refusalOf(chord, id, { actions: ACTIONS, bindings, fixed: FIXED, mac });

  it('a chord is portable: ⌘ on a Mac and Ctrl elsewhere are the same `mod`, the key is the physical key', () => {
    const mac = chordOf({ key: 'ß', code: 'KeyS', metaKey: true, ctrlKey: false, altKey: true, shiftKey: false }, true);
    const win = chordOf(
      { key: 's', code: 'KeyS', metaKey: false, ctrlKey: true, altKey: true, shiftKey: false },
      false,
    );
    const both = bindingsOf(ACTIONS, withKey(DEFAULT_SHORTCUTS, 'start', win), true);
    expect(actionFor(mac, both, ACTIONS, false)?.id).toBe('start');
    const azerty = chordOf({ key: 'a', code: 'KeyQ', metaKey: true, ctrlKey: false, shiftKey: false }, true);
    expect(azerty.code).toBe('KeyQ');
  });

  it('refuses a key without ⌘ / Ctrl or ⌥ / Alt, and the platform’s other modifier', () => {
    expect(refuse(k('KeyB'))).toEqual({ kind: 'no-modifier' });
    expect(refuse(k('KeyB', { shift: true }))).toEqual({ kind: 'no-modifier' });
    expect(refuse(k('KeyB', { mod: true, other: true }))).toEqual({ kind: 'other-modifier' });
    expect(refuse(k('KeyB', { alt: true }))).toBeNull();
  });

  it('refuses what Chrome keeps, and what the browser, the system or the editor needs on that platform', () => {
    for (const chord of CHROME_KEEPS) expect(refuse(chord)?.kind).toBe('chrome');
    for (const mac of [true, false])
      for (const chord of browserNeeds(mac)) expect(refuse(chord, 'x', mac)?.kind).toMatch(/chrome|browser/);
    expect(refuse(k('KeyT', { mod: true }))).toEqual({ kind: 'chrome' });
    expect(refuse(k('KeyC', { mod: true }))).toEqual({ kind: 'browser' });
    // ⇧⌘H is Chrome's Home on a Mac; Ctrl+Shift+H is free elsewhere.
    expect(refuse(k('KeyH', { mod: true, shift: true }), 'x', true)).toEqual({ kind: 'browser' });
    expect(refuse(k('KeyH', { mod: true, shift: true }), 'x', false)).toBeNull();
  });

  it('a chord another action or a page already has is a conflict, by name; its own chord is not', () => {
    expect(refuse(k('KeyJ', { mod: true, alt: true, shift: true }))).toEqual({ kind: 'conflict', with: 'JSON' });
    expect(refuse(FIND_SHORTCUT)).toEqual({ kind: 'conflict', with: 'Find a tool or section' });
    expect(refuse(k('KeyE', { mod: true, shift: true }))).toEqual({ kind: 'conflict', with: 'Compare code' });
    expect(refuse(k('KeyS', { mod: true }))).toEqual({ kind: 'conflict', with: 'Save' });
    expect(refuse(k('KeyJ', { mod: true, alt: true, shift: true }), 'open:tools/json')).toBeNull();
  });

  it('matches a pressed chord; in a text field only with ⌘ / Ctrl', () => {
    const withAlt = bindingsOf(ACTIONS, withKey(DEFAULT_SHORTCUTS, 'open:projects', k('KeyR', { alt: true })), true);
    expect(actionFor(k('KeyR', { alt: true }), withAlt, ACTIONS, false)?.id).toBe('open:projects');
    expect(actionFor(k('KeyR', { alt: true }), withAlt, ACTIONS, true)).toBeUndefined();
    expect(actionFor(FIND_SHORTCUT, withAlt, ACTIONS, true)?.id).toBe('find');
    expect(actionFor(k('KeyK', { mod: true, other: true }), withAlt, ACTIONS, false)).toBeUndefined();
  });

  it('a text field, a select or an editable element is typing', () => {
    document.body.innerHTML = '<input id="a"><div contenteditable="true"><b id="b"></b></div><button id="c"></button>';
    expect(isTyping(document.getElementById('a'))).toBe(true);
    expect(isTyping(document.getElementById('b'))).toBe(true);
    expect(isTyping(document.getElementById('c'))).toBe(false);
    document.body.innerHTML = '';
  });
});

describe('the subscription and the dispatch', () => {
  it('two pages: a shortcut saved on one is live on the other, without a reload', async () => {
    const storage = fakeStorage();
    const deps = { area: storage.area, onChanged: storage.onChanged };
    const seen: unknown[] = [];
    const stop = await watchShortcuts(deps, s => seen.push(s));
    const other = new EventTarget() as unknown as Window;
    const ctx = context();
    const page = listenShortcuts({ ...deps, win: other, mac: false }, ACTIONS, ctx);
    const tick = () => new Promise(r => setTimeout(r, 0));
    await tick();
    const chord = k('KeyJ', { mod: true, alt: true, shift: true });
    await saveShortcuts(storage.area, withKey(DEFAULT_SHORTCUTS, 'open:tools/json', chord));
    expect(storage.rows.get(SHORTCUT_KEYS_KEY)).toEqual({ version: 2, keys: { 'open:tools/json': chord } });
    expect(seen).toHaveLength(2);
    expect(page.bindings().get('open:tools/json')?.code).toBe('KeyJ');
    const press = () =>
      new KeyboardEvent('keydown', {
        key: 'J',
        code: 'KeyJ',
        ctrlKey: true,
        altKey: true,
        shiftKey: true,
        cancelable: true,
      });
    const event = press();
    other.dispatchEvent(event);
    expect(ctx.go).toHaveBeenCalledWith('#/tools/json');
    expect(event.defaultPrevented).toBe(true);
    // Cleared on the first page: the second stops taking it.
    await saveShortcuts(storage.area, withKey(DEFAULT_SHORTCUTS, 'open:tools/json', null));
    const again = press();
    other.dispatchEvent(again);
    expect(ctx.go).toHaveBeenCalledTimes(1);
    expect(again.defaultPrevented).toBe(false);
    page.stop();
    stop();
    expect(storage.listeners.size).toBe(0);
  });

  it('a default opens its place with nothing stored; the editor’s handed-up chord runs as typing', async () => {
    const storage = fakeStorage();
    const ctx = context();
    const page = listenShortcuts(
      { area: storage.area, onChanged: storage.onChanged, win: new EventTarget() as unknown as Window, mac: true },
      ACTIONS,
      ctx,
    );
    expect(page.press(FIND_SHORTCUT, true)).toBe(true);
    expect(ctx.find).toHaveBeenCalledTimes(1);
    expect(page.press(k('KeyE', { mod: true, shift: true }), true)).toBe(true);
    expect(ctx.go).toHaveBeenCalledWith('#/compare');
    expect(page.press(k('KeyM', { mod: true, alt: true }), true)).toBe(false);
    page.stop();
  });
});

describe('the commands of a section (D38)', () => {
  const commands = ACTIONS.filter(a => a.command);
  const at = (mac: boolean, id: string) =>
    defaultFor(
      ACTIONS.find(a => a.id === id)!,
      mac,
    );

  it('every command is an entry of the registry, after the places, in groups of their own', () => {
    expect(commands.map(c => c.id)).toEqual(COMMANDS.map(c => c.id));
    expect([...new Set(commands.map(c => c.group))]).toEqual(['Scratch files', 'Projects']);
    const groups = [...new Set(ACTIONS.map(a => a.group))];
    expect(groups.slice(-2)).toEqual(['Scratch files', 'Projects']);
    for (const c of commands) expect(c.keywords?.length).toBeGreaterThan(0);
    // Each default named here belongs to a command.
    expect(Object.keys(COMMAND_DEFAULTS).every(id => COMMANDS.some(c => c.id === id))).toBe(true);
  });

  it('the defaults, as the table in docs/research/hotkeys.md §9 has them', () => {
    const shown = (mac: boolean) =>
      Object.fromEntries(
        [...commands.map(c => c.id), 'open:projects'].map(id => {
          const chord = at(mac, id);
          return [id, chord ? keyLabel(chord, mac) : null];
        }),
      );
    expect(shown(true)).toEqual({
      'scratch:new': '⌥⇧⌘N',
      'scratch:download': '⌥⇧⌘S',
      'scratch:rename': '⌥⇧⌘R',
      'scratch:language': null,
      'scratch:delete': '⌥⇧⌘Backspace',
      'projects:files': '⇧⌘1',
      'projects:commit': '⇧⌘2',
      'projects:history': '⇧⌘9',
      'projects:find': '⌥⇧⌘F',
      'projects:go-to-file': '⌥⇧⌘O',
      'projects:next-change': '⌥⇧⌘↓',
      'projects:previous-change': '⌥⇧⌘↑',
      'projects:view': '⌥⇧⌘D',
      'open:projects': '⌥⇧⌘L',
    });
    expect(shown(false)).toEqual({
      'scratch:new': 'Ctrl+Shift+Insert',
      'scratch:download': null,
      'scratch:rename': 'Ctrl+Shift+F6',
      'scratch:language': null,
      'scratch:delete': 'Ctrl+Shift+Backspace',
      'projects:files': 'Ctrl+Shift+1',
      'projects:commit': 'Ctrl+Shift+2',
      'projects:history': 'Ctrl+Shift+9',
      'projects:find': 'Ctrl+Shift+F',
      'projects:go-to-file': 'Ctrl+Shift+Y',
      'projects:next-change': 'Ctrl+F7',
      'projects:previous-change': 'Ctrl+Shift+F7',
      'projects:view': null,
      'open:projects': 'Ctrl+Shift+L',
    });
  });

  it.each(PLATFORMS)('every default is free on %s: none meets another, a fixed page key or the editor’s', (_n, mac) => {
    expect(defaultCollisions(ACTIONS, mac)).toEqual([]);
    const resolved = resolveBindings(ACTIONS, DEFAULT_SHORTCUTS, mac);
    expect([...resolved.blocked]).toEqual([]);
    for (const c of commands) {
      const chord = defaultFor(c, mac);
      if (chord) expect(resolved.bindings.get(c.id)).toEqual(chord);
    }
  });

  it('with ⌘ / Ctrl in every default of a command: the editor hands them up, and a text field lets them through', () => {
    for (const mac of [true, false])
      for (const c of commands) {
        const chord = defaultFor(c, mac);
        if (chord) expect(chord.mod).toBe(true);
      }
  });

  it('a command with no target does not take its key: the event goes on, the page keeps it', () => {
    const storage = fakeStorage();
    const win = new EventTarget() as unknown as Window;
    let offered = false;
    const ctx = context(() => offered);
    const page = listenShortcuts({ area: storage.area, onChanged: storage.onChanged, win, mac: true }, ACTIONS, ctx);
    const press = () => {
      const event = new KeyboardEvent('keydown', {
        key: '1',
        code: 'Digit1',
        metaKey: true,
        shiftKey: true,
        cancelable: true,
      });
      win.dispatchEvent(event);
      return event;
    };
    const before = press();
    expect(before.defaultPrevented).toBe(false);
    expect(ctx.command).not.toHaveBeenCalled();
    expect(page.press(at(true, 'projects:files')!, true)).toBe(false);
    offered = true;
    const after = press();
    expect(after.defaultPrevented).toBe(true);
    expect(ctx.command).toHaveBeenCalledWith('projects:files');
    page.stop();
  });

  it('the latest part to offer a command runs it; taken back, the earlier one does; none: false', () => {
    const targets = createTargets();
    const heard = vi.fn();
    const unwatch = targets.watch(heard);
    const shell = vi.fn();
    const section = vi.fn();
    expect(targets.run('scratch:new')).toBe(false);
    const undoShell = targets.offer({ 'scratch:new': shell });
    const undoSection = targets.offer({ 'scratch:new': section, 'projects:files': section });
    expect(targets.run('scratch:new')).toBe(true);
    expect(section).toHaveBeenCalledTimes(1);
    undoSection();
    undoSection();
    expect(targets.offers('projects:files')).toBe(false);
    targets.run('scratch:new');
    expect(shell).toHaveBeenCalledTimes(1);
    undoShell();
    expect(targets.offers('scratch:new')).toBe(false);
    expect(heard).toHaveBeenCalledTimes(4);
    unwatch();
  });

  it('an intent asked for on one page is taken once by the part that carries it out, now or on arrival', () => {
    ask('scratch:new');
    expect(take('projects:files')).toBe(false);
    expect(take('scratch:new')).toBe(true);
    expect(take('scratch:new')).toBe(false);
    const heard = vi.fn((id: string) => take(id));
    const undo = onAsk(heard);
    ask('scratch:new');
    expect(heard).toHaveBeenCalledWith('scratch:new');
    expect(take('scratch:new')).toBe(false);
    undo();
  });

  it('a person’s stored keys survive: theirs holds over a new default, which then starts unbound and says who has it', () => {
    // Recorded before D38: ⇧⌘1 for JSON, ⌥⇧⌘N for Base64, and Settings cleared — in the stored format of version 1.
    const files: KeyChord = { key: '1', code: 'Digit1', mod: true, shift: true };
    const scratch: KeyChord = { key: 'n', code: 'KeyN', mod: true, shift: true, alt: true };
    const stored = normalizeShortcuts({
      version: 1,
      keys: { 'open:tools/json': files, 'open:tools/base64': scratch, 'open:settings': null },
    });
    const now = resolveBindings(ACTIONS, stored, true);
    expect(now.bindings.get('open:tools/json')).toEqual(files);
    expect(now.bindings.get('open:tools/base64')).toEqual(scratch);
    expect(now.bindings.has('open:settings')).toBe(false);
    expect(now.bindings.has('projects:files')).toBe(false);
    expect(now.blocked.get('projects:files')).toEqual({ chord: at(true, 'projects:files'), by: 'open:tools/json' });
    expect(now.blocked.get('scratch:new')?.by).toBe('open:tools/base64');
    // The rest of the new defaults are given.
    expect(now.bindings.get('projects:commit')?.code).toBe('Digit2');
    // A command's own key, cleared or re-recorded, is stored by its id like any other.
    const mine = withKey(withKey(stored, 'scratch:new', k('KeyM', { mod: true, alt: true })), 'projects:view', null);
    expect(normalizeShortcuts(JSON.parse(JSON.stringify(mine))).keys).toMatchObject({
      'scratch:new': { code: 'KeyM', mod: true, alt: true },
      'projects:view': null,
    });
  });
});
