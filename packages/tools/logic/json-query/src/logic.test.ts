/**
 * The rows of docs/tools/specs/json-query.md §10 (the compliance suite is cts.test.ts, the path property
 * properties.test.ts) and the rules of §5 the rows miss: the RFC 9535 example tables row by row, exact numbers,
 * repeated names, the errors of §6 with their places, I-Regexp, normalized paths, printing, the worker's run, notes and
 * detect.
 */
import { compareNumbers } from './decimal';
import { detectJsonQuery } from './detect';
import { evaluate, TOO_MANY_NODES } from './evaluate';
import { checkIRegexp, iRegexp } from './iregexp';
import { errorExcerpt, errorText, shortQuery } from './logic';
import { documentNotes, queryNotes } from './notes';
import { parseQuery } from './parse';
import { normalizedPath, quoteName } from './paths';
import { previewValue, printValue } from './print';
import { readDocument, resultCountText, runQuery, valueOfRow } from './run';
import { describe, expect, it } from 'vitest';
import type { QueryError } from './parse';

/** Values (as written, minified) and paths of a query over a document text. */
const q = (doc: string, query: string): { values: string[]; paths: string[] } => {
  const parsed = parseQuery(query);
  if (!parsed.ok) throw new Error(`${query}: ${parsed.error.message} at ${parsed.error.start}`);
  const d = readDocument(doc);
  if (!d.ok) throw new Error(d.error.message);
  const r = evaluate(parsed.query, d.root);
  if (!r.ok) throw new Error(r.message);
  return { values: r.nodes.map(n => printValue(n.value, 'minify')), paths: r.nodes.map(normalizedPath) };
};
const values = (doc: string, query: string): string[] => q(doc, query).values;
const paths = (doc: string, query: string): string[] => q(doc, query).paths;
const error = (query: string): QueryError => {
  const parsed = parseQuery(query);
  if (parsed.ok) throw new Error(`${query} parsed`);
  return parsed.error;
};

const STORE = JSON.stringify({
  store: {
    book: [
      { category: 'reference', author: 'Nigel Rees', title: 'Sayings of the Century', price: 8.95 },
      { category: 'fiction', author: 'Evelyn Waugh', title: 'Sword of Honour', price: 12.99 },
      { category: 'fiction', author: 'Herman Melville', title: 'Moby Dick', isbn: '0-553-21311-3', price: 8.99 },
      {
        category: 'fiction',
        author: 'J. R. R. Tolkien',
        title: 'The Lord of the Rings',
        isbn: '0-395-19395-8',
        price: 22.99,
      },
    ],
    bicycle: { color: 'red', price: 399 },
  },
});
const book = (k: number): string => JSON.stringify((JSON.parse(STORE) as { store: { book: unknown[] } }).store.book[k]);

describe('RFC 9535 table 2: the bookstore', () => {
  it('selects authors, members and prices', () => {
    const authors = ['"Nigel Rees"', '"Evelyn Waugh"', '"Herman Melville"', '"J. R. R. Tolkien"'];
    expect(values(STORE, '$.store.book[*].author')).toEqual(authors);
    expect(paths(STORE, '$.store.book[*].author')).toEqual([0, 1, 2, 3].map(k => `$['store']['book'][${k}]['author']`));
    expect(values(STORE, '$..author')).toEqual(authors);
    expect(values(STORE, '$.store.*').map(v => v.slice(0, 2))).toEqual(['[{', '{"']);
    expect(values(STORE, '$.store..price')).toEqual(['8.95', '12.99', '8.99', '22.99', '399']);
  });
  it('indexes, slices and filters books', () => {
    expect(values(STORE, '$..book[2]')).toEqual([book(2)]);
    expect(values(STORE, '$..book[2].author')).toEqual(['"Herman Melville"']);
    expect(values(STORE, '$..book[2].publisher')).toEqual([]);
    expect(values(STORE, '$..book[-1]')).toEqual([book(3)]);
    expect(values(STORE, '$..book[0,1]')).toEqual([book(0), book(1)]);
    expect(values(STORE, '$..book[:2]')).toEqual([book(0), book(1)]);
    expect(values(STORE, '$..book[?@.isbn]')).toEqual([book(2), book(3)]);
    expect(values(STORE, '$..book[?@.price<10]')).toEqual([book(0), book(2)]);
    expect(values(STORE, '$..*').length).toBe(27);
  });
});

