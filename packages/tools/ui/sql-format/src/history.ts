/**
 * What the tool history keeps of the SQL Formatter (D17, docs/tools/history.md §10, row 21): the query, the dialect
 * and the options, and the result — an edit as a snapshot (`change`), Copy, Save and Run at once (`commit`).
 *
 * The row keeps the tool in clear and leaves secrets to the owner's question 2 ("SQL can hold passwords in CREATE
 * USER"). This declaration takes the cautious reading for what the statement's own syntax shows: a query with a
 * password or a secret key in it (`IDENTIFIED BY`, `PASSWORD '…'`, `SECRET '…'`, a connection string with
 * `user:password@`) goes to the secret kind, written only encrypted, with a master password and the history unlocked —
 * else not at all. Other data in queries (names, e-mails in a WHERE) is kept in clear: question 2 stays open.
 * The declaration alone: labels, guards and the payload's helpers live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const sqlFormatHistory: HistoryDeclaration = {
  kinds: [
    { id: 'format', title: 'Formatted' },
    { id: 'credentials', title: 'With credentials', secret: true },
  ],
  schema: 1,
  records:
    'The SQL you typed, pasted or opened, the dialect and options, and the formatted result. A query with a password or secret key in it (IDENTIFIED BY, PASSWORD …) is kept only encrypted, with a master password.',
  never:
    'An input over 2 MB (the tool refuses it). A query with a password or secret key when no master password is set or the history is locked. Other data in queries is kept as typed.',
};
