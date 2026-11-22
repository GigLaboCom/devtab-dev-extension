/**
 * One conversion of the JSON and CSV tool and the size of its result (lines and UTF-8 bytes, for the summary that
 * replaces a result too large for its field, docs/tools/specs/json-csv.md §3). The same work on the page (live input up
 * to LIVE_INPUT, a page without workers) and in the worker (Run).
 */
import { csvToJson, jsonToCsv, measureText } from '@workspace/tool-logic-json-csv';
import type { Converted, ToCsvNotes, ToCsvOptions, ToJsonNotes, ToJsonOptions } from '@workspace/tool-logic-json-csv';

export type ConvertJob =
  | { direction: 'to-csv'; text: string; options: ToCsvOptions }
  | { direction: 'to-json'; text: string; options: ToJsonOptions };

export type Conversion = Converted<ToCsvNotes> | Converted<ToJsonNotes>;

export interface Done {
  result: Conversion;
  /** Of the result's text; null when there is none. */
  size: { lines: number; bytes: number } | null;
}

export const convertWithSize = (job: ConvertJob): Done => {
  const result = job.direction === 'to-csv' ? jsonToCsv(job.text, job.options) : csvToJson(job.text, job.options);
  return { result, size: result.ok ? measureText(result.text) : null };
};

const sameOptions = (a: object, b: object): boolean => {
  const x = a as Record<string, unknown>;
  const y = b as Record<string, unknown>;
  const keys = Object.keys(x);
  return keys.length === Object.keys(y).length && keys.every(k => x[k] === y[k]);
};

export const sameJob = (a: ConvertJob, b: ConvertJob): boolean =>
  a.direction === b.direction && a.text === b.text && sameOptions(a.options, b.options);
