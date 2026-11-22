/**
 * The schemas a validation can reach and where everything in them is (docs/tools/specs/json-schema.md §5 п. 1–3, 7–12):
 * the main schema, the referenced schemas the person pasted, and the built-in meta-schemas. One walk over each (an
 * explicit stack, no recursion) records every schema node's base URI, draft and place, every resource (`$id`, `id` in
 * draft 4) and anchor (`$anchor`, `$dynamicAnchor`, `$id: "#name"` in drafts 6 and 7, `$recursiveAnchor`). The walk
 * enters only the places where the node's draft puts schemas, so an `$id` inside `enum`, `const` or a property name is
 * not an identifier. Nothing is fetched: a reference no schema here answers is reported, never loaded.
 */
import { DRAFT_URI, draftOfUri, draftRank } from './drafts';
import { META_SCHEMAS } from './meta';
import { decodeFragment, nodeAt, parsePointer } from './pointer';
import { DEFAULT_BASE, resolveUri, splitFragment } from './uri';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { Draft } from './drafts';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export type Vocabulary =
  'core' | 'applicator' | 'unevaluated' | 'validation' | 'format' | 'format-assertion' | 'content' | 'meta';

/** null — every vocabulary of the node's draft. */
export type Vocabularies = ReadonlySet<Vocabulary> | null;

export interface NodeInfo {
  /** The base URI references in this node resolve against (after its own `$id`). */
  base: string;
  draft: Draft;
  vocabularies: Vocabularies;
  /** The resource the node lies in (its URI without fragment) and the pointer from that resource's root. */
  resource: string;
  pointer: string;
  /** The node starts a resource (a source root or an `$id`): it enters the dynamic scope. */
  isResource: boolean;
  recursiveAnchor: boolean;
  /** Which source: 'schema', 'referenced-<n>' or 'meta'. */
  source: string;
}

export interface Index {
  resources: Map<string, JsonNode>;
  anchors: Map<string, JsonNode>;
  dynamicAnchors: Map<string, JsonNode>;
  info: Map<JsonNode, NodeInfo>;
}

export const newIndex = (): Index => ({
  resources: new Map(),
  anchors: new Map(),
  dynamicAnchors: new Map(),
  info: new Map(),
});

/** The member of an object node with this name (the first, as a schema's repeated key is an error of the schema). */
export const member = (node: JsonNode, key: string): JsonNode | undefined => {
  if (node.type !== 'object') return undefined;
  for (const e of node.entries) if (e.key === key) return e.value;
  return undefined;
};

const VOCAB_2020: Record<string, Vocabulary> = {
  core: 'core',
  applicator: 'applicator',
  unevaluated: 'unevaluated',
  validation: 'validation',
  'meta-data': 'meta',
  'format-annotation': 'format',
  'format-assertion': 'format-assertion',
  content: 'content',
};

/** The vocabularies a meta-schema's `$vocabulary` names; unknown required ones are listed apart. */
const readVocabularies = (meta: JsonNode): { set: Set<Vocabulary>; unknownRequired: string[] } | null => {
  const v = member(meta, '$vocabulary');
  if (!v || v.type !== 'object') return null;
  const set = new Set<Vocabulary>(['core']);
  const unknownRequired: string[] = [];
  for (const e of v.entries) {
    const m = /\/draft\/(?:2019-09|2020-12)\/vocab\/([a-z-]+)$/.exec(e.key);
    const known = m ? (VOCAB_2020[m[1]!] ?? (m[1] === 'format' ? 'format' : undefined)) : undefined;
    if (known) {
      set.add(known);
      // 2019-09 keeps unevaluated* in its applicator vocabulary.
      if (known === 'applicator' && e.key.includes('2019-09')) set.add('unevaluated');
    } else if (e.value.type === 'boolean' && e.value.value) unknownRequired.push(e.key);
  }
  return { set, unknownRequired };
};

type Shape = 'single' | 'map' | 'array' | 'items' | 'dependencies';

const KEYWORDS: Record<Draft, Record<string, Shape>> = (() => {
  const d4: Record<string, Shape> = {
    properties: 'map',
    patternProperties: 'map',
    additionalProperties: 'single',
    items: 'items',
    additionalItems: 'single',
    definitions: 'map',
    dependencies: 'dependencies',
    allOf: 'array',
    anyOf: 'array',
    oneOf: 'array',
    not: 'single',
  };
  const d6 = { ...d4, contains: 'single', propertyNames: 'single' } as Record<string, Shape>;
  const d7 = { ...d6, if: 'single', then: 'single', else: 'single' } as Record<string, Shape>;
  const d2019 = {
    ...d7,
    $defs: 'map',
    dependentSchemas: 'map',
    unevaluatedItems: 'single',
    unevaluatedProperties: 'single',
    contentSchema: 'single',
  } as Record<string, Shape>;
  const d2020 = { ...d2019, prefixItems: 'array', items: 'single' } as Record<string, Shape>;
  delete d2020.additionalItems;
  return { 'draft-04': d4, 'draft-06': d6, 'draft-07': d7, '2019-09': d2019, '2020-12': d2020 };
})();

