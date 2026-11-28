/**
 * An `.editorconfig` read line by line (./parse.ts), by the rules of the specification's "File Format": trimming,
 * comments only at a line's start, sections, the first `=`, keys without case, known values without case, the preamble
 * and `root`, invalid lines skipped, CRLF, a byte-order mark; and the limits against a hostile file.
 */
import { FILE_MAX_BYTES, KEY_MAX, LINES_MAX, NAME_MAX, SECTIONS_MAX, VALUE_MAX, parseEditorConfig } from './parse';
import { describe, expect, it } from 'vitest';
import type { EditorConfigFile } from './parse';

const parsed = (text: string): EditorConfigFile => {
  const result = parseEditorConfig(text);
  if (!result.ok) throw new Error(result.problem);
  return result.file;
};
const pairs = (text: string) => parsed(text).sections.map(s => [s.name, s.pairs.map(p => p.join('='))]);

describe('the format', () => {
  it('sections and their pairs, in order; keys and spaces around them trimmed', () => {
    expect(
      pairs('[*]\n  indent_style   =   space  \nindent_size=4\n\n[*.md]\ntrim_trailing_whitespace = false\n'),
    ).toEqual([
      ['*', ['indent_style=space', 'indent_size=4']],
      ['*.md', ['trim_trailing_whitespace=false']],
    ]);
  });

  it('a comment starts a line with # or ;; anywhere else it is part of the value', () => {
    expect(
      pairs('# a comment\n; another\n[*]\n  # indented comment\nkey = a # not a comment\nother = b ; nor this\n'),
    ).toEqual([['*', ['key=a # not a comment', 'other=b ; nor this']]]);
  });

  it('splits at the first =; a missing value is empty; a line that is nothing else is skipped', () => {
    expect(pairs('[*]\nkey = a = b\nempty =\njust words\n= no key\n')).toEqual([['*', ['key=a = b', 'empty=']]]);
  });

  it('keys without case; the values of known properties and `unset` without case, others as written', () => {
    expect(pairs('[*]\nINDENT_Style = TAB\nIndent_Size = UNSET\nmy_key = MixedCase\n')).toEqual([
      ['*', ['indent_style=tab', 'indent_size=unset', 'my_key=MixedCase']],
    ]);
  });

  it('the preamble: only `root` means anything; `root = true` (any case) marks the root', () => {
    expect(parsed('root = TRUE\nindent_style = tab\n[*]\nx = 1\n')).toMatchObject({ root: true });
    expect(parsed('root = false\n[*]\n').root).toBe(false);
    expect(parsed('[*]\nroot = true\n').root).toBe(false);
    expect(pairs('indent_style = tab\n[*]\nx = 1\n')).toEqual([['*', ['x=1']]]);
  });

  it('an empty file, or one of comments, is `root = false` with no sections', () => {
    expect(parsed('')).toEqual({ root: false, sections: [] });
    expect(parsed('# only\n\n; comments\n')).toEqual({ root: false, sections: [] });
  });

  it('CRLF and CR line ends, and a byte-order mark', () => {
    expect(pairs(`${String.fromCharCode(0xfeff)}root = true\r\n[*]\r\nindent_size = 2\rtab_width = 8\r\n`)).toEqual([
      ['*', ['indent_size=2', 'tab_width=8']],
    ]);
  });

  it('a section name may hold brackets and spaces; its glob is compiled once', () => {
    const file = parsed('[{src,lib}/**.[ch]]\nx = 1\n[my file.txt]\ny = 2\n');
    expect(file.sections.map(s => s.name)).toEqual(['{src,lib}/**.[ch]', 'my file.txt']);
    expect(file.sections[0]!.glob.matches('src/a/b.c')).toBe(true);
    expect(file.sections[1]!.glob.matches('docs/my file.txt')).toBe(true);
  });
});

describe('limits against a hostile file', () => {
  it(`larger than ${FILE_MAX_BYTES} bytes, more than ${SECTIONS_MAX} sections or ${LINES_MAX} lines: over the limits as a whole`, () => {
    expect(parseEditorConfig(`[*]\nx = ${'y'.repeat(FILE_MAX_BYTES)}`)).toEqual({ ok: false, problem: 'too-large' });
    expect(parseEditorConfig(`[*]\nx = ${'€'.repeat(FILE_MAX_BYTES / 3)}`)).toEqual({
      ok: false,
      problem: 'too-large',
    });
    expect(parseEditorConfig('[x]\n'.repeat(SECTIONS_MAX + 1))).toEqual({ ok: false, problem: 'too-many-sections' });
    expect(parseEditorConfig('[x]\n'.repeat(SECTIONS_MAX)).ok).toBe(true);
    expect(parseEditorConfig('\n'.repeat(LINES_MAX))).toEqual({ ok: false, problem: 'too-many-lines' });
  });

  it('a section name, a key or a value past the specification’s lengths skips that line; a skipped section’s pairs belong to none', () => {
    const text = [
      '[*]',
      `${'k'.repeat(KEY_MAX + 1)} = 1`,
      `long = ${'v'.repeat(VALUE_MAX + 1)}`,
      `fits = ${'v'.repeat(VALUE_MAX)}`,
      `[${'n'.repeat(NAME_MAX + 1)}]`,
      'orphan = 1',
      '[*.md]',
      'z = 2',
    ].join('\n');
    expect(parsed(text).sections.map(s => [s.name, s.pairs.map(([k]) => k)])).toEqual([
      ['*', ['fits']],
      ['*.md', ['z']],
    ]);
  });
});
