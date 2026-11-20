import { APP_PAGE, openAppPage } from './pages';
import { describe, expect, it, vi } from 'vitest';

const ORIGIN = 'chrome-extension://test/';

const fakeApi = (contexts: Array<{ tabId: number; windowId: number; documentUrl?: string }>) => ({
  runtime: {
    getURL: (path: string) => ORIGIN + path,
    getContexts: vi.fn(() => Promise.resolve(contexts as chrome.runtime.ExtensionContext[])),
  },
  tabs: { create: vi.fn(() => Promise.resolve({})), update: vi.fn(() => Promise.resolve({})) },
  windows: { update: vi.fn(() => Promise.resolve({})) },
});

describe('openAppPage (the toolbar button)', () => {
  it('opens the main page in a new tab when none is open', async () => {
    const api = fakeApi([]);
    await openAppPage(api as never);
    expect(api.tabs.create).toHaveBeenCalledWith({ url: ORIGIN + APP_PAGE });
    expect(api.tabs.update).not.toHaveBeenCalled();
  });

  it('brings an open main page forward — whatever section its hash shows — instead of a second tab', async () => {
    const api = fakeApi([
      { tabId: -1, windowId: -1, documentUrl: ORIGIN + 'src/background/index.ts' },
      { tabId: 7, windowId: 3, documentUrl: ORIGIN + APP_PAGE + '#/tools/json' },
    ]);
    await openAppPage(api as never);
    expect(api.windows.update).toHaveBeenCalledWith(3, { focused: true });
    expect(api.tabs.update).toHaveBeenCalledWith(7, { active: true });
    expect(api.tabs.create).not.toHaveBeenCalled();
  });

  it('opens a tab when Chrome cannot list the contexts', async () => {
    const api = fakeApi([]);
    api.runtime.getContexts.mockRejectedValueOnce(new Error('unsupported'));
    await openAppPage(api as never);
    expect(api.tabs.create).toHaveBeenCalledTimes(1);
  });
});
