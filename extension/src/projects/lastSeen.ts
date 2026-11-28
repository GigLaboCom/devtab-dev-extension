/**
 * Seam `LastSeen` — where the Projects section remembers when the person last looked at a project (the companion's
 * specification §7.5, «пока меня не было»): the history then offers what changed since (`history.project {since}`).
 * The default keeps one number per project in `chrome.storage.local` (`projects.lastSeen.<id>`), written when the
 * person leaves the project (another project, the section, the tab hidden or closed); a page without the extension's
 * storage remembers for its own life only. Nothing about the files is stored: a time, keyed by the companion's id.
 */

/** chrome.storage.local key of a project's last visit: this prefix and the project's id. */
export const LAST_SEEN_PREFIX = 'projects.lastSeen.';

export interface LastSeen {
  /** When the person last left the project (ms since the epoch), or null: never, or the storage cannot be read. */
  get(project: string): Promise<number | null>;
  /** Remembers a visit; a failure only loses the memory. */
  set(project: string, ms: number): void;
}

const valid = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;

/** The extension's memory: one key per project in chrome.storage.local. */
export const storedLastSeen = (area: () => Pick<chrome.storage.StorageArea, 'get' | 'set'> | null): LastSeen => ({
  async get(project) {
    try {
      const found = area();
      if (!found) return null;
      const key = LAST_SEEN_PREFIX + project;
      return valid((await found.get(key))[key]);
    } catch {
      return null;
    }
  },
  set(project, ms) {
    try {
      area()
        ?.set({ [LAST_SEEN_PREFIX + project]: ms })
        .catch(() => undefined);
    } catch {
      // the memory only
    }
  },
});

/** chrome.storage.local of the page, when there is one. */
export const chromeLastSeen = (): LastSeen =>
  storedLastSeen(() => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null));

/** Remembers for the page's life only: a host without storage, and tests. */
export const memoryLastSeen = (start: Record<string, number> = {}): LastSeen & { kept: Record<string, number> } => {
  const kept = { ...start };
  return {
    kept,
    get: project => Promise.resolve(valid(kept[project])),
    set(project, ms) {
      kept[project] = ms;
    },
  };
};
