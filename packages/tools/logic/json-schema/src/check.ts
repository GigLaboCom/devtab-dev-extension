/**
 * A document checked against a compiled schema (docs/tools/specs/json-schema.md §5 п. 13, 28–32): the evaluator's
 * violations with their places as pointers, lines and columns, in document order; a loop or a run too deep is a problem
 * of the schema, not of the document.
 */
import { pointerOf } from './pointer';
import { Evaluator, SchemaLoop, TooDeep, Unresolved } from './validate';
import { positionsIn } from '@workspace/tools-shared/json-scan';
import type { Compiled } from './compile';
import type { RawViolation } from './validate';
import type { JsonNode } from '@workspace/tools-shared/json-scan';

export interface Violation {
  /** JSON Pointer of the place in the document ('' — the root). */
  instanceLocation: string;
  /** The path through the schema as the check went (through `$ref`), `#/properties/port/type`. */
  keywordLocation: string;
  /** Where the keyword is written: `<resource URI>#<pointer>` (no URI for the main schema without `$id`). */
  absoluteKeywordLocation: string;
  keyword: string;
  message: string;
  /** UTF-16 offset in the document; line and column are 1-based (the scanner's). */
  offset: number;
  line: number;
  column: number;
  causes?: Violation[];
}

/** A recursion deeper than the engine's stack allows (§12: about 500 document levels under a recursive schema). */
export const TOO_DEEP =
  'The document nests too deep for this schema: checking it would recurse past what the browser allows. Flatten the document or the schema.';

export interface CheckOptions {
  formats: boolean;
  maxViolations: number;
  maxCauses: number;
}

export type CheckResult =
  { ok: true; valid: boolean; violations: Violation[]; truncated: boolean } | { ok: false; message: string };

export const checkDocument = (
  compiled: Compiled,
  document: JsonNode,
  text: string,
  options: CheckOptions,
): CheckResult => {
  const evaluator = new Evaluator(compiled.indexes, options, text);
  let raw: { valid: boolean; errors: RawViolation[] };
  try {
    raw = evaluator.run(compiled.root, document);
  } catch (e) {
    if (e instanceof SchemaLoop) {
      const info = compiled.indexes[0]!.info.get(e.schema);
      return {
        ok: false,
        message: `The schema refers to itself in a loop at #${info?.pointer ?? ''}: it never moves into the document.`,
      };
    }
    if (e instanceof TooDeep || e instanceof RangeError) return { ok: false, message: TOO_DEEP };
    if (e instanceof Unresolved) return { ok: false, message: `The reference ${e.uri} could not be resolved.` };
    throw e;
  }
  const at = text ? positionsIn(text) : () => ({ line: 0, column: 0 });
  const convert = (v: RawViolation): Violation => {
    const { line, column } = at(v.offset);
    return {
      instanceLocation: pointerOf(v.ip),
      keywordLocation: `#${pointerOf(v.kp)}`,
      absoluteKeywordLocation: evaluator.absoluteLocation(v),
      keyword: v.keyword,
      message: v.message,
      offset: v.offset,
      line,
      column,
      ...(v.causes && v.causes.length > 0 ? { causes: v.causes.map(convert) } : {}),
    };
  };
  const ordered = raw.errors.map((v, i) => ({ v, i })).sort((a, b) => a.v.offset - b.v.offset || a.i - b.i);
  const seen = new Set<string>();
  const violations: Violation[] = [];
  for (const { v } of ordered) {
    const key = `${pointerOf(v.ip)}\u0000${pointerOf(v.kp)}\u0000${v.message}`;
    if (seen.has(key)) continue;
    seen.add(key);
    violations.push(convert(v));
  }
  return { ok: true, valid: raw.valid, violations, truncated: evaluator.truncated };
};
