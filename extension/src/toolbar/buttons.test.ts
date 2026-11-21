/**
 * The shared contract of seam `ToolbarButton`, run against every implementation: what the manifest, the build and the
 * service worker derive from a definition is right for it, whichever is chosen in index.ts.
 */
import { actionOf, listenForClicks, pagesOf } from './button';
import { menuButton } from './menuButton';
import { newTabButton } from './newTabButton';
import { reuseTab } from './reuseTab';
import { fakeTabs } from '@src/test/fakes';
import { describe, expect, it, vi } from 'vitest';
import type { ToolbarButton } from './button';

const IMPLEMENTATIONS: readonly ToolbarButton[] = [newTabButton, menuButton];
// The extension's pages, by their path from the extension's root.
const PAGES = Object.keys(import.meta.glob('../**/index.html')).map(path => `src/${path.slice('../'.length)}`);

type Clicked = (tab?: chrome.tabs.Tab) => void;

const fakeApi = () => {
  const listeners: Clicked[] = [];
  return {
    ...fakeTabs(),
    listeners,
    action: { onClicked: { addListener: vi.fn((l: Clicked) => void listeners.push(l)) } },
    opener: reuseTab,
  };
};

const TAB = { id: 1, windowId: 1, index: 0, incognito: false } as chrome.tabs.Tab;

describe.each(IMPLEMENTATIONS.map(b => [b.id, b] as const))('ToolbarButton %s', (_id, button) => {
  it('is exactly one of the two: a popup page, or a click', () => {
    expect(typeof button.popup === 'string').not.toBe(typeof button.click === 'function');
  });

  it('the manifest’s action: its own fields, and default_popup exactly when the button has a page', () => {
    const base = { default_title: 'x', default_icon: { 16: 'i.png' } };
    const action = actionOf(button, base);
    expect(action).toMatchObject(base);
    expect(action.default_popup).toBe(button.popup);
    expect('default_popup' in action).toBe(!!button.popup);
  });

  it('the build’s pages: its popup page, which exists, or none', () => {
    const pages = Object.values(pagesOf(button));
    expect(pages).toEqual(button.popup ? [button.popup] : []);
    for (const page of pages) expect(PAGES).toContain(page);
  });

  it('the service worker listens for clicks exactly when there is no popup (Chrome sends none with one)', () => {
    const api = fakeApi();
    listenForClicks(api, button, () => undefined);
    expect(api.listeners).toHaveLength(button.popup ? 0 : 1);
  });

  it('a click that fails reaches onError, not an unhandled rejection', async () => {
    const api = fakeApi();
    api.tabs.create.mockRejectedValue(new Error('no window'));
    const onError = vi.fn();
    listenForClicks(api, button, onError);
    for (const l of api.listeners) l(TAB);
    await vi.waitFor(() => expect(onError).toHaveBeenCalledTimes(api.listeners.length));
  });

  it('loads where there is no chrome (the manifest and the build check read it outside the app)', () => {
    // This file imported the definition with no `chrome` global: touching one at creation would have thrown.
    expect(typeof (globalThis as { chrome?: unknown }).chrome).toBe('undefined');
  });
});
