/**
 * What the tool history keeps of the Text Diff tool (D17; docs/tools/history.md §10, row `text-diff`): nothing. The
 * tool has no input of its own — it only leads to «Compare code», and the comparison records nothing either.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const textDiffHistory: HistoryDeclaration = {
  kinds: [],
  schema: 1,
  records: 'Nothing: Text Diff only opens Compare code, which keeps nothing either.',
  never: 'The texts you compare.',
};
