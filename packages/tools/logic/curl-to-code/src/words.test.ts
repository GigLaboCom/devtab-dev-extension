// The command line is read as a shell reads it (docs/tools/specs/curl-to-code.md §5, «Слова командной строки»): a
// table over every quoting rule of both forms, then round trips against the real shells for inputs generated here —
// `printf '%s\0' <args>` in /bin/sh (POSIX quoting) and in bash 4.2+ when the machine has one ($'…' with \u and \U).
// Only commands this file writes itself are ever given to a shell; the tool never runs anything.
import { isCmdForm, splitWords } from './words';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const words = (text: string): string[] => {
  const r = splitWords(text);
  if (!r.ok) throw new Error(`${r.offset}: ${r.message}`);
  return r.words.map(w => w.text);
};
const split = (text: string) => {
  const r = splitWords(text);
  if (!r.ok) throw new Error(`${r.offset}: ${r.message}`);
  return r;
};

describe('POSIX form', () => {
  it.each<[string, string[]]>([
    // blanks and continuations
    ['a  b\tc', ['a', 'b', 'c']],
    ['  a \r\n', ['a']],
    ['a\\\nb', ['ab']],
    ['a \\\n  b', ['a', 'b']],
    ['a \\\r\n  b', ['a', 'b']],
    // a backslash outside quotes
    ['a\\ b', ['a b']],
    ['\\\'\\"\\$\\|\\\\', ['\'"$|\\']],
    ['\\a\\b', ['ab']],
    ['a\\', ['a\\']],
    // single quotes
    ["'a b' 'c\\n' '' x''y", ['a b', 'c\\n', '', 'xy']],
    ['\'$HOME `x` "q" | ; & < > #\'', ['$HOME `x` "q" | ; & < > #']],
    ["'line1\nline2'", ['line1\nline2']],
    // double quotes: \ escapes only $ ` " \ and a line break
    ['"a b" ""', ['a b', '']],
    ['"\\$ \\` \\" \\\\"', ['$ ` " \\']],
    ['"\\a\\n\\\'"', ["\\a\\n\\'"]],
    ['"a\\\nb"', ['ab']],
    ['"$" "a$" "$ x"', ['$', 'a$', '$ x']],
    ['"| ; & # \' x"', ["| ; & # ' x"]],
    // pieces glued into one word
    ["a\"b c\"'d e'$'f\\tg'", ['ab cd ef\tg']],
    // comments
    ['a # b c', ['a']],
    ['a#b', ['a#b']],
    ['# only\na', ['a']],
    ['a "#" \'#\' \\#b', ['a', '#', '#', '#b']],
    // a lone $ is literal
    ['$ curl', ['$', 'curl']],
  ])('%j', (text, want) => expect(words(text)).toEqual(want));

  it.each<[string, string]>([
    ["$'\\n\\t\\r\\a\\b\\e\\E\\f\\v'", '\n\t\r\u0007\b\u001b\u001b\f\u000b'],
    ["$'\\\\ \\' \\\" \\?'", `\\ ' " ?`],
    ["$'\\x41\\x4a\\x414\\x'", 'AJA4\\x'],
    ["$'\\u00e9\\u20AC\\U0001F600\\u'", 'é€😀\\u'],
    ["$'\\101\\1012\\0101'", 'AA2\b1'],
    ["$'\\q\\%\\8'", '\\q\\%\\8'],
    ["$'a\\cAb\\c?'", 'a\u0001b\u007f'],
    ["$'a\\0b'", 'a'],
    ["$'it\\'s'", "it's"],
    ["$'\\xc3\\xa9'", 'é'],
  ])("$'…' %j", (text, want) => expect(words(text)).toEqual([want]));

  it('bytes that are not UTF-8 are kept as bytes', () => {
    const r = split("$'\\xff\\x00z' $'a\\ud800'");
    expect(r.words[0]!.bytes).toEqual(Uint8Array.of(0xff));
    expect(r.words[0]!.text).toBe('\ufffd');
    expect(r.words[1]!.bytes).toEqual(Uint8Array.of(0x61, 0xed, 0xa0, 0x80));
    expect(split("$'\\xc3\\xa9'").words[0]!.bytes).toBeUndefined();
  });

  it.each<[string, string[], string]>([
    ['curl x | jq .', ['curl', 'x'], '| jq .'],
    ['curl x; echo', ['curl', 'x'], '; echo'],
    ['curl x && echo ok', ['curl', 'x'], '&& echo ok'],
    ['curl x&', ['curl', 'x'], '&'],
    ['curl x > out.json', ['curl', 'x'], '> out.json'],
    ['curl x 2>&1', ['curl', 'x'], '>&1'],
    ['curl x 2>/dev/null', ['curl', 'x'], '>/dev/null'],
    ['curl x <in', ['curl', 'x'], '<in'],
    ['curl a\ncurl b', ['curl', 'a'], 'curl b'],
    ['curl a\n\n# done\n', ['curl', 'a'], ''],
    ['curl \'a|b\' "c;d" e\\&f', ['curl', 'a|b', 'c;d', 'e&f'], ''],
  ])('%j ends the command', (text, want, rest) => {
    const r = split(text);
    expect(r.words.map(w => w.text)).toEqual(want);
    expect(r.rest).toBe(rest);
  });

  it.each<[string, string[], boolean]>([
    ['$HOME', ['$HOME'], true],
    ['"a $X"', ['a $X'], true],
    ['${A:-b c}', ['${A:-b c}'], true],
    ['$(date +%s) x', ['$(date +%s)', 'x'], true],
    ['"$(echo "a b")"', ['$(echo "a b")'], true],
    ['`date +%s`', ['`date +%s`'], true],
    ['$1 $? $$', ['$1', '$?', '$$'], true],
    ["'$HOME'", ['$HOME'], false],
    ['\\$HOME "\\$X" "\\`x\\`"', ['$HOME', '$X', '`x`'], false],
    ['$ "$" a$', ['$', '$', 'a$'], false],
  ])('%j: not expanded, marked %s', (text, want, marked) => {
    const r = split(text);
    expect(r.words.map(w => w.text)).toEqual(want);
    expect(r.expansions).toBe(marked);
  });

  it('word offsets are UTF-16 offsets into the input', () => {
    expect(split("curl  'é😀' -H\\\n x").words.map(w => w.offset)).toEqual([0, 6, 12, 17]);
  });

  it.each<[string, string, number]>([
    ["curl 'abc", 'unterminated single quote', 5],
    ['curl "abc\\"', 'unterminated double quote', 5],
    ["curl $'abc\\'", "unterminated $'…' string", 5],
    ['curl a$"b', 'unterminated double quote', 7],
  ])('%j → %s at %d', (text, message, offset) => expect(splitWords(text)).toEqual({ ok: false, message, offset }));
});

