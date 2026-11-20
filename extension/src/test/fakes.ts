/** Test doubles of the chrome APIs the pages touch (chrome.storage.local + onChanged, runtime.getURL). */
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
        rows.set(k, v);
        changes[k] = { newValue: v };
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

/** A `chrome` global with the storage above and an extension origin. */
export const fakeChrome = () => {
  const storage = fakeStorage();
  return {
    storage,
    api: {
      runtime: { getURL: (path: string) => `chrome-extension://test/${path}` },
      storage: { local: storage.area, onChanged: storage.onChanged },
    },
  };
};
