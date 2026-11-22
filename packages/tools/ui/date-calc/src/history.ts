/**
 * What the tool history keeps of the Date Calculator (D17): the row of docs/tools/history.md §10 for `date-calc` — one
 * kind per part of the page, in clear (a moment, a duration, a list of zones are not secrets; as Unix Time and Cron). An
 * edit after which the part has a result is a snapshot (`change`); a copy in the part is a commit. The declaration alone:
 * payloads and labels are in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const dateCalcHistory: HistoryDeclaration = {
  kinds: [
    { id: 'difference', title: 'Difference' },
    { id: 'shift', title: 'Added or subtracted' },
    { id: 'zones', title: 'Time zones' },
  ],
  schema: 1,
  records:
    'The moments, durations and time zones you entered in each part, with their zones and the result in ISO 8601.',
  never: 'Nothing else. Entries are kept in clear — a master password does not encrypt them.',
};
