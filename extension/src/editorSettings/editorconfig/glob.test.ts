/**
 * EditorConfig's section globs (./glob.ts), case by case from the specification's own description of each form
 * (0.17.2, "Glob Expressions"): `*`, `**`, `?`, `[seq]`, `[!seq]`, `{a,b}` (nested), `{n..m}`, escapes, the slash rule
 * and its leading slash, a pattern ending in `/`; the limits against a hostile pattern, and a pathological pattern that
 * finishes within its budget.
 */
import { MATCH_BUDGET, NESTING_MAX, PATTERN_MAX, RANGE_MAX, compileGlob } from './glob';
import { describe, expect, it } from 'vitest';

/** [pattern, path relative to the .editorconfig's folder, expected]. */
const table = (rows: ReadonlyArray<readonly [string, string, boolean]>) =>
  it.each(rows.map(([p, path, want]) => [p, path, want] as const))('%s against %s → %s', (pattern, path, want) =>
    expect(compileGlob(pattern).matches(path)).toBe(want),
  );

describe('* — any characters but a path separator', () => {
  table([
    ['*', 'a.txt', true],
    ['*', 'deep/down/a.txt', true],
    ['*.js', 'app.js', true],
    ['*.js', 'src/app.js', true],
    ['*.js', 'app.jsx', false],
    ['a*z.c', 'abz.c', true],
    ['a*z.c', 'az.c', true],
    ['src/*.js', 'src/a.js', true],
    // `*` does not cross a separator.
    ['src/*.js', 'src/lib/a.js', false],
    ['a*z.c', 'a/z.c', false],
  ]);
});

describe('** — any characters, separators included', () => {
  table([
    ['src/**.js', 'src/lib/deep/a.js', true],
    ['a**z.c', 'a/b/c/z.c', true],
    ['src/**/a.js', 'src/a.js', true],
    ['src/**/a.js', 'src/x/y/a.js', true],
    ['**/vendor/*.js', 'vendor/a.js', true],
    ['**/vendor/*.js', 'lib/vendor/a.js', true],
    ['src/**/a.js', 'other/a.js', false],
  ]);
});

describe('? — one character but a separator', () => {
  table([
    ['?.c', 'a.c', true],
    ['?.c', 'ab.c', false],
    ['a?c', 'a/c', false],
    ['file?.txt', 'file1.txt', true],
  ]);
});

describe('[seq] and [!seq] — one character in, or not in, the set', () => {
  table([
    ['[ab].c', 'a.c', true],
    ['[ab].c', 'c.c', false],
    ['[!ab].c', 'c.c', true],
    ['[!ab].c', 'a.c', false],
    ['[a-c].x', 'b.x', true],
    ['[a-c].x', 'd.x', false],
    ['[*].x', '*.x', true],
    ['[*].x', 'a.x', false],
    // A bracket holding a separator is plain text; an unclosed one too.
    ['ab[e/]cd.i', 'ab[e/]cd.i', true],
    ['ab[e/]cd.i', 'abecd.i', false],
    ['[ab.c', '[ab.c', true],
  ]);
});

describe('{s1,s2,s3} — any of the strings, nested too; {single} and {} are plain text', () => {
  table([
    ['*.{yml,yaml}', 'a.yml', true],
    ['*.{yml,yaml}', 'deep/a.yaml', true],
    ['*.{yml,yaml}', 'a.yam', false],
    ['{a,{b,{c,d}}}.x', 'd.x', true],
    ['{a,{b,{c,d}}}.x', 'e.x', false],
    ['{,a}b', 'b', true],
    ['{,a}b', 'ab', true],
    ['{single}.b', '{single}.b', true],
    ['{single}.b', 'single.b', false],
    ['{}.b', '{}.b', true],
    ['{a,b.c', '{a,b.c', true],
    ['{*.js,docs/*.md}', 'docs/a.md', true],
    // With a separator inside the braces, the pattern is relative to its folder.
    ['{*.js,docs/*.md}', 'sub/docs/a.md', false],
  ]);
});

