import { HOSTILE_KEYS, hostileInput } from './examples';
import { DEFAULT_OPTIONS, LIVE_INPUT, describeNotes, inferShape, jsonToCode, numberKind } from './logic';
import { describe, expect, it } from 'vitest';
import type { CodeOptions, Language } from './logic';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

// What docs/tools/specs/json-to-code.md §5 states and §10 misses, per language; keys that try to break out of a
// literal; depth and size. Every output below also compiled (compile.test.ts with JSON_TO_CODE_COMPILE=1).

const code = (text: string, options: Partial<CodeOptions> = {}): string => {
  const result = jsonToCode(text, { ...DEFAULT_OPTIONS, ...options });
  if (!result.ok) throw new Error(`${result.error.line}:${result.error.column} ${result.error.message}`);
  return result.text;
};
const LANGUAGES: Language[] = ['typescript', 'go', 'rust', 'python'];
const all = (text: string) => Object.fromEntries(LANGUAGES.map(language => [language, code(text, { language })]));

describe('§5 «Слияние»: merging across elements and samples', () => {
  it('objects of one position merge, keys in the order of their first appearance', () => {
    expect(code('[{"b":1,"a":1},{"c":1,"a":2}]')).toBe(
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  b?: number;\n  a: number;\n  c?: number;\n}\n',
    );
  });
  it('an empty object among others counts as an object without the keys', () => {
    expect(code('[{}, {"a":1}]')).toContain('  a?: number;\n');
  });
  it('arrays of one position merge their elements', () => {
    expect(code('{"a":[1]} {"a":["x"]} {"a":[]}')).toContain('  a: (string | number)[];\n');
  });
  it('an empty array or object elsewhere decides nothing', () => {
    expect(code('{"a":[],"m":{}} {"a":[1],"m":{"k":"v"}}')).toBe(
      'export interface Root {\n  a: number[];\n  m: M;\n}\n\nexport interface M {\n  k?: string;\n}\n',
    );
  });
  it('the widest number kind wins: i64 < u64 < fractional', () => {
    const out = all('[{"n":1},{"n":12345678901234567890}]');
    expect(out.go).toContain('\tN uint64 `json:"n"`');
    expect(out.rust).toContain('    pub n: u64,');
    expect(all('[{"n":1},{"n":12345678901234567890},{"n":1.5}]').rust).toContain('    pub n: f64,');
  });
  it('a mixed position: unions in TypeScript and Python in their order, any value in Go and Rust', () => {
    const out = all('{"v":[null,[1],{"a":1},true,2,"s"]}');
    expect(out.typescript).toContain('  v: (string | number | boolean | VItem | number[] | null)[];\n');
    expect(out.python).toContain('    v: list[str | int | bool | VItem | list[int] | None]\n');
    expect(out.go).toBe('type Root struct {\n\tV []any `json:"v"`\n}\n');
    expect(out.rust).toContain('    pub v: Vec<serde_json::Value>,\n}\n');
    // An object seen only where Go and Rust write "any value" is not declared there.
    expect(out.rust).not.toContain('VItem');
  });
  it('optional and nullable of every kind', () => {
    const out = all('[{"o":{"k":1},"a":[1],"m":{},"u":null,"x":1},{"o":null,"a":null,"m":null,"u":null}]');
    expect(out.typescript).toContain(
      '  o: O | null;\n  a: number[] | null;\n  m: Record<string, unknown> | null;\n  u: null;\n  x?: number;\n',
    );
    expect(out.go).toContain(
      '\tO *O             `json:"o"`\n\tA []int64        `json:"a"`\n\tM map[string]any `json:"m"`\n\tU any            `json:"u"`\n\tX int64          `json:"x,omitempty"`\n',
    );
    expect(out.rust).toContain(
      '    pub o: Option<O>,\n    pub a: Option<Vec<i64>>,\n    pub m: Option<serde_json::Map<String, serde_json::Value>>,\n    pub u: serde_json::Value,\n    #[serde(skip_serializing_if = "Option::is_none")]\n    pub x: Option<i64>,\n',
    );
    expect(out.python).toContain(
      '    o: O | None\n    a: list[int] | None\n    m: dict[str, Any] | None\n    u: None\n    x: NotRequired[int]\n',
    );
  });
  it('an optional key that is only ever null or mixed', () => {
    expect(all('[{"a":null},{}]').rust).toContain(
      '    #[serde(skip_serializing_if = "Option::is_none")]\n    pub a: Option<serde_json::Value>,\n',
    );
    expect(all('[{"a":1},{"a":"x"},{}]').typescript).toContain('  a?: string | number;\n');
    expect(all('[{"a":1},{"a":"x"},{}]').go).toContain('\tA any `json:"a,omitempty"`\n');
  });
  it('a nullable element: (T | null)[] and its forms', () => {
    const out = all('{"t":["a",null]}');
    expect(out.typescript).toContain('  t: (string | null)[];');
    expect(out.go).toContain('\tT []*string `json:"t"`');
    expect(out.rust).toContain('    pub t: Vec<Option<String>>,');
    expect(out.python).toContain('    t: list[str | None]');
  });
});

