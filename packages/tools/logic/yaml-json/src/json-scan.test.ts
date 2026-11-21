/** The exact JSON scanner (json-scan.ts): the tree, the literals as written, the errors of json.md §5 with places. */
import { decodeTextFile, isInexactNumber, parseJsonTree, positionOf } from './json-scan';
import { describe, expect, it } from 'vitest';

const error = (text: string): string => {
  const r = parseJsonTree(text);
  if (r.ok) throw new Error('expected an error');
  return `${r.error.line}:${r.error.column} ${r.error.message}`;
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
      duplicateKeys: [{ key: 'b', offset: 48, line: 1, column: 49 }],
      inexactNumbers: 2,
    });
  });

  it('skips a byte order mark and says so', () => {
    const r = parseJsonTree('﻿[1]');
    expect(r.ok && r.notes.bom).toBe(true);
  });

  it('is not recursive: 1000 levels deep pass, 1001 do not', () => {
    expect(parseJsonTree(`${'['.repeat(1000)}${']'.repeat(1000)}`).ok).toBe(true);
    expect(error(`${'{"a":'.repeat(1001)}1${'}'.repeat(1001)}`)).toBe('1:5001 nesting deeper than 1000 levels');
    // Far deeper than any call stack: refused at the 1001st bracket, no stack overflow.
    expect(error('['.repeat(200_000))).toBe('1:1001 nesting deeper than 1000 levels');
  });

  it.each([
    ['', '1:1 empty input'],
    ['   ', '1:4 empty input'],
    ['{"a":1,}', '1:8 trailing comma'],
    ['[1,]', '1:4 trailing comma'],
    ['{"a" 1}', "1:6 expected ':'"],
    ['{"a":1 "b":2}', "1:8 expected ',' or '}'"],
    ['[1 2]', "1:4 expected ',' or ']'"],
    ['{a:1}', '1:2 expected a property name in double quotes'],
    ["{'a':1}", '1:2 property names must be in double quotes'],
    ["['a']", '1:2 strings must be in double quotes'],
    ['-', '1:1 invalid number'],
    ['-x', '1:1 invalid number'],
    ['012', '1:1 leading zeros are not allowed'],
    ['1.', '1:3 expected a digit after "."'],
    ['1e+', '1:4 expected a digit in the exponent'],
    ['"abc', '1:5 unterminated string'],
    ['"a\\x"', '1:3 invalid escape "\\x"'],
    ['"\\u12G4"', '1:2 invalid \\u escape: 4 hex digits expected'],
    ['"a\tb"', '1:3 control character U+0009 in a string; write it as \\t'],
    ['"a\u0001b"', '1:3 control character U+0001 in a string'],
    ['[1, 2]', '1:4 unexpected U+00A0 (an invisible character)'],
    ['nul', '1:1 unexpected "n"'],
    ['[1', "1:3 unexpected end of input, expected ',' or ']'"],
    ['{"a":', '1:6 unexpected end of input, expected a value'],
    ['{"a"', "1:5 unexpected end of input, expected ':'"],
    ['{', '1:2 unexpected end of input, expected a property name'],
    ['1 2', '1:3 unexpected text after the JSON value'],
    [
      '{"a":1}\n{"a":2}',
      '2:1 unexpected text after the JSON value: several values, one per line, are JSON Lines, which this tool does not read',
    ],
    ['{\r\n"a":1,\r\n}', '3:1 trailing comma'],
  ])('%j → %s', (text, expected) => {
    expect(error(text)).toBe(expected);
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
    ['9007199254740992', true],
    ['-9007199254740993', true],
    ['12345678901234567890', true],
    ['1E400', true],
    ['-1e400', true],
    ['1e-400', true],
    ['0e-400', false],
    ['0.1', false],
    ['1.50', false],
    ['-0', false],
  ])('%s → %s', (raw, expected) => {
    expect(isInexactNumber(raw)).toBe(expected);
  });
});

describe('positionOf', () => {
  it('counts \\n, \\r\\n and a lone \\r as one line break each; columns in UTF-16', () => {
    expect(positionOf('a\nb\r\nc\rd', 7)).toEqual({ line: 4, column: 1 });
    expect(positionOf('🙂x', 2)).toEqual({ line: 1, column: 3 });
  });
});

describe('decodeTextFile', () => {
  it('strict UTF-8, the byte order mark dropped', () => {
    expect(decodeTextFile(new Uint8Array([0xef, 0xbb, 0xbf, 0x61]))).toEqual({ ok: true, text: 'a' });
    expect(decodeTextFile(new Uint8Array([0xff]))).toEqual({ ok: false, message: 'The file is not valid UTF-8 text.' });
  });
});
