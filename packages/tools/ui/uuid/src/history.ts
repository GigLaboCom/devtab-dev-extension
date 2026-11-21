/**
 * What the tool history keeps of the UUID / ULID tool (D17): the row of docs/tools/history.md §10 for `uuid` —
 * generated and inspected identifiers, the type, and the namespace and name of v3 / v5, in clear (identifiers are not
 * secrets). Generate commits a batch, so does Copy; an edit of the options is a snapshot (`change`); Inspect records an
 * identifier that parsed. The payload holds the options and the identifiers as shown (`entries.ts`). This module is
 * part of every host page that lists the tools, so it holds the declaration only.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const uuidHistory: HistoryDeclaration = {
  kinds: [
    { id: 'generate', title: 'Generated' },
    { id: 'inspect', title: 'Inspected' },
  ],
  schema: 1,
  records:
    'The identifiers you generated or inspected, with the type and format, and the namespace and name of UUID v3 and v5.',
  never: 'Nothing else. Identifiers are kept in clear — a master password does not encrypt them.',
};
