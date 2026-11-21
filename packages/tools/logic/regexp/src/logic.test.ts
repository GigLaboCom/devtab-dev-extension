import {
  compileRegexp,
  flagWords,
  matchCountText,
  MAX_MATCHES,
  MAX_RESULT,
  normalizeFlags,
  PATTERN_TOO_LONG,
  replaceAll,
  runRegexp,
  scanGroupNames,
  segments,
  showMatchText,
  splitLiteral,
  substitute,
  toggleFlag,
} from './logic';
import { describe, expect, it } from 'vitest';
import type { Match, RunResult } from './logic';

type Ok = Extract<RunResult, { ok: true }>;

const run = (text: string, pattern: string, flags: string, replacement: string | null = null): Ok => {
  const result = runRegexp({ pattern, flags, text, replacement });
  if (!result.ok) throw new Error(`did not run: ${result.message}`);
  return result;
};

/** [text, start, end] of each match. */
const spans = (r: Ok) => r.matches.map(m => [m.text, m.start, m.end]);
/** [number, name, text, start] of each group of a match. */
const groups = (m: Match) => m.groups.map(g => [g.number, g.name, g.text, g.start]);

/** The built-in String.prototype.replace, to compare `replaceAll` with (§5 п. 22). */
const builtin = (text: string, pattern: string, flags: string, replacement: string): string =>
  text.replace(new RegExp(pattern, flags), replacement);

/** Runs with a replacement and checks the result against the built-in replace (the «=replace» column). */
const replaced = (text: string, pattern: string, flags: string, replacement: string): Ok => {
  const r = run(text, pattern, flags, replacement);
  expect(r.replaced).toBe(builtin(text, pattern, flags, replacement));
  return r;
};

/** What the engine this test runs on says for a pattern, without its start (§5 п. 7). */
const engineSays = (pattern: string, flags: string): string => {
  try {
    new RegExp(pattern, flags);
  } catch (error) {
    const message = (error as Error).message;
    const prefix = `Invalid regular expression: /${pattern}/${flags}: `;
    return message.startsWith(prefix) ? message.slice(prefix.length) : message;
  }
  throw new Error(`${pattern} compiles`);
};

const compiles = (pattern: string, flags = ''): boolean => {
  try {
    new RegExp(pattern, flags);
    return true;
  } catch {
    return false;
  }
};

