/**
 * What the tool history keeps of the JSON Query tool (D17; docs/tools/history.md §10, row `json-query`), as the JSON
 * tool does: the document and the query as edit snapshots, and each result a person takes — Copy values, Copy paths,
 * a row's Copy value or Copy path — at once, with the query and the number of results. The document goes into a blob
 * (deduplicated by content); the copied text is not kept: the document and the query give it again. In clear, as the
 * JSON tool's. The declaration and the payload's types only: labels and readers live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonQueryHistory: HistoryDeclaration = {
  kinds: [
    { id: 'edit', title: 'Edit' },
    { id: 'result', title: 'Result' },
  ],
  schema: 1,
  records:
    'The JSON document and the query you typed or pasted, and each result you copied, with the query and the number of results.',
  never:
    'A document over 16 MB (the tool does not take it), and the copied text itself. Kept in clear as written — a master password does not encrypt it.',
};

/** Schema 1: an edit snapshot (`edit`). */
export type QueryEditPayload = {
  query: string;
  /** What the run of this state gave, when it had answered. */
  outcome?: { count: number } | { error: string };
};

/** Schema 1: a result taken (`result`). */
export type QueryResultPayload = {
  query: string;
  action: 'copy-values' | 'copy-paths' | 'copy-value' | 'copy-path';
  count: number;
};
