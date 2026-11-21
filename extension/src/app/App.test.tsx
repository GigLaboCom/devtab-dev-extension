/**
 * The main page in jsdom over a fake `chrome`: a new tab (no hash) is the start page — its field finds and opens our
 * places, opens a tool with pasted text and hands other text to the web search seam; its parts follow the switches of
 * Settings; the shell's three parts are reachable; the theme switch writes the choice to chrome.storage.local.
 */
import { App } from './App';
import { THEME_STORAGE_KEY } from '@extension/theme';
import { browserNewTab } from '@src/newTab/browserNewTab';
import { ownNewTab } from '@src/newTab/ownNewTab';
import { startBehaviors } from '@src/start/behaviors';
import { RECENT_KEY, SETTINGS_KEY, SHORTCUTS_KEY, START_CACHE_KEY } from '@src/start/settings';
import { fakeChrome } from '@src/test/fakes';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { AppDeps } from './App';
import type { PermissionsApi } from './useStart';
import type { NewTabOverride } from '@src/newTab/override';

const setup = (
  hash: string,
  rows: Record<string, unknown> = {},
  held: string[] = [],
  newTab: NewTabOverride = ownNewTab,
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
  };
  const { unmount } = render(<App deps={deps} />);
  return { storage, permissions, search, history: api.history.search, unmount };
};

const field = () => screen.getByRole('combobox', { name: 'Find a tool or search the web' });
const type = (text: string) => fireEvent.change(field(), { target: { value: text } });
const enter = () => fireEvent.keyDown(field(), { key: 'Enter' });
const paste = (text: string) =>
  fireEvent.paste(field(), { clipboardData: { getData: (kind: string) => (kind === 'text/plain' ? text : '') } });
const row = (name: string) => screen.queryByRole('region', { name });

afterEach(() => {
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
    expect(within(row('Tools')!).getByRole('link', { name: 'JSON' }).getAttribute('href')).toBe('#/tools/json');
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
    paste('{"b":1,"a":[1,2]}');
    expect(window.location.hash).toBe('#/tools/json');
    expect(((await screen.findByLabelText('Input')) as HTMLTextAreaElement).value).toBe('{"b":1,"a":[1,2]}');
  });

  it('pasted text no tool recognises stays in the field', () => {
    setup('');
    paste('just words');
    expect(window.location.hash).toBe('');
  });

  it('Enter on text nothing of ours matches hands it to the web search seam', () => {
    const { search } = setup('');
    type('kittens 42');
    expect(screen.getAllByRole('option')).toHaveLength(1);
    enter();
    expect(search).toHaveBeenCalledWith({ text: 'kittens 42', disposition: 'CURRENT_TAB' });
    expect(window.location.hash).toBe('');
  });

  it('arrows move the row Enter takes', () => {
    const { search } = setup('');
    type('json');
    fireEvent.keyDown(field(), { key: 'ArrowUp' });
    expect(screen.getAllByRole('option').at(-1)!.getAttribute('aria-selected')).toBe('true');
    enter();
    expect(search).toHaveBeenCalledWith({ text: 'json', disposition: 'CURRENT_TAB' });
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
    fireEvent.click(screen.getByRole('button', { name: 'Add shortcut' }));
    fireEvent.change(screen.getByLabelText('Title'), { target: { value: 'Docs' } });
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

  it('draws the parts from the localStorage copy in the first render (no flash before chrome.storage answers)', () => {
    window.localStorage.setItem(
      START_CACHE_KEY,
      JSON.stringify({ settings: { parts: { tools: false } }, shortcuts: [{ id: 'a', title: 'A', url: 'a.example' }] }),
    );
    setup('');
    expect(row('Tools')).toBeNull();
    expect(within(row('My shortcuts')!).getByRole('link', { name: /A/ })).toBeTruthy();
  });

  it('remembers the sections and tools opened, most recent first, for the Tools tiles', async () => {
    const { storage } = setup('#/review');
    await screen.findByRole('heading', { name: 'Companion app required' });
    await waitFor(() => expect(storage.rows.get(RECENT_KEY)).toEqual({ last: '#/review', used: ['#/review'] }));
    act(() => {
      window.location.hash = '#/start';
      window.dispatchEvent(new HashChangeEvent('hashchange'));
    });
    const tiles = within(await screen.findByRole('region', { name: 'Tools' })).getAllByRole('link');
    expect(tiles[0].textContent).toBe('Live review');
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
    const tiles = await within(await screen.findByRole('region', { name: 'Recently opened' })).findAllByRole('link');
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

describe('settings', () => {
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

  it('shows the same theme picker as the sidebar', async () => {
    setup('#/settings');
    await screen.findByRole('heading', { name: 'Appearance' });
    expect(screen.getAllByRole('radio', { name: 'Dark' })).toHaveLength(2);
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
    fireEvent.change(input, { target: { value: '{"b":1,"a":[1,2]}' } });
    fireEvent.click(screen.getByRole('button', { name: 'Format' }));
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
    const { storage } = setup('#/compare');
    await screen.findByRole('heading', { name: 'Compare code' });
    await act(async () => {
      fireEvent.click(screen.getByRole('radio', { name: 'Dark' }));
    });
    expect(storage.rows.get(THEME_STORAGE_KEY)).toMatchObject({ mode: 'dark' });
    expect(document.documentElement.dataset.theme).toBe('default-dark');
  });
});
