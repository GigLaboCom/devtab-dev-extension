/**
 * The JSON tool's history entries as the component writes and reads them: the drafts, their labels, the search
 * excerpt, and the reading of a payload of either schema — schema 1 entries, written by the first version of the tool
 * (`indent`, `sortKeys` and, for a result, `action: 'format' | 'minify'`), open with the same options they were made with.
 */
import type { JsonEditPayloadV1, JsonOptionsPayload, JsonResultPayload, JsonResultPayloadV1 } from './history';
import type { Indent, JsonResult, Layout } from '@workspace/tool-logic-json';
import type { HistoryDraft } from '@workspace/tools-host';

const INDENT_LABEL: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab' };

export const isIndent = (v: unknown): v is Indent => v === 2 || v === 4 || v === 'tab';
export const isLayout = (v: unknown): v is Layout => isIndent(v) || v === 'minify';

const ACTION_LABEL: Record<JsonResultPayload['action'], string> = { copy: 'copied', save: 'saved', run: 'ran' };

/** `Format · 2 spaces · sorted keys · copied`, `Minify · comments allowed · error at line 3, column 1 · ran`. */
export const resultLabel = (p: JsonResultPayload): string =>
  [
    p.layout === 'minify' ? 'Minify' : `Format · ${INDENT_LABEL[String(p.layout)]}`,
    p.sortKeys ? 'sorted keys' : '',
    p.allowComments ? 'comments allowed' : '',
    p.ok ? '' : `error at line ${p.error?.line}, column ${p.error?.column}`,
    ACTION_LABEL[p.action],
  ]
    .filter(Boolean)
    .join(' · ');

export const editLabel = (length: number): string => `Edit · ${length.toLocaleString('en-US')} characters`;

/** The first characters of the text, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

const json = (value: string): Blob => new Blob([value], { type: 'application/json' });

export const editDraft = (text: string, options: JsonOptionsPayload): HistoryDraft => ({
  kind: 'edit',
  payload: { ...options },
  label: editLabel(text.length),
  text: excerpt(text),
  blobs: { input: json(text) },
});

export const resultDraft = (
  text: string,
  options: JsonOptionsPayload,
  action: JsonResultPayload['action'],
  result: JsonResult,
): HistoryDraft => {
  const payload: JsonResultPayload = {
    ...options,
    action,
    ok: result.ok,
    ...(result.ok
      ? {}
      : { error: { line: result.error.line, column: result.error.column, message: result.error.message } }),
  };
  return {
    kind: 'result',
    payload,
    label: resultLabel(payload),
    text: excerpt(text),
    blobs: result.ok ? { input: json(text), output: json(result.text) } : { input: json(text) },
  };
};

/**
 * The options an entry was made with, from a payload of schema 1 or 2; what is missing or not understood falls back to
 * the tool's defaults (Format, 2 spaces, keys as written, no comments).
 */
export const readEntry = (schema: number, payload: unknown): JsonOptionsPayload => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<
    JsonOptionsPayload & JsonResultPayloadV1 & JsonEditPayloadV1
  >;
  const layout: Layout =
    schema >= 2 && isLayout(p.layout) ? p.layout : p.action === 'minify' ? 'minify' : isIndent(p.indent) ? p.indent : 2;
  return {
    layout,
    sortKeys: p.sortKeys === true,
    allowComments: schema >= 2 && p.allowComments === true,
    ...(schema >= 2 && typeof p.file === 'string' ? { file: p.file } : {}),
  };
};
