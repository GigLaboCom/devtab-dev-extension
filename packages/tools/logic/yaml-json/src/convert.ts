/*! @license ISC
yaml — Copyright Eemeli Aro <eemeli@gmail.com>

Permission to use, copy, modify, and/or distribute this software for any purpose
with or without fee is hereby granted, provided that the above copyright notice
and this permission notice appear in all copies.

THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH
REGARD TO THIS SOFTWARE INCLUDING ALL IMPLIED WARRANTIES OF MERCHANTABILITY AND
FITNESS. IN NO EVENT SHALL THE AUTHOR BE LIABLE FOR ANY SPECIAL, DIRECT,
INDIRECT, OR CONSEQUENTIAL DAMAGES OR ANY DAMAGES WHATSOEVER RESULTING FROM LOSS
OF USE, DATA OR PROFITS, WHETHER IN AN ACTION OF CONTRACT, NEGLIGENCE OR OTHER
TORTIOUS ACTION, ARISING OUT OF OR IN CONNECTION WITH THE USE OR PERFORMANCE OF
THIS SOFTWARE.
*/
/**
 * The conversion itself (docs/tools/specs/yaml-json.md §5), on `yaml` 2.9.1 — the only module of the package that
 * imports the library, reached through `loadConverter` (a chunk of its own, never on the start page).
 *
 * Neither direction builds JavaScript values: `toJS` + `JSON.stringify` would round numbers beyond 2^53, move
 * integer-like keys to the front and lose `1E400`. YAML → JSON prints JSON straight from the library's document tree,
 * with its own alias table, merge keys and limits; JSON → YAML reads the JSON with the shared exact scanner
 * (@workspace/tools-shared/json-scan) and builds YAML nodes from the literals as written.
 */
import { ALIAS_BUDGET } from './types';
import {
  MAX_DEPTH,
  JSON_NUMBER,
  errorAt,
  isInexactNumber,
  parseJsonTree,
  positionsIn,
} from '@workspace/tools-shared/json-scan';
import { Document, Pair, Scalar, YAMLMap, YAMLSeq, isAlias, isMap, isScalar, isSeq, parseAllDocuments } from 'yaml';
import type { ConvertNotes, ConvertResult, JsonToYamlOptions, YamlNote, YamlToJsonOptions } from './types';
import type { JsonNode, Layout } from '@workspace/tools-shared/json-scan';
import type { Alias, Node, ParsedNode, ScalarTag, Schema, Tags } from 'yaml';

const TIMESTAMP = 'tag:yaml.org,2002:timestamp';
const MERGE = 'tag:yaml.org,2002:merge';
const CORE_PREFIX = 'tag:yaml.org,2002:';

/**
 * The parse options of §5 «Чтение», 1–3. Explicit 1.1 tags are not resolved in 1.2 (`resolveKnownTags: false`: an
 * unknown tag is noted, not silently turned into a Date), dates stay strings in both versions (no `!!timestamp`), and
 * `!!binary` is read in both (as the Base64 text, see `scalarJson`).
 */
const parseOptions = (version: '1.1' | '1.2') => ({
  version,
  merge: true,
  uniqueKeys: true,
  intAsBigInt: true,
  prettyErrors: false,
  resolveKnownTags: false,
  customTags: (tags: Tags): Tags => [...tags.filter(t => (t as ScalarTag).tag !== TIMESTAMP), 'binary'],
});

/** What a YAML document may say instead of the schema's own tags: a tag's name as people write it (`!!int`, `!Ref`). */
const tagName = (tag: string): string => (tag.startsWith(CORE_PREFIX) ? `!!${tag.slice(CORE_PREFIX.length)}` : tag);

class Stop {
  constructor(
    readonly message: string,
    readonly offset: number,
  ) {}
}

const start = (node: { range?: readonly number[] | null } | null | undefined, fallback = 0): number =>
  node?.range?.[0] ?? fallback;

