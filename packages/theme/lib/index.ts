/**
 * The theme choice (docs/theming.md §5.1, D9): a mode and a light / dark pair of theme ids from the style package's
 * themes.index.json. The same choice paints the React pages (`data-theme` on <html> selects a block of
 * @workspace/dna/themes.css — the one place the theme variables live) and the wasm editor (`set_theme`, with the
 * theme's gpui-kit file from ./sources). Pure: storage and the DOM are the extension's (`extension/src/shared/theme/`).
 */
import index from '@workspace/dna/themes.index.json';

export type ThemeMode = 'system' | 'light' | 'dark';

export interface ThemePref {
  mode: ThemeMode;
  /** A light theme's id in themes.index.json. */
  light: string;
  /** A dark theme's id in themes.index.json. */
  dark: string;
}

export interface ThemeEntry {
  id: string;
  name: string;
  family: string;
  mode: 'light' | 'dark';
  /** gpui-kit's theme file the variant comes from (`default-theme.json` = the built-in defaults). */
  source: string;
  background: string;
  foreground: string;
  primary: string;
}

export interface ResolvedTheme {
  id: string;
  /** gpui-kit's name of the variant — what `set_theme` looks up. */
  name: string;
  dark: boolean;
  /** True for gpui-kit's built-in defaults: the editor knows them without a theme file. */
  builtIn: boolean;
  /** gpui-kit's theme file of the variant (`default-theme.json` for the built-ins). */
  source: string;
}

/** `chrome.storage.local` key of the choice (the source of truth). */
export const THEME_STORAGE_KEY = 'theme';
/** `localStorage` key of its copy, read synchronously by theme-boot.js before the first paint. */
export const THEME_CACHE_KEY = 'theme-cache';

export const THEMES: readonly ThemeEntry[] = index as ThemeEntry[];

export const DEFAULT_PREF: ThemePref = { mode: 'system', light: 'default-light', dark: 'default-dark' };

const byId = (id: string): ThemeEntry | undefined => THEMES.find(t => t.id === id);

/** The themes of one side, for the light and the dark picker: the defaults first, then by name. */
export const themesOf = (mode: 'light' | 'dark'): ThemeEntry[] =>
  THEMES.filter(t => t.mode === mode).sort((a, b) =>
    a.id === DEFAULT_PREF[mode] ? -1 : b.id === DEFAULT_PREF[mode] ? 1 : a.name.localeCompare(b.name),
  );

/** Anything read from storage → a valid choice: unknown modes and ids fall back to the defaults. */
export const normalizePref = (raw: unknown): ThemePref => {
  const value = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof ThemePref, unknown>>;
  const mode: ThemeMode = value.mode === 'light' || value.mode === 'dark' ? value.mode : 'system';
  const pick = (id: unknown, want: 'light' | 'dark'): string =>
    typeof id === 'string' && byId(id)?.mode === want ? id : DEFAULT_PREF[want];
  return { mode, light: pick(value.light, 'light'), dark: pick(value.dark, 'dark') };
};

/** Which variant shows now: the mode, or the system's preference for `system`. */
export const resolveTheme = (pref: ThemePref, systemDark: boolean): ResolvedTheme => {
  const dark = pref.mode === 'dark' || (pref.mode === 'system' && systemDark);
  const entry = byId(dark ? pref.dark : pref.light) ?? byId(dark ? DEFAULT_PREF.dark : DEFAULT_PREF.light)!;
  return { id: entry.id, name: entry.name, dark, builtIn: entry.source === 'default-theme.json', source: entry.source };
};
