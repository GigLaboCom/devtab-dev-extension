/**
 * Seam `StartPart`: one shared contract every part definition passes (parts/index.ts, the composition root), the
 * helpers the page, the settings and the permission bookkeeping derive from the definitions, and each part's own data
 * code.
 */
import { partDefinitions, startParts } from '.';
import { pickMostVisited } from './mostVisited.data';
import { isSearchResults, pickRecentSites } from './recentlyOpened.data';
import {
  declaredPermissions,
  moveRow,
  pageContext,
  partState,
  permissionsToRelease,
  permissionsToRequest,
  rowsInOrder,
  switchedOn,
} from '../part';
import { DEFAULT_SETTINGS, DEFAULT_STATE, SETTINGS_KEY, normalizeSettings } from '../settings';
import { saveSettings } from '../store';
import { MAX_TILES } from '../tileSources';
import { DESTINATIONS, TOOL_DESTINATIONS } from '@src/shared/destinations';
import { fakeStorage } from '@src/test/fakes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StartPart } from '../part';
import type { StartState } from '../settings';
import type { PartDeps } from './deps';

const now = Date.now();
const HISTORY: chrome.history.HistoryItem[] = [
  ['https://docs.example.com/guide/start', 'Guide — Docs', 1],
  ['https://www.google.com/search?q=kittens', 'kittens - Google Search', 2],
  ['chrome-extension://abc/src/app/index.html#/tools/json', 'JSON — DevTab.Dev', 3],
  ['https://docs.example.com/api', 'API — Docs', 4],
  ['chrome://settings/', 'Settings', 5],
  ['https://news.example.org/', '', 6],
  ['https://duckduckgo.com/?q=kittens', 'kittens at DuckDuckGo', 7],
  ['file:///tmp/notes.txt', 'notes.txt', 8],
  ['https://example.net/a-very-long-path/that/goes/on?and=on#and-on', 'A page with a long address', 9],
].map(([url, title, minutes]) => ({
  id: String(url),
  url: String(url),
  title: String(title),
  lastVisitTime: now - Number(minutes) * 60_000,
}));

/** A `chrome` with every API a part may read, each a spy. */
const fakeApi = () => ({
  runtime: { getURL: (path: string) => `chrome-extension://id${path}` },
  search: { query: vi.fn(() => Promise.resolve()) },
  topSites: {
    get: vi.fn(() =>
      Promise.resolve([
        { url: 'https://news.example.com/', title: 'News' },
        { url: 'chrome://settings/', title: 'Settings' },
        { url: 'https://empty.example.com/', title: '' },
      ]),
    ),
  },
  history: { search: vi.fn(() => Promise.resolve(HISTORY)) },
});

const immediately = (): Promise<void> => Promise.resolve();

const setup = () => {
  const storage = fakeStorage();
  const api = fakeApi();
  const deps: PartDeps = {
    chrome: api as unknown as typeof chrome,
    area: storage.area,
    destinations: DESTINATIONS,
    afterPaint: immediately,
  };
  return { storage, api, deps, parts: startParts(deps) };
};

const state: StartState = {
  ...DEFAULT_STATE,
  shortcuts: [
    { id: 'a', title: 'Docs', url: 'https://docs.example.com/' },
    { id: 'b', title: 'Mail', url: 'https://mail.example.com/' },
  ],
  recent: { last: '#/review', used: ['#/review', '#/tools/json'] },
};

afterEach(() => window.localStorage.clear());

const DEFINITIONS = partDefinitions();

describe('the composition root', () => {
  it('lists every part once, ids unique and of the stored form', () => {
    const ids = DEFINITIONS.map(p => p.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^[a-z][a-zA-Z0-9]*$/);
  });

  it('nothing a part declares optional is required by another (the manifest is derived: parts/manifest.test.ts)', () => {
    const declared = declaredPermissions(DEFINITIONS);
    expect(declared.required.filter(p => declared.optional.includes(p))).toEqual([]);
  });
});

