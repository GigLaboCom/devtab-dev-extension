/**
 * The toolbar menu's items: the list's shape, what each says it opens, and that choosing it opens that — from a regular
 * window and from an incognito one.
 */
import { menuItems } from './items';
import { newTab } from '@src/newTab';
import { SECTION_DESTINATIONS, SETTINGS_DESTINATION } from '@src/shared/destinations';
import { APP_PAGE } from '@src/shared/pages';
import { fakeTabs } from '@src/test/fakes';
import { reuseTab } from '@src/toolbar/reuseTab';
import { describe, expect, it } from 'vitest';

const PAGE = `chrome-extension://test/${APP_PAGE}`;
const item = (id: string) => menuItems.find(i => i.id === id)!;
const deps = (...args: Parameters<typeof fakeTabs>) => ({ ...fakeTabs(...args), opener: reuseTab });

describe('the menu’s items', () => {
  it('have unique ids and one-line titles', () => {
    expect(new Set(menuItems.map(i => i.id)).size).toBe(menuItems.length);
    for (const i of menuItems) expect(i.title).toMatch(/^\S.{0,30}$/);
  });

  it('the start page as the build reaches it, then Tools, Compare code and History by address, then Settings', () => {
    expect(menuItems.map(i => i.title)).toEqual([newTab.start.title, 'Tools', 'Compare code', 'History', 'Settings']);
    expect(menuItems[0]!.opens).toEqual(newTab.start.opens);
    expect(item('tools').opens).toEqual({ route: '#/tools' });
    expect(item('compare').opens).toEqual({ route: '#/compare' });
    expect(item('history').opens).toEqual({ route: '#/history' });
    expect(item('settings').opens).toEqual({ options: true });
  });

  it('call the sections by their own titles', () => {
    for (const id of ['tools', 'compare', 'history'])
      expect(item(id).title).toBe(SECTION_DESTINATIONS.find(d => d.id === id)!.title);
    expect(item('settings').title).toBe(SETTINGS_DESTINATION.title);
  });
});

describe('Tools and Compare code', () => {
  it('open the main page at their route next to the current tab', async () => {
    const api = deps();
    await item('tools').open(api);
    expect(api.tabs.query).toHaveBeenCalledWith({ active: true, currentWindow: true });
    expect(api.tabs.create).toHaveBeenCalledWith({ windowId: 1, index: 3, url: `${PAGE}#/tools` });
  });

  it('bring an open tab of ours at that route to the front instead', async () => {
    const api = deps([{ tabId: 4, windowId: 1, documentUrl: `${PAGE}#/compare` }]);
    await item('compare').open(api);
    expect(api.tabs.update).toHaveBeenCalledWith(4, { active: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('from an incognito window: in a regular window, brought forward (our pages never run in incognito)', async () => {
    const api = deps([], { id: 20, windowId: 9, index: 0, incognito: true }, 2);
    await item('tools').open(api);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: `${PAGE}#/tools` });
    expect(api.windows.update).toHaveBeenCalledWith(2, { focused: true });
  });
});

describe('the start entry', () => {
  it('opens what the build’s New Tab override says', async () => {
    const api = deps();
    await menuItems[0]!.open(api);
    expect(api.tabs.create).toHaveBeenCalledWith(
      newTab.start.opens.route
        ? { windowId: 1, index: 3, url: `${PAGE}${newTab.start.opens.route}` }
        : { windowId: 1, index: 3 },
    );
  });
});

describe('Settings', () => {
  it('opens the extension’s options page and nothing else', async () => {
    const api = deps();
    await item('settings').open(api);
    expect(api.runtime.openOptionsPage).toHaveBeenCalledTimes(1);
    expect(api.tabs.create).not.toHaveBeenCalled();
  });
});
