/**
 * The theme choice in the extension (D9, docs/theming.md §5.2): `chrome.storage.local` is the source of truth and the
 * broadcast (`storage.onChanged` reaches the main page and the editor page alike); `localStorage` keeps a copy that
 * public/theme-boot.js reads synchronously before the first paint. The storage and the window come in as arguments,
 * so tests pass fakes.
 */
import { THEME_CACHE_KEY, THEME_STORAGE_KEY, normalizePref, resolveTheme } from '@extension/theme';
import type { ResolvedTheme, ThemePref } from '@extension/theme';

type Area = Pick<chrome.storage.StorageArea, 'get' | 'set'>;
type OnChanged = Pick<chrome.storage.StorageChangedEvent, 'addListener' | 'removeListener'>;

const DARK_QUERY = '(prefers-color-scheme: dark)';

const cache = (win: Pick<Window, 'localStorage'>, pref: ThemePref): void => {
  try {
    win.localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(pref));
  } catch {
    // a copy only: a page without localStorage still gets the theme from chrome.storage, one frame later
  }
};

export const loadPref = async (area: Area): Promise<ThemePref> => {
  const items = await area.get(THEME_STORAGE_KEY);
  return normalizePref(items[THEME_STORAGE_KEY]);
};

export const savePref = async (area: Area, win: Pick<Window, 'localStorage'>, pref: ThemePref): Promise<void> => {
  const normalized = normalizePref(pref);
  cache(win, normalized);
  await area.set({ [THEME_STORAGE_KEY]: normalized });
};

/** Paints the React side: `data-theme` picks the block of themes.css, `data-mode` the color-scheme (base.css). */
export const applyTheme = (root: HTMLElement, theme: ResolvedTheme): void => {
  root.dataset.theme = theme.id;
  root.dataset.mode = theme.dark ? 'dark' : 'light';
};

export interface ThemeWatch {
  pref: ThemePref;
  theme: ResolvedTheme;
}

/**
 * Calls `onTheme` with the current choice and again on every change — the user's (any page, through storage) or the
 * system's (for `system`). Returns the unsubscribe.
 */
export const watchTheme = async (
  deps: { area: Area; onChanged: OnChanged; win: Pick<Window, 'localStorage' | 'matchMedia'> },
  onTheme: (watch: ThemeWatch) => void,
): Promise<() => void> => {
  const media = deps.win.matchMedia(DARK_QUERY);
  let pref = await loadPref(deps.area);
  const emit = (): void => {
    cache(deps.win, pref);
    onTheme({ pref, theme: resolveTheme(pref, media.matches) });
  };
  const onStorage = (changes: Record<string, chrome.storage.StorageChange>, areaName: string): void => {
    if (areaName !== 'local' || !(THEME_STORAGE_KEY in changes)) return;
    pref = normalizePref(changes[THEME_STORAGE_KEY].newValue);
    emit();
  };
  const onSystem = (): void => {
    if (pref.mode === 'system') emit();
  };
  deps.onChanged.addListener(onStorage);
  media.addEventListener('change', onSystem);
  emit();
  return () => {
    deps.onChanged.removeListener(onStorage);
    media.removeEventListener('change', onSystem);
  };
};
