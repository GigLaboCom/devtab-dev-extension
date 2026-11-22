import { DEFAULT_OPTIONS, describeNotes, jsonToCode, keyWords, singularWords } from './logic';
import { describe, expect, it } from 'vitest';
import type { CodeOptions, Language } from './logic';

// Every row of docs/tools/specs/json-to-code.md §10, each with the specification's expected value; `⏎` there is `\n`
// here, and every result ends with one `\n` (the specification leaves the last one out).

const code = (text: string, options: Partial<CodeOptions> = {}): string => {
  const result = jsonToCode(text, { ...DEFAULT_OPTIONS, ...options });
  if (!result.ok) throw new Error(`${result.error.line}:${result.error.column} ${result.error.message}`);
  return result.text;
};
const as =
  (language: Language) =>
  (text: string, options: Partial<CodeOptions> = {}) =>
    code(text, { ...options, language });
const ts = as('typescript');
const goOf = as('go');
const rustOf = as('rust');
const py = as('python');

const error = (text: string) => {
  const result = jsonToCode(text, DEFAULT_OPTIONS);
  if (result.ok) throw new Error('expected an error');
  return `${result.error.line}:${result.error.column} ${result.error.message}`;
};

describe('§10: one object, the four languages', () => {
  const input = '{"id":7,"name":"Ann","active":true,"score":9.5}';
  it('TypeScript', () => {
    expect(ts(input)).toBe(
      'export interface Root {\n  id: number;\n  name: string;\n  active: boolean;\n  score: number;\n}\n',
    );
  });
  it('Go, aligned as gofmt does', () => {
    expect(goOf(input)).toBe(
      'type Root struct {\n\tID     int64   `json:"id"`\n\tName   string  `json:"name"`\n\tActive bool    `json:"active"`\n\tScore  float64 `json:"score"`\n}\n',
    );
  });
  it('Python', () => {
    expect(py(input)).toBe(
      'from typing import TypedDict\n\n\nclass Root(TypedDict):\n    id: int\n    name: str\n    active: bool\n    score: float\n',
    );
  });
  it('Rust', () => {
    expect(rustOf(input)).toBe(
      'use serde::{Deserialize, Serialize};\n\n#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct Root {\n    pub id: i64,\n    pub name: String,\n    pub active: bool,\n    pub score: f64,\n}\n',
    );
  });
});

describe('§10: nested objects and arrays of objects', () => {
  it('Go: a nested object is a struct of its own; URL is an initialism', () => {
    expect(goOf('{"id":1,"owner":{"login":"ann","url":"https://x"}}')).toBe(
      'type Root struct {\n\tID    int64 `json:"id"`\n\tOwner Owner `json:"owner"`\n}\n\ntype Owner struct {\n\tLogin string `json:"login"`\n\tURL   string `json:"url"`\n}\n',
    );
  });

  const users = '[{"id":1,"email":"a@x"},{"id":2,"email":null,"phone":"1"}]';
  it('TypeScript: null and a missing key do not mix', () => {
    expect(ts(users)).toBe(
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  id: number;\n  email: string | null;\n  phone?: string;\n}\n',
    );
  });
  it('Go: a pointer for null, omitempty for a missing key', () => {
    expect(goOf(users)).toBe(
      'type Root []RootItem\n\ntype RootItem struct {\n\tID    int64   `json:"id"`\n\tEmail *string `json:"email"`\n\tPhone string  `json:"phone,omitempty"`\n}\n',
    );
  });
  it('Rust: Option for both, skip_serializing_if for the missing one', () => {
    expect(rustOf(users)).toBe(
      'use serde::{Deserialize, Serialize};\n\npub type Root = Vec<RootItem>;\n\n#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct RootItem {\n    pub id: i64,\n    pub email: Option<String>,\n    #[serde(skip_serializing_if = "Option::is_none")]\n    pub phone: Option<String>,\n}\n',
    );
  });
  it('Python: NotRequired, | None, the alias last', () => {
    expect(py(users)).toBe(
      'from typing import NotRequired, TypedDict\n\n\nclass RootItem(TypedDict):\n    id: int\n    email: str | None\n    phone: NotRequired[str]\n\n\nRoot = list[RootItem]\n',
    );
  });
});

describe('§10: several samples', () => {
  it('keys missing from some samples are optional, with the note', () => {
    const result = jsonToCode('{"id":1,"tags":["a"]}\n{"id":2,"note":"x"}', DEFAULT_OPTIONS);
    expect(result.ok && result.text).toBe(
      'export interface Root {\n  id: number;\n  tags?: string[];\n  note?: string;\n}\n',
    );
    expect(result.ok && describeNotes(result.notes)).toEqual([
      '2 samples merged: keys missing from some of them are optional.',
    ]);
  });
});