describe('RFC 9535 tables 5–9: selectors', () => {
  it('name selectors (table 5)', () => {
    const doc = `{"o": {"j j": {"k.k": 3}}, "'": {"@": 2}}`;
    expect(values(doc, "$.o['j j']")).toEqual(['{"k.k":3}']);
    expect(values(doc, "$.o['j j']['k.k']")).toEqual(['3']);
    expect(values(doc, '$.o["j j"]["k.k"]')).toEqual(['3']);
    expect(values(doc, `$["'"]["@"]`)).toEqual(['2']);
  });
  it('wildcards (table 6)', () => {
    const doc = '{"o": {"j": 1, "k": 2}, "a": [5, 3]}';
    expect(values(doc, '$[*]')).toEqual(['{"j":1,"k":2}', '[5,3]']);
    expect(values(doc, '$.o[*]')).toEqual(['1', '2']);
    expect(values(doc, '$.o[*, *]')).toEqual(['1', '2', '1', '2']);
    expect(values(doc, '$.a[*]')).toEqual(['5', '3']);
  });
  it('indexes (table 7) and slices (table 9)', () => {
    expect(values('["a","b"]', '$[1]')).toEqual(['"b"']);
    expect(values('["a","b"]', '$[-2]')).toEqual(['"a"']);
    const doc = '["a","b","c","d","e","f","g"]';
    expect(values(doc, '$[1:3]')).toEqual(['"b"', '"c"']);
    expect(values(doc, '$[5:]')).toEqual(['"f"', '"g"']);
    expect(values(doc, '$[1:5:2]')).toEqual(['"b"', '"d"']);
    expect(values(doc, '$[5:1:-2]')).toEqual(['"f"', '"d"']);
    expect(values(doc, '$[::-1]')).toEqual(['"g"', '"f"', '"e"', '"d"', '"c"', '"b"', '"a"']);
    expect(values(doc, '$[0:7:0]')).toEqual([]);
    expect(values(doc, '$[-100:100:3]')).toEqual(['"a"', '"d"', '"g"']);
  });
});

describe('RFC 9535 table 11: comparisons', () => {
  const doc = '{"obj": {"x": "y"}, "arr": [2, 3], "one": [0]}';
  const rows: Array<[string, boolean]> = [
    ['$.absent1 == $.absent2', true],
    ['$.absent1 <= $.absent2', true],
    ["$.absent == 'g'", false],
    ['$.absent1 != $.absent2', false],
    ["$.absent != 'g'", true],
    ['1 <= 2', true],
    ['1> 2', false],
    ["13 == '13'", false],
    ["'a' <= 'b'", true],
    ["'a' > 'b'", false],
    ['$.obj == $.arr', false],
    ['$.obj != $.arr', true],
    ['$.obj == $.obj', true],
    ['$.obj != $.obj', false],
    ['$.arr == $.arr', true],
    ['$.arr != $.arr', false],
    ['$.obj == 17', false],
    ['$.obj != 17', true],
    ['$.obj <= $.arr', false],
    ['$.obj < $.arr', false],
    ['$.obj <= $.obj', true],
    ['$.arr <= $.arr', true],
    ['1 <= $.arr', false],
    ['1 >= $.arr', false],
    ['1 > $.arr', false],
    ['1 < $.arr', false],
    ['true <= true', true],
    ['true > true', false],
  ];
  it.each(rows)('%s is %s', (comparison, expected) => {
    expect(values(doc, `$.one[?${comparison}]`)).toEqual(expected ? ['0'] : []);
  });
});

describe('RFC 9535 table 12: filters', () => {
  const doc = JSON.stringify({
    a: [3, 5, 1, 2, 4, 6, { b: 'j' }, { b: 'k' }, { b: {} }, { b: 'kilo' }],
    o: { p: 1, q: 2, r: 3, s: 5, t: { u: 6 } },
    e: 'f',
  });
  it('gives the table’s nodes', () => {
    expect(q(doc, "$.a[?@.b == 'kilo']")).toEqual({ values: ['{"b":"kilo"}'], paths: ["$['a'][9]"] });
    expect(values(doc, "$.a[?(@.b == 'kilo')]")).toEqual(['{"b":"kilo"}']);
    expect(paths(doc, '$.a[?@>3.5]')).toEqual(["$['a'][1]", "$['a'][4]", "$['a'][5]"]);
    expect(values(doc, '$.a[?@.b]')).toEqual(['{"b":"j"}', '{"b":"k"}', '{"b":{}}', '{"b":"kilo"}']);
    expect(paths(doc, '$[?@.*]')).toEqual(["$['a']", "$['o']"]);
    expect(paths(doc, '$[?@[?@.b]]')).toEqual(["$['a']"]);
    expect(paths(doc, '$.o[?@<3, ?@<3]')).toEqual(["$['o']['p']", "$['o']['q']", "$['o']['p']", "$['o']['q']"]);
    expect(values(doc, '$.a[?@<2 || @.b == "k"]')).toEqual(['1', '{"b":"k"}']);
    expect(values(doc, '$.a[?match(@.b, "[jk]")]')).toEqual(['{"b":"j"}', '{"b":"k"}']);
    expect(values(doc, '$.a[?search(@.b, "[jk]")]')).toEqual(['{"b":"j"}', '{"b":"k"}', '{"b":"kilo"}']);
    expect(values(doc, '$.o[?@>1 && @<4]')).toEqual(['2', '3']);
    expect(values(doc, '$.o[?@.u || @.x]')).toEqual(['{"u":6}']);
    expect(values(doc, '$.a[?@.b == $.x]')).toEqual(['3', '5', '1', '2', '4', '6']);
    expect(values(doc, '$.a[?@ == @]')).toHaveLength(10);
  });
});

