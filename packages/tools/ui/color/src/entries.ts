/** The Color tool's history entries as the component writes and reads them: the draft, its label, a guard. */
import type { ColorPayload } from './history';
import type { HistoryDraft } from '@workspace/tools-host';

/** "#ff8800 on #ffffff": what the History list shows. */
export const colorLabel = (p: ColorPayload): string =>
  p.background.trim() === '' ? p.color.trim() : `${p.color.trim()} on ${p.background.trim()}`;

export const colorDraft = (p: ColorPayload): HistoryDraft => ({
  kind: 'convert',
  payload: p,
  label: colorLabel(p),
  text: `${p.color.trim()} ${p.background.trim()}`.trim(),
});

export const isColorPayload = (v: unknown): v is ColorPayload =>
  typeof v === 'object' &&
  v !== null &&
  typeof (v as ColorPayload).color === 'string' &&
  typeof (v as ColorPayload).background === 'string';
