import { DEFAULT_PREF, THEMES, normalizePref, resolveTheme, themesOf } from './index';
import { SOURCE_FILES, loadThemeSource } from './sources';
import { shipped } from '../scripts/sync-gpui-themes.mjs';
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';

describe('theme index (@workspace/dna) and themes.css', () => {
  it('every indexed theme has its block in themes.css, and nothing else is there', () => {
    const css = readFileSync(resolve(__dirname, '../../dna/themes.css'), 'utf8');
    const blocks = [...css.matchAll(/\[data-theme="([^"]+)"\]/g)].map(m => m[1]);
    expect(blocks.sort()).toEqual(THEMES.map(t => t.id).sort());
  });

  it('no copy of the theme variables is left in this package', () => {
    const own = readdirSync(resolve(__dirname, '..'));
    expect(own.filter(f => f.endsWith('.css') || f === 'themes.index.json')).toEqual([]);
  });

  it('the default pair exists, light and dark', () => {
    expect(THEMES.find(t => t.id === DEFAULT_PREF.light)?.mode).toBe('light');
    expect(THEMES.find(t => t.id === DEFAULT_PREF.dark)?.mode).toBe('dark');
  });
});

describe('normalizePref', () => {
  it('fills the defaults for nothing stored', () => {
    expect(normalizePref(undefined)).toEqual(DEFAULT_PREF);
  });
  it('keeps a valid choice', () => {
    expect(normalizePref({ mode: 'dark', light: 'solarized-light', dark: 'tokyo-night' })).toEqual({
      mode: 'dark',
      light: 'solarized-light',
      dark: 'tokyo-night',
    });
  });
  it('drops an unknown mode, an unknown id and a variant of the wrong side', () => {
    expect(normalizePref({ mode: 'sepia', light: 'tokyo-night', dark: 'no-such-theme' })).toEqual(DEFAULT_PREF);
  });
});

describe('resolveTheme', () => {
  it('system follows the system preference', () => {
    expect(resolveTheme(DEFAULT_PREF, false)).toMatchObject({ id: 'default-light', dark: false, builtIn: true });
    expect(resolveTheme(DEFAULT_PREF, true)).toMatchObject({ id: 'default-dark', dark: true, builtIn: true });
  });
  it('an explicit mode wins over the system', () => {
    expect(resolveTheme({ ...DEFAULT_PREF, mode: 'light' }, true).dark).toBe(false);
    expect(resolveTheme({ ...DEFAULT_PREF, mode: 'dark' }, false).dark).toBe(true);
  });
  it('a theme from a file is not built in, and carries gpui-kit’s name and file', () => {
    expect(resolveTheme({ mode: 'dark', light: 'default-light', dark: 'tokyo-night' }, false)).toEqual({
      id: 'tokyo-night',
      name: 'Tokyo Night',
      dark: true,
      builtIn: false,
      source: 'tokyonight.json',
    });
  });
});

describe('themesOf', () => {
  it('one side only, the default first', () => {
    for (const mode of ['light', 'dark'] as const) {
      const list = themesOf(mode);
      expect(list[0]!.id).toBe(DEFAULT_PREF[mode]);
      expect(list.every(t => t.mode === mode)).toBe(true);
    }
    expect(themesOf('light').length + themesOf('dark').length).toBe(THEMES.length);
  });
});

describe('gpui-kit theme files for the editor', () => {
  it('ships exactly the files the non-default themes come from', () => {
    const needed = [...new Set(THEMES.filter(t => t.source !== 'default-theme.json').map(t => t.source))].sort();
    expect([...SOURCE_FILES].sort()).toEqual(needed);
    expect(readdirSync(resolve(__dirname, '../gpui-themes')).sort()).toEqual(needed);
  });

  it.each(THEMES.filter(t => t.source !== 'default-theme.json').map(t => [t.id, t] as const))(
    '%s: its file has a variant of that name and mode',
    async (_id, entry) => {
      const json = await loadThemeSource(resolveTheme({ mode: entry.mode, light: entry.id, dark: entry.id }, false));
      const set = JSON.parse(json!) as { themes: Array<{ name: string; mode: string }> };
      expect(set.themes.find(t => t.name === entry.name)?.mode).toBe(entry.mode);
    },
  );

  it('carries no link (the extension ships no remote host, validate-build.sh Check 11)', () => {
    for (const file of SOURCE_FILES) {
      expect(readFileSync(resolve(__dirname, '../gpui-themes', file), 'utf8'), file).not.toMatch(/https?:/);
    }
  });

  // While gpui-kit's checkout is on the machine: the files are its own, minus the `$schema` and `url` lines.
  const gk = resolve(homedir(), '.cargo/git/checkouts/gpui-component-72ee0333141c5f7c/d5da0f6/themes');
  it.runIf(existsSync(gk))('are gpui-kit d5da0f6’s files without their links', () => {
    for (const file of SOURCE_FILES) {
      expect(readFileSync(resolve(__dirname, '../gpui-themes', file), 'utf8'), file).toBe(
        shipped(readFileSync(resolve(gk, file), 'utf8')),
      );
    }
  });

  it('a built-in default needs no file', async () => {
    expect(await loadThemeSource(resolveTheme(DEFAULT_PREF, true))).toBeUndefined();
  });
});