describe('{num1..num2} — whole numbers from num1 to num2', () => {
  table([
    ['file{1..3}.txt', 'file1.txt', true],
    ['file{1..3}.txt', 'file3.txt', true],
    ['file{1..3}.txt', 'file4.txt', false],
    ['file{1..3}.txt', 'file01.txt', true],
    ['file{1..3}.txt', 'file12.txt', false],
    ['{-1..4}.n', '-1.n', true],
    ['{-1..4}.n', '0.n', true],
    ['{-1..4}.n', '-2.n', false],
    ['v{10..20}', 'v15', true],
    ['v{10..20}', 'v9', false],
    // num1 must be less than num2: otherwise plain text.
    ['{3..1}', '{3..1}', true],
    ['{3..1}', '2', false],
  ]);
});

describe('\\ — escapes a special character', () => {
  table([
    ['\\*.txt', '*.txt', true],
    ['\\*.txt', 'a.txt', false],
    ['a\\{b,c\\}', 'a{b,c}', true],
    ['\\[ab\\]', '[ab]', true],
  ]);
});

describe('the slash rule', () => {
  table([
    // Without a separator: at any depth below the file's folder.
    ['Makefile', 'Makefile', true],
    ['Makefile', 'lib/Makefile', true],
    // With one: relative to the file's folder.
    ['lib/Makefile', 'lib/Makefile', true],
    ['lib/Makefile', 'x/lib/Makefile', false],
    // A leading slash: relative to the folder; irrelevant when there is a slash in the middle as well.
    ['/Makefile', 'Makefile', true],
    ['/Makefile', 'lib/Makefile', false],
    ['/lib/Makefile', 'lib/Makefile', true],
    // A name ending in a separator matches no file.
    ['lib/', 'lib', false],
    ['lib/', 'lib/a', false],
  ]);
  it('is case-sensitive', () => {
    expect(compileGlob('*.MD').matches('a.md')).toBe(false);
    expect(compileGlob('*.md').matches('A.md')).toBe(true);
  });
});

describe('limits against a hostile pattern', () => {
  it(`a range wider than ${RANGE_MAX} numbers, braces deeper than ${NESTING_MAX}, a pattern longer than ${PATTERN_MAX}: no match at all`, () => {
    expect(compileGlob('{1..1000000000}').never).toBe(true);
    expect(compileGlob(`{0..${RANGE_MAX - 1}}`).matches(String(RANGE_MAX - 1))).toBe(true);
    const nested = (depth: number) => `${'{a,'.repeat(depth)}b${'}'.repeat(depth)}`;
    expect(compileGlob(nested(NESTING_MAX)).matches('b')).toBe(true);
    expect(compileGlob(nested(NESTING_MAX + 1)).never).toBe(true);
    expect(compileGlob('x'.repeat(PATTERN_MAX + 1)).never).toBe(true);
    expect(compileGlob('').never).toBe(true);
  });

  it('a pathological pattern finishes within its budget and says so', () => {
    // As a regular expression with nested repeats this backtracks for ever; here it is states × characters.
    const pattern = `${'*a'.repeat(200)}*b`;
    const path = 'a'.repeat(4000);
    const spent = { steps: 0, exhausted: false };
    const started = performance.now();
    expect(compileGlob(pattern).matches(path, { spent })).toBe(false);
    const ms = performance.now() - started;
    // Checked once per character: past the budget by at most one character's states.
    expect(spent.steps).toBeLessThanOrEqual(MATCH_BUDGET + 5000);
    expect(spent.exhausted).toBe(true);
    expect(ms).toBeLessThan(1000);
    // Within the budget the same kind of pattern answers right.
    expect(compileGlob('*a*a*a*b').matches(`${'a'.repeat(50)}b`)).toBe(true);
    expect(compileGlob('*a*a*a*b').matches('a'.repeat(50))).toBe(false);
  });

  it('a budget given by the caller bounds one match', () => {
    const spent = { steps: 0, exhausted: false };
    expect(compileGlob('**/*.js').matches(`${'d/'.repeat(500)}a.js`, { budget: 50, spent })).toBe(false);
    expect(spent.exhausted).toBe(true);
  });
});
