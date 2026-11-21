/**
 * docs/tools/specs/yaml-json.md §10, row by row (the row's input in the test name where it is short), plus what §5 and
 * §6 state and §10 misses. `⏎` of the specification is `\n` here; JSON is minified where the row does not say otherwise.
 */
import { jsonToYaml, yamlToJson } from './convert';
import { describeNotes } from './notes';
import { describe, expect, it } from 'vitest';
import type { Layout } from './json-scan';
import type { ConvertResult, YamlVersion } from './types';

const y2j = (text: string, version: YamlVersion = '1.2', layout: Layout = 'minify'): ConvertResult =>
  yamlToJson(text, { version, layout });
const j2y = (text: string, indent: 2 | 4 = 2): ConvertResult => jsonToYaml(text, { indent });

const ok = (result: ConvertResult): string => {
  if (!result.ok) throw new Error(`expected a result, got ${JSON.stringify(result.error)}`);
  return result.text;
};
const err = (result: ConvertResult): string => {
  if (result.ok) throw new Error(`expected an error, got ${JSON.stringify(result.text)}`);
  const { line, column, message } = result.error;
  return `${line}:${column} ${message}${result.moreErrors ? ` (and ${result.moreErrors} more)` : ''}`;
};
const notesOf = (result: ConvertResult) => {
  if (!result.ok) throw new Error('expected a result');
  return result.notes;
};

const SCALARS = (n: 'n' | 'm') =>
  `a: yes\nb: no\nc: on\nd: off\ne: y\nf: 1:20\ng: 010\nh: 0o10\ni: 0x1F\nj: ~\nk: 2024-01-15\n${n}: +12\no: 1_000\np: 0b101\nr: Yes\ns: TRUE\nt: 1e3\nu: 1.0\nv: .5\nw: -0`;

