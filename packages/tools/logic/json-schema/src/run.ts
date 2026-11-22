/**
 * What the tool's worker runs (docs/tools/specs/json-schema.md §5 п. 40, §12): a validation request — the schema, the
 * referenced schemas and the document, each read once and kept while it does not change — and an inference request.
 * The answers carry everything the page shows: lines and columns, the first rows, the full text of Copy.
 */
import { checkDocument } from './check';
import { compileSchemas } from './compile';
import { inferSchema } from './infer';
import { placeName, violationsText } from './messages';
import { documentNotes } from './notes';
import { showUri } from './uri';
import { parseJsonTree, parseJsonValues, positionsIn } from '@workspace/tools-shared/json-scan';
import type { Violation } from './check';
import type { CompileResult, SchemaProblem } from './compile';
import type { Draft } from './drafts';
import type { InferOptions } from './infer';
import type { JsonErrorInfo, JsonTreeResult } from '@workspace/tools-shared/json-scan';

export const MAX_DOCUMENT = 16 * 1024 * 1024;
export const MAX_SCHEMA = 4 * 1024 * 1024;
export const MAX_REFERENCED = 20;
export const MAX_ROWS = 1_000;
export const MAX_VIOLATIONS = 100_000;
export const MAX_CAUSES = 100;
export const DEBOUNCE_MS = 150;
export const TIMEOUT_MS = 1_000;
export const LONG_TIMEOUT_MS = 10_000;

export interface ValidationRequest {
  /** Identifies the schema, the referenced schemas and the fallback draft together; texts come only when it changes. */
  schemaKey: number;
  schema?: string;
  referenced?: string[];
  fallback: Draft;
  documentKey: number;
  document?: string;
  formats: boolean;
}

export interface PlacedProblem extends SchemaProblem {
  line: number;
  column: number;
  causes?: PlacedProblem[];
}

export interface ReferencedRow {
  /** Its `$id` as written for people, or null. */
  id: string | null;
  error: JsonErrorInfo | null;
  note: string | null;
}

export type SchemaState =
  | { state: 'empty' }
  | { state: 'error'; error: JsonErrorInfo }
  | {
      state: 'ok';
      draftLine: string;
      notes: string[];
      problems: PlacedProblem[];
      problemsText: string;
      referenced: ReferencedRow[];
    };

export type DocumentState =
  { state: 'empty' } | { state: 'error'; error: JsonErrorInfo } | { state: 'ok'; notes: string[] };

export type Outcome =
  | { kind: 'checked'; valid: boolean; count: number; rows: Violation[]; text: string; truncated: boolean }
  | { kind: 'stopped'; message: string };

export interface ValidationReply {
  schema: SchemaState;
  document: DocumentState;
  /** null — the document was not checked (a field is empty or has an error, or the schema has problems). */
  outcome: Outcome | null;
}

const blank = (text: string): boolean => !/\S/.test(text);

/** Keeps the last schema and document read, so an edit of one does not read the other again. */
export class Session {
  private schemaKey = -1;
  private schemaTexts: { schema: string; referenced: string[] } = { schema: '', referenced: [] };
  private compiled: CompileResult | null = null;
  private schemaState: SchemaState = { state: 'empty' };
  private documentKey = -1;
  private documentText = '';
  private documentRead: JsonTreeResult | null = null;

  validate(request: ValidationRequest): ValidationReply {
    if (request.schemaKey !== this.schemaKey) {
      if (request.schema === undefined) throw new Error('the schema did not reach the worker');
      this.schemaKey = request.schemaKey;
      this.schemaTexts = { schema: request.schema, referenced: request.referenced ?? [] };
      this.readSchema(request.fallback);
    }
    if (request.documentKey !== this.documentKey) {
      if (request.document === undefined) throw new Error('the document did not reach the worker');
      this.documentKey = request.documentKey;
      this.documentText = request.document;
      this.documentRead = blank(request.document) ? null : parseJsonTree(request.document);
    }
    const read = this.documentRead;
    const document: DocumentState = !read
      ? { state: 'empty' }
      : read.ok
        ? { state: 'ok', notes: documentNotes(read.notes) }
        : { state: 'error', error: read.error };
    const compiled = this.compiled;
    let outcome: Outcome | null = null;
    if (read?.ok && compiled?.ok && compiled.problems.length === 0) {
      const r = checkDocument(compiled.compiled, read.tree, this.documentText, {
        formats: request.formats,
        maxViolations: MAX_VIOLATIONS,
        maxCauses: MAX_CAUSES,
      });
      outcome = r.ok
        ? {
            kind: 'checked',
            valid: r.valid,
            count: r.violations.length,
            rows: r.violations.slice(0, MAX_ROWS),
            text: violationsText(r.violations),
            truncated: r.truncated,
          }
        : { kind: 'stopped', message: r.message };
    }
    return { schema: this.schemaState, document, outcome };
  }

  private readSchema(fallback: Draft): void {
    const { schema, referenced } = this.schemaTexts;
    if (blank(schema)) {
      this.compiled = null;
      this.schemaState = { state: 'empty' };
      return;
    }
    const result = compileSchemas(
      schema,
      referenced.map(t => (blank(t) ? '{}' : t)),
      fallback,
      {
        maxViolations: MAX_ROWS,
        maxCauses: MAX_CAUSES,
      },
    );
    this.compiled = result;
    if (!result.ok) {
      this.schemaState = { state: 'error', error: result.error };
      return;
    }
    const texts = [schema, ...referenced];
    const positions = texts.map(t => positionsIn(t));
    const place = (p: SchemaProblem): PlacedProblem => {
      const n = p.source === 'schema' ? 0 : Number(p.source.slice('referenced-'.length)) + 1;
      const { line, column } = positions[n]!(p.offset);
      const { causes, ...rest } = p;
      return { ...rest, line, column, ...(causes ? { causes: causes.map(place) } : {}) };
    };
    const problems = result.problems.map(place);
    this.schemaState = {
      state: 'ok',
      draftLine: result.draftLine,
      notes: result.notes,
      problems,
      problemsText: violationsText(problems.map(p => ({ ...p, keywordLocation: p.keywordLocation || '—' }))),
      referenced: result.referenced.map((r, i) =>
        blank(referenced[i] ?? '')
          ? { id: null, error: null, note: null }
          : { ...r, id: r.id === null ? null : showUri(r.id) },
      ),
    };
  }
}

export type InferenceReply =
  | { state: 'empty' }
  | { state: 'error'; error: JsonErrorInfo }
  | { state: 'ok'; schema: string; samples: number; notes: string[] };

export const runInference = (samples: string, options: InferOptions): InferenceReply => {
  if (blank(samples)) return { state: 'empty' };
  const read = parseJsonValues(samples, { allowComments: true });
  if (!read.ok) return { state: 'error', error: read.error };
  const r = inferSchema(read.values, options);
  return { state: 'ok', schema: r.schema, samples: r.samples, notes: r.notes };
};

/** For a Where cell: `(root)` or the pointer. */
export const whereText = placeName;
