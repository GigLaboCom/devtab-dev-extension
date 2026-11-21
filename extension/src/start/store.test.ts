import { RECENT_KEY, SETTINGS_KEY, SHORTCUTS_KEY, START_CACHE_KEY, DEFAULT_SETTINGS } from './settings';
import { initialState, readCache, recordVisit, saveShortcuts, watchStart } from './store';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, describe, expect, it } from 'vitest';

afterEach(() => window.localStorage.clear());

describe('start store', () => {
  it('reads the stored state and copies it to localStorage for route-boot.js', async () => {
    const storage = fakeStorage();
    storage.rows.set(SETTINGS_KEY, { newTab: 'last' });
    storage.rows.set(RECENT_KEY, { last: '#/tools/json', used: ['#/tools/json'] });
    const seen: unknown[] = [];
    await watchStart({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(readCache(window)).toMatchObject({ settings: { newTab: 'last' }, recent: { last: '#/tools/json' } });
  });

  it('follows changes from any page, and keeps the copy current', async () => {
    const storage = fakeStorage();
    const seen: Array<{ shortcuts: unknown[] }> = [];
    const stop = await watchStart({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    await saveShortcuts(storage.area, [{ id: 'a', title: 'A', url: 'a.example' }]);
    expect(seen.at(-1)!.shortcuts).toEqual([{ id: 'a', title: 'A', url: 'https://a.example/' }]);
    expect(initialState(window).shortcuts).toHaveLength(1);
    stop();
    expect(storage.listeners.size).toBe(0);
  });

  it('does not lose a change written while the first read is in flight', async () => {
    const storage = fakeStorage();
    const seen: Array<{ recent: { last: string | null } }> = [];
    const watching = watchStart({ area: storage.area, onChanged: storage.onChanged, win: window }, s => seen.push(s));
    await recordVisit(storage.area, '#/compare');
    await watching;
    expect(seen.at(-1)!.recent.last).toBe('#/compare');
  });

  it('records a visit once; the start page and the settings are not visits', async () => {
    const storage = fakeStorage();
    await recordVisit(storage.area, '#/tools/json');
    await recordVisit(storage.area, '#/settings');
    expect(storage.rows.get(RECENT_KEY)).toEqual({ last: '#/tools/json', used: ['#/tools/json'] });
  });

  it('starts from the defaults without a copy, and from the copy when there is one', () => {
    expect(initialState(window).settings).toEqual(DEFAULT_SETTINGS);
    window.localStorage.setItem(START_CACHE_KEY, JSON.stringify({ settings: { parts: { tools: false } } }));
    expect(initialState(window).settings.parts.tools).toBe(false);
    expect(SHORTCUTS_KEY).not.toBe(START_CACHE_KEY);
  });
});
