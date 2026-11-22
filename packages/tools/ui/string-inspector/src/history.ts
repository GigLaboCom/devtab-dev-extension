/**
 * What the tool history keeps of the String Inspector (D17, docs/tools/history.md §10, row `string-inspector`): the
 * text a person typed or pasted, in clear, and — when they took a result — which one they copied. The counts, the
 * warnings and the table are never kept: they are worked out again from the text when an entry is opened. One kind:
 * the tool has no modes. There is no run button, so an edit is a snapshot (`change`, by the factory's rule) and Copy
 * summary or Copy table — the moment a result is taken — is committed at once. The History list shows counts only,
 * never the text itself (the cautious reading of the row: the text may be a password checked for a hidden character).
 * The declaration alone: the definition imports this module, so labels and guards live in `entries.ts`.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const stringInspectorHistory: HistoryDeclaration = {
  kinds: [{ id: 'inspect', title: 'Inspected' }],
  schema: 1,
  records: 'The text you typed or pasted, and whether you copied the summary or the table.',
  never:
    'The counts, warnings and table (they are worked out again from the text) and a text over 1 MB (the tool refuses it).',
};
