/**
 * The main page in jsdom over a fake `chrome`: a new tab (no hash) is the start page — its field finds and opens our
 * places, opens a tool with pasted text and hands other text to the web search seam; its parts follow the switches of
 * Settings; the shell's three parts are reachable; the theme switch writes the choice to chrome.storage.local.
 */
import { App } from './App';
import { whenEditionKnown } from './editionWait';
import { claimsAt, makeTestKey, signToken } from '@extension/licence/testing';
import { THEME_STORAGE_KEY } from '@extension/theme';
import { fixedSource } from '@src/edition/fixed';
import { licensedSource } from '@src/edition/licensed';
import { memoryHistoryHost } from '@src/history/behaviors';
import { browserNewTab } from '@src/newTab/browserNewTab';
import { ownNewTab } from '@src/newTab/ownNewTab';
import { SHELL_CACHE_KEY, SHELL_KEY } from '@src/shell/settings';
import { SHORTCUT_KEYS_KEY } from '@src/shortcuts/store';
import { startBehaviors } from '@src/start/behaviors';
import { RECENT_KEY, SETTINGS_KEY, SHORTCUTS_KEY, START_CACHE_KEY } from '@src/start/settings';
import { settled } from '@src/start/tileSources';
import { fakeChrome, fakeStorage } from '@src/test/fakes';
import { FREE, PRO, switchableSource } from '@src/test/switchableSource';
import { TOOLS } from '@src/tools/registry';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDeps } from './App';
import type { PermissionsApi } from './useStart';
import type { NewTabOverride } from '@src/newTab/override';

const setup = (
  hash: string,
  rows: Record<string, unknown> = {},
  held: string[] = [],
  newTab: NewTabOverride = ownNewTab,
  history?: AppDeps['history'],
) => {
  window.history.replaceState(null, '', `/src/app/index.html${hash}`);
  const { storage, permissions, api } = fakeChrome();
  for (const [k, v] of Object.entries(rows)) storage.rows.set(k, v);
  for (const p of held) permissions.held.add(p);
  api.history.search.mockResolvedValue([
    { id: '1', url: 'https://docs.example.com/guide', title: 'Guide — Docs', lastVisitTime: 2 },
    { id: '2', url: 'https://docs.example.com/api', title: 'API — Docs', lastVisitTime: 1 },
    { id: '3', url: 'chrome://settings/', title: 'Settings', lastVisitTime: 3 },
  ]);
  vi.stubGlobal('chrome', api);
  const media = Object.assign(new EventTarget(), { matches: false });
  const win = { localStorage: window.localStorage, matchMedia: () => media as unknown as MediaQueryList };
  const behaviors = { ...startBehaviors(api as unknown as typeof chrome), newTab };
  const search = api.search.query;
  const deps: AppDeps = {
    theme: { area: storage.area, onChanged: storage.onChanged, win, root: document.documentElement },
    start: { area: storage.area, onChanged: storage.onChanged, win },
    permissions: permissions as unknown as PermissionsApi,
    behaviors,
    ...(history && { history }),
  };
  const { unmount } = render(<App deps={deps} />);
  return { storage, permissions, search, history: api.history.search, unmount, media };
};

const field = () => screen.getByRole('combobox', { name: 'Find a tool or search the web' });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const enter = () => fireEvent.keyDown(field(), { key: 'Enter' });
const paste = (text: string) =>
  fireEvent.paste(field(), { clipboardData: { getData: (kind: string) => (kind === 'text/plain' ? text : '') } });
const row = (name: string) => screen.queryByRole('region', { name });

afterEach(() => {
  // Unmounted, not only removed: a mounted shell keeps its window listeners (the palette's shortcut).
  cleanup();
  vi.unstubAllGlobals();
  document.body.innerHTML = '';
  window.localStorage.clear();
});