describe('§10: mixed, empty, numbers', () => {
  const values = '{"values":[1,"two",null,true]}';
  it('mixed elements', () => {
    expect(ts(values)).toContain('  values: (string | number | boolean | null)[];\n');
    expect(goOf(values)).toContain('\tValues []any `json:"values"`\n');
    expect(rustOf(values)).toContain('    pub values: Vec<serde_json::Value>,\n');
    expect(py(values)).toContain('    values: list[str | int | bool | None]\n');
  });

  const empty = '{"items":[],"meta":{}}';
  it('an empty array and an empty object', () => {
    expect(ts(empty)).toContain('  items: unknown[];\n  meta: Record<string, unknown>;\n');
    expect(goOf(empty)).toContain('\tItems []any          `json:"items"`\n\tMeta  map[string]any `json:"meta"`\n');
    expect(rustOf(empty)).toContain(
      '    pub items: Vec<serde_json::Value>,\n    pub meta: serde_json::Map<String, serde_json::Value>,\n',
    );
    expect(py(empty)).toBe(
      'from typing import Any, TypedDict\n\n\nclass Root(TypedDict):\n    items: list[Any]\n    meta: dict[str, Any]\n',
    );
  });

  const numbers = '{"a":1,"b":1.0,"c":12345678901234567890,"d":2e3,"e":-5,"f":[1,2.5]}';
  it('integers and fractions judged from the text', () => {
    const types = (text: string, field: RegExp) => [...text.matchAll(field)].map(m => m[1]);
    expect(types(goOf(numbers), /^\t\w\s+(\S+)/gm)).toEqual([
      'int64',
      'float64',
      'uint64',
      'float64',
      'int64',
      '[]float64',
    ]);
    expect(types(rustOf(numbers), /^ {4}pub \w+: (.+),$/gm)).toEqual(['i64', 'f64', 'u64', 'f64', 'i64', 'Vec<f64>']);
    expect(types(py(numbers), /^ {4}\w+: (.+)$/gm)).toEqual(['int', 'float', 'int', 'float', 'int', 'list[float]']);
  });
});

describe('§10: names', () => {
  const keys = '{"first-name":"a","2fa":true,"":0,"class":"x","self":1,"userID":"u","名前":"n"}';
  it('TypeScript quotes what is not an identifier, not reserved words', () => {
    expect(ts(keys)).toBe(
      'export interface Root {\n  "first-name": string;\n  "2fa": boolean;\n  "": number;\n  class: string;\n  self: number;\n  userID: string;\n  "名前": string;\n}\n',
    );
  });
  it('Go', () => {
    expect(goOf(keys)).toBe(
      'type Root struct {\n\tFirstName string `json:"first-name"`\n\tField2fa  bool   `json:"2fa"`\n\tField     int64  `json:""`\n\tClass     string `json:"class"`\n\tSelf      int64  `json:"self"`\n\tUserID    string `json:"userID"`\n\tField2    string `json:"名前"`\n}\n',
    );
  });
  it('Rust', () => {
    expect(rustOf(keys)).toBe(
      'use serde::{Deserialize, Serialize};\n\n#[derive(Debug, Clone, Serialize, Deserialize)]\npub struct Root {\n    #[serde(rename = "first-name")]\n    pub first_name: String,\n    #[serde(rename = "2fa")]\n    pub field_2fa: bool,\n    #[serde(rename = "")]\n    pub field: i64,\n    pub class: String,\n    #[serde(rename = "self")]\n    pub self_: i64,\n    #[serde(rename = "userID")]\n    pub user_id: String,\n    #[serde(rename = "名前")]\n    pub field_2: String,\n}\n',
    );
  });
  it('Python: the functional form', () => {
    expect(py(keys)).toBe(
      'from typing import TypedDict\n\n\nRoot = TypedDict(\n    "Root",\n    {\n        "first-name": str,\n        "2fa": bool,\n        "": int,\n        "class": str,\n        "self": int,\n        "userID": str,\n        "名前": str,\n    },\n)\n',
    );
  });
  it('Rust: a keyword is a raw identifier, without rename', () => {
    expect(rustOf('{"type":"t"}')).toContain('    pub r#type: String,\n}');
    expect(rustOf('{"type":"t"}')).not.toContain('rename');
  });
  it('a name taken by another object gets 2', () => {
    expect(ts('{"user":{"id":1},"owner":{"user":{"name":"x"}}}')).toBe(
      'export interface Root {\n  user: User;\n  owner: Owner;\n}\n\nexport interface User {\n  id: number;\n}\n\nexport interface Owner {\n  user: User2;\n}\n\nexport interface User2 {\n  name: string;\n}\n',
    );
  });
  const shared = '{"from":{"user":{"id":1}},"to":{"user":{"id":2}}}';
  it('the same structure under the same name is one type', () => {
    expect(ts(shared)).toBe(
      'export interface Root {\n  from: From;\n  to: To;\n}\n\nexport interface From {\n  user: User;\n}\n\nexport interface User {\n  id: number;\n}\n\nexport interface To {\n  user: User;\n}\n',
    );
  });
  it('Python declares what a class refers to first, the keyword key in the functional form', () => {
    expect(py(shared)).toBe(
      'from typing import TypedDict\n\n\nclass User(TypedDict):\n    id: int\n\n\nclass From(TypedDict):\n    user: User\n\n\nclass To(TypedDict):\n    user: User\n\n\nRoot = TypedDict(\n    "Root",\n    {\n        "from": From,\n        "to": To,\n    },\n)\n',
    );
  });
  it('the singular of an array key', () => {
    const text = ts(
      '{"categories":[{"a":1}],"addresses":[{"b":1}],"status":[{"c":1}],"data":[{"d":1}],"people":[{"e":1}]}',
    );
    expect(text).toContain(
      '  categories: Category[];\n  addresses: Address[];\n  status: StatusItem[];\n  data: DataItem[];\n  people: PeopleItem[];\n',
    );
  });
  it('reserved names', () => {
    expect(ts('{"record":{"a":1},"value":{"b":2}}')).toContain('  record: Record2;\n  value: Value2;\n');
  });
});