describe('§10: matches, groups and replacement', () => {
  it('dates with three groups, replaced as $3.$2.$1', () => {
    const r = replaced('from 2026-11-19 to 2026-12-01', '(\\d{4})-(\\d{2})-(\\d{2})', 'g', '$3.$2.$1');
    expect(spans(r)).toEqual([
      ['2026-11-19', 5, 15],
      ['2026-12-01', 19, 29],
    ]);
    expect([r.matches[0]!.line, r.matches[0]!.column, r.matches[1]!.line, r.matches[1]!.column]).toEqual([1, 6, 1, 20]);
    expect(groups(r.matches[0]!)).toEqual([
      [1, undefined, '2026', 5],
      [2, undefined, '11', 10],
      [3, undefined, '19', 13],
    ]);
    expect(r.replaced).toBe('from 19.11.2026 to 01.12.2026');
  });

  it('named groups, replaced as $<host>: $<user>', () => {
    const r = replaced('mail ann@example.com, bob@test.org', '(?<user>\\w+)@(?<host>[\\w.]+)', 'g', '$<host>: $<user>');
    expect(spans(r)).toEqual([
      ['ann@example.com', 5, 20],
      ['bob@test.org', 22, 34],
    ]);
    expect(groups(r.matches[0]!)).toEqual([
      [1, 'user', 'ann', 5],
      [2, 'host', 'example.com', 9],
    ]);
    expect(r.replaced).toBe('mail example.com: ann, test.org: bob');
  });

  it('without g: one match, one replacement', () => {
    const r = replaced('a1 b22 c333', '\\d+', '', '#');
    expect(spans(r)).toEqual([['1', 1, 2]]);
    expect(r.replaced).toBe('a# b22 c333');
  });

  it('with g: every match, every replacement', () => {
    const r = replaced('a1 b22 c333', '\\d+', 'g', '#');
    expect(spans(r)).toEqual([
      ['1', 1, 2],
      ['22', 4, 6],
      ['333', 8, 11],
    ]);
    expect(r.replaced).toBe('a# b# c#');
  });

  it('i: case does not matter', () => {
    expect(run('Error, ERROR, error', 'error', 'gi').matches.map(m => m.start)).toEqual([0, 7, 14]);
  });

  it('m: ^ at every line; without it only the text’s start', () => {
    const multi = run('one two\nthree four', '^\\w+', 'gm');
    expect(multi.matches.map(m => [m.text, m.line, m.column])).toEqual([
      ['one', 1, 1],
      ['three', 2, 1],
    ]);
    expect(spans(run('one two\nthree four', '^\\w+', 'g'))).toEqual([['one', 0, 3]]);
  });

  it('s: the dot takes a line break; without it no match', () => {
    const r = run('a\nb', 'a.b', 'gs');
    expect(r.matches).toHaveLength(1);
    expect(showMatchText(r.matches[0]!.text)).toBe('"a\\nb"');
    const none = run('a\nb', 'a.b', 'g');
    expect(matchCountText(none.matches.length, none.truncated)).toBe('No matches');
  });

  it('gy: matches one after another from 0, up to the first gap', () => {
    expect(spans(run('12a3', '\\d', 'gy'))).toEqual([
      ['1', 0, 1],
      ['2', 1, 2],
    ]);
  });

  it('empty matches: iteration moves past them; the segments', () => {
    const r = replaced('axb', 'x*', 'g', '-');
    expect(spans(r)).toEqual([
      ['', 0, 0],
      ['x', 1, 2],
      ['', 2, 2],
      ['', 3, 3],
    ]);
    expect(r.replaced).toBe('-a--b-');
    expect(segments('axb', r.matches)).toEqual([
      { kind: 'empty', start: 0, end: 0, match: 0 },
      { kind: 'plain', start: 0, end: 1 },
      { kind: 'match', start: 1, end: 2, match: 1 },
      { kind: 'empty', start: 2, end: 2, match: 2 },
      { kind: 'plain', start: 2, end: 3 },
      { kind: 'empty', start: 3, end: 3, match: 3 },
    ]);
  });

  it('without u the dot takes half an emoji and says the boundary splits a pair', () => {
    const r = run('😀', '.', 'g');
    expect(r.matches.map(m => [showMatchText(m.text), m.start, m.end])).toEqual([
      ['"\\ud83d"', 0, 1],
      ['"\\ude00"', 1, 2],
    ]);
    expect(r.splitsPair).toBe(true);
  });

  it('with u the dot takes the whole emoji', () => {
    const r = run('😀', '.', 'gu');
    expect(spans(r)).toEqual([['😀', 0, 2]]);
    expect(r.splitsPair).toBe(false);
  });

  it('an empty pattern advances by a code point with u, by a code unit without', () => {
    const u = run('😀', '', 'gu');
    expect(u.matches.map(m => m.start)).toEqual([0, 2]);
    expect(u.splitsPair).toBe(false);
    const plain = run('😀', '', 'g');
    expect(plain.matches.map(m => m.start)).toEqual([0, 1, 2]);
    expect(plain.splitsPair).toBe(true);
  });

  it('v: class subtraction', () => {
    expect(spans(run('aBcÉ', '[\\p{L}--[a-z]]', 'gv'))).toEqual([
      ['B', 1, 2],
      ['É', 3, 4],
    ]);
  });

  it('a group that did not take part is no match, and substitutes as empty', () => {
    const r = replaced('ab', '(a)|(b)', 'g', '[$1|$2]');
    expect(groups(r.matches[0]!)).toEqual([
      [1, undefined, 'a', 0],
      [2, undefined, null, null],
    ]);
    expect(groups(r.matches[1]!)).toEqual([
      [1, undefined, null, null],
      [2, undefined, 'b', 1],
    ]);
    expect(r.matches[0]!.groups[1]!.end).toBeNull();
    expect(r.replaced).toBe('[a|][|b]');
  });

  it("$$, $&, $` and $'", () => {
    expect(replaced('abc', 'b', '', "$$|$&|$`|$'").replaced).toBe('a$|b|a|cc');
  });

  it('$10 with one group: group 1 and a 0', () => {
    expect(replaced('a', '(a)', '', '$10').replaced).toBe('a0');
  });

  it('$<x> without named groups stays as text', () => {
    expect(replaced('a', '(a)', '', '$<x>').replaced).toBe('$<x>');
  });

  it('$<b> with named groups but no such name is empty', () => {
    expect(replaced('a', '(?<a>a)', '', '[$<b>]').replaced).toBe('[]');
  });

  it('\\n in the replacement is a backslash and an n', () => {
    expect(replaced('a,b', ',', 'g', '\\n').replaced).toBe('a\\nb');
  });

  it('a class with parentheses, a non-capturing group and a lookahead are not groups', () => {
    const pattern = '[(](x)\\((?:y)(?<z>z)(?=q)';
    const r = run('(x(yzq', pattern, 'g');
    expect(spans(r)).toEqual([['(x(yz', 0, 5]]);
    expect(groups(r.matches[0]!)).toEqual([
      [1, undefined, 'x', 1],
      [2, 'z', 'z', 4],
    ]);
    expect(scanGroupNames(pattern, false)).toEqual([undefined, 'z']);
  });

  it('a lookbehind is not a group', () => {
    const r = run('cost $42', '(?<=\\$)(\\d+)', 'g');
    expect(spans(r)).toEqual([['42', 6, 8]]);
    expect(groups(r.matches[0]!)).toEqual([[1, undefined, '42', 6]]);
  });

  // Duplicate names in alternatives and modifiers: Chrome 125+ (V8 12.5); Node 22 (V8 12.4) refuses them, and the tool
  // shows the engine's message — tested on whichever engine runs this.
  it('duplicate group names in different branches (where the engine has them)', () => {
    const pattern = '(?<y>\\d{4})-\\d{2}|\\d{2}/(?<y>\\d{4})';
    if (!compiles(pattern, 'g')) {
      expect(compileRegexp(pattern, 'g')).toEqual({ ok: false, message: engineSays(pattern, 'dg') });
      return;
    }
    const r = replaced('2026-11 and 11/2027', pattern, 'g', '$<y>');
    expect(spans(r)).toEqual([
      ['2026-11', 0, 7],
      ['11/2027', 12, 19],
    ]);
    expect(groups(r.matches[0]!)).toEqual([
      [1, 'y', '2026', 0],
      [2, 'y', null, null],
    ]);
    expect(groups(r.matches[1]!)).toEqual([
      [1, 'y', null, null],
      [2, 'y', '2027', 15],
    ]);
    expect(r.replaced).toBe('2026 and 2027');
    expect(r.literal).toBe('/(?<y>\\d{4})-\\d{2}|\\d{2}\\/(?<y>\\d{4})/g');
  });

  it('modifiers (?i:…) (where the engine has them)', () => {
    if (!compiles('(?i:a)b', 'g')) {
      expect(compileRegexp('(?i:a)b', 'g')).toEqual({ ok: false, message: engineSays('(?i:a)b', 'dg') });
      return;
    }
    expect(spans(run('Ab AB ab', '(?i:a)b', 'g'))).toEqual([
      ['Ab', 0, 2],
      ['ab', 6, 8],
    ]);
  });

  it('no match: the replacement result is the text', () => {
    const r = replaced('abc', 'z', 'g', '-');
    expect(matchCountText(r.matches.length, r.truncated)).toBe('No matches');
    expect(r.replaced).toBe('abc');
  });

  it('an empty text: no matches, an empty result', () => {
    const r = replaced('', 'a', 'g', '-');
    expect(r.matches).toEqual([]);
    expect(r.replaced).toBe('');
  });

  it('an empty pattern (runRegexp only): an empty match at every position, the literal (?:)', () => {
    const r = replaced('ab', '', 'g', '-');
    expect(r.matches.map(m => [m.start, m.end])).toEqual([
      [0, 0],
      [1, 1],
      [2, 2],
    ]);
    expect(r.replaced).toBe('-a-b-');
    expect(r.literal).toBe('/(?:)/g');
  });

  it('lines and columns across line breaks', () => {
    expect(run('ab\ncd\nc', 'c', 'g').matches.map(m => [m.start, m.end, m.line, m.column])).toEqual([
      [3, 4, 2, 1],
      [6, 7, 3, 1],
    ]);
  });

  it('more than 10,000 matches: the first 10,000, truncated', () => {
    const r = run('a'.repeat(10_001), 'a', 'g');
    expect(r.matches).toHaveLength(MAX_MATCHES);
    expect(r.truncated).toBe(true);
    expect(matchCountText(r.matches.length, r.truncated)).toBe('10,000+ matches (the first 10,000 are shown)');
    expect(run('a'.repeat(10_000), 'a', 'g').truncated).toBe(false);
  });

  it('a replacement past 5,000,000 characters stops instead of failing', () => {
    const text = 'a'.repeat(1_000_000);
    const r = run(text, '', 'g', '$`');
    expect(r.replacedTooLarge).toBe(true);
    expect(r.replaced).toBeNull();
    expect(r.matches).toHaveLength(MAX_MATCHES);
  });

  it('…where the built-in replace fails with RangeError: Invalid string length', () => {
    expect(() => 'a'.repeat(1_000_000).replace(/(?:)/g, '$`')).toThrow(RangeError);
  });
});