describe('a new tab: the start page', () => {
  it('opens with the field, the tiles and Settings, titled "New Tab"', async () => {
    setup('');
    expect(await screen.findByRole('heading', { name: 'DevTab.Dev', level: 1 })).toBeTruthy();
    expect(field()).toBeTruthy();
    expect(document.title).toBe('New Tab');
    // The rows' code arrives a moment after the page (src/start/part.ts); their tiles then fill the room kept for them.
    await waitFor(() =>
      expect(within(row('Tools')!).getByRole('link', { name: 'JSON' }).getAttribute('href')).toBe('#/tools/json'),
    );
    expect(within(row('My shortcuts')!).getByRole('button', { name: 'Add shortcut' })).toBeTruthy();
    expect(row('Most visited')).toBeNull();
    expect(screen.getByRole('link', { name: 'Settings' }).getAttribute('href')).toBe('#/settings');
    // One Tab from the address bar goes to the page's first focusable element: it must be the field.
    expect(document.querySelector('a[href], button, input')).toBe(field());
  });

  it('typing a tool’s name shows it first, marked as what Enter takes, and Enter opens it', async () => {
    setup('');
    type('json');
    const options = screen.getAllByRole('option');
    expect(options[0].textContent).toContain('JSON');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    expect(options[0].textContent).toContain('Enter');
    expect(options.at(-1)!.textContent).toContain('Search the web for');
    enter();
    expect(window.location.hash).toBe('#/tools/json');
    expect(await screen.findByLabelText('Input')).toBeTruthy();
    expect(document.title).toBe('JSON — DevTab.Dev');
  });

  it('pasted JSON opens the JSON tool with it — through memory, not the address', async () => {
    setup('');
    // At once, before the tools' `detect` has arrived: the paste waits for it, then opens the tool.
    paste('{"b":1,"a":[1,2]}');
    await waitFor(() => expect(window.location.hash).toBe('#/tools/json'));
    expect(((await screen.findByLabelText('Input')) as HTMLTextAreaElement).value).toBe('{"b":1,"a":[1,2]}');
  });

  it('pasted text no tool recognises stays in the field — also when it came before the tools’ detect', async () => {
    setup('');
    paste('just words');
    await waitFor(() => expect((field() as HTMLInputElement).value).toBe('just words'));
    expect(window.location.hash).toBe('');
  });

  it('once the tools’ detect is here (after the first paint, when idle), a paste is recognised in its own event', async () => {
    // Wait for the detectors themselves, not for a fixed time: the first load of their chunk is slow when the
    // workspace's other test tasks run beside this one (toolRecogniser.ts marks the moment it has them).
    performance.clearMarks('tool-detectors');
    setup('');
    await waitFor(() => expect(performance.getEntriesByName('tool-detectors').length).toBeGreaterThan(0));
    await new Promise(r => setTimeout(r, 0));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => '017F22E2-79B0-7CC3-98C4-DC0C0C07398F' } });
    act(() => void field().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(true);
    expect(window.location.hash).toBe('#/tools/uuid');
  });

  it('with “Open a tool for pasted text” off, pasted JSON is text in the field', async () => {
    setup('', { [SETTINGS_KEY]: { version: 2, parts: { recognisePaste: false } } });
    await new Promise(r => setTimeout(r, 50));
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.assign(event, { clipboardData: { getData: () => '{"a": 1}' } });
    act(() => void field().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(window.location.hash).toBe('');
  });

  it('Enter on text nothing of ours matches hands it to the web search seam (at once: Enter waits for its code)', async () => {
    const { search } = setup('');
    type('kittens 42');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    enter();
    await waitFor(() => expect(search).toHaveBeenCalledWith({ text: 'kittens 42', disposition: 'CURRENT_TAB' }));
    expect(window.location.hash).toBe('');
  });

  it('arrows move the row Enter takes', async () => {
    const { search } = setup('');
    type('json');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option').at(-1)!.getAttribute('aria-selected')).toBe('true');
    enter();
    await waitFor(() => expect(search).toHaveBeenCalledWith({ text: 'json', disposition: 'CURRENT_TAB' }));
  });

  it('with web search off the field still finds our places, and Enter on anything else does nothing', async () => {
    const { search } = setup('', { [SETTINGS_KEY]: { parts: { webSearch: false } } });
    await waitFor(() => expect(field().getAttribute('placeholder')).toBe('Find a tool, or paste text'));
    type('kittens');
    expect(screen.queryAllByRole('option')).toHaveLength(0);
    expect(screen.getByText(/Nothing here matches/)).toBeTruthy();
    enter();
    expect(search).not.toHaveBeenCalled();
    type('compare');
    enter();
    expect(window.location.hash).toBe('#/compare');
  });

  it('each switch hides its part; with every part off the page still has the field and says so', async () => {
    setup('', {
      [SETTINGS_KEY]: { parts: { webSearch: false, shortcuts: false, tools: false, mostVisited: false } },
    });
    await waitFor(() => expect(row('Tools')).toBeNull());
    expect(row('My shortcuts')).toBeNull();
    expect(field()).toBeTruthy();
    expect(screen.getByText(/Every row of the start page is off/)).toBeTruthy();
  });

  it('a shortcut added on the page is stored and drawn; it can be edited, moved and removed', async () => {
    const { storage } = setup('');
    fireEvent.click(await screen.findByRole('button', { name: 'Add shortcut' }));
    // The form's chunk loads on the first click.
    fireEvent.change(await screen.findByLabelText('Title'), { target: { value: 'Docs' } });
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'docs.example.com' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    const docs = await within(row('My shortcuts')!).findByRole('link', { name: /Docs/ });
    expect(docs.getAttribute('href')).toBe('https://docs.example.com/');
    expect(storage.rows.get(SHORTCUTS_KEY)).toMatchObject([{ title: 'Docs', url: 'https://docs.example.com/' }]);

    fireEvent.click(screen.getByRole('button', { name: 'Add shortcut' }));
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'not an address' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText(/Enter a website address/)).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Address'), { target: { value: 'https://www.example.org/x' } });
    fireEvent.click(screen.getByRole('button', { name: 'Add' }));
    await within(row('My shortcuts')!).findByRole('link', { name: /example\.org/ });

    fireEvent.click(screen.getByRole('button', { name: 'Edit example.org' }));
    fireEvent.click(screen.getByRole('button', { name: 'Move left' }));
    await waitFor(() =>
      expect((storage.rows.get(SHORTCUTS_KEY) as Array<{ title: string }>).map(s => s.title)).toEqual([
        'example.org',
        'Docs',
      ]),
    );
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    await waitFor(() => expect(storage.rows.get(SHORTCUTS_KEY)).toHaveLength(1));
  });

  it('keeps the parts’ room from the localStorage copy in the first render, then fills it (no flash, no jump)', async () => {
    window.localStorage.setItem(
      START_CACHE_KEY,
      JSON.stringify({ settings: { parts: { tools: false } }, shortcuts: [{ id: 'a', title: 'A', url: 'a.example' }] }),
    );
    setup('', {
      [SETTINGS_KEY]: { version: 2, parts: { tools: false } },
      [SHORTCUTS_KEY]: [{ id: 'a', title: 'A', url: 'https://a.example/' }],
    });
    expect(row('Tools')).toBeNull();
    // First render: the row's heading and exactly its tiles' room (the shortcut and the add tile), hidden, busy.
    const kept = row('My shortcuts')!;
    if (kept.getAttribute('aria-busy') === 'true') {
      const reserved = kept.querySelector('.kit-tiles-reserved')!;
      expect(reserved.getAttribute('aria-hidden')).toBe('true');
      expect(reserved.querySelectorAll('.kit-tile')).toHaveLength(2);
    }
    await waitFor(() => expect(within(row('My shortcuts')!).getByRole('link', { name: /A/ })).toBeTruthy());
    expect(row('My shortcuts')!.querySelectorAll('.kit-tile')).toHaveLength(2);
    expect(row('My shortcuts')!.querySelector('.kit-tiles-reserved')).toBeNull();
  });

  it('follows a change of the settings made on another page at once: a row goes, fuzzy matching goes', async () => {
    const { storage } = setup('');
    await waitFor(() => expect(within(row('Tools')!).getAllByRole('link').length).toBeGreaterThan(0));
    await act(async () =>
      storage.area.set({ [SETTINGS_KEY]: { version: 2, parts: { tools: false, fuzzyMatching: false } } }),
    );
    expect(row('Tools')).toBeNull();
    await new Promise(r => setTimeout(r, 50));
    type('b64');
    expect(screen.getAllByRole('option').map(o => o.textContent)).toEqual([expect.stringContaining('Search the web')]);
    await act(async () => storage.area.set({ [SETTINGS_KEY]: { version: 2, parts: {} } }));
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toContain('Base64'));
    await waitFor(() => expect(row('Tools')).not.toBeNull());
  });

  it('a row whose code cannot be loaded says so in one line; the rest of the page works', async () => {
    window.history.replaceState(null, '', '/src/app/index.html');
    const { storage, permissions, api } = fakeChrome();
    vi.stubGlobal('chrome', api);
    const behaviors = startBehaviors(api as unknown as typeof chrome);
    const broken = {
      ...behaviors,
      newTab: ownNewTab,
      parts: behaviors.parts.map(p => (p.id === 'tools' ? { ...p, load: () => Promise.reject(new Error('gone')) } : p)),
    } as typeof behaviors;
    const win = { localStorage: window.localStorage, matchMedia: () => ({ matches: false }) as MediaQueryList };
    render(
      <App
        deps={{
          theme: { area: storage.area, onChanged: storage.onChanged, win, root: document.documentElement },
          start: { area: storage.area, onChanged: storage.onChanged, win },
          permissions: permissions as unknown as PermissionsApi,
          behaviors: broken,
        }}
      />,
    );
    await waitFor(() => expect(row('Tools')!.textContent).toContain('This row could not be loaded'));
    await waitFor(() =>
      expect(within(row('My shortcuts')!).getByRole('button', { name: 'Add shortcut' })).toBeTruthy(),
    );
    type('json');
    expect(screen.getAllByRole('option')[0].textContent).toContain('JSON');
  });

  it('remembers the sections and tools opened, most recent first, for the Tools tiles', async () => {
    const { storage } = setup('#/review');
    await screen.findByRole('heading', { name: 'Companion app required' });
    await waitFor(() => expect(storage.rows.get(RECENT_KEY)).toEqual({ last: '#/review', used: ['#/review'] }));
    act(() => {
      window.location.hash = '#/start';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    await waitFor(() => expect(within(row('Tools')!).getAllByRole('link')[0].textContent).toBe('Live review'));
  });
});