describe('§5 п. 4: numbers judged from their text', () => {
  it('integers, their width, fractions', () => {
    expect(numberKind('0')).toBe('i64');
    expect(numberKind('-5')).toBe('i64');
    expect(numberKind('9007199254740993')).toBe('i64'); // beyond 2^53: still an integer
    expect(numberKind('9223372036854775807')).toBe('i64');
    expect(numberKind('-9223372036854775808')).toBe('i64');
    expect(numberKind('9223372036854775808')).toBe('u64');
    expect(numberKind('18446744073709551615')).toBe('u64');
    expect(numberKind('18446744073709551616')).toBe('f64'); // beyond 64 bits
    expect(numberKind('-9223372036854775809')).toBe('f64');
    expect(numberKind('123456789012345678901234567890')).toBe('f64');
    expect(numberKind('1.0')).toBe('f64');
    expect(numberKind('1e3')).toBe('f64');
    expect(numberKind('1E400')).toBe('f64');
    expect(numberKind('2E-3')).toBe('f64');
  });
  it('-0 is fractional: serde_json reads it as -0.0 and refuses it for i64 (§15)', () => {
    expect(numberKind('-0')).toBe('f64');
    expect(all('{"z":-0}').go).toContain('\tZ float64 `json:"z"`');
  });
  it('TypeScript writes number for every kind, Python int for both integer kinds', () => {
    const out = all('{"a":9223372036854775808,"b":1,"c":1.5}');
    expect(out.typescript).toContain('  a: number;\n  b: number;\n  c: number;\n');
    expect(out.python).toContain('    a: int\n    b: int\n    c: float\n');
  });
});

