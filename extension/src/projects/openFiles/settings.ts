/**
 * Seam `OpenFilesSettings` — what the page keeps about files opened from the system (docs/research/open-with.md §5.4,
 * the two settings that live in the extension; everything else — which entries are on, which browser and profile, which
 * file types — is the companion's, set in the terminal):
 *
 *   reuseTab      a file the companion hands to a connected page opens in that page's tab (true), or in a new tab of
 *                 its own (false)
 *   bringForward  the page brings its tab and window forward when a file arrives
 *   opened        a file was opened here once: from then on the «Files» group shows even when its list is empty
 *
 * One key each in `chrome.storage.local`; the page's memory where there is none. A failed write only loses the memory.
 */

/** chrome.storage.local keys. */
export const OPEN_FILES_REUSE_TAB_KEY = 'openFiles.reuseTab';
export const OPEN_FILES_BRING_FORWARD_KEY = 'openFiles.bringForward';
export const OPEN_FILES_OPENED_KEY = 'openFiles.opened';

export interface OpenFilesSettings {
  reuseTab: boolean;
  bringForward: boolean;
  opened: boolean;
}

/** The defaults (D22): the same tab, brought forward; nothing opened yet. */
export const OPEN_FILES_DEFAULTS: Readonly<OpenFilesSettings> = { reuseTab: true, bringForward: true, opened: false };

export interface OpenFilesSettingsStore {
  get(): Promise<OpenFilesSettings>;
  set(change: Partial<OpenFilesSettings>): Promise<void>;
}

const KEYS: Record<keyof OpenFilesSettings, string> = {
  reuseTab: OPEN_FILES_REUSE_TAB_KEY,
  bringForward: OPEN_FILES_BRING_FORWARD_KEY,
  opened: OPEN_FILES_OPENED_KEY,
};

const fromStored = (stored: Record<string, unknown>): OpenFilesSettings => {
  const flag = (name: keyof OpenFilesSettings): boolean =>
    typeof stored[KEYS[name]] === 'boolean' ? (stored[KEYS[name]] as boolean) : OPEN_FILES_DEFAULTS[name];
  return { reuseTab: flag('reuseTab'), bringForward: flag('bringForward'), opened: flag('opened') };
};

/** Over an area of the extension's storage (or none: the defaults, nothing kept). */
export const storedOpenFilesSettings = (
  area: () => Pick<chrome.storage.StorageArea, 'get' | 'set'> | null,
): OpenFilesSettingsStore => ({
  async get() {
    try {
      const found = area();
      return found ? fromStored(await found.get(Object.values(KEYS))) : { ...OPEN_FILES_DEFAULTS };
    } catch {
      return { ...OPEN_FILES_DEFAULTS };
    }
  },
  async set(change) {
    const entries = Object.entries(change).filter(([, v]) => typeof v === 'boolean');
    if (!entries.length) return;
    try {
      await area()?.set(Object.fromEntries(entries.map(([k, v]) => [KEYS[k as keyof OpenFilesSettings], v])));
    } catch {
      // the memory only
    }
  },
});

export const chromeOpenFilesSettings = (): OpenFilesSettingsStore =>
  storedOpenFilesSettings(() => (typeof chrome !== 'undefined' && chrome.storage?.local ? chrome.storage.local : null));

/** For the page's life only: tests, and a host without storage. */
export const memoryOpenFilesSettings = (
  start: Partial<OpenFilesSettings> = {},
): OpenFilesSettingsStore & { kept: OpenFilesSettings } => {
  const kept = { ...OPEN_FILES_DEFAULTS, ...start };
  return {
    kept,
    get: () => Promise.resolve({ ...kept }),
    set(change) {
      Object.assign(kept, change);
      return Promise.resolve();
    },
  };
};