describe('§10: errors (the engine’s words, tested against the engine running the test)', () => {
  it.each([
    ['(', ''],
    ['a)', ''],
    ['[a', ''],
    ['a**', ''],
    ['\\', ''],
    ['(?<n>a)(?<n>b)', ''],
    ['a{2,1}', ''],
    ['(?<1a>x)', ''],
    ['\\k<x>', 'u'],
    ['\\p{Foo}', 'u'],
    ['[a-\\d]', 'u'],
  ])('%s with flags "%s" does not compile and says what the engine says', (pattern, flags) => {
    const r = compileRegexp(pattern, flags);
    expect(r.ok).toBe(false);
    expect(r).toEqual({ ok: false, message: engineSays(pattern, `d${flags}`) });
    expect(runRegexp({ pattern, flags, text: 'abc', replacement: null })).toEqual(r);
    expect((r as { message: string }).message).not.toMatch(/^Invalid regular expression/);
  });

  // The V8 wording of these is the same in Node 22.20 and Chrome 159 (the spec's «V8» column); it is not ours.
  it('V8 12.x words the common ones as the specification lists them', () => {
    const words = ['(', 'a)', '[a', 'a**', '\\'].map(p => (compileRegexp(p, '') as { message: string }).message);
    expect(words).toEqual([
      'Unterminated group',
      "Unmatched ')'",
      'Unterminated character class',
      'Nothing to repeat',
      '\\ at end of pattern',
    ]);
  });

  it('\\p{L} without u or v compiles, finds p{L} and adds the note', () => {
    const c = compileRegexp('\\p{L}', '');
    expect(c).toMatchObject({ ok: true, notes: ['property-escape-without-u'] });
    expect(spans(run('p{L}', '\\p{L}', ''))).toEqual([['p{L}', 0, 4]]);
    expect(compileRegexp('\\p{L}', 'u')).toMatchObject({ ok: true, notes: [] });
    expect(compileRegexp('\\p{L}', 'v')).toMatchObject({ ok: true, notes: [] });
    expect(compileRegexp('[\\P{L}]', '')).toMatchObject({ ok: true, notes: ['property-escape-without-u'] });
    expect(compileRegexp('\\\\p{L}', '')).toMatchObject({ ok: true, notes: [] });
    expect(compileRegexp('p{L}', '')).toMatchObject({ ok: true, notes: [] });
  });

  it('a pattern over 10,000 characters is refused without compiling', () => {
    expect(compileRegexp('a'.repeat(10_001), '')).toEqual({ ok: false, message: PATTERN_TOO_LONG });
    expect(PATTERN_TOO_LONG).toBe('The pattern is longer than 10,000 characters.');
    expect(compileRegexp('a'.repeat(10_000), '').ok).toBe(true);
  });
});

