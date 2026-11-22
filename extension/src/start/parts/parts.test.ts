/**
 * Seam `StartPart`: one shared contract every part definition and its code pass (parts/index.ts, the composition root),
 * the helpers the page, the settings and the permission bookkeeping derive from the definitions, and each part's own
 * data code.
 */
import { partDefinitions } from '.';
import { pickMostVisited } from './mostVisited.data';
import { isSearchResults, pickRecentSites } from './recentlyOpened.data';
import { PENDING } from '../../tools/recogniser';
import {
  declaredPermissions,
  moveRow,
  pageContext,
  partCode,
  partState,
  partsToLoad,
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
import type { OptionCode, PartCode, RowCode, StartPart } from '../part';
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
  return { storage, api, deps, code: partCode(deps) };
};

/** A part's code, created over `deps`. */
const codeOf = async (part: StartPart, deps: PartDeps): Promise<RowCode | OptionCode> =>
  (await (part.load() as Promise<{ create(deps: PartDeps): RowCode | OptionCode }>)).create(deps);

const rowCode = async (id: string, deps = setup().deps): Promise<RowCode> => {
  const part = DEFINITIONS.find(p => p.id === id);
  if (part?.kind !== 'row') throw new Error(`${id} is a row`);
  return (await codeOf(part, deps)) as RowCode;
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
  const live = async (): Promise<{
    code: RowCode | OptionCode;
    storage: ReturnType<typeof fakeStorage>;
    api: ReturnType<typeof fakeApi>;
  }> => {
    const { deps, storage, api } = setup();
    return { code: await codeOf(definition, deps), storage, api };
  };

  it('has a title and a one-line description', () => {
    expect(definition.title.trim()).not.toBe('');
    expect(definition.description.trim()).not.toBe('');
    expect(definition.description).not.toMatch(/\n/);
  });

  it('is data apart from its code: nothing but `load` (and a row’s `reserve`) is a function, and it has no deps', () => {
    const { load, ...rest } = definition;
    expect(typeof load).toBe('function');
    const data = definition.kind === 'row' ? { ...rest, reserve: undefined } : rest;
    expect(JSON.parse(JSON.stringify(data))).toEqual(JSON.parse(JSON.stringify(data)));
    expect(Object.values(data).filter(v => typeof v === 'function')).toEqual([]);
    expect(['start', 'idle']).toContain(definition.loadAt);
  });

  it('declares its permissions with a reason; Chrome’s prompt exactly when one is optional; a required one warns not', () => {
    for (const permission of definition.permissions) {
      expect(permission.reason.trim(), permission.name).not.toBe('');
      if (!permission.optional) expect(permission.warning, permission.name).toBeNull();
    }
    const optional = definition.permissions.some(p => p.optional);
    expect(Boolean(definition.prompt?.trim())).toBe(optional);
  });

  it('is either a row (its code: a tile source; an empty line) or an option (its code: what it says it provides)', async () => {
    const { code } = await live();
    if (definition.kind === 'row') {
      expect(typeof (code as RowCode).tiles.tiles).toBe('function');
      expect(definition.empty.trim()).not.toBe('');
      expect(definition.loadAt).toBe('start');
    } else {
      expect(Object.keys((code as OptionCode).context).sort()).toEqual([...definition.provides].sort());
      expect((code as OptionCode).context).toBe((code as OptionCode).context);
    }
  });

  it('a row that says how many tiles it will show says it right (the room the page keeps for it)', async () => {
    if (definition.kind !== 'row' || !definition.reserve) return;
    const { code } = await live();
    for (const s of [state, DEFAULT_STATE])
      expect(definition.reserve(s, DESTINATIONS)).toBe(
        (await (code as RowCode).tiles.tiles(s)).length + ((code as RowCode).editor ? 1 : 0),
      );
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
    const { code, storage } = await live();
    const warn = vi.spyOn(console, 'warn');
    const log = vi.spyOn(console, 'log');
    if ('tiles' in code) await code.tiles.tiles(state);
    else void code.context;
    expect(storage.rows.size).toBe(0);
    expect(window.localStorage.length).toBe(0);
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    warn.mockRestore();
    log.mockRestore();
  });

  it('a row that needs a permission touches the browser only after the first paint, and reads nothing without its API', async () => {
    if (definition.kind !== 'row' || !permissionsToRequest(definition).length) return;
    // A `chrome` that records what is asked of it and has none of the optional APIs (as without the permission).
    const touched: string[] = [];
    const browser = new Proxy({}, { get: (_, key) => void touched.push(String(key)) });
    let painted!: () => void;
    const gated = (await codeOf(definition, {
      ...setup().deps,
      chrome: browser as typeof chrome,
      afterPaint: () => new Promise<void>(r => (painted = r)),
    })) as RowCode;
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

  // `recognise.ready()` loads every tool's detect module: in vitest each is transformed on first import, which grows with
  // the number of tools and took more than the default 5 s on a loaded machine. The limit is the test's, not the page's.
  it(
    'the options that are on make the page’s context; with none, no web search, letters, strict matching, no recognition',
    { timeout: 30_000 },
    async () => {
      const { code } = setup();
      const none = { ...DEFAULT_SETTINGS, parts: Object.fromEntries(DEFINITIONS.map(p => [p.id, false])) };
      const bare = pageContext(DEFINITIONS, none, new Set(), code);
      expect(bare.webSearch).toBeUndefined();
      expect(bare.recognise).toBeUndefined();
      expect(bare.siteIcons.src('https://a.example/')).toBeNull();
      expect(bare.matcher.match('b64', DESTINATIONS)).toEqual([]);
      const on = { ...DEFAULT_SETTINGS, parts: { siteIcons: true } };
      for (const part of partsToLoad(DEFINITIONS, on, held, true)) await code.load(part);
      const full = pageContext(DEFINITIONS, on, held, code);
      expect(full.webSearch).toBeDefined();
      expect(full.siteIcons.src('https://a.example/')).toMatch(/_favicon/);
      expect(full.matcher.match('b64', DESTINATIONS).map(f => f.destination.title)).toEqual([
        'Base64',
        'Base64 Image',
        'Base64 File',
        'SVG to CSS',
      ]);
      await full.recognise?.ready();
      expect(full.recognise?.recognise('{"a": 1}')).toBe('json');
      expect(pageContext(DEFINITIONS, on, new Set(), code).siteIcons.src('https://a.example/')).toBeNull();
    },
  );

  it('while an option’s code is on its way, a stand-in: search and paste wait for it, icons keep their place', async () => {
    const { code, api } = setup();
    const on = { ...DEFAULT_SETTINGS, parts: { siteIcons: true } };
    const waiting = pageContext(DEFINITIONS, on, held, code);
    expect(waiting.siteIcons.waiting).toBe(true);
    expect(waiting.recognise?.recognise('{"a": 1}')).toBe(PENDING);
    expect(waiting.matcher.match('b64', DESTINATIONS)).toEqual([]);
    await waiting.webSearch?.search('kittens');
    expect(api.search.query).toHaveBeenCalledWith({ text: 'kittens', disposition: 'CURRENT_TAB' });
    await waiting.recognise?.ready();
    expect(waiting.recognise?.recognise('{"a": 1}')).toBe('json');
    expect(pageContext(DEFINITIONS, DEFAULT_SETTINGS, held, undefined).webSearch).toBeUndefined();
  });

  it('an option whose code failed leaves the page as it is without it; a row’s failure is known', async () => {
    const broken: StartPart[] = DEFINITIONS.map(
      p => ({ ...p, load: () => Promise.reject(new Error('gone')) }) as StartPart,
    );
    const code: PartCode = partCode(setup().deps);
    for (const part of broken) await code.load(part).catch(() => undefined);
    const context = pageContext(broken, DEFAULT_SETTINGS, held, code);
    expect(context.webSearch).toBeUndefined();
    expect(context.recognise).toBeUndefined();
    expect(code.failed(broken.find(p => p.id === 'tools')!)).toBe(true);
  });

  it('the page loads what the first frames show at once, the rest when idle, nothing that is off or blocked', () => {
    const at = (idle: boolean, settings = DEFAULT_SETTINGS, h: ReadonlySet<string> = held) =>
      partsToLoad(DEFINITIONS, settings, h, idle).map(p => p.id);
    const defaultsOn = DEFINITIONS.filter(p => p.defaultOn);
    expect(at(true)).toEqual(defaultsOn.map(p => p.id));
    expect(at(false)).toEqual(defaultsOn.filter(p => p.loadAt === 'start').map(p => p.id));
    expect(at(true, { ...DEFAULT_SETTINGS, parts: { recentlyOpened: true } }, new Set())).not.toContain(
      'recentlyOpened',
    );
    expect(at(true, { ...DEFAULT_SETTINGS, parts: Object.fromEntries(DEFINITIONS.map(p => [p.id, false])) })).toEqual(
      [],
    );
  });

  it('a part’s code loads once per page, whoever asks', async () => {
    const { code } = setup();
    const tools = DEFINITIONS.find(p => p.id === 'tools')!;
    expect(code.loaded(tools)).toBeUndefined();
    const [a, b] = await Promise.all([code.load(tools), code.load(tools)]);
    expect(a).toBe(b);
    expect(code.loaded(tools)).toBe(a);
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
  it('shortcuts: the user’s, in their order, answered without waiting (drawn as soon as the code is here)', async () => {
    const shortcuts = await rowCode('shortcuts');
    const promise = shortcuts.tiles.tiles(state);
    expect(promise).toMatchObject({ status: 'fulfilled' });
    expect((await promise).map(t => t.title)).toEqual(['Docs', 'Mail']);
  });

  it('tools: our places, the recently used first, the registry order after', async () => {
    const tools = await rowCode('tools');
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
    const { deps, api } = setup();
    const recent = await rowCode('recentlyOpened', deps);
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
