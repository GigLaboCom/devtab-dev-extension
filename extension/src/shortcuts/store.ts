/**
 * The shortcuts in the extension: settings in chrome.storage.local, as the theme and the start page's settings are.
 * `storage.onChanged` is the subscription — every open page of ours (the shell, the start page, the options) follows a
 * change at once, without a reload. No localStorage copy: nothing is drawn from them before chrome.storage answers.
 */
import { normalizeShortcuts } from './bindings';
import type { ShortcutSettings } from './bindings';

/** chrome.storage.local key. (`shortcuts` is the start page's tiles.) */
export const SHORTCUT_KEYS_KEY = 'keyShortcuts';

export interface ShortcutStoreDeps {
  area: Pick<chrome.storage.StorageArea, 'get' | 'set'>;
  onChanged: Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;
}

export const loadShortcuts = async (area: ShortcutStoreDeps['area']): Promise<ShortcutSettings> =>
  normalizeShortcuts((await area.get(SHORTCUT_KEYS_KEY))[SHORTCUT_KEYS_KEY]);

export const saveShortcuts = (area: ShortcutStoreDeps['area'], settings: ShortcutSettings): Promise<void> =>
  area.set({ [SHORTCUT_KEYS_KEY]: normalizeShortcuts(settings) });

/** Calls `onSettings` with the stored shortcuts and on every change from any page. Returns the unsubscribe. */
export const watchShortcuts = async (
  deps: ShortcutStoreDeps,
  onSettings: (settings: ShortcutSettings) => void,
): Promise<() => void> => {
  let loaded = false;
  let changedWhileLoading = false;
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local' || !(SHORTCUT_KEYS_KEY in changes)) return;
    if (!loaded) changedWhileLoading = true;
    else onSettings(normalizeShortcuts(changes[SHORTCUT_KEYS_KEY].newValue));
  };
  deps.onChanged.addListener(onStorage);
  let settings = await loadShortcuts(deps.area);
  while (changedWhileLoading) {
    changedWhileLoading = false;
    settings = await loadShortcuts(deps.area);
  }
  loaded = true;
  onSettings(settings);
  return () => deps.onChanged.removeListener(onStorage);
};
