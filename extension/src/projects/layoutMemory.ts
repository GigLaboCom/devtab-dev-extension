/**
 * Where the Projects section remembers its panels (./layout.ts) — the way the shell keeps its sidebar groups
 * (src/shell/store.ts): `chrome.storage.local` is the source of truth, and `localStorage` keeps a copy the page reads in
 * its first render, so a panel the person collapsed is not drawn open for a moment. One record for the extension.
 * Not watched across tabs: a panel collapsed in one tab does not collapse in another (an IDE's windows keep their own
 * until reopened).
 */
import { normalizeLayout } from './layout';
import type { ProjectsLayout } from './layout';

/** chrome.storage.local key (the source of truth). */
export const LAYOUT_KEY = 'projectsLayout';
/** localStorage key of the copy read in the first render. */
export const LAYOUT_CACHE_KEY = 'projects-layout-cache';

export interface LayoutMemory {
  /** The copy the first render can read at once, or null when there is none. */
  initial(): ProjectsLayout | null;
  /** The stored layout, or null when nothing is stored (or the storage cannot be read). */
  load(): Promise<ProjectsLayout | null>;
  /** Remembers the layout; a failure only loses the memory, never the page's state. */
  save(layout: ProjectsLayout): void;
}

export interface LayoutMemoryDeps {
  area: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  win: Pick<Window, 'localStorage'>;
}

/** The extension's memory: chrome.storage.local and its localStorage copy. */
export const storedLayout = (deps: () => LayoutMemoryDeps | null): LayoutMemory => ({
  initial() {
    try {
      const raw = deps()?.win.localStorage.getItem(LAYOUT_CACHE_KEY);
      return raw ? normalizeLayout(JSON.parse(raw)) : null;
    } catch {
      return null;
    }
  },
  async load() {
    try {
      const area = deps()?.area;
      if (!area) return null;
      const stored = (await area.get(LAYOUT_KEY))[LAYOUT_KEY];
      return stored === undefined ? null : normalizeLayout(stored);
    } catch {
      return null;
    }
  },
  save(layout) {
    const found = deps();
    if (!found) return;
    const value = normalizeLayout(layout);
    try {
      found.win.localStorage.setItem(LAYOUT_CACHE_KEY, JSON.stringify(value));
    } catch {
      // a copy only: without it the stored layout arrives a moment later
    }
    found.area.set({ [LAYOUT_KEY]: value }).catch(() => undefined);
  },
});

/** chrome.storage.local of the page, when there is one (not in a test or on a page without the extension's API). */
export const chromeLayoutMemory = (): LayoutMemory =>
  storedLayout(() =>
    typeof chrome !== 'undefined' && chrome.storage?.local ? { area: chrome.storage.local, win: window } : null,
  );

/** Remembers for the page's life only: a host without storage, and tests. */
export const memoryLayout = (start: ProjectsLayout | null = null): LayoutMemory => {
  let kept = start;
  return {
    initial: () => kept,
    load: () => Promise.resolve(kept),
    save: layout => {
      kept = normalizeLayout(layout);
    },
  };
};
