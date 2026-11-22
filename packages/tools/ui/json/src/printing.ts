/**
 * One print job of the JSON tool: the result and, when there is one, its size for the summary (lines and UTF-8 bytes,
 * docs/tools/specs/json.md §3). The same work on the page (live input, a page without workers) and in the worker.
 */
import { measureText, printJson } from '@workspace/tool-logic-json';
import type { JsonResult, PrintOptions } from '@workspace/tool-logic-json';

export interface PrintJob extends PrintOptions {
  text: string;
}

export interface Printed {
  result: JsonResult;
  /** Of the result's text; null when there is none. */
  size: { lines: number; bytes: number } | null;
}

export const printWithSize = (job: PrintJob): Printed => {
  const result = printJson(job.text, job);
  if (!result.ok) return { result, size: null };
  const { lines, bytes } = measureText(result.text);
  return { result, size: { lines, bytes } };
};
