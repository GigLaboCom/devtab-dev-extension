/**
 * What the tool history keeps of the JSON and CSV tool (D17, docs/tools/history.md §10, row 22): the input with its
 * direction and options as edit snapshots, and each result a person takes — Copy, Save, Swap — with the result. In
 * clear, as the row says; but a table is often personal data (an export of customers, staff, patients), so only a
 * pasted sample is kept: an input over 256 Ki characters — the size above which the tool converts by Run — is not
 * recorded at all, not even its options or name. The texts go into blobs; the payload holds the options and the
 * outcome. The declaration and the payload's types only: labels, drafts and reading live in entries.ts.
 */
import type { Delimiter, JsonErrorInfo, Layout } from '@workspace/tool-logic-json-csv';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jsonCsvHistory: HistoryDeclaration = {
  kinds: [
    { id: 'to-csv', title: 'JSON → CSV' },
    { id: 'to-json', title: 'CSV → JSON' },
  ],
  schema: 1,
  records:
    'The JSON or CSV you typed, pasted or opened, up to 256 Ki characters, with the direction and options, and each result you copied, saved or swapped, with the result.',
  never:
    'A table over 256 Ki characters: nothing of it, not even its options (tables are often personal data). What is kept is in clear — a master password does not encrypt it.',
};

export type Direction = 'to-csv' | 'to-json';

/** The options of both directions: an entry opens with all of them as they were. */
export type JsonCsvOptionsPayload = {
  direction: Direction;
  header: boolean;
  toCsv: {
    delimiter: Delimiter;
    flatten: boolean;
    newline: 'crlf' | 'lf';
    quoteAll: boolean;
    protectFormulas: boolean;
    bom: boolean;
  };
  toJson: {
    delimiter: Delimiter | 'auto';
    detectTypes: boolean;
    empty: 'null' | 'string' | 'omit';
    nest: boolean;
    layout: Layout;
  };
};

/** Schema 1: an edit snapshot or a result taken (`action`), of either kind. */
export type JsonCsvPayload = JsonCsvOptionsPayload & {
  action?: 'copy' | 'save' | 'swap';
  outcome: 'ok' | 'error';
  rows?: number;
  columns?: number;
  error?: Pick<JsonErrorInfo, 'line' | 'column' | 'message'>;
};