describe('§5 «Имена»: names', () => {
  it('Root type: words in PascalCase, Root without words, reserved names numbered', () => {
    expect(code('{"a":1}', { rootName: '---' })).toMatch(/^export interface Root \{/);
    expect(code('{"a":1}', { rootName: '  ' })).toMatch(/^export interface Root \{/);
    expect(code('{"a":1}', { rootName: 'api_response' })).toMatch(/^export interface ApiResponse \{/);
    expect(code('{"a":1}', { rootName: 'api_response', language: 'go' })).toMatch(/^type APIResponse struct \{/);
    expect(code('{"a":1}', { rootName: 'record' })).toMatch(/^export interface Record2 \{/);
    expect(code('[{"a":1}]', { rootName: 'users' })).toBe(
      'export type Users = User[];\n\nexport interface User {\n  a: number;\n}\n',
    );
  });
  it('a root that is an object or something else: the object is named after the root, numbered', () => {
    expect(code('{"a":1} null')).toBe(
      'export type Root = Root2 | null;\n\nexport interface Root2 {\n  a: number;\n}\n',
    );
    expect(code('{"a":1} null', { language: 'go' })).toBe(
      'type Root *Root2\n\ntype Root2 struct {\n\tA int64 `json:"a"`\n}\n',
    );
    expect(code('{"a":1} "x"', { language: 'go' })).toBe('type Root any\n');
    expect(code('{"a":1} "x"', { language: 'python' })).toBe(
      'from typing import TypedDict\n\n\nclass Root2(TypedDict):\n    a: int\n\n\nRoot = str | Root2\n',
    );
  });
  it('type names: a digit first gets Type, Go writes initialisms, Serialize and Deserialize are reserved (§15)', () => {
    const out = all('{"2fa":{"a":1},"http_server":{"b":1},"serialize":{"c":1},"deserialize":{"d":1}}');
    expect(out.typescript).toContain(
      '  "2fa": Type2fa;\n  http_server: HttpServer;\n  serialize: Serialize2;\n  deserialize: Deserialize2;\n',
    );
    expect(out.go).toContain('\tHTTPServer  HTTPServer   `json:"http_server"`\n');
    expect(out.go).toContain('type HTTPServer struct {');
  });
  it('the same number in every form of a name', () => {
    expect(code('{"api":{"a":1},"x":{"api":{"b":1}}}', { language: 'go' })).toContain('type API2 struct');
    expect(code('{"api":{"a":1},"x":{"api":{"b":1}}}')).toContain('export interface Api2 {');
  });
  it('the singular, again for an array in an array; a key without words', () => {
    expect(
      code(
        '{"boxes":[{"a":1}],"sizes":[{"a":1}],"series":[{"a":1}],"matrix":[[{"a":1}]],"名前":[{"a":1}],"v2":[{"a":1}]}',
      ),
    ).toContain(
      '  boxes: Box2[];\n  sizes: Size[];\n  series: Sery[];\n  matrix: MatrixItemItem[][];\n  "名前": TypeItem[];\n  v2: V2Item[];\n',
    );
    expect(code('{"名前":{"a":1}}')).toContain('  "名前": Type;\n');
  });
  it('a structure repeated deeper under the same name is shared, its parts too', () => {
    expect(code('{"a":{"b":{"x":1}},"c":{"a":{"b":{"x":1}}}}')).toBe(
      'export interface Root {\n  a: A;\n  c: C;\n}\n\nexport interface A {\n  b: B;\n}\n\nexport interface B {\n  x: number;\n}\n\nexport interface C {\n  a: A;\n}\n',
    );
  });
  it('the same keys with another optional key or another type are another type', () => {
    expect(code('{"a":{"u":[{"x":1},{}]},"b":{"u":[{"x":1}]}}')).toContain('export interface UItem2 {');
    expect(code('{"a":{"u":{"x":1}},"b":{"u":{"x":"1"}}}')).toContain('export interface U2 {');
  });
  it('Go field names: initialisms, UTF8, collisions numbered', () => {
    expect(code('{"api_url":"u","user_id":1,"utf8":"x","xml_http_request":"r"}', { language: 'go' })).toContain(
      '\tAPIURL         string `json:"api_url"`\n\tUserID         int64  `json:"user_id"`\n\tUTF8           string `json:"utf8"`\n\tXMLHTTPRequest string `json:"xml_http_request"`\n',
    );
    expect(code('{"firstName":1,"first_name":2,"":3,"_":4}', { language: 'go' })).toContain(
      '\tFirstName  int64 `json:"firstName"`\n\tFirstName2 int64 `json:"first_name"`\n\tField      int64 `json:""`\n\tField2     int64 `json:"_"`\n',
    );
  });
  it('Go: the key "-" is "-," — "-" alone would mean "skip this field"', () => {
    expect(code('{"-":1}', { language: 'go' })).toContain('\tField int64 `json:"-,"`');
    expect(code('[{"-":1},{}]', { language: 'go' })).toContain('\tField int64 `json:"-,omitempty"`');
  });
  it('Rust field names: keywords raw, self/Self/super/crate with _, digits joined (§15), collisions numbered', () => {
    expect(
      code('{"self":1,"Self":2,"super":3,"crate":4,"type":5,"Type":6,"gen":7,"sha256":8,"max_i64":9}', {
        language: 'rust',
      }),
    ).toContain(
      '    #[serde(rename = "self")]\n    pub self_: i64,\n    #[serde(rename = "Self")]\n    pub self_2: i64,\n    #[serde(rename = "super")]\n    pub super_: i64,\n    #[serde(rename = "crate")]\n    pub crate_: i64,\n    pub r#type: i64,\n    #[serde(rename = "Type")]\n    pub type_2: i64,\n    pub r#gen: i64,\n    pub sha256: i64,\n    pub max_i64: i64,\n',
    );
  });
  it('Rust: rename before skip_serializing_if, in one attribute', () => {
    expect(code('[{"firstName":1},{}]', { language: 'rust' })).toContain(
      '    #[serde(rename = "firstName", skip_serializing_if = "Option::is_none")]\n    pub first_name: Option<i64>,\n',
    );
  });
  it('Python: soft keywords stay in the class form; a keyword or a mangled name takes the functional one (§15)', () => {
    expect(code('{"match":1,"case":2,"type":3,"_":4,"__dunder__":5}', { language: 'python' })).toContain(
      'class Root(TypedDict):\n    match: int\n    case: int\n    type: int\n    _: int\n    __dunder__: int\n',
    );
    expect(code('{"None":1}', { language: 'python' })).toContain('Root = TypedDict(\n    "Root",\n');
    expect(code('{"__secret":1}', { language: 'python' })).toContain('Root = TypedDict(\n    "Root",\n');
  });
});

describe('§5 «Языки»: layout and order', () => {
  it('Go and Rust leave out a type only a mixed position names; TypeScript and Python keep it', () => {
    const text = '{"values":[1,{"a":1}],"one":{"b":"x"}}';
    expect(code(text)).toContain('export interface Value2 {');
    expect(code(text, { language: 'python' })).toContain('class Value2(TypedDict):');
    expect(code(text, { language: 'go' })).not.toContain('Value2');
    expect(code(text, { language: 'rust' })).not.toContain('Value2');
  });
  it('Rust has no use line without a struct', () => {
    expect(code('[1]', { language: 'rust' })).toBe('pub type Root = Vec<i64>;\n');
  });
  it('Python imports what it uses, alphabetically, two blank lines after', () => {
    expect(code('[{"a":{},"b":[]},{}]', { language: 'python' })).toBe(
      'from typing import Any, NotRequired, TypedDict\n\n\nclass RootItem(TypedDict):\n    a: NotRequired[dict[str, Any]]\n    b: NotRequired[list[Any]]\n\n\nRoot = list[RootItem]\n',
    );
    expect(code('"x"', { language: 'python' })).toBe('Root = str\n');
  });
  it('Python: a class after every class it names, a shared one once', () => {
    expect(code('{"a":{"b":{"c":{"x":1}}},"d":{"c":{"x":1}}}', { language: 'python' }).match(/^class \w+/gm)).toEqual([
      'class C',
      'class B',
      'class A',
      'class D',
      'class Root',
    ]);
  });
  it('TypeScript: Export off, Declaration type, on every declaration and the alias', () => {
    expect(code('[{"a":{"b":1}}]', { declaration: 'type', exportTypes: false })).toBe(
      'type Root = RootItem[];\n\ntype RootItem = {\n  a: A;\n};\n\ntype A = {\n  b: number;\n};\n',
    );
  });
  it('JSONC: comments and trailing commas read silently, several samples among them', () => {
    const result = jsonToCode('// a log line\n{"a":1, /* b */ "b":[1,2,],}\n{"a":2}', DEFAULT_OPTIONS);
    expect(result.ok && result.text).toBe('export interface Root {\n  a: number;\n  b?: number[];\n}\n');
    expect(result.ok && result.notes.samples).toBe(2);
  });
});

describe('§5 «Заметки»', () => {
  it('several duplicates: the count and the first; a long key cut at 40 characters', () => {
    const key = 'k'.repeat(45);
    const result = jsonToCode(`{"${key}":1,"${key}":2,"b":1,"b":2}\n{"b":1,"b":"x"}`, DEFAULT_OPTIONS);
    expect(result.ok && describeNotes(result.notes)).toEqual([
      '2 samples merged: keys missing from some of them are optional.',
      `3 duplicate keys, the first: "${'k'.repeat(40)}…" at line 1, column 52: the type follows its last value, as JSON.parse does.`,
    ]);
  });
  it('the place counts UTF-16 units', () => {
    const result = jsonToCode('{"🙂":1,"🙂":2}', DEFAULT_OPTIONS);
    expect(result.ok && result.notes.duplicates[0]).toEqual({ key: '🙂', line: 1, column: 9, offset: 8 });
  });
});

describe('keys that try to break out (every language)', () => {
  const input = hostileInput();
  /** Any character a literal must not hold as itself, other than the output's own line breaks and Go's tabs. */
  const RAW = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}\p{Cs}]/u;
  const clean = (text: string) => text.replace(/[\n\t]/g, '');

  it('TypeScript: every key is one quoted property on one line', () => {
    const out = code(input);
    expect(RAW.test(clean(out))).toBe(false);
    const root = out.slice(0, out.indexOf('\n}\n'));
    expect(root.split('\n')).toHaveLength(HOSTILE_KEYS.length + 2);
    expect(out).toContain('  "a*/b": number;\n  "/* open": string;\n  "// line": boolean;\n');
    expect(out).toContain('  "q\\"uote": null;\n');
    expect(out).toContain('  "line\\nbreak": number[];\n  "cr\\rlf": CrLf;\n  "tab\\there": number;\n');
    expect(out).toContain('  "ls\\u2028ps\\u2029": string;\n  "nel\\u0085": boolean;\n  "nul\\u0000": number;\n');
    expect(out).toContain('  "bidi\\u202Ex": null;\n  "bom\\uFEFF": number[];\n  "lone\\uD800": Lone;\n');
    expect(out).toContain('  "${x}": number;\n  "\\\\u0041": string;\n');
    expect(out).toContain('  "tick`s": string;\n');
  });
  it('Go: a backtick moves the tag into a quoted literal; everything else is escaped inside the raw one', () => {
    const out = code(input, { language: 'go' });
    expect(RAW.test(clean(out))).toBe(false);
    expect(out).toContain('\tTickS     string    "json:\\"tick`s\\""\n');
    expect(out).toContain('\tField     bool      "json:\\"```\\""\n');
    expect(out).toContain('`json:"q\\"uote"`');
    expect(out).toContain('`json:"back\\\\slash"`');
    expect(out).toContain('`json:"line\\nbreak"`');
    expect(out).toContain('`json:"lone\\uFFFD"`');
    expect(out).toContain('`json:"bidi\\u202Ex"`');
    // A struct has one line per key and one tag each.
    const root = out.slice(0, out.indexOf('\n}\n'));
    expect(root.split('\n')).toHaveLength(HOSTILE_KEYS.length + 2);
  });
  it('Rust: rename strings in Rust escapes — \\u{…}, never \\b or \\uXXXX', () => {
    const out = code(input, { language: 'rust' });
    expect(RAW.test(clean(out))).toBe(false);
    expect(out).toContain('#[serde(rename = "a*/b")]');
    expect(out).toContain('#[serde(rename = "q\\"uote")]');
    expect(out).toContain('#[serde(rename = "trailing\\\\")]');
    expect(out).toContain('#[serde(rename = "ls\\u{2028}ps\\u{2029}")]');
    expect(out).toContain('#[serde(rename = "nul\\u{0}")]');
    expect(out).toContain('#[serde(rename = "bidi\\u{202E}x")]');
    expect(out).toContain('#[serde(rename = "lone\\u{FFFD}")]');
    expect(out).not.toMatch(/(?<!\\)\\u[0-9A-F]{4}/);
  });
  it('Python: the functional form, keys in escaped strings', () => {
    const out = code(input, { language: 'python' });
    expect(RAW.test(clean(out))).toBe(false);
    expect(out).toContain('        "\\"\\"\\"": float,\n        "\'\'\'": None,\n');
    expect(out).toContain('        "line\\nbreak": list[int],\n');
    expect(out).toContain('        "lone\\uD800": Lone,\n');
    expect(out).toContain('        "# hash": float,\n');
  });
  it('a non-BMP format character in each language’s long escape', () => {
    const key = '{"tag\u{E0001}":1}';
    expect(code(key)).toContain('"tag\\u{E0001}"');
    expect(code(key, { language: 'python' })).toContain('"tag\\U000E0001"');
    expect(code(key, { language: 'go' })).toContain('`json:"tag\\U000E0001"`');
    expect(code(key, { language: 'rust' })).toContain('rename = "tag\\u{E0001}"');
  });
});

/** A tree passed in directly, deeper than the scanner would let through: arrays of arrays, objects in objects. */
const deepTree = (depth: number, kind: 'array' | 'object'): JsonNode => {
  let node: JsonNode = { type: 'number', offset: 0, raw: '1' };
  for (let i = 0; i < depth; i++)
    node =
      kind === 'array'
        ? { type: 'array', offset: 0, items: [node] }
        : { type: 'object', offset: 0, entries: [{ key: 'a', raw: '"a"', offset: 0, value: node }] };
  return node;
};

describe('depth and size (§6, §12)', () => {
  it('10 000 levels: the scanner’s error at the 1 001st bracket, nothing thrown', () => {
    expect(() => jsonToCode(`${'['.repeat(10_000)}${']'.repeat(10_000)}`, DEFAULT_OPTIONS)).not.toThrow();
    const result = jsonToCode(`${'{"a":'.repeat(10_000)}1${'}'.repeat(10_000)}`, DEFAULT_OPTIONS);
    expect(!result.ok && `${result.error.column} ${result.error.message}`).toBe('5001 nesting deeper than 1000 levels');
  });
  it('1 000 levels — the scanner’s limit — in every language', () => {
    const arrays = `${'['.repeat(1000)}1${']'.repeat(1000)}`;
    expect(code(arrays)).toBe(`export type Root = number${'[]'.repeat(1000)};\n`);
    const objects = `${'{"a":'.repeat(1000)}1${'}'.repeat(1000)}`;
    for (const language of LANGUAGES) {
      const out = code(objects, { language });
      expect(out.match(/^(?:export interface|type|pub struct|class) A\d*/gm)).toHaveLength(999);
    }
  });
  it('100 000 levels handed to inferShape directly: no stack overflow, every name given', () => {
    for (const kind of ['array', 'object'] as const) {
      const shape = inferShape([deepTree(100_000, kind)], '');
      expect(shape.objects).toHaveLength(kind === 'object' ? 100_000 : 0);
    }
    expect(inferShape([deepTree(100_000, 'object')], '').objects.at(-1)!.name).toBe('A99999');
  });

  /** Median of three timings of `jsonToCode` on `text`. */
  const time = (text: string): number => {
    const runs = [0, 1, 2].map(() => {
      const start = performance.now();
      jsonToCode(text, DEFAULT_OPTIONS);
      return performance.now() - start;
    });
    return runs.sort((a, b) => a - b)[1]!;
  };
  const records = (n: number) =>
    `[${Array.from({ length: n }, (_, i) => `{"id":${i},"name":"user ${i}","score":${i}.5,"tags":["a","b"],"owner":{"login":"l${i}","since":${i}},"note":null}`).join(',')}]`;
  const nested = (n: number) => `${'{"a":'.repeat(n)}1${'}'.repeat(n)}`;
  const distinct = (n: number) => `{${Array.from({ length: n }, (_, i) => `"k${i}":{"user":{"f${i}":1}}`).join(',')}}`;

  // Linear work: eight times the input takes about eight times as long; a quadratic step would take 64 times. The
  // bound (30×) leaves room for a loaded machine and a warm-up; medians of three, after one run to warm up.
  it.each([
    ['records', records, 1000],
    ['nesting', nested, 120],
    ['names that collide', distinct, 500],
  ] as const)('linear in the input: %s', (_, make, n) => {
    time(make(n));
    const small = time(make(n));
    const large = time(make(n * 8));
    expect(large / Math.max(small, 0.05)).toBeLessThan(30);
  });

  it('a megabyte of records: one type, read in one pass', () => {
    let n = 1;
    while (records(n * 2).length <= LIVE_INPUT) n *= 2;
    const text = records(n);
    expect(text.length).toBeGreaterThan(LIVE_INPUT / 2);
    const out = code(text);
    expect(out).toBe(
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n  name: string;\n  score: number;\n  tags: string[];\n  owner: Owner;\n  note: null;\n}\n\nexport interface Owner {\n  login: string;\n  since: number;\n}\n',
    );
  });
});
