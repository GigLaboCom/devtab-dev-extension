/**
 * What the tool history keeps of the JSON tool (D17, docs/tools/history.md §10): the text with its options as edit
 * snapshots, and each result a person takes or asks for — Copy, Save, Run — with the result. The texts go into blobs
 * (deduplicated by content); the payload holds the options and the outcome. The declaration and the payload's types
 * only: the definition imports this module, so labels, guards and the reading of older payloads live in entries.ts.
 */
import type { Indent, JsonErrorInfo, Layout } from '@workspace/tool-logic-json';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonHistory: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
  ],
  schema: 2,
  records:
    'The JSON you typed, pasted or opened with its options (mode, indent, key order, comments), and each result you copied, saved or ran, with the result.',
  never:
    'A text over 32 MiB (the tool does not take it). JSON is kept in clear as written — a master password does not encrypt it.',
};

/** The options of an entry, schema 2. */
export type JsonOptionsPayload = {
  layout: Layout;
  sortKeys: boolean;
  allowComments: boolean;
  /** The opened file's name, when the text came from a file too large for the input field. */
  file?: string;
};
/** Schema 2: an edit snapshot (`edit`). */
export type JsonEditPayload = JsonOptionsPayload;
/** Schema 2: a result taken or asked for (`result`). */
export type JsonResultPayload = JsonOptionsPayload & {
  action: 'copy' | 'save' | 'run';
  ok: boolean;
  error?: Pick<JsonErrorInfo, 'line' | 'column' | 'message'>;
};

/** Schema 1, written by the first version of the tool: still opened (entries.ts, `readEntry`). */
export type JsonEditPayloadV1 = { indent: Indent; sortKeys: boolean };
export type JsonResultPayloadV1 = JsonEditPayloadV1 & {
  action: 'format' | 'minify';
  ok: boolean;
  error?: Pick<JsonErrorInfo, 'line' | 'column' | 'message'>;
};
