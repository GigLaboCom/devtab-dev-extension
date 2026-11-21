/**
 * The Number Bases tool's history entries (schema 1 of `numberBaseHistory`): the payload, the label for the History list
 * and the reading of a payload back. Loaded with the component, not with the definition.
 */
import type { NegativeMode, Width } from '@workspace/tool-logic-number-base';
import type { HistoryDraft } from '@workspace/tools-host';

export type FieldId = 'binary' | 'octal' | 'decimal' | 'hexadecimal' | 'base';

export const FIELD_IDS: readonly FieldId[] = ['binary', 'octal', 'decimal', 'hexadecimal', 'base'];

export const FIELD_LABEL: Record<FieldId, string> = {
  binary: 'Binary',
  octal: 'Octal',
  decimal: 'Decimal',
  hexadecimal: 'Hexadecimal',
  base: 'Base',
};

/** Payload of schema 1: the field as typed, which field it was, the options, and the number it was read as. */
export type ConvertPayload = {
  field: FieldId;
  text: string;
  /** The Base field's N as typed. */
  radix: string;
  negative: NegativeMode;
  width: Width;
  uppercase: boolean;
  grouped: boolean;
  prefixes: boolean;
  /** The number read, in decimal (the signed reading in two's complement). */
  decimal: string;
};

const clip = (text: string, n = 40): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** "Hexadecimal 0xFF = 255" in the History list; the text as typed and the decimal number are searchable. */
export const convertDraft = (payload: ConvertPayload): HistoryDraft => {
  const field = payload.field === 'base' ? `Base ${payload.radix.trim()}` : FIELD_LABEL[payload.field];
  const twos = payload.negative === 'twos' ? ` · two's complement, ${payload.width} bits` : '';
  return {
    kind: 'convert',
    payload,
    label: `${field} ${clip(payload.text.trim())} = ${clip(payload.decimal)}${twos}`,
    text: `${payload.text.trim()}\n${payload.decimal}`.slice(0, 2000),
  };
};

const WIDTHS = new Set<unknown>([8, 16, 32, 64]);

/** A payload read back from History, field by field (an older or damaged entry falls back to the defaults). */
export const readConvertPayload = (value: unknown): Omit<ConvertPayload, 'decimal'> => {
  const p = (value ?? {}) as Partial<Record<keyof ConvertPayload, unknown>>;
  return {
    field: FIELD_IDS.includes(p.field as FieldId) ? (p.field as FieldId) : 'decimal',
    text: typeof p.text === 'string' ? p.text : '',
    radix: typeof p.radix === 'string' ? p.radix : '36',
    negative: p.negative === 'twos' ? 'twos' : 'sign',
    width: WIDTHS.has(p.width) ? (p.width as Width) : 32,
    uppercase: p.uppercase === true,
    grouped: p.grouped === true,
    prefixes: p.prefixes === true,
  };
};
