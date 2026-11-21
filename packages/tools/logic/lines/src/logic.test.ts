import {
  COLLATION_LOCALE,
  DEFAULT_PIPELINE,
  LIMITS,
  TOO_LARGE,
  affixLines,
  codePointLength,
  compareCodePoints,
  countLines,
  countSplit,
  createShuffleTape,
  dedupeLines,
  deltaText,
  duplicateKey,
  filterLines,
  joinLines,
  leadingNumber,
  numberLines,
  removeBlankLines,
  runPipeline,
  shuffleLines,
  sortLines,
  splitLines,
  splitOn,
  summaryText,
  trimLines,
} from './logic';
import { bufferedSource, cryptoRandom } from '@workspace/tools-shared/random';
import { describe, expect, it } from 'vitest';
import type { Pipeline, PipelineResult, RandomSource, SortOptions } from './logic';

// docs/tools/specs/lines.md §10, row by row (the row's input in the test name), then what §5 and §6 state that §10 does
// not show, then properties the specification implies.

type Steps = { [K in keyof Pipeline]?: Partial<Pipeline[K]> };
/** The default pipeline with the given steps enabled and their options merged in. */
const pipe = (steps: Steps = {}): Pipeline => {
  const p = structuredClone(DEFAULT_PIPELINE) as Pipeline;
  for (const [name, options] of Object.entries(steps) as Array<[keyof Pipeline, object]>)
    Object.assign(p[name], { enabled: true }, options);
  return p;
};
const ok = (result: PipelineResult) => {
  if (!result.ok) throw new Error(`refused: ${result.message}`);
  return result;
};
const run = (text: string, steps: Steps = {}, source?: RandomSource) => ok(runPipeline(text, pipe(steps), source));
const out = (text: string, steps: Steps = {}, source?: RandomSource) => run(text, steps, source).text;
const sort = (kind: SortOptions['kind'], more: Partial<SortOptions> = {}): Steps['order'] => ({
  kind: 'sort',
  sort: { kind, descending: false, uppercaseFirst: false, ...more },
});
const comma = { separator: { kind: 'text', text: ',' } } as const;

/** The predictable source of §10: bytes 00 01 02 … across calls. */
const counting = (): RandomSource => {
  let next = 0;
  return bytes => {
    for (let i = 0; i < bytes.length; i++) bytes[i] = next++ & 0xff;
  };
};

describe('§10: lines, the line break, nothing enabled', () => {
  it('"" → "", in 0, out 0 (N1)', () => {
    expect(run('')).toMatchObject({ text: '', linesIn: 0, linesOut: 0, deltas: {} });
  });
  it('"b\\r\\na\\rc\\n" → "b\\na\\nc\\n", in 3, out 3 (N2)', () => {
    expect(run('b\r\na\rc\n')).toMatchObject({ text: 'b\na\nc\n', linesIn: 3, linesOut: 3 });
  });
  it('"\\n" → "\\n", in 1 (N3)', () => {
    expect(run('\n')).toMatchObject({ text: '\n', linesIn: 1 });
  });
  it('"\\n\\n\\n" → "\\n\\n\\n", in 3 (G5)', () => {
    expect(run('\n\n\n')).toMatchObject({ text: '\n\n\n', linesIn: 3, linesOut: 3 });
  });
  it('splitLines "a\\n\\n" / "a\\r\\n\\rb\\n"', () => {
    expect(splitLines('a\n\n')).toEqual({ lines: ['a', ''], trailingBreak: true });
    expect(splitLines('a\r\n\rb\n')).toEqual({ lines: ['a', '', 'b'], trailingBreak: true });
  });
  it('splitLines "a\\u2028b" / "a\\fb\\vc\\u0085d": one line', () => {
    expect(splitLines('a b')).toEqual({ lines: ['a b'], trailingBreak: false });
    expect(splitLines('a\fb\vc\u0085d')).toEqual({ lines: ['a\fb\vc\u0085d'], trailingBreak: false });
  });
  it('"   \\n\\t" — / Remove blank lines (G3, G4)', () => {
    expect(run('   \n\t')).toMatchObject({ text: '   \n\t', linesIn: 2, linesOut: 2 });
    expect(run('   \n\t', { blank: {} })).toMatchObject({ text: '', linesOut: 0, deltas: { blank: -2 } });
  });
});

describe('§10: Split lines', () => {
  it('"a, b,,c" Split , (S1)', () => {
    expect(run('a, b,,c', { split: comma })).toMatchObject({
      text: 'a\n b\n\nc',
      linesIn: 1,
      linesOut: 4,
      deltas: { split: 3 },
    });
  });
  it('"a, b,,c" Split , Trim, Remove blank lines (S2)', () => {
    expect(run('a, b,,c', { split: comma, trim: {}, blank: {} })).toMatchObject({
      text: 'a\nb\nc',
      deltas: { split: 3, blank: -1 },
    });
  });
  it('"  a  b\\t c \\n\\n   \\nd" Split Whitespace (S3)', () => {
    expect(run('  a  b\t c \n\n   \nd', { split: { separator: { kind: 'whitespace' } } })).toMatchObject({
      text: 'a\nb\nc\nd',
      linesIn: 4,
      linesOut: 4,
      deltas: { split: 0 },
    });
  });
  it('"a::b::c" Custom :: / "a,b" Custom empty (S4, S5)', () => {
    expect(out('a::b::c', { split: { separator: { kind: 'text', text: '::' } } })).toBe('a\nb\nc');
    expect(run('a,b', { split: { separator: { kind: 'text', text: '' } } })).toMatchObject({
      text: 'a,b',
      deltas: { split: 0 },
    });
  });
});

