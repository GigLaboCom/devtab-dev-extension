/**
 * The shared JSON scanner (json-scan.ts): the tree, the literals as written, the token sink, JSONC, several values, and
 * every error of docs/tools/specs/json.md §5 п. 6 and §10 with its place. Moved here from the yaml-json tool, which wrote
 * the first version of this reader; its cases are kept.
 */
import {
  JSON_NUMBER,
  MAX_DEPTH,
  decodeTextFile,
  isInexactNumber,
  parseJsonTree,
  parseJsonValues,
  positionOf,
  positionsIn,
  scanJson,
} from './json-scan';
import { describe, expect, it } from 'vitest';
import type { JsonSink, ParseOptions } from './json-scan';

const error = (text: string, options: Partial<ParseOptions> = {}): string => {
  const r = scanJson(text, options);
  if (r.ok) throw new Error(`expected an error: ${JSON.stringify(text)}`);
  return `${r.error.line}:${r.error.column} ${r.error.message}`;
};

/** Every call of the sink, as a line. */
const tokens = (text: string, options: Partial<ParseOptions> = {}): string[] => {
  const out: string[] = [];
  const sink: JsonSink = {
    open: (b, at) => out.push(`open ${b} ${at}`),
    close: (b, at) => out.push(`close ${b} ${at}`),
    key: (raw, at, name) => out.push(`key ${raw} ${at} ${name}`),
    value: (raw, kind, at) => out.push(`${kind} ${raw} ${at}`),
    comma: () => out.push(','),
  };
  const r = scanJson(text, options, sink);
  if (!r.ok) throw new Error(r.error.message);
  return out;
};

describe('parseJsonTree', () => {
  it('keeps order, literals as written and duplicate keys', () => {
    const r = parseJsonTree('{"b":1,"2":[1.50,-0,1E400,12345678901234567890],"b":"\\u00e9",  "n":null,"t":true}');
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.tree).toEqual({
      type: 'object',
      offset: 0,
      entries: [
        { key: 'b', raw: '"b"', offset: 1, value: { type: 'number', offset: 5, raw: '1' } },
        {
          key: '2',
          raw: '"2"',
          offset: 7,
          value: {
            type: 'array',
            offset: 11,
            items: [
              { type: 'number', offset: 12, raw: '1.50' },
              { type: 'number', offset: 17, raw: '-0' },
              { type: 'number', offset: 20, raw: '1E400' },
              { type: 'number', offset: 26, raw: '12345678901234567890' },
            ],
          },
        },
        { key: 'b', raw: '"b"', offset: 48, value: { type: 'string', offset: 52, raw: '"\\u00e9"', value: 'é' } },
        { key: 'n', raw: '"n"', offset: 63, value: { type: 'null', offset: 67 } },
        { key: 't', raw: '"t"', offset: 72, value: { type: 'boolean', offset: 76, value: true } },
      ],
    });
    expect(r.notes).toEqual({
      bom: false,
      comments: 0,
      trailingCommas: 0,
      duplicateKeys: [{ key: 'b', offset: 48, line: 1, column: 49 }],
      inexactNumbers: 2,
    });
  });

  it('nested values keep their names, objects inside arrays inside objects', () => {
    const r = parseJsonTree('{"a":[{"b":{}},[]],"c":{"d":[1]}}');
    expect(r.ok && JSON.stringify(r.tree)).toBe(
      JSON.stringify({
        type: 'object',
        offset: 0,
        entries: [
          {
            key: 'a',
            raw: '"a"',
            offset: 1,
            value: {
              type: 'array',
              offset: 5,
              items: [
                {
                  type: 'object',
                  offset: 6,
                  entries: [{ key: 'b', raw: '"b"', offset: 7, value: { type: 'object', offset: 11, entries: [] } }],
                },
                { type: 'array', offset: 15, items: [] },
              ],
            },
          },
          {
            key: 'c',
            raw: '"c"',
            offset: 19,
            value: {
              type: 'object',
              offset: 23,
              entries: [
                {
                  key: 'd',
                  raw: '"d"',
                  offset: 24,
                  value: { type: 'array', offset: 28, items: [{ type: 'number', offset: 29, raw: '1' }] },
                },
              ],
            },
          },
        ],
      }),
    );
  });

  it('skips a byte order mark and says so', () => {
    const r = parseJsonTree('\uFEFF[1]');
    expect(r.ok && r.notes.bom).toBe(true);
  });

  it('is not recursive: 1000 levels deep pass, 1001 do not', () => {
    expect(MAX_DEPTH).toBe(1000);
    expect(parseJsonTree(`${'['.repeat(1000)}${']'.repeat(1000)}`).ok).toBe(true);
    expect(parseJsonTree(`${'{"a":'.repeat(1000)}1${'}'.repeat(1000)}`).ok).toBe(true);
    expect(error(`${'{"a":'.repeat(1001)}1${'}'.repeat(1001)}`)).toBe('1:5001 nesting deeper than 1000 levels');
    // Far deeper than any call stack: refused at the 1001st bracket, no stack overflow.
    expect(error('['.repeat(200_000))).toBe('1:1001 nesting deeper than 1000 levels');
    expect(error(`${'['.repeat(9000)}${']'.repeat(9000)}`)).toBe('1:1001 nesting deeper than 1000 levels');
  });

  it('takes comments and trailing commas only when allowed', () => {
    const text = '{\n  // c\n  "a": 1, /* x */\n  "b": [1, 2,],\n}';
    expect(error(text)).toBe('2:3 comments are not allowed in JSON');
    const r = parseJsonTree(text, { allowComments: true });
    expect(r.ok && r.notes).toMatchObject({ comments: 2, trailingCommas: 2 });
  });
});