const ALIAS_BOMB = `aliases expand to more than ${ALIAS_BUDGET.toLocaleString('en-US')} nodes: refusing (an alias bomb?)`;
const TOO_DEEP = `nesting deeper than ${MAX_DEPTH} levels`;
/** The parser itself is recursive: past some hundreds of flow levels its stack runs out before our limit (§15). */
const TOO_DEEP_FOR_PARSER = 'nesting too deep for the YAML parser: it ran out of stack here';
/** The same for the library's printer (JSON → YAML): in a browser worker it stops near 750 levels (§15). */
const TOO_DEEP_FOR_PRINTER = 'nesting too deep for the YAML printer: it ran out of stack here';
const TOO_DEEP_TO_CONVERT = 'nesting too deep to convert: it ran out of stack';
/**
 * Aliases under the node budget can still multiply the text (a chain of 900 nested aliases indents its depth at every
 * level: past 500 Mi characters, more than a string can hold). The result is refused well before that.
 */
const MAX_OUTPUT = 64 * 1024 * 1024;
const RESULT_TOO_LARGE = 'the JSON would be longer than 64 Mi characters: refusing';
const MERGE_NEEDS_MAPS = 'a merge key (<<) needs a mapping or a list of mappings';

/** `1_000`, `+12`, `.5`, `5.`, `007.5` → JSON's form of the same decimal, digit for digit; null when it is not one. */
const decimalAsJson = (source: string): string | null => {
  const m = /^([-+]?)([0-9_]*)(?:\.([0-9_]*))?(?:[eE]([-+]?[0-9]+))?$/.exec(source);
  if (!m) return null;
  const sign = m[1] === '-' ? '-' : '';
  const whole = m[2]!.replaceAll('_', '').replace(/^0+(?=[0-9])/, '');
  const fraction = (m[3] ?? '').replaceAll('_', '');
  if (whole === '' && fraction === '') return null;
  const exponent = m[4] === undefined ? '' : `e${m[4]}`;
  const literal = `${sign}${whole || '0'}${fraction ? `.${fraction}` : m[3] !== undefined ? '.0' : ''}${exponent}`;
  return JSON_NUMBER.test(literal) ? literal : null;
};

interface Entry {
  key: string;
  value: Node | null;
  /** The alias the entry came through (a merge source behind `<<: *x`): its value counts against the budget. */
  via: Alias | null;
}

interface Walk {
  layout: Layout;
  out: string[];
  aliasTarget: Map<Alias, Node>;
  known: Set<string>;
  schema: Schema;
  inexact: number;
  expanded: number;
  /** Characters written so far (MAX_OUTPUT). */
  size: number;
  aliasesUsed: boolean;
  /** The alias being expanded at the outermost level, where the budget error is reported. */
  outer: Alias | null;
}

/**
 * Anchors and aliases of one document, in the order they are written (YAML 1.2.2 §3.2.2.2: an alias is the nearest
 * preceding node with its anchor). One pass, so an alias costs a map lookup instead of the library's search of the
 * whole document; the nodes still open on the way down are the ones an alias may not point to (a cycle).
 */
const resolveAliases = (root: Node | null, aliasTarget: Map<Alias, Node>): void => {
  const anchors = new Map<string, Node>();
  const open = new Set<Node>();
  const visit = (node: unknown, depth: number): void => {
    if (!node || typeof node !== 'object') return;
    if (isAlias(node)) {
      const target = anchors.get(node.source);
      if (!target) throw new Stop(`unknown alias *${node.source}`, start(node));
      if (open.has(target))
        throw new Stop(`alias *${node.source} refers to a node that contains it: JSON has no cycles`, start(node));
      aliasTarget.set(node, target);
      return;
    }
    const anchored = node as Node;
    if (anchored.anchor) anchors.set(anchored.anchor, anchored);
    if (isMap(node) || isSeq(node)) {
      if (depth >= MAX_DEPTH) throw new Stop(TOO_DEEP, start(node));
      open.add(node);
      for (const item of node.items as unknown[]) {
        if (item && typeof item === 'object' && 'key' in item && 'value' in item) {
          visit(item.key, depth + 1);
          visit(item.value, depth + 1);
        } else visit(item, depth + 1);
      }
      open.delete(node);
    }
  };
  visit(root, 0);
};

const isMergeKey = (key: unknown): boolean => isScalar(key) && typeof key.value === 'symbol';