/** The subschema-holding keywords of a draft and the form of each. */
export const subschemaKeywords = (draft: Draft): Readonly<Record<string, Shape>> => KEYWORDS[draft];

const escapeToken = (t: string): string => t.replace(/~/g, '~0').replace(/\//g, '~1');

export interface WalkOptions {
  source: string;
  /** Draft when the source's root has no `$schema` (or names one this tool does not know). */
  fallback: Draft;
  /** Custom meta-schemas known by URI (referenced schemas), for `$schema` naming one of them. */
  metaOf?: (uri: string) => JsonNode | undefined;
  /** The URI the source is retrieved by (a referenced schema of the test suite, which has no `$id`). */
  base?: string;
}

/** The draft and vocabularies `$schema` gives a resource, through a custom meta-schema when it names one. */
const dialectOf = (
  uri: string,
  options: WalkOptions,
): { draft: Draft; vocabularies: Vocabularies; meta: JsonNode | null } | null => {
  const draft = draftOfUri(uri);
  if (draft) return { draft, vocabularies: null, meta: null };
  const meta = options.metaOf?.(splitFragment(resolveUri(uri, DEFAULT_BASE)).base);
  if (!meta) return null;
  const metaSchema = member(meta, '$schema');
  const metaDraft = metaSchema?.type === 'string' ? draftOfUri(metaSchema.value) : null;
  const vocab = readVocabularies(meta);
  return { draft: metaDraft ?? options.fallback, vocabularies: vocab ? vocab.set : null, meta };
};

/**
 * Walks one schema source into the index. Returns the root's draft and whether it came from `$schema`.
 */
export const walkSchema = (
  index: Index,
  root: JsonNode,
  options: WalkOptions,
): {
  draft: Draft;
  from: 'schema' | 'fallback' | 'meta';
  unknownSchema: string | null;
  unknownVocabularies: string[];
} => {
  let rootDraft: Draft = options.fallback;
  let from: 'schema' | 'fallback' | 'meta' = 'fallback';
  let unknownSchema: string | null = null;
  const unknownVocabularies: string[] = [];
  type Item = {
    node: JsonNode;
    base: string;
    draft: Draft;
    vocab: Vocabularies;
    resource: string;
    pointer: string;
    root: boolean;
  };
  const stack: Item[] = [
    {
      node: root,
      base: options.base ?? DEFAULT_BASE,
      draft: options.fallback,
      vocab: null,
      resource: options.base ?? DEFAULT_BASE,
      pointer: '',
      root: true,
    },
  ];
  while (stack.length > 0) {
    const it = stack.pop()!;
    const node = it.node;
    if (node.type === 'boolean') {
      index.info.set(node, {
        base: it.base,
        draft: it.draft,
        vocabularies: it.vocab,
        resource: it.resource,
        pointer: it.pointer,
        isResource: it.root,
        recursiveAnchor: false,
        source: options.source,
      });
      if (it.root) index.resources.set(it.base, node);
      continue;
    }
    if (node.type !== 'object') continue;
    let { base, draft, vocab, resource, pointer } = it;
    let isResource = it.root;
    const idKey = draft === 'draft-04' ? 'id' : '$id';
    const $schema = member(node, '$schema');
    const ownId = member(node, idKey);
    const hasRef = member(node, '$ref') !== undefined;
    // `$schema` counts at a source's root, and at an embedded resource's root from 2019-09 on.
    if ($schema?.type === 'string' && (it.root || (ownId && draftRank(draft) >= 2019))) {
      const dialect = dialectOf($schema.value, options);
      if (dialect) {
        draft = dialect.draft;
        vocab = dialect.vocabularies;
        if (it.root) {
          rootDraft = draft;
          from = dialect.meta ? 'meta' : 'schema';
          if (dialect.meta) {
            const v = readVocabularies(dialect.meta);
            if (v) unknownVocabularies.push(...v.unknownRequired);
          }
        }
      } else if (it.root) unknownSchema = $schema.value;
    }
    if (it.root && !index.resources.has(base)) index.resources.set(base, node);
    const id = member(node, draft === 'draft-04' ? 'id' : '$id');
    // Up to draft 7 every sibling of `$ref` is ignored, `$id` too.
    if (id?.type === 'string' && !(hasRef && draftRank(draft) <= 7)) {
      const resolved = resolveUri(id.value, base);
      const { base: uri, fragment } = splitFragment(resolved);
      const onlyFragment = id.value.startsWith('#');
      if (!onlyFragment) {
        base = uri;
        resource = uri;
        pointer = '';
        isResource = true;
        if (!index.resources.has(uri)) index.resources.set(uri, node);
      }
      if (fragment && draftRank(draft) <= 7) index.anchors.set(`${uri}#${fragment}`, node);
    }
    if (it.root && !index.resources.has(base)) index.resources.set(base, node);
    if (draftRank(draft) >= 2019) {
      const anchor = member(node, '$anchor');
      if (anchor?.type === 'string') index.anchors.set(`${base}#${anchor.value}`, node);
    }
    if (draft === '2020-12') {
      const dyn = member(node, '$dynamicAnchor');
      if (dyn?.type === 'string') {
        if (!index.anchors.has(`${base}#${dyn.value}`)) index.anchors.set(`${base}#${dyn.value}`, node);
        index.dynamicAnchors.set(`${base}#${dyn.value}`, node);
      }
    }
    const rec = member(node, '$recursiveAnchor');
    index.info.set(node, {
      base,
      draft,
      vocabularies: vocab,
      resource,
      pointer,
      isResource,
      recursiveAnchor: draft === '2019-09' && rec?.type === 'boolean' && rec.value,
      source: options.source,
    });
    const shapes = KEYWORDS[draft];
    for (let k = node.entries.length - 1; k >= 0; k--) {
      const e = node.entries[k]!;
      const shape = shapes[e.key];
      if (!shape) continue;
      const at = `${pointer}/${escapeToken(e.key)}`;
      const push = (child: JsonNode, p: string): void => {
        if (child.type === 'object' || child.type === 'boolean')
          stack.push({ node: child, base, draft, vocab, resource, pointer: p, root: false });
      };
      const v = e.value;
      if (shape === 'single') push(v, at);
      else if (shape === 'array' || (shape === 'items' && v.type === 'array')) {
        if (v.type === 'array') for (let i = v.items.length - 1; i >= 0; i--) push(v.items[i]!, `${at}/${i}`);
      } else if (shape === 'items') push(v, at);
      else if (v.type === 'object')
        for (let i = v.entries.length - 1; i >= 0; i--) {
          const m = v.entries[i]!;
          if (shape === 'dependencies' && m.value.type === 'array') continue;
          push(m.value, `${at}/${escapeToken(m.key)}`);
        }
    }
  }
  return { draft: rootDraft, from, unknownSchema, unknownVocabularies };
};

let metaIndex: { index: Index; roots: JsonNode[] } | null = null;

/** The built-in meta-schemas, read and walked once per worker; every http/https spelling of their URIs resolves. */
export const builtInMeta = (): { index: Index; roots: JsonNode[] } => {
  if (metaIndex) return metaIndex;
  const index = newIndex();
  const roots: JsonNode[] = [];
  for (const text of META_SCHEMAS) {
    const read = parseJsonTree(text);
    if (!read.ok) throw new Error(`a built-in meta-schema does not parse: ${read.error.message}`);
    const $schema = member(read.tree, '$schema');
    const draft = ($schema?.type === 'string' && draftOfUri($schema.value)) || '2020-12';
    walkSchema(index, read.tree, { source: 'meta', fallback: draft });
    roots.push(read.tree);
  }
  for (const [uri, node] of [...index.resources]) {
    const other = uri.startsWith('https:')
      ? `http:${uri.slice(6)}`
      : uri.startsWith('http:')
        ? `https:${uri.slice(5)}`
        : null;
    if (other && !index.resources.has(other)) index.resources.set(other, node);
  }
  metaIndex = { index, roots };
  return metaIndex;
};

/** The meta-schema node of a draft. */
export const metaSchemaOf = (draft: Draft): JsonNode => {
  const { index } = builtInMeta();
  return index.resources.get(splitFragment(DRAFT_URI[draft]).base)!;
};

/** A reference resolved: the node, or why not. */
export type Resolved =
  { ok: true; node: JsonNode; uri: string } | { ok: false; uri: string; missing: 'resource' | 'place' };

/** Looks a URI up in the indexes (main and referenced first, then the meta-schemas). */
export const resolveIn = (indexes: readonly Index[], uri: string): Resolved => {
  const { base, fragment } = splitFragment(uri);
  let resource: JsonNode | undefined;
  let owner: Index | undefined;
  for (const ix of indexes) {
    resource = ix.resources.get(base);
    if (resource) {
      owner = ix;
      break;
    }
  }
  if (!resource || !owner) return { ok: false, uri, missing: 'resource' };
  if (fragment === null || fragment === '') return { ok: true, node: resource, uri };
  const decoded = decodeFragment(fragment);
  if (decoded !== null && (decoded === '' || decoded.startsWith('/'))) {
    const tokens = parsePointer(decoded);
    const node = tokens ? nodeAt(resource, tokens) : null;
    return node ? { ok: true, node, uri } : { ok: false, uri, missing: 'place' };
  }
  for (const ix of indexes) {
    const node = ix.anchors.get(`${base}#${fragment}`);
    if (node) return { ok: true, node, uri };
  }
  return { ok: false, uri, missing: 'place' };
};
