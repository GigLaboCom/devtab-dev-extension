/**
 * What the tool history keeps of the Code Formatter (D17, docs/tools/history.md §10, row 20): the code (typed, pasted
 * or opened from a file), the language as chosen and as recognised, the options and the result — in clear, "as json".
 * One kind: an edit is a snapshot (`change`) once its result is there; Run, Copy and Save are committed. Source code can
 * hold secrets (docs/tools/history.md §11, question 2): the declaration says so. The declaration alone — labels and
 * guards live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const codeFormatHistory: HistoryDeclaration = {
  kinds: [{ id: 'format', title: 'Formatted' }],
  schema: 1,
  records: 'The code you typed, pasted or opened, its language, the options and the formatted result.',
  never:
    'Code over the language’s limit (the tool refuses it). Code is kept in clear as written, secrets in it included — a master password does not encrypt it.',
};
