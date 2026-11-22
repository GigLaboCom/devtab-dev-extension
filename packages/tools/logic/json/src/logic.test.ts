/**
 * docs/tools/specs/json.md §10, row by row (the input in the test name where it is short), plus what §5 and §7 state
 * and §10 misses. The rows about errors and places are the shared scanner's and live next to it
 * (@workspace/tools-shared, json-scan.test.ts); here each of them runs once more through `printJson` and `checkJson`,
 * which must give the same error. `⏎` of the specification is `\n` here. The property tests — formatting and minifying
 * never change a value — are properties.test.ts.
 */
import {
  checkJson,
  compareKeys,
  describeNotes,
  detectJson,
  formatMegabytes,
  measureText,
  printJson,
  LIVE_INPUT,
  MAX_INPUT,
  DETECT_WHOLE_CHARS,
  DETECT_PREFIX_CHARS,
  MAX_DEPTH,
} from './logic';
import { describe, expect, it } from 'vitest';
import type { PrintOptions } from './logic';
import type { JsonNotes, Layout } from '@workspace/tools-shared/json-scan';

const print = (text: string, layout: Layout = 2, more: Partial<PrintOptions> = {}): string => {
  const r = printJson(text, { layout, sortKeys: false, allowComments: false, ...more });
  if (!r.ok) throw new Error(`${r.error.line}:${r.error.column} ${r.error.message}`);
  return r.text;
};
const notesOf = (text: string, more: Partial<PrintOptions> = {}): JsonNotes => {
  const r = printJson(text, { layout: 'minify', sortKeys: false, allowComments: false, ...more });
  if (!r.ok) throw new Error(r.error.message);
  return r.notes;
};
const failure = (text: string, more: Partial<PrintOptions> = {}): string => {
  const r = printJson(text, { layout: 2, sortKeys: false, allowComments: false, ...more });
  if (r.ok) throw new Error('expected an error');
  const c = checkJson(text, more);
  expect(c, 'checkJson gives the same error').toEqual({ ok: false, error: r.error });
  return `${r.error.line}:${r.error.column} ${r.error.message}`;
};
const NO_NOTES: JsonNotes = { bom: false, comments: 0, trailingCommas: 0, duplicateKeys: [], inexactNumbers: 0 };

