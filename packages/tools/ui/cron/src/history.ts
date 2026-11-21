/**
 * What the tool history keeps of the Cron tool (D17): the row of docs/tools/history.md §10 for `cron` — the expression
 * and the time zone, in clear (a schedule is not a secret), with the dialect and the number of runs so an entry opens
 * as it was; the next runs are worked out again. An edit that reads is a snapshot (`change`); Copy description and Copy
 * runs are commits. The declaration alone: payloads and labels are in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const cronHistory: HistoryDeclaration = {
  kinds: [{ id: 'explain', title: 'Explained' }],
  schema: 1,
  records: 'The cron expressions you typed or pasted, with the dialect, the time zone and the number of runs shown.',
  never: 'Nothing else: the next runs are worked out again when an entry is opened. Entries are kept in clear.',
};