describe('the start page’s history row', () => {
  const on = { [SETTINGS_KEY]: { version: 2, parts: { recentlyOpened: true } } };

  it('is off by default, and then history is never read', async () => {
    const { history } = setup('');
    await screen.findByRole('region', { name: 'Tools' });
    await new Promise(r => setTimeout(r, 50));
    expect(row('Recently opened')).toBeNull();
    expect(history).not.toHaveBeenCalled();
  });

  it('switched on and allowed: one tile per site, after the first paint; nothing of it is stored or copied', async () => {
    const { storage, history } = setup('', on, ['history']);
    await waitFor(() => expect(within(row('Recently opened')!).getAllByRole('link').length).toBeGreaterThan(0));
    const tiles = within(row('Recently opened')!).getAllByRole('link');
    expect(tiles.map(t => [t.textContent, t.getAttribute('href')])).toEqual([
      ['GGuide — Docs', 'https://docs.example.com/guide'],
    ]);
    expect(history).toHaveBeenCalledTimes(1);
    const kept = JSON.stringify([...storage.rows.values()]) + (window.localStorage.getItem(START_CACHE_KEY) ?? '');
    expect(kept).not.toContain('docs.example.com');
    expect(kept).not.toContain('Guide');
  });

  it('switched on but the permission was removed: no read, one line saying why, a way back to the switch', async () => {
    const { history } = setup('', on);
    const removed = await screen.findByRole('region', { name: 'Recently opened' });
    expect(removed.textContent).toContain('permission this row needs was removed');
    expect(within(removed).getByRole('link', { name: 'Turn it on again in Settings' }).getAttribute('href')).toBe(
      '#/settings',
    );
    expect(history).not.toHaveBeenCalled();
  });

  it('the switch asks Chrome for history from the click and gives it back when turned off', async () => {
    const { storage, permissions } = setup('#/settings');
    const recent = await screen.findByRole('switch', { name: 'Recently opened' });
    expect(screen.getByText(/Read and change your browsing history on all your signed-in devices/)).toBeTruthy();
    fireEvent.click(recent);
    expect(permissions.request).toHaveBeenCalledWith({ permissions: ['history'] });
    await waitFor(() => expect(recent.getAttribute('aria-checked')).toBe('true'));
    expect(storage.rows.get(SETTINGS_KEY)).toMatchObject({ parts: { recentlyOpened: true } });
    fireEvent.click(recent);
    await waitFor(() => expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['history'] }));
    expect(permissions.held.has('history')).toBe(false);
  });

  it('settings say when the permission was removed', async () => {
    setup('#/settings', on);
    expect(await screen.findByText(/permission was removed, so this is off/)).toBeTruthy();
  });
});

