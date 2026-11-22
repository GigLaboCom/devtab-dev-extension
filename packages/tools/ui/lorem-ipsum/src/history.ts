/**
 * What the tool history keeps of the Lorem Ipsum tool (D17; docs/tools/history.md §10, row `lorem-ipsum`): the settings
 * of a text, in clear — unit, count, the classic opening and the format. Never the text: it is placeholder made from
 * random bytes, and an entry opened from History makes a new text with the entry's settings (the page says so). No seed is
 * kept either: the bytes would be the text by another name.
 *
 * When: a press of Generate or Copy is a `commit` (the person asked for or took this text); a change of a setting, which
 * makes a new text at once, is a `change` (the checkpoint rule writes the last one once the settings are still). Opening
 * the tool and opening an entry record nothing; the automatic copy records nothing (Generate committed).
 *
 * This module is part of the definition, so of every host page that lists the tools: the declaration and types only —
 * labels, drafts and reading an entry back are in entries.ts, loaded with the component.
 */
import type { HistoryDeclaration } from '@workspace/tools-host';

export const loremIpsumHistory: HistoryDeclaration = {
  kinds: [{ id: 'generate', title: 'Generated' }],
  schema: 1,
  records:
    'The settings of each text you generated, changed or copied: unit, count, the classic opening and the format.',
  never: 'The text itself: an entry opens with a new text made with its settings.',
};

/** Payload of schema 1: the settings of the text shown (the logic's `LoremSettings`, plain JSON). */
export type LoremIpsumPayload = {
  unit: 'words' | 'sentences' | 'paragraphs';
  count: number;
  startWithLorem: boolean;
  format: 'plain' | 'html';
};