describe('RFC 9535 table 14: function well-typedness', () => {
  it('parses the well-typed ones and refuses the others with the reason', () => {
    for (const ok of [
      '$[?length(@) < 3]',
      '$[?count(@.*) == 1]',
      "$[?match(@.timezone, 'Europe/.*')]",
      '$[?value(@..color) == "red"]',
    ])
      expect(parseQuery(ok).ok, ok).toBe(true);
    expect(error('$[?length(@.*) < 3]').message).toBe('length() takes a value: this query can select several nodes');
    expect(error('$[?count(1) == 1]').message).toBe('count() takes a query, not a literal');
    expect(error("$[?match(@.timezone, 'Europe/.*') == true]").message).toBe(
      'match() gives true or false: use it alone, without a comparison',
    );
    expect(error('$[?value(@..color)]').message).toBe(
      'value() gives a value, not true or false: compare it, as in value(@..a) == 1',
    );
    // The table's own made-up functions (foo, bar, bnl, blt, bal) are unknown here.
    for (const fn of ['$[?count(foo(@.*)) == 1]', '$[?bar(@.a)]', '$[?bnl(@.*)]', '$[?blt(1==1)]', '$[?bal(1)]'])
      expect(error(fn).message, fn).toMatch(/^unknown function "(foo|bar|bnl|blt|bal)": the functions are length/);
  });
});

describe('RFC 9535 tables 16–18: descendants, null, normalized paths', () => {
  it('descendants (table 16), in document order', () => {
    const doc = '{"o": {"j": 1, "k": 2}, "a": [5, 3, [{"j": 4}, {"k": 6}]]}';
    expect(q(doc, '$..j')).toEqual({ values: ['1', '4'], paths: ["$['o']['j']", "$['a'][2][0]['j']"] });
    expect(values(doc, '$..[0]')).toEqual(['5', '{"j":4}']);
    const all = [
      '{"j":1,"k":2}',
      '[5,3,[{"j":4},{"k":6}]]',
      '1',
      '2',
      '5',
      '3',
      '[{"j":4},{"k":6}]',
      '{"j":4}',
      '{"k":6}',
      '4',
      '6',
    ];
    expect(values(doc, '$..[*]')).toEqual(all);
    expect(values(doc, '$..*')).toEqual(all);
    expect(values(doc, '$..o')).toEqual(['{"j":1,"k":2}']);
    expect(values(doc, '$.o..[*, *]')).toEqual(['1', '2', '1', '2']);
    expect(values(doc, '$.a..[0, 1]')).toEqual(['5', '3', '{"j":4}', '{"k":6}']);
  });
  it('null is a value (table 17)', () => {
    const doc = '{"a": null, "b": [null], "c": [{}], "null": 1}';
    expect(values(doc, '$.a')).toEqual(['null']);
    expect(values(doc, '$.a[0]')).toEqual([]);
    expect(values(doc, '$.a.d')).toEqual([]);
    expect(values(doc, '$.b[0]')).toEqual(['null']);
    expect(values(doc, '$.b[*]')).toEqual(['null']);
    expect(values(doc, '$.b[?@]')).toEqual(['null']);
    expect(values(doc, '$.b[?@==null]')).toEqual(['null']);
    expect(values(doc, '$.c[?@.d==null]')).toEqual([]);
    expect(values(doc, '$.null')).toEqual(['1']);
  });
  it('normalized paths (table 18)', () => {
    expect(paths('{"a":1}', '$.a')).toEqual(["$['a']"]);
    expect(paths('[0,1,2,3,4]', '$[1]')).toEqual(['$[1]']);
    expect(paths('[0,1,2,3,4]', '$[-3]')).toEqual(['$[2]']);
    expect(paths('{"a":{"b":[5,6]}}', '$.a.b[1:2]')).toEqual(["$['a']['b'][1]"]);
    expect(paths('{"\\u000b":1}', '$["\\u000B"]')).toEqual(["$['\\u000b']"]);
    expect(paths('{"a":1}', '$["\\u0061"]')).toEqual(["$['a']"]);
  });
});