describe('§10 YAML → JSON', () => {
  it('a manifest-like document', () => {
    expect(ok(y2j('name: demo\nport: 8080\ntags: [a, b]\nnested:\n  ok: true\n  none: null'))).toBe(
      '{"name":"demo","port":8080,"tags":["a","b"],"nested":{"ok":true,"none":null}}',
    );
  });

  it('2 spaces', () => {
    expect(ok(y2j('a: 1\nb: [x]', '1.2', 2))).toBe('{\n  "a": 1,\n  "b": [\n    "x"\n  ]\n}');
  });

  it('the scalars YAML 1.2 reads (core schema)', () => {
    expect(ok(y2j(SCALARS('n')))).toBe(
      '{"a":"yes","b":"no","c":"on","d":"off","e":"y","f":"1:20","g":10,"h":8,"i":31,"j":null,"k":"2024-01-15","n":12,"o":"1_000","p":"0b101","r":"Yes","s":true,"t":1e3,"u":1.0,"v":0.5,"w":-0}',
    );
  });

  it('the same scalars in YAML 1.1', () => {
    expect(ok(y2j(SCALARS('m'), '1.1'))).toBe(
      '{"a":true,"b":false,"c":true,"d":false,"e":true,"f":80,"g":8,"h":"0o10","i":31,"j":null,"k":"2024-01-15","m":12,"o":1000,"p":5,"r":true,"s":true,"t":1e3,"u":1.0,"v":0.5,"w":-0}',
    );
  });

  it('the key n in 1.1 stays "n" (the library itself would make it "false")', () => {
    expect(ok(y2j('n: 1\nkey: value', '1.1'))).toBe('{"n":1,"key":"value"}');
  });

  it('%YAML 1.1 in the document is stronger than the 1.2 option; dates stay strings', () => {
    expect(ok(y2j('%YAML 1.1\n---\na: yes\nd: 2024-01-15', '1.2'))).toBe('{"a":true,"d":"2024-01-15"}');
  });

  it('%YAML 1.2 in the document is stronger than the 1.1 option', () => {
    expect(ok(y2j('%YAML 1.2\n---\na: yes', '1.1'))).toBe('{"a":"yes"}');
  });

  it('numbers beyond a double are kept as written, 3 inexact', () => {
    const result = y2j(
      'a: 12345678901234567890\nb: 9007199254740993\nc: 0.1000000000000000055511151231257827\nd: 1.50\ne: 1e400',
    );
    expect(ok(result)).toBe(
      '{"a":12345678901234567890,"b":9007199254740993,"c":0.1000000000000000055511151231257827,"d":1.50,"e":1e400}',
    );
    expect(notesOf(result).inexactNumbers).toBe(3);
  });

  it('.inf and .NaN have no JSON equivalent', () => {
    expect(err(y2j('a: 1\nb: .inf'))).toBe('2:4 .inf has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
    expect(err(y2j('x: [1, .NaN]'))).toBe('1:8 .NaN has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
  });

  it('integer-like keys keep their place (toJS would give 1, 2, b, a)', () => {
    expect(ok(y2j('b: 1\n2: 2\na: 3\n1: 4'))).toBe('{"b":1,"2":2,"a":3,"1":4}');
  });

  it('keys that are not strings are taken as written', () => {
    expect(ok(y2j('True: a\n~: b\n1.50: c\n0x1F: d\n"q": e'))).toBe(
      '{"True":"a","~":"b","1.50":"c","0x1F":"d","q":"e"}',
    );
  });

  it('two keys that become one JSON key', () => {
    expect(err(y2j('1: a\n"1": b'))).toBe('2:1 two keys become "1" in JSON');
  });

  it('keys equal in YAML: the library refuses them', () => {
    expect(err(y2j('null: a\n~: b'))).toBe('2:1 Map keys must be unique');
    expect(err(y2j('a: 1\na: 2'))).toBe('2:1 Map keys must be unique');
  });

  it('a collection as a key', () => {
    expect(err(y2j('? [a, b]\n: c'))).toBe('1:3 a key that is a mapping or a sequence has no JSON equivalent');
  });

  it('three documents become an array', () => {
    const result = y2j('a: 1\n---\nb: 2\n---\n- 3\n');
    expect(ok(result)).toBe('[{"a":1},{"b":2},[3]]');
    expect(notesOf(result).documents).toBe(3);
  });

  it('an empty document is null', () => {
    const result = y2j('---\n---\na: 1\n');
    expect(ok(result)).toBe('[null,{"a":1}]');
    expect(notesOf(result).documents).toBe(2);
  });

  it('only a comment: nothing, no error', () => {
    const result = y2j('# just a comment\n');
    expect(ok(result)).toBe('');
    expect(notesOf(result).documents).toBe(0);
  });

  it('aliases are expanded', () => {
    const result = y2j('base: &b {x: 1, y: 2}\nuse: *b\nlist: [*b, *b]');
    expect(ok(result)).toBe('{"base":{"x":1,"y":2},"use":{"x":1,"y":2},"list":[{"x":1,"y":2},{"x":1,"y":2}]}');
    expect(notesOf(result).aliasesExpanded).toBe(true);
  });

  it('a merge key: own keys win', () => {
    expect(ok(y2j('base: &b {x: 1, y: 2}\nm:\n  <<: *b\n  y: 3'))).toBe('{"base":{"x":1,"y":2},"m":{"x":1,"y":3}}');
  });

  it('a merge of a list: the earlier mapping wins', () => {
    expect(ok(y2j('a: &a {x: 1, y: 1}\nb: &b {y: 2, z: 2}\nm:\n  <<: [*a, *b]\n  w: 0'))).toBe(
      '{"a":{"x":1,"y":1},"b":{"y":2,"z":2},"m":{"x":1,"y":1,"z":2,"w":0}}',
    );
  });

  it('merged keys take the place of <<', () => {
    expect(ok(y2j('b: &b {x: 1, y: 2}\nm: {a: 0, <<: *b, z: 9}'))).toBe(
      '{"b":{"x":1,"y":2},"m":{"a":0,"x":1,"y":2,"z":9}}',
    );
  });

  it('a merge of something that is not a mapping', () => {
    expect(err(y2j('m:\n  <<: 5'))).toBe('2:7 a merge key (<<) needs a mapping or a list of mappings');
  });

  it('an alias to its own ancestor', () => {
    expect(err(y2j('a: &x\n  b: *x'))).toBe('2:6 alias *x refers to a node that contains it: JSON has no cycles');
  });

  it('an unknown alias', () => {
    expect(err(y2j('a: *nope'))).toBe('1:4 unknown alias *nope');
  });

  it('the alias bomb stops at 7:8, fast', () => {
    const lines = [`a: &a [${Array(9).fill('"lol"').join(', ')}]`];
    for (const [prev, name] of [...'abcdefgh'].map((c, i) => [c, 'bcdefghi'[i]!]))
      lines.push(`${name}: &${name} [${Array(9).fill(`*${prev}`).join(', ')}]`);
    const t0 = performance.now();
    expect(err(y2j(lines.join('\n')))).toBe(
      '7:8 aliases expand to more than 1,000,000 nodes: refusing (an alias bomb?)',
    );
    // A guard against a hang, not a speed test (the speed is measured in the browser, scripts/e2e-tools).
    expect(performance.now() - t0).toBeLessThan(10_000);
  }, 30_000);

  it('10 000 references to an object of 10 keys convert', () => {
    const keys = Array.from({ length: 10 }, (_, i) => `k${i}: value${i}`).join(', ');
    const text = `base: &b {${keys}}\nrefs:\n${'  - *b\n'.repeat(10_000)}`;
    const t0 = performance.now();
    const result = ok(y2j(text));
    const ms = performance.now() - t0;
    expect(result.length).toBeGreaterThan(1_000_000);
    expect(ms).toBeLessThan(15_000);
  }, 30_000);

  it('tags: core tags apply, unknown ones are noted and dropped, !!binary stays Base64', () => {
    const result = y2j('a: !!str 123\nb: !!int "42"\nc: !Ref Foo\nd: !Sub [x, y]\ne: !!binary aGk=');
    expect(ok(result)).toBe('{"a":"123","b":42,"c":"Foo","d":["x","y"],"e":"aGk="}');
    expect(notesOf(result).unknownTags.map(t => `${t.line}:${t.column} ${t.message}`)).toEqual([
      '3:4 !Ref',
      '4:4 !Sub',
    ]);
  });

  it('!!omap and !!set in 1.1', () => {
    expect(ok(y2j('!!omap\n- a: 1\n- b: 2', '1.1'))).toBe('[{"a":1},{"b":2}]');
    expect(ok(y2j('!!set\n? a\n? b', '1.1'))).toBe('{"a":null,"b":null}');
  });

  it('a pair in a flow sequence is an object of one key', () => {
    expect(ok(y2j('[a: 1, b]'))).toBe('[{"a":1},"b"]');
  });

  it('block scalars: literal, folded, strip', () => {
    expect(ok(y2j('lit: |\n  line1\n  line2\nfold: >\n  a\n  b\nstrip: |-\n  x\n'))).toBe(
      '{"lit":"line1\\nline2\\n","fold":"a b\\n","strip":"x"}',
    );
  });

  it('quoted scalars', () => {
    expect(ok(y2j('a: "line\\nbreak"\nb: \'it\'\'s\'\nc: "\\té"'))).toBe('{"a":"line\\nbreak","b":"it\'s","c":"\\té"}');
  });

  it('not-ASCII as is', () => {
    expect(ok(y2j('ключ: "🙂"\nemoji: 🙂'))).toBe('{"ключ":"🙂","emoji":"🙂"}');
  });

  it('a scalar document; empty values are null', () => {
    expect(ok(y2j('hello'))).toBe('"hello"');
    expect(ok(y2j('a:\nb: ~'))).toBe('{"a":null,"b":null}');
  });

  it('JSON is YAML', () => {
    expect(ok(y2j('{"a": [1, 2, {"b": null}], "c": "x"}'))).toBe('{"a":[1,2,{"b":null}],"c":"x"}');
  });

  it('CRLF and a byte order mark', () => {
    expect(ok(y2j('a: 1\r\nb: 2\r\n'))).toBe('{"a":1,"b":2}');
    expect(ok(y2j('\uFEFFa: 1'))).toBe('{"a":1}');
  });

  it.each([
    ['a:\n\tb: 1', '2:1 Tabs are not allowed as indentation'],
    ['a:\n  b: 1\n c: 2', '3:1 All mapping items must start at the same column'],
    ['a: [1, 2\nb: 3', '2:1 Flow sequence in block collection must be sufficiently indented and end with a ]'],
    ['a: "abc\nb: 1', '2:5 Missing closing "quote'],
    ['a: b: c', '1:4 Nested mappings are not allowed in compact mappings'],
    ['k: 🙂🙂\n  bad: : x\n', '1:4 Nested mappings are not allowed in compact mappings (and 2 more)'],
  ])('the library’s error with its place: %j', (input, expected) => {
    expect(err(y2j(input))).toBe(expected);
  });

  it('empty input: nothing, no error', () => {
    expect(ok(y2j(''))).toBe('');
  });
});

describe('§10 JSON → YAML', () => {
  it('a manifest-like object, 2 spaces', () => {
    expect(ok(j2y('{"name":"demo","port":8080,"tags":["a","b"],"nested":{"ok":true,"none":null}}'))).toBe(
      'name: demo\nport: 8080\ntags:\n  - a\n  - b\nnested:\n  ok: true\n  none: null\n',
    );
  });

  it('4 spaces', () => {
    expect(ok(j2y('{"a":{"b":[1,{"c":2}]}}', 4))).toBe('a:\n    b:\n        - 1\n        - c: 2\n');
  });

  it('numbers and key order exactly as in JSON, 2 inexact', () => {
    const result = j2y('{"b":1,"2":2,"1":3,"id":12345678901234567890,"p":1.50,"e":1E400,"z":-0}');
    expect(ok(result)).toBe('b: 1\n"2": 2\n"1": 3\nid: 12345678901234567890\np: 1.50\ne: 1E400\nz: -0\n');
    expect(notesOf(result).inexactNumbers).toBe(2);
  });

  it('strings another YAML reader would take for something else are quoted', () => {
    expect(
      ok(
        j2y(
          '{"yes":"yes","on":"on","n":"n","time":"1:20","oct":"010","o12":"0o10","date":"2024-01-15","num":"123","empty":"","nul":"null","tilde":"~","colon":"a: b","hash":"a #b","lead":" x","dash":"- a","q":"\\"q\\"","star":"*x"}',
        ),
      ),
    ).toBe(
      '"yes": "yes"\n"on": "on"\n"n": "n"\ntime: "1:20"\noct: "010"\no12: "0o10"\ndate: "2024-01-15"\nnum: "123"\nempty: ""\nnul: "null"\ntilde: "~"\ncolon: "a: b"\nhash: "a #b"\nlead: " x"\ndash: "- a"\nq: \'"q"\'\nstar: "*x"\n',
    );
  });

  it('a multi-line string is a block; tab as is; control characters escaped; not-ASCII as is', () => {
    expect(ok(j2y('{"m":"line1\\nline2\\n","t":"a\\tb","c":"a\\u0001b","u":"привет 🙂"}'))).toBe(
      'm: |\n  line1\n  line2\nt: a\tb\nc: "a\\x01b"\nu: привет 🙂\n',
    );
  });

  it('a long line is not wrapped', () => {
    const long = `${'x'.repeat(100)} ${'y'.repeat(30)}`;
    expect(ok(j2y(JSON.stringify({ long })))).toBe(`long: ${long}\n`);
  });

  it('empty object and array', () => {
    expect(ok(j2y('{"a":{},"b":[],"c":[[]]}'))).toBe('a: {}\nb: []\nc:\n  - []\n');
  });

  it('an array, a string, a number at the top', () => {
    expect(ok(j2y('[{"a":1,"b":2},"x",null]'))).toBe('- a: 1\n  b: 2\n- x\n- null\n');
    expect(ok(j2y('"x"'))).toBe('x\n');
    expect(ok(j2y('42'))).toBe('42\n');
  });

  it('a top-level string with a leading space and a line break is double-quoted', () => {
    const yaml = ok(j2y('" x\\ny"'));
    expect(yaml).toBe('" x\\ny"\n');
    expect(ok(y2j(yaml))).toBe('" x\\ny"');
  });

  it('a duplicate key', () => {
    expect(err(j2y('{"a":1,"a":2}'))).toBe('1:8 duplicate key "a": YAML requires unique keys');
  });

  it('a trailing comma', () => {
    expect(err(j2y('{"a":1,}'))).toBe('1:8 trailing comma');
  });

  it('empty input: the scanner says so (the page shows nothing for it)', () => {
    expect(err(j2y(''))).toBe('1:1 empty input');
  });
});

describe('§5 beyond the rows of §10', () => {
  it('a number that does not fit a double survives YAML → JSON → YAML → JSON unchanged', () => {
    const yaml =
      'big: 123456789012345678901234567890\nneg: -0\nfine: 0.1000000000000000055511151231257827\nhuge: 1e400';
    const json = ok(y2j(yaml));
    const back = ok(j2y(json));
    expect(back).toBe(`${yaml}\n`);
    expect(ok(y2j(back))).toBe(json);
  });

  it('non-JSON decimals keep their digits: .5, +1.25, 1_000.5 (1.1), 5., 007.5', () => {
    expect(ok(y2j('a: .5\nb: +1.25\nc: .1000000000000000055511151231257827\nd: 007.5\ne: 1.'))).toBe(
      '{"a":0.5,"b":1.25,"c":0.1000000000000000055511151231257827,"d":7.5,"e":1.0}',
    );
    expect(ok(y2j('a: 1_000.5\nb: 1:20.5\nc: -1:00', '1.1'))).toBe('{"a":1000.5,"b":80.5,"c":-60}');
  });

  it('a hexadecimal integer beyond 2^53 is written in decimal, exactly, and counted inexact', () => {
    const result = y2j('a: 0x1FFFFFFFFFFFFFFFFF');
    expect(ok(result)).toBe('{"a":590295810358705651711}');
    expect(notesOf(result).inexactNumbers).toBe(1);
  });

  it('-.inf, .Inf, .NAN', () => {
    expect(err(y2j('a: -.inf'))).toBe('1:4 -.inf has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
    expect(err(y2j('a: .NAN'))).toBe('1:4 .NAN has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)');
  });

  it('an alias as a key takes the rule of the node it points to', () => {
    expect(ok(y2j('a: &k 0x1F\n*k : b'))).toBe('{"a":31,"0x1F":"b"}');
  });

  it('a merge from an inline mapping, nested merges in sources', () => {
    expect(ok(y2j('m:\n  <<: {a: 1}\n  b: 2'))).toBe('{"m":{"a":1,"b":2}}');
    expect(ok(y2j('a: &a {x: 1}\nb: &b {<<: *a, y: 2}\nc: {<<: *b, z: 3}'))).toBe(
      '{"a":{"x":1},"b":{"x":1,"y":2},"c":{"x":1,"y":2,"z":3}}',
    );
  });

  it('a merge of a list with something else in it', () => {
    expect(err(y2j('a: &a {x: 1}\nm:\n  <<: [*a, 3]'))).toBe(
      '3:12 a merge key (<<) needs a mapping or a list of mappings',
    );
  });

  it('an alias redefined later points to the nearest earlier anchor', () => {
    expect(ok(y2j('a: &x 1\nb: *x\nc: &x 2\nd: *x'))).toBe('{"a":1,"b":1,"c":2,"d":2}');
  });

  it('!!timestamp is an unknown tag in both versions; the date stays a string', () => {
    for (const version of ['1.1', '1.2'] as const) {
      const result = y2j('d: !!timestamp 2001-12-14', version);
      expect(ok(result)).toBe('{"d":"2001-12-14"}');
      expect(notesOf(result).unknownTags.map(t => t.message)).toEqual(['!!timestamp']);
    }
  });

  it('an unknown tag on a plain scalar reads it as if untagged', () => {
    expect(ok(y2j('a: !Ref 12\nb: !Thing true\nc: !Q "12"'))).toBe('{"a":12,"b":true,"c":"12"}');
  });

  it('a core tag that does not fit its value is refused, not passed on as text', () => {
    expect(err(y2j('a: !!int "abc"'))).toBe('1:4 the value does not fit its tag !!int');
  });

  it('!!binary over several lines loses its white space', () => {
    expect(ok(y2j('b: !!binary |\n  aGVs\n  bG8=\n', '1.1'))).toBe('{"b":"aGVsbG8="}');
  });

  it('nesting built by aliases deeper than 1000 levels', () => {
    const lines = ['l0: &l0 [x]'];
    for (let i = 1; i <= 1000; i++) lines.push(`l${i}: &l${i} [*l${i - 1}]`);
    expect(err(y2j(lines.join('\n')))).toMatch(/^\d+:\d+ nesting deeper than 1000 levels$/);
  });

  it('a chain of nested aliases whose text outgrows 64 Mi characters is refused; minified it fits', () => {
    const lines = ['l0: &l0 [x]'];
    for (let i = 1; i < 600; i++) lines.push(`l${i}: &l${i} [*l${i - 1}]`);
    const t0 = performance.now();
    expect(err(y2j(lines.join('\n'), '1.2', 2))).toMatch(
      /^\d+:\d+ the JSON would be longer than 64 Mi characters: refusing$/,
    );
    expect(performance.now() - t0).toBeLessThan(10_000);
    expect(ok(y2j(lines.join('\n'))).length).toBeGreaterThan(300_000);
  }, 30_000);

  it('flow nesting the parser cannot follow is an error, not a crash', () => {
    const text = `${'['.repeat(5000)}${']'.repeat(5000)}`;
    expect(err(y2j(text))).toMatch(/^1:\d+ nesting too deep for the YAML parser: it ran out of stack here/);
  });

  it('JSON deeper than 1000 levels is refused by the scanner', () => {
    expect(err(j2y(`${'['.repeat(1001)}${']'.repeat(1001)}`))).toBe('1:1001 nesting deeper than 1000 levels');
    expect(ok(j2y(`${'['.repeat(1000)}${']'.repeat(1000)}`)).length).toBeGreaterThan(1000);
  });

  it('Tab and 4 spaces', () => {
    expect(ok(y2j('a: [1]', '1.2', 'tab'))).toBe('{\n\t"a": [\n\t\t1\n\t]\n}');
    expect(ok(y2j('- a: 1\n- [b: 2]', '1.2', 4))).toBe(
      '[\n    {\n        "a": 1\n    },\n    [\n        {\n            "b": 2\n        }\n    ]\n]',
    );
    expect(ok(y2j('a: 1\n---\nb: {}', '1.2', 2))).toBe('[\n  {\n    "a": 1\n  },\n  {\n    "b": {}\n  }\n]');
  });

  it('JSON → YAML keeps -0, 1E400 and big integers exactly and reads back in 1.1 and 1.2', () => {
    const json = '{"a":-0,"b":1E400,"c":12345678901234567890,"d":[1.0,-1e-400]}';
    const yaml = ok(j2y(json));
    for (const version of ['1.1', '1.2'] as const) expect(ok(y2j(yaml, version))).toBe(json);
  });

  it('a JSON error has the scanner’s place and text', () => {
    expect(err(j2y('{"a" 1}'))).toBe("1:6 expected ':'");
    expect(err(j2y('[01]'))).toBe('1:2 leading zeros are not allowed');
    expect(err(j2y("{'a':1}"))).toBe('1:2 property names must be in double quotes');
  });
});

describe('describeNotes (§5 «Заметки»)', () => {
  it('YAML → JSON: in the specification’s order', () => {
    expect(
      describeNotes(
        {
          documents: 3,
          aliasesExpanded: true,
          unknownTags: [
            { message: '!Ref', offset: 0, line: 3, column: 4 },
            { message: '!Sub', offset: 0, line: 4, column: 4 },
          ],
          inexactNumbers: 2,
        },
        'yaml-to-json',
      ),
    ).toEqual([
      'JSON has no comments, anchors, tags or YAML styles: they are not carried over.',
      'Aliases were expanded and merge keys (<<) applied: JSON has no references.',
      '3 YAML documents became a JSON array of 3 items.',
      '2 unknown tags were dropped, the first: !Ref at line 3, column 4; the values are kept as plain YAML.',
      "2 numbers are kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change them.",
    ]);
  });

  it('one unknown tag, one inexact number; JSON → YAML only the numbers', () => {
    const notes = {
      documents: 1,
      aliasesExpanded: false,
      unknownTags: [{ message: '!Ref', offset: 0, line: 3, column: 4 }],
      inexactNumbers: 1,
    };
    expect(describeNotes(notes, 'yaml-to-json').slice(1)).toEqual([
      'Unknown tag !Ref at line 3, column 4 was dropped; the value is kept as plain YAML.',
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    ]);
    expect(describeNotes(notes, 'json-to-yaml')).toEqual([
      "1 number is kept as written but can't be held exactly by a double (RFC 8259 §6): JSON.parse in JavaScript would change it.",
    ]);
  });
});
