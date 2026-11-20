/** The extension's own pages (built by vite.config.ts as inputs, not manifest entries). */
export const APP_PAGE = 'src/app/index.html';
export const VIEWER_PAGE = 'src/viewer/index.html';

/** The open main page's tab, if any; undefined when there is none or Chrome cannot say. */
export const findAppTab = async (
  runtime: Pick<typeof chrome.runtime, 'getURL' | 'getContexts'>,
): Promise<{ tabId: number; windowId: number } | undefined> => {
  try {
    const url = runtime.getURL(APP_PAGE);
    const contexts = await runtime.getContexts({ contextTypes: ['TAB' as chrome.runtime.ContextType] });
    // The page carries its section in the hash (#/compare), so match on the URL without it.
    const context = contexts.find(c => c.tabId >= 0 && c.documentUrl?.split('#')[0] === url);
    return context ? { tabId: context.tabId, windowId: context.windowId } : undefined;
  } catch {
    return undefined;
  }
};

/**
 * The toolbar button: the main page in a tab — an open one is brought forward instead of opening a second.
 * `runtime.getContexts` sees the extension's own tabs, and `tabs.create` / `tabs.update` / `windows.update` need no
 * `tabs` permission.
 */
export const openAppPage = async (api: {
  runtime: Pick<typeof chrome.runtime, 'getURL' | 'getContexts'>;
  tabs: Pick<typeof chrome.tabs, 'create' | 'update'>;
  windows: Pick<typeof chrome.windows, 'update'>;
}): Promise<void> => {
  const open = await findAppTab(api.runtime);
  if (open) {
    await api.windows.update(open.windowId, { focused: true });
    await api.tabs.update(open.tabId, { active: true });
    return;
  }
  await api.tabs.create({ url: api.runtime.getURL(APP_PAGE) });
};
