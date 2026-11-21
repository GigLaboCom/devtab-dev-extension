/**
 * How the Case Converter fills its history records (the declaration is history.ts): the payload, the label and the
 * excerpt. Imported by the component only, so none of it reaches the start page.
 */
import { CASE_FORMS } from '@workspace/tool-logic-case';
import type { CaseForm } from '@workspace/tool-logic-case';
import type { HistoryDraft } from '@workspace/tools-host';

/** Payload of schema 1; the input itself is the blob `input`. `copied` is set when a form was copied (a commit). */
export type CasePayload = { lines: number; copied?: CaseForm };

const LABEL_CHARS = 48;
const LINE_BREAK = /\r\n|\n|\r/;

export const formLabel = (form: CaseForm): string => CASE_FORMS.find(f => f.id === form)?.label ?? form;

export const isForm = (v: unknown): v is CaseForm => CASE_FORMS.some(f => f.id === v);

/** The number of lines as the tool converts them (§5.1): a line break ends one, a final one starts an empty one. */
const lineCount = (text: string): number => {
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10) n++;
    else if (c === 13) {
      n++;
      if (text.charCodeAt(i + 1) === 10) i++;
    }
  }
  return n;
};

/** The History list's line: the start of the first line that has something in it, the count, the form copied. */
export const entryLabel = (input: string, p: CasePayload): string => {
  const first = (
    input
      .slice(0, 4096)
      .split(LINE_BREAK)
      .find(l => l.trim() !== '') ?? ''
  ).trim();
  const chars = [...first];
  const shown = chars.length > LABEL_CHARS ? `${chars.slice(0, LABEL_CHARS).join('')}…` : first;
  return [
    shown || `${input.length.toLocaleString('en-US')} ${input.length === 1 ? 'character' : 'characters'}`,
    p.lines === 1 ? '' : `${p.lines.toLocaleString('en-US')} lines`,
    p.copied ? `copied ${formLabel(p.copied)}` : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

/** The record of an input (null: nothing to record — an empty input); `copied` makes it the commit of a Copy. */
export const draftOf = (input: string, copied?: CaseForm): HistoryDraft | null => {
  if (input === '') return null;
  const payload: CasePayload = { lines: lineCount(input), ...(copied ? { copied } : {}) };
  return {
    kind: 'convert',
    payload,
    label: entryLabel(input, payload),
    text: input.slice(0, 2000),
    blobs: { input: plain(input) },
  };
};
