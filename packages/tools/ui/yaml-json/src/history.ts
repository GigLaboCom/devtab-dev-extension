/**
 * What the tool history keeps of the YAML and JSON tool (D17, docs/tools/history.md §10, row 11): the input, the
 * direction, the YAML version and the indent, and the result. One kind per direction. Edits are snapshots (`change`);
 * Copy, Save and Swap — the moments the result was taken — are committed. Kept in clear, as the row says (configuration
 * files can hold secrets: docs/tools/history.md §11, question 2). This module is part of the definition (every host
 * page that lists the tools), so the labels and guards live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const yamlJsonHistory: HistoryDeclaration = {
  kinds: [
    { id: 'to-json', title: 'YAML → JSON' },
    { id: 'to-yaml', title: 'JSON → YAML' },
  ],
  schema: 1,
  records: 'The YAML or JSON you typed, pasted or opened, the direction, YAML version and indent, and the result.',
  never:
    'An input over 8 MB (the tool refuses it). YAML and JSON are kept in clear as written, secrets in them included — a master password does not encrypt them.',
};