describe('cmd form', () => {
  it.each<[string, boolean]>([
    ['curl ^"x^"', true],
    ['curl x ^\n -s', true],
    ['curl x ^\r\n -s', true],
    ['curl x ^', true],
    ["curl 'a^b'", false],
    ['curl x', false],
  ])('isCmdForm(%j) → %s', (text, want) => expect(isCmdForm(text)).toBe(want));

  it.each<[string, string[]]>([
    [
      'curl ^"https://a.example/?q=1^&x=2^" ^\n  -H ^"accept: */*^"',
      ['curl', 'https://a.example/?q=1&x=2', '-H', 'accept: */*'],
    ],
    ['curl ^"^{^\\^"a^\\^":1^}^"', ['curl', '{"a":1}']],
    // a caret, a line break and an empty line: a line break in the value (Chrome's "Copy as cURL (cmd)")
    ['curl ^"a^\n\nb^" ^\n -s', ['curl', 'a\nb', '-s']],
    // the C runtime's backslashes: 2n before " → n and a quote toggle, 2n+1 → n and a literal "
    ['curl "a\\\\" b', ['curl', 'a\\', 'b']],
    ['curl "a\\"b" c', ['curl', 'a"b', 'c']],
    ['curl a\\\\\\"b', ['curl', 'a\\"b']],
    ['curl a\\b\\\\c ^', ['curl', 'a\\b\\\\c']],
    ['curl "a""b" ^', ['curl', 'a"b']],
    // inside cmd's own quotes a caret is literal
    ['curl "a^b" ^', ['curl', 'a^b']],
    ['curl ^^ ^', ['curl', '^']],
  ])('%j', (text, want) => expect(words(text)).toEqual(want));

  it('& | < > outside quotes end the command; ; does not', () => {
    const r = split('curl ^"x^" a;b & echo');
    expect(r.words.map(w => w.text)).toEqual(['curl', 'x', 'a;b']);
    expect(r.rest).toBe('& echo');
    expect(split('curl "a&b" ^').words.map(w => w.text)).toEqual(['curl', 'a&b']);
  });

  it("%NAME% is not expanded and marks the command; %^NAME% (Chrome's escape) does not", () => {
    expect(split('curl ^"%TOKEN%^"')).toMatchObject({ expansions: true, words: [{}, { text: '%TOKEN%' }] });
    expect(split('curl ^"50%^PATH%^"')).toMatchObject({ expansions: false, words: [{}, { text: '50%PATH%' }] });
  });

  it('offsets point at the word in the input', () => {
    expect(split('curl ^"x^" ^\n  -s').words.map(w => w.offset)).toEqual([0, 5, 15]);
  });
});

