/**
 * The person's shortcuts: the `ShortcutAction` contract every action passes — its default valid on macOS and on
 * Windows / Linux —, defaults that meet reported, the three stored states and a later version's defaults, the pure
 * rules (portable chords, what is refused, conflicts, matching in and out of text fields), the storage subscription
 * across two pages, and the listener's dispatch.
 */
import { PLACE_DEFAULTS, defaultFor, shortcutActions, suggestedKeys } from './actions';
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
import { SHORTCUT_KEYS_KEY, saveShortcuts, watchShortcuts } from './store';
import { compareActions } from '@src/compare/actions';
import { DESTINATIONS } from '@src/shared/destinations';
import { FIND_SHORTCUT, chordOf } from '@src/shared/keys';
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
const context = () => ({ go: vi.fn(), find: vi.fn() });
const PLATFORMS = [
  ['macOS', true],
  ['Windows / Linux', false],
] as const;

describe.each(ACTIONS.map(a => [a.id, a] as const))('ShortcutAction contract: %s', (_id, action: ShortcutAction) => {
  it('has a stable id, a title and a group, and runs through the page’s context alone', () => {
    expect(action.id).toMatch(/^[a-z][a-z0-9:/-]*$/);
    expect(action.title.trim()).not.toBe('');
    expect(action.group.trim()).not.toBe('');
    const ctx = context();
    action.run(ctx);
    expect(ctx.go.mock.calls.length + ctx.find.mock.calls.length).toBe(1);
    for (const [hash] of ctx.go.mock.calls) expect(hash).toMatch(/^#\//);
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
    const withDefault = ACTIONS.filter(a => a.defaultKey).map(a => a.id);
    expect(withDefault).toEqual(['find', 'start', 'open:compare', 'open:tools', 'open:history', 'open:settings']);
    expect(ACTIONS.find(a => a.id === 'find')!.defaultKey).toEqual(FIND_SHORTCUT);
    expect(Object.keys(PLACE_DEFAULTS).sort()).toEqual(['compare', 'history', 'settings', 'start', 'tools']);
    // History differs on a Mac (⇧⌘H is Chrome's Home there).
    const history = ACTIONS.find(a => a.id === 'open:history')!;
    expect([defaultFor(history, true)?.alt, defaultFor(history, false)?.alt]).toEqual([true, undefined]);
  });

  it('a tool’s suggested key comes from its definition; two tools suggesting one key: the earlier keeps it, reported', () => {
    const key: DefaultKey = k('KeyY', { mod: true, shift: true });
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
    const withAlt = bindingsOf(ACTIONS, withKey(DEFAULT_SHORTCUTS, 'open:review', k('KeyR', { alt: true })), true);
    expect(actionFor(k('KeyR', { alt: true }), withAlt, ACTIONS, false)?.id).toBe('open:review');
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