describe('json.md §10: format, minify, sort keys', () => {
  it('{"a":[1,2]} — Format, 2', () => {
    expect(print('{"a":[1,2]}')).toBe('{\n  "a": [\n    1,\n    2\n  ]\n}');
  });
  it('{"a":1} — Format, 4 / Tab', () => {
    expect(print('{"a":1}', 4)).toBe('{\n    "a": 1\n}');
    expect(print('{"a":1}', 'tab')).toBe('{\n\t"a": 1\n}');
  });
  it('a formatted object — Minify', () => {
    expect(print('{\n  "a": [ 1, 2 ],\n  "b": "x y"\n}', 'minify')).toBe('{"a":[1,2],"b":"x y"}');
  });
  it('{"a":[],"b":{},"c":[{}]} — Format, 2: empty ones stay {} and []', () => {
    expect(print('{"a":[],"b":{},"c":[{}]}')).toBe('{\n  "a": [],\n  "b": {},\n  "c": [\n    {}\n  ]\n}');
  });
  it(' "x"  — Format: a value at the top, no line break at the end', () => {
    expect(print(' "x" ')).toBe('"x"');
  });
  it('{"ключ":"🙂"} — Format, 2', () => {
    expect(print('{"ключ":"🙂"}')).toBe('{\n  "ключ": "🙂"\n}');
  });
  it('{"b":{"d":1,"c":2},"a":[3,1]} — Minify, Sort keys: every level, arrays untouched', () => {
    expect(print('{"b":{"d":1,"c":2},"a":[3,1]}', 'minify', { sortKeys: true })).toBe('{"a":[3,1],"b":{"c":2,"d":1}}');
  });
  it('{"b":1,"B":2,"a":3,"_":4,"ä":5} — Minify, Sort keys: code points', () => {
    expect(print('{"b":1,"B":2,"a":3,"_":4,"ä":5}', 'minify', { sortKeys: true })).toBe(
      '{"B":2,"_":4,"a":3,"b":1,"ä":5}',
    );
  });
  it('{"！":1,"😀":2} — Minify, Sort keys: U+FF01 before U+1F600 (UTF-16 units would put the emoji first)', () => {
    expect(print('{"！":1,"😀":2}', 'minify', { sortKeys: true })).toBe('{"！":1,"😀":2}');
  });
  it('{"b":1,"a":2} — Minify, Sort keys', () => {
    expect(print('{"b":1,"a":2}', 'minify', { sortKeys: true })).toBe('{"a":2,"b":1}');
  });
  it('{"a":12345678901234567890} — Minify: the same text, one inexact number', () => {
    expect(print('{"a":12345678901234567890}', 'minify')).toBe('{"a":12345678901234567890}');
    expect(notesOf('{"a":12345678901234567890}').inexactNumbers).toBe(1);
  });
  it('[9007199254740993] — Minify: the same text, one inexact number', () => {
    expect(print('[9007199254740993]', 'minify')).toBe('[9007199254740993]');
    expect(notesOf('[9007199254740993]').inexactNumbers).toBe(1);
  });
  it('[1.0, 1e2, -0, 1E400, 0.1e1, 1.5E-3, 1e-400] — Minify: literals as written, two inexact', () => {
    const text = '[1.0, 1e2, -0, 1E400, 0.1e1, 1.5E-3, 1e-400]';
    expect(print(text, 'minify')).toBe('[1.0,1e2,-0,1E400,0.1e1,1.5E-3,1e-400]');
    expect(notesOf(text).inexactNumbers).toBe(2);
  });
  it('{"b":1,"2":2,"1":3,"a":4} — Minify: the order of the input, integer-like names stay', () => {
    expect(print('{"b":1,"2":2,"1":3,"a":4}', 'minify')).toBe('{"b":1,"2":2,"1":3,"a":4}');
  });
  it('{"a":1,"b":2,"a":3} — Minify: the same text, the repeat of a at 1:14', () => {
    expect(print('{"a":1,"b":2,"a":3}', 'minify')).toBe('{"a":1,"b":2,"a":3}');
    expect(notesOf('{"a":1,"b":2,"a":3}').duplicateKeys).toEqual([{ key: 'a', offset: 13, line: 1, column: 14 }]);
  });
  it('{"b":0,"a":1,"a":3} — Minify, Sort keys: repeats keep their order, the repeat at 1:14', () => {
    expect(print('{"b":0,"a":1,"a":3}', 'minify', { sortKeys: true })).toBe('{"a":1,"a":3,"b":0}');
    expect(notesOf('{"b":0,"a":1,"a":3}', { sortKeys: true }).duplicateKeys).toEqual([
      { key: 'a', offset: 13, line: 1, column: 14 },
    ]);
  });
  it('{"a":1,"a":2} — Minify: the same text, the repeat at 1:8', () => {
    expect(print('{"a":1,"a":2}', 'minify')).toBe('{"a":1,"a":2}');
    expect(notesOf('{"a":1,"a":2}').duplicateKeys).toEqual([{ key: 'a', offset: 7, line: 1, column: 8 }]);
  });
  it('["é", "\\/", "😀", "\\ud800"] — Minify: escapes as written', () => {
    expect(print('["\\u00e9", "\\/", "\\ud83d\\ude00", "\\ud800"]', 'minify')).toBe(
      '["\\u00e9","\\/","\\ud83d\\ude00","\\ud800"]',
    );
    expect(print('["é", "\\/", "😀", "\\ud800"]', 'minify')).toBe('["é","\\/","😀","\\ud800"]');
  });
  it('{"__proto__":{"x":1},"a":1} — Minify: an ordinary name', () => {
    expect(print('{"__proto__":{"x":1},"a":1}', 'minify')).toBe('{"__proto__":{"x":1},"a":1}');
    expect(print('{"__proto__":{"x":1},"a":1}', 'minify', { sortKeys: true })).toBe('{"__proto__":{"x":1},"a":1}');
  });
  it('U+FEFF {"a":1} — Minify: skipped, with the note', () => {
    expect(print('\uFEFF{"a":1}', 'minify')).toBe('{"a":1}');
    expect(notesOf('\uFEFF{"a":1}').bom).toBe(true);
  });
  it('"a U+2028 b" — Minify: U+2028 is allowed in a JSON string', () => {
    expect(print('"a\u2028b"', 'minify')).toBe('"a\u2028b"');
  });
  it('(empty) and blank — checkJson: empty input at the end', () => {
    expect(checkJson('')).toEqual({ ok: false, error: { message: 'empty input', offset: 0, line: 1, column: 1 } });
    expect(checkJson('   \n ')).toEqual({
      ok: false,
      error: { message: 'empty input', offset: 5, line: 2, column: 2 },
    });
  });
  it('{⏎  "a": 1,⏎} and [1,] — Format: trailing comma', () => {
    expect(failure('{\n  "a": 1,\n}')).toBe('3:1 trailing comma');
    expect(failure('[1,]')).toBe('1:4 trailing comma');
  });
  it('{"a":1 // c⏎} — Format: comments are not allowed', () => {
    expect(failure('{"a":1 // c\n}')).toBe('1:8 comments are not allowed in JSON (turn on "Allow comments")');
  });
  it('a JSONC object — Format, 2, Allow comments: strict JSON, 2 comments, 2 trailing commas', () => {
    const text = '{\n  // c\n  "a": 1, /* x */\n  "b": [1, 2,],\n}';
    const r = printJson(text, { layout: 2, sortKeys: false, allowComments: true });
    expect(r).toEqual({
      ok: true,
      text: '{\n  "a": 1,\n  "b": [\n    1,\n    2\n  ]\n}',
      notes: { ...NO_NOTES, comments: 2, trailingCommas: 2 },
    });
  });
  it('{"a":1 /* x — Allow comments: unterminated comment', () => {
    expect(failure('{"a":1 /* x', { allowComments: true })).toBe('1:8 unterminated comment');
  });
  it.each([
    [
      '{"a":1}\n{"a":2}\n',
      '2:1 unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    ],
    ['{"a":1} {"a":2}', '1:9 unexpected text after the JSON value'],
    ['01', '1:1 leading zeros are not allowed'],
    ['[01]', '1:2 leading zeros are not allowed'],
    ['[1.]', '1:4 expected a digit after "."'],
    ['[1e]', '1:4 expected a digit in the exponent'],
    ['[-]', '1:2 invalid number'],
    ['[.5]', '1:2 unexpected "."'],
    ['[+1]', '1:2 unexpected "+"'],
    ['[0x10]', "1:3 expected ',' or ']'"],
    ['[\n  1,\n  NaN\n]', '3:3 unexpected "N"'],
    ['[True]', '1:2 unexpected "T"'],
    ["['a']", '1:2 strings must be in double quotes'],
    ["{'a':1}", '1:2 property names must be in double quotes'],
    ['{a:1}', '1:2 expected a property name in double quotes'],
    ['{"a" 1}', "1:6 expected ':'"],
    ['{"a":}', '1:6 unexpected "}"'],
    ['[1 2]', "1:4 expected ',' or ']'"],
    ['{"a":tru}', '1:9 unexpected "}"'],
    ['"abc', '1:5 unterminated string'],
    ['"a\\x"', '1:3 invalid escape "\\x"'],
    ['"\\u12g4"', '1:2 invalid \\u escape: 4 hex digits expected'],
    ['"a\tb"', '1:3 control character U+0009 in a string; write it as \\t'],
    ['"a\nb"', '1:3 control character U+000A in a string; write it as \\n'],
    ['{\u00a0"a":1}', '1:2 unexpected U+00A0 (an invisible character)'],
    ['[1,\u200b2]', '1:4 unexpected U+200B (an invisible character)'],
    ['{"a":1', "1:7 unexpected end of input, expected ',' or '}'"],
    ['[1,2', "1:5 unexpected end of input, expected ',' or ']'"],
    ['{', "1:2 unexpected end of input, expected a property name or '}'"],
    ['{"🙂": x}', '1:8 unexpected "x"'],
    ['{\r\n"a" 1}', "2:5 expected ':'"],
    ['{\r"a" 1}', "2:5 expected ':'"],
    [
      '{"a":1}\n{',
      '2:1 unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    ],
  ])('%j — Format: %s', (text, expected) => {
    expect(failure(text)).toBe(expected);
    expect(failure(text, { sortKeys: true, layout: 'minify' })).toBe(expected);
  });
  it('[ × 1000 + ] × 1000 — Format, 2: valid, 2,000,000 characters', () => {
    const text = `${'['.repeat(1000)}${']'.repeat(1000)}`;
    const out = print(text);
    expect(out.length).toBe(2_000_000);
    expect(out.startsWith('[\n  [\n    [')).toBe(true);
    expect(print(text, 2, { sortKeys: true })).toBe(out);
  });
  it('[ × 1001 + ] × 1001 and [ × 9000 + ] × 9000 — Format: nesting deeper than 1000 levels at 1:1001', () => {
    expect(MAX_DEPTH).toBe(1000);
    expect(failure(`${'['.repeat(1001)}${']'.repeat(1001)}`)).toBe('1:1001 nesting deeper than 1000 levels');
    expect(failure(`${'['.repeat(9000)}${']'.repeat(9000)}`)).toBe('1:1001 nesting deeper than 1000 levels');
    expect(failure(`${'['.repeat(9000)}${']'.repeat(9000)}`, { sortKeys: true })).toBe(
      '1:1001 nesting deeper than 1000 levels',
    );
  });
});

describe('json.md §5 beyond §10', () => {
  it('Format matches JSON.stringify(JSON.parse(text), null, indent) for canonical literals, every indent', () => {
    const doc = {
      id: 7,
      tags: ['a', 'b', { deep: [[], {}, [1, [2, [3]]]] }],
      ok: true,
      none: null,
      text: 'line\nnext "q" \\ é 🙂',
      n: -1.5,
      nested: { x: { y: { z: [] } } },
    };
    const text = JSON.stringify(doc);
    for (const layout of [2, 4, 'tab'] as const)
      expect(print(text, layout)).toBe(JSON.stringify(doc, null, layout === 'tab' ? '\t' : layout));
    expect(print(text, 'minify')).toBe(text);
  });
  it('Sort keys sorts nested objects inside arrays, by the decoded name; arrays keep their order', () => {
    expect(print('[{"b":1,"a":{"d":[{"z":1,"y":2}],"c":0}},{"\\u0062":1,"a":2}]', 'minify', { sortKeys: true })).toBe(
      '[{"a":{"c":0,"d":[{"y":2,"z":1}]},"b":1},{"a":2,"\\u0062":1}]',
    );
    expect(print('{"10":1,"9":2,"":3}', 'minify', { sortKeys: true })).toBe('{"":3,"10":1,"9":2}');
  });
  it('Sort keys with Format: the same layout as without it', () => {
    expect(print('{"b":[1,{"d":4,"c":3}],"a":{}}', 2, { sortKeys: true })).toBe(
      '{\n  "a": {},\n  "b": [\n    1,\n    {\n      "c": 3,\n      "d": 4\n    }\n  ]\n}',
    );
  });
  it('whitespace inside strings is not touched; any whitespace between tokens goes', () => {
    expect(print(' \t\r\n[ "a b\\t" ,\r\n\t1 ]\r\n', 'minify')).toBe('["a b\\t",1]');
  });
  it('a lone \\r and \\r\\n count as line breaks in places (§5 п. 7)', () => {
    expect(failure('[\r1,\r\n2,\r]')).toBe('4:1 trailing comma');
  });
  it('a byte order mark anywhere but the start is an invisible character', () => {
    expect(failure('[1,\uFEFF2]')).toBe('1:4 unexpected U+FEFF (an invisible character)');
  });
  it('with Allow comments, valid JSON without comments has no notes', () => {
    expect(notesOf('{"a":[1]}', { allowComments: true })).toEqual(NO_NOTES);
  });
  it('a comment-only input with Allow comments is empty input at the end', () => {
    expect(failure('// nothing', { allowComments: true })).toBe('1:11 empty input');
  });
  it('limits of §12 and §7', () => {
    expect([LIVE_INPUT, MAX_INPUT, DETECT_WHOLE_CHARS, DETECT_PREFIX_CHARS]).toEqual([
      262_144, 33_554_432, 1_048_576, 65_536,
    ]);
  });
});

describe('compareKeys', () => {
  it('code points, shorter first on a common start, 0 for equal', () => {
    const sorted = ['b', 'B', 'a', '_', 'ä', '！', '😀', '', 'ab', '\uE000', '\uFFFF', '𝒳'].sort(compareKeys);
    expect(sorted).toEqual(['', 'B', '_', 'a', 'ab', 'b', 'ä', '\uE000', '！', '\uFFFF', '𝒳', '😀']);
    expect(compareKeys('a', 'a')).toBe(0);
    expect(Math.sign(compareKeys('😀', '\ud83d'))).toBe(1);
    expect(Math.sign(compareKeys('\ud83d', '😀'))).toBe(-1);
    expect(Math.sign(compareKeys('x😀', 'x\uFFFF'))).toBe(1);
  });
  it('agrees with comparing code point arrays on random strings', () => {
    let seed = 7;
    const rnd = (n: number): number => (seed = (seed * 1103515245 + 12345) % 2 ** 31) % n;
    const pool = ['a', 'b', 'Z', '_', 'é', '\uE000', '\uFFFD', '😀', '🙂', '\ud800', '\udc00', '𝒳'];
    const str = (): string => Array.from({ length: rnd(4) }, () => pool[rnd(pool.length)]).join('');
    const reference = (a: string, b: string): number => {
      const x = Array.from(a, c => c.codePointAt(0)!);
      const y = Array.from(b, c => c.codePointAt(0)!);
      for (let i = 0; i < Math.min(x.length, y.length); i++) if (x[i] !== y[i]) return x[i]! - y[i]!;
      return x.length - y.length;
    };
    for (let k = 0; k < 20_000; k++) {
      const a = str();
      const b = str();
      expect(Math.sign(compareKeys(a, b)), `${JSON.stringify(a)} ${JSON.stringify(b)}`).toBe(
        Math.sign(reference(a, b)),
      );
    }
  });
});

describe('describeNotes (§5 «Заметки»)', () => {
  it('in order: byte order mark, comments and commas, duplicates, inexact numbers', () => {
    expect(
      describeNotes({
        bom: true,
        comments: 2,
        trailingCommas: 1,
        duplicateKeys: [{ key: 'a', offset: 13, line: 1, column: 14 }],
        inexactNumbers: 1,
      }),
    ).toEqual([
      'A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1).',
      'Removed 2 comments and 1 trailing comma: the result is strict JSON.',
      'Duplicate key "a" at line 1, column 14. Both are kept; parsers disagree on which one wins (RFC 8259 §4).',
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    ]);
  });
  it('plural forms, the zero part left out, several duplicates', () => {
    expect(describeNotes({ ...NO_NOTES, comments: 1 })).toEqual(['Removed 1 comment: the result is strict JSON.']);
    expect(describeNotes({ ...NO_NOTES, trailingCommas: 3 })).toEqual([
      'Removed 3 trailing commas: the result is strict JSON.',
    ]);
    expect(
      describeNotes({
        ...NO_NOTES,
        duplicateKeys: [
          { key: 'a', offset: 13, line: 1, column: 14 },
          { key: 'b', offset: 20, line: 1, column: 21 },
          { key: 'a', offset: 30, line: 1, column: 31 },
        ],
        inexactNumbers: 1234,
      }),
    ).toEqual([
      '3 duplicate keys, the first: "a" at line 1, column 14. All are kept; parsers disagree on which one wins (RFC 8259 §4).',
      "1,234 numbers are kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change them.",
    ]);
    expect(describeNotes(NO_NOTES)).toEqual([]);
  });
  it('a name in JSON quotes, longer than 40 characters cut with …', () => {
    const [line] = describeNotes({
      ...NO_NOTES,
      duplicateKeys: [{ key: `${'k'.repeat(45)}"`, offset: 0, line: 2, column: 3 }],
    });
    expect(line).toBe(
      `Duplicate key "${'k'.repeat(40)}…" at line 2, column 3. Both are kept; parsers disagree on which one wins (RFC 8259 §4).`,
    );
    const [quoted] = describeNotes({ ...NO_NOTES, duplicateKeys: [{ key: 'a"\n', offset: 0, line: 1, column: 1 }] });
    expect(quoted).toContain('Duplicate key "a\\"\\n" at line 1');
    const [split] = describeNotes({
      ...NO_NOTES,
      duplicateKeys: [{ key: `${'k'.repeat(39)}😀tail`, offset: 0, line: 1, column: 1 }],
    });
    expect(split).toContain(`"${'k'.repeat(39)}…"`);
  });
});

describe('detectJson (§7)', () => {
  const big = `[${Array.from({ length: 400_000 }, (_, i) => i).join(',')}]`;
  it.each([
    [' {"a":1} ', true],
    ['[1]', true],
    ['{}', true],
    ['42', false],
    ['"x"', false],
    ['{oops}', false],
    ['{a: 1}', false],
    ['[a, b]', false],
    ['{"a":1,}', false],
    ['[1,2,3', false],
    ['{"a":1} // c', false],
    ['{"a":1}\n{"a":2}', false],
    ['eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig', false],
    ['a: 1', false],
    ['* * * * *', false],
  ])('%j → %s', (text, expected) => {
    expect(detectJson(text)).toBe(expected);
  });
  it('an array of 3 MiB and the same without its last ] (longer than 1 Mi: the start is checked) — yes; yes', () => {
    expect(big.length).toBeGreaterThan(2 * 1024 * 1024);
    expect(detectJson(big)).toBe(true);
    expect(detectJson(big.slice(0, -1))).toBe(true);
  });
  it('longer than 1 Mi with an error at the start — no', () => {
    expect(detectJson(`[{"k":x}${big}`)).toBe(false);
  });
  it('costs the same for any size above 1 Mi: well under 50 ms on 3 MiB', () => {
    const t0 = performance.now();
    for (let k = 0; k < 10; k++) detectJson(big);
    expect((performance.now() - t0) / 10).toBeLessThan(50);
  });
});

describe('measureText and formatMegabytes', () => {
  it('characters, lines (\\n, \\r\\n, \\r) and UTF-8 bytes', () => {
    expect(measureText('')).toEqual({ chars: 0, lines: 1, bytes: 0 });
    expect(measureText('a\nb\r\nc\rd')).toEqual({ chars: 8, lines: 4, bytes: 8 });
    expect(measureText('é🙂ж€\ud800')).toEqual({ chars: 6, lines: 1, bytes: 2 + 4 + 2 + 3 + 3 });
    expect(measureText('é🙂ж€').bytes).toBe(new TextEncoder().encode('é🙂ж€').length);
  });
  it('one digit after the point, 1 MB = 1,048,576', () => {
    expect(formatMegabytes(20 * 1024 * 1024)).toBe('20.0 MB');
    expect(formatMegabytes(31_142_707)).toBe('29.7 MB');
  });
});
