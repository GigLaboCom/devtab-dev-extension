/**
 * What the tool history keeps of the Base64 tool (D17, docs/tools/history.md §10, row 2): the input, the direction,
 * the alphabet, padding and line length, and the result. One kind per direction, so History can show what was encoded
 * and what was decoded. Edits are snapshots (`change`); Copy and Swap — the moments the result was taken — are
 * committed. The input and the result go into blobs (deduplicated by content); the payload holds the options and the
 * outcome. Kept in clear: the history row is open, not secret (docs/tools/history.md §11, question 2). This module is
 * part of the definition (every host page that lists the tools), so the labels and guards live in `entries.ts`.
 */
import type { Base64Alphabet } from '@workspace/tool-logic-base64';
import type { HistoryDeclaration } from '@workspace/tools-host';

export type Mode = 'encode' | 'decode';
export type LineLength = 0 | 64 | 76;

export const base64History: HistoryDeclaration = {
  kinds: [
    { id: 'encode', title: 'Encoded' },
    { id: 'decode', title: 'Decoded' },
  ],
  schema: 1,
  records: 'The text or Base64 you typed or pasted, the direction, alphabet, padding and line length, and the result.',
  never:
    'An input over 5 MB (the tool refuses it). Base64 and what it decodes to are kept in clear — a master password does not encrypt them.',
};

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type Base64Payload = {
  mode: Mode;
  alphabet: Base64Alphabet;
  padding: boolean;
  lineLength: LineLength;
  outcome: 'text' | 'hex' | 'error';
  byteCount?: number;
  error?: { message: string; line?: number; column?: number };
  action?: 'copy' | 'swap';
};
