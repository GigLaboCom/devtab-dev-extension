/**
 * public/route-boot.js (a plain script, run before the first paint) must open the same route as the NewTabPage seam
 * for every cached choice — and act only on a new tab as it opens: never on an address with a route or a query, a
 * reload or a step back, or in a build that is not the New Tab page.
 */
import { NEW_TAB_PAGES } from './behaviors';
import { START_HASH } from './newTabPage';
import { START_CACHE_KEY, normalizeRecent, normalizeSettings } from './settings';
import bootSource from '../../public/route-boot.js?raw';
import { browserNewTab } from '@src/newTab/browserNewTab';
import { overridesOf } from '@src/newTab/override';
import { ownNewTab } from '@src/newTab/ownNewTab';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { NewTabOverride } from '@src/newTab/override';

const LAST = { settings: { newTab: 'last' }, recent: { last: '#/tools/json', used: [] } };

/** The manifest the build carries for this override (manifest.config.ts derives it the same way). */
const build = (override: NewTabOverride) =>
  vi.stubGlobal('chrome', { runtime: { getManifest: () => ({ ...overridesOf(override) }) } });

const boot = (cached: unknown, address = '', navigation?: string): string => {
  window.history.replaceState(null, '', `/src/app/index.html${address}`);
  window.localStorage.setItem(START_CACHE_KEY, JSON.stringify(cached));
  const entries = vi
    .spyOn(window.performance, 'getEntriesByType')
    .mockReturnValue(navigation ? [{ type: navigation } as unknown as PerformanceEntry] : []);
  new Function(bootSource)();
  entries.mockRestore();
  return window.location.hash;
};

const seam = (cached: unknown): string => {
  const source = (cached ?? {}) as { settings?: unknown; recent?: unknown };
  return NEW_TAB_PAGES[normalizeSettings(source.settings).newTab].initialHash(normalizeRecent(source.recent));
};

beforeEach(() => build(ownNewTab));
afterEach(() => {
  window.localStorage.clear();
  vi.unstubAllGlobals();
});

describe('route-boot.js', () => {
  const cases: unknown[] = [
    null,
    {},
    { settings: { newTab: 'start' }, recent: { last: '#/tools/json', used: [] } },
    LAST,
    { settings: { newTab: 'last' }, recent: { last: '#/compare', used: [] } },
    { settings: { newTab: 'last' }, recent: { last: null, used: [] } },
    { settings: { newTab: 'last' }, recent: { last: '#/settings', used: [] } },
    { settings: { newTab: 'last' }, recent: { last: 'javascript:alert(1)', used: [] } },
    { settings: { newTab: 'last' } },
  ];
  it.each(cases)('agrees with the NewTabPage seam for %j', cached => {
    expect(boot(cached, '', 'navigate') || START_HASH).toBe(seam(cached));
  });

  it('leaves a page with a route alone', () => {
    expect(boot(LAST, '#/settings')).toBe('#/settings');
    expect(boot(LAST, '#/start')).toBe('#/start');
    expect(boot(LAST, '#/compare')).toBe('#/compare');
  });

  it('leaves a page whose address carries a query alone (the options page, a page asked for without a frame)', () => {
    expect(boot(LAST, '?options')).toBe('');
    expect(boot(LAST, '?bare')).toBe('');
  });

  it('leaves a reload and a step back or forward alone: the page stays what the user saw', () => {
    expect(boot(LAST, '', 'reload')).toBe('');
    expect(boot(LAST, '', 'back_forward')).toBe('');
    expect(boot(LAST, '', 'navigate')).toBe('#/tools/json');
  });

  it('marks an address that asks for no frame on <html> before the page has content, and only that one', () => {
    delete document.documentElement.dataset.frame;
    boot(null, '?options');
    expect(document.documentElement.dataset.frame).toBeUndefined();
    boot(null, '?options&bare#/settings');
    expect(document.documentElement.dataset.frame).toBe('bare');
    delete document.documentElement.dataset.frame;
    boot(null, '?barely#/settings');
    expect(document.documentElement.dataset.frame).toBeUndefined();
  });

  it('does nothing in a build that is not the New Tab page', () => {
    build(browserNewTab);
    expect(boot(LAST, '', 'navigate')).toBe('');
  });

  it('survives a broken copy, and a page without chrome', () => {
    window.history.replaceState(null, '', '/src/app/index.html');
    window.localStorage.setItem(START_CACHE_KEY, '{not json');
    new Function(bootSource)();
    expect(window.location.hash).toBe('');
    vi.unstubAllGlobals();
    expect(boot(LAST, '', 'navigate')).toBe('');
  });
});
