import { detectJson, formatJson, locateJsonError, minifyJson, sortKeysDeep } from './logic';
import { describe, expect, it } from 'vitest';

describe('formatJson', () => {
  it('indents with 2, 4 or a tab', () => {
    expect(formatJson('{"a":[1,2]}', { indent: 2, sortKeys: false })).toEqual({
      ok: true,
      text: '{\n  "a": [\n    1,\n    2\n  ]\n}',
    });
    expect(formatJson('{"a":1}', { indent: 4, sortKeys: false })).toEqual({ ok: true, text: '{\n    "a": 1\n}' });
    expect(formatJson('{"a":1}', { indent: 'tab', sortKeys: false })).toEqual({ ok: true, text: '{\n\t"a": 1\n}' });
  });
  it('sorts keys deeply when asked, arrays keep their order', () => {
    const r = formatJson('{"b":{"d":1,"c":2},"a":[3,1]}', { indent: 2, sortKeys: true });
    expect(r.ok && JSON.parse(r.text)).toEqual({ a: [3, 1], b: { c: 2, d: 1 } });
    expect(r.ok && r.text.indexOf('"a"') < r.text.indexOf('"b"')).toBe(true);
    expect(Object.keys(sortKeysDeep({ b: 1, B: 2, a: 3 }) as object)).toEqual(['B', 'a', 'b']);
  });
  it('reports an error with its line and column instead of throwing', () => {
    expect(formatJson('{\n  "a": 1,\n}', { indent: 2, sortKeys: false })).toEqual({
      ok: false,
      error: { message: 'trailing comma', offset: 12, line: 3, column: 1 },
    });
  });
});

describe('minifyJson', () => {
  it('drops the whitespace', () => {
    expect(minifyJson('{\n  "a": [ 1, 2 ],\n  "b": "x y"\n}')).toEqual({ ok: true, text: '{"a":[1,2],"b":"x y"}' });
  });
});

describe('locateJsonError', () => {
  it('accepts what JSON.parse accepts', () => {
    for (const ok of ['0', '-1.5e+3', '"\\u00e9\\n"', 'true', ' null ', '[]', '{}', '{"a":[{"b":null}]}', '"🙂"']) {
      expect(locateJsonError(ok)).toBeNull();
      expect(() => JSON.parse(ok)).not.toThrow();
    }
  });
  it('finds the first problem, 1-based line and column', () => {
    const cases: Array<[string, string, number, number]> = [
      ['', 'empty input', 1, 1],
      ['{"a" 1}', "expected ':'", 1, 6],
      ["{'a':1}", 'expected a property name in double quotes', 1, 2],
      ['[1,]', 'trailing comma', 1, 4],
      ['[1 2]', "expected ',' or ']'", 1, 4],
      ['01', 'unexpected text after the JSON value', 1, 2],
      ['{"a":tru}', 'unexpected "}"', 1, 9],
      ['"abc', 'unterminated string', 1, 5],
      ['"a\\x"', 'invalid escape', 1, 3],
      ['{"a":1}\n{', 'unexpected text after the JSON value', 2, 1],
      ['[\n  1,\n  NaN\n]', 'unexpected "N"', 3, 3],
    ];
    for (const [text, message, line, column] of cases) {
      expect(locateJsonError(text), text).toMatchObject({ message, line, column });
      expect(() => JSON.parse(text), text).toThrow();
    }
  });
});

describe('detectJson', () => {
  it('objects and arrays only', () => {
    expect(detectJson(' {"a":1} ')).toBe(true);
    expect(detectJson('[1]')).toBe(true);
    expect(detectJson('42')).toBe(false);
    expect(detectJson('{oops}')).toBe(false);
  });
});