// ----------------------------------------------------------------------------------------------------------------------
// Round trips against the real shells.

const HEAVY = { timeout: 60_000 };
const BASH4 = ['/opt/homebrew/bin/bash', '/usr/local/bin/bash', '/usr/bin/bash', '/bin/bash'].find(path => {
  if (!existsSync(path)) return false;
  const r = spawnSync(path, ['-c', 'printf %s "${BASH_VERSINFO[0]}${BASH_VERSINFO[1]}"'], { encoding: 'utf8' });
  return r.status === 0 && Number(r.stdout) >= 42;
});
const SH = existsSync('/bin/sh') ? '/bin/sh' : undefined;

const generator = (seed: number) => {
  let state = seed >>> 0 || 1;
  return (n: number): number => {
    state ^= state << 13;
    state >>>= 0;
    state ^= state >>> 17;
    state ^= state << 5;
    state >>>= 0;
    return state % n;
  };
};

// No ',' (bash would expand braces: a{b,c}), no '~' (a home directory at the start of a word): the tool reads neither.
const CHARS = ['a', 'Z', '0', '-', '=', ':', '/', '.', '%', '{', '}', '@', '+', 'é', 'Ж', '😀', '\u2028', '^', '!'];
const ANY = [...CHARS, ' ', '\t', '\n', '"', "'", '\\', '$', '`', '|', ';', '&', '<', '>', '#', '(', ')', '*', '?'];
const pick = <T>(next: (n: number) => number, list: readonly T[]): T => list[next(list.length)]!;

