/**
 * The history entries of the Lorem Ipsum tool: the draft a text is recorded as (its settings only), its label, and
 * reading an entry back. An entry comes from storage and maybe from an older or edited file, so it is checked field by
 * field and against the limits, never trusted.
 */
import { FORMAT_LABELS, FORMATS, LIMITS, UNITS } from '@workspace/tool-logic-lorem-ipsum';
import type { LoremIpsumPayload } from './history';
import type { LoremSettings, LoremUnit } from '@workspace/tool-logic-lorem-ipsum';
import type { HistoryDraft } from '@workspace/tools-host';

const NOUNS: Readonly<Record<LoremUnit, [string, string]>> = {
  words: ['word', 'words'],
  sentences: ['sentence', 'sentences'],
  paragraphs: ['paragraph', 'paragraphs'],
};

/** The History list's line: `3 paragraphs · Plain text · classic opening`. */
export const labelOf = (s: LoremSettings): string =>
  `${s.count.toLocaleString('en-US')} ${NOUNS[s.unit][s.count === 1 ? 0 : 1]} · ${FORMAT_LABELS[s.format]} · ${
    s.startWithLorem ? 'classic opening' : 'random opening'
  }`;

/** The settings of a text as a history draft: no text, no bytes. */
export const draftOf = (s: LoremSettings): HistoryDraft => {
  const payload: LoremIpsumPayload = {
    unit: s.unit,
    count: s.count,
    startWithLorem: s.startWithLorem,
    format: s.format,
  };
  return { kind: 'generate', payload, label: labelOf(s) };
};

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** The settings of a payload of schema 1, or null when it is not one (unknown values, a count out of its limit). */
export const readSettings = (payload: unknown): LoremSettings | null => {
  if (!isRecord(payload)) return null;
  const unit = UNITS.find(u => u === payload.unit);
  const format = FORMATS.find(f => f === payload.format);
  const { count, startWithLorem } = payload;
  if (!unit || !format || typeof startWithLorem !== 'boolean') return null;
  if (typeof count !== 'number' || !Number.isInteger(count) || count < 1 || count > LIMITS[unit]) return null;
  return { unit, count, startWithLorem, format };
};
