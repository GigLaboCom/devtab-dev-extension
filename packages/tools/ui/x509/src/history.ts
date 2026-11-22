/**
 * What the tool history keeps of the X.509 Certificate tool (D17; docs/tools/history.md §10, row `x509`): certificates
 * are public, so they are kept in clear — written again as PEM from what was read, never the text as pasted. A private
 * key is never read, so it is never kept in any form, even with a master password. The declaration alone: the drafts
 * and their labels are in entries.ts, loaded with the component.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const x509History: HistoryDeclaration = {
  kinds: [{ id: 'read', title: 'Read' }],
  schema: 1,
  records: 'The certificates you read, written again as PEM, with the name of an opened file.',
  never:
    'Private keys (never read, never kept, even with a master password) and any other text around the certificates.',
};
