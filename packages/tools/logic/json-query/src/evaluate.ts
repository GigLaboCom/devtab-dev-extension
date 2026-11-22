/**
 * The JSONPath evaluator (docs/tools/specs/json-query.md §5 «Вычисление», «Сравнения и числа», «Функции»): walks the
 * parsed query over the shared scanner's tree (`JsonNode`: literals as written, members in the order written,
 * repeated names kept). Nothing is converted to JavaScript values: numbers compare as exact decimals (decimal.ts),
 * strings by code point.
 *
 * The document is never walked recursively: the descendant segment and deep equality keep their own stacks, so a
 * document as deep as the scanner allows (1,000 levels) costs no call stack. Recursion follows only the query's own
 * nesting, which the parser bounds (MAX_NESTING). Every node list — of a step, of a filter's query — is bounded by
 * MAX_NODES; time is bounded by the worker the page runs this in (it is terminated at the limit).
 */
import { compareNumbers } from './decimal';
import { iRegexp } from './iregexp';
import type { Argument, Call, Comparable, Literal, LogicalExpr, Query, Segment, Selector } from './parse';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export const MAX_NODES = 1_000_000;

/** A node and its place: the parent's place and the step to it (shared, so a path costs nothing until written). */
export interface Located {
  value: JsonNode;
  parent: Located | null;
  step: string | number;
}

export type Evaluation = { ok: true; nodes: Located[] } | { ok: false; message: string };

export const TOO_MANY_NODES = 'The query selects more than 1,000,000 nodes. Narrow it.';

type ObjectNode = Extract<JsonNode, { type: 'object' }>;

/** The special result `Nothing` of RFC 9535 §2.4.1: no value. */
const NOTHING = Symbol('Nothing');
type Value = JsonNode | typeof NOTHING;

class Limit {}

/** Code point order of two strings (RFC 9535 §2.3.5.2.2: Unicode scalar values, not UTF-16 units). */
const compareStrings = (a: string, b: string): number => {
  const n = Math.min(a.length, b.length);
  for (let k = 0; k < n; k++) {
    const x = a.charCodeAt(k);
    const y = b.charCodeAt(k);
    if (x === y) continue;
    // Below the surrogates, and among two surrogates, UTF-16 order is code point order; a surrogate against a unit
    // from U+E000 up is not: the surrogate's code point is the larger.
    const xs = x >= 0xd800 && x <= 0xdfff;
    const ys = y >= 0xd800 && y <= 0xdfff;
    if (xs !== ys && (xs ? y >= 0xe000 : x >= 0xe000)) return xs ? 1 : -1;
    return x < y ? -1 : 1;
  }
  return a.length - b.length;
};

/** Unicode scalar values of a string; a lone surrogate counts as one. */
const codePoints = (s: string): number => {
  let count = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c >= 0xd800 && c <= 0xdbff) {
      const d = s.charCodeAt(k + 1);
      if (d >= 0xdc00 && d <= 0xdfff) k++;
    }
    count++;
  }
  return count;
};

const literalNode = (literal: Literal): JsonNode => {
  switch (literal.type) {
    case 'string':
      return { type: 'string', offset: -1, raw: JSON.stringify(literal.value), value: literal.value };
    case 'number':
      return { type: 'number', offset: -1, raw: literal.raw };
    case 'boolean':
      return { type: 'boolean', offset: -1, value: literal.value };
    default:
      return { type: 'null', offset: -1 };
  }
};

const numberNode = (n: number): JsonNode => ({ type: 'number', offset: -1, raw: String(n) });

/** Members of an object by name; built once per large object and query. */
const INDEX_FROM = 16;

/** Deep equality of two JSON values (RFC 9535 §2.3.5.2.2), with an explicit stack. */
const equal = (a: JsonNode, b: JsonNode): boolean => {
  const stack: Array<[JsonNode, JsonNode]> = [[a, b]];
  while (stack.length > 0) {
    const [x, y] = stack.pop()!;
    if (x.type !== y.type) return false;
    switch (x.type) {
      case 'number':
        if (compareNumbers(x.raw, (y as typeof x).raw) !== 0) return false;
        break;
      case 'string':
        if (x.value !== (y as typeof x).value) return false;
        break;
      case 'boolean':
        if (x.value !== (y as typeof x).value) return false;
        break;
      case 'null':
        break;
      case 'array': {
        const items = (y as typeof x).items;
        if (x.items.length !== items.length) return false;
        for (let k = 0; k < items.length; k++) stack.push([x.items[k]!, items[k]!]);
        break;
      }
      case 'object': {
        const other = (y as typeof x).entries;
        if (x.entries.length !== other.length) return false;
        // Same names, and under each name the same values in order (repeated names: §5 п. 11).
        const byName = new Map<string, JsonNode[]>();
        for (const e of other) {
          const list = byName.get(e.key);
          if (list) list.push(e.value);
          else byName.set(e.key, [e.value]);
        }
        const seen = new Map<string, number>();
        for (const e of x.entries) {
          const list = byName.get(e.key);
          const k = seen.get(e.key) ?? 0;
          if (!list || k >= list.length) return false;
          seen.set(e.key, k + 1);
          stack.push([e.value, list[k]!]);
        }
        break;
      }
    }
  }
  return true;
};

