/**
 * What the tool history keeps of the String Escape tool (D17, docs/tools/history.md §10, row 18): the input, the
 * direction, the dialect with its quote and options, and the result. One kind per direction, so History can show what
 * was escaped and what was unescaped. Edits are snapshots (`change`); Copy and Swap — the moments the result was taken —
 * are committed. The input and the result go into blobs (deduplicated by content); the payload holds the options and
 * the outcome. Kept in clear: not a secret (the row's «не секрет»). This module is part of the definition (every host
 * page that lists the tools), so the labels and guards live in `entries.ts`.
 */
import type { Dialect, Quote } from '@workspace/tool-logic-backslash-escape';
import type { HistoryDeclaration } from '@workspace/tools-host';

export type Mode = 'escape' | 'unescape';

export const backslashEscapeHistory: HistoryDeclaration = {
  kinds: [
    { id: 'escape', title: 'Escaped' },
    { id: 'unescape', title: 'Unescaped' },
  ],
  schema: 1,
  records: 'The text you typed or pasted, the direction, dialect, quote and options, and the result.',
  never:
    'An input over 5 MB (the tool refuses it). The text and the result are kept in clear — a master password does not encrypt them.',
};

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type BackslashEscapePayload = {
  mode: Mode;
  dialect: Dialect;
  /** The quote chosen (Escape, JavaScript and Python); JSON and C always ". */
  quote: Quote;
  nonAscii: boolean;
  withQuotes: boolean;
  outcome: 'text' | 'error';
  error?: { message: string; line: number; column: number };
  action?: 'copy' | 'swap';
};
