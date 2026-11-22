/**
 * What the tool history keeps of the Base64 Image tool (D17, docs/tools/history.md §10, row 27): the image — as a blob,
 * stored once however many entries name it — its recognised type, size in pixels and bytes, and the output form; for
 * Decode also the type the data URI declared and how the input was written, so an entry opens back as the same kind of
 * text. The Base64 text itself is never kept: it is made again from the image. The cautious reading of what the row
 * leaves open (docs/defaults.md, «Спорные умолчания»): an image over 1 MiB is not kept at all — no entry — and the
 * file's name is never kept (a name says what the picture is). One kind per direction; choosing an image, Copy, Save,
 * Copy data URI and Copy image are commits, a change of the output form or an edit of Decode's text a snapshot. Not
 * secret. The declaration alone: labels and payload readers live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const base64ImageHistory: HistoryDeclaration = {
  kinds: [
    { id: 'encode', title: 'Encoded' },
    { id: 'decode', title: 'Decoded' },
  ],
  schema: 1,
  records: 'The image you encoded or decoded (up to 1 MiB), its type, size and dimensions, and the output form.',
  never: 'An image over 1 MiB, the file’s name, and the Base64 text (it is made again from the image).',
  // An image over 1 MiB is not kept (entries.ts: MAX_KEPT_IMAGE_BYTES, no entry is written).
  maxBlobBytes: 1024 * 1024,
};
