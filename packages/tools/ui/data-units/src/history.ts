/**
 * What the tool history keeps of the Data Units tool (D17): the row of docs/tools/history.md §10 for `data-units` — a
 * value converted and a transfer worked out, in clear (a file's size and a line's rate are not secrets; as Number Bases
 * and Unix Time). An edit that reads is a snapshot (`change`); a copy is a commit. The declaration alone: payloads and
 * labels are in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const dataUnitsHistory: HistoryDeclaration = {
  kinds: [
    { id: 'convert', title: 'Converted' },
    { id: 'transfer', title: 'Transfer time' },
  ],
  schema: 1,
  records:
    'The values you converted, and the sizes, rates, times and overhead you worked a transfer out from, with how KB, MB, GB were read.',
  never:
    'Nothing else: results are worked out again. Entries are kept in clear — a master password does not encrypt them.',
};
