/**
 * What the tool history keeps of the Compress / Decompress tool (D17, docs/tools/history.md §10, row 37): one kind per
 * direction, open (as base64 and base64-image). The input — the field's text or a file's bytes — as a blob, only when it
 * is at most 1 MiB; a larger input is not recorded at all. Never a file's name (it says what is inside) and never the
 * result (it is made again from the input). An edit is a snapshot, choosing a file, Copy and Save are commits. The
 * declaration alone: labels and payload readers live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const compressHistory: HistoryDeclaration = {
  kinds: [
    { id: 'decompress', title: 'Decompressed' },
    { id: 'compress', title: 'Compressed' },
  ],
  schema: 1,
  records: 'What you decompressed or compressed (up to 1 MiB), the format, the options and the sizes.',
  never: 'An input over 1 MiB, a file’s name, and the result (it is made again from the input).',
  // An input over 1 MiB is not kept (entries.ts: no entry is written).
  maxBlobBytes: 1024 * 1024,
};