describe('§10: Trim', () => {
  it('"  x  \\n\\t y \\u00a0\\n\\u3000z\\u200b" Both ends (T1)', () => {
    expect(out('  x  \n\t y  \n　z​', { trim: {} })).toBe('x\ny\nz​');
  });
  it('"  x  \\n  y  " Start / End (T2, T3)', () => {
    expect(out('  x  \n  y  ', { trim: { mode: 'start' } })).toBe('x  \ny  ');
    expect(out('  x  \n  y  ', { trim: { mode: 'end' } })).toBe('  x\n  y');
  });
  it('"  a \\t  b   c  " Both + Collapse / Start + Collapse (T4, T5)', () => {
    expect(out('  a \t  b   c  ', { trim: { collapse: true } })).toBe('a b c');
    expect(out('  a \t  b   c  ', { trim: { mode: 'start', collapse: true } })).toBe('a b c  ');
  });
  it('"a\\u0085" / "\\ufeffkey" (T6, T7)', () => {
    expect(out('a\u0085', { trim: {} })).toBe('a\u0085');
    expect(out('﻿key', { trim: {} })).toBe('key');
  });
  it('"a\\u2028b\\n c\\u2029" (G6)', () => {
    expect(out('a b\n c ', { trim: {} })).toBe('a b\nc');
  });
});

describe('§10: Filter', () => {
  const log = 'GET /a\npost /b\nGET /c';
  it('Keep get (F1)', () => {
    expect(run(log, { filter: { text: 'get' } })).toMatchObject({ text: 'GET /a\nGET /c', deltas: { filter: -1 } });
  });
  it('Keep get, Match case (F2)', () => {
    expect(run(log, { filter: { text: 'get', matchCase: true } })).toMatchObject({
      text: '',
      linesOut: 0,
      deltas: { filter: -3 },
    });
  });
  it('Remove GET (F3)', () => {
    expect(run(log, { filter: { keep: false, text: 'GET' } })).toMatchObject({
      text: 'post /b',
      deltas: { filter: -2 },
    });
  });
  it('"caf\\u00e9\\ncafe\\u0301\\ncafe" Keep caf\\u00e9 (F4)', () => {
    expect(out('café\ncafé\ncafe', { filter: { text: 'café' } })).toBe('café\ncafé');
  });
  it('"STRASSE\\nStraße\\nstrand" Keep straße (F5)', () => {
    expect(out('STRASSE\nStraße\nstrand', { filter: { text: 'straße' } })).toBe('STRASSE\nStraße');
  });
  it('"a\\nb" Keep, empty (F6)', () => {
    expect(run('a\nb', { filter: { text: '' } })).toMatchObject({ text: 'a\nb', deltas: { filter: 0 } });
  });
});

describe('§10: Remove blank lines', () => {
  it('"a\\n\\n \\t\\nb\\n\\n" All (B1)', () => {
    expect(run('a\n\n \t\nb\n\n', { blank: {} })).toMatchObject({
      text: 'a\nb\n',
      linesIn: 5,
      linesOut: 2,
      deltas: { blank: -3 },
    });
  });
  it('"\\n\\na\\n\\n \\t\\n\\nb\\n\\n" Keep one in a row (B2)', () => {
    expect(run('\n\na\n\n \t\n\nb\n\n', { blank: { mode: 'repeated' } })).toMatchObject({
      text: '\na\n\nb\n\n',
      linesIn: 8,
      linesOut: 5,
    });
  });
  it('"\\n\\n" / " \\n\\u00a0" (B3, B4)', () => {
    expect(run('\n\n', { blank: {} })).toMatchObject({ text: '', linesOut: 0 });
    expect(run(' \n ', { blank: {} })).toMatchObject({ text: '', linesOut: 0 });
  });
});

describe('§10: Duplicates', () => {
  const list = 'b\na\nb\nc\na\nb';
  it('Remove (D1)', () => {
    expect(run(list, { duplicates: {} })).toMatchObject({ text: 'b\na\nc', deltas: { duplicates: -3 } });
  });
  it('"Apple\\napple\\nAPPLE\\nbanana" Remove / + Ignore case (D2, D3)', () => {
    const fruit = 'Apple\napple\nAPPLE\nbanana';
    expect(run(fruit, { duplicates: {} })).toMatchObject({ text: fruit, deltas: { duplicates: 0 } });
    expect(run(fruit, { duplicates: { ignoreCase: true } })).toMatchObject({
      text: 'Apple\nbanana',
      deltas: { duplicates: -2 },
    });
  });
  it('"Straße\\nSTRASSE\\nstrasse" Ignore case (D4)', () => {
    expect(out('Straße\nSTRASSE\nstrasse', { duplicates: { ignoreCase: true } })).toBe('Straße');
  });
  it('"a  b\\n a b \\na b\\nab" Ignore whitespace (D5)', () => {
    expect(out('a  b\n a b \na b\nab', { duplicates: { ignoreWhitespace: true } })).toBe('a  b\nab');
  });
  it('"a\\tb\\na b" Ignore whitespace (D12)', () => {
    expect(out('a\tb\na b', { duplicates: { ignoreWhitespace: true } })).toBe('a\tb');
  });
  it('"caf\\u00e9\\ncafe\\u0301" (D6)', () => {
    expect(out('café\ncafé', { duplicates: {} })).toBe('café');
  });
  it('"a\\u200bb\\nab": not duplicates; equal when sorted (G7)', () => {
    expect(out('a​b\nab', { duplicates: {}, order: sort('alphabetical') })).toBe('a​b\nab');
    expect(out('ab\na​b', { order: sort('alphabetical') })).toBe('ab\na​b');
  });
  it('"\\u0130\\ni\\u0307\\nI\\ni" Ignore case (G9)', () => {
    expect(out('İ\ni̇\nI\ni', { duplicates: { ignoreCase: true } })).toBe('İ\nI');
  });
  it('"naïve\\nnaive\\nNAÏVE" Ignore case (G10)', () => {
    expect(out('naïve\nnaive\nNAÏVE', { duplicates: { ignoreCase: true } })).toBe('naïve\nnaive');
  });
  it('Keep only duplicated (D7)', () => {
    expect(out(list, { duplicates: { mode: 'duplicated' } })).toBe('b\na');
  });
  it('Keep only unique (D8)', () => {
    expect(out(list, { duplicates: { mode: 'unique' } })).toBe('c');
  });
  it('Count occurrences (D9)', () => {
    expect(run(list, { duplicates: { mode: 'count' } })).toMatchObject({
      text: '3\tb\n2\ta\n1\tc',
      deltas: { duplicates: -3 },
    });
  });
  it('"x\\n\\ny\\n\\n" (D10)', () => {
    expect(run('x\n\ny\n\n', { duplicates: {} })).toMatchObject({ text: 'x\n\ny\n', linesIn: 4, linesOut: 3 });
  });
});

