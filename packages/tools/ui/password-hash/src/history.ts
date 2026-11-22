/**
 * What the tool history keeps of the Password Hash tool (D17): the row of docs/tools/history.md §10 for
 * `password-hash`. Both kinds are secret — a hash is not the password, but it is what is cracked offline — so the
 * history writes them only encrypted, with a master password and the history unlocked. The password itself is never
 * part of a record. The declaration alone: labels and the payload's readers live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const passwordHashHistory: HistoryDeclaration = {
  kinds: [
    { id: 'hashed', title: 'Hashed', secret: true },
    { id: 'verified', title: 'Verified', secret: true },
  ],
  schema: 1,
  records: 'The hashes you made or checked, with the algorithm, parameters and format, only encrypted.',
  never: 'The password, ever.',
};
