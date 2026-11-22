/**
 * What the tool history keeps of the SVG to CSS tool (D17, docs/tools/history.md §10, row 34): the SVG — typed or read
 * from a file, kept as a blob — the output form, the encoding, Minify and the result (a blob too). Not secret. As the
 * Base64 Image tool keeps someone else's picture, cautiously: an SVG over 1 MiB is not kept at all (no entry), and the
 * name of an opened file is never kept. An edit that gives a result is a snapshot; Copy and Open file are commits. The
 * declaration alone: labels and payload readers live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const svgToCssHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records: 'The SVG you converted (up to 1 MiB), the output form, the encoding, Minify and the result.',
  never: 'An SVG over 1 MiB, and the name of a file you opened.',
  // An SVG over 1 MiB is not kept (entries.ts: MAX_KEPT_BYTES, no entry is written).
  maxBlobBytes: 1024 * 1024,
};