/** One piece of a word: plain, escaped, single-quoted, double-quoted (with its escapes), or bash's $'…'. */
const piece = (next: (n: number) => number, ansi: boolean): string => {
  const kind = next(ansi ? 6 : 5);
  const run = (pool: readonly string[], filter: (c: string) => boolean): string => {
    let s = '';
    for (let i = next(6); i > 0; i--) {
      const c = pick(next, pool);
      if (filter(c)) s += c;
    }
    return s;
  };
  switch (kind) {
    case 0:
      return run(CHARS, () => true) || 'x';
    case 1:
      return `\\${pick(
        next,
        ANY.filter(c => c !== '\n'),
      )}`;
    case 2:
      return `'${run(ANY, c => c !== "'")}'`;
    case 3: {
      let s = '"';
      for (let i = next(6); i > 0; i--) {
        const r = next(4);
        if (r === 0) s += `\\${pick(next, ['$', '`', '"', '\\', '\n', 'a', 'n', "'"])}`;
        else if (r === 1) s += pick(next, ['$ ', "'", '#', '|', '\n', ' ']);
        else s += pick(next, CHARS);
      }
      return s.endsWith('$') ? `${s} "` : `${s}"`;
    }
    case 4:
      return '\\\n';
    default: {
      let s = "$'";
      for (let i = next(6); i > 0; i--) {
        const r = next(3);
        if (r === 0)
          s += pick(next, ['\\n', '\\t', '\\e', '\\\\', "\\'", '\\"', '\\?', '\\x41', '\\x7', '\\101', '\\7', '\\cA']);
        else if (r === 1) s += pick(next, ['\\u00e9', '\\u20ac', '\\U0001F600', '\\q', '\\u4', '\\xc3\\xa9']);
        else
          s += pick(
            next,
            ANY.filter(c => c !== "'" && c !== '\\'),
          );
      }
      return `${s}'`;
    }
  }
};

const randomArgs = (next: (n: number) => number, ansi: boolean): string => {
  const args: string[] = [];
  for (let a = 1 + next(4); a > 0; a--) {
    let w = '';
    for (let p = 1 + next(3); p > 0; p--) w += piece(next, ansi);
    // A word must not start with a comment or end in a continuation only.
    if (w.startsWith('#')) w = `x${w}`;
    if (w.replaceAll('\\\n', '') === '') w += 'y';
    args.push(w);
  }
  return args.join(pick(next, [' ', '  ', '\t', ' \\\n  ']));
};

/** What the shell's printf receives: each case's arguments, NUL-separated, cases separated by \x1e. */
const shellWords = (shell: string, cases: string[]): string[][] => {
  const script = cases.map(args => `printf '%s\\0' ${args}\nprintf '\\036'\n`).join('');
  const r = spawnSync(shell, ['-c', script], { maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${shell}: ${r.stderr.toString()}`);
  const out = new TextDecoder('utf-8').decode(r.stdout);
  return out
    .split('\u001e')
    .slice(0, cases.length)
    .map(chunk => chunk.split('\0').slice(0, -1));
};

const ours = (args: string): string[] => {
  const r = splitWords(`printf '%s\\0' ${args}`);
  if (!r.ok) throw new Error(r.message);
  return r.words.slice(2).map(w => (w.bytes ? new TextDecoder().decode(w.bytes) : w.text));
};

describe('round trips against the real shell', () => {
  it.skipIf(!SH)('500 generated POSIX command lines read as /bin/sh reads them', HEAVY, () => {
    const next = generator(20261122);
    // A generated line that would read as the cmd form (a word starting with ^") is not a POSIX case.
    const cases = Array.from({ length: 600 }, () => randomArgs(next, false))
      .filter(c => !isCmdForm(`printf '%s\\0' ${c}`))
      .slice(0, 500);
    expect(cases).toHaveLength(500);
    const theirs = shellWords(SH!, cases);
    const mismatches = cases.filter((c, i) => JSON.stringify(ours(c)) !== JSON.stringify(theirs[i]));
    expect(mismatches.slice(0, 3).map(c => [c, ours(c), theirs[cases.indexOf(c)]])).toEqual([]);
  });

  it.skipIf(!BASH4)("500 generated command lines with $'…' read as bash reads them", HEAVY, () => {
    const next = generator(32);
    const cases = Array.from({ length: 600 }, () => randomArgs(next, true))
      .filter(c => !isCmdForm(`printf '%s\\0' ${c}`))
      .slice(0, 500);
    expect(cases).toHaveLength(500);
    const theirs = shellWords(BASH4!, cases);
    const mismatches = cases.filter((c, i) => JSON.stringify(ours(c)) !== JSON.stringify(theirs[i]));
    expect(mismatches.slice(0, 3).map(c => [c, ours(c), theirs[cases.indexOf(c)]])).toEqual([]);
  });
});
