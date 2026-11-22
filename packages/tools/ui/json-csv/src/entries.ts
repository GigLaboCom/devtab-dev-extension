/**
 * The JSON and CSV tool's history entries as the component writes and reads them: the drafts, their labels, the
 * search excerpt, the size above which nothing is recorded, and the reading of a payload back into options (what is
 * missing or not understood falls back to the tool's defaults).
 */
import { DELIMITER_NAMES, LIVE_INPUT, describeTable } from '@workspace/tool-logic-json-csv';
import type { ConvertJob, Done } from './conversion';
import type { Direction, JsonCsvOptionsPayload, JsonCsvPayload } from './history';
import type { Delimiter, Layout } from '@workspace/tool-logic-json-csv';
import type { HistoryDraft } from '@workspace/tools-host';

/** Above this many characters of input nothing is recorded (history.ts): a table that large is an export, not a sample. */
export const RECORD_LIMIT = LIVE_INPUT;

export const isDelimiter = (v: unknown): v is Delimiter => v === ',' || v === ';' || v === '\t' || v === '|';
export const isLayout = (v: unknown): v is Layout => v === 2 || v === 4 || v === 'tab' || v === 'minify';
export const isEmpty = (v: unknown): v is 'null' | 'string' | 'omit' => v === 'null' || v === 'string' || v === 'omit';
export const isDirection = (v: unknown): v is Direction => v === 'to-csv' || v === 'to-json';

export const DEFAULT_OPTIONS: JsonCsvOptionsPayload = {
  direction: 'to-csv',
  header: true,
  toCsv: { delimiter: ',', flatten: true, newline: 'crlf', quoteAll: false, protectFormulas: true, bom: false },
  toJson: { delimiter: 'auto', detectTypes: true, empty: 'null', nest: false, layout: 2 },
};

const ACTION_LABEL: Record<NonNullable<JsonCsvPayload['action']>, string> = {
  copy: 'copied',
  save: 'saved',
  swap: 'swapped',
};

/** `JSON → CSV · semicolon · 2 rows × 3 columns · copied`, `CSV → JSON · error at line 2, column 1`. */
export const entryLabel = (p: JsonCsvPayload): string => {
  const toCsv = p.direction === 'to-csv';
  const delimiter = toCsv ? p.toCsv.delimiter : p.toJson.delimiter;
  return [
    toCsv ? 'JSON → CSV' : 'CSV → JSON',
    delimiter === 'auto' ? '' : DELIMITER_NAMES[delimiter],
    p.outcome === 'ok' && p.rows !== undefined && p.columns !== undefined
      ? describeTable(p.rows, p.columns)
      : p.error
        ? `error at line ${p.error.line}, column ${p.error.column}`
        : '',
    p.action ? ACTION_LABEL[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

/** The first characters of the input, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

const CSV_TYPE = 'text/csv';
const JSON_TYPE = 'application/json';

/** A draft for a job and its result, or null when nothing is to be recorded (blank, or over RECORD_LIMIT). */
export const draftOf = (
  job: ConvertJob,
  done: Done,
  options: JsonCsvOptionsPayload,
  action?: JsonCsvPayload['action'],
): HistoryDraft | null => {
  if (job.text.trim() === '' || job.text.length > RECORD_LIMIT) return null;
  const { result } = done;
  const payload: JsonCsvPayload = {
    ...options,
    direction: job.direction,
    ...(action ? { action } : {}),
    ...(result.ok
      ? { outcome: 'ok', rows: result.notes.rows, columns: result.notes.columns }
      : {
          outcome: 'error',
          error: { line: result.error.line, column: result.error.column, message: result.error.message },
        }),
  };
  const [inType, outType] = job.direction === 'to-csv' ? [JSON_TYPE, CSV_TYPE] : [CSV_TYPE, JSON_TYPE];
  const input = new Blob([job.text], { type: inType });
  return {
    kind: job.direction,
    payload,
    label: entryLabel(payload),
    text: excerpt(job.text),
    blobs: result.ok && result.text !== '' ? { input, output: new Blob([result.text], { type: outType }) } : { input },
  };
};

const bool = (v: unknown, fallback: boolean): boolean => (typeof v === 'boolean' ? v : fallback);

/** The options an entry was made with; what is missing or not understood is the default. */
export const readEntry = (kind: string, payload: unknown): JsonCsvOptionsPayload => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<JsonCsvPayload>;
  const c = (p.toCsv ?? {}) as Partial<JsonCsvOptionsPayload['toCsv']>;
  const j = (p.toJson ?? {}) as Partial<JsonCsvOptionsPayload['toJson']>;
  const d = DEFAULT_OPTIONS;
  return {
    direction: isDirection(p.direction) ? p.direction : isDirection(kind) ? kind : d.direction,
    header: bool(p.header, d.header),
    toCsv: {
      delimiter: isDelimiter(c.delimiter) ? c.delimiter : d.toCsv.delimiter,
      flatten: bool(c.flatten, d.toCsv.flatten),
      newline: c.newline === 'lf' ? 'lf' : 'crlf',
      quoteAll: bool(c.quoteAll, d.toCsv.quoteAll),
      protectFormulas: bool(c.protectFormulas, d.toCsv.protectFormulas),
      bom: bool(c.bom, d.toCsv.bom),
    },
    toJson: {
      delimiter: j.delimiter === 'auto' || isDelimiter(j.delimiter) ? j.delimiter : d.toJson.delimiter,
      detectTypes: bool(j.detectTypes, d.toJson.detectTypes),
      empty: isEmpty(j.empty) ? j.empty : d.toJson.empty,
      nest: bool(j.nest, d.toJson.nest),
      layout: isLayout(j.layout) ? j.layout : d.toJson.layout,
    },
  };
};
