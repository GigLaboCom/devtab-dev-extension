/**
 * What the tool history keeps of the Key Pairs tool (D17; docs/tools/history.md §10, row `keys`; specification §11):
 * public keys and parameters, in clear — a public key is public. A private key is never kept in any form, even with a
 * master password (the X.509 rule), and neither is the text of a pasted private key: only the public key derived from
 * it. The declaration alone: drafts and labels are in entries.ts, loaded with the component.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const keysHistory: HistoryDeclaration = {
  kinds: [
    { id: 'generated', title: 'Generated' },
    { id: 'inspected', title: 'Inspected' },
  ],
  schema: 1,
  records:
    'Public keys you generated or inspected, with the algorithm, the fingerprint and, for a pair you generated, its settings and comment.',
  never: 'Private keys, in any form, even with a master password — and the text of a pasted private key.',
};