/** A key as JSON has it: a string's value; any other scalar as written (`True`, `~`, `0x1F`, `n` in 1.1). */
const keyString = (key: unknown, walk: Walk): string => {
  if (key === null || key === undefined) return '';
  if (isAlias(key)) {
    walk.aliasesUsed = true;
    return keyString(walk.aliasTarget.get(key), walk);
  }
  if (isScalar(key)) {
    if (typeof key.value === 'string') return key.value;
    return key.source ?? (key.value === null ? '' : String(key.value));
  }
  throw new Stop('a key that is a mapping or a sequence has no JSON equivalent', start(key as Node));
};

const quoteKey = (key: string): string => {
  const quoted = JSON.stringify(key);
  return quoted.length > 42 ? `${quoted.slice(0, 41)}…"` : quoted;
};

/** The mappings a `<<` merges, in order, each with the alias it came through. */
const mergeSources = (value: unknown, walk: Walk, fallback: number): Array<{ map: YAMLMap; via: Alias | null }> => {
  const one = (node: unknown, via: Alias | null): { map: YAMLMap; via: Alias | null } | null => {
    if (isAlias(node)) return one(walk.aliasTarget.get(node), via ?? node);
    return isMap(node) ? { map: node as YAMLMap, via } : null;
  };
  const direct = one(value, null);
  if (direct) return [direct];
  const list = isAlias(value) ? walk.aliasTarget.get(value) : value;
  if (isSeq(list)) {
    const via = isAlias(value) ? value : null;
    return (list.items as unknown[]).map(item => {
      const found = one(item, via);
      if (!found) throw new Stop(MERGE_NEEDS_MAPS, start(item as Node, start(list)));
      return found;
    });
  }
  throw new Stop(MERGE_NEEDS_MAPS, start(value as Node, fallback));
};

/**
 * The entries of a mapping as JSON gets them (§5 «Чтение», 5 and 8): explicit keys win over merged ones, an earlier
 * merge source wins over a later one, merged keys take the place of `<<`, nested `<<` in sources are applied.
 */
const entriesOf = (map: YAMLMap, walk: Walk): Entry[] => {
  const items = map.items as Array<Pair<unknown, unknown>>;
  const seen = new Set<string>();
  const keys: string[] = [];
  for (const pair of items) {
    if (isMergeKey(pair.key)) {
      keys.push('');
      continue;
    }
    const key = keyString(pair.key, walk);
    if (seen.has(key))
      throw new Stop(`two keys become ${quoteKey(key)} in JSON`, start(pair.key as Node, start(pair.value as Node)));
    seen.add(key);
    keys.push(key);
  }
  const entries: Entry[] = [];
  items.forEach((pair, i) => {
    if (!isMergeKey(pair.key)) {
      entries.push({ key: keys[i]!, value: pair.value as Node | null, via: null });
      return;
    }
    walk.aliasesUsed = true;
    const keyEnd = (pair.key as Scalar).range?.[1] ?? 0;
    for (const { map: source, via } of mergeSources(pair.value, walk, keyEnd))
      for (const entry of entriesOf(source, walk)) {
        if (seen.has(entry.key)) continue;
        seen.add(entry.key);
        entries.push({ ...entry, via: entry.via ?? via });
      }
  });
  return entries;
};

/** A plain scalar with a tag the schema does not know is read as if it had none (§5 «Чтение», 9). */
const untagged = (node: Scalar, walk: Walk): unknown => {
  const source = node.source ?? '';
  const tag = walk.schema.tags.find(t => t.default === true && (t as ScalarTag).test?.test(source)) as
    ScalarTag | undefined;
  if (!tag) return source;
  const value = tag.resolve(source, () => undefined, { intAsBigInt: true } as never);
  return isScalar(value) ? value.value : value;
};