describe('numbers are exact (§5 п. 14)', () => {
  it('compares beyond a double, values as written', () => {
    const doc = '[12345678901234567890, 12345678901234567891]';
    expect(q(doc, '$[?@ == 12345678901234567891]')).toEqual({ values: ['12345678901234567891'], paths: ['$[1]'] });
    expect(values('[1.0, 1, 1e0, 10e-1, 1.5, -0, 0]', '$[?@ == 1]')).toEqual(['1.0', '1', '1e0', '10e-1']);
    expect(values('[1.0, 1, 1e0, 10e-1, 1.5, -0, 0]', '$[?@ == 0]')).toEqual(['-0', '0']);
    expect(values('[1e400, 1e398, 1e-400, 0]', '$[?@ > 1e399]')).toEqual(['1e400']);
    expect(values('[1e400, 1e398, 1e-400, 0]', '$[?@ > 0]')).toEqual(['1e400', '1e398', '1e-400']);
    expect(values('[9007199254740993, 9007199254740992]', '$[?@ > 9007199254740992]')).toEqual(['9007199254740993']);
    expect(values('[[1, 2.0]]', '$[?@ == $[0]]')).toEqual(['[1,2.0]']);
    expect(values('[{"a": 1.50}]', '$[?@ == $[0]]')).toEqual(['{"a":1.50}']);
  });
  it('compareNumbers: by value, whatever the spelling', () => {
    const cases: Array<[string, string, number]> = [
      ['1', '1.0', 0],
      ['-0', '0', 0],
      ['0.0e10', '-0.000', 0],
      ['12345678901234567890', '12345678901234567891', -1],
      ['1e400', '1e399', 1],
      ['-1e400', '-1e399', -1],
      ['1e-400', '0', 1],
      ['123.456e2', '12345.6', 0],
      ['0.1', '0.10000000000000001', -1],
      ['99', '100', -1],
      ['-5', '3', -1],
      ['1E+2', '100', 0],
      ['1e999999999999999999', '1e999999999999999998', 1],
    ];
    for (const [a, b, r] of cases) {
      expect(compareNumbers(a, b), `${a} ? ${b}`).toBe(r);
      expect(compareNumbers(b, a), `${b} ? ${a}`).toBe(-r || 0);
    }
  });
});

describe('strings, length and repeated names', () => {
  it('orders strings by code point, counts code points', () => {
    expect(values('["\\uFF01", "😀", "a"]', '$[?@ < "😀"]')).toEqual(['"\\uFF01"', '"a"']);
    expect(values('["a😀b", "ab"]', '$[?length(@) == 3]')).toEqual(['"a😀b"']);
    expect(values('["\\u0061"]', '$[?@ == "a"]')).toEqual(['"\\u0061"']);
    expect(values('[[1,2,3], {"a":1,"a":2}, "xyz", 3]', '$[?length(@) == 3]')).toEqual(['[1,2,3]', '"xyz"']);
    expect(values('[[1,2,3], {"a":1,"a":2}]', '$[?length(@) == 2]')).toEqual(['{"a":1,"a":2}']);
  });
  it('a name selector selects every member with the name (§5 п. 11)', () => {
    const doc = '{"a":1,"b":2,"a":3}';
    expect(q(doc, '$.a')).toEqual({ values: ['1', '3'], paths: ["$['a']", "$['a']"] });
    expect(values(doc, '$.*')).toEqual(['1', '2', '3']);
    // A singular query that meets two members has no single value: Nothing.
    expect(values(`[${doc}]`, '$[?@.a == 1]')).toEqual([]);
    expect(values(`[${doc}]`, '$[?@.a]')).toEqual([doc]);
    expect(values(`[${doc}]`, '$[?count(@.a) == 2]')).toEqual([doc]);
    expect(values('[{"a":1,"a":2},{"a":1,"a":2},{"a":2,"a":1}]', '$[?@ == $[0]]')).toEqual([
      '{"a":1,"a":2}',
      '{"a":1,"a":2}',
    ]);
  });
  it('keeps escapes, key spellings and order as written', () => {
    const doc = '{"b":1,"2":2,"1":3,"\\u00e9":"\\/x","n":[1.0,-0,1E400]}';
    expect(values(doc, '$')).toEqual([doc]);
    expect(values(doc, '$.*')).toEqual(['1', '2', '3', '"\\/x"', '[1.0,-0,1E400]']);
    expect(paths(doc, '$.*')).toEqual(["$['b']", "$['2']", "$['1']", "$['é']", "$['n']"]);
  });
});

