import { applyTheme, loadPref, savePref, watchTheme } from './store';
import { DEFAULT_PREF, THEME_CACHE_KEY, THEME_STORAGE_KEY } from '@extension/theme';
import { fakeStorage } from '@src/test/fakes';
import { describe, expect, it } from 'vitest';
import type { ThemeWatch } from './store';

const fakeWindow = (systemDark: boolean) => {
  const media = new EventTarget() as EventTarget & { matches: boolean };
  media.matches = systemDark;
  return {
    media,
    win: { localStorage: window.localStorage, matchMedia: () => media as unknown as MediaQueryList },
  };
};

describe('theme store', () => {
  it('loads the defaults when nothing is stored, and a saved choice afterwards (with its copy for theme-boot)', async () => {
    const { area } = fakeStorage();
    expect(await loadPref(area)).toEqual(DEFAULT_PREF);
    await savePref(area, window, { ...DEFAULT_PREF, mode: 'dark' });
    expect(await loadPref(area)).toEqual({ ...DEFAULT_PREF, mode: 'dark' });
    expect(JSON.parse(window.localStorage.getItem(THEME_CACHE_KEY)!)).toMatchObject({ mode: 'dark' });
  });

  it('applies a theme as data attributes on <html>', () => {
    applyTheme(document.documentElement, {
      id: 'default-dark',
      name: 'Default Dark',
      dark: true,
      builtIn: true,
      source: 'default-theme.json',
    });
    expect(document.documentElement.dataset.theme).toBe('default-dark');
    expect(document.documentElement.dataset.mode).toBe('dark');
  });

  it('follows the user (through storage) and, in system mode, the system', async () => {
    const { area, onChanged, listeners } = fakeStorage();
    const { media, win } = fakeWindow(false);
    const seen: ThemeWatch[] = [];
    const stop = await watchTheme({ area, onChanged, win }, w => seen.push(w));
    expect(seen.at(-1)?.theme.id).toBe('default-light');

    media.matches = true;
    media.dispatchEvent(new Event('change'));
    expect(seen.at(-1)?.theme.id).toBe('default-dark');

    await area.set({ [THEME_STORAGE_KEY]: { ...DEFAULT_PREF, mode: 'light' } });
    expect(seen.at(-1)?.theme.id).toBe('default-light');
    const count = seen.length;
    media.dispatchEvent(new Event('change'));
    expect(seen.length).toBe(count);

    stop();
    expect(listeners.size).toBe(0);
  });
});
