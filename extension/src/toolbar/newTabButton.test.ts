/**
 * The button without a menu: a click opens the start page as the build's New Tab override says — a new tab when the
 * build is the New Tab page (src/shared/pages.test.ts has the rest), the page by its address when it is not (the
 * start entry of each override, src/newTab/overrides.test.ts).
 */
import { listenForClicks } from './button';
import { newTabButton } from './newTabButton';
import { reuseTab } from './reuseTab';
import { newTab } from '@src/newTab';
import { fakeTabs } from '@src/test/fakes';
import { describe, expect, it, vi } from 'vitest';

describe('newTabButton', () => {
  const setUp = () => {
    let clicked: ((tab?: chrome.tabs.Tab) => void) | undefined;
    const api = {
      ...fakeTabs([], null, 3),
      action: { onClicked: { addListener: (l: (tab?: chrome.tabs.Tab) => void) => void (clicked = l) } },
      opener: reuseTab,
    };
    listenForClicks(api, newTabButton, e => {
      throw e;
    });
    return { api, click: (tab: Partial<chrome.tabs.Tab>) => clicked!(tab as chrome.tabs.Tab) };
  };

  it('has no popup', () => {
    expect(newTabButton.popup).toBeUndefined();
  });

  it('a click opens the start page as the build reaches it, next to the clicked tab', async () => {
    const { api, click } = setUp();
    click({ id: 1, windowId: 2, index: 3, incognito: false });
    const expected = newTab.start.opens.route
      ? { windowId: 2, index: 4, url: `chrome-extension://test/src/app/index.html${newTab.start.opens.route}` }
      : { windowId: 2, index: 4 };
    await vi.waitFor(() => expect(api.tabs.create).toHaveBeenCalledWith(expected));
  });

  it('in an incognito window, the main page by its address, in a regular window brought forward', async () => {
    const { api, click } = setUp();
    click({ id: 1, windowId: 5, index: 0, incognito: true });
    await vi.waitFor(() => expect(api.windows.update).toHaveBeenCalledWith(3, { focused: true }));
    expect(api.tabs.create.mock.calls[0]![0].url).toMatch(/^chrome-extension:\/\/test\/src\/app\/index\.html/);
  });
});