describe('I-Regexp (RFC 9485)', () => {
  it('match is whole-string, search any part; . does not take a line break', () => {
    expect(values('["ab", "xab", "a\\nb"]', "$[?match(@, 'a.')]")).toEqual(['"ab"']);
    expect(values('["ab", "xab", "a\\nb"]', "$[?search(@, 'a.')]")).toEqual(['"ab"', '"xab"']);
    expect(values('["a\\u2028", "a\\r"]', "$[?match(@, 'a.')]")).toEqual(['"a\\u2028"']);
    expect(values('["12", "x"]', "$[?match(@, '\\\\d+')]")).toEqual([]);
    expect(values('["12", "x"]', "$[?match(@, '[0-9]+')]")).toEqual(['"12"']);
    expect(values('["É", "e"]', "$[?match(@, '\\\\p{Lu}')]")).toEqual(['"É"']);
    expect(values('["😀"]', "$[?match(@, '.')]")).toEqual(['"😀"']);
    expect(values('[1, "1"]', "$[?match(@, '1')]")).toEqual(['"1"']);
    expect(values('["abc", "xabc"]', "$[?search(@, '^ab')]")).toEqual(['"abc"']);
    expect(values('["a-b", "ab"]', "$[?match(@, 'a\\\\-b')]")).toEqual(['"a-b"']);
    expect(values('[{"p": "[jk]", "s": "k"}, {"p": "(", "s": "("}]', '$[?match(@.s, @.p)]')).toEqual([
      '{"p":"[jk]","s":"k"}',
    ]);
  });
  it('checkIRegexp: the grammar of RFC 9485 §3, with the reason', () => {
    for (const ok of [
      'a(b|c)*',
      '[a-z-]',
      '[-a]',
      '\\p{Lu}+',
      'x{2,3}',
      'x{2,}',
      'x{2}',
      '',
      '()',
      'a|',
      '[^\\]]',
      '\\P{Nd}',
      '.',
      '[\\^a]',
      '^a$',
      '\\-',
      '[\\n\\t-\\r]',
    ])
      expect(checkIRegexp(ok).ok, ok).toBe(true);
    const refused: Array<[string, string]> = [
      ['\\d', '\\d is not part of it (write [0-9])'],
      ['\\w+', '\\w is not part of it'],
      ['(?:a)', '(?…) groups are not part of it'],
      ['a{,2}', '{,n} is not part of it: write {0,n}'],
      ['[z-a]', 'the range is out of order'],
      ['x{3,2}', 'the quantifier is out of order: {n,m} needs n ≤ m'],
      ['\\p{Cs}', '\\p{Cs} is not a category of I-Regexp (L, Lu, Nd, P, Zs, …)'],
      ['\\p{Greek}', '\\p{Greek} is not a category of I-Regexp (L, Lu, Nd, P, Zs, …)'],
      ['a*?', '*? is not part of it (no lazy or possessive quantifiers)'],
      ['a**', 'a quantifier cannot follow a quantifier'],
      ['*a', 'nothing to repeat before *'],
      ['(a', 'unterminated group: a ) is missing'],
      ['a)', 'unmatched )'],
      ['[a', 'unterminated class: the closing ] is missing'],
      ['[]', 'an empty class [] is not part of it'],
      ['[a-b-c]', '- inside a class is allowed only first or last'],
      ['a}', '} must be escaped: \\}'],
      ['\\1', 'back references (\\1) are not part of it'],
      ['a\\', '\\ at the end of the pattern'],
      ['\\$', '\\$ is not an escape of I-Regexp'],
    ];
    for (const [pattern, message] of refused) {
      const r = checkIRegexp(pattern);
      expect(r.ok, pattern).toBe(false);
      if (!r.ok) expect(r.message, pattern).toBe(message);
    }
  });
  it('writes the JavaScript the mapping of RFC 9485 §5.3 gives', () => {
    expect(checkIRegexp('a.b').ok && (checkIRegexp('a.b') as { source: string }).source).toBe('a[^\\n\\r]b');
    expect(iRegexp('a.b', 'match')!.source).toBe('^(?:a[^\\n\\r]b)$');
    expect(iRegexp('a.b', 'search')!.flags).toBe('u');
    expect(iRegexp('\\d', 'match')).toBeNull();
  });
});

