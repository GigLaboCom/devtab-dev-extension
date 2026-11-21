/**
 * What the tool history keeps of the RegExp tool (D17; docs/tools/history.md §10, row `regexp`): the pattern, the
 * flags, the test text and the replacement, in clear — a regular expression and the text it is tried on are not secret
 * by purpose. One kind per use, so History can tell a search from a replacement. Edits are snapshots (`change`);
 * copying the regex, the matches or the result — the moments something was taken — is committed. This module is part
 * of the definition (every host page that lists the tools): the declaration only — payloads and labels are entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const regexpHistory: HistoryDeclaration = {
  kinds: [
    { id: 'match', title: 'Matched' },
    { id: 'replace', title: 'Replaced' },
  ],
  schema: 1,
  records: 'The pattern, flags, test text and replacement, and how many matches they gave.',
  never: 'A test text over 1,000,000 characters. Kept in clear: a master password does not encrypt it.',
};