describe('§10: Sort Alphabetical (Intl.Collator "en")', () => {
  const letters = 'b\nB\na\nA\nä\nÄ\nZ';
  it('A1', () => expect(out(letters, { order: sort('alphabetical') })).toBe('a\nA\nä\nÄ\nb\nB\nZ'));
  it('A2 Uppercase first', () =>
    expect(out(letters, { order: sort('alphabetical', { uppercaseFirst: true }) })).toBe('A\na\nÄ\nä\nB\nb\nZ'));
  it('A3 Descending', () =>
    expect(out(letters, { order: sort('alphabetical', { descending: true }) })).toBe('Z\nb\nB\nä\nÄ\na\nA'));
  it('"B\\nb" Descending (A8)', () =>
    expect(out('B\nb', { order: sort('alphabetical', { descending: true }) })).toBe('B\nb'));
  it('"_b\\n-a\\n a\\n.x\\n1\\nA" (A4)', () =>
    expect(out('_b\n-a\n a\n.x\n1\nA', { order: sort('alphabetical') })).toBe(' a\n_b\n-a\n.x\n1\nA'));
  it('"я\\nа\\nЁ\\nё\\nе\\nж" (A5)', () =>
    expect(out('я\nа\nЁ\nё\nе\nж', { order: sort('alphabetical') })).toBe('а\nе\nЁ\nё\nж\nя'));
  it('"b\\na\\n" (A6)', () => expect(out('b\na\n', { order: sort('alphabetical') })).toBe('a\nb\n'));
  it('"file10\\nfile2\\nfile1" (A7)', () =>
    expect(out('file10\nfile2\nfile1', { order: sort('alphabetical') })).toBe('file1\nfile10\nfile2'));
  it('"😀\\na\\n中\\nZ" (A9)', () => expect(out('😀\na\n中\nZ', { order: sort('alphabetical') })).toBe('😀\na\nZ\n中'));
  it('"b\\ud800\\na\\n\\ud800\\nb\\ud800" Duplicates, Ignore case; Sort (G1)', () =>
    expect(out('b\ud800\na\n\ud800\nb\ud800', { duplicates: { ignoreCase: true }, order: sort('alphabetical') })).toBe(
      'a\nb\ud800\n\ud800',
    ));
});

describe('§10: Sort Natural', () => {
  it('"file10\\nfile2\\nfile1\\nFile3\\nfile02" (L1)', () =>
    expect(out('file10\nfile2\nfile1\nFile3\nfile02', { order: sort('natural') })).toBe(
      'file1\nfile2\nfile02\nFile3\nfile10',
    ));
  it('Descending (L2)', () =>
    expect(out('file10\nfile2\nfile1', { order: sort('natural', { descending: true }) })).toBe('file10\nfile2\nfile1'));
  it('"1.10.0\\n1.9.0\\n1.2.10\\n1.2.9" (L3)', () =>
    expect(out('1.10.0\n1.9.0\n1.2.10\n1.2.9', { order: sort('natural') })).toBe('1.2.9\n1.2.10\n1.9.0\n1.10.0'));
  it('"-5\\n3\\n-10\\n+2" (L4)', () =>
    expect(out('-5\n3\n-10\n+2', { order: sort('natural') })).toBe('-5\n-10\n+2\n3'));
  it('"img12.png\\nimg10.png\\nIMG2.png\\nimg1.png" Uppercase first (L5)', () =>
    expect(out('img12.png\nimg10.png\nIMG2.png\nimg1.png', { order: sort('natural', { uppercaseFirst: true }) })).toBe(
      'img1.png\nIMG2.png\nimg10.png\nimg12.png',
    ));
});

describe('§10: Sort Numeric', () => {
  it('M1', () =>
    expect(out('10\n9\n-1\n1e3\n2.5\nabc\n007\n.5\n\n3 apples\n1,000\n+4\n-0\n0', { order: sort('numeric') })).toBe(
      '-1\n-0\n0\n.5\n1,000\n2.5\n3 apples\n+4\n007\n9\n10\n1e3\nabc\n',
    ));
  it('M2 Descending', () =>
    expect(out('10\n9\nabc\n2\n\n10', { order: sort('numeric', { descending: true }) })).toBe('10\n10\n9\n2\nabc\n'));
  it('M3', () =>
    expect(out('v10\n  42\n5.\n1e\n−3\nInfinity\n0x10', { order: sort('numeric') })).toBe(
      '0x10\n1e\n5.\n  42\nv10\n−3\nInfinity',
    ));
  it('M4 equal beyond 2^53', () =>
    expect(out('9007199254740993\n9007199254740992', { order: sort('numeric') })).toBe(
      '9007199254740993\n9007199254740992',
    ));
  it('M5 ±1e999', () => expect(out('1e999\n5\n-1e999', { order: sort('numeric') })).toBe('-1e999\n5\n1e999'));
  it('leadingNumber', () => {
    expect(['  42', '+4', '.5', '5.', '1e3', '1e', '1E-2x', '1,000', '0x10'].map(leadingNumber)).toEqual([
      42, 4, 0.5, 5, 1000, 1, 0.01, 1, 0,
    ]);
    expect(Object.is(leadingNumber('-0'), -0)).toBe(true);
    expect(['−3', 'Infinity', '', '-', '.', '١٢'].map(leadingNumber)).toEqual([null, null, null, null, null, null]);
  });
});

