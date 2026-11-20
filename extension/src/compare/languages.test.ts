import { LANGUAGES, languageOfFile } from './languages';
import { describe, expect, it } from 'vitest';

describe('languageOfFile', () => {
  it('finds the language by extension, any case', () => {
    expect(languageOfFile('src/lib.rs')).toBe('rust');
    expect(languageOfFile('App.TSX')).toBe('typescript');
    expect(languageOfFile('config.yml')).toBe('yaml');
  });
  it('none for an unknown extension or none at all', () => {
    expect(languageOfFile('Makefile')).toBeUndefined();
    expect(languageOfFile('image.png')).toBeUndefined();
  });
  it('ids and extensions are unique', () => {
    const ids = LANGUAGES.map(l => l.id);
    const exts = LANGUAGES.flatMap(l => l.extensions);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(exts).size).toBe(exts.length);
  });
});