// The whole page rendered in jsdom per test: 2–5 s each on a loaded machine, past vitest's default 5 s. The limit is the
// tests' own, not a bound on the page (the page in Chrome: docs/research/performance.md).
describe('settings', { timeout: 30_000 }, () => {
  it('General: a new tab opens the start page or the last opened tool', async () => {
    const { storage } = setup('#/settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(document.title).toBe('Settings — DevTab.Dev');
    fireEvent.click(screen.getByRole('radio', { name: 'Last opened tool' }));
    await waitFor(() => expect(storage.rows.get(SETTINGS_KEY)).toMatchObject({ newTab: 'last' }));
    expect(JSON.parse(window.localStorage.getItem(START_CACHE_KEY)!).settings.newTab).toBe('last');
  });

  it('a switch without a permission saves at once', async () => {
    const { storage } = setup('#/settings');
    fireEvent.click(await screen.findByRole('switch', { name: 'My shortcuts' }));
    await waitFor(() => expect(storage.rows.get(SETTINGS_KEY)).toMatchObject({ parts: { shortcuts: false } }));
  });

  it('Most visited asks Chrome for topSites when turned on, and gives it back when turned off', async () => {
    const { storage, permissions } = setup('#/settings');
    const most = await screen.findByRole('switch', { name: 'Most visited' });
    expect(most.getAttribute('aria-checked')).toBe('false');
    fireEvent.click(most);
    expect(permissions.request).toHaveBeenCalledWith({ permissions: ['topSites'] });
    await waitFor(() => expect(most.getAttribute('aria-checked')).toBe('true'));
    expect(storage.rows.get(SETTINGS_KEY)).toMatchObject({ parts: { mostVisited: true } });
    fireEvent.click(most);
    await waitFor(() => expect(permissions.remove).toHaveBeenCalledWith({ permissions: ['topSites'] }));
    expect(storage.rows.get(SETTINGS_KEY)).toMatchObject({ parts: { mostVisited: false } });
  });

  it('a refused prompt leaves the part off and says so', async () => {
    const { storage, permissions } = setup('#/settings');
    permissions.request.mockResolvedValueOnce(false);
    fireEvent.click(await screen.findByRole('switch', { name: 'Site icons' }));
    expect(await screen.findByText(/Chrome did not allow it/)).toBeTruthy();
    expect(storage.rows.get(SETTINGS_KEY)).toBeUndefined();
  });

  it('is the only place the theme is chosen: the sidebar keeps Settings and no theme picker', async () => {
    setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    expect(screen.getAllByRole('radio', { name: 'Dark' })).toHaveLength(1);
    expect(within(document.querySelector('.kit-sidebar')!).queryByRole('radiogroup')).toBeNull();
    expect(within(document.querySelector('.kit-sidebar')!).getByRole('link', { name: 'Settings' })).toBeTruthy();
  });

  it('a theme never chosen is System: the page follows the system’s light or dark setting live, and says so', async () => {
    const { media, storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    expect(screen.getByRole('radio', { name: 'System' }).getAttribute('aria-checked')).toBe('true');
    expect(document.querySelector('[data-theme-note]')!.textContent).toMatch(/^Follows your system/);
    expect(document.documentElement.dataset.theme).toBe('default-light');
    act(() => {
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
    expect(document.documentElement.dataset.theme).toBe('default-dark');
    expect(storage.rows.has(THEME_STORAGE_KEY)).toBe(false);
    // An explicit choice no longer follows the system.
    await act(async () => fireEvent.click(screen.getByRole('radio', { name: 'Light' })));
    expect(document.documentElement.dataset.theme).toBe('default-light');
    expect(document.querySelector('[data-theme-note]')!.textContent).toBe(
      'Always light, whatever your system is set to.',
    );
    act(() => {
      media.matches = false;
      media.dispatchEvent(new Event('change'));
      media.matches = true;
      media.dispatchEvent(new Event('change'));
    });
    expect(document.documentElement.dataset.theme).toBe('default-light');
  });
});

describe('our page opened by its address', () => {
  it('the start page at #/start is titled by its name, not "New Tab"', async () => {
    setup('#/start');
    expect(await screen.findByRole('heading', { name: 'DevTab.Dev', level: 1 })).toBeTruthy();
    expect(document.title).toBe('Start page — DevTab.Dev');
  });

  it('a deep link to a tool opens it, titled by the tool', async () => {
    setup('#/tools/json');
    expect(await screen.findByLabelText('Input')).toBeTruthy();
    expect(document.title).toBe('JSON — DevTab.Dev');
  });

  it('the options page in Chrome’s dialog (?bare): the settings without the sidebar', async () => {
    setup('?options&bare#/settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(document.querySelector('.kit-sidebar')).toBeNull();
    expect(document.querySelector('main.kit-bare')).toBeTruthy();
    // History would open inside the dialog: it opens in a tab of its own, with the frame.
    const open = await screen.findByRole('link', { name: 'Open History' });
    expect([open.getAttribute('href'), open.getAttribute('target')]).toEqual(['index.html#/history', '_blank']);
  });

  it('the options page in a tab keeps the sidebar; going to another route drops the options flag', async () => {
    setup('?options#/settings');
    expect(await screen.findByRole('heading', { name: 'Settings', level: 1 })).toBeTruthy();
    expect(document.querySelector('.kit-sidebar')).toBeTruthy();
    expect(window.location.search).toBe('?options');
    act(() => {
      window.location.hash = '#/tools';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: 'Tools', level: 1 })).toBeTruthy();
    expect(window.location.search).toBe('');
    expect(window.location.hash).toBe('#/tools');
  });

  it('where a new tab is not ours: no "A new tab opens", and no address is titled "New Tab"', async () => {
    setup('#/settings', {}, [], browserNewTab);
    await screen.findByRole('heading', { name: 'Start page', level: 2 });
    expect(screen.queryByRole('heading', { name: 'General' })).toBeNull();
    expect(screen.queryByRole('radio', { name: 'Last opened tool' })).toBeNull();
    document.body.innerHTML = '';
    setup('', {}, [], browserNewTab);
    await screen.findByRole('heading', { name: 'DevTab.Dev', level: 1 });
    expect(document.title).toBe('Start page — DevTab.Dev');
  });

  it('a new tab of ours without the copy applies "Last opened tool" once chrome.storage answers', async () => {
    const { unmount } = setup('', {
      [SETTINGS_KEY]: { newTab: 'last' },
      [RECENT_KEY]: { last: '#/tools/json', used: [] },
    });
    await waitFor(() => expect(window.location.hash).toBe('#/tools/json'));
    // The tool's lazy chunk is still loading: leave nothing of this page behind for the next test.
    await screen.findByLabelText('Input');
    unmount();
  });

  it('where a new tab is not ours, a missing copy never turns the page into the last tool', async () => {
    setup(
      '',
      { [SETTINGS_KEY]: { newTab: 'last' }, [RECENT_KEY]: { last: '#/tools/json', used: [] } },
      [],
      browserNewTab,
    );
    await screen.findByRole('heading', { name: 'DevTab.Dev', level: 1 });
    await new Promise(r => setTimeout(r, 50));
    expect(window.location.hash).toBe('');
  });
});

describe('the shell', () => {
  it('navigates to the tools and loads the JSON tool', async () => {
    setup('#/compare');
    act(() => {
      window.location.hash = '#/tools/json';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    expect(await screen.findByRole('heading', { name: 'Tools', level: 1 })).toBeTruthy();
    const input = await screen.findByLabelText('Input');
    // The JSON tool formats as the text changes (docs/tools/specs/json.md §2.1): no button to press.
    fireEvent.change(input, { target: { value: '{"b":1,"a":[1,2]}' } });
    expect((screen.getByLabelText('Result') as HTMLTextAreaElement).value).toBe(
      '{\n  "b": 1,\n  "a": [\n    1,\n    2\n  ]\n}',
    );
    fireEvent.change(input, { target: { value: '{"a":}' } });
    expect(screen.getByText(/Line 1, column 6/)).toBeTruthy();
  });

  it('opens on «Compare code»: the editor frame, no text fields, the example named on both sides', async () => {
    setup('#/compare');
    expect(await screen.findByRole('heading', { name: 'Compare code' })).toBeTruthy();
    expect(screen.getByTitle('Side-by-side comparison').getAttribute('src')).toBe('/src/viewer/index.html');
    expect(document.querySelector('textarea')).toBeNull();
    expect(await screen.findByText('before.rs')).toBeTruthy();
    expect(screen.getByRole('group', { name: 'Changed side' }).textContent).toContain('after.rs');
  });

  it('shows the companion notice in «Live review»', async () => {
    setup('#/review');
    expect(await screen.findByRole('heading', { name: 'Companion app required' })).toBeTruthy();
  });

  it('the theme switch saves the choice and repaints the page', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    });
    expect(storage.rows.get(THEME_STORAGE_KEY)).toMatchObject({ mode: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('default-dark');
  });
});

const goTo = (hash: string) =>
  act(() => {
    window.location.hash = hash;
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
const sections = () => screen.getByRole('navigation', { name: 'Sections' });
const toolsToggle = () => within(sections()).getByRole('button', { name: 'Tools list' });
// The list the toggle controls (a hidden list has no accessible name to find it by).
const toolsList = () => document.getElementById(toolsToggle().getAttribute('aria-controls')!)!;
// jsdom is not a Mac: the command modifier is Ctrl.
const findKey = (target: Element | Window = window) =>
  fireEvent.keyDown(target, { key: 'k', code: 'KeyK', ctrlKey: true });
const palette = () => screen.queryByRole('dialog', { name: 'Find a tool or section' });
const paletteField = () => within(palette()!).getByRole('combobox', { name: 'Find a tool or section' });

describe('the shell’s sidebar: every tool nested under Tools', () => {
  it('lists the registry’s tools under Tools, in its order, and marks the current one; the group opens for it', async () => {
    const { storage } = setup('#/tools/base64');
    expect(await screen.findByRole('heading', { name: 'Base64', level: 2 })).toBeTruthy();
    expect(within(sections()).getByRole('list', { name: 'Tools' })).toBe(toolsList());
    const links = within(toolsList()).getAllByRole('link');
    expect(links.map(a => a.textContent)).toEqual(TOOLS.map(t => t.title));
    expect(links.map(a => a.getAttribute('href'))).toEqual(TOOLS.map(t => `#/tools/${t.id}`));
    expect(within(toolsList()).getByRole('link', { name: 'Base64' }).getAttribute('aria-current')).toBe('page');
    // The section stays a link to the section; it is on the way to the current place, not the current place.
    const section = within(sections()).getByRole('link', { name: 'Tools' });
    expect([section.getAttribute('href'), section.getAttribute('aria-current')]).toEqual(['#/tools', null]);
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('true');
    expect(toolsToggle().getAttribute('aria-controls')).toBe(toolsList().id);
    // Opening by itself is not the user's choice: nothing is stored.
    expect(storage.rows.has(SHELL_KEY)).toBe(false);
  });

  it('opens and closes by its button, and keeps the choice in chrome.storage — a reload opens it as left', async () => {
    const first = setup('#/compare');
    await screen.findByRole('heading', { name: 'Compare code' });
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('false');
    expect(toolsList().hidden).toBe(true);
    await act(async () => fireEvent.click(toolsToggle()));
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('true');
    expect(toolsList().hidden).toBe(false);
    expect(first.storage.rows.get(SHELL_KEY)).toEqual({ version: 1, open: { tools: true }, breadcrumb: true });
    first.unmount();
    document.body.innerHTML = '';

    // The next load: open in the first render from the localStorage copy, then from chrome.storage.
    expect(JSON.parse(window.localStorage.getItem(SHELL_CACHE_KEY)!)).toEqual({
      version: 1,
      open: { tools: true },
      breadcrumb: true,
    });
    setup('#/compare', { [SHELL_KEY]: { version: 1, open: { tools: true }, breadcrumb: true } });
    await screen.findByRole('heading', { name: 'Compare code' });
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('closed on a tool’s page, it stays closed — until another tool is shown', async () => {
    const { storage } = setup('#/tools/json');
    await screen.findByLabelText('Input');
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('true');
    await act(async () => fireEvent.click(toolsToggle()));
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('false');
    expect(storage.rows.get(SHELL_KEY)).toEqual({ version: 1, open: { tools: false }, breadcrumb: true });
    goTo('#/tools/base64');
    await screen.findByRole('heading', { name: 'Base64', level: 2 });
    expect(toolsToggle().getAttribute('aria-expanded')).toBe('true');
    expect(storage.rows.get(SHELL_KEY)).toEqual({ version: 1, open: { tools: false }, breadcrumb: true });
  });
});

describe('the Tools section’s own page: an overview', () => {
  it('lists every tool with what it does, and opens it', async () => {
    setup('#/tools');
    expect(await screen.findByRole('heading', { name: 'Tools', level: 1 })).toBeTruthy();
    const overview = screen.getByRole('navigation', { name: 'All tools' });
    const links = within(overview).getAllByRole('link');
    expect(links.map(a => a.getAttribute('href'))).toEqual(TOOLS.map(t => `#/tools/${t.id}`));
    for (const [i, tool] of TOOLS.entries()) expect(links[i].textContent).toBe(tool.title + tool.summary);
    expect(screen.queryByLabelText('Input')).toBeNull();
    expect(within(sections()).getByRole('link', { name: 'Tools' }).getAttribute('aria-current')).toBe('page');
  });

  it('an address naming no tool shows the overview and says so', async () => {
    setup('#/tools/nope');
    expect(await screen.findByRole('status')).toBeTruthy();
    expect(screen.getByText(/There is no tool/).textContent).toContain('nope');
    expect(screen.getByRole('navigation', { name: 'All tools' })).toBeTruthy();
    expect(document.title).toBe('Tools — DevTab.Dev');
  });
});

describe('the shell’s toolbar and palette', () => {
  it('the toolbar’s button shows its shortcut and opens a dialog with a combobox and a listbox, recent places first', async () => {
    setup('#/history', { [RECENT_KEY]: { last: '#/tools/hash', used: ['#/tools/hash', '#/compare'] } });
    const button = await screen.findByRole('button', { name: 'Find a tool or section…' });
    expect(button.getAttribute('aria-keyshortcuts')).toBe('Control+K');
    expect(button.getAttribute('aria-haspopup')).toBe('dialog');
    expect(button.textContent).toContain('Ctrl+K');
    await act(async () => fireEvent.click(button));
    expect(palette()).toBeTruthy();
    expect(document.activeElement).toBe(paletteField());
    const list = within(palette()!).getByRole('listbox');
    expect(paletteField().getAttribute('aria-controls')).toBe(list.id);
    const recent = await within(list).findByRole('group', { name: 'Recent' });
    expect(
      within(recent)
        .getAllByRole('option')
        .map(o => o.textContent),
    ).toEqual(['HashToolEnter', 'Compare codeSectionCtrl+Shift+E']);
    expect(paletteField().getAttribute('aria-activedescendant')).toBe(within(recent).getAllByRole('option')[0].id);
    expect(within(list).getByRole('group', { name: 'Go to' })).toBeTruthy();
    expect(within(within(list).getByRole('group', { name: 'Tools' })).getAllByRole('option')).toHaveLength(
      TOOLS.length,
    );
  });

  it('filters as the start page’s field does; arrows and Enter go there, and the keys go on in the page', async () => {
    setup('#/compare');
    await screen.findByRole('heading', { name: 'Compare code' });
    await act(async () => findKey());
    fireEvent.change(paletteField(), { target: { value: 'base' } });
    const options = within(palette()!).getAllByRole('option');
    expect(options[0].textContent).toContain('Base64');
    expect(options[0].getAttribute('aria-selected')).toBe('true');
    fireEvent.keyDown(paletteField(), { key: 'ArrowDown' });
    fireEvent.keyDown(paletteField(), { key: 'ArrowUp' });
    await act(async () => fireEvent.keyDown(paletteField(), { key: 'Enter' }));
    expect(window.location.hash).toBe('#/tools/base64');
    await waitFor(() => expect(palette()).toBeNull());
    expect(document.activeElement).toBe(document.querySelector('main.kit-main'));
    expect(await screen.findByRole('heading', { name: 'Base64', level: 2 })).toBeTruthy();
  });

  it('opens by the shortcut from a text field; the page behind is hidden; Escape closes and gives the focus back', async () => {
    setup('#/tools/json');
    const input = await screen.findByLabelText('Input');
    input.focus();
    await act(async () => findKey(input));
    expect(palette()).toBeTruthy();
    expect(document.activeElement).toBe(paletteField());
    expect(document.querySelector('.kit-shell')!.closest('[aria-hidden="true"]')).toBeTruthy();
    await act(async () => fireEvent.keyDown(paletteField(), { key: 'Escape' }));
    await waitFor(() => expect(palette()).toBeNull());
    expect(document.activeElement).toBe(input);
    expect(document.querySelector('.kit-shell')!.closest('[aria-hidden="true"]')).toBeNull();
  });

  it('the shortcut again closes it; each opening starts empty', async () => {
    setup('#/history');
    await screen.findByRole('button', { name: 'Find a tool or section…' });
    await act(async () => findKey());
    fireEvent.change(paletteField(), { target: { value: 'json' } });
    await act(async () => findKey(paletteField()));
    await waitFor(() => expect(palette()).toBeNull());
    await act(async () => findKey());
    expect((paletteField() as HTMLInputElement).value).toBe('');
  });

  it('pasted text a tool recognises opens that tool with it, as on the start page', async () => {
    setup('#/compare');
    await screen.findByRole('heading', { name: 'Compare code' });
    await act(async () => findKey());
    await act(async () =>
      fireEvent.paste(paletteField(), {
        clipboardData: { getData: (kind: string) => (kind === 'text/plain' ? '{"b":1}' : '') },
      }),
    );
    expect(window.location.hash).toBe('#/tools/json');
    expect(((await screen.findByLabelText('Input')) as HTMLTextAreaElement).value).toBe('{"b":1}');
  });

  it('nothing of ours matches: it says so, and offers no web search', async () => {
    const { search } = setup('#/history');
    await screen.findByRole('button', { name: 'Find a tool or section…' });
    await act(async () => findKey());
    fireEvent.change(paletteField(), { target: { value: 'kittens' } });
    expect(within(palette()!).queryAllByRole('option')).toHaveLength(0);
    expect(within(palette()!).getByText(/No section or tool matches/)).toBeTruthy();
    fireEvent.keyDown(paletteField(), { key: 'Enter' });
    expect(search).not.toHaveBeenCalled();
    expect(window.location.hash).toBe('#/history');
  });

  it('on the start page the shortcut focuses its field instead: one search, not two', async () => {
    setup('');
    await screen.findByRole('heading', { name: 'DevTab.Dev', level: 1 });
    act(() => (document.activeElement as HTMLElement | null)?.blur());
    expect(document.activeElement).not.toBe(field());
    // The start page loads its listener after the first paint, from a chunk of its own.
    await waitFor(() => {
      const event = new KeyboardEvent('keydown', { key: 'k', code: 'KeyK', ctrlKey: true, cancelable: true });
      act(() => void window.dispatchEvent(event));
      expect(event.defaultPrevented).toBe(true);
    });
    expect(document.activeElement).toBe(field());
    expect(screen.queryByRole('dialog')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Find a tool or section…' })).toBeNull();
  });
});

// The list has a row per action, one for every tool: with forty tools these tests take four to six seconds in jsdom
// on a free machine, so the default five-second limit is not theirs.
describe('Settings → Shortcuts', { timeout: 30_000 }, () => {
  const block = () => document.querySelector<HTMLElement>('[data-settings="shortcuts"]')!;
  const fieldOf = (title: string) => within(block()).getByLabelText(title, { selector: 'input' }) as HTMLInputElement;
  const record = async (field: HTMLElement, init: KeyboardEventInit) => {
    field.focus();
    await act(async () => fireEvent.keyDown(field, init));
  };

  it('lists every action from the definitions, with its key now; a recorded key is saved and works at once', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Shortcuts' });
    expect(fieldOf('Find a tool or section').value).toBe('Ctrl+K');
    const tools = within(block()).getByRole('group', { name: 'Tools' });
    expect(within(tools).getAllByRole('textbox')).toHaveLength(TOOLS.length);
    expect(fieldOf('JSON').value).toBe('');

    await record(fieldOf('JSON'), { key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true });
    expect(storage.rows.get(SHORTCUT_KEYS_KEY)).toEqual({
      version: 2,
      keys: { 'open:tools/json': { key: 'j', code: 'KeyJ', mod: true, shift: true } },
    });
    await waitFor(() => expect(fieldOf('JSON').value).toBe('Ctrl+Shift+J'));
    // Live in this page: the shortcut opens the tool, from a text field too (it has Ctrl).
    act(() => (document.activeElement as HTMLElement).blur());
    await act(async () => fireEvent.keyDown(window, { key: 'J', code: 'KeyJ', ctrlKey: true, shiftKey: true }));
    expect(window.location.hash).toBe('#/tools/json');
  });

  it('says at once why a key is not taken, and saves nothing: another action’s, Chrome’s, no modifier', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Shortcuts' });
    await record(fieldOf('Base64'), { key: 'k', code: 'KeyK', ctrlKey: true });
    expect(within(block()).getByRole('alert').textContent).toBe(
      'Ctrl+K is already “Find a tool or section”. Clear that one first, or choose another. Not saved.',
    );
    await record(fieldOf('Base64'), { key: 't', code: 'KeyT', ctrlKey: true });
    expect(within(block()).getByRole('alert').textContent).toContain('Chrome’s own');
    await record(fieldOf('Base64'), { key: 'b', code: 'KeyB' });
    expect(within(block()).getByRole('alert').textContent).toContain('alone would type into text fields');
    await record(fieldOf('Base64'), { key: 's', code: 'KeyS', ctrlKey: true });
    expect(within(block()).getByRole('alert').textContent).toContain('Compare code: Save');
    expect(storage.rows.has(SHORTCUT_KEYS_KEY)).toBe(false);
  });

  it('clear, reset one and reset all; the toolbar shows the palette’s key now, not the default', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Shortcuts' });
    const button = () => screen.getByRole('button', { name: 'Find a tool or section…' });
    await act(async () =>
      fireEvent.click(within(block()).getByRole('button', { name: 'Clear the shortcut for Find a tool or section' })),
    );
    expect(storage.rows.get(SHORTCUT_KEYS_KEY)).toEqual({ version: 2, keys: { find: null } });
    await waitFor(() => expect(button().getAttribute('aria-keyshortcuts')).toBeNull());
    expect(button().querySelector('kbd')).toBeNull();

    await record(fieldOf('Find a tool or section'), { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true });
    await waitFor(() => expect(button().getAttribute('aria-keyshortcuts')).toBe('Control+Alt+P'));
    expect(button().textContent).toContain('Ctrl+Alt+P');

    await act(async () =>
      fireEvent.click(within(block()).getByRole('button', { name: 'Reset the shortcut for Find a tool or section' })),
    );
    await waitFor(() => expect(button().getAttribute('aria-keyshortcuts')).toBe('Control+K'));
    await record(fieldOf('Hash'), { key: 'h', code: 'KeyH', altKey: true });
    await act(async () => fireEvent.click(within(block()).getByRole('button', { name: 'Reset all shortcuts' })));
    expect(storage.rows.get(SHORTCUT_KEYS_KEY)).toEqual({ version: 2, keys: {} });
  });
});

describe('fuzzy matching, the same on the start page and in the palette', () => {
  it('the start page: an abbreviation finds the tool, its matched letters marked; the name is read whole', async () => {
    setup('');
    // At once only the strict matcher is here; the fuzzy one arrives after the first paint and the rows follow.
    type('b64');
    await waitFor(() => expect(screen.getAllByRole('option')[0].textContent).toContain('Base64'));
    const [row] = screen.getAllByRole('option');
    expect(within(row).getByText('Base64', { selector: '.sr-only' })).toBeTruthy();
    expect([...row.querySelectorAll('mark')].map(m => m.textContent).join('')).toBe('B64');
    expect(row.querySelector('[aria-hidden="true"] mark')).toBeTruthy();
    enter();
    expect(window.location.hash).toBe('#/tools/base64');
  });

  it('the start page: an exact or prefix query is ranked as before; a keyword match says which keyword', () => {
    setup('');
    type('json');
    expect(screen.getAllByRole('option')[0].textContent).toContain('JSON');
    type('minify');
    expect(screen.getAllByRole('option')[0].textContent).toContain('Tool · matches “minify”');
  });

  it('the palette: a misspelling finds the place', async () => {
    setup('#/history');
    await screen.findByRole('button', { name: 'Find a tool or section…' });
    await act(async () => findKey());
    fireEvent.change(paletteField(), { target: { value: 'pasword' } });
    expect(within(palette()!).getAllByRole('option')[0].textContent).toContain('Password Generator');
    fireEvent.change(paletteField(), { target: { value: 'code compare' } });
    expect(within(palette()!).getAllByRole('option')[0].textContent).toContain('Compare code');
  });
});

describe('the breadcrumb', () => {
  const crumbs = () => screen.queryByRole('navigation', { name: 'Breadcrumb' });

  it('on a tool’s page: an ordered list, Tools a link, the tool the current page; the parts’ titles stay for screen readers', async () => {
    setup('#/tools/base64');
    await screen.findByRole('heading', { name: 'Base64', level: 2 });
    const nav = crumbs()!;
    const list = within(nav).getByRole('list');
    expect(list.tagName).toBe('OL');
    expect(within(nav).getByRole('link', { name: 'Tools' }).getAttribute('href')).toBe('#/tools');
    const current = within(list).getAllByRole('listitem')[1].firstElementChild!;
    expect([current.tagName, current.textContent, current.getAttribute('aria-current')]).toEqual([
      'SPAN',
      'Base64',
      'page',
    ]);
    expect(current.getAttribute('title')).toBe('Base64');
    expect(document.querySelector('.kit-shell')!.getAttribute('data-breadcrumb')).toBe('on');
    // The headings are still there (shell.css only hides them from the eye).
    expect(screen.getByRole('heading', { name: 'Tools', level: 1 })).toBeTruthy();
  });

  it('a section alone is its name, not a link; an unknown tool is Tools', async () => {
    setup('#/history');
    await screen.findByRole('heading', { name: 'History', level: 1 });
    expect(within(crumbs()!).queryByRole('link')).toBeNull();
    expect(within(crumbs()!).getByText('History').getAttribute('aria-current')).toBe('page');
    goTo('#/tools/nope');
    await screen.findByRole('navigation', { name: 'All tools' });
    expect(
      within(crumbs()!)
        .getAllByRole('listitem')
        .map(li => li.textContent),
    ).toEqual(['Tools']);
  });

  it('switched off in Settings → Appearance: gone, kept in the shell’s settings, the titles shown again', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    const toggle = screen.getByRole('switch', { name: 'Breadcrumb' });
    expect(toggle.getAttribute('aria-checked')).toBe('true');
    await act(async () => fireEvent.click(toggle));
    expect(crumbs()).toBeNull();
    expect(document.querySelector('.kit-shell')!.hasAttribute('data-breadcrumb')).toBe(false);
    expect(storage.rows.get(SHELL_KEY)).toEqual({ version: 1, open: {}, breadcrumb: false });
    // Another page reads it the same way.
    await act(async () => storage.area.set({ [SHELL_KEY]: { version: 1, open: {}, breadcrumb: true } }));
    expect(crumbs()).toBeTruthy();
  });
});

describe('default shortcuts', () => {
  it('a default opens its place from another page; the sidebar’s tooltip says the key', async () => {
    setup('#/history');
    await screen.findByRole('heading', { name: 'History', level: 1 });
    const compare = within(sections()).getByRole('link', { name: 'Compare code' });
    expect(compare.getAttribute('title')).toBe('Compare code (Ctrl+Shift+E)');
    expect(compare.getAttribute('aria-keyshortcuts')).toBe('Control+Shift+E');
    await act(async () => fireEvent.keyDown(window, { key: 'E', code: 'KeyE', ctrlKey: true, shiftKey: true }));
    expect(window.location.hash).toBe('#/compare');
  });

  it('Settings say which keys are defaults and which are yours; cleared stays cleared; reset gives the default back', async () => {
    const { storage } = setup('#/settings');
    await screen.findByRole('heading', { name: 'Shortcuts' });
    const row = () => document.querySelector<HTMLElement>('[data-shortcut="open:settings"]')!;
    expect(within(row()).getByText('Default')).toBeTruthy();
    expect(row().dataset.origin).toBe('default');
    expect((within(row()).getByRole('textbox') as HTMLInputElement).value).toBe('Ctrl+Shift+,');
    const field = within(row()).getByRole('textbox');
    field.focus();
    await act(async () => fireEvent.keyDown(field, { key: 'p', code: 'KeyP', ctrlKey: true, altKey: true }));
    await waitFor(() => expect(row().dataset.origin).toBe('own'));
    expect(row().textContent).toContain('Your key — the default is Ctrl+Shift+,');
    await act(async () =>
      fireEvent.click(within(row()).getByRole('button', { name: 'Clear the shortcut for Settings' })),
    );
    await waitFor(() => expect(row().dataset.origin).toBe('cleared'));
    expect((storage.rows.get(SHORTCUT_KEYS_KEY) as { keys: Record<string, unknown> }).keys['open:settings']).toBeNull();
    await act(async () =>
      fireEvent.click(within(row()).getByRole('button', { name: 'Reset the shortcut for Settings' })),
    );
    await waitFor(() => expect(row().dataset.origin).toBe('default'));
    expect((storage.rows.get(SHORTCUT_KEYS_KEY) as { keys: Record<string, unknown> }).keys).toEqual({});
  });

  it('a person’s key over a default: the default is not given, and the row says who has it', async () => {
    setup('#/settings', {
      [SHORTCUT_KEYS_KEY]: {
        version: 2,
        keys: { 'open:tools/json': { key: 'e', code: 'KeyE', mod: true, shift: true } },
      },
    });
    await screen.findByRole('heading', { name: 'Shortcuts' });
    const row = () => document.querySelector<HTMLElement>('[data-shortcut="open:compare"]')!;
    await waitFor(() => expect(row().dataset.origin).toBe('blocked'));
    expect(row().textContent).toContain('Default Ctrl+Shift+E is not given: “JSON” has it');
  });
});

describe('what the edition decides, in Settings and History (D24, D25)', { timeout: 30_000 }, () => {
  const HISTORY_IS_PRO = 'History is part of Pro. Nothing you do in the tools is kept in this version.';
  /**
   * The history host the page is handed, as a promise the shell reads at once (`settled`, the mark React's `use` reads
   * without suspending) — the way the page's own loader reads on every render after the first. A promise the shell has
   * to wait for was resumed by React only sometimes when the whole workspace was tested at once (the shell read it,
   * it was answered within milliseconds, and nothing was drawn for the rest of the wait): a race of the test
   * environment, seen in four runs of five. The wait itself — the page's first load — is what the first tests of this
   * file and the end-to-end checks of both editions cover.
   */
  const freeHost = () => {
    const loaded = settled(memoryHistoryHost(TOOLS, fixedSource('free')));
    return () => loaded;
  };
  const yourData = () => document.querySelector('[aria-labelledby="settings-data"]')?.textContent ?? '';
  /** The element, once the page has drawn it (the shell's code and the history host load first). */
  const found = (selector: string) =>
    waitFor(
      () => {
        const element = document.querySelector<HTMLElement>(selector);
        // What the page shows instead, when it never comes: the failure then says where the page was.
        if (!element)
          throw new Error(
            `${selector} is not on the page at ${window.location.hash}: ${(document.body.textContent ?? '').slice(0, 300) || '(nothing drawn)'}`,
          );
        return element;
      },
      { timeout: 15_000 },
    );

  it('Pro (the build’s root): Settings → Tools with its switch, the History block, and Your data names the history', async () => {
    setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    const tools = await found('[data-settings="tools"]');
    expect(within(tools).getByRole('switch', { name: 'Copy automatically after generating' })).toBeTruthy();
    expect(screen.getByRole('switch', { name: 'Keep a history of my tools' })).toBeTruthy();
    expect(yourData()).toContain('While History is on, the tools keep what you type');
  });

  it('free: no Settings → Tools, one sentence in place of Settings → History, and Your data does not speak of a history', async () => {
    setup('#/settings', {}, [], ownNewTab, freeHost());
    const block = await found('[data-settings="history"]');
    expect(block.querySelector('h2')?.textContent).toBe('History');
    expect(block.querySelector('p')?.textContent).toBe(HISTORY_IS_PRO);
    expect(block.querySelectorAll('button, [role="switch"], a, input')).toHaveLength(0);
    expect(document.querySelector('[data-settings="tools"]')).toBeNull();
    expect(screen.queryByRole('switch', { name: 'Copy automatically after generating' })).toBeNull();
    expect(yourData()).not.toMatch(/History/);
    expect(yourData()).toContain('“Last opened tool” and the search’s recent places). Never stored:');
  });

  it('the edition changes on the open page: Settings → Tools, the History block and Your data follow without a reload', async () => {
    const source = switchableSource(FREE);
    const loaded = settled(memoryHistoryHost(TOOLS, source));
    setup('#/settings', {}, [], ownNewTab, () => loaded);
    const block = await found('[data-settings="history"]');
    expect(block.querySelector('p')?.textContent).toBe(HISTORY_IS_PRO);
    expect(document.querySelector('[data-settings="tools"]')).toBeNull();
    const appearance = screen.getByRole('heading', { name: 'Appearance' });
    await act(async () => source.set(PRO));
    const tools = await found('[data-settings="tools"]');
    expect(within(tools).getByRole('switch', { name: 'Copy automatically after generating' })).toBeTruthy();
    await screen.findByRole('switch', { name: 'Keep a history of my tools' });
    expect(yourData()).toContain('While History is on, the tools keep what you type');
    // The same page, not drawn again from the start.
    expect(document.contains(appearance)).toBe(true);
    await act(async () => source.set(FREE));
    await waitFor(() => expect(document.querySelector('[data-settings="tools"]')).toBeNull());
    expect(document.querySelector('[data-settings="history"] p')?.textContent).toBe(HISTORY_IS_PRO);
    expect(yourData()).not.toMatch(/History/);
  });

  it('free: the History section stays, with its one sentence and nothing else', async () => {
    setup('#/history', {}, [], ownNewTab, freeHost());
    const section = await found('[data-page="history"]');
    expect(section.querySelector('h1')?.textContent).toBe('History');
    expect(section.querySelector('.kit-section-hint')?.textContent).toBe(HISTORY_IS_PRO);
    expect(section.textContent).toBe(`History${HISTORY_IS_PRO}`);
    expect(section.querySelectorAll('button, a, input, [role="switch"]')).toHaveLength(0);
  });

  describe('Settings → Pro, the line over History and Your data (pro-entitlement §6.7)', () => {
    const TODAY =
      'Never stored: what you type or paste into the start page’s field or the search. Nothing is sent anywhere until you press Enter on a web search, which goes to your browser’s search engine; an export goes only into the file you save.';
    const controls = {
      host: 'licence-fake.invalid',
      activate: vi.fn(async () => ({ ok: true }) as const),
      check: vi.fn(async () => ({ ok: true }) as const),
      deactivate: vi.fn(async () => ({ ok: true }) as const),
      remove: vi.fn(async () => ({ ok: true }) as const),
    };
    /** A source that follows a licence: the state the test sets, and the licence's controls. */
    const licensedHost = (initial = FREE) => {
      const source = { ...switchableSource(initial), licence: controls };
      const loaded = settled(memoryHistoryHost(TOOLS, source));
      return { source, history: () => loaded };
    };
    const licenceOf = (state: typeof PRO) => (state as Extract<typeof PRO, { kind: 'active' }>).licence;

    it('a fixed build — Pro (the root) or free — has no Pro block, and Your data says what it says today', async () => {
      setup('#/settings');
      await found('[data-settings="history"]');
      expect(document.querySelector('[data-settings="pro"]')).toBeNull();
      expect(screen.queryByRole('heading', { name: 'Pro' })).toBeNull();
      expect(yourData()).toContain(TODAY);
      expect(yourData()).not.toMatch(/licence|Pro plans/i);
      cleanup();
      setup('#/settings', {}, [], ownNewTab, freeHost());
      await found('[data-settings="history"]');
      expect(document.querySelector('[data-settings="pro"]')).toBeNull();
      expect(yourData()).toContain(TODAY);
    });

    it('a licensed build: the block between Shortcuts and Tools; Your data by the state, followed on the open page', async () => {
      const { source, history } = licensedHost(FREE);
      setup('#/settings', {}, [], ownNewTab, history);
      const block = await found('[data-settings="pro"]');
      expect(block.querySelector('h2')?.textContent).toBe('Pro');
      expect(within(block).getByRole('textbox', { name: 'Licence key' })).toBeTruthy();
      const order = [...document.querySelectorAll('.kit-settings > section h2')].map(h => h.textContent);
      expect(order.indexOf('Pro')).toBe(order.indexOf('Shortcuts') + 1);
      expect(yourData()).toContain(
        'Nothing is sent anywhere until you press Enter on a web search or ask to see the Pro plans, which goes',
      );
      expect(yourData()).toContain(
        'Pro plans: when you press See plans in Settings → Pro, the extension downloads the list of plans from licence-fake.invalid. The request carries nothing about you, and the list is kept in this browser to show it again.',
      );
      expect(yourData()).not.toContain('Licence: about once a week');
      await act(async () => source.set(PRO));
      await found('[data-settings="tools"]');
      expect(order.indexOf('Pro')).toBeLessThan(
        [...document.querySelectorAll('.kit-settings > section h2')].map(h => h.textContent).indexOf('Tools'),
      );
      expect(within(block).getByText('Pro is active in this browser.')).toBeTruthy();
      expect(yourData()).toContain(
        'Apart from the licence check below, nothing is sent anywhere until you press Enter on a web search, which goes',
      );
      expect(yourData()).toContain(
        'Licence: about once a week while you use the extension, it sends this licence’s number, this installation’s random number and a secret issued for it to licence-fake.invalid to keep Pro active, and downloads the plans list when you open Settings and it is older than a day. Nothing you type, paste or open in the tools, no settings and no history are ever sent.',
      );
    });

    it('History: the state’s line and Open Settings over the history in grace, over the sentence of D25 when Pro is off', async () => {
      const { source, history } = licensedHost({ kind: 'grace', licence: licenceOf(PRO) });
      setup('#/history', {}, [], ownNewTab, history);
      const notice = await found('[data-licence-notice]');
      expect(notice.getAttribute('data-licence-notice')).toBe('grace');
      expect(notice.textContent).toMatch(/^Couldn’t check your licence since .+\. Pro stays until .+\.Open Settings$/);
      expect(within(notice).getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe('#/settings');
      // Over the content: the history still records.
      expect(document.querySelector('[data-page="history"] .kit-history')?.firstElementChild).toBe(notice);
      await act(async () => source.set({ kind: 'expired', licence: licenceOf(PRO) }));
      const section = await found('[data-history-state="excluded"]');
      await waitFor(() =>
        expect(section.querySelector('[data-licence-notice]')?.getAttribute('data-licence-notice')).toBe('expired'),
      );
      expect(section.querySelector('.kit-section-hint')?.textContent).toBe(HISTORY_IS_PRO);
      await act(async () => source.set(FREE));
      await waitFor(() => expect(document.querySelector('[data-licence-notice]')).toBeNull());
      await act(async () => source.set(PRO));
      await found('[data-page="history"] .kit-history');
      expect(document.querySelector('[data-licence-notice]')).toBeNull();
    });
  });

  describe('a build that follows a licence (source `licensed`)', () => {
    const INST = 'q3V2mZ0bTEST0000000000';
    /** A licensed source over a fake storage whose record holds an active token signed with a key made now. */
    const licensedOver = async (read: 'answers' | 'never') => {
      const key = await makeTestKey();
      const storage = fakeStorage();
      storage.rows.set('entitlement', {
        v: 1,
        inst: INST,
        token: await signToken(claimsAt(Date.now(), { inst: INST }), {
          kid: key.publicKey.kid,
          privateKey: key.privateKey,
        }),
        seen: 0,
      });
      const local = read === 'answers' ? storage.area : { get: () => new Promise<never>(() => undefined) };
      return licensedSource({
        chrome: { storage: { local, onChanged: storage.onChanged }, runtime: { sendMessage: vi.fn() } as never },
        keys: [key.publicKey],
        host: 'licence.example.invalid',
      });
    };

    it('the host is built once the licence is read: an active licence is Pro on the first drawing', async () => {
      const source = await licensedOver('answers');
      const host = await whenEditionKnown(source, s => memoryHistoryHost(TOOLS, s));
      expect(source.current().kind).toBe('active');
      expect(host.licence?.state().kind).toBe('active');
      expect(host.licence?.host).toBe('licence.example.invalid');
      const loaded = settled(host);
      setup('#/settings', {}, [], ownNewTab, () => loaded);
      const tools = await found('[data-settings="tools"]');
      expect(within(tools).getByRole('switch', { name: 'Copy automatically after generating' })).toBeTruthy();
      source.dispose();
    });

    it('a storage that never answers: after 2 s the host is built without the licence — as the free edition', async () => {
      const source = await licensedOver('never');
      vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
      let host: ReturnType<typeof memoryHistoryHost> | undefined;
      try {
        const building = whenEditionKnown(source, s => memoryHistoryHost(TOOLS, s)).then(h => (host = h));
        await vi.advanceTimersByTimeAsync(1_999);
        expect(host).toBeUndefined();
        await vi.advanceTimersByTimeAsync(1);
        await building;
      } finally {
        vi.useRealTimers();
      }
      expect(source.current().kind).toBe('unknown');
      expect([host!.included, host!.automaticCopying]).toEqual([false, false]);
      const loaded = settled(host!);
      setup('#/settings', {}, [], ownNewTab, () => loaded);
      const block = await found('[data-settings="history"]');
      expect(block.querySelector('p')?.textContent).toBe(HISTORY_IS_PRO);
      expect(document.querySelector('[data-settings="tools"]')).toBeNull();
      source.dispose();
    });
  });
});
