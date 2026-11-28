/**
 * Seam `OwnTab` — what the Projects page may do with its own tab when a file arrives (docs/research/open-with.md §3.1,
 * probe П1): bring the tab and its window forward (`tabs.update {active}` and `windows.update {focused}` on its own tab
 * need no permission), or hand the file to a new tab of the extension's page (`tabs.create`, no permission either). It
 * never looks at another tab. Whether the window really comes in front of other applications is the system's (macOS
 * since 14 lets only the active application hand activation over) — the page asks, and a refusal is no error.
 */

export interface OwnTab {
  /** Brings this page's tab and window forward; resolves whatever happens. */
  bringForward(): Promise<void>;
  /** Opens the extension's page at `hash` in a new tab next to this one; resolves whatever happens. */
  openTab(hash: string): Promise<void>;
}

export interface OwnTabApi {
  tabs: Pick<typeof chrome.tabs, 'getCurrent' | 'update' | 'create'>;
  windows: Pick<typeof chrome.windows, 'update'>;
}

export const chromeOwnTab = (
  api: () => OwnTabApi | null,
  address: () => string = () => `${location.origin}${location.pathname}`,
): OwnTab => {
  const current = async (): Promise<chrome.tabs.Tab | undefined> => {
    try {
      return await api()?.tabs.getCurrent();
    } catch {
      return undefined;
    }
  };
  return {
    async bringForward() {
      const found = api();
      const tab = await current();
      if (!found || tab?.id === undefined) return;
      try {
        await found.tabs.update(tab.id, { active: true });
        await found.windows.update(tab.windowId, { focused: true });
      } catch {
        // asked; the browser or the system said no
      }
    },
    async openTab(hash) {
      const found = api();
      if (!found) return;
      const tab = await current();
      try {
        await found.tabs.create({
          url: `${address()}${hash}`,
          ...(tab && { windowId: tab.windowId, index: tab.index + 1, openerTabId: tab.id }),
        });
      } catch {
        // nothing opened
      }
    },
  };
};

/** The extension's own API, where the page has it. */
export const extensionOwnTab = (): OwnTab =>
  chromeOwnTab(() =>
    typeof chrome !== 'undefined' &&
    typeof chrome.tabs?.getCurrent === 'function' &&
    typeof chrome.windows?.update === 'function'
      ? { tabs: chrome.tabs, windows: chrome.windows }
      : null,
  );

/** Does nothing: a host that is not a tab, and tests. */
export const noOwnTab: OwnTab = { bringForward: () => Promise.resolve(), openTab: () => Promise.resolve() };
