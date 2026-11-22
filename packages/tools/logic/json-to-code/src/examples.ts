/**
 * Inputs whose output the compile check (compile.test.ts) puts through the real compilers: every valid input of
 * docs/tools/specs/json-to-code.md §10 with the options of its row, then §5's rules that §10 misses, and keys built to
 * break out of a string literal, a struct tag or a comment. Test data only: nothing of the tool imports it.
 */
import type { CodeOptions } from './logic';

export interface Example {
  name: string;
  input: string;
  options?: Partial<CodeOptions>;
}

/** Keys that try to leave a string, a tag or a comment in one of the four languages. */
export const HOSTILE_KEYS: readonly string[] = [
  'a*/b',
  '/* open',
  '// line',
  '# hash',
  'q"uote',
  "s'ingle",
  'back\\slash',
  'trailing\\',
  'tick`s',
  '```',
  '"""',
  "'''",
  'line\nbreak',
  'cr\rlf',
  'tab\there',
  'ls\u{2028}ps\u{2029}',
  'nel\u{85}',
  'nul\u{0}',
  'bidi\u{202E}x',
  'bom\u{FEFF}',
  'lone\u{D800}',
  '${x}',
  '\\u0041',
  '-',
  '',
  ' ',
  'a,b',
  '%s',
];

/** The hostile keys as one object, each holding a value of another kind, and once more nested under each other. */
export const hostileInput = (): string => {
  const values = ['1', '"s"', 'true', '1.5', 'null', '[1]', '{"x":1}'];
  const entries = HOSTILE_KEYS.map((key, i) => `${JSON.stringify(key)}:${values[i % values.length]}`);
  return `{${entries.join(',')},"nested":{${entries.join(',')}}}`;
};

export const EXAMPLES: readonly Example[] = [
  // §10, in its order.
  { name: 'scalars', input: '{"id":7,"name":"Ann","active":true,"score":9.5}' },
  { name: 'nested', input: '{"id":1,"owner":{"login":"ann","url":"https://x"}}' },
  { name: 'users', input: '[{"id":1,"email":"a@x"},{"id":2,"email":null,"phone":"1"}]' },
  { name: 'samples', input: '{"id":1,"tags":["a"]}\n{"id":2,"note":"x"}' },
  { name: 'mixed', input: '{"values":[1,"two",null,true]}' },
  { name: 'empty', input: '{"items":[],"meta":{}}' },
  { name: 'numbers', input: '{"a":1,"b":1.0,"c":12345678901234567890,"d":2e3,"e":-5,"f":[1,2.5]}' },
  { name: 'keys', input: '{"first-name":"a","2fa":true,"":0,"class":"x","self":1,"userID":"u","名前":"n"}' },
  { name: 'keyword', input: '{"type":"t"}' },
  { name: 'collision', input: '{"user":{"id":1},"owner":{"user":{"name":"x"}}}' },
  { name: 'shared', input: '{"from":{"user":{"id":1}},"to":{"user":{"id":2}}}' },
  {
    name: 'singular',
    input: '{"categories":[{"a":1}],"addresses":[{"b":1}],"status":[{"c":1}],"data":[{"d":1}],"people":[{"e":1}]}',
  },
  { name: 'reserved', input: '{"record":{"a":1},"value":{"b":2}}' },
  { name: 'nullable_object', input: '[{"owner":{"id":1}},{"owner":null}]' },
  { name: 'optional_nullable', input: '[{"a":1},{"a":null},{}]' },
  { name: 'only_null', input: '{"deleted_at":null}' },
  { name: 'date', input: '{"created":"2026-11-19T10:00:00Z"}' },
  { name: 'root_type', input: '{"id":1}', options: { rootName: 'user profile' } },
  { name: 'type_no_export', input: '{"id":1,"tags":["a"]}', options: { declaration: 'type', exportTypes: false } },
  { name: 'string_root', input: '"hello"' },
  { name: 'matrix', input: '[[1,2],[3]]' },
  { name: 'empty_array', input: '[]' },
  { name: 'duplicate', input: '{"a":1,"a":"x"}' },
  { name: 'empty_object', input: '{}' },
  { name: 'null_root', input: 'null' },
  { name: 'two_kinds', input: '1 "a"' },
  { name: 'non_ascii', input: '{"名前":"n","🙂":1}' },
  { name: 'proto', input: '{"__proto__":{"x":1}}' },
  { name: 'root_key', input: '[{"root":{"a":1}}]' },
  // §5 beyond §10.
  { name: 'jsonc', input: '// a log line\n{"a":1, /* b */ "b":[1,2,],}\n{"a":2}' },
  { name: 'mixed_object', input: '{"values":[1,{"a":1}],"one":{"b":"x"}}' },
  { name: 'object_or_null_root', input: '{"a":1} null' },
  { name: 'object_or_string_root', input: '{"a":1} "x"' },
  { name: 'nullable_array', input: '[{"tags":["a"]},{"tags":null},{"tags":[null]}]' },
  { name: 'nullable_empty', input: '[{"m":{},"l":[]},{"m":null,"l":null}]' },
  { name: 'optional_value', input: '[{"a":null},{}]' },
  { name: 'optional_mixed', input: '[{"a":1},{"a":"x"},{}]' },
  {
    name: 'integer_edges',
    input:
      '{"max_i64":9223372036854775807,"min_i64":-9223372036854775808,"above_i64":9223372036854775808,"max_u64":18446744073709551615,"above_u64":18446744073709551616,"below_i64":-9223372036854775809,"neg_zero":-0,"exp":1e3,"beyond_2_53":9007199254740993}',
  },
  { name: 'widening', input: '[{"n":1},{"n":12345678901234567890},{"n":1.5}]' },
  {
    name: 'rust_keywords',
    input: '{"self":1,"Self":2,"super":3,"crate":4,"type":5,"Type":6,"gen":7,"async":8,"match":9}',
  },
  { name: 'python_keywords', input: '{"match":1,"case":2,"type":3,"_":4,"None":5}' },
  { name: 'python_mangled', input: '{"__secret":1,"__dunder__":2}' },
  {
    name: 'field_collisions',
    input: '{"firstName":1,"first_name":2,"FIRST-NAME":3,"field":4,"":5,"field_2":6,"Field2":7}',
  },
  { name: 'go_initialisms', input: '{"api_url":"u","user_id":1,"http_server":"h","utf8":"x","xml_http_request":"r"}' },
  { name: 'type_names', input: '{"2fa":{"a":1},"http_server":{"b":1},"serialize":{"c":1},"deserialize":{"d":1}}' },
  {
    name: 'more_singular',
    input:
      '{"boxes":[{"a":1}],"sizes":[{"a":1}],"series":[{"a":1}],"matrix":[[{"a":1}]],"名前":[{"a":1}],"v2":[{"a":1}]}',
  },
  { name: 'deep_shared', input: '{"a":{"b":{"x":1}},"c":{"a":{"b":{"x":1}}}}' },
  { name: 'hostile', input: hostileInput() },
  {
    name: 'hostile_options',
    input: hostileInput(),
    options: { declaration: 'type', exportTypes: false },
  },
];
