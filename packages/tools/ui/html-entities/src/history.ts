/**
 * What the tool history keeps of the HTML Entities tool (D17, docs/tools/history.md §10, row 17): the input, the
 * direction, the Encode options and the result. One kind per direction, so History can show what was encoded and what
 * was decoded. Edits are snapshots (`change`); Copy and Swap — the moments the result was taken — are committed. The
 * input and the result go into blobs; the payload holds the options. Kept in clear: not a secret (row 17). This module
 * is part of the definition (every host page that lists the tools), so labels and guards live in `entries.ts`.
 */
import type { EncodeScope, NumericFormat } from '@workspace/tool-logic-html-entities';
import type { HistoryDeclaration } from '@workspace/tools-host';

export type Mode = 'encode' | 'decode';

export const htmlEntitiesHistory: HistoryDeclaration = {
  kinds: [
    { id: 'encode', title: 'Encoded' },
    { id: 'decode', title: 'Decoded' },
  ],
  schema: 1,
  records:
    'The text you typed or pasted, the direction, what Encode escapes and how it writes numbers, and the result.',
  never:
    'An input over 5 MB (the tool refuses it). What is kept is kept in clear — a master password does not encrypt it.',
};

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type HtmlEntitiesPayload = {
  mode: Mode;
  scope: EncodeScope;
  format: NumericFormat;
  action?: 'copy' | 'swap';
};