describe('§10: null and optional', () => {
  const owner = '[{"owner":{"id":1}},{"owner":null}]';
  it('a nullable object', () => {
    expect(ts(owner)).toContain('  owner: Owner | null;\n');
    expect(goOf(owner)).toContain('\tOwner *Owner `json:"owner"`\n');
    expect(rustOf(owner)).toContain('    pub owner: Option<Owner>,\n');
  });
  const both = '[{"a":1},{"a":null},{}]';
  it('optional and nullable at once', () => {
    expect(ts(both)).toContain('  a?: number | null;\n');
    expect(goOf(both)).toContain('\tA *int64 `json:"a,omitempty"`\n');
    expect(rustOf(both)).toContain('    #[serde(skip_serializing_if = "Option::is_none")]\n    pub a: Option<i64>,\n');
    expect(py(both)).toContain('    a: NotRequired[int | None]\n');
  });
  const deleted = '{"deleted_at":null}';
  it('only null', () => {
    expect(ts(deleted)).toContain('  deleted_at: null;\n');
    expect(goOf(deleted)).toContain('\tDeletedAt any `json:"deleted_at"`\n');
    expect(rustOf(deleted)).toContain('    pub deleted_at: serde_json::Value,\n');
    expect(py(deleted)).toContain('    deleted_at: None\n');
  });
  it('a date is a string', () => {
    expect(ts('{"created":"2026-11-19T10:00:00Z"}')).toContain('  created: string;\n');
  });
});

describe('§10: options and roots', () => {
  it('Root type', () => {
    expect(ts('{"id":1}', { rootName: 'user profile' })).toBe('export interface UserProfile {\n  id: number;\n}\n');
  });
  it('type declarations without export', () => {
    expect(ts('{"id":1,"tags":["a"]}', { declaration: 'type', exportTypes: false })).toBe(
      'type Root = {\n  id: number;\n  tags: string[];\n};\n',
    );
  });
  it('a string root', () => {
    expect(ts('"hello"')).toBe('export type Root = string;\n');
    expect(goOf('"hello"')).toBe('type Root string\n');
    expect(rustOf('"hello"')).toBe('pub type Root = String;\n');
    expect(py('"hello"')).toBe('Root = str\n');
  });
  it('an array of arrays', () => {
    expect(ts('[[1,2],[3]]')).toBe('export type Root = number[][];\n');
    expect(goOf('[[1,2],[3]]')).toBe('type Root [][]int64\n');
  });
  it('an empty array', () => {
    expect(ts('[]')).toBe('export type Root = unknown[];\n');
    expect(py('[]')).toBe('from typing import Any\n\n\nRoot = list[Any]\n');
  });
  it('a duplicate key: the last value, the note', () => {
    const result = jsonToCode('{"a":1,"a":"x"}', DEFAULT_OPTIONS);
    expect(result.ok && result.text).toBe('export interface Root {\n  a: string;\n}\n');
    expect(result.ok && describeNotes(result.notes)).toEqual([
      'Duplicate key "a" at line 1, column 8: the type follows its last value, as JSON.parse does.',
    ]);
  });
  it('empty and blank input: an empty result, no notes', () => {
    for (const text of ['', '  \n ']) {
      const result = jsonToCode(text, DEFAULT_OPTIONS);
      expect(result).toEqual({ ok: true, text: '', notes: { samples: 0, duplicates: [] } });
      expect(result.ok && describeNotes(result.notes)).toEqual([]);
    }
  });
});

