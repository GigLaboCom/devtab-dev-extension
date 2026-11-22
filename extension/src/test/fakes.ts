/**
 * Test doubles of the chrome APIs the pages touch (chrome.storage.local + onChanged, runtime.getURL, permissions, search,
 * history).
 */
import { vi } from 'vitest';

type Changes = Record<string, chrome.storage.StorageChange>;
type Listener = (changes: Changes, area: string) => void;

export const fakeStorage = () => {
  const rows = new Map<string, unknown>();
  const listeners = new Set<Listener>();
  const area = {
    get: (key: string) => Promise.resolve(rows.has(key) ? { [key]: rows.get(key) } : {}),
    set: (items: Record<string, unknown>) => {
      const changes: Changes = {};
      for (const [k, v] of Object.entries(items)) {
        // As Chrome reports a change: the old value too, when there was one.
        changes[k] = rows.has(k) ? { oldValue: rows.get(k), newValue: v } : { newValue: v };
        rows.set(k, v);
      }
      for (const l of listeners) l(changes, 'local');
      return Promise.resolve();
    },
  } as unknown as Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  const onChanged = {
    addListener: (l: Listener) => void listeners.add(l),
    removeListener: (l: Listener) => void listeners.delete(l),
  } as unknown as chrome.storage.StorageChangedEvent;
  return { rows, area, onChanged, listeners };
};

/**
 * chrome.permissions over a set of held optional permissions. `request` answers with `answer` (Chrome's prompt) and,
 * when it allows, adds the permission and tells the listeners — as Chrome does.
 */
export const fakePermissions = (held = new Set<string>(), answer = true) => {
  const added = new Set<() => void>();
  const removed = new Set<() => void>();
  const event = (set: Set<() => void>) => ({
    addListener: (l: () => void) => void set.add(l),
    removeListener: (l: () => void) => void set.delete(l),
  });
  const api = {
    held,
    contains: vi.fn(({ permissions = [] }: chrome.permissions.Permissions) =>
      Promise.resolve(permissions.every(p => held.has(p))),
    ),
    request: vi.fn(({ permissions = [] }: chrome.permissions.Permissions) => {
      if (answer) for (const p of permissions) held.add(p);
      if (answer) for (const l of added) l();
      return Promise.resolve(answer);
    }),
    remove: vi.fn(({ permissions = [] }: chrome.permissions.Permissions) => {
      for (const p of permissions) held.delete(p);
      for (const l of removed) l();
      return Promise.resolve(true);
    }),
    onAdded: event(added),
    onRemoved: event(removed),
  };
  return api;
};

/** A `chrome` global with the storage above and an extension origin. */
export const fakeChrome = () => {
  const storage = fakeStorage();
  const permissions = fakePermissions();
  return {
    storage,
    permissions,
    api: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}` },
      storage: { local: storage.area, onChanged: storage.onChanged },
      permissions,
      search: { query: vi.fn(() => Promise.resolve()) },
      history: { search: vi.fn(() => Promise.resolve([] as chrome.history.HistoryItem[])) },
    },
  };
};

/**
 * The browser as the toolbar sees it (runtime, tabs, windows — none of it needs a permission): `contexts` are the tabs of
 * ours runtime.getContexts reports, `current` the active tab tabs.query answers with. A tab asked for from an incognito
 * window (no windowId given) lands in window `regular`, as Chrome does for an extension in spanning mode.
 */
export const fakeTabs = (
  contexts: Array<Partial<chrome.runtime.ExtensionContext>> = [],
  current: Partial<chrome.tabs.Tab> | null = { id: 10, windowId: 1, index: 2, incognito: false },
  regular = 1,
) => ({
  runtime: {
    getURL: (path: string) => `chrome-extension://test/${path.replace(/^\//, '')}`,
    getContexts: vi.fn(() => Promise.resolve(contexts as chrome.runtime.ExtensionContext[])),
    openOptionsPage: vi.fn(() => Promise.resolve()),
  },
  tabs: {
    create: vi.fn((props: chrome.tabs.CreateProperties) =>
      Promise.resolve({ id: 99, windowId: props.windowId ?? regular } as chrome.tabs.Tab),
    ),
    update: vi.fn(() => Promise.resolve({} as chrome.tabs.Tab)),
    query: vi.fn(() => Promise.resolve(current ? [current as chrome.tabs.Tab] : [])),
  },
  windows: { update: vi.fn(() => Promise.resolve({} as chrome.windows.Window)) },
});
