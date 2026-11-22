/**
 * What the tool history keeps of the Random String tool (D17; docs/tools/history.md §10, row `random-string`): the
 * strings or bytes a person generated or copied, with their settings — one secret kind, because by the tool's own
 * summary they are tokens and keys. The history writes a secret kind only encrypted, with a master password set and the
 * history unlocked; otherwise it keeps nothing and the tool says so. Nothing is kept in clear — not even the settings or
 * a custom alphabet (neither is a secret, but an entry of them alone would say only that the tool was used). The tool
 * does not branch on any of that: it records the same way and the factory decides.
 *
 * When: a press of Generate, Copy, Copy all or a row's copy button is a `commit` (the person took this batch); a change
 * of the settings, which makes a new batch at once, is a `change` (the checkpoint rule writes the last one once they are
 * still). Opening the tool and opening an entry record nothing.
 *
 * Size: the strings travel as a blob (`strings`, the batch as Copy all copies it) and bytes as the raw bytes (`bytes`),
 * at most 1 MiB (`maxBlobBytes`): every batch of the presets and of Bytes fits; a batch of a custom alphabet of long
 * characters over 1 MiB is not kept (the factory refuses it as `too-large`).
 *
 * This module is part of the definition, so of every host page that lists the tools: the declaration and types only —
 * labels, drafts and reading an entry back are in entries.ts, loaded with the component.
 */
import type { Settings } from '@workspace/tool-logic-random-string';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const randomStringHistory: HistoryDeclaration = {
  kinds: [{ id: 'generated', title: 'Generated', secret: true }],
  schema: 1,
  maxBlobBytes: 1_048_576,
  records:
    'The strings and bytes you generated or copied, with their settings — only encrypted, with a master password set and the history unlocked.',
  never:
    'Generated strings without a master password or while the history is locked, a batch over 1 MiB, and nothing in clear.',
};

/** Payload of schema 1: the settings as the tool understood them; the batch itself is a blob (see above). */
export type RandomStringPayload = { settings: Settings };
