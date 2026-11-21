/**
 * The start page's settings in the extension, the same way the theme choice is kept (D9, src/shared/theme/store.ts):
 * `chrome.storage.local` is the source of truth and the broadcast (`storage.onChanged` reaches every open page), and
 * `localStorage` keeps a copy that public/route-boot.js reads synchronously before the first paint — so a new tab knows
 * whether to reopen the last tool, and which parts to draw, without waiting for chrome.storage.
 *
 * Stored: the settings, the shortcuts, the recent routes. Never stored: what the user types into the field.
 */
import {
  DEFAULT_STATE,
  RECENT_KEY,
  SETTINGS_KEY,
  SHORTCUTS_KEY,
  START_CACHE_KEY,
  normalizeRecent,
  normalizeSettings,
  normalizeShortcuts,
  normalizeState,
  visit,
} from './settings';
import type { Recent, Shortcut, StartSettings, StartState } from './settings';

export type StartArea = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
type OnChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
type Win = Pick<Window, 'localStorage'>;

export interface StartStoreDeps {
  area: StartArea;
  onChanged: OnChanged;
  win: Win;
}

/** The copy in localStorage, or null when there is none (first run, or a page without localStorage). */
export const readCache = (win: Win): StartState | null => {
  try {
    const raw = win.localStorage.getItem(START_CACHE_KEY);
    return raw === null ? null : normalizeState(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeCache = (win: Win, state: StartState): void => {
  try {
    win.localStorage.setItem(START_CACHE_KEY, JSON.stringify(state));
  } catch {
    // a copy only: without it a new tab opens on the start page and draws its parts a moment later
  }
};

export const loadState = async (area: StartArea): Promise<StartState> => {
  const [settings, shortcuts, recent] = await Promise.all(
    [SETTINGS_KEY, SHORTCUTS_KEY, RECENT_KEY].map(key => area.get(key).then(items => items[key])),
  );
  return {
    settings: normalizeSettings(settings),
    shortcuts: normalizeShortcuts(shortcuts),
    recent: normalizeRecent(recent),
  };
};

export const saveSettings = (area: StartArea, settings: StartSettings): Promise<void> =>
  area.set({ [SETTINGS_KEY]: normalizeSettings(settings) });

export const saveShortcuts = (area: StartArea, shortcuts: readonly Shortcut[]): Promise<void> =>
  area.set({ [SHORTCUTS_KEY]: normalizeShortcuts(shortcuts) });

/** Remembers that a section or a tool was opened (for "the last opened tool" and the order of the Tools tiles). */
export const recordVisit = async (area: StartArea, hash: string): Promise<Recent> => {
  const before = normalizeRecent((await area.get(RECENT_KEY))[RECENT_KEY]);
  const after = visit(before, hash);
  if (after !== before && (after.last !== before.last || after.used.join() !== before.used.join()))
    await area.set({ [RECENT_KEY]: after });
  return after;
};

/**
 * Calls `onState` with the stored state and again on every change from any page. Each state is copied to localStorage
 * for the next new tab. Returns the unsubscribe.
 */
export const watchStart = async (deps: StartStoreDeps, onState: (state: StartState) => void): Promise<() => void> => {
  // Listen before the first read: a change written while it is in flight would otherwise be lost.
  let state: StartState | null = null;
  let changedWhileLoading = false;
  const emit = (next: StartState): void => {
    state = next;
    writeCache(deps.win, next);
    onState(next);
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local' || ![SETTINGS_KEY, SHORTCUTS_KEY, RECENT_KEY].some(key => key in changes)) return;
    if (!state) {
      changedWhileLoading = true;
      return;
    }
    let next = state;
    if (SETTINGS_KEY in changes) next = { ...next, settings: normalizeSettings(changes[SETTINGS_KEY].newValue) };
    if (SHORTCUTS_KEY in changes) next = { ...next, shortcuts: normalizeShortcuts(changes[SHORTCUTS_KEY].newValue) };
    if (RECENT_KEY in changes) next = { ...next, recent: normalizeRecent(changes[RECENT_KEY].newValue) };
    emit(next);
  };
  deps.onChanged.addListener(onStorage);
  let loaded = await loadState(deps.area);
  while (changedWhileLoading) {
    changedWhileLoading = false;
    loaded = await loadState(deps.area);
  }
  emit(loaded);
  return () => deps.onChanged.removeListener(onStorage);
};

/** The state a page starts with before chrome.storage answers: the copy, or the defaults. */
export const initialState = (win: Win): StartState => readCache(win) ?? DEFAULT_STATE;