describe('normalized paths and printing', () => {
  it('quotes names as RFC 9535 §2.7 writes them', () => {
    expect(quoteName("'")).toBe("'\\''");
    expect(quoteName('\\')).toBe("'\\\\'");
    expect(quoteName('\u{0}')).toBe("'\\u0000'");
    expect(quoteName('\u{1f}')).toBe("'\\u001f'");
    expect(quoteName('\u{8}\u{c}\n\r\t')).toBe("'\\b\\f\\n\\r\\t'");
    expect(quoteName('\u{7f}')).toBe("'\u{7f}'");
    expect(quoteName('/')).toBe("'/'");
    expect(quoteName('"')).toBe(`'"'`);
    expect(quoteName('😀')).toBe("'😀'");
    expect(quoteName('\u{2028}')).toBe("'\u{2028}'");
    expect(quoteName('')).toBe("''");
  });
  it('prints values as written: minified, indented, cut', () => {
    const d = readDocument('{"a": [1.0, {"b": "\\u00e9"}, [], {}], "c": 1e400}');
    if (!d.ok) throw new Error();
    expect(printValue(d.root, 'minify')).toBe('{"a":[1.0,{"b":"\\u00e9"},[],{}],"c":1e400}');
    expect(printValue(d.root, 2)).toBe(
      '{\n  "a": [\n    1.0,\n    {\n      "b": "\\u00e9"\n    },\n    [],\n    {}\n  ],\n  "c": 1e400\n}',
    );
    const long = readDocument(JSON.stringify(['x'.repeat(500)]));
    if (!long.ok) throw new Error();
    const preview = previewValue(long.root);
    expect(preview).toHaveLength(200);
    expect(preview.endsWith('…')).toBe(true);
    const emoji = readDocument(JSON.stringify(['😀'.repeat(150)]));
    if (!emoji.ok) throw new Error();
    expect(previewValue(emoji.root)).toMatch(/^\["(😀)+…$/u);
  });
});

describe('the worker’s run', () => {
  const doc = readDocument(STORE);
  if (!doc.ok) throw new Error();
  it('gives rows, the values as one array and the paths', () => {
    const r = runQuery('$.store.book[*].author', doc.root);
    if (!r.ok) throw new Error();
    expect(r.count).toBe(4);
    expect(r.rows.map(x => x.preview)).toEqual([
      '"Nigel Rees"',
      '"Evelyn Waugh"',
      '"Herman Melville"',
      '"J. R. R. Tolkien"',
    ]);
    expect(r.values).toBe('[\n  "Nigel Rees",\n  "Evelyn Waugh",\n  "Herman Melville",\n  "J. R. R. Tolkien"\n]');
    expect(r.valuesComplete).toBe(true);
    expect(r.paths).toBe([0, 1, 2, 3].map(k => `$['store']['book'][${k}]['author']`).join('\n'));
    expect(valueOfRow(r.values, r.rows[1]!)).toBe('"Evelyn Waugh"');
  });
  it('a row’s value is indented by 2 from the left', () => {
    const r = runQuery('$..book[?@.price < 10]', doc.root);
    if (!r.ok) throw new Error();
    expect(valueOfRow(r.values, r.rows[0]!)).toBe(
      '{\n  "category": "reference",\n  "author": "Nigel Rees",\n  "title": "Sayings of the Century",\n  "price": 8.95\n}',
    );
    expect(JSON.parse(r.values)).toEqual([JSON.parse(book(0)), JSON.parse(book(2))]);
  });
  it('no results: empty texts; errors come back as values', () => {
    expect(runQuery('$.nothing', doc.root)).toMatchObject({ ok: true, count: 0, values: '', paths: '', rows: [] });
    expect(runQuery('$.', doc.root)).toEqual({
      ok: false,
      where: 'query',
      message: 'unexpected end of the query: expected a member name or * after "."',
    });
  });
  it('shows the first 1,000 rows and copies all', () => {
    const big = readDocument(JSON.stringify(Array.from({ length: 2500 }, (_, k) => k)));
    if (!big.ok) throw new Error();
    const r = runQuery('$[*]', big.root);
    if (!r.ok) throw new Error();
    expect(r.count).toBe(2500);
    expect(r.rows).toHaveLength(1000);
    expect(r.paths!.split('\n')).toHaveLength(2500);
    expect(JSON.parse(r.values)).toHaveLength(2500);
    expect(valueOfRow(r.values, r.rows[999]!)).toBe('999');
  });
  it('past 16 Mi characters the copy of all is off, the rows that fit still copy', () => {
    const big = readDocument(
      JSON.stringify(['x'.repeat(6_000_000), 'y'.repeat(6_000_000), 'z'.repeat(6_000_000), 'w']),
    );
    if (!big.ok) throw new Error();
    const r = runQuery('$[*]', big.root);
    if (!r.ok) throw new Error();
    expect(r.valuesComplete).toBe(false);
    expect(valueOfRow(r.values, r.rows[1]!)).toHaveLength(6_000_002);
    expect(r.rows[2]!.at).toBeNull();
    expect(r.rows[3]!.at).toBeNull();
    expect(r.paths).toBe('$[0]\n$[1]\n$[2]\n$[3]');
  });
  it('marks a path with a lone surrogate', () => {
    const lone = readDocument('{"\\ud800":1}');
    if (!lone.ok) throw new Error();
    const r = runQuery('$.*', lone.root);
    expect(r).toMatchObject({ ok: true, lonePath: true, paths: "$['\\ud800']" });
    expect(parseQuery("$['\\ud800']").ok).toBe(false);
  });
  it('counts', () => {
    expect([0, 1, 2, 1234, 1_000_000].map(resultCountText)).toEqual([
      'No results',
      '1 result',
      '2 results',
      '1,234 results',
      '1,000,000 results',
    ]);
  });
});

describe('errors of the query (§6), with their places', () => {
  const rows: Array<[string, string, number, number]> = [
    ['$.a ', 'spaces are not allowed after the query', 3, 4],
    [' $.a', 'spaces are not allowed before the query', 0, 1],
    ['a.b', 'a query starts with $ (the root node)', 0, 1],
    ['@.a', '@ is the current node, used inside a filter: a query starts with $', 0, 1],
    ['$.a.', 'unexpected end of the query: expected a member name or * after "."', 4, 4],
    ['$.1', 'unexpected "1": expected a member name or * after "."', 2, 3],
    ['$. a', 'unexpected " ": expected a member name or * after "."', 2, 3],
    ['$..', 'unexpected end of the query: expected a member name, * or [ after ".."', 3, 3],
    ['$a', 'unexpected "a": expected a segment (.name, [selector] or ..)', 1, 2],
    ['$[]', 'unexpected "]": expected a selector: a quoted name, *, an index, a slice or a filter', 2, 3],
    ['$[0 1]', 'unexpected "1": expected "," or "]"', 4, 5],
    ['$[0', 'unexpected end of the query: expected "," or "]"', 3, 3],
    ["$['a", "unterminated string: the closing ' is missing", 2, 4],
    ['$["a\\x"]', 'invalid escape "\\x"', 4, 6],
    ["$['\\\"']", 'invalid escape "\\""', 3, 5],
    ['$["\\u12"]', 'invalid \\u escape: 4 hex digits expected', 3, 7],
    ['$["\\uD800"]', 'invalid \\u escape: a lone surrogate is not a character', 3, 9],
    ['$["a\tb"]', 'control character U+0009 in a string: write it as \\t', 4, 5],
    ['$[01]', 'leading zeros are not allowed', 2, 4],
    ['$[-0]', '-0 is not an index', 2, 4],
    ['$[9007199254740992]', 'the index is outside the interoperable range −(2^53 − 1) to 2^53 − 1', 2, 18],
    ['$[1.0]', 'an index is an integer: no fraction or exponent', 2, 5],
    ['$[-]', 'expected a digit after "-"', 3, 4],
    ['$[?]', 'expected a filter expression after "?"', 3, 4],
    ['$[?@.a=1]', 'use == to compare', 6, 7],
    ['$[?@.a & @.b]', 'use && for "and"', 7, 8],
    ['$[?@.a | @.b]', 'use || for "or"', 7, 8],
    [
      '$[?@.*==1]',
      'this query can select several nodes, so it cannot be compared: only names and indexes (@.a, @[0]) may be compared',
      3,
      6,
    ],
    ['$[?!@.a==1]', '! applies to a query, a function or a parenthesis, not to a comparison: write !(…)', 3, 4],
    ['$[?true]', 'a literal alone is not a test: compare it, or test a query such as @.a', 3, 7],
    ['$[?foo(@)]', 'unknown function "foo": the functions are length, count, match, search and value', 3, 6],
    ['$[?length (@)==1]', 'no space is allowed between a function name and "("', 9, 10],
    ['$[?length==1]', 'expected "(" after length: it is a function', 9, 10],
    ['$[?length(@.a, 1)==1]', 'length() takes 1 argument, not 2', 3, 17],
    ['$[?match(@.a)]', 'match() takes 2 arguments, not 1', 3, 13],
    ['$[?True]', 'literals are lowercase: true, false, null', 3, 7],
    ['$[?@.a==01]', 'leading zeros are not allowed', 8, 10],
    ['$[?@.a==1.]', 'expected a digit after "."', 10, 11],
    ['$[?@.a==1e]', 'expected a digit in the exponent', 10, 11],
    ['$[?@.a==+1]', 'unexpected "+": expected a value to compare with', 8, 9],
    ['$[?@.a ==]', 'unexpected "]": expected a value to compare with', 9, 10],
    ['$[?@.a==', 'unexpected end of the query: expected a value to compare with', 8, 8],
    ['$[?(@.a]', 'unexpected "]": expected ")"', 7, 8],
    ['$[\u{a0}0]', 'unexpected U+00A0 (an invisible character)', 2, 3],
    ['$[?length(@)]', 'length() gives a value, not true or false: compare it, as in length(@.a) > 2', 3, 12],
    ['$[?count(@.a == 1) > 0]', 'count() takes a query, not a logical expression', 9, 17],
    ['$[?length(match(@, "a")) > 0]', 'length() takes a value: match() gives true or false', 10, 23],
    ['$[?value(length(@)) > 0]', 'value() takes a query, not a function call', 9, 18],
  ];
  it.each(rows)('%s → %s', (query, message, start, end) => {
    expect(error(query)).toEqual({ message, start, end });
  });
  it('nesting deeper than 64 levels, and a query over 10,000 characters', () => {
    expect(parseQuery(`$[?${'('.repeat(63)}@${')'.repeat(63)}]`).ok).toBe(true);
    expect(error(`$[?${'('.repeat(64)}@${')'.repeat(64)}]`).message).toBe('the query is nested deeper than 64 levels');
    expect(error(`$${'.a'.repeat(5001)}`)).toEqual({
      message: 'The query is longer than 10,000 characters.',
      start: -1,
      end: -1,
    });
    expect(parseQuery(`$${'.a'.repeat(4999)}`).ok).toBe(true);
  });
  it('the error text and the echo of the query', () => {
    expect(errorText({ message: 'x', start: 6, end: 7 })).toBe('Position 7: x');
    expect(errorText({ message: 'The query is longer than 10,000 characters.', start: -1, end: -1 })).toBe(
      'The query is longer than 10,000 characters.',
    );
    expect(errorExcerpt('$[?@.a=1]', { message: '', start: 6, end: 7 })).toEqual({
      before: '$[?@.a',
      marked: '=',
      after: '1]',
      cutStart: false,
      cutEnd: false,
    });
    const long = `$${'.abc'.repeat(30)}.`;
    const e = errorExcerpt(long, error(long));
    expect(e).toMatchObject({ marked: '', after: '', cutStart: true, cutEnd: false });
    expect(e.before).toHaveLength(30);
    expect(shortQuery('$'.repeat(70))).toHaveLength(60);
  });
  it('whitespace where the grammar allows it', () => {
    for (const ok of [
      '$ .a',
      '$[ 0 , 1 ]',
      '$[ 1 : 2 : 1 ]',
      '$[? @.a == 1 ]',
      '$[?( @.a )]',
      '$[?! @.a]',
      '$[?length( @ ) == 1]',
      '$\t[0]',
      '$.a\n.b',
    ])
      expect(parseQuery(ok).ok, ok).toBe(true);
  });
});

describe('the evaluator’s limits', () => {
  it('a document as deep as the scanner allows: no recursion', () => {
    const deep = readDocument(`${'['.repeat(1000)}${']'.repeat(1000)}`);
    if (!deep.ok) throw new Error();
    const all = evaluate((parseQuery('$..*') as { ok: true; query: never }).query, deep.root);
    expect(all.ok && all.nodes.length).toBe(999);
    const eq = evaluate((parseQuery('$..[?@ == @]') as { ok: true; query: never }).query, deep.root);
    expect(eq.ok && eq.nodes.length).toBe(999);
    const chain = readDocument(`${'{"a":'.repeat(1000)}1${'}'.repeat(1000)}`);
    if (!chain.ok) throw new Error();
    const a = runQuery('$..a', chain.root);
    expect(a.ok && a.count).toBe(1000);
    expect(a.ok && a.rows[999]!.path).toBe(`$${"['a']".repeat(1000)}`);
  });
  it('a node list over 1,000,000 stops with a message', () => {
    const deep = readDocument(`${'['.repeat(600)}${']'.repeat(600)}`);
    if (!deep.ok) throw new Error();
    const r = evaluate((parseQuery('$..*..*..*') as { ok: true; query: never }).query, deep.root);
    expect(r).toEqual({ ok: false, message: TOO_MANY_NODES });
  });
  it('$..* is linear in the document', () => {
    const make = (n: number) => {
      const d = readDocument(
        JSON.stringify(Array.from({ length: n }, (_, k) => ({ id: k, tags: ['a', 'b'], o: { x: k } }))),
      );
      if (!d.ok) throw new Error();
      return d.root;
    };
    const query = (parseQuery('$..*') as { ok: true; query: never }).query;
    const time = (root: ReturnType<typeof make>) => {
      const ms: number[] = [];
      for (let k = 0; k < 3; k++) {
        const t = performance.now();
        evaluate(query, root);
        ms.push(performance.now() - t);
      }
      return ms.sort((x, y) => x - y)[1]!;
    };
    const small = make(5_000);
    const large = make(40_000);
    time(small);
    // Eight times the document: a linear evaluator takes about eight times as long; quadratic would be 64.
    expect(time(large) / Math.max(time(small), 0.5)).toBeLessThan(30);
  });
});

describe('notes', () => {
  it('about a pattern literal that is not an I-Regexp', () => {
    const parsed = parseQuery("$[?match(@.a, '\\\\d+') || search(@.b, '(?:x)') || match(@.c, '[a-z]')]");
    if (!parsed.ok) throw new Error(parsed.error.message);
    expect(queryNotes(parsed.query)).toEqual([
      "The pattern '\\\\d+' of match() is not an I-Regexp (RFC 9485): \\d is not part of it (write [0-9]), so match() is false for every node.",
      "The pattern '(?:x)' of search() is not an I-Regexp (RFC 9485): (?…) groups are not part of it, so search() is false for every node.",
    ]);
  });
  it('about the document', () => {
    const d = readDocument('{"a":1,"a":12345678901234567890,"b":{"c":1,"c":2}}');
    if (!d.ok) throw new Error();
    expect(documentNotes(d.notes)).toEqual([
      '2 duplicate keys, the first: "a" at line 1, column 8. A name selector selects every member with its name.',
      '1 number is kept as written and compared exactly: JSON.parse in JavaScript would change it.',
    ]);
    const one = readDocument('\u{feff}[1e400, 2e400, {"x":0,"x":1}]');
    if (!one.ok) throw new Error();
    expect(documentNotes(one.notes)).toEqual([
      'A byte order mark (U+FEFF) at the start was skipped (RFC 8259 §8.1).',
      'Duplicate key "x" at line 1, column 24: a name selector selects every member with this name.',
      '2 numbers are kept as written and compared exactly: JSON.parse in JavaScript would change them.',
    ]);
  });
});

describe('detectJsonQuery (§7)', () => {
  it('recognises a pasted query and nothing else', () => {
    for (const yes of ['$.store.book[*].author', '$..author', '$[0]', "$['a b']", '$[?@.price < 10]', '$..*'])
      expect(detectJsonQuery(yes), yes).toBe(true);
    for (const no of [
      '$',
      '$.',
      '$ .a',
      ' $.a',
      '$.a ',
      '$HOME',
      '$1.50',
      '$.50',
      '${name}',
      '$_',
      '$this->x',
      '$A$1',
      "$('div')",
      '$.ajax(...)',
      '{"a":1}',
      '[1,2]',
      'a.b.c',
      '@.a',
      `$${'.a'.repeat(500)}`,
      '$.a\n.b',
    ])
      expect(detectJsonQuery(no), no).toBe(false);
  });
});