describe('§10: flags', () => {
  it('normalizeFlags', () => {
    expect(normalizeFlags('uv')).toEqual({ ok: false, message: 'flags u and v cannot be used together' });
    expect(normalizeFlags('x')).toEqual({ ok: false, message: 'unknown flag "x"' });
    expect(normalizeFlags('gg')).toEqual({ ok: false, message: 'a flag is repeated' });
    expect(normalizeFlags('yig')).toEqual({ ok: true, flags: 'giy' });
    expect(normalizeFlags('vgd')).toEqual({ ok: true, flags: 'dgv' });
    expect(normalizeFlags('')).toEqual({ ok: true, flags: '' });
  });

  it('toggleFlag: u and v exclude each other, never d', () => {
    expect(toggleFlag('g', 'u')).toBe('gu');
    expect(toggleFlag('gu', 'v')).toBe('gv');
    expect(toggleFlag('gv', 'u')).toBe('gu');
    expect(toggleFlag('gi', 'i')).toBe('g');
    expect(toggleFlag('', 'y')).toBe('y');
    expect(toggleFlag('dg', 'i')).toBe('gi');
  });

  it('the flag string is canonical (dgimsuvy) whatever order it came in; d stays internal', () => {
    const c = compileRegexp('a', 'yimg');
    expect(c).toMatchObject({ ok: true, flags: 'gimy', literal: '/a/gimy' });
    expect(compileRegexp('a', 'gu')).toMatchObject({ ok: true, literal: '/a/gu' });
    expect(compileRegexp('a', 'uv')).toEqual({ ok: false, message: 'flags u and v cannot be used together' });
  });

  it('flags in words', () => {
    expect(flagWords('gm')).toBe('global, multiline');
    expect(flagWords('gimsvy')).toBe('global, ignore case, multiline, dotAll, unicodeSets, sticky');
    expect(flagWords('')).toBe('');
  });
});