const numberJson = (node: Scalar, value: number | bigint, walk: Walk): string => {
  const source = node.source ?? '';
  let literal: string | null = JSON_NUMBER.test(source) ? source : null;
  if (literal === null) {
    if (typeof value === 'bigint') literal = value.toString();
    else if (!Number.isFinite(value))
      throw new Stop(`${source} has no JSON equivalent: JSON numbers are finite (RFC 8259 §6)`, start(node));
    // A decimal keeps every digit it was written with; only a sexagesimal float (1.1, `1:20.5`) goes through a double.
    else literal = decimalAsJson(source) ?? (Object.is(value, -0) ? '-0' : String(value));
  }
  if (isInexactNumber(literal)) walk.inexact++;
  return literal;
};

const scalarJson = (node: Scalar, walk: Walk): string => {
  const plainUnknown =
    node.tag !== undefined && node.tag !== '!' && !walk.known.has(node.tag) && node.type === Scalar.PLAIN;
  const value = plainUnknown ? untagged(node, walk) : node.value;
  if (value === null || value === undefined) return 'null';
  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number':
    case 'bigint':
      return numberJson(node, value, walk);
    default:
      // !!binary: the Base64 text as written, without its white space; anything else: its source text.
      return JSON.stringify(
        value instanceof Uint8Array ? (node.source ?? '').replace(/\s+/g, '') : (node.source ?? String(value)),
      );
  }
};

const printJson = (root: Node | null, walk: Walk, depth: number): void => {
  const { out, layout } = walk;
  const step = layout === 'minify' ? '' : layout === 'tab' ? '\t' : ' '.repeat(layout);
  const colon = layout === 'minify' ? ':' : ': ';
  const write = (...parts: string[]): void => {
    for (const part of parts) {
      out.push(part);
      walk.size += part.length;
    }
  };

  /**
   * One value, one stack frame per level (no callbacks, aliases followed in a loop), so the walk reaches MAX_DEPTH
   * inside a worker's stack. `via`: the alias a merged entry came through.
   */
  const value = (given: unknown, level: number, via: Alias | null): void => {
    let node = given;
    let owner = false;
    if (via && !walk.outer) {
      walk.outer = via;
      owner = true;
    }
    while (isAlias(node)) {
      walk.aliasesUsed = true;
      if (!walk.outer) {
        walk.outer = node;
        owner = true;
      }
      node = walk.aliasTarget.get(node);
    }
    emit: {
      if (node === null || node === undefined) {
        write('null');
        break emit;
      }
      if (walk.outer && ++walk.expanded > ALIAS_BUDGET) throw new Stop(ALIAS_BOMB, start(walk.outer));
      if (walk.size > MAX_OUTPUT) throw new Stop(RESULT_TOO_LARGE, start(walk.outer ?? (node as Node)));
      if (isScalar(node)) {
        write(scalarJson(node, walk));
        break emit;
      }
      const map = isMap(node);
      if (!map && !isSeq(node)) {
        write('null');
        break emit;
      }
      if (level >= MAX_DEPTH) throw new Stop(TOO_DEEP, start(walk.outer ?? (node as Node)));
      const inner = step === '' ? '' : `\n${step.repeat(level + 1)}`;
      const close = step === '' ? '' : `\n${step.repeat(level)}`;
      if (map) {
        const entries = entriesOf(node as YAMLMap, walk);
        if (entries.length === 0) {
          write('{}');
          break emit;
        }
        write('{');
        for (let i = 0; i < entries.length; i++) {
          const entry = entries[i]!;
          // A key produced from inside an alias is a node too.
          if ((walk.outer || entry.via) && ++walk.expanded > ALIAS_BUDGET)
            throw new Stop(ALIAS_BOMB, start(walk.outer ?? entry.via));
          write(i === 0 ? inner : `,${inner}`, JSON.stringify(entry.key), colon);
          value(entry.value, level + 1, entry.via);
        }
        write(close, '}');
        break emit;
      }
      const items = (node as YAMLSeq).items as unknown[];
      if (items.length === 0) {
        write('[]');
        break emit;
      }
      write('[');
      for (let i = 0; i < items.length; i++) {
        const item = items[i];
        write(i === 0 ? inner : `,${inner}`);
        // A pair in a flow sequence (`[a: 1, b]`) is an object of one key (§5 «Чтение», 12); so are the pairs of
        // !!omap and !!pairs.
        if (item && typeof item === 'object' && 'key' in item && 'value' in item && !isScalar(item)) {
          if (level + 1 >= MAX_DEPTH) throw new Stop(TOO_DEEP, start(item.key as Node));
          const key = keyString(item.key, walk);
          write('{', inner + step, JSON.stringify(key), colon);
          value(item.value, level + 2, null);
          write(inner, '}');
        } else value(item, level + 1, null);
      }
      write(close, ']');
    }
    // A Stop thrown above ends the whole walk, so the alias being expanded needs no reset on that path.
    if (owner) walk.outer = null;
  };
  value(root, depth, null);
};

