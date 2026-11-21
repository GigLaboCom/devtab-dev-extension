/**
 * What the tool history keeps of the Case Converter (D17, docs/tools/history.md §10, row `case`): the input — the text
 * a person typed or pasted — and, when they took a result, which form they copied. The results are never kept: they
 * are worked out again from the input when an entry is opened. One kind: the tool has no modes. There is no run button,
 * so an edit is a snapshot (`change`, by the factory's rule) and copying a form — the moment a result is taken — is
 * committed at once. Kept in clear: names and phrases are not secrets. The declaration alone: the definition imports
 * this module, so labels and guards live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const caseHistory: HistoryDeclaration = {
  kinds: [{ id: 'convert', title: 'Converted' }],
  schema: 1,
  records: 'The text you typed or pasted, and which case you copied.',
  never:
    'The converted results (they are worked out again from the text) and a text over 512 KB (the tool refuses it).',
};
