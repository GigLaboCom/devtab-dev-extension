/**
 * What the tool history keeps of the Unix Time tool (D17): the row of docs/tools/history.md §10 for `unix-time` — the
 * input, the time zone and the result, in clear (an instant is not a secret). An edit that reads is a snapshot
 * (`change`); Now and a copied row are commits. This module is part of every host page that lists the tools, so it
 * holds the declaration only (payloads and labels: `entries.ts`).
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const unixTimeHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records:
    'The timestamps and dates you typed, pasted or set with Now, with the unit, the time zone and the instant read.',
  never: 'Nothing else. Entries are kept in clear — a master password does not encrypt them.',
};
