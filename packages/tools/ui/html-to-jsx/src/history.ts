/**
 * What the tool history keeps of the HTML to JSX tool (D17, docs/tools/history.md §10, row 33): the input and the
 * result, in clear — not a secret. One kind: an edit is a snapshot (`change`) once its result is there; Copy and
 * Convert — the moments a result is taken or asked for — are committed. The input and the result go into blobs; the
 * payload holds the option and the notes. The declaration and the payload's type only: the definition imports this
 * module, so labels and guards live in entries.ts.
 */
import type { JsxNote } from '@workspace/tool-logic-html-to-jsx';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const htmlToJsxHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records: 'The HTML you typed or pasted, whether it was wrapped in a component, and the JSX.',
  never:
    'An empty input, and an input over 4 MB (the tool refuses it). What is kept is kept in clear — a master password does not encrypt it.',
};

/** Payload of schema 1. `action` is set when the person took or asked for the result (committed), absent for an edit. */
export type HtmlToJsxPayload = {
  component: boolean;
  notes: JsxNote[];
  action?: 'copy' | 'convert';
};
