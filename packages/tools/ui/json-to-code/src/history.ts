/**
 * What the tool history keeps of the JSON to Code tool (D17, docs/tools/history.md §10: «образец, язык, результат», as
 * `json`): the sample with the language and options as edit snapshots, and each result a person takes or asks for —
 * Copy, Generate — with the result. The texts go into blobs (deduplicated by content); the payload holds the options
 * and the outcome. The declaration and the payload's types only: the definition imports this module, so labels and the
 * reading of payloads live in entries.ts.
 */
import type { JsonErrorInfo, Language } from '@workspace/tool-logic-json-to-code';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonToCodeHistory: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
  ],
  schema: 1,
  records:
    'The JSON sample you typed or pasted with the language and options, and each result you copied or generated, with the result.',
  never:
    'A sample over 16 MiB (the tool does not take it). Samples are kept in clear as written — a master password does not encrypt them.',
};

/** The options of an entry. */
export type JsonToCodeOptionsPayload = {
  language: Language;
  /** The Root type field as typed. */
  rootName: string;
  declaration: 'interface' | 'type';
  exportTypes: boolean;
};
/** An edit snapshot (`edit`). */
export type JsonToCodeEditPayload = JsonToCodeOptionsPayload;
/** A result taken or asked for (`result`). */
export type JsonToCodeResultPayload = JsonToCodeOptionsPayload & {
  action: 'copy' | 'generate';
  ok: boolean;
  /** How many samples were merged, when there is a result. */
  samples?: number;
  error?: Pick<JsonErrorInfo, 'line' | 'column' | 'message'>;
};
