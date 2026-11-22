/**
 * The sentences of the violations (docs/tools/specs/json-schema.md §6) and the text Copy violations gives. A value in
 * a sentence is shown as written in the document: a string in its quotes, cut at 40 characters with `…`.
 */
import type { JsonNode } from '@workspace/tools-shared/json-scan';

const CUT = 40;

const cutRaw = (raw: string): string => {
  if (raw.length <= CUT + 2) return raw;
  return raw.startsWith('"') ? `${raw.slice(0, CUT + 1)}…"` : `${raw.slice(0, CUT)}…`;
};

/** What the document holds, for «got …»: `the string "8080"`, `1.5`, `true`, `null`, `an object`, `an array`. */
export const got = (node: JsonNode): string => {
  switch (node.type) {
    case 'object':
      return 'an object';
    case 'array':
      return 'an array';
    case 'string':
      return `the string ${cutRaw(node.raw)}`;
    case 'number':
      return cutRaw(node.raw);
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
  }
};

/** A value from the schema as written (an enum member, a const), cut at `limit` characters. */
export const written = (text: string, node: JsonNode, limit = 60): string => {
  const raw = rawOf(text, node);
  return raw.length > limit ? `${raw.slice(0, limit - 1)}…` : raw;
};

/** The literal text of a node: strings and numbers keep `raw`; containers are printed compactly from the tree. */
export const rawOf = (text: string, node: JsonNode): string => {
  void text;
  switch (node.type) {
    case 'string':
    case 'number':
      return node.raw;
    case 'boolean':
      return String(node.value);
    case 'null':
      return 'null';
    default:
      return compact(node, 200);
  }
};

/** A compact print of a container, stopping past `limit` characters (no recursion). */
const compact = (root: JsonNode, limit: number): string => {
  let out = '';
  const stack: Array<JsonNode | string> = [root];
  while (stack.length > 0 && out.length <= limit) {
    const x = stack.pop()!;
    if (typeof x === 'string') {
      out += x;
      continue;
    }
    if (x.type === 'object') {
      stack.push('}');
      for (let i = x.entries.length - 1; i >= 0; i--) {
        stack.push(x.entries[i]!.value);
        stack.push(`${i > 0 ? ',' : ''}${x.entries[i]!.raw}:`);
      }
      stack.push('{');
    } else if (x.type === 'array') {
      stack.push(']');
      for (let i = x.items.length - 1; i >= 0; i--) {
        stack.push(x.items[i]!);
        if (i > 0) stack.push(',');
      }
      stack.push('[');
    } else if (x.type === 'string' || x.type === 'number') out += x.raw;
    else out += x.type === 'null' ? 'null' : String(x.value);
  }
  return out;
};

const ARTICLE: Record<string, string> = {
  string: 'a string',
  integer: 'an integer',
  number: 'a number',
  object: 'an object',
  array: 'an array',
  boolean: 'a boolean',
  null: 'null',
};

/** `a string`, `a string or null`, `a string, a number or null`. */
export const typeList = (types: readonly string[]): string => {
  const words = types.map(t => ARTICLE[t] ?? t);
  return words.length <= 1 ? (words[0] ?? '') : `${words.slice(0, -1).join(', ')} or ${words[words.length - 1]}`;
};

export const plural = (n: number | string, one: string, many: string): string =>
  `${n} ${String(n) === '1' ? one : many}`;

/** How a document place is named in a list: `(root)` or the pointer. */
export const placeName = (pointer: string): string => (pointer === '' ? '(root)' : pointer);

export interface Located {
  instanceLocation: string;
  keywordLocation: string;
  message: string;
  line: number;
  column: number;
  causes?: Located[];
}

const lineOf = (v: Located, indent: string): string =>
  `${indent}${placeName(v.instanceLocation)} (line ${v.line}, column ${v.column}): ${v.message} [${v.keywordLocation}]`;

/** Copy violations: one per line, causes indented by two spaces, no line break at the end. */
export const violationsText = (violations: readonly Located[]): string => {
  const lines: string[] = [];
  const stack: Array<{ v: Located; depth: number }> = [];
  for (let i = violations.length - 1; i >= 0; i--) stack.push({ v: violations[i]!, depth: 0 });
  while (stack.length > 0) {
    const { v, depth } = stack.pop()!;
    lines.push(lineOf(v, '  '.repeat(depth)));
    const causes = v.causes ?? [];
    for (let i = causes.length - 1; i >= 0; i--) stack.push({ v: causes[i]!, depth: depth + 1 });
  }
  return lines.join('\n');
};

/** `1 violation`, `1,234 violations`. */
export const violationCount = (n: number): string => plural(n.toLocaleString('en-US'), 'violation', 'violations');