const less = (a: JsonNode, b: JsonNode): boolean => {
  if (a.type === 'number' && b.type === 'number') return compareNumbers(a.raw, b.raw) < 0;
  if (a.type === 'string' && b.type === 'string') return compareStrings(a.value, b.value) < 0;
  return false;
};

/** RFC 9535 §2.3.5.2.2, with `Nothing` for an empty node list. */
const compare = (op: string, a: Value, b: Value): boolean => {
  const eq = (): boolean => (a === NOTHING || b === NOTHING ? a === b : equal(a, b));
  const lt = (x: Value, y: Value): boolean => x !== NOTHING && y !== NOTHING && less(x, y);
  switch (op) {
    case '==':
      return eq();
    case '!=':
      return !eq();
    case '<':
      return lt(a, b);
    case '<=':
      return lt(a, b) || eq();
    case '>':
      return lt(b, a);
    default:
      return lt(b, a) || eq();
  }
};

/** Evaluates a parsed query on a document's tree. Throws nothing: the node limit comes back as a value. */
export const evaluate = (query: Query, root: JsonNode): Evaluation => {
  const top: Located = { value: root, parent: null, step: '' };
  /** Queries from `$` inside filters do not depend on `@`: evaluated once each. */
  const absolute = new Map<Query, Located[]>();
  const patterns = new Map<string, RegExp | null>();
  const indexes = new WeakMap<ObjectNode, Map<string, number[]>>();

  const check = (list: Located[]): void => {
    if (list.length > MAX_NODES) throw new Limit();
  };

  const named = (node: ObjectNode, name: string, at: Located, out: Located[]): void => {
    const entries = node.entries;
    if (entries.length < INDEX_FROM) {
      for (const e of entries) if (e.key === name) out.push({ value: e.value, parent: at, step: name });
      return;
    }
    let index = indexes.get(node);
    if (!index) {
      index = new Map();
      for (let k = 0; k < entries.length; k++) {
        const list = index.get(entries[k]!.key);
        if (list) list.push(k);
        else index.set(entries[k]!.key, [k]);
      }
      indexes.set(node, index);
    }
    for (const k of index.get(name) ?? []) out.push({ value: entries[k]!.value, parent: at, step: name });
  };

  const children = (at: Located, out: Located[]): void => {
    const v = at.value;
    if (v.type === 'array')
      for (let k = 0; k < v.items.length; k++) out.push({ value: v.items[k]!, parent: at, step: k });
    else if (v.type === 'object') for (const e of v.entries) out.push({ value: e.value, parent: at, step: e.key });
  };

  const select = (selector: Selector, at: Located, out: Located[]): void => {
    const v = at.value;
    switch (selector.kind) {
      case 'name':
        if (v.type === 'object') named(v, selector.name, at, out);
        return;
      case 'wildcard':
        children(at, out);
        return;
      case 'index': {
        if (v.type !== 'array') return;
        const k = selector.index < 0 ? v.items.length + selector.index : selector.index;
        if (k >= 0 && k < v.items.length) out.push({ value: v.items[k]!, parent: at, step: k });
        return;
      }
      case 'slice': {
        if (v.type !== 'array') return;
        // RFC 9535 §2.3.4.2.2.
        const len = v.items.length;
        const step = selector.step ?? 1;
        if (step === 0) return;
        const norm = (k: number): number => (k >= 0 ? k : len + k);
        if (step > 0) {
          const lower = Math.min(Math.max(norm(selector.start ?? 0), 0), len);
          const upper = Math.min(Math.max(norm(selector.end ?? len), 0), len);
          for (let k = lower; k < upper; k += step) out.push({ value: v.items[k]!, parent: at, step: k });
        } else {
          const upper = Math.min(Math.max(norm(selector.start ?? len - 1), -1), len - 1);
          const lower = Math.min(Math.max(selector.end === null ? -1 : norm(selector.end), -1), len - 1);
          for (let k = upper; lower < k; k += step) out.push({ value: v.items[k]!, parent: at, step: k });
        }
        return;
      }
      case 'filter': {
        if (v.type !== 'array' && v.type !== 'object') return;
        const kids: Located[] = [];
        children(at, kids);
        for (const kid of kids) if (logical(selector.expr, kid)) out.push(kid);
        return;
      }
    }
  };

  const segment = (seg: Segment, input: Located[]): Located[] => {
    const out: Located[] = [];
    for (const at of input) {
      if (!seg.descendant) {
        for (const s of seg.selectors) select(s, at, out);
        check(out);
        continue;
      }
      // The node and its descendants in pre-order (RFC 9535 §2.5.2.2), an explicit stack.
      const stack: Located[] = [at];
      const kids: Located[] = [];
      while (stack.length > 0) {
        const node = stack.pop()!;
        for (const s of seg.selectors) select(s, node, out);
        check(out);
        kids.length = 0;
        children(node, kids);
        for (let k = kids.length - 1; k >= 0; k--) stack.push(kids[k]!);
      }
    }
    return out;
  };

  const run = (q: Query, current: Located): Located[] => {
    if (q.root === '$') {
      const known = absolute.get(q);
      if (known) return known;
    }
    let nodes = [q.root === '$' ? top : current];
    for (const seg of q.segments) nodes = segment(seg, nodes);
    if (q.root === '$') absolute.set(q, nodes);
    return nodes;
  };

  /** A singular query's value: its one node, or Nothing (none — or several, from repeated names, §5 п. 11). */
  const single = (q: Query, current: Located): Value => {
    const nodes = run(q, current);
    return nodes.length === 1 ? nodes[0]!.value : NOTHING;
  };

  const valueOf = (c: Comparable | Argument, current: Located): Value => {
    if (c.kind === 'literal') return literalNode(c.literal);
    if (c.kind === 'query') return single(c.query, current);
    if (c.kind === 'call') {
      const r = call(c.call, current);
      return typeof r === 'boolean' ? NOTHING : r;
    }
    return NOTHING;
  };

  const nodesOf = (a: Argument, current: Located): Located[] => (a.kind === 'query' ? run(a.query, current) : []);

  /** A function's result: a value (or Nothing), or true / false for a LogicalType one. */
  const call = (c: Call, current: Located): Value | boolean => {
    switch (c.name) {
      case 'length': {
        const v = valueOf(c.args[0]!, current);
        if (v === NOTHING) return NOTHING;
        if (v.type === 'string') return numberNode(codePoints(v.value));
        if (v.type === 'array') return numberNode(v.items.length);
        if (v.type === 'object') return numberNode(v.entries.length);
        return NOTHING;
      }
      case 'count':
        return numberNode(nodesOf(c.args[0]!, current).length);
      case 'value': {
        const nodes = nodesOf(c.args[0]!, current);
        return nodes.length === 1 ? nodes[0]!.value : NOTHING;
      }
      case 'match':
      case 'search': {
        const s = valueOf(c.args[0]!, current);
        const p = valueOf(c.args[1]!, current);
        if (s === NOTHING || p === NOTHING || s.type !== 'string' || p.type !== 'string') return false;
        const key = `${c.name}\u{0}${p.value}`;
        let re = patterns.get(key);
        if (re === undefined) {
          re = iRegexp(p.value, c.name);
          patterns.set(key, re);
        }
        return re !== null && re.test(s.value);
      }
    }
  };

  const logical = (e: LogicalExpr, current: Located): boolean => {
    switch (e.kind) {
      case 'or':
        return e.items.some(x => logical(x, current));
      case 'and':
        return e.items.every(x => logical(x, current));
      case 'not':
        return !logical(e.expr, current);
      case 'exists':
        return run(e.query, current).length > 0;
      case 'test': {
        const r = call(e.call, current);
        return r === true;
      }
      case 'compare':
        return compare(e.op, valueOf(e.left, current), valueOf(e.right, current));
    }
  };

  try {
    return { ok: true, nodes: run(query, top) };
  } catch (error) {
    if (error instanceof Limit) return { ok: false, message: TOO_MANY_NODES };
    throw error;
  }
};