describe('§10: a pasted literal', () => {
  it('splits the pattern from the flags', () => {
    expect(splitLiteral('/a+b/gi')).toEqual({ pattern: 'a+b', flags: 'gi' });
    expect(splitLiteral('/[/]x/')).toEqual({ pattern: '[/]x', flags: '' });
    expect(splitLiteral('/a\\/b/')).toEqual({ pattern: 'a\\/b', flags: '' });
    expect(splitLiteral('/a/dg')).toEqual({ pattern: 'a', flags: 'g' });
    expect(splitLiteral(' /\\d+/g ')).toEqual({ pattern: '\\d+', flags: 'g' });
    expect(splitLiteral('/^\\s*#.*$/gm')).toEqual({ pattern: '^\\s*#.*$', flags: 'gm' });
    expect(splitLiteral('/a/yg')).toEqual({ pattern: 'a', flags: 'gy' });
  });

  it('is not a literal: a path, an unknown flag, u with v, an empty body, a line break', () => {
    for (const text of ['/usr/local/bin/', '/a/x', '/a/uv', '//', '/a\nb/', '/a/gg', 'a/b/', '/abc', '/a\\', '/a/g1'])
      expect(splitLiteral(text), JSON.stringify(text)).toBeNull();
  });
});

describe('§10: the pathological pattern compiles at once on the page', () => {
  it('^(a+)+$ compiles in well under 0.1 ms (it is parsed, not run)', () => {
    expect(compileRegexp('^(a+)+$', 'g')).toMatchObject({ ok: true, groups: [{ number: 1 }] });
    const runs = 200;
    const started = performance.now();
    for (let i = 0; i < runs; i++) compileRegexp('^(a+)+$', 'g');
    expect((performance.now() - started) / runs).toBeLessThan(0.1);
  });
});

