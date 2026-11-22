/**
 * Inference (docs/tools/specs/json-to-code.md §5 «Слияние образцов и вывод типа», «Имена»): every value that lands in
 * one position adds its variant to that position's shape; objects in one position merge into one, arrays into one
 * element. Then the objects get names in a pre-order walk, and an object with the same base name and the same structure
 * as one named before shares its type. Nothing here recurses: the scanner lets 1 000 levels through, and a tree passed
 * in directly may be deeper still — every walk keeps its own stack, and the work is linear in the size of the tree.
 */
import { RESERVED, keyWords, singularWords, typeNames } from './names';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

/** `i64` < `u64` < `f64`: a position takes the widest kind it met (§5 п. 4). */
export type NumberKind = 'i64' | 'u64' | 'f64';

export interface Shape {
  string: boolean;
  number: NumberKind | null;
  boolean: boolean;
  null: boolean;
  object: ObjectShape | null;
  array: { item: Shape } | null;
}

export interface Field {
  shape: Shape;
  /** In how many of the position's objects the key was. */
  count: number;
  /** The last object counted (a repeated key counts once, its last value wins); the slot of its value then. */
  seen: number;
  slot: number;
}

export interface ObjectShape {
  /** How many objects merged here. */
  count: number;
  /** Keys in the order of their first appearance. */
  fields: Map<string, Field>;
  /** Structure id: equal ids, equal structure on every level (keys, their order, optional, types). */
  id: number;
  /** The type it is written as: its own name, or the name of the equal object named before it. */
  name: string;
  go: string;
}

/** The merged type of all samples, with names given (§9 `TypeShape`). */
export interface TypeShape {
  root: Shape;
  /** The root's name — taken even when the root is not an object (§5 «Имена» п. 6). */
  rootName: string;
  rootGo: string;
  /** The objects to declare, in the order their names were given (§5 «Имена» п. 4). */
  objects: ObjectShape[];
}

const emptyShape = (): Shape => ({
  string: false,
  number: null,
  boolean: false,
  null: false,
  object: null,
  array: null,
});

const I64_MIN = -(2n ** 63n);
const I64_MAX = 2n ** 63n - 1n;
const U64_MAX = 2n ** 64n - 1n;

/**
 * The kind of a number literal as written (§5 п. 4): `1.0`, `2e3` and integers beyond u64 are fractional — and `-0`,
 * which serde_json reads as the float -0.0 and refuses for an i64 field (§15; the specification had it i64).
 */
export const numberKind = (raw: string): NumberKind => {
  if (/[.eE]/.test(raw) || raw === '-0') return 'f64';
  const digits = raw.length - (raw.startsWith('-') ? 1 : 0);
  if (digits < 19) return 'i64';
  if (digits > 20) return 'f64';
  const value = BigInt(raw);
  return value >= I64_MIN && value <= I64_MAX ? 'i64' : value > 0n && value <= U64_MAX ? 'u64' : 'f64';
};

const WIDER: Record<NumberKind, number> = { i64: 0, u64: 1, f64: 2 };

/** All samples into one shape, in document order (keys keep the order of their first appearance). */
const merge = (values: JsonNode[]): Shape => {
  const root = emptyShape();
  const work: Array<[Shape, JsonNode]> = values.map((v): [Shape, JsonNode] => [root, v]).reverse();
  let serial = 0;
  for (let next = work.pop(); next; next = work.pop()) {
    const [shape, node] = next;
    switch (node.type) {
      case 'string':
        shape.string = true;
        break;
      case 'number': {
        const kind = numberKind(node.raw);
        if (shape.number === null || WIDER[kind] > WIDER[shape.number]) shape.number = kind;
        break;
      }
      case 'boolean':
        shape.boolean = true;
        break;
      case 'null':
        shape.null = true;
        break;
      case 'object': {
        const object = (shape.object ??= { count: 0, fields: new Map(), id: 0, name: '', go: '' });
        object.count++;
        const mine = ++serial;
        const pending: Array<[Shape, JsonNode]> = [];
        for (const entry of node.entries) {
          let field = object.fields.get(entry.key);
          if (!field) object.fields.set(entry.key, (field = { shape: emptyShape(), count: 0, seen: 0, slot: 0 }));
          if (field.seen !== mine) {
            field.seen = mine;
            field.count++;
            field.slot = pending.length;
            pending.push([field.shape, entry.value]);
          } else pending[field.slot]![1] = entry.value; // a repeated key: its last value (§5 «Разбор» п. 3)
        }
        for (let i = pending.length - 1; i >= 0; i--) work.push(pending[i]!);
        break;
      }
      case 'array': {
        const array = (shape.array ??= { item: emptyShape() });
        for (let i = node.items.length - 1; i >= 0; i--) work.push([array.item, node.items[i]!]);
        break;
      }
    }
  }
  return root;
};