/** The schema's own tags (a tag outside them is unknown: noted, its value read as if untagged). */
const knownTags = (schema: Schema): Set<string> =>
  new Set([
    ...schema.tags.map(t => (t as ScalarTag).tag),
    `${CORE_PREFIX}str`,
    `${CORE_PREFIX}map`,
    `${CORE_PREFIX}seq`,
  ]);

/** YAML → JSON (§5 «Чтение», «Вывод»). */
export const yamlToJson = (text: string, { version, layout }: YamlToJsonOptions): ConvertResult => {
  const documents = Array.from(parseAllDocuments(text, parseOptions(version)));
  const position = positionsIn(text);
  const fail = (message: string, offset: number, moreErrors = 0): ConvertResult => ({
    ok: false,
    error: { message, offset, ...position(offset) },
    moreErrors,
  });

  const errors = documents.flatMap(d => d.errors);
  const [first] = errors;
  if (first) {
    const exhausted = first.code === 'RESOURCE_EXHAUSTION';
    const more = exhausted ? errors.filter(e => e.code !== 'RESOURCE_EXHAUSTION').length : errors.length - 1;
    return fail(exhausted ? TOO_DEEP_FOR_PARSER : first.message, first.pos[0], more);
  }

  const unknownTags: YamlNote[] = [];
  for (const doc of documents) {
    const known = knownTags(doc.schema);
    for (const warning of doc.warnings) {
      if (warning.code !== 'TAG_RESOLVE_FAILED' || !warning.message.startsWith('Unresolved tag: ')) continue;
      const tag = warning.message.slice('Unresolved tag: '.length);
      // A tag of the schema that does not fit its value (`!!int "abc"`) would change the data: refuse.
      if (known.has(tag)) return fail(`the value does not fit its tag ${tagName(tag)}`, warning.pos[0]);
      unknownTags.push({ message: tagName(tag), offset: warning.pos[0], ...position(warning.pos[0]) });
    }
  }

  const notes: ConvertNotes = { documents: documents.length, aliasesExpanded: false, unknownTags, inexactNumbers: 0 };
  if (documents.length === 0) return { ok: true, text: '', notes };

  const out: string[] = [];
  const walk: Walk = {
    layout,
    out,
    aliasTarget: new Map(),
    known: new Set(),
    schema: documents[0]!.schema,
    inexact: 0,
    expanded: 0,
    size: 0,
    aliasesUsed: false,
    outer: null,
  };
  try {
    for (const doc of documents) resolveAliases(doc.contents as Node | null, walk.aliasTarget);
    const step = layout === 'minify' ? '' : layout === 'tab' ? '\t' : ' '.repeat(layout);
    const many = documents.length > 1;
    if (many) out.push('[');
    documents.forEach((doc, i) => {
      walk.schema = doc.schema;
      walk.known = knownTags(doc.schema);
      if (many) out.push(i === 0 ? '' : ',', step === '' ? '' : `\n${step}`);
      printJson(doc.contents as ParsedNode | null, walk, many ? 1 : 0);
    });
    if (many) out.push(step === '' ? ']' : '\n]');
  } catch (error) {
    if (error instanceof Stop) return fail(error.message, error.offset);
    if (error instanceof RangeError) return fail(TOO_DEEP_TO_CONVERT, 0);
    throw error;
  }
  return {
    ok: true,
    text: out.join(''),
    notes: { ...notes, aliasesExpanded: walk.aliasesUsed, inexactNumbers: walk.inexact },
  };
};

/** A JSON number as written: printed by its own tag, never through a double. */
class RawNumber {
  constructor(readonly raw: string) {}
}

