/**
 * A schema from samples (docs/tools/specs/json-schema.md §5 п. 33–39). Samples of one position merge as json-to-code
 * merges them (§5 «Слияние» there; the ideas, not the code): objects into one with the union of their properties, each
 * required when every object of the position has it; arrays into one `items`; every kind seen goes into `type`. Nothing
 * is invented: `enum`, `format` and `additionalProperties: false` come only when the person asks. Every sample
 * validates against the schema inferred from it (a property test).
 */
import { isIntegerValue } from './decimal';
import { DRAFT_URI, draftRank } from './drafts';
import { checkFormat } from './formats';
import type { Draft } from './drafts';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export interface InferOptions {
  draft: Draft;
  enums: boolean;
  formats: boolean;
  /** `"additionalProperties": false` on every object. */
  closed: boolean;
}

export interface Inference {
  /** The schema, JSON with an indent of 2 spaces, no line break at the end. */
  schema: string;
  samples: number;
  notes: string[];
}

/** A string position with more distinct values than this gets no `enum`. */
export const MAX_ENUM = 20;

/** The formats a string position may get, in the order they are tried (§5 п. 37). */
export const INFERRED_FORMATS = ['date-time', 'date', 'time', 'email', 'uuid', 'ipv4', 'ipv6', 'uri'] as const;

interface Shape {
  kinds: Set<'object' | 'array' | 'string' | 'number' | 'boolean' | 'null'>;
  allIntegers: boolean;
  objects: number;
  props: Map<string, { shape: Shape; objects: number }>;
  items: Shape | null;
  /** Distinct string values in order of appearance (stops growing past MAX_ENUM + 1). */
  values: string[];
  valueSet: Set<string>;
  /** Formats every string so far passes. */
  formats: Set<string> | null;
}

const newShape = (): Shape => ({
  kinds: new Set(),
  allIntegers: true,
  objects: 0,
  props: new Map(),
  items: null,
  values: [],
  valueSet: new Set(),
  formats: null,
});

type Value = string | boolean | string[] | Ordered;

/** An object of the output with its keys in the order they were set. */
class Ordered {
  readonly pairs: Array<[string, Value]> = [];
  set(key: string, value: Value): void {
    this.pairs.push([key, value]);
  }
}

/** JSON with an indent of 2 spaces, as `JSON.stringify(…, null, 2)` prints it, keys in their order. */
const print = (value: Value, indent = ''): string => {
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value))
    return value.length === 0 ? '[]' : `[\n${value.map(v => inner + JSON.stringify(v)).join(',\n')}\n${indent}]`;
  if (value.pairs.length === 0) return '{}';
  return `{\n${value.pairs.map(([k, v]) => `${inner}${JSON.stringify(k)}: ${print(v, inner)}`).join(',\n')}\n${indent}}`;
};

const ORDER = ['object', 'array', 'string', 'integer', 'number', 'boolean', 'null'] as const;

export const inferSchema = (samples: readonly JsonNode[], options: InferOptions): Inference => {
  const root = newShape();
  // Merge every sample into the shape tree: an explicit stack, no recursion.
  const stack: Array<{ node: JsonNode; shape: Shape }> = samples.map(node => ({ node, shape: root })).reverse();
  while (stack.length > 0) {
    const { node, shape } = stack.pop()!;
    shape.kinds.add(node.type);
    switch (node.type) {
      case 'number':
        if (!isIntegerValue(node.raw, options.draft)) shape.allIntegers = false;
        break;
      case 'string':
        if (!shape.valueSet.has(node.value) && shape.values.length <= MAX_ENUM) {
          shape.valueSet.add(node.value);
          shape.values.push(node.value);
        }
        if (options.formats) {
          const candidates = shape.formats ?? new Set(INFERRED_FORMATS);
          for (const f of [...candidates]) if (checkFormat(f, node.value, options.draft) !== true) candidates.delete(f);
          shape.formats = candidates;
        }
        break;
      case 'object': {
        shape.objects++;
        // Properties in order of first appearance: registered front to back, then their values pushed back to front.
        const seen = new Set<string>();
        const targets = node.entries.map(e => {
          let prop = shape.props.get(e.key);
          if (!prop) {
            prop = { shape: newShape(), objects: 0 };
            shape.props.set(e.key, prop);
          }
          if (!seen.has(e.key)) {
            seen.add(e.key);
            prop.objects++;
          }
          return prop.shape;
        });
        for (let i = node.entries.length - 1; i >= 0; i--)
          stack.push({ node: node.entries[i]!.value, shape: targets[i]! });
        break;
      }
      case 'array':
        shape.items ??= newShape();
        for (let i = node.items.length - 1; i >= 0; i--) stack.push({ node: node.items[i]!, shape: shape.items });
        break;
      default:
        break;
    }
  }
  const notes: string[] = [];
  let wideEnums = 0;
  const toSchema = (shape: Shape): Ordered => {
    const out = new Ordered();
    const types = ORDER.filter(t =>
      t === 'integer'
        ? shape.kinds.has('number') && shape.allIntegers
        : t === 'number'
          ? shape.kinds.has('number') && !shape.allIntegers
          : shape.kinds.has(t),
    );
    if (types.length === 1) out.set('type', types[0]!);
    else if (types.length > 1) out.set('type', [...types]);
    const onlyStrings = shape.kinds.size === 1 && shape.kinds.has('string');
    if (options.enums && onlyStrings) {
      if (shape.values.length > MAX_ENUM) wideEnums++;
      else if (shape.values.length === 1 && draftRank(options.draft) >= 6) out.set('const', shape.values[0]!);
      else out.set('enum', shape.values);
    }
    if (options.formats && shape.kinds.has('string') && shape.formats && shape.formats.size > 0)
      out.set(
        'format',
        INFERRED_FORMATS.find(f => shape.formats!.has(f))!,
      );
    if (shape.kinds.has('object')) {
      if (shape.props.size > 0) {
        const properties = new Ordered();
        for (const [key, prop] of shape.props) properties.set(key, toSchema(prop.shape));
        out.set('properties', properties);
        const required = [...shape.props].filter(([, p]) => p.objects === shape.objects).map(([k]) => k);
        if (required.length > 0) out.set('required', required);
      }
      if (options.closed) out.set('additionalProperties', false);
    }
    if (shape.kinds.has('array') && shape.items && shape.items.kinds.size > 0) out.set('items', toSchema(shape.items));
    return out;
  };
  const schema = new Ordered();
  schema.set('$schema', DRAFT_URI[options.draft]);
  for (const [k, v] of toSchema(root).pairs) schema.set(k, v);
  if (samples.length > 1)
    notes.push(`${samples.length} samples merged: properties missing from some samples are not required.`);
  else notes.push('1 sample.');
  if (wideEnums > 0)
    notes.push(
      `Enums: ${wideEnums === 1 ? '1 position has' : `${wideEnums} positions have`} more than ${MAX_ENUM} values and got no enum.`,
    );
  return { schema: print(schema), samples: samples.length, notes };
};