describe.each(DEFINITIONS.map(p => [p.id, p] as const))('StartPart contract: %s', (id, definition) => {
  const live = (): { part: StartPart; storage: ReturnType<typeof fakeStorage>; api: ReturnType<typeof fakeApi> } => {
    const { parts, storage, api } = setup();
    return { part: parts.find(p => p.id === id)!, storage, api };
  };

  it('has a title and a one-line description', () => {
    expect(definition.title.trim()).not.toBe('');
    expect(definition.description.trim()).not.toBe('');
    expect(definition.description).not.toMatch(/\n/);
  });

  it('creating it touches none of what it uses when it runs', () => {
    const untouchable = new Proxy(
      {},
      { get: (_, key) => (key === 'then' ? undefined : expect.fail(`touched ${String(key)}`)) },
    );
    expect(() => startParts(untouchable as PartDeps)).not.toThrow();
  });

  it('declares its permissions with a reason; Chrome’s prompt exactly when one is optional; a required one warns not', () => {
    for (const permission of definition.permissions) {
      expect(permission.reason.trim(), permission.name).not.toBe('');
      if (!permission.optional) expect(permission.warning, permission.name).toBeNull();
    }
    const optional = definition.permissions.some(p => p.optional);
    expect(Boolean(definition.prompt?.trim())).toBe(optional);
  });

  it('is either a row (a tile source and an empty line) or an option (a contribution to the page)', () => {
    if (definition.kind === 'row') {
      expect(typeof definition.tiles.tiles).toBe('function');
      expect(definition.empty.trim()).not.toBe('');
    } else {
      expect(typeof definition.contribute).toBe('function');
    }
  });

  it('switches on and off through the stored settings, and leaves the other parts as they were', async () => {
    const storage = fakeStorage();
    const others = (s: typeof DEFAULT_SETTINGS) => DEFINITIONS.filter(p => p.id !== id).map(p => switchedOn(p, s));
    const before = others(DEFAULT_SETTINGS);
    for (const value of [!definition.defaultOn, definition.defaultOn]) {
      await saveSettings(storage.area, { ...DEFAULT_SETTINGS, parts: { [id]: value } });
      const stored = normalizeSettings(storage.rows.get(SETTINGS_KEY));
      expect(switchedOn(definition, stored)).toBe(value);
      expect(others(stored)).toEqual(before);
    }
  });

  it('stores nothing when it runs: no storage row, no localStorage, nothing logged', async () => {
    const { part, storage } = live();
    const warn = vi.spyOn(console, 'warn');
    const log = vi.spyOn(console, 'log');
    if (part.kind === 'row') await part.tiles.tiles(state);
    else part.contribute();
    expect(storage.rows.size).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
  });

  it('a row that needs a permission touches the browser only after the first paint, and reads nothing without its API', async () => {
    const { part } = live();
    if (part.kind !== 'row' || !permissionsToRequest(part).length) return;
    // A `chrome` that records what is asked of it and has none of the optional APIs (as without the permission).
    const touched: string[] = [];
    const browser = new Proxy({}, { get: (_, key) => void touched.push(String(key)) });
    let painted!: () => void;
    const gated = startParts({
      ...setup().deps,
      chrome: browser as typeof chrome,
      afterPaint: () => new Promise<void>(r => (painted = r)),
    }).find(p => p.id === id) as typeof part;
    const pending = gated.tiles.tiles(state);
    await Promise.resolve();
    expect(touched).toEqual([]);
    painted();
    expect(await pending).toEqual([]);
    expect(touched.length).toBeGreaterThan(0);
  });
});

describe('what the page and the settings derive from the parts', () => {
  const held = new Set(['topSites', 'history', 'favicon']);

  // The rows of the composition root, in its order — the tests below name no part's place in it.
  const ROWS = DEFINITIONS.filter(p => p.kind === 'row').map(p => p.id);

  it('rows in the stored order; unknown ids dropped; rows the order does not name follow in the default order', () => {
    const [first, second, ...rest] = ROWS;
    const settings = { ...DEFAULT_SETTINGS, order: [rest.at(-1)!, 'nowhere', second] };
    expect(rowsInOrder(DEFINITIONS, settings).map(r => r.id)).toEqual([
      rest.at(-1),
      second,
      first,
      ...rest.slice(0, -1),
    ]);
    expect(rowsInOrder(DEFINITIONS, DEFAULT_SETTINGS).map(r => r.id)).toEqual(ROWS);
  });

  it('a move swaps a row with its neighbour and stays inside the list', () => {
    const [first, second, ...rest] = ROWS;
    expect(moveRow(DEFINITIONS, DEFAULT_SETTINGS, second, -1)).toEqual([second, first, ...rest]);
    expect(moveRow(DEFINITIONS, DEFAULT_SETTINGS, first, -1)).toEqual(ROWS);
    expect(moveRow(DEFINITIONS, DEFAULT_SETTINGS, ROWS.at(-1)!, 1)).toEqual(ROWS);
  });

  it('a part is on, blocked (on, its permission gone) or off', () => {
    const recent = DEFINITIONS.find(p => p.id === 'recentlyOpened')!;
    const on = { ...DEFAULT_SETTINGS, parts: { recentlyOpened: true } };
    expect(partState(recent, on, held)).toBe('on');
    expect(partState(recent, on, new Set())).toBe('blocked');
    expect(partState(recent, DEFAULT_SETTINGS, held)).toBe('off');
    expect(
      partState(
        DEFINITIONS.find(p => p.id === 'tools')!,
        DEFAULT_SETTINGS,
        new Set(),
      ),
    ).toBe('on');
  });

  it('the options that are on make the page’s context; with none, the field has no web search and tiles letters', () => {
    const { parts } = setup();
    const off = { ...DEFAULT_SETTINGS, parts: { webSearch: false } };
    expect(pageContext(parts, off, new Set()).webSearch).toBeUndefined();
    expect(pageContext(parts, off, new Set()).siteIcons.src('https://a.example/')).toBeNull();
    const on = { ...DEFAULT_SETTINGS, parts: { siteIcons: true } };
    expect(pageContext(parts, on, held).webSearch).toBeDefined();
    expect(pageContext(parts, on, held).siteIcons.src('https://a.example/')).toMatch(/_favicon/);
    expect(pageContext(parts, on, new Set()).siteIcons.src('https://a.example/')).toBeNull();
  });

  it('switching a part off gives back only what no other switched-on part needs', () => {
    const sharing: StartPart[] = [
      ...DEFINITIONS,
      { ...(DEFINITIONS.find(p => p.id === 'mostVisited') as StartPart), id: 'alsoTopSites', defaultOn: false },
    ];
    const both = { ...DEFAULT_SETTINGS, parts: { mostVisited: true, alsoTopSites: true } };
    expect(permissionsToRelease(sharing, both, 'mostVisited')).toEqual([]);
    expect(permissionsToRelease(sharing, { ...both, parts: { mostVisited: true } }, 'mostVisited')).toEqual([
      'topSites',
    ]);
    expect(permissionsToRelease(DEFINITIONS, both, 'tools')).toEqual([]);
  });
});

