import { deriveTokens } from '../scripts/tokens.mjs';
import tokensJson from '../tokens.json';
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';

interface Theme {
  mode: 'light' | 'dark';
  tokens: Record<string, string>;
}
interface IndexEntry {
  id: string;
  name: string;
  mode: 'light' | 'dark';
  background: string;
  foreground: string;
  primary: string;
}

const read = (name: string) => readFileSync(new URL(`../${name}`, import.meta.url), 'utf8');
const strip = (css: string) => css.replace(/\/\*[\s\S]*?\*\//g, '');
const THEMES = (tokensJson as unknown as { themes: Record<string, Theme> }).themes;
const BASE = (tokensJson as unknown as { base: Record<string, string> }).base;
const INDEX = JSON.parse(read('themes.index.json')) as IndexEntry[];

describe('tokens.json is the CSS, re-derived', () => {
  it('equals what scripts/tokens.mjs derives from themes.css and theme.css', () => {
    expect(tokensJson).toEqual(deriveTokens(read('themes.css'), read('theme.css')));
  });

  it('every theme defines the same tokens', () => {
    const names = Object.keys(Object.values(THEMES)[0]!.tokens).sort();
    expect(names.length).toBeGreaterThan(100);
    for (const [id, theme] of Object.entries(THEMES)) expect(Object.keys(theme.tokens).sort(), id).toEqual(names);
  });

  it('no base token shadows a theme token', () => {
    const themed = new Set(Object.keys(Object.values(THEMES)[0]!.tokens));
    expect(Object.keys(BASE).filter(name => themed.has(name))).toEqual([]);
  });

  it.each(['--background', '--foreground', '--popover', '--card', '--sidebar', '--primary'])(
    '%s is an opaque colour in every theme',
    name => {
      for (const [id, theme] of Object.entries(THEMES))
        expect(theme.tokens[name], `${id} ${name}`).toMatch(/^#[0-9a-f]{6}$/);
    },
  );
});

describe('themes.index.json lists exactly the themes of themes.css', () => {
  it('same ids, same modes, same swatch colours', () => {
    expect(INDEX.map(t => t.id).sort()).toEqual(Object.keys(THEMES).sort());
    for (const entry of INDEX) {
      const theme = THEMES[entry.id]!;
      expect(theme.mode, entry.id).toBe(entry.mode);
      expect(theme.tokens['--background'], entry.id).toBe(entry.background);
      expect(theme.tokens['--foreground'], entry.id).toBe(entry.foreground);
      expect(theme.tokens['--primary'], entry.id).toBe(entry.primary);
    }
  });

  it('has the default pair, light and dark', () => {
    expect(INDEX.find(t => t.id === 'default-light')?.mode).toBe('light');
    expect(INDEX.find(t => t.id === 'default-dark')?.mode).toBe('dark');
  });

  // The generated half is never edited: while the exporter's output is next to the package, the copies are its bytes.
  const out = new URL('../../../spikes/theme-export/out/', import.meta.url);
  it.runIf(existsSync(out))('themes.css and themes.index.json are the exporter’s output, byte for byte', () => {
    for (const file of ['themes.css', 'themes.index.json']) {
      expect(read(file), file).toBe(readFileSync(new URL(file, out), 'utf8'));
    }
  });
});

describe('tailwind.css maps the tokens, no more, no less', () => {
  const bridge = strip(read('tailwind.css'));
  const mapped = new Map([...bridge.matchAll(/(--[a-z0-9-]+):\s*var\((--[a-z0-9-]+)\);/g)].map(m => [m[1]!, m[2]!]));

  it('every colour of the themes, as --color-<name>: var(--<name>)', () => {
    const colours = Object.entries(Object.values(THEMES)[0]!.tokens)
      .filter(([, value]) => value.startsWith('#'))
      .map(([name]) => name);
    const bridged = [...mapped].filter(([k]) => k.startsWith('--color-'));
    expect(bridged.map(([k, v]) => [k.slice('--color-'.length), v.slice(2)]).sort()).toEqual(
      colours.map(n => [n.slice(2), n.slice(2)]).sort(),
    );
  });

  it('every other mapping reads a token of the same name', () => {
    for (const [key, value] of mapped) {
      if (key.startsWith('--color-')) continue;
      expect(value, key).toBe(key);
      expect(BASE[key] ?? Object.values(THEMES)[0]!.tokens[key], key).toBeDefined();
    }
  });

  it('every var() in theme.css, ui.css and style-gpui.css names a token', () => {
    const known = new Set([...Object.keys(BASE), ...Object.keys(Object.values(THEMES)[0]!.tokens)]);
    for (const file of ['theme.css', 'ui.css', 'style-gpui.css']) {
      for (const m of strip(read(file)).matchAll(/var\(\s*(--[a-z0-9-]+)/gi))
        expect(known.has(m[1]!), `${file}: ${m[1]}`).toBe(true);
    }
  });
});

describe('fonts.css ships the faces as files (D9: IBM Plex Sans and Mono)', () => {
  const faces = [...strip(read('fonts.css')).matchAll(/@font-face\s*\{([^}]*)\}/g)].map(m => m[1]!);

  it('IBM Plex Sans 400, 500, 600 and IBM Plex Mono 400', () => {
    const got = faces
      .map(f => `${/font-family:\s*'([^']+)'/.exec(f)?.[1]} ${/font-weight:\s*(\d+)/.exec(f)?.[1]}`)
      .sort();
    expect(got).toEqual(['IBM Plex Mono 400', 'IBM Plex Sans 400', 'IBM Plex Sans 500', 'IBM Plex Sans 600']);
  });

  it('fonts/ holds exactly the files the faces name, next to their licence; nothing remote or inlined', () => {
    const named = faces.map(f => /url\('\.\/fonts\/([^']+)'\)/.exec(f)?.[1]).sort();
    const shipped = readdirSync(new URL('../fonts/', import.meta.url)).sort();
    expect(shipped).toEqual([...named, 'OFL-IBMPlex.txt'].sort());
    expect(read('fonts.css')).not.toMatch(/data:|https?:/);
  });

  it('the stacks name these faces first, and no system face', () => {
    expect(BASE['--font-sans']).toMatch(/^'IBM Plex Sans',/);
    expect(BASE['--font-mono']).toMatch(/^'IBM Plex Mono',/);
    expect(`${BASE['--font-sans']} ${BASE['--font-mono']}`).not.toMatch(/system-ui|-apple-system|Segoe|Roboto|Arial/);
    expect(read('theme.css')).toMatch(/@import '\.\/fonts\.css';/);
  });
});
