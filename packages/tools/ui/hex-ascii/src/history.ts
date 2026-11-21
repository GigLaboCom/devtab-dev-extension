/**
 * What the tool history keeps of the Hex and Text tool (D17, docs/tools/history.md §10, row 19): the input, the encoding,
 * the direction and the output options, and the result. One kind per direction. Edits are snapshots (`change`); Copy
 * and Swap — the moments the result was taken — are committed. The input and the result go into blobs as text: hex is
 * text, so bytes that are not valid text in the chosen encoding are kept exactly as their hex input, and the shown text
 * (with U+FFFD) is the result beside it. Kept in clear (hex can be the bytes of a key: docs/tools/history.md §11,
 * question 2). This module is part of the definition (every host page that lists the tools), so the labels and guards
 * live in `entries.ts`.
 */
import type { OutputFormat, TextEncodingId } from '@workspace/tool-logic-hex-ascii';
import type { HistoryDeclaration } from '@workspace/tools-host';

export type Mode = 'to-hex' | 'to-text';
export type BytesPerLine = 0 | 8 | 16 | 32;

export const hexAsciiHistory: HistoryDeclaration = {
  kinds: [
    { id: 'to-hex', title: 'Text → hex' },
    { id: 'to-text', title: 'Hex → text' },
  ],
  schema: 1,
  records: 'The text or hex you typed or pasted, the direction, encoding and format, and the result.',
  never:
    'An input over the limits (1 MB of text, 5 MB of hex: the tool refuses it). Hex and text are kept in clear — a master password does not encrypt them.',
};

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type HexAsciiPayload = {
  mode: Mode;
  encoding: TextEncodingId;
  format: OutputFormat;
  uppercase: boolean;
  bytesPerLine: BytesPerLine;
  outcome: 'ok' | 'error';
  byteCount?: number;
  /** Hex to text: where the bytes stop being valid text in `encoding` (1-based), when they do. */
  firstInvalidByte?: number;
  error?: { message: string; line: number; column: number };
  action?: 'copy' | 'swap';
};