describe('the parts’ data', () => {
  it('shortcuts: the user’s, in their order, answered without waiting (drawn in the first frame)', async () => {
    const shortcuts = setup().parts.find(p => p.id === 'shortcuts');
    if (shortcuts?.kind !== 'row') throw new Error('shortcuts is a row');
    const promise = shortcuts.tiles.tiles(state);
    expect(promise).toMatchObject({ status: 'fulfilled' });
    expect((await promise).map(t => t.title)).toEqual(['Docs', 'Mail']);
  });

  it('tools: our places, the recently used first, the registry order after', async () => {
    const tools = setup().parts.find(p => p.id === 'tools');
    if (tools?.kind !== 'row') throw new Error('tools is a row');
    // The tools after the sections come from the registry: a new tool adds a tile without editing this test.
    const others = TOOL_DESTINATIONS.map(d => d.hash).filter(h => h !== '#/tools/json');
    expect((await tools.tiles.tiles(state)).map(t => t.href)).toEqual(
      ['#/review', '#/tools/json', '#/compare', '#/history', ...others].slice(0, MAX_TILES),
    );
  });

  it('most visited: websites only, titled by host when Chrome has no title', async () => {
    const { api } = setup();
    expect(pickMostVisited(await api.topSites.get()).map(t => t.title)).toEqual(['News', 'empty.example.com']);
  });

  it('recently opened: one tile per site, newest first, titled by the page; no browser pages, ours or searches', () => {
    expect(pickRecentSites(HISTORY).map(t => [t.title, t.href])).toEqual([
      ['Guide — Docs', 'https://docs.example.com/guide/start'],
      ['news.example.org', 'https://news.example.org/'],
      ['A page with a long address', 'https://example.net/a-very-long-path/that/goes/on?and=on#and-on'],
    ]);
    expect(pickRecentSites([...HISTORY].reverse())[0].title).toBe('Guide — Docs');
    expect(pickRecentSites(HISTORY, 1)).toHaveLength(1);
  });

  it('recently opened reads the last 200 entries of all time', async () => {
    const { parts, api } = setup();
    const recent = parts.find(p => p.id === 'recentlyOpened');
    if (recent?.kind !== 'row') throw new Error('recentlyOpened is a row');
    await recent.tiles.tiles(state);
    expect(api.history.search).toHaveBeenCalledWith({ text: '', startTime: 0, maxResults: 200 });
  });

  it('search results pages are recognised by a search path or the root with a query', () => {
    for (const url of [
      'https://www.google.com/search?q=a',
      'https://www.bing.com/search?q=a',
      'https://duckduckgo.com/?q=a',
      'https://yandex.ru/search/?text=a',
      'https://www.baidu.com/s?wd=a',
      'https://search.yahoo.com/search?p=a',
      'https://www.youtube.com/results?search_query=a',
    ])
      expect(isSearchResults(new URL(url)), url).toBe(true);
    for (const url of ['https://example.com/', 'https://example.com/search', 'https://example.com/docs?q=a'])
      expect(isSearchResults(new URL(url)), url).toBe(false);
  });
});
