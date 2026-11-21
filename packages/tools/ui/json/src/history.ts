/**
 * What the tool history keeps of the JSON tool (D17, docs/tools/history.md): the text and the options as edit
 * snapshots, and every Format / Minify with its result. The text goes into blobs (deduplicated by content: formatting the
 * same input twice keeps it once); the payload holds the options and the outcome. The declaration and the payload's types
 * only: the definition imports this module, so the labels and guards live in entries.ts.
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
