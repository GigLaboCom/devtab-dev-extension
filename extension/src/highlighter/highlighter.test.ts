/**
 * Seam `Highlighter` (./highlighter.ts): the root's choice and the build's reading of it (build/highlighter.ts), the
 * split table of the mixed scheme against the compare page's languages (crates/review-wasm/grammars.json), and the
 * mixed scheme's controller, which sends every language name through the grammar loader.
 */
import { chosenHighlighter, grammarFiles } from '../../build/highlighter';
import { LANGUAGES } from '../compare/languages';
import { withGrammars } from '../viewer/grammars';
import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { GrammarLoader } from '../viewer/grammars';
import type { ReviewController } from '@extension/review-wasm';

const SRC = resolve(__dirname, '..');
const PKG = resolve(__dirname, '../../../packages/review-wasm/pkg-tree-sitter');

interface TableEntry {
  id: string;
  grammar: 'builtIn' | 'file' | 'none';
  crate: string;
  version: string;
  aliases: string[];
  highlights?: string;
}
const TABLE = JSON.parse(readFileSync(resolve(__dirname, '../../../crates/review-wasm/grammars.json'), 'utf-8')) as {
  languages: TableEntry[];
};

describe('the choice', () => {
  it('as written: syntect — the shipped default; the build reads the same, or the DEVTAB_VARIANT pair', () => {
    expect(chosenHighlighter(SRC, undefined)).toBe('syntect');
    expect(chosenHighlighter(SRC, 'edition:fixedFree')).toBe('syntect');
    expect(chosenHighlighter(SRC, 'highlighter:treeSitter')).toBe('treeSitter');
    expect(chosenHighlighter(SRC, 'edition:fixedFree,highlighter:treeSitter')).toBe('treeSitter');
    expect(() => chosenHighlighter(SRC, 'highlighter:treeSitter,highlighter:syntect')).toThrow(/twice/);
  });

  it('only the tree-sitter build ships grammar files', () => {
    expect(grammarFiles(SRC, PKG, undefined)).toBe(false);
    expect(grammarFiles(SRC, PKG, 'highlighter:syntect')).toBe(false);
    expect(grammarFiles(SRC, PKG, 'highlighter:treeSitter')).toMatchObject({ name: 'extension:grammar-files' });
  });
});

describe('the split table', () => {
  const ids = TABLE.languages.map(entry => entry.id);
  const names = TABLE.languages.flatMap(entry => [entry.id, ...entry.aliases]);

  it('has every language of the compare page (plain text aside), each once, and no name twice', () => {
    for (const { id } of LANGUAGES.filter(l => l.id !== 'text')) expect(ids).toContain(id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(names).size).toBe(names.length);
  });

  it('says for each language where its grammar comes from, and a grammar has its queries', () => {
    for (const entry of TABLE.languages) {
      expect(['builtIn', 'file', 'none']).toContain(entry.grammar);
      expect(entry.crate).toMatch(/^tree-sitter-/);
      expect(entry.version).toMatch(/^\d+\.\d+\.\d+$/);
      if (entry.grammar !== 'none') expect(entry.highlights).toMatch(/^(kit|crate):.+\.scm$/);
    }
  });

  it('the names the shell may send outside the list map to the table (file extensions, other tools’ ids)', () => {
    const idOf = Object.fromEntries(TABLE.languages.flatMap(e => [e.id, ...e.aliases].map(n => [n, e.id])));
    expect(idOf.sh).toBe('bash');
    expect(idOf.shellscript).toBe('bash');
    expect(idOf.javascriptreact).toBe('tsx');
    expect(idOf.jsonc).toBe('json');
    expect(idOf.cs).toBe('csharp');
  });
});

describe('the mixed scheme’s controller', () => {
  it('every language name goes through the loader; everything else is the controller’s', () => {
    const calls: string[] = [];
    const controller = new Proxy({} as ReviewController, {
      get: (_target, key) =>
        key === 'ready' ? true : (...args: unknown[]) => calls.push(`${String(key)} ${JSON.stringify(args)}`),
    });
    const use = vi.fn((name: string) => (name === 'golang' ? 'go' : name));
    const wrapped = withGrammars(controller, { use, load: async () => true } satisfies GrammarLoader);
    const texts = { path: 'a.go', oldText: 'a', newText: 'b' };
    wrapped.compare({ ...texts, language: 'golang' });
    wrapped.showDiff({ ...texts, language: 'golang', hunks: [] });
    wrapped.setLanguage('golang');
    wrapped.swap();
    wrapped.setSide({ side: 'old', text: 'x' });
    expect(wrapped.ready).toBe(true);
    expect(use.mock.calls).toEqual([['golang'], ['golang'], ['golang']]);
    expect(calls).toEqual([
      `compare [${JSON.stringify({ ...texts, language: 'go' })}]`,
      `showDiff [${JSON.stringify({ ...texts, language: 'go', hunks: [] })}]`,
      'setLanguage ["go"]',
      'swap []',
      'setSide [{"side":"old","text":"x"}]',
    ]);
  });
});
