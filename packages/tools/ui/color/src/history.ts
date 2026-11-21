/**
 * What the tool history keeps of the Color tool (D17, docs/tools/history.md §10 row `color`): the colour and the
 * background as typed — an edit snapshot when a person changes either (typing, a picker, Swap), and at once when a
 * format is copied. Nothing derived: the formats, the name and the contrast are worked out again when an entry opens.
 * The declaration and the payload's type only: the definition imports this module, so labels and guards live in
 * entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const colorHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records: 'The colour and the background you entered, as typed.',
  never: 'Nothing else: the formats, the name and the contrast are worked out again when an entry opens.',
};

/** Payload of schema 1: both fields as typed. */
export type ColorPayload = { color: string; background: string };