describe('§5 beyond the table', () => {
  it('y without g: one match, only at position 0', () => {
    expect(spans(run('1a2', '\\d', 'y'))).toEqual([['1', 0, 1]]);
    expect(run('a12', '\\d', 'y').matches).toEqual([]);
    expect(replaced('a12', '\\d', 'y', '#').replaced).toBe('a12');
    expect(replaced('12a', '\\d', 'y', '#').replaced).toBe('#2a');
  });

  it('an empty text and a* is one empty match at 0', () => {
    expect(run('', 'a*', 'g').matches.map(m => [m.start, m.end])).toEqual([[0, 0]]);
  });

  it('a pattern of spaces finds spaces; a text of spaces and line breaks is a text', () => {
    expect(spans(run('a  b', '  ', 'g'))).toEqual([['  ', 1, 3]]);
    expect(run(' \n \n', '\\s', 'g').matches).toHaveLength(4);
  });

  it('non-ASCII: i compares case the engine’s way', () => {
    expect(spans(run('ПРИВЕТ привет', 'привет', 'gi'))).toEqual([
      ['ПРИВЕТ', 0, 6],
      ['привет', 7, 13],
    ]);
    expect(spans(run('é É', 'é', 'gi'))).toEqual([
      ['é', 0, 1],
      ['É', 2, 3],
    ]);
    // ſ (U+017F) folds to s with u (simple case folding), not without (toUpperCase gives S, but ASCII is not mapped
    // from non-ASCII by Canonicalize).
    expect(run('ſ', 's', 'gi').matches).toHaveLength(0);
    expect(run('ſ', 's', 'giu').matches).toHaveLength(1);
  });

  it('astral characters: positions are UTF-16 units, the column too', () => {
    const r = run('😀x\n😀😀y', '[xy]', 'g');
    expect(r.matches.map(m => [m.text, m.start, m.line, m.column])).toEqual([
      ['x', 2, 1, 3],
      ['y', 8, 2, 5],
    ]);
    expect(r.splitsPair).toBe(false);
  });

  it('only \\n divides lines; \\r, U+2028 and U+2029 are characters of a line', () => {
    const r = run('a\rb c d\ne', '[a-e]', 'g');
    expect(r.matches.map(m => [m.text, m.line, m.column])).toEqual([
      ['a', 1, 1],
      ['b', 1, 3],
      ['c', 1, 5],
      ['d', 1, 7],
      ['e', 2, 1],
    ]);
    // …while for the engine with m they are line terminators.
    expect(run('a\rb c', '^\\w', 'gm').matches.map(m => m.text)).toEqual(['a', 'b', 'c']);
  });

  it('the number of groups comes from the engine, the names from the scan (v nests classes)', () => {
    expect(compileRegexp('(?<a>x)([(])(?:y)(?=z)(?<!w)', '')).toMatchObject({
      ok: true,
      groups: [{ number: 1, name: 'a' }, { number: 2 }],
    });
    expect(scanGroupNames('[[\\(]](?<n>a)', true)).toEqual(['n']);
    expect(compileRegexp('[[\\(]](?<n>a)', 'v')).toMatchObject({ ok: true, groups: [{ number: 1, name: 'n' }] });
    expect(compileRegexp('[[(]](?<n>a)', '')).toMatchObject({ ok: true, groups: [{ number: 1, name: 'n' }] });
    expect(scanGroupNames('[[(]](?<n>a)', false)).toEqual(['n']);
    expect(scanGroupNames('\\((a)', false)).toEqual([undefined]);
  });

  it('the literal is the engine’s source with the person’s flags', () => {
    expect(compileRegexp('a/b', 'g')).toMatchObject({ ok: true, literal: '/a\\/b/g' });
    expect(compileRegexp('', 'g')).toMatchObject({ ok: true, literal: '/(?:)/g', groups: [] });
    expect(compileRegexp('\n', '')).toMatchObject({ ok: true, literal: '/\\n/' });
  });

  it('substitute is GetSubstitution: two-digit references, $0, $00, a lone $, $< without >', () => {
    const cases: Array<[string, string, string]> = [
      ['(a)', '', '$01|$00|$0|$05|$1$'],
      ['(a)(b)(c)(d)(e)(f)(g)(h)(i)(j)(k)', '', '$11|$10|$12|$011|$1'],
      ['(?<n>a)', '', '$<n|$<n>|$<>|$'],
      ['(a)', '', '$<n>'],
      ['b', 'g', "$-$&$'"],
      ['(?<n>a)|(b)', 'g', '[$<n>$2]'],
    ];
    for (const [pattern, flags, replacement] of cases) {
      const text = pattern.startsWith('(a)(b)') ? 'abcdefghijk!' : 'xaby';
      expect(replaced(text, pattern, flags, replacement).replaced, `${pattern} ${replacement}`).toBe(
        builtin(text, pattern, flags, replacement),
      );
    }
    expect(substitute('b', 'abc', 1, [], undefined, "$`|$'|$&")).toBe('a|c|b');
    expect(substitute('a', 'a', 0, ['a'], { toString: undefined }, '$<toString>')).toBe('');
  });

  it('replaceAll goes over every match even past the 10,000 listed', () => {
    const r = run('a'.repeat(12_000), 'a', 'g', 'b');
    expect(r.matches).toHaveLength(MAX_MATCHES);
    expect(r.replaced).toBe('b'.repeat(12_000));
    const re = /a/g;
    re.lastIndex = 5;
    expect(replaceAll('aaa', re, 'b', MAX_RESULT)).toBe('bbb');
    expect(re.lastIndex).toBe(5);
    expect(replaceAll('aaa', /a/g, 'bb', 5)).toBeNull();
    expect(replaceAll('aaa', /a/g, 'bb', 6)).toBe('bbbbbb');
  });

  it('showMatchText quotes as JSON and cuts at 200 characters with …', () => {
    expect(showMatchText('')).toBe('""');
    expect(showMatchText(' a\t"\\')).toBe('" a\\t\\"\\\\"');
    const long = showMatchText('x'.repeat(500));
    expect(long).toHaveLength(200);
    expect(long.endsWith('…')).toBe(true);
    expect(showMatchText('x'.repeat(198))).toBe(`"${'x'.repeat(198)}"`);
    expect(showMatchText('x'.repeat(199)).endsWith('…')).toBe(true);
  });

  it('the status line', () => {
    expect(matchCountText(0, false)).toBe('No matches');
    expect(matchCountText(1, false)).toBe('1 match');
    expect(matchCountText(2, false)).toBe('2 matches');
    expect(matchCountText(1234, false)).toBe('1,234 matches');
  });

  it('segments of a single match without g, and of no matches', () => {
    const r = run('abcabc', 'b', '');
    expect(segments('abcabc', r.matches)).toEqual([
      { kind: 'plain', start: 0, end: 1 },
      { kind: 'match', start: 1, end: 2, match: 0 },
      { kind: 'plain', start: 2, end: 6 },
    ]);
    expect(segments('abc', [])).toEqual([{ kind: 'plain', start: 0, end: 3 }]);
    expect(segments('', [])).toEqual([]);
  });
});

