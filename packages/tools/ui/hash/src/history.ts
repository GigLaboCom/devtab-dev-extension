/**
 * What the tool history keeps of the Hash tool (D17; docs/tools/history.md §10, row `hash`): everything it records is a
 * secret — people hash passwords, an HMAC key is one, and a hash of a password can be cracked offline — so both kinds are
 * `secret: true`: kept only encrypted, with a master password set and the history unlocked, and not at all otherwise.
 * The text goes into a blob; a file's contents never do — only its name, size and digests. This module is part of every
 * host page that lists the tools (the definition imports it): the declaration only — payloads and labels are entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const hashHistory: HistoryDeclaration = {
  kinds: [
    { id: 'text', title: 'Text', secret: true },
    { id: 'file', title: 'File', secret: true },
  ],
  schema: 1,
  records:
    'Only with a master password, encrypted: the text you hashed (or a file’s name and size), the HMAC key, the options and the hashes.',
  never: 'A file’s contents. Without a master password, or while the history is locked, nothing at all.',
};
