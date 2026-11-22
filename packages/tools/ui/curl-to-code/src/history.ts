/**
 * What the tool history keeps of the cURL to Code tool (D17; docs/tools/history.md §10, row `curl-to-code`): a command
 * carries authorisation headers, cookies and passwords, and telling them apart by recognition is unreliable — so the
 * command, the language and the code are one secret kind. The history writes it only encrypted, with a master password
 * set and the history unlocked; otherwise it keeps nothing, and the tool says so. The declaration only: the draft and
 * the payload's reader are in entries.ts, loaded with the component.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const curlToCodeHistory: HistoryDeclaration = {
  kinds: [{ id: 'converted', title: 'Converted', secret: true }],
  schema: 1,
  records: 'Commands you converted, with the language and the code — only encrypted, with a master password.',
  never: 'Commands without an unlocked master password, and never in clear.',
};