/** Every shape below `root`, each after all of its descendants. */
const bottomUp = (root: Shape): Shape[] => {
  const order: Shape[] = [];
  const stack = [root];
  for (let shape = stack.pop(); shape; shape = stack.pop()) {
    order.push(shape);
    if (shape.object) for (const field of shape.object.fields.values()) stack.push(field.shape);
    if (shape.array) stack.push(shape.array.item);
  }
  return order.reverse();
};

/** Structure ids, children first: one interned key per shape and per object, so equality is one comparison. */
const identify = (shapes: Shape[]): void => {
  const ids = new Map<string, number>();
  const intern = (key: string): number => {
    let id = ids.get(key);
    if (id === undefined) ids.set(key, (id = ids.size + 1));
    return id;
  };
  const shapeIds = new Map<Shape, number>();
  for (const shape of shapes) {
    const object = shape.object;
    if (object) {
      let key = 'o';
      for (const [name, field] of object.fields)
        key += `${JSON.stringify(name)}${field.count < object.count ? '?' : ':'}${shapeIds.get(field.shape)},`;
      object.id = intern(key);
    }
    const flags = `${shape.string ? 's' : ''}${shape.number ?? ''}${shape.boolean ? 'b' : ''}${shape.null ? 'n' : ''}`;
    shapeIds.set(shape, intern(`${flags}|${object?.id ?? ''}|${shape.array ? shapeIds.get(shape.array.item) : ''}`));
  }
};

/** A position whose only variant is an object with keys: the root then is that object, named after the root. */
export const isObjectOnly = (shape: Shape): boolean =>
  !shape.string &&
  shape.number === null &&
  !shape.boolean &&
  !shape.null &&
  !shape.array &&
  shape.object !== null &&
  shape.object.fields.size > 0;

/** The merged type of all samples, with names given (§5 «Имена»). */
export const inferShape = (values: JsonNode[], rootName: string): TypeShape => {
  const root = merge(values);
  identify(bottomUp(root));

  const taken = new Set<string>(RESERVED);
  const takenGo = new Set<string>(RESERVED);
  /** Where the search for each base name resumes: a name once taken stays taken. */
  const next = new Map<string, number>();
  /** A name free in both forms gets the same number in both (§5 «Имена» п. 8). */
  const allocate = (words: string[]): { name: string; go: string } => {
    const base = typeNames(words);
    const numbered = (n: number) => (n === 1 ? base : { name: `${base.name}${n}`, go: `${base.go}${n}` });
    let n = next.get(base.name) ?? 1;
    let picked = numbered(n);
    while (taken.has(picked.name) || takenGo.has(picked.go)) picked = numbered(++n);
    next.set(base.name, n + 1);
    taken.add(picked.name);
    takenGo.add(picked.go);
    return picked;
  };

  const rootWords = keyWords(rootName);
  const named = allocate(rootWords.length ? rootWords : ['root']);
  const objects: ObjectShape[] = [];
  /** Objects with their own declaration, by the base name they were named from and their structure. */
  const declared = new Map<string, ObjectShape>();

  /**
   * A position's words: `items` counts the `Item`s an array in an array adds (§5 «Имена» п. 3), kept as a number so
   * that a thousand nested arrays do not copy a thousand growing lists.
   */
  type Words = { words: string[]; items: number };
  const singular = ({ words, items }: Words): Words => {
    if (items > 0) return { words, items: items + 1 };
    const next = singularWords(words);
    return next.length > words.length ? { words, items: 1 } : { words: next, items: 0 };
  };
  const stack: Array<{ shape: Shape; words: Words; root?: boolean }> = [
    { shape: root, words: { words: rootWords.length ? rootWords : ['root'], items: 0 }, root: true },
  ];
  for (let task = stack.pop(); task; task = stack.pop()) {
    const { shape } = task;
    // The array's element after the object's fields: pushed first, so taken last.
    if (shape.array) stack.push({ shape: shape.array.item, words: singular(task.words) });
    const object = shape.object;
    if (!object || object.fields.size === 0) continue;
    const words = [...task.words.words, ...Array<string>(task.words.items).fill('item')];
    const asRoot = task.root === true && isObjectOnly(shape);
    const key = `${typeNames(words).name} ${object.id}`;
    const same = asRoot ? undefined : declared.get(key);
    if (same) {
      object.name = same.name;
      object.go = same.go;
      continue;
    }
    ({ name: object.name, go: object.go } = asRoot ? named : allocate(words));
    objects.push(object);
    declared.set(key, object);
    const fields = [...object.fields];
    for (let i = fields.length - 1; i >= 0; i--) {
      const [key, field] = fields[i]!;
      const fieldWords = keyWords(key);
      stack.push({ shape: field.shape, words: { words: fieldWords.length ? fieldWords : ['type'], items: 0 } });
    }
  }
  return { root, rootName: named.name, rootGo: named.go, objects };
};