describe('long inputs stay linear (300,000 characters and more)', () => {
  const big = 300_000;

  it('the scans of the pattern and of a pasted literal', () => {
    const started = performance.now();
    expect(scanGroupNames('(a)'.repeat(big / 3), false)).toHaveLength(big / 3);
    expect(scanGroupNames('['.repeat(big), true)).toEqual([]);
    expect(scanGroupNames('(?<'.repeat(big / 3), false)).toEqual([]);
    expect(splitLiteral(`/${'a'.repeat(big)}/g`)).toEqual({ pattern: 'a'.repeat(big), flags: 'g' });
    expect(splitLiteral(`/${'['.repeat(big)}`)).toBeNull();
    expect(splitLiteral('/'.repeat(big))).toBeNull();
    expect(showMatchText('"'.repeat(big))).toHaveLength(200);
    expect(compileRegexp('\\'.repeat(big), '').ok).toBe(false);
    expect(substitute('a', 'a', 0, ['a'], { n: 'a' }, '$<'.repeat(big / 2))).toBe('$<'.repeat(big / 2));
    expect(substitute('a', 'a', 0, ['a'], { n: 'a' }, `${'$<n>'.repeat(big / 4)}`)).toBe('a'.repeat(big / 4));
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  it('10,000 matches on one line of 1,000,000 characters: lines and columns in one pass', () => {
    const text = 'x'.repeat(1_000_000 - 10_000) + 'a'.repeat(10_000);
    const started = performance.now();
    const r = run(text, 'a', 'g', '$&!');
    expect(r.matches).toHaveLength(10_000);
    expect(r.matches.at(-1)).toMatchObject({ line: 1, column: 1_000_000 });
    expect(r.replaced).toHaveLength(1_010_000);
    expect(performance.now() - started).toBeLessThan(2_000);
  });

  it('10,000 matches over 100,000 lines', () => {
    const text = 'a\n'.repeat(150_000);
    const r = run(text, 'a', 'g');
    expect(r.truncated).toBe(true);
    expect(r.matches.at(-1)).toMatchObject({ line: 10_000, column: 1, start: 19_998 });
    expect(segments(text, r.matches)).toHaveLength(20_000);
  });
});
