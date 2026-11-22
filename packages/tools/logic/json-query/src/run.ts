/**
 * What the tool's worker runs (docs/tools/specs/json-query.md §9): the document read by the shared scanner once, then
 * a query over it — the result rows the page shows (the first MAX_ROWS: path and a short value), and the texts its
 * copy buttons take (every value as one JSON array, indented by 2; every path, one per line), each bounded by
 * MAX_COPY. A row's own value is a slice of the values' text (`valueOfRow`), so copying one costs nothing more.
 */
import { evaluate } from './evaluate';
import { parseQuery } from './parse';
import { writePath } from './paths';
import { previewValue, printValue } from './print';
import { parseJsonTree } from '@workspace/tools-shared/json-scan';
import type { JsonErrorInfo, JsonNode, JsonNotes } from '@workspace/tools-shared/json-scan';

/** Characters of a document taken at all. */
export const MAX_DOCUMENT = 16 * 1024 * 1024;
/** Result rows shown. */
export const MAX_ROWS = 1_000;
/** Characters of the copy of all values, and of all paths. */
export const MAX_COPY = 16 * 1024 * 1024;
/** After an edit, the page waits this long before it runs the query. */
export const DEBOUNCE_MS = 150;
export const TIMEOUT_MS = 1_000;
export const LONG_TIMEOUT_MS = 10_000;

export type DocumentResult = { ok: true; root: JsonNode; notes: JsonNotes } | { ok: false; error: JsonErrorInfo };

/** A document, strict RFC 8259, through the shared scanner: literals as written, members in order, repeats kept. */
export const readDocument = (text: string): DocumentResult => {
  const parsed = parseJsonTree(text);
  return parsed.ok ? { ok: true, root: parsed.tree, notes: parsed.notes } : parsed;
};

export interface QueryRow {
  path: string;
  /** Minified, at most 200 characters. */
  preview: string;
  /** Where the value stands in the values' text, [start, end); null past MAX_COPY. */
  at: [number, number] | null;
}

export type RunResult =
  | {
      ok: true;
      count: number;
      rows: QueryRow[];
      /** Every value as a JSON array indented by 2 ('' when there are none); a prefix when not complete. */
      values: string;
      /** All values fit in MAX_COPY characters: `values` is the whole array. */
      valuesComplete: boolean;
      /** Every path, one per line; null past MAX_COPY. */
      paths: string | null;
      /** A path holds a lone surrogate (RFC 9535 cannot write it). */
      lonePath: boolean;
    }
  | { ok: false; where: 'document'; error: JsonErrorInfo }
  | { ok: false; where: 'query'; message: string };

/** Runs a query on a document's tree. Throws nothing a person caused: errors are values. */
export const runQuery = (expression: string, root: JsonNode): RunResult => {
  const parsed = parseQuery(expression);
  if (!parsed.ok) return { ok: false, where: 'query', message: parsed.error.message };
  const evaluated = evaluate(parsed.query, root);
  if (!evaluated.ok) return { ok: false, where: 'query', message: evaluated.message };
  const nodes = evaluated.nodes;
  const rows: QueryRow[] = [];
  let lonePath = false;
  let paths: string | null = '';
  for (let k = 0; k < nodes.length; k++) {
    const needed = k < MAX_ROWS || paths !== null;
    if (!needed) break;
    const path = writePath(nodes[k]!);
    lonePath ||= path.lone;
    if (k < MAX_ROWS) rows.push({ path: path.text, preview: previewValue(nodes[k]!.value), at: null });
    if (paths !== null) {
      paths += k === 0 ? path.text : `\n${path.text}`;
      if (paths.length > MAX_COPY) paths = null;
    }
  }
  let values = '';
  let valuesComplete = true;
  if (nodes.length > 0) {
    values = '[';
    for (let k = 0; k < nodes.length; k++) {
      values += k === 0 ? '\n  ' : ',\n  ';
      const start = values.length;
      const room = MAX_COPY - start;
      if (room <= 0) {
        valuesComplete = false;
        break;
      }
      const text = printValue(nodes[k]!.value, 2, room, 1);
      if (text.length >= room) {
        valuesComplete = false;
        values = values.slice(0, start);
        break;
      }
      values += text;
      if (k < MAX_ROWS) rows[k]!.at = [start, values.length];
    }
    if (valuesComplete) values += '\n]';
  }
  return { ok: true, count: nodes.length, rows, values, valuesComplete, paths, lonePath };
};

/** One row's value, indented by 2 from the left (its slice of the values' text, one level less); null past MAX_COPY. */
export const valueOfRow = (values: string, row: QueryRow): string | null =>
  row.at ? values.slice(row.at[0], row.at[1]).replaceAll('\n  ', '\n') : null;

/** `No results`, `1 result`, `1,234 results`. */
export const resultCountText = (n: number): string =>
  n === 0 ? 'No results' : n === 1 ? '1 result' : `${n.toLocaleString('en-US')} results`;