describe('§10 and §6: errors, places counted from the start of the whole input', () => {
  it('a trailing comma is allowed silently (§3), so the error rows of §10 read with that', () => {
    // §6 and §10 say `{"a":1,}` is `1:8 trailing comma`, but §3 says trailing commas are allowed silently and the
    // scanner is called with comments allowed — which allows one trailing comma. §3 wins (§15).
    expect(ts('{"a":1,}')).toBe('export interface Root {\n  a: number;\n}\n');
    expect(ts('{\n  // a comment\n  "a": 1, /* more */\n}')).toBe('export interface Root {\n  a: number;\n}\n');
  });
  it('an error in the second sample', () => {
    expect(error('{"a":1}\n{"b":')).toMatch(/^2:6 unexpected end of input/);
    expect(error('{"a":1}\n{"b":tru}')).toBe('2:9 unexpected "}"');
  });
  it('text after a value', () => {
    expect(error('{"a":1} x')).toBe('1:9 unexpected "x"');
  });
  it('1 001 nested arrays: the depth error at the 1 001st bracket', () => {
    expect(error(`${'['.repeat(1001)}${']'.repeat(1001)}`)).toBe('1:1001 nesting deeper than 1000 levels');
  });
});

describe('§10: edge rows', () => {
  it('{} and null', () => {
    expect(ts('{}')).toBe('export type Root = Record<string, unknown>;\n');
    expect(ts('null')).toBe('export type Root = null;\n');
    expect(goOf('null')).toBe('type Root any\n');
  });
  it('two samples of different kinds', () => {
    const result = jsonToCode('1 "a"', DEFAULT_OPTIONS);
    expect(result.ok && result.text).toBe('export type Root = string | number;\n');
    expect(result.ok && describeNotes(result.notes)[0]).toMatch(/^2 samples merged/);
    expect(goOf('1 "a"')).toBe('type Root any\n');
  });
  it('non-ASCII keys', () => {
    const text = '{"名前":"n","🙂":1}';
    expect(ts(text)).toContain('  "名前": string;\n  "🙂": number;\n');
    expect(goOf(text)).toContain('\tField  string `json:"名前"`\n\tField2 int64  `json:"🙂"`\n');
    expect(rustOf(text)).toContain(
      '    #[serde(rename = "名前")]\n    pub field: String,\n    #[serde(rename = "🙂")]\n    pub field_2: i64,\n',
    );
  });
  it('__proto__ is an ordinary key', () => {
    expect(ts('{"__proto__":{"x":1}}')).toBe(
      'export interface Root {\n  __proto__: Proto;\n}\n\nexport interface Proto {\n  x: number;\n}\n',
    );
  });
  it('a key root under a root that is not an object', () => {
    expect(ts('[{"root":{"a":1}}]')).toBe(
      'export type Root = RootItem[];\n\nexport interface RootItem {\n  root: Root2;\n}\n\nexport interface Root2 {\n  a: number;\n}\n',
    );
  });
});

describe('naming helpers (§5 «Имена» п. 1, п. 3)', () => {
  it('the words of a key', () => {
    expect(keyWords('userId')).toEqual(['user', 'Id']);
    expect(keyWords('HTTPServer')).toEqual(['HTTP', 'Server']);
    expect(keyWords('v2')).toEqual(['v', '2']);
    expect(keyWords('user_id')).toEqual(['user', 'id']);
    expect(keyWords('2fa')).toEqual(['2fa']);
    expect(keyWords('名前')).toEqual([]);
    expect(keyWords('first-name')).toEqual(['first', 'name']);
    expect(keyWords('')).toEqual([]);
  });
  it('the singular', () => {
    const one = (w: string) => singularWords([w]).join(' ');
    expect(one('categories')).toBe('category');
    expect(one('ies')).toBe('ie');
    expect(one('addresses')).toBe('address');
    expect(one('boxes')).toBe('box');
    expect(one('matches')).toBe('match');
    expect(one('dishes')).toBe('dish');
    expect(one('buzzes')).toBe('buzz');
    expect(one('sizes')).toBe('size');
    expect(one('status')).toBe('status item');
    expect(one('class')).toBe('class item');
    expect(one('analysis')).toBe('analysis item');
    expect(one('users')).toBe('user');
    expect(one('s')).toBe('s item');
    expect(one('data')).toBe('data item');
    expect(singularWords(['root', 'item'])).toEqual(['root', 'item', 'item']);
  });
});