const rawNumberTag: ScalarTag = {
  identify: value => value instanceof RawNumber,
  default: true,
  tag: `${CORE_PREFIX}float`,
  resolve: value => value,
  stringify: ({ value }) => (value as RawNumber).raw,
};

/**
 * A string the library prints plain in 1.1 mode but someone could read differently (§5 «JSON → YAML», 4): `0o10` is
 * an integer in 1.2; `<<` is a merge key and a leading U+FEFF is taken for a byte order mark (both found by the
 * round-trip test, §15); a string of several lines one of which starts with a space or a tab is a block the
 * library prints wrongly — at the top of a document (the specification's case), and anywhere when a blank line comes
 * first (the round-trip test).
 */
const needsDoubleQuotes = (value: string): boolean =>
  value === '<<' ||
  value.startsWith('\uFEFF') ||
  /^0o[0-7]+$/.test(value) ||
  (/[\n\r]/.test(value) && /(?:^|[\n\r])[ \t]/.test(value));

const stringScalar = (value: string): Scalar => {
  const scalar = new Scalar(value);
  if (needsDoubleQuotes(value)) scalar.type = Scalar.QUOTE_DOUBLE;
  return scalar;
};

const yamlNode = (node: JsonNode): Node => {
  switch (node.type) {
    case 'object': {
      const map = new YAMLMap();
      for (const entry of node.entries) map.items.push(new Pair(stringScalar(entry.key), yamlNode(entry.value)));
      return map;
    }
    case 'array': {
      const seq = new YAMLSeq();
      for (const item of node.items) seq.items.push(yamlNode(item));
      return seq;
    }
    case 'string':
      return stringScalar(node.value);
    case 'number':
      return new Scalar(new RawNumber(node.raw));
    case 'boolean':
      return new Scalar(node.value);
    case 'null':
      return new Scalar(null);
  }
};

/** The offset of the first most deeply nested value, without recursion: where a printer that ran out of stack was. */
const deepest = (tree: JsonNode): number => {
  let best = { depth: -1, offset: 0 };
  const stack: Array<{ node: JsonNode; depth: number }> = [{ node: tree, depth: 0 }];
  while (stack.length > 0) {
    const { node, depth } = stack.pop()!;
    if (depth > best.depth || (depth === best.depth && node.offset < best.offset))
      best = { depth, offset: node.offset };
    const children = node.type === 'object' ? node.entries.map(e => e.value) : node.type === 'array' ? node.items : [];
    for (const child of children) stack.push({ node: child, depth: depth + 1 });
  }
  return best.offset;
};

/** JSON → YAML (§5 «JSON → YAML»): every literal as written, quotes wherever YAML 1.1 or 1.2 would read otherwise. */
export const jsonToYaml = (text: string, { indent }: JsonToYamlOptions): ConvertResult => {
  const parsed = parseJsonTree(text);
  if (!parsed.ok) return { ok: false, error: parsed.error, moreErrors: 0 };
  const [duplicate, ...others] = parsed.notes.duplicateKeys;
  if (duplicate)
    return {
      ok: false,
      error: errorAt(text, `duplicate key ${quoteKey(duplicate.key)}: YAML requires unique keys`, duplicate.offset),
      moreErrors: others.length,
    };
  // No merge tag in the printing schema: a key "<<" is a string here and printed in quotes (needsDoubleQuotes).
  const doc = new Document(null, {
    version: '1.1',
    customTags: (tags: Tags): Tags => [...tags.filter(t => (t as ScalarTag).tag !== MERGE), rawNumberTag],
  });
  doc.contents = yamlNode(parsed.tree) as never;
  let yaml: string;
  try {
    yaml = doc.toString({ indent, lineWidth: 0, minContentWidth: 0 });
  } catch (error) {
    if (error instanceof RangeError)
      return { ok: false, error: errorAt(text, TOO_DEEP_FOR_PRINTER, deepest(parsed.tree)), moreErrors: 0 };
    throw error;
  }
  return {
    ok: true,
    text: yaml,
    notes: { documents: 1, aliasesExpanded: false, unknownTags: [], inexactNumbers: parsed.notes.inexactNumbers },
  };
};
