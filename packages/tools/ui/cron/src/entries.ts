/**
 * The Cron tool's history entries (schema 1 of `cronHistory`): the payload, the label for the History list and the
 * reading of a payload back. Loaded with the component, not with the definition.
 */
import { RUN_COUNTS } from '@workspace/tool-logic-cron';
import type { DialectOption } from '@workspace/tool-logic-cron';
import type { HistoryDraft } from '@workspace/tools-host';

/** Payload of schema 1: the expression as typed, the options, and how it was read. */
export type ExplainPayload = {
  expression: string;
  dialect: DialectOption;
  timeZone: string;
  runs: number;
  /** "Unix cron (5 fields)" — what Read as said. */
  readAs: string;
  /** The description, or null when there was none. */
  description: string | null;
};

const DIALECTS = new Set<string>(['auto', 'unix', 'seconds', 'quartz']);
const clip = (text: string, n = 60): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

/** "0 9 * * 1-5 — At 09:00, Monday through Friday" in the History list; the expression and the words are searchable. */
export const explainDraft = (payload: ExplainPayload): HistoryDraft => {
  const expression = payload.expression.trim();
  const words = payload.description ?? payload.readAs;
  return {
    kind: 'explain',
    payload,
    label: `${clip(expression)} — ${clip(words, 80)}`,
    text: `${expression}\n${words}`.slice(0, 2000),
  };
};

export interface ReadPayload {
  expression: string;
  dialect: DialectOption;
  timeZone?: string;
  runs: number;
}

/** A payload read back from History, field by field (an older or damaged entry falls back to defaults). */
export const readExplainPayload = (value: unknown): ReadPayload => {
  const p = (value ?? {}) as Partial<Record<keyof ExplainPayload, unknown>>;
  return {
    expression: typeof p.expression === 'string' ? p.expression : '',
    dialect: typeof p.dialect === 'string' && DIALECTS.has(p.dialect) ? (p.dialect as DialectOption) : 'auto',
    ...(typeof p.timeZone === 'string' ? { timeZone: p.timeZone } : {}),
    runs: (RUN_COUNTS as readonly unknown[]).includes(p.runs) ? (p.runs as number) : 10,
  };
};
