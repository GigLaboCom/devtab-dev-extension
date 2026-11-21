/** "Recently closed": what it reads, what it shows, and that it reads nothing it should not. */
import { recentlyClosedPart } from './recentlyClosed';
import { pickRecentlyClosed } from './recentlyClosed.data';
import { DEFAULT_STATE } from '../settings';
import { describe, expect, it, vi } from 'vitest';
import type { PartDeps } from './deps';

const tab = (url: string | undefined, title = ''): chrome.tabs.Tab => ({ url, title }) as chrome.tabs.Tab;
const SESSIONS: chrome.sessions.Session[] = [
  { lastModified: 30, tab: tab('https://one.example/a', 'One') },
  {
    lastModified: 50,
    window: { tabs: [tab('https://three.example/c', 'Three'), tab('https://four.example/d')] } as chrome.windows.Window,
  },
  { lastModified: 20, tab: tab('chrome://settings/', 'Settings') },
  { lastModified: 10, tab: tab('https://one.example/a', 'One again') },
  { lastModified: 5, tab: tab('chrome-extension://id/src/app/index.html#/tools/json', 'JSON') },
  { lastModified: 4, tab: tab(undefined) },
];

const part = (sessions: Partial<typeof chrome.sessions> | undefined, afterPaint = () => Promise.resolve()) =>
  recentlyClosedPart({
    chrome: { sessions } as unknown as typeof chrome,
    afterPaint,
  } as PartDeps);

describe('recently closed', () => {
  it('asks Chrome for `sessions` and `tabs` together, and says what Chrome’s prompt says', () => {
    const definition = part(undefined);
    expect(definition.permissions.map(p => [p.name, p.optional])).toEqual([
      ['sessions', true],
      ['tabs', true],
    ]);
    expect(definition.prompt).toBe('Read your browsing history on all your signed-in devices');
    expect(definition.defaultOn).toBe(false);
  });

  it('newest first, a closed window as its tabs, one tile per address, titled by the page or its host', () => {
    expect(pickRecentlyClosed(SESSIONS).map(t => [t.title, t.href])).toEqual([
      ['Three', 'https://three.example/c'],
      ['four.example', 'https://four.example/d'],
      ['One', 'https://one.example/a'],
    ]);
    expect(pickRecentlyClosed(SESSIONS, 2)).toHaveLength(2);
  });

  it('reads this browser’s closed tabs only — at most 25, after the first paint; never other devices', async () => {
    const getRecentlyClosed = vi.fn(() => Promise.resolve(SESSIONS));
    const getDevices = vi.fn(() => Promise.resolve([]));
    let painted!: () => void;
    const pending = part({ getRecentlyClosed, getDevices }, () => new Promise(r => (painted = r))).tiles.tiles(
      DEFAULT_STATE,
    );
    await Promise.resolve();
    expect(getRecentlyClosed).not.toHaveBeenCalled();
    painted();
    expect((await pending).map(t => t.href)).toContain('https://one.example/a');
    expect(getRecentlyClosed).toHaveBeenCalledWith({ maxResults: 25 });
    expect(getDevices).not.toHaveBeenCalled();
  });

  it('without the permission (no chrome.sessions) reads nothing and shows nothing', async () => {
    expect(await part(undefined).tiles.tiles(DEFAULT_STATE)).toEqual([]);
  });
});
