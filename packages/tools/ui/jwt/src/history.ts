/**
 * What the tool history keeps of the JWT tool (D17; docs/tools/history.md §10, row `jwt`): a token is a bearer pass and
 * its payload is a person's data, an HMAC secret or a key is a key — so both kinds are secret. The history writes a
 * secret kind only encrypted, with a master password set and the history unlocked; otherwise it keeps nothing, and the
 * tool says so. Part of the definition, so of every host page that lists the tools: the declaration only — the payload
 * and the labels are in payload.ts, loaded with the component.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const jwtHistory: HistoryDeclaration = {
  kinds: [
    { id: 'decoded', title: 'Decoded', secret: true },
    { id: 'checked', title: 'Checked with a key', secret: true },
    { id: 'signed', title: 'Signed', secret: true },
  ],
  schema: 1,
  records:
    'Tokens you decoded, with the signature result and the key you checked them with, and tokens you signed with their header and payload — only encrypted, with a master password.',
  never:
    'Tokens and keys without an unlocked master password, and never in clear; the key or secret a token was signed with, ever.',
};
