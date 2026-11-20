/**
 * gpui-kit's theme files for the wasm editor (D9: the same JSON goes to `set_theme`). The editor knows the two
 * built-in defaults by name; every other theme of themes.index.json needs its file (`ThemeSet` JSON). The files are
 * gpui-kit's own `themes/*.json` at d5da0f6 (Apache-2.0, dist/licenses/GPUI-KIT-LICENSE-APACHE.txt), copied as they
 * are; each loads lazily as its own chunk, only when the editor shows a theme from it.
 */
import type { ResolvedTheme } from './index';

const SOURCES: Record<string, () => Promise<{ default: string }>> = {
  'adventure.json': () => import('../gpui-themes/adventure.json?raw'),
  'alduin.json': () => import('../gpui-themes/alduin.json?raw'),
  'ayu.json': () => import('../gpui-themes/ayu.json?raw'),
  'catppuccin.json': () => import('../gpui-themes/catppuccin.json?raw'),
  'everforest.json': () => import('../gpui-themes/everforest.json?raw'),
  'fahrenheit.json': () => import('../gpui-themes/fahrenheit.json?raw'),
  'flexoki.json': () => import('../gpui-themes/flexoki.json?raw'),
  'gruvbox.json': () => import('../gpui-themes/gruvbox.json?raw'),
  'harper.json': () => import('../gpui-themes/harper.json?raw'),
  'hybrid.json': () => import('../gpui-themes/hybrid.json?raw'),
  'jellybeans.json': () => import('../gpui-themes/jellybeans.json?raw'),
  'kibble.json': () => import('../gpui-themes/kibble.json?raw'),
  'macos-classic.json': () => import('../gpui-themes/macos-classic.json?raw'),
  'mellifluous.json': () => import('../gpui-themes/mellifluous.json?raw'),
  'molokai.json': () => import('../gpui-themes/molokai.json?raw'),
  'solarized.json': () => import('../gpui-themes/solarized.json?raw'),
  'tokyonight.json': () => import('../gpui-themes/tokyonight.json?raw'),
  'twilight.json': () => import('../gpui-themes/twilight.json?raw'),
};

/** The files this package ships (for the tests). */
export const SOURCE_FILES: readonly string[] = Object.keys(SOURCES);

/** The `ThemeSet` JSON the editor needs for `theme`, or undefined for a built-in default. */
export const loadThemeSource = async (
  theme: Pick<ResolvedTheme, 'builtIn' | 'source'>,
): Promise<string | undefined> => {
  if (theme.builtIn) return undefined;
  const load = SOURCES[theme.source];
  if (!load) throw new Error(`no gpui-kit theme file ${theme.source}`);
  return (await load()).default;
};
