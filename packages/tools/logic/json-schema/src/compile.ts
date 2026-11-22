/**
 * From the texts to a schema the validator can run (docs/tools/specs/json-schema.md §5 п. 1–13, 22, 25, 30): the main
 * schema and the referenced schemas are read by the shared scanner and walked into one index; every reference is looked
 * up (never fetched) and every pattern compiled; then the main schema is checked against its meta-schema — all before
 * the document is touched. What stops the document from being checked is a problem of the schema, with its place in
 * the schema's text; what does not is a note.
 */
import { draftName, draftOfUri } from './drafts';
import { got } from './messages';
import { pointerOf } from './pointer';
import { builtInMeta, member, metaSchemaOf, newIndex, resolveIn, walkSchema } from './registry';
import { DEFAULT_BASE, resolveUri, showUri, splitFragment } from './uri';
import { Evaluator, SchemaLoop, TooDeep, Unresolved } from './validate';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { Draft } from './drafts';
import type { Index } from './registry';
import type { RawViolation } from './validate';
import type { DuplicateKey, JsonErrorInfo, JsonNode } from '@workspace/tools-shared/json-scan';

export interface SchemaProblem {
  /** 'schema' or 'referenced-<n>' (0-based). */
  source: string;
  /** Where in that schema's text. */
  offset: number;
  /** A JSON Pointer into that schema ('' for the root). */
  instanceLocation: string;
  /** For a meta-schema violation: the place in the meta-schema; otherwise ''. */
  keywordLocation: string;
  message: string;
  causes?: SchemaProblem[];
}

export interface ReferencedStatus {
  /** Its `$id` resolved (shown as written for a relative one), or null. */
  id: string | null;
  error: JsonErrorInfo | null;
  note: string | null;
}

export interface Compiled {
  root: JsonNode;
  draft: Draft;
  draftFrom: 'schema' | 'fallback' | 'meta';
  indexes: Index[];
}

export interface CompiledSchemas {
  ok: true;
  compiled: Compiled;
  problems: SchemaProblem[];
  notes: string[];
  referenced: ReferencedStatus[];
  /** The line under the schema: `Draft 2020-12 (from $schema).` */
  draftLine: string;
}

export type CompileResult = { ok: false; error: JsonErrorInfo } | CompiledSchemas;

export interface MetaOptions {
  maxViolations: number;
  maxCauses: number;
}

/** A referenced schema read: its tree, and (for tests) the URI it is retrieved by when it has no `$id`. */
export type ReferencedInput = { tree: JsonNode; uri?: string } | { error: JsonErrorInfo };

const REF_KEYS = ['$ref', '$dynamicRef', '$recursiveRef'] as const;

const capital = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1);

const problem = (source: string, offset: number, message: string, instanceLocation = ''): SchemaProblem => ({
  source,
  offset,
  instanceLocation,
  keywordLocation: '',
  message,
});

const toProblem = (v: RawViolation, evaluator: Evaluator): SchemaProblem => ({
  source: 'schema',
  offset: v.offset,
  instanceLocation: pointerOf(v.ip),
  keywordLocation: evaluator.absoluteLocation(v),
  message: v.message,
  ...(v.causes ? { causes: v.causes.map(c => toProblem(c, evaluator)) } : {}),
});

