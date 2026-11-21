/**
 * What the tool history keeps of the JSON tool (D17, docs/tools/history.md): the text and the options as edit
 * snapshots, and every Format / Minify with its result. The text goes into blobs (deduplicated by content: formatting the
 * same input twice keeps it once); the payload holds the options and the outcome.
 */
import type { Indent, JsonErrorInfo } from '@workspace/tool-logic-json';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonHistory: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
  ],
  schema: 1,
  records: 'The JSON you typed, pasted or opened, the indent and key order, and each Format or Minify with its result.',
  never:
    'A text over 32 MiB (the history’s limit for one part). JSON is kept in clear as written — a master password does not encrypt it.',
};

/** Payload of schema 1. */
export type JsonEditPayload = { indent: Indent; sortKeys: boolean };
export type JsonResultPayload = JsonEditPayload & {
  action: 'format' | 'minify';
  ok: boolean;
  error?: Pick<JsonErrorInfo, 'line' | 'column' | 'message'>;
};

const INDENT_LABEL: Record<string, string> = { 2: '2 spaces', 4: '4 spaces', tab: 'Tab' };

export const resultLabel = (p: JsonResultPayload): string =>
  [
    p.action === 'format' ? `Format · ${INDENT_LABEL[String(p.indent)]}` : 'Minify',
    p.sortKeys ? 'sorted keys' : '',
    p.ok ? '' : `error at line ${p.error?.line}, column ${p.error?.column}`,
  ]
    .filter(Boolean)
    .join(' · ');

export const editLabel = (text: string): string => `Edit · ${text.length.toLocaleString('en-US')} characters`;

/** The first characters of the text, for the History list's text search. */
export const excerpt = (text: string): string => text.slice(0, 2000);

export const isIndent = (v: unknown): v is Indent => v === 2 || v === 4 || v === 'tab';
