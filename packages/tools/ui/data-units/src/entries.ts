/**
 * The Data Units tool's history entries (schema 1 of `dataUnitsHistory`, docs/tools/specs/data-units.md §11): the
 * payload and label of each kind, and reading a payload back field by field (a damaged entry falls back to defaults).
 * Loaded with the component.
 */
import { DIGITS, div, parseValue, ratio, showNumber, solveTransfer } from '@workspace/tool-logic-data-units';
import type { Digits, Reading, Solve, TransferFields } from '@workspace/tool-logic-data-units';
import type { HistoryDraft } from '@workspace/tools-host';

const clip = (text: string, n = 40): string => {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

export interface ConvertState {
  value: string;
  reading: Reading;
  digits: Digits;
}

/** "250 MB = 250,000,000 bytes · decimal"; null while the value does not read. */
export const convertDraft = (s: ConvertState): HistoryDraft | null => {
  const parsed = parseValue(s.value, s.reading, s.digits);
  if (!parsed?.ok) return null;
  const { value } = parsed;
  const amount = showNumber(div(value.bits, ratio(value.unit?.base === 'bit' ? 1n : 8n)), 'exact');
  const words = `${value.unit?.base === 'bit' ? 'bits' : 'bytes'}${value.rate ? ' per second' : ''}`;
  const tail = value.unit?.system === 'ambiguous' ? ` · ${s.reading}` : '';
  return {
    kind: 'convert',
    payload: { value: s.value, reading: s.reading, digits: s.digits },
    label: `${clip(s.value)} = ${amount.text} ${words}${tail}`,
    text: s.value.slice(0, 2000),
  };
};

export interface TransferState extends TransferFields {
  reading: Reading;
  digits: Digits;
}

/** "4.7 GB at 100 Mbps → 6 minutes 16 seconds"; null while there is no answer. */
export const transferDraft = (s: TransferState): HistoryDraft | null => {
  const answer = solveTransfer(s, s.reading, s.digits);
  const result = answer.result;
  if (!result) return null;
  const { reading, digits, ...fields } = s;
  const at = s.overhead.trim() ? ` (${clip(s.overhead, 8).replace(/\s*%$/, '')} % overhead)` : '';
  const label =
    result.kind === 'time'
      ? `${clip(s.size)} at ${clip(s.rate)}${at} → ${result.words}`
      : s.solve === 'rate'
        ? `${clip(s.size)} in ${clip(s.time)} → ${showNumber(result.bits, 6).text} bit/s`
        : `${clip(s.rate)}${at} for ${clip(s.time)} → ${showNumber(div(result.bits, ratio(8n)), 6).text} bytes`;
  return {
    kind: 'transfer',
    payload: { ...fields, reading, digits },
    label,
    text: `${s.size}\n${s.rate}\n${s.time}\n${s.overhead}`.slice(0, 2000),
  };
};

export type Restored =
  | { task: 'convert'; value: string; reading: Reading; digits: Digits }
  | ({ task: 'transfer'; reading: Reading; digits: Digits } & TransferFields);

const text = (v: unknown): string => (typeof v === 'string' ? v : '');
const readingOf = (v: unknown): Reading => (v === 'binary' ? 'binary' : 'decimal');
const digitsOf = (v: unknown): Digits => ((DIGITS as readonly unknown[]).includes(v) ? (v as Digits) : 'exact');
const solveOf = (v: unknown): Solve => (v === 'rate' || v === 'size' ? v : 'time');

/** An opened entry back into its task's fields. */
export const readEntry = (kind: string, payload: unknown): Restored | null => {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === 'convert')
    return { task: 'convert', value: text(p.value), reading: readingOf(p.reading), digits: digitsOf(p.digits) };
  if (kind === 'transfer')
    return {
      task: 'transfer',
      solve: solveOf(p.solve),
      size: text(p.size),
      rate: text(p.rate),
      time: text(p.time),
      overhead: text(p.overhead),
      reading: readingOf(p.reading),
      digits: digitsOf(p.digits),
    };
  return null;
};