/** Compiles parsed schemas. `fallback` — the draft of a schema without `$schema`. */
export const compileParsed = (
  root: JsonNode,
  duplicateKeys: readonly DuplicateKey[],
  referencedInputs: readonly ReferencedInput[],
  fallback: Draft,
  meta: MetaOptions = { maxViolations: 1_000, maxCauses: 100 },
): CompiledSchemas => {
  const problems: SchemaProblem[] = [];
  const notes: string[] = [];
  for (const d of duplicateKeys)
    problems.push(
      problem(
        'schema',
        d.offset,
        `Duplicate key ${JSON.stringify(d.key)} at line ${d.line}, column ${d.column}: a schema keyword must appear once.`,
      ),
    );
  if (root.type !== 'object' && root.type !== 'boolean')
    problems.push(problem('schema', root.offset, `A schema is an object or true or false, not ${got(root)}.`));

  const index = newIndex();
  const { index: metaIndex } = builtInMeta();
  const referenced: ReferencedStatus[] = [];
  const trees: Array<{ tree: JsonNode; source: string; uri: string }> = [];
  const byId = new Map<string, JsonNode>();
  referencedInputs.forEach((input, n) => {
    if ('error' in input) {
      referenced.push({ id: null, error: input.error, note: null });
      return;
    }
    const tree = input.tree;
    let uri = input.uri ?? null;
    if (uri === null) {
      const $schema = member(tree, '$schema');
      const draft = ($schema?.type === 'string' && draftOfUri($schema.value)) || fallback;
      const idNode = member(tree, draft === 'draft-04' ? 'id' : '$id');
      if (idNode?.type === 'string' && !idNode.value.startsWith('#'))
        uri = splitFragment(resolveUri(idNode.value, DEFAULT_BASE)).base;
    }
    if (uri === null) {
      referenced.push({ id: null, error: null, note: 'This schema has no "$id": a reference cannot find it.' });
      return;
    }
    if (byId.has(uri)) {
      referenced.push({
        id: uri,
        error: null,
        note: `Two referenced schemas have the "$id" ${showUri(uri)}: the first one is used.`,
      });
      return;
    }
    byId.set(uri, tree);
    referenced.push({ id: uri, error: null, note: null });
    trees.push({ tree, source: `referenced-${n}`, uri });
  });

  const metaOf = (uri: string): JsonNode | undefined => byId.get(uri);
  const walked = walkSchema(index, root, { source: 'schema', fallback, metaOf });
  for (const r of trees) {
    walkSchema(index, r.tree, { source: r.source, fallback: walked.draft, metaOf, base: r.uri });
  }
  const indexes = [index, metaIndex];

  if (walked.unknownSchema !== null)
    notes.push(
      `The $schema ${walked.unknownSchema} is neither a draft this tool knows nor a referenced schema: the schema is read as ${draftName(fallback)}, the draft chosen above.`,
    );
  for (const v of walked.unknownVocabularies)
    problems.push(
      problem('schema', root.offset, `The meta-schema requires the vocabulary ${v}, which this tool does not know.`),
    );

  // References and patterns, statically, over every schema node of the main and referenced schemas.
  const unresolved = new Set<string>();
  const patterns = new Evaluator(indexes, { formats: false, maxViolations: 0, maxCauses: 0 });
  const checkPattern = (source: string, p: JsonNode, at: string): void => {
    if (p.type !== 'string' || patterns.regex(p.value)) return;
    let reason = '';
    try {
      new RegExp(p.value, 'u');
    } catch (e) {
      reason = (e instanceof Error ? e.message : String(e)).replace(/^Invalid regular expression: /, '');
    }
    problems.push(
      problem(
        source,
        p.offset,
        `The pattern ${JSON.stringify(p.value)} is not a valid regular expression: ${reason.replace(/\.$/, '')}.`,
        at,
      ),
    );
  };
  for (const [node, info] of index.info) {
    if (node.type !== 'object') continue;
    for (const key of REF_KEYS) {
      const ref = member(node, key);
      if (ref?.type !== 'string') continue;
      const uri = resolveUri(ref.value, info.base);
      const r = resolveIn(indexes, uri);
      if (r.ok || unresolved.has(uri)) continue;
      unresolved.add(uri);
      const base = splitFragment(uri).base;
      problems.push(
        problem(
          info.source,
          ref.offset,
          r.missing === 'place'
            ? `The reference ${ref.value} points to nothing in the schema.`
            : `The reference ${showUri(uri)} could not be resolved: schemas are never fetched. Add it under Referenced schemas with "$id": ${JSON.stringify(showUri(base))}.`,
          `${info.pointer}/${key}`,
        ),
      );
    }
    const pattern = member(node, 'pattern');
    if (pattern) checkPattern(info.source, pattern, `${info.pointer}/pattern`);
    const pp = member(node, 'patternProperties');
    if (pp?.type === 'object')
      for (const e of pp.entries)
        checkPattern(
          info.source,
          { type: 'string', offset: e.offset, raw: e.raw, value: e.key },
          `${info.pointer}/patternProperties`,
        );
  }

  // The main schema against its meta-schema (a referenced one when `$schema` names it).
  if (problems.length === 0) {
    const $schema = member(root, '$schema');
    const metaRoot =
      walked.from === 'meta' && $schema?.type === 'string'
        ? metaOf(splitFragment(resolveUri($schema.value, DEFAULT_BASE)).base)!
        : metaSchemaOf(walked.draft);
    const evaluator = new Evaluator(indexes, {
      formats: false,
      maxViolations: meta.maxViolations,
      maxCauses: meta.maxCauses,
    });
    try {
      const r = evaluator.run(metaRoot, root);
      if (!r.valid) for (const v of r.errors) problems.push(toProblem(v, evaluator));
    } catch (e) {
      if (!(e instanceof SchemaLoop || e instanceof TooDeep || e instanceof Unresolved || e instanceof RangeError))
        throw e;
      problems.push(
        problem('schema', root.offset, 'The schema could not be checked against its meta-schema: it nests too deep.'),
      );
    }
  }

  const name = capital(draftName(walked.draft));
  const draftLine =
    walked.from === 'schema'
      ? `${name} (from $schema).`
      : walked.from === 'meta'
        ? `${name} (from the meta-schema that $schema names).`
        : `${name} (no $schema: the draft chosen above).`;
  return {
    ok: true,
    compiled: { root, draft: walked.draft, draftFrom: walked.from, indexes },
    problems,
    notes,
    referenced,
    draftLine,
  };
};

/** Reads and compiles the texts. */
export const compileSchemas = (
  mainText: string,
  referencedTexts: readonly string[],
  fallback: Draft,
  meta?: MetaOptions,
): CompileResult => {
  const main = parseJsonTree(mainText);
  if (!main.ok) return { ok: false, error: main.error };
  const refs: ReferencedInput[] = referencedTexts.map(text => {
    const read = parseJsonTree(text);
    return read.ok ? { tree: read.tree } : { error: read.error };
  });
  return compileParsed(main.tree, main.notes.duplicateKeys, refs, fallback, meta);
};
