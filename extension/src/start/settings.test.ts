import {
  DEFAULT_SETTINGS,
  migrateSettings,
  MAX_RECENT,
  normalizeRecent,
  normalizeSettings,
  normalizeShortcuts,
  normalizeUrl,
  visit,
} from './settings';
import { describe, expect, it } from 'vitest';

describe('start settings', () => {
  it('anything read from storage becomes valid settings: switches the user set, an order, the version', () => {
    expect(normalizeSettings(undefined)).toEqual(DEFAULT_SETTINGS);
    expect(
      normalizeSettings({
        version: 2,
        newTab: 'tool',
        parts: { tools: 'no', mostVisited: true, 'x y': true },
        order: ['tools', 3, 'tools'],
      }),
    ).toEqual({ version: 2, newTab: 'start', parts: { mostVisited: true }, order: ['tools'] });
    expect(normalizeSettings({ version: 2, newTab: 'last' }).newTab).toBe('last');
  });

  it('migrates version 1 — all switches by name, history as recentSites — keeping what the user chose', () => {
    // The five switches of the first start page, then the sixth.
    const five = {
      newTab: 'last',
      parts: { webSearch: false, shortcuts: true, tools: false, mostVisited: true, siteIcons: false },
    };
    expect(normalizeSettings(five)).toEqual({ version: 2, newTab: 'last', parts: five.parts, order: [] });
    const six = { newTab: 'start', parts: { ...five.parts, recentSites: true } };
    expect(normalizeSettings(six).parts).toEqual({ ...five.parts, recentlyOpened: true });
    expect(migrateSettings(six)).toMatchObject({ version: 2, order: [] });
    expect(normalizeSettings(normalizeSettings(six))).toEqual(normalizeSettings(six));
  });

  it('accepts websites only, and gives a bare host https://', () => {
    expect(normalizeUrl('example.com')).toBe('https://example.com/');
    expect(normalizeUrl(' http://example.com/a?b=1 ')).toBe('http://example.com/a?b=1');
    expect(normalizeUrl('localhost:3000')).toBe(null);
    expect(normalizeUrl('http://localhost:3000')).toBe('http://localhost:3000/');
    for (const bad of ['', 'two words', 'javascript:alert(1)', 'chrome://settings', 'file:///etc/hosts', 'nohost'])
      expect(normalizeUrl(bad), bad).toBe(null);
  });

  it('keeps well-formed shortcuts, drops the rest, titles a bare one by its host', () => {
    expect(
      normalizeShortcuts([
        { id: 'a', title: ' Docs ', url: 'docs.example.com' },
        { id: 'a', title: 'duplicate id', url: 'b.example.com' },
        { id: 'b', title: '', url: 'https://b.example.com/x' },
        { id: 'c', title: 'Bad', url: 'javascript:void 0' },
        'junk',
      ]),
    ).toEqual([
      { id: 'a', title: 'Docs', url: 'https://docs.example.com/' },
      { id: 'b', title: 'b.example.com', url: 'https://b.example.com/x' },
    ]);
  });

  it('remembers sections and tools only, most recent first, without repeats', () => {
    let recent = normalizeRecent(undefined);
    for (const hash of ['#/compare', '#/tools/json', '#/settings', '#/start', '#/compare'])
      recent = visit(recent, hash);
    expect(recent).toEqual({ last: '#/compare', used: ['#/compare', '#/tools/json'] });
    expect(normalizeRecent({ last: '#/settings', used: ['#/x', 7, '#/projects'] })).toEqual({
      last: null,
      used: ['#/projects'],
    });
    for (let i = 0; i < 20; i++) recent = visit(recent, i % 2 ? '#/projects' : `#/tools/t${i}`);
    expect(recent.used.length).toBeLessThanOrEqual(MAX_RECENT);
  });
});
