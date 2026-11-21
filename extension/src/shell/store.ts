/**
 * The shell's settings in the extension, kept the way the start page's are (src/start/store.ts): chrome.storage.local
 * is the source of truth and the broadcast (`storage.onChanged` reaches every open page), and localStorage keeps a copy
 * the shell reads in its first render. Stored: which sidebar groups are open. Never stored: what is typed into the
 * palette.
 */
import { DEFAULT_SHELL, SHELL_CACHE_KEY, SHELL_KEY, normalizeShell } from './settings';
import type { ShellSettings } from './settings';
import type { StartStoreDeps } from '@src/start/store';

/** The same chrome.storage area, its events and the window the start page's store takes. */
export type ShellStoreDeps = StartStoreDeps;

export const readShellCache = (win: ShellStoreDeps['win']): ShellSettings | null => {
  try {
    const raw = win.localStorage.getItem(SHELL_CACHE_KEY);
    return raw === null ? null : normalizeShell(JSON.parse(raw));
  } catch {
    return null;
  }
};

const writeCache = (win: ShellStoreDeps['win'], settings: ShellSettings): void => {
  try {
    win.localStorage.setItem(SHELL_CACHE_KEY, JSON.stringify(settings));
  } catch {
    // a copy only: without it a group the user opened is drawn open a moment later
  }
};

/** The settings the shell starts with before chrome.storage answers: the copy, or the defaults. */
export const initialShell = (win: ShellStoreDeps['win']): ShellSettings => readShellCache(win) ?? DEFAULT_SHELL;

export const loadShell = async (area: ShellStoreDeps['area']): Promise<ShellSettings> =>
  normalizeShell((await area.get(SHELL_KEY))[SHELL_KEY]);

export const saveShell = (area: ShellStoreDeps['area'], settings: ShellSettings): Promise<void> =>
  area.set({ [SHELL_KEY]: normalizeShell(settings) });

/**
 * Calls `onSettings` with the stored settings and again on every change from any page; each is copied to localStorage.
 * Returns the unsubscribe.
 */
export const watchShell = async (
  deps: ShellStoreDeps,
  onSettings: (settings: ShellSettings) => void,
): Promise<() => void> => {
  let loaded = false;
  let changedWhileLoading = false;
  const emit = (settings: ShellSettings): void => {
    writeCache(deps.win, settings);
    onSettings(settings);
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local' || !(SHELL_KEY in changes)) return;
    if (!loaded) changedWhileLoading = true;
    else emit(normalizeShell(changes[SHELL_KEY].newValue));
  };
  // Listen before the first read: a change written while it is in flight would otherwise be lost.
  deps.onChanged.addListener(onStorage);
  let settings = await loadShell(deps.area);
  while (changedWhileLoading) {
    changedWhileLoading = false;
    settings = await loadShell(deps.area);
  }
  loaded = true;
  emit(settings);
  return () => deps.onChanged.removeListener(onStorage);
};
