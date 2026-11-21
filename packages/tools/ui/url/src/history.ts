/**
 * What the tool history keeps of the URL tool (D17, docs/tools/history.md §10 row `url`): the input, the mode with its
 * option and the result — as edit snapshots, and at once on Swap and on copying the result. The text goes into blobs;
 * the payload holds the mode and the option.
 *
 * A URL may carry credentials in its authority (`https://user:token@host/`). The row keeps the tool in clear and leaves
 * secrets to the owner's question 2; this declaration takes the cautious reading for what can be told by the URL's own
 * syntax: whenever the input or the result holds `scheme://…@` — user info, with or without a password — the record
 * goes to the secret kind, written only encrypted, with a master password and the history unlocked (else not at all).
 * A token in the query is not recognised (by name it would be guessing) and is kept in clear: question 2 stays open.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export type UrlMode = 'encode' | 'decode' | 'parse';
export type UrlStyle = 'component' | 'form' | 'whole';

export const urlHistory: HistoryDeclaration = {
  kinds: [
    { id: 'encode', title: 'Encoded' },
    { id: 'decode', title: 'Decoded' },
    { id: 'parse', title: 'Parsed' },
    { id: 'credentials', title: 'With credentials', secret: true },
  ],
  schema: 1,
  records:
    'The text you encoded, decoded or parsed, the mode and its option, and the result. A URL with a user name or password in it is kept only encrypted, with a master password.',
  never:
    'A URL with a user name or password when no master password is set or the history is locked. Tokens in a query are not recognised and are kept as typed.',
};
