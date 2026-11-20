/**
 * public/theme-boot.js (a plain script, run before the first paint) must pick the same theme as resolveTheme of
 * @extension/theme for every cached choice.
 */
import bootSource from '../../../public/theme-boot.js?raw';
import { THEME_CACHE_KEY, resolveTheme, normalizePref } from '@extension/theme';
import { afterEach, describe, expect, it, vi } from 'vitest';

const boot = (cached: unknown, systemDark: boolean): string | null => {
  window.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(cached));
  vi.stubGlobal('matchMedia', () => ({ matches: systemDark }));
  new Function(bootSource)();
  return document.documentElement.getAttribute('data-theme');
};

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe('theme-boot.js', () => {
  const cases: Array<[unknown, boolean]> = [
    [null, false],
    [null, true],
    [{ mode: 'dark', light: 'solarized-light', dark: 'tokyo-night' }, false],
    [{ mode: 'light', light: 'solarized-light', dark: 'tokyo-night' }, true],
    [{ mode: 'system', light: 'hybrid-light', dark: 'hybrid-dark' }, true],
  ];
  it.each(cases)('agrees with resolveTheme for %j (system dark: %s)', (cached, systemDark) => {
    expect(boot(cached, systemDark)).toBe(resolveTheme(normalizePref(cached), systemDark).id);
  });
});
