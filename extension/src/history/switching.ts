/**
 * What lets the history root change the edition in force on an open page: a store and a key holder that forward every
 * call to the one in use, and change it for the calls that follow. The factory, the cipher and the lists are built
 * once over these; when the edition changes, the root opens the other edition's store first and only then switches
 * (src/history/behaviors.ts).
 */
import type { HistoryStore, KeyHolder } from '@workspace/tools-shared/history';

type Holder = KeyHolder & { touch(): void; dispose(): void };

/** A HistoryStore that forwards every call to the store in use; `use` changes it for the calls that follow. */
export const switchingStore = (
  initial: HistoryStore,
): { readonly store: HistoryStore; use(next: HistoryStore): void } => {
  let current = initial;
  const store: HistoryStore = {
    add: (lines, blobs) => current.add(lines, blobs),
    hasBlobs: hashes => current.hasBlobs(hashes),
    get: id => current.get(id),
    blob: hash => current.blob(hash),
    page: (filter, options) => current.page(filter, options),
    // A scan already begun reads the store it began with to its end.
    scan: filter => current.scan(filter),
    measure: filter => current.measure(filter),
    delete: filter => current.delete(filter),
    stats: () => current.stats(),
    keyrings: () => current.keyrings(),
    putKeyring: (kid, line) => current.putKeyring(kid, line),
    deleteKeyring: kid => current.deleteKeyring(kid),
  };
  return {
    store,
    use: next => {
      current = next;
    },
  };
};

/**
 * The same for the master password's key holder (memory or chrome.storage.session). Listeners follow the holder in use;
 * switching tells them once, so whoever reads the keys (the cipher) reads them again from the new one.
 */
export const switchingHolder = (initial: Holder): { readonly holder: Holder; use(next: Holder): void } => {
  let current = initial;
  const listeners = new Set<() => void>();
  const tell = () => listeners.forEach(l => l());
  let undo = current.subscribe(tell);
  const holder: Holder = {
    get: () => current.get(),
    set: keys => current.set(keys),
    clear: () => current.clear(),
    subscribe: listener => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    touch: () => current.touch(),
    dispose: () => {
      undo();
      current.dispose();
    },
  };
  return {
    holder,
    use: next => {
      if (next === current) return;
      undo();
      current = next;
      undo = current.subscribe(tell);
      tell();
    },
  };
};
