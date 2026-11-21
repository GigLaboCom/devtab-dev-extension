/**
 * What the tool history keeps of the Lines tool (D17, docs/tools/history.md §10, row 16): the input, the steps with
 * their options, and the result. One kind: the tool has one kind of work. An edit — of the text or of a step — is a
 * snapshot (`change`); Copy and Use as input, the moments the result is taken, are committed. With Shuffle on, the
 * entry also keeps the random bytes the order was drawn from, so it opens back in the same order. Kept in clear: the
 * row is open, not secret. This module is part of the definition (every host page that lists the tools), so the
 * labels and guards live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const linesHistory: HistoryDeclaration = {
  kinds: [{ id: 'process', title: 'Processed' }],
  schema: 1,
  records: 'The lines you typed or pasted, the steps with their options, and the result.',
  never:
    'Text over 8 MB or 200,000 lines (the tool refuses it). Lines are kept in clear — a master password does not encrypt them.',
};
