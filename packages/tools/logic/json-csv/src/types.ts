/**
 * The types and limits of the JSON and CSV tool (docs/tools/specs/json-csv.md §9). JSON is read by the shared exact
 * scanner, so its error and layout types are the scanner's.
 */
import type { JsonErrorInfo, Layout } from '@workspace/tools-shared/json-scan';

export type Delimiter = ',' | ';' | '\t' | '|';

export interface CsvRecord {
  /** UTF-16 offset of the record's first character. */
  offset: number;
  fields: string[];
}

export interface ToCsvOptions {
  delimiter: Delimiter;
  header: boolean;
  flatten: boolean;
  newline: '\r\n' | '\n';
  quoteAll: boolean;
  protectFormulas: boolean;
}

export interface ToJsonOptions {
  delimiter: Delimiter | 'auto';
  header: boolean;
  detectTypes: boolean;
  empty: 'null' | 'string' | 'omit';
  nest: boolean;
  layout: Layout;
}

/**
 * What CSV cannot carry back (§5 «Что сохраняется точно», §13): read back with the default options, these come out
 * different from the JSON they were written from. Added to §9 (§15): the tool says what a round trip loses.
 */
export interface CsvLosses {
  /** `""` values and missing keys: an empty cell, which reads back like `null`. */
  blanks: number;
  /** Strings that read back as a number or `true`/`false` (`"42"`, `"TRUE"`, `"1e5"`). */
  typedStrings: number;
  /** Arrays (and objects when not flattened) written as JSON text: they read back as strings. */
  jsonText: number;
  /** Nested objects were flattened into dotted columns: only "Nest dotted headers" puts them back. */
  flattened: boolean;
  /** An empty key: the column has no name and is read back as `column_<n>`. */
  emptyNames: number;
}

export interface ToCsvNotes {
  rows: number;
  columns: number;
  protectedCells: number;
  emptyArray: boolean;
  inexactNumbers: number;
  /** Added (§15): cells that look like formulas and were left as they are because "Protect from formulas" is off. */
  formulaCells: number;
  /** Added (§15). */
  lost: CsvLosses;
}

export interface ToJsonNotes {
  delimiter: Delimiter;
  /** The delimiter came from Auto. */
  detected: boolean;
  /** Added (§15): Auto found no delimiter that fits and fell back to a comma. */
  fallback: boolean;
  rows: number;
  columns: number;
  shortRows: number;
  renamed: Array<{ column: number; from: string; to: string }>;
  inexactNumbers: number;
}

export type Converted<N> = { ok: true; text: string; notes: N } | { ok: false; error: JsonErrorInfo };

/** Characters of input converted on every change (§12); above it, by Run. */
export const LIVE_INPUT = 256 * 1024;
/** Characters of input (and bytes of a file) accepted at all (§12). */
export const MAX_INPUT = 32 * 1024 * 1024;
/** `detectCsv` reads only the start of a longer text (§7). */
export const DETECT_PREFIX_CHARS = 64 * 1024;
/** Records `detectDelimiter` and `detectCsv` read (§5 «Разделитель», §7). */
export const SAMPLE_RECORDS = 10;

export const DELIMITERS: readonly Delimiter[] = [',', ';', '\t', '|'];

export const DEFAULT_TO_CSV: ToCsvOptions = {
  delimiter: ',',
  header: true,
  flatten: true,
  newline: '\r\n',
  quoteAll: false,
  protectFormulas: true,
};

export const DEFAULT_TO_JSON: ToJsonOptions = {
  delimiter: 'auto',
  header: true,
  detectTypes: true,
  empty: 'null',
  nest: false,
  layout: 2,
};
