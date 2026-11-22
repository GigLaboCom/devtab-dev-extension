/**
 * The HTML to JSX tool's history entries as the component writes and reads them: the draft, its label for the History
 * list, the search excerpt and the reading of a payload (docs/tools/history.md §10, row 33).
 */
import type { HtmlToJsxPayload } from './history';
import type { JsxNote, JsxResult } from '@workspace/tool-logic-html-to-jsx';
import type { HistoryDraft } from '@workspace/tools-host';

const ACTION_LABEL: Record<NonNullable<HtmlToJsxPayload['action']>, string> = {
  copy: 'copied',
  convert: 'converted',
};

/** `HTML → JSX · 1,234 characters · in a component · copied`. */
export const entryLabel = (payload: HtmlToJsxPayload, length: number): string =>
  [
    'HTML → JSX',
    `${length.toLocaleString('en-US')} characters`,
    payload.component ? 'in a component' : '',
    payload.action ? ACTION_LABEL[payload.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** The first characters of the input, for the History list's text search. */
export const excerpt = (input: string): string => input.slice(0, 2000);

const blob = (value: string, type: string): Blob => new Blob([value], { type });

export const draftOf = (
  input: string,
  component: boolean,
  result: JsxResult,
  action?: HtmlToJsxPayload['action'],
): HistoryDraft => {
  const payload: HtmlToJsxPayload = { component, notes: result.notes, ...(action ? { action } : {}) };
  return {
    kind: 'convert',
    payload,
    label: entryLabel(payload, input.length),
    text: excerpt(input),
    blobs: { input: blob(input, 'text/html'), output: blob(result.text, 'text/plain') },
  };
};

const FLAG_NOTES = new Set(['document', 'important', 'selected', 'script']);
const NAME_NOTES = new Set(['unknownEvents', 'unreadableHandlers', 'unwritable']);

/** A note as the logic writes it — anything else from a stored payload is dropped. */
const isNote = (value: unknown): value is JsxNote => {
  if (typeof value !== 'object' || value === null) return false;
  const n = value as { kind?: unknown; count?: unknown; names?: unknown };
  if (typeof n.kind !== 'string') return false;
  if (FLAG_NOTES.has(n.kind)) return true;
  if (n.kind === 'handlers') return typeof n.count === 'number' && Number.isInteger(n.count) && n.count > 0;
  return NAME_NOTES.has(n.kind) && Array.isArray(n.names) && n.names.every(name => typeof name === 'string');
};

/** The option and the notes of an entry; what is missing or not understood falls back to the defaults. */
export const readEntry = (payload: unknown): { component: boolean; notes: JsxNote[] } => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<HtmlToJsxPayload>;
  const notes = Array.isArray(p.notes) ? p.notes.filter(isNote) : [];
  return { component: p.component === true, notes };
};