describe('§10: Sort Length and Code point', () => {
  it('E1', () => expect(out('ccc\na\nbb\n👍🏽\né\né\n', { order: sort('length') })).toBe('a\né\nbb\n👍🏽\né\nccc\n'));
  it('E2 Descending', () =>
    expect(out('ccc\na\nbb\nxx', { order: sort('length', { descending: true }) })).toBe('ccc\nbb\nxx\na'));
  it('codePointLength = [...s].length', () => {
    const samples = ['👍🏽', 'é', '🇷🇺', '中文', '😀', '\ud800x'];
    expect(samples.map(codePointLength)).toEqual([2, 2, 2, 2, 1, 2]);
    expect(samples.map(s => [...s].length)).toEqual([2, 2, 2, 2, 1, 2]);
  });
  it('C1', () =>
    expect(out('b\nB\na\nA\nä\n_\n1\n \nZ', { order: sort('codepoint') })).toBe(' \n1\nA\nB\nZ\n_\na\nb\nä'));
  it('C2: \\uffff before 😀, unlike sort() without a function', () => {
    expect(out('￿\n😀\n\nz', { order: sort('codepoint') })).toBe('z\n\n￿\n😀');
    expect(['￿', '😀', '', 'z'].sort()).toEqual(['z', '😀', '', '￿']);
  });
  it('C3 Descending', () => expect(out('b\nB\na', { order: sort('codepoint', { descending: true }) })).toBe('b\na\nB'));
  it('G2 a lone surrogate after U+FFFF', () =>
    expect(out('\ud800\n\na', { order: sort('codepoint') })).toBe('a\n\n\ud800'));
});

