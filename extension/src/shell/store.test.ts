import { DEFAULT_SHELL, SHELL_CACHE_KEY, SHELL_KEY, normalizeShell, withGroup } from './settings';
import { initialShell, readShellCache, saveShell, watchShell } from './store';
import { RECENT_KEY, SETTINGS_KEY, SHORTCUTS_KEY, START_CACHE_KEY } from '@src/start/settings';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => window.localStorage.clear());

describe('shell settings', () => {
  it('keep only a yes or no per group, by a place’s id', () => {
    expect(normalizeShell(undefined)).toEqual(DEFAULT_SHELL);
    expect(normalizeShell({ open: { tools: true, 'Bad id': true, history: 'yes', review: false } })).toEqual({
      version: 1,
      open: { tools: true, review: false },
      breadcrumb: true,
    });
    // The breadcrumb is on until it is turned off: settings stored before it existed have it on.
    expect(normalizeShell({ version: 1, open: {} }).breadcrumb).toBe(true);
    expect(normalizeShell({ version: 1, open: {}, breadcrumb: false }).breadcrumb).toBe(false);
    expect(withGroup(DEFAULT_SHELL, 'tools', true).open).toEqual({ tools: true });
  });

  it('live under keys of their own, beside the start page’s', () => {
    expect([SETTINGS_KEY, SHORTCUTS_KEY, RECENT_KEY]).not.toContain(SHELL_KEY);
    expect(START_CACHE_KEY).not.toBe(SHELL_CACHE_KEY);
  });
});

describe('shell store', () => {
  it('reads the stored settings and copies them to localStorage for the next first render', async () => {
    const storage = fakeStorage();
    storage.rows.set(SHELL_KEY, { open: { tools: true } });
    const seen: unknown[] = [];
    await watchShell({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    expect(seen).toEqual([{ version: 1, open: { tools: true }, breadcrumb: true }]);
    expect(readShellCache(window)).toEqual({ version: 1, open: { tools: true }, breadcrumb: true });
    expect(initialShell(window).open.tools).toBe(true);
  });

  it('follows a change from any page, and stops when asked', async () => {
    const storage = fakeStorage();
    const seen: Array<{ open: Record<string, boolean> }> = [];
    const stop = await watchShell({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    await saveShell(storage.area, withGroup(DEFAULT_SHELL, 'tools', true));
    expect(seen.at(-1)!.open).toEqual({ tools: true });
    expect(storage.rows.get(SHELL_KEY)).toEqual({ version: 1, open: { tools: true }, breadcrumb: true });
    stop();
    expect(storage.listeners.size).toBe(0);
  });

  it('does not lose a change written while the first read is in flight', async () => {
    const storage = fakeStorage();
    const seen: Array<{ open: Record<string, boolean> }> = [];
    const watching = watchShell({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    await saveShell(storage.area, withGroup(DEFAULT_SHELL, 'tools', false));
    await watching;
    expect(seen.at(-1)!.open).toEqual({ tools: false });
  });

  it('starts from the defaults without a copy, or with a broken one', () => {
    expect(initialShell(window)).toEqual(DEFAULT_SHELL);
    window.localStorage.setItem(SHELL_CACHE_KEY, '{not json');
    expect(initialShell(window)).toEqual(DEFAULT_SHELL);
  });
});
