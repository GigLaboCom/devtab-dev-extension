/**
 * What the tool history keeps of the Number Bases tool (D17): the row of docs/tools/history.md §10 for `number-base` —
 * the number and its base, in clear (a number is not a secret). An edit that reads as a number is a snapshot
 * (`change`); copying a field or a row of details is a commit — the tool has no Run button, and a copy is the moment a
 * person takes a result. The declaration alone: the definition imports this module, so the payload, the labels and the
 * reading back live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const numberBaseHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records: 'The numbers you typed or pasted, the field and base they were read in, the options, and the number read.',
  never: 'Nothing else. Entries are kept in clear — a master password does not encrypt them.',
};