describe('parseJsonValues', () => {
  it('reads values one after another, each a tree', () => {
    const r = parseJsonValues('{"a":1} {"a":12345678901234567890}\n[true] // last\n', { allowComments: true });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.values.map(v => v.type)).toEqual(['object', 'object', 'array']);
    expect(r.values[1]).toEqual({
      type: 'object',
      offset: 8,
      entries: [
        { key: 'a', raw: '"a"', offset: 9, value: { type: 'number', offset: 13, raw: '12345678901234567890' } },
      ],
    });
    expect(r.notes).toMatchObject({ comments: 1, inexactNumbers: 1 });
  });

  it('blank input is empty input; an error has its place', () => {
    const blank = parseJsonValues('  ');
    expect(!blank.ok && blank.error.message).toBe('empty input');
    const bad = parseJsonValues('{"a":1}\n{"a":}');
    expect(!bad.ok && `${bad.error.line}:${bad.error.column} ${bad.error.message}`).toBe('2:6 unexpected "}"');
  });
});

describe('scanJson', () => {
  it('tells the sink every token in order, with offsets; a trailing comma is not a comma', () => {
    expect(tokens(' {"a":[1,"x",true],"\\u0062":{}} ')).toEqual([
      'open { 1',
      'key "a" 2 a',
      'open [ 6',
      'number 1 7',
      ',',
      'string "x" 9',
      ',',
      'literal true 13',
      'close [ 17',
      ',',
      'key "\\u0062" 19 b',
      'open { 28',
      'close { 29',
      'close { 30',
    ]);
    expect(tokens('[1,/*c*/]', { allowComments: true })).toEqual(['open [ 0', 'number 1 1', 'close [ 8']);
  });

  it('answers the notes without a sink', () => {
    const r = scanJson('\uFEFF{"a":1,"a":2,"a":1e-400}');
    expect(r).toEqual({
      ok: true,
      notes: {
        bom: true,
        comments: 0,
        trailingCommas: 0,
        duplicateKeys: [
          { key: 'a', offset: 8, line: 1, column: 9 },
          { key: 'a', offset: 14, line: 1, column: 15 },
        ],
        inexactNumbers: 1,
      },
    });
  });

  it('says when an error is at the end of the input: a prefix of valid JSON fails only there', () => {
    const full = '{"a":[1,-2.5e3,"x\\u00e9y",true,false,null,{"b":{}}],"c":"d"}';
    for (let cut = 1; cut < full.length; cut++) {
      const r = scanJson(full.slice(0, cut));
      expect(r.ok === false && r.atEnd, full.slice(0, cut)).toBe(true);
    }
    const r = scanJson('[1,x');
    expect(r.ok === false && r.atEnd).toBe(false);
  });

  it.each([
    // json.md §10, the rows about errors and places, in the table's order
    ['', '1:1 empty input'],
    ['   \n ', '2:2 empty input'],
    ['{\n  "a": 1,\n}', '3:1 trailing comma'],
    ['[1,]', '1:4 trailing comma'],
    ['{"a":1 // c\n}', '1:8 comments are not allowed in JSON'],
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
    ['['.repeat(1001) + ']'.repeat(1001), '1:1001 nesting deeper than 1000 levels'],
    // json.md §6 and §5 п. 6, beyond §10
    ['"a\u0001b"', '1:3 control character U+0001 in a string'],
    ['"a\rb"', '1:3 control character U+000D in a string; write it as \\r'],
    ['[1,\u00a02]', '1:4 unexpected U+00A0 (an invisible character)'],
    ['[1\u00a0]', '1:3 unexpected U+00A0 (an invisible character)'],
    ['{"a"\u200b:1}', '1:5 unexpected U+200B (an invisible character)'],
    ['[1,\uFEFF2]', '1:4 unexpected U+FEFF (an invisible character)'],
    ['\uFEFF\uFEFF[]', '1:2 unexpected U+FEFF (an invisible character)'],
    ['{"a":1 /* x', '1:8 comments are not allowed in JSON'],
    ['[1] /x', '1:5 unexpected text after the JSON value'],
    // the yaml-json tool's cases of this reader
    ['   ', '1:4 empty input'],
    ['{"a":1,}', '1:8 trailing comma'],
    ['{"a":1 "b":2}', "1:8 expected ',' or '}'"],
    ['-', '1:2 unexpected end of input'],
    ['-x', '1:1 invalid number'],
    ['012', '1:1 leading zeros are not allowed'],
    ['1.', '1:3 expected a digit after "."'],
    ['1e+', '1:4 expected a digit in the exponent'],
    ['nul', '1:4 unexpected end of input'],
    ['nulL', '1:4 unexpected "L"'],
    ['[1', "1:3 unexpected end of input, expected ',' or ']'"],
    ['[', "1:2 unexpected end of input, expected a value or ']'"],
    ['[1,', '1:4 unexpected end of input, expected a value'],
    ['{"a":', '1:6 unexpected end of input, expected a value'],
    ['{"a"', "1:5 unexpected end of input, expected ':'"],
    ['{"a":1,', '1:8 unexpected end of input, expected a property name'],
    ['"\\', '1:3 unterminated string'],
    ['"\\u12', '1:6 unterminated string'],
    ['1 2', '1:3 unexpected text after the JSON value'],
    [
      '{"a":1}\n{"a":2}',
      '2:1 unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    ],
    ['{"a":1}\n"x"', '2:1 unexpected text after the JSON value'],
    ['\r1{}', '2:2 unexpected text after the JSON value'],
    [
      '1\n{}',
      '2:1 unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    ],
    ['{\r\n"a":1,\r\n}', '3:1 trailing comma'],
  ])('%j → %s', (text, expected) => {
    expect(error(text)).toBe(expected);
  });

  it.each([
    // json.md §10 with Allow comments, and JSONC's own errors
    ['{"a":1 /* x', '1:8 unterminated comment'],
    ['[1,,]', '1:4 unexpected ","'],
    ['[,]', '1:2 unexpected ","'],
    ['{,}', '1:2 expected a property name in double quotes'],
    ['[1,', "1:4 unexpected end of input, expected a value or ']'"],
    ['{"a":1,', "1:8 unexpected end of input, expected a property name or '}'"],
    ['// only a comment', '1:18 empty input'],
    ['[1] /x', '1:5 unexpected text after the JSON value'],
  ])('with comments allowed: %j → %s', (text, expected) => {
    expect(error(text, { allowComments: true })).toBe(expected);
  });

  it('JSONC: a line comment ends at \\n, \\r\\n or \\r; comments stand wherever whitespace may', () => {
    const text = '/*a*/{/*b*/"k"/*c*/:/*d*/[/*e*/1/*f*/,//g\r2,//h\r\n]//i\n,"l":0,}/*j*/';
    const r = scanJson(text, { allowComments: true });
    expect(r).toEqual({ ok: true, notes: expect.objectContaining({ comments: 10, trailingCommas: 2 }) });
    expect(tokens(text, { allowComments: true }).filter(t => !t.startsWith('open') && !t.startsWith('close'))).toEqual([
      'key "k" 11 k',
      'number 1 31',
      ',',
      'number 2 42',
      ',',
      'key "l" 55 l',
      'number 0 59',
    ]);
  });

  it('accepts what JSON.parse accepts, rejects what it rejects', () => {
    const accepted = [
      '0',
      '-0',
      '-1.5e+3',
      '1E-7',
      '"\\u00e9\\n\\"\\\\\\/\\b\\f\\r\\t"',
      'true',
      ' null ',
      '[]',
      '{}',
      '{"a":[{"b":null}]}',
      '"🙂"',
      '"\\ud800"',
      '"a\u2028b"',
      '{"__proto__":{"x":1},"a":1}',
      '\t\r\n[ ]\r\n',
    ];
    for (const text of accepted) {
      expect(scanJson(text).ok, text).toBe(true);
      expect(() => JSON.parse(text), text).not.toThrow();
    }
    const rejected = ['', '[1,]', '{"a":1,}', '01', '1.', '.5', '+1', "'a'", '[1 2]', '"\t"', 'nul', '[', '{"a"}'];
    for (const text of rejected) {
      expect(scanJson(text).ok, text).toBe(false);
      expect(() => JSON.parse(text), text).toThrow();
    }
  });

  it('is linear: a megabyte of the worst inputs in well under a second each', () => {
    const MB = 1024 * 1024;
    const worst = [
      `"${'\\\\'.repeat(MB / 2)}"`, // escapes only
      `"${'a'.repeat(MB)}"`, // one long string
      `[${'0,'.repeat(MB / 2)}0]`, // many small numbers
      `{${Array.from({ length: 50_000 }, (_, i) => `"k${i % 7}":${i}`).join(',')}}`, // duplicate keys galore
      `${'['.repeat(1000)}${']'.repeat(1000)}`.repeat(1).padEnd(MB, ' '), // deep, then whitespace
      `[1,${'/* x */'.repeat(MB / 8)}2]`, // comments (allowed below)
      `[${'1'.repeat(MB)}]`, // one huge integer
    ];
    for (const text of worst) {
      const t0 = performance.now();
      const r = scanJson(text, { allowComments: true });
      expect(r.ok, text.slice(0, 40)).toBe(true);
      expect(performance.now() - t0).toBeLessThan(1_000);
    }
    const unterminated = `[${'"a",'.repeat(MB / 4)}/* never closed`;
    const t0 = performance.now();
    expect(scanJson(unterminated, { allowComments: true }).ok).toBe(false);
    expect(performance.now() - t0).toBeLessThan(1_000);
  });

  it('a long input with long strings is read in linear time', () => {
    const text = JSON.stringify(Array.from({ length: 2000 }, (_, i) => ({ [`k${i}`]: 'x'.repeat(150), n: i })));
    const t0 = performance.now();
    expect(parseJsonTree(text).ok).toBe(true);
    expect(performance.now() - t0).toBeLessThan(5_000);
  });
});

describe('isInexactNumber', () => {
  it.each([
    ['9007199254740991', false],
    ['-9007199254740991', false],
    ['9007199254740992', true],
    ['-9007199254740993', true],
    ['12345678901234567890', true],
    ['123456789012345', false],
    ['1E400', true],
    ['-1e400', true],
    ['1e-400', true],
    ['0e-400', false],
    ['0.1', false],
    ['0.1000000000000000055511151231257827', false],
    ['1.50', false],
    ['-0', false],
    ['1e308', false],
    ['1e309', true],
    [`0.${'0'.repeat(400)}1`, true],
    [`0.${'0'.repeat(400)}`, false],
    [`${'9'.repeat(400)}.5`, true],
  ])('%s → %s', (raw, expected) => {
    expect(isInexactNumber(raw)).toBe(expected);
  });

  it('JSON_NUMBER is the number grammar of RFC 8259 §6', () => {
    for (const ok of ['0', '-0', '1.5', '1e5', '1E+5', '-0.0e-0']) expect(JSON_NUMBER.test(ok), ok).toBe(true);
    for (const bad of ['01', '1.', '.5', '+1', '1e', '0x10', 'NaN']) expect(JSON_NUMBER.test(bad), bad).toBe(false);
  });
});

describe('positionOf', () => {
  it('counts \\n, \\r\\n and a lone \\r as one line break each; columns in UTF-16', () => {
    expect(positionOf('a\nb\r\nc\rd', 7)).toEqual({ line: 4, column: 1 });
    expect(positionOf('🙂x', 2)).toEqual({ line: 1, column: 3 });
    const many = positionsIn('a\nb\r\nc\rd');
    expect([0, 2, 5, 7].map(many)).toEqual([
      { line: 1, column: 1 },
      { line: 2, column: 1 },
      { line: 3, column: 1 },
      { line: 4, column: 1 },
    ]);
  });
});

describe('decodeTextFile', () => {
  it('strict UTF-8, the byte order mark dropped', () => {
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ ok: true, text: 'a' });
    expect(decodeTextFile(new Uint8Array([0xff]))).toEqual({ ok: false, message: 'The file is not valid UTF-8 text.' });
  });
});
