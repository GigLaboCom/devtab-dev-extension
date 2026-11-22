/**
 * What the tool history keeps of the HTML Preview tool (D17, docs/tools/history.md §10, row 24): the HTML as typed or
 * pasted and the width chosen — an edit snapshot (`change`), and a commit when the checked HTML is taken (Copy HTML).
 * The text goes into a blob; what the frame showed is never kept (it is drawn again from the text). Kept in clear: not a
 * secret (row 24) — though a pasted mail or page may carry a person's data (docs/defaults.md, «Спорные умолчания»). The
 * declaration and the payload's type only: the definition imports this module, so labels and guards live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const htmlPreviewHistory: HistoryDeclaration = {
  kinds: [{ id: 'preview', title: 'Previewed' }],
  schema: 1,
  records: 'The HTML you typed or pasted, the width you chose, and when you copied the checked HTML.',
  never:
    'What the preview showed (it is drawn again from the HTML), or a text over 1 MB (the tool refuses it). What is kept is kept in clear — a master password does not encrypt it.',
};

/** Payload of schema 1: the width chosen; `action` is set when the person took the HTML (committed). */
export type HtmlPreviewPayload = { width: 'fit' | '375' | '768' | '1024'; action?: 'copy' };
