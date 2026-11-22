/**
 * What the tool history keeps of the Markdown Preview tool (D17, docs/tools/history.md §10, row 23): the Markdown as
 * typed or pasted — an edit snapshot (`change`), and a commit when the preview's HTML is taken (Copy HTML). The text
 * goes into a blob; the preview's HTML is never kept (it is drawn again from the text). Kept in clear: not a secret
 * (row 23). The declaration and the payload's type only: the definition imports this module, so labels and guards live
 * in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const markdownPreviewHistory: HistoryDeclaration = {
  kinds: [{ id: 'preview', title: 'Previewed' }],
  schema: 1,
  records: 'The Markdown you typed or pasted, and when you copied its HTML.',
  never:
    'The preview’s HTML (it is drawn again from the Markdown), or a text over 1 MB (the tool refuses it). What is kept is kept in clear — a master password does not encrypt it.',
};

/** Payload of schema 1. `action` is set when the person took the HTML (committed), absent for an edit snapshot. */
export type MarkdownPreviewPayload = { action?: 'copy' };