describe('§10: Reverse and Shuffle', () => {
  it('Reverse (R1, R2)', () => {
    expect(out('a\nb\nc\n', { order: { kind: 'reverse' } })).toBe('c\nb\na\n');
    expect(out('a\nb\n\n', { order: { kind: 'reverse' } })).toBe('\nb\na\n');
  });
  it('Shuffle over 00 01 02 … (H1, checked by hand)', () => {
    expect(out('a\nb\nc\nd\ne', { order: { kind: 'shuffle' } }, counting())).toBe('a\ne\nc\nd\nb');
  });
  it('"a" / "": the source is not called (H2, H3)', () => {
    let calls = 0;
    const source: RandomSource = () => void calls++;
    expect(out('a', { order: { kind: 'shuffle' } }, source)).toBe('a');
    expect(out('', { order: { kind: 'shuffle' } }, source)).toBe('');
    expect(calls).toBe(0);
  });
  it('a tape over 00 01 02 …: Shuffle, then Shuffle + Number — the same order', () => {
    const tape = createShuffleTape(counting());
    expect(out('a\nb\nc\nd\ne', { order: { kind: 'shuffle' } }, tape.reader())).toBe('a\ne\nc\nd\nb');
    expect(out('a\nb\nc\nd\ne', { order: { kind: 'shuffle' }, number: {} }, tape.reader())).toBe(
      '1. a\n2. e\n3. c\n4. d\n5. b',
    );
  });
  it('a tape over a source that fills with byte k on its k-th call', () => {
    let k = 0;
    const tape = createShuffleTape(bytes => bytes.fill(++k));
    const first = tape.reader();
    const second = tape.reader();
    const a = new Uint8Array(4);
    const b = new Uint8Array(4);
    first(a);
    second(b);
    expect([...a]).toEqual([1, 1, 1, 1]);
    expect([...b]).toEqual([1, 1, 1, 1]);
    const more = new Uint8Array(4093);
    first(more);
    expect([...more.subarray(-2)]).toEqual([1, 2]);
    expect(k).toBe(2);
    tape.reset();
    const after = new Uint8Array(4);
    tape.reader()(after);
    expect([...after]).toEqual([3, 3, 3, 3]);
  });
  it('["a","b","c"] 600 000 times with cryptoRandom: χ² under 20.5 (5 degrees of freedom, p = 0.001)', () => {
    const counts = new Map<string, number>();
    // cryptoRandom read ahead in blocks (the same bytes, fewer calls), as runPipeline does by default.
    const source = bufferedSource(cryptoRandom);
    const runs = 600_000;
    for (let i = 0; i < runs; i++) {
      const key = shuffleLines(['a', 'b', 'c'], source).join('');
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    expect(counts.size).toBe(6);
    const expected = runs / 6;
    const chi2 = [...counts.values()].reduce((sum, n) => sum + (n - expected) ** 2 / expected, 0);
    // One run in twenty fails at p = 0.05 by chance; 20.5 is p = 0.001 — a real bias fails it, chance practically never.
    expect(chi2).toBeLessThan(20.5);
  }, 60_000);
});

describe('§10: Prefix and suffix, Number lines, Join', () => {
  it("Prefix ', Suffix ', (P1)", () =>
    expect(out('a\nb\n\nc', { affix: { prefix: "'", suffix: "'," } })).toBe("'a',\n'b',\n'',\n'c',"));
  it('both empty (P2)', () => expect(out('a\nb', { affix: {} })).toBe('a\nb'));
  const ten = Array.from({ length: 10 }, (_, i) => `l${i}`).join('\n');
  it('Number 1. item (U1)', () =>
    expect(out(ten, { number: {} })).toBe(Array.from({ length: 10 }, (_, i) => `${i + 1}. l${i}`).join('\n')));
  it('Number, Pad with spaces (U2)', () =>
    expect(out(ten, { number: { pad: 'spaces' } })).toBe(
      Array.from({ length: 10 }, (_, i) => `${String(i + 1).padStart(2)}. l${i}`).join('\n'),
    ));
  it('Number 1 [Tab] item, Start at 0, Pad with zeros: width 1 (U3)', () =>
    expect(out(ten, { number: { after: '\t', start: 0, pad: 'zeros' } })).toBe(
      Array.from({ length: 10 }, (_, i) => `${i}\tl${i}`).join('\n'),
    ));
  it('"a\\n\\nb\\n" Number 1) item (U4)', () =>
    expect(out('a\n\nb\n', { number: { after: ') ' } })).toBe('1) a\n2) \n3) b\n'));
  it('"x" Number, Start at 0, Pad with zeros (U5)', () =>
    expect(out('x', { number: { start: 0, pad: 'zeros' } })).toBe('0. x'));
  it('"b\\na\\nc" Sort; Prefix "- "; Number (G11)', () =>
    expect(out('b\na\nc', { order: sort('alphabetical'), affix: { prefix: '- ' }, number: {} })).toBe(
      '1. - a\n2. - b\n3. - c',
    ));
  it('"a\\nb\\n\\nc\\n" Join ", " (J1)', () =>
    expect(run('a\nb\n\nc\n', { join: {} })).toMatchObject({ text: 'a, b, , c', linesIn: 4, linesOut: 1 }));
  it("Prefix and Suffix '; Join , (J2)", () =>
    expect(out('a\nb\nc', { affix: { prefix: "'", suffix: "'" }, join: { separator: ',' } })).toBe("'a','b','c'"));
  it('"" / "\\n" Join (J3, J4)', () => {
    expect(run('', { join: {} })).toMatchObject({ text: '', linesOut: 0 });
    expect(run('\n', { join: {} })).toMatchObject({ text: '', linesOut: 1 });
  });
  it('"a\\nb" Join Nothing (J5)', () => expect(out('a\nb', { join: { separator: '' } })).toBe('ab'));
});

describe('§10: combined steps and the scenarios of §2', () => {
  it('"c\\nb\\na" Reverse; Number; Join "; " (X3)', () =>
    expect(out('c\nb\na', { order: { kind: 'reverse' }, number: {}, join: { separator: '; ' } })).toBe(
      '1. a; 2. b; 3. c',
    ));
  it('X1', () =>
    expect(
      run(' b \n\na\n b\nA\n', {
        trim: {},
        blank: {},
        duplicates: { ignoreCase: true },
        order: sort('alphabetical'),
        number: {},
      }),
    ).toMatchObject({ text: '1. a\n2. b\n', linesIn: 5, linesOut: 2, deltas: { blank: -1, duplicates: -2 } }));
  it('X2', () =>
    expect(
      run('3, 1, 2\n2, 4,', {
        split: comma,
        trim: {},
        blank: {},
        duplicates: {},
        order: sort('numeric'),
        affix: { prefix: "'", suffix: "'" },
        join: {},
      }),
    ).toMatchObject({
      text: "'1', '2', '3', '4'",
      linesIn: 2,
      linesOut: 1,
      deltas: { split: 4, blank: -1, duplicates: -1 },
    }));
  it('scenario 1 (Z1)', () =>
    expect(
      run('alice@example.com\n Bob@example.com\n\nbob@example.com\ncarol@example.com\nalice@example.com \n', {
        trim: {},
        blank: {},
        duplicates: { ignoreCase: true },
        order: sort('alphabetical'),
      }),
    ).toMatchObject({
      text: 'alice@example.com\nBob@example.com\ncarol@example.com\n',
      linesIn: 6,
      linesOut: 3,
      deltas: { blank: -1, duplicates: -2 },
    }));
  it('scenario 2: Alphabetical keeps file1, file10, file2; Natural gives file1, file2, file10', () => {
    expect(out('file1.txt\nfile10.txt\nfile2.txt', { order: sort('alphabetical') })).toBe(
      'file1.txt\nfile10.txt\nfile2.txt',
    );
    expect(out('file1.txt\nfile10.txt\nfile2.txt', { order: sort('natural') })).toBe(
      'file1.txt\nfile2.txt\nfile10.txt',
    );
  });
  it('scenario 3 (Z3)', () =>
    expect(
      out('200\n404\n200\n500\n200\n404', {
        duplicates: { mode: 'count' },
        order: sort('numeric', { descending: true }),
      }),
    ).toBe('3\t200\n2\t404\n1\t500'));
  it('scenario 4 (Z4)', () =>
    expect(
      run('42\n17\n42\n8', {
        duplicates: {},
        order: sort('numeric'),
        affix: { prefix: "'", suffix: "'" },
        join: {},
      }),
    ).toMatchObject({ text: "'8', '17', '42'", linesIn: 4, linesOut: 1 }));
  it('scenario 5: red, green, blue — Split , and Trim, 2 added', () =>
    expect(run('red, green, blue', { split: comma, trim: {} })).toMatchObject({
      text: 'red\ngreen\nblue',
      deltas: { split: 2 },
    }));
  it('scenario 6: Number lines after Shuffle keeps the order (the tape)', () => {
    const tape = createShuffleTape();
    const names = 'Ann\nBen\nCid\nDee\nEve\nFay';
    const shuffled = out(names, { order: { kind: 'shuffle' } }, tape.reader()).split('\n');
    const numbered = out(names, { order: { kind: 'shuffle' }, number: {} }, tape.reader());
    expect(numbered).toBe(shuffled.map((name, i) => `${i + 1}. ${name}`).join('\n'));
  });
  it('scenario 7 (Z7)', () =>
    expect(
      run('10:01 ERROR db timeout\n10:03 Error retry\n10:04 ERROR disk\n10:05 ok', {
        filter: { text: 'ERROR', matchCase: true },
      }),
    ).toMatchObject({ text: '10:01 ERROR db timeout\n10:04 ERROR disk', deltas: { filter: -2 } }));
});

describe('§10: texts and limits', () => {
  it('summaryText', () => {
    expect(summaryText(1, 1)).toBe('1 line in, 1 out');
    expect(summaryText(6, 3)).toBe('6 lines in, 3 out');
    expect(summaryText(200000, 1)).toBe('200,000 lines in, 1 out');
  });
  it('deltaText', () => {
    expect(deltaText(3)).toBe('3 added');
    expect(deltaText(-2)).toBe('2 removed');
    expect(deltaText(0)).toBe('no change');
  });
  it('200 000 lines "x" are processed', () => {
    expect(run(Array(200_000).fill('x').join('\n'))).toMatchObject({ linesIn: 200_000, linesOut: 200_000 });
  });
  it('200 001 lines "x" are refused', () => {
    expect(runPipeline(Array(200_001).fill('x').join('\n'), pipe())).toEqual({
      ok: false,
      message: 'Text has 200,001 lines. This tool works with up to 200,000 lines.',
    });
  });
  it('8 388 609 characters "a" are refused', () => {
    expect(runPipeline('a'.repeat(8_388_609), pipe())).toEqual({
      ok: false,
      message: 'Text is larger than 8 MB. This tool works with up to 8 MB.',
    });
  });
  // §10 said "a," × 125 000 — that is 125 001 pieces, under the limit; corrected in the specification.
  it('one line "a," × 249 999 + "a" with Split , is refused: 250 000 pieces', () => {
    expect(run('a,'.repeat(125_000), { split: comma }).linesOut).toBe(125_001);
    expect(runPipeline(`${'a,'.repeat(249_999)}a`, pipe({ split: comma }))).toEqual({
      ok: false,
      message: 'Split gives 250,000 lines. This tool works with up to 200,000 lines.',
    });
  });
});

// What §5 and §6 state that §10 does not show.
describe('§5 and §6 beyond §10', () => {
  it('§5.1: mixed endings in one text; the output always uses \\n', () => {
    expect(splitLines('a\r\nb\rc\nd')).toEqual({ lines: ['a', 'b', 'c', 'd'], trailingBreak: false });
    expect(out('a\r\nb\rc\nd\r\n')).toBe('a\nb\nc\nd\n');
    expect(splitLines('a\r')).toEqual({ lines: ['a'], trailingBreak: true });
    expect(splitLines('\r\n')).toEqual({ lines: [''], trailingBreak: true });
    expect(splitLines('\n\r')).toEqual({ lines: ['', ''], trailingBreak: true });
  });
  it('§5.1: a trailing break stays when lines remain, goes with none; Join never ends with one', () => {
    expect(joinLines(['a'], true)).toBe('a\n');
    expect(joinLines([], true)).toBe('');
    expect(joinLines(['a', 'b'], false)).toBe('a\nb');
    expect(out('a\nb\n', { filter: { text: 'zzz' } })).toBe('');
    expect(out('a\nb\n', { join: {} })).toBe('a, b');
  });
  it('§5.1: U+2028, U+2029, VT and FF are spaces for Trim and blank lines; U+0085 is not', () => {
    expect(out(' \n \n\v\n\f\n\u0085', { blank: {} })).toBe('\u0085');
  });
  it('countLines = splitLines().lines.length on every kind of break', () => {
    for (const text of ['', 'a', '\n', '\r', '\r\n', 'a\r\n\rb\n', '\n\r\n\r', 'a\rb', 'x y', 'a\n\n'])
      expect(countLines(text)).toBe(splitLines(text).lines.length);
  });
  it('countSplit = the lines Split gives, without building them', () => {
    const cases: Array<[string, Parameters<typeof countSplit>[1]]> = [
      ['a, b,,c', { kind: 'text', text: ',' }],
      ['a,b\nc,,\n', { kind: 'text', text: ',' }],
      ['aaa\naa', { kind: 'text', text: 'aa' }],
      ['a::b', { kind: 'text', text: '' }],
      ['a\nb', { kind: 'text', text: 'a\nb' }],
      ['  a  b\t c \n\n   \nd', { kind: 'whitespace' }],
      ['   ', { kind: 'whitespace' }],
      ['', { kind: 'text', text: ',' }],
    ];
    for (const [text, separator] of cases)
      expect(countSplit(text, separator)).toBe(splitOn(splitLines(text).lines, separator).length);
  });
  it("§5.3: the space set is JavaScript's \\s, code unit by code unit", () => {
    const spaces: number[] = [];
    for (let c = 0; c < 0x10000; c++) if (/\s/.test(String.fromCharCode(c))) spaces.push(c);
    const blankOnes: number[] = [];
    for (let c = 0; c < 0x10000; c++) {
      if (c === 10 || c === 13) continue;
      if (removeBlankLines([String.fromCharCode(c)], 'all').length === 0) blankOnes.push(c);
    }
    expect(blankOnes).toEqual(spaces.filter(c => c !== 10 && c !== 13));
    expect(spaces).not.toContain(0x200b);
    expect(spaces).not.toContain(0x0085);
  });
  it('§5.3: comparisons ignore case without a locale, then NFC; the line is shown as it was', () => {
    // toLowerCase writes a final sigma as ς: all three spellings fold to the same key.
    const greek = ['ΟΔΟΣ', 'οδοσ', 'οδος'].map(w =>
      duplicateKey(` ${w} `, { ignoreCase: true, ignoreWhitespace: true }),
    );
    expect(new Set(greek).size).toBe(1);
    expect(duplicateKey('Café', { ignoreCase: false, ignoreWhitespace: false })).toBe('Café');
    expect(dedupeLines(['Café', 'café'], { mode: 'remove', ignoreCase: true, ignoreWhitespace: false })).toEqual([
      'Café',
    ]);
  });
  it('§5.4: split is literal and case-sensitive; quotes are not special; \\t typed is two characters', () => {
    expect(splitOn(['aXbxc'], { kind: 'text', text: 'x' })).toEqual(['aXb', 'c']);
    expect(splitOn(['"a,b",c'], { kind: 'text', text: ',' })).toEqual(['"a', 'b"', 'c']);
    expect(splitOn(['a\\tb\tc'], { kind: 'text', text: '\\t' })).toEqual(['a', 'b\tc']);
    expect(splitOn(['a\tb'], { kind: 'text', text: '\t' })).toEqual(['a', 'b']);
  });
  it('§5.5: Collapse turns even a single tab between words into one space; edges follow the mode', () => {
    expect(trimLines(['a\tb'], { mode: 'both', collapse: true })).toEqual(['a b']);
    expect(trimLines(['  a \t  b   c  '], { mode: 'end', collapse: true })).toEqual(['  a b c']);
    expect(trimLines(['   '], { mode: 'start', collapse: true })).toEqual(['']);
    expect(trimLines([' \t '], { mode: 'both', collapse: false })).toEqual(['']);
  });
  it('§5.6: the filter text is not trimmed and not a pattern', () => {
    expect(filterLines(['a b', 'ab'], { keep: true, text: ' ', matchCase: false })).toEqual(['a b']);
    expect(filterLines(['a.b', 'axb'], { keep: true, text: '.', matchCase: false })).toEqual(['a.b']);
    expect(filterLines(['a*', 'aa'], { keep: false, text: '*', matchCase: true })).toEqual(['aa']);
  });
  it('§5.7: Keep one in a row keeps the first blank line as it is', () => {
    expect(removeBlankLines(['a', ' \t', '', 'b', ''], 'repeated')).toEqual(['a', ' \t', 'b', '']);
  });
  it('§5.8: blank lines take part; Count with blank lines; Keep only unique keeps input order', () => {
    expect(dedupeLines(['', 'a', ''], { mode: 'count', ignoreCase: false, ignoreWhitespace: false })).toEqual([
      '2\t',
      '1\ta',
    ]);
    expect(dedupeLines(['c', 'a', 'b', 'a'], { mode: 'unique', ignoreCase: false, ignoreWhitespace: false })).toEqual([
      'c',
      'b',
    ]);
  });
  it('§5.9.1: equal lines keep input order in either direction, also by Length and Numeric', () => {
    expect(sortLines(['bb', 'aa', 'c'], { kind: 'length', descending: true, uppercaseFirst: false })).toEqual([
      'bb',
      'aa',
      'c',
    ]);
    expect(sortLines(['1 b', '1 a', '0'], { kind: 'numeric', descending: true, uppercaseFirst: false })).toEqual([
      '1 b',
      '1 a',
      '0',
    ]);
  });
  it('§5.9.2: Natural ignores leading zeros; compares digits beyond the precision of number', () => {
    expect(sortLines(['file02', 'file2'], { kind: 'natural', descending: false, uppercaseFirst: false })).toEqual([
      'file02',
      'file2',
    ]);
    expect(
      sortLines(['12345678901234567891', '12345678901234567890'], {
        kind: 'natural',
        descending: false,
        uppercaseFirst: false,
      }),
    ).toEqual(['12345678901234567890', '12345678901234567891']);
  });
  it('§5.9.2: Alphabetical ignores Uppercase first-like order by default, and Code point ignores Uppercase first', () => {
    expect(sortLines(['b', 'B', 'a'], { kind: 'codepoint', descending: false, uppercaseFirst: true })).toEqual([
      'B',
      'a',
      'b',
    ]);
  });
  it('§5.9.2: the collation language is fixed to "en"', () => {
    expect(COLLATION_LOCALE).toBe('en');
    expect(new Intl.Collator(COLLATION_LOCALE).resolvedOptions().locale).toBe('en');
  });
  it('§5.10, §5.11: blank lines get the prefix and a number; zeros pad to the width of the last number', () => {
    expect(affixLines(['', 'a'], '<', '>')).toEqual(['<>', '<a>']);
    expect(numberLines(Array(100).fill('x'), { start: 1, after: ': ', pad: 'zeros' }).slice(0, 2)).toEqual([
      '001: x',
      '002: x',
    ]);
    expect(numberLines(Array(10).fill('x'), { start: 0, after: ' ', pad: 'spaces' })[9]).toBe('9 x');
  });
  it('§5.12: Join with Tab and Pipe', () => {
    expect(out('a\nb', { join: { separator: '\t' } })).toBe('a\tb');
    expect(out('a\nb', { join: { separator: '|' } })).toBe('a|b');
  });
  it('§5.13: deltas only for enabled counted steps; thousands in the texts', () => {
    expect(run('a\nb', { trim: {}, order: sort('alphabetical'), number: {}, join: {} }).deltas).toEqual({});
    expect(deltaText(-12_345)).toBe('12,345 removed');
    expect(summaryText(0, 0)).toBe('0 lines in, 0 out');
  });
  it('§6: limits are checked in the order characters, lines, lines after Split', () => {
    expect(runPipeline('\n'.repeat(8_388_609), pipe())).toEqual({ ok: false, message: TOO_LARGE });
    expect(runPipeline('\n'.repeat(250_000), pipe({ split: comma }))).toMatchObject({
      message: 'Text has 250,000 lines. This tool works with up to 200,000 lines.',
    });
    expect(LIMITS).toEqual({ liveLines: 20_000, liveChars: 1_048_576, maxLines: 200_000, maxChars: 8_388_608 });
  });
  it('§6: exactly 200 000 lines and 8 Mi characters are processed', () => {
    const line = 'x'.repeat(40);
    const text = `${line}\n`.repeat(199_999) + 'x'.repeat(8_388_608 - 41 * 199_999);
    expect(text.length).toBe(8_388_608);
    expect(run(text)).toMatchObject({ linesIn: 200_000, linesOut: 200_000 });
  });
});

describe('long input stays linear (no regular expression backtracking)', () => {
  const timed = (fn: () => unknown): number => {
    const start = performance.now();
    fn();
    return performance.now() - start;
  };
  it('a 1 MB line of spaces, of digits, of "1e" and of "+" through Numeric, Trim, Collapse, Split, Duplicates', () => {
    for (const unit of [' ', '1', '1e', '+', ' 1', '.', '\t ']) {
      const line = unit.repeat(Math.ceil(1_000_000 / unit.length));
      const ms = timed(() => {
        leadingNumber(line);
        leadingNumber(`${line}x`);
        runPipeline(line, pipe({ trim: { collapse: true }, duplicates: { ignoreWhitespace: true, ignoreCase: true } }));
        runPipeline(line, pipe({ split: { separator: { kind: 'whitespace' } }, order: sort('numeric') }));
        runPipeline(line, pipe({ filter: { text: `${unit}x` } }));
      });
      expect(ms).toBeLessThan(1_000);
    }
  });
});

// Properties the specification implies, over generated lists (a fixed-seed generator: the same lists every run).
describe('properties', () => {
  const seeded = (seed: number) => () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const ALPHABET = [
    'a',
    'A',
    'b',
    'ä',
    'Ä',
    ' ',
    '\t',
    '1',
    '2',
    '10',
    '-',
    '.',
    'e',
    'é',
    'é',
    '😀',
    '\ud800',
    'ß',
    'ẞ',
    'İ',
    ' ',
    'x',
  ];
  const lists = (count: number): string[][] => {
    const random = seeded(16);
    return Array.from({ length: count }, () =>
      Array.from({ length: Math.floor(random() * 30) }, () =>
        Array.from({ length: Math.floor(random() * 6) }, () => ALPHABET[Math.floor(random() * ALPHABET.length)]).join(
          '',
        ),
      ),
    );
  };
  const multiset = (lines: readonly string[]) => [...lines].sort().join('\u0000');
  const SORTS: SortOptions[] = (['alphabetical', 'natural', 'numeric', 'length', 'codepoint'] as const).flatMap(kind =>
    [false, true].flatMap(descending => [false, true].map(uppercaseFirst => ({ kind, descending, uppercaseFirst }))),
  );

  it('sorting twice equals sorting once, and keeps the multiset of lines', () => {
    for (const list of lists(300))
      for (const options of SORTS) {
        const once = sortLines(list, options);
        expect(sortLines(once, options)).toEqual(once);
        expect(multiset(once)).toBe(multiset(list));
      }
  });
  it('a sort is a total order consistent with its comparison: each neighbour pair is in order', () => {
    for (const list of lists(200)) {
      const sorted = sortLines(list, { kind: 'codepoint', descending: false, uppercaseFirst: false });
      for (let i = 1; i < sorted.length; i++)
        expect(compareCodePoints(sorted[i - 1]!, sorted[i]!)).toBeLessThanOrEqual(0);
    }
  });
  it('Code point order equals the order of UTF-8 bytes for well-formed text', () => {
    const encoder = new TextEncoder();
    const compareBytes = (a: Uint8Array, b: Uint8Array) => {
      for (let i = 0; i < Math.min(a.length, b.length); i++) if (a[i] !== b[i]) return a[i]! - b[i]!;
      return a.length - b.length;
    };
    const random = seeded(8);
    const points = [
      0x20, 0x41, 0x61, 0x7f, 0xe9, 0x7ff, 0x800, 0xd7ff, 0xe000, 0xfffd, 0xffff, 0x10000, 0x1f600, 0x10ffff,
    ];
    for (let n = 0; n < 2000; n++) {
      const word = () =>
        String.fromCodePoint(
          ...Array.from({ length: 1 + Math.floor(random() * 3) }, () => points[Math.floor(random() * points.length)]!),
        );
      const a = word();
      const b = word();
      expect(Math.sign(compareCodePoints(a, b))).toBe(Math.sign(compareBytes(encoder.encode(a), encoder.encode(b))));
    }
  });
  it('removing duplicates is idempotent in every mode but Count; Count of Remove is all ones', () => {
    for (const list of lists(300))
      for (const ignoreCase of [false, true])
        for (const ignoreWhitespace of [false, true]) {
          const flags = { ignoreCase, ignoreWhitespace };
          for (const mode of ['remove', 'unique'] as const) {
            const once = dedupeLines(list, { mode, ...flags });
            expect(dedupeLines(once, { mode, ...flags })).toEqual(once);
          }
          const removed = dedupeLines(list, { mode: 'remove', ...flags });
          const duplicated = dedupeLines(list, { mode: 'duplicated', ...flags });
          expect(dedupeLines(duplicated, { mode: 'remove', ...flags })).toEqual(duplicated);
          expect(dedupeLines(removed, { mode: 'count', ...flags }).every(l => l.startsWith('1\t'))).toBe(true);
          expect(new Set(removed.map(l => duplicateKey(l, flags))).size).toBe(removed.length);
        }
  });
  it('reverse and shuffle keep the multiset of lines; reversing twice is the identity', () => {
    for (const list of lists(300)) {
      // A blank line at either end without a final break would come back as the final break (§5.1): words at the ends.
      const text = ['y', ...list, 'z'].join('\n');
      const reversed = out(text, { order: { kind: 'reverse' } });
      expect(out(reversed, { order: { kind: 'reverse' } })).toBe(text);
      expect(multiset(shuffleLines(list, cryptoRandom))).toBe(multiset(list));
      expect(multiset(sortLines(list, { kind: 'natural', descending: true, uppercaseFirst: true }))).toBe(
        multiset(list),
      );
    }
  });
  it('trimming twice equals trimming once; removing blank lines is idempotent', () => {
    for (const list of lists(300))
      for (const mode of ['both', 'start', 'end'] as const)
        for (const collapse of [false, true]) {
          const once = trimLines(list, { mode, collapse });
          expect(trimLines(once, { mode, collapse })).toEqual(once);
          for (const blank of ['all', 'repeated'] as const) {
            const removed = removeBlankLines(list, blank);
            expect(removeBlankLines(removed, blank)).toEqual(removed);
          }
        }
  });
  it('splitting into lines and joining them gives the text back with \\n endings', () => {
    for (const list of lists(300)) {
      const text = list.join('\n').replace(/[\r\n]/g, '');
      for (const ending of ['', '\n']) {
        const { lines, trailingBreak } = splitLines(text + ending);
        expect(joinLines(lines, trailingBreak)).toBe(text === '' && ending === '' ? '' : text + ending);
      }
    }
  });
  it('the pipeline never changes the number of lines in steps without a counter', () => {
    for (const list of lists(100)) {
      const text = list.join('\n');
      const result = run(text, {
        trim: { collapse: true },
        order: sort('natural'),
        affix: { prefix: '>' },
        number: {},
      });
      expect(result.linesOut).toBe(result.linesIn);
    }
  });
});
