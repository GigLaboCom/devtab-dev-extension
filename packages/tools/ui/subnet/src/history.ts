/**
 * What the tool history keeps of the Subnet Calculator (D17; docs/tools/history.md §10, row `subnet`): the block of
 * Explain and Split as edit snapshots, the lists of Match and Summarize as blobs, each copy at once. In clear: addresses
 * of a private network are not secrets, though they describe someone's network (a disputed default, docs/defaults.md
 * §5). The declaration and the payload's types only: labels and readers live in entries.ts.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const subnetHistory: HistoryDeclaration = {
  kinds: [
    { id: 'explain', title: 'Explained' },
    { id: 'split', title: 'Split' },
    { id: 'match', title: 'Matched' },
    { id: 'summarize', title: 'Summarized' },
  ],
  schema: 1,
  records:
    'The block you explained or split (with how it was split), and the lists of addresses and blocks you matched or summarized, with the outcome.',
  never:
    'A list over 8 MB or 500,000 entries (the tool does not take it), and the copied text itself. Kept in clear — a master password does not encrypt it.',
};

/** Schema 1, `explain`: the Block field as typed and the block it reads as. */
export type ExplainPayload = { block: string; network: string };

/** Schema 1, `split`: the Block field, how it is split, and into how many subnets. */
export type SplitPayload = { block: string; by: 'prefix' | 'count'; prefix: string; count: string; subnets: string };

/** Schema 1, `match`: the two lists are the blobs `addresses` and `blocks`; here what came of them. */
export type MatchPayload = { addresses: number; blocks: number; inside: number };

/** Schema 1, `summarize`: the list is the blob `list`; here what came of it. */
export type SummarizePayload = { entries: number; blocks: number };
