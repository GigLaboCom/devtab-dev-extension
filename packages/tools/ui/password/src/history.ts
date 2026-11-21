/**
 * What the tool history keeps of the Password Generator (D17; docs/tools/history.md §10, row `password`): the
 * passwords and passphrases a person generated or copied, with their settings — one secret kind. The history writes a
 * secret kind only encrypted, with a master password set and the history unlocked; otherwise it keeps nothing and the
 * tool says so. The tool does not branch on that: it records the same way and the factory decides.
 *
 * When: a press of Generate, Copy or Copy all is a `commit` (the person took this set); a change of the settings, which
 * makes new passwords at once, is a `change` (the checkpoint rule writes the last one once they are still). Opening the
 * tool and opening an entry record nothing.
 *
 * This module is part of the definition, so of every host page that lists the tools (the start page too): the
 * declaration and types only — the label of an entry is in payload.ts, loaded with the component.
 */
import type { Settings } from '@workspace/tool-logic-password';
import type { HistoryDeclaration } from '@workspace/tools-host';

export const passwordHistory: HistoryDeclaration = {
  kinds: [{ id: 'generated', title: 'Generated', secret: true }],
  schema: 1,
  records:
    'The passwords and passphrases you generated or copied, with their settings — only encrypted, with a master password set and the history unlocked.',
  never: 'Generated passwords without a master password or while the history is locked, and never in clear.',
};

/** Payload of schema 1: the settings as the tool understood them and the passwords it showed. */
export type PasswordPayload = { settings: Settings; values: string[] };
