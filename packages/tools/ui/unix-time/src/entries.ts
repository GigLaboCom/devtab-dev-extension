/**
 * The Unix Time tool's history entries (schema 1 of `unixTimeHistory`): the payload, the label for the History list and
 * the reading of a payload back. Loaded with the component, not with the definition.
 */
import type { UnitOption } from '@workspace/tool-logic-unix-time';
import type { HistoryDraft } from '@workspace/tools-host';

/** Payload of schema 1: the input as typed, the options, and the instant it was read as. */
export type ConvertPayload = {
  input: string;
  unit: UnitOption;
  timeZone: string;
  /** Nanoseconds since the epoch, as a decimal string (a bigint). */
  epochNs: string;
  isoUtc: string;
};

const UNITS = new Set<string>(['auto', 's', 'ms', 'us', 'ns']);
const clip = (text: string, n = 60): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** "1700000000 → 2023-11-14T22:13:20Z" in the History list; the input and the ISO form are searchable. */
export const convertDraft = (payload: ConvertPayload): HistoryDraft => ({
  kind: 'convert',
  payload,
  label: `${clip(payload.input.trim())} → ${payload.isoUtc}`,
  text: `${payload.input.trim()}\n${payload.isoUtc}`.slice(0, 2000),
});

/** A payload read back from History, field by field (an older or damaged entry falls back to defaults). */
export const readConvertPayload = (value: unknown): Pick<ConvertPayload, 'input' | 'unit'> & { timeZone?: string } => {
  const p = (value ?? {}) as Partial<Record<keyof ConvertPayload, unknown>>;
  return {
    input: typeof p.input === 'string' ? p.input : '',
    unit: typeof p.unit === 'string' && UNITS.has(p.unit) ? (p.unit as UnitOption) : 'auto',
    ...(typeof p.timeZone === 'string' ? { timeZone: p.timeZone } : {}),
  };
};
