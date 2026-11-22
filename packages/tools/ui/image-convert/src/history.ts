/**
 * What the tool history keeps of the Image Converter (D17, docs/tools/history.md §10, row 44). Pictures are often
 * personal — a screenshot of a conversation, a scanned document, a photo with the place it was taken — so neither the
 * pixels nor the file names are ever kept, of the sources or the results. Kept, in clear: the parameters of a Convert or
 * a Make icons and, for each file, its type, size in pixels and bytes before and after, or the reason it failed. One
 * entry when Convert or Make icons ends (a commit); Save and Save all add none. The declaration alone: drafts and
 * readers live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const imageConvertHistory: HistoryDeclaration = {
  kinds: [
    { id: 'convert', title: 'Converted' },
    { id: 'icons', title: 'Icons made' },
  ],
  schema: 1,
  records: 'The settings of each conversion or icon set, and the images’ types and sizes in pixels and bytes.',
  never: 'The pictures themselves and the files’ names.',
};
