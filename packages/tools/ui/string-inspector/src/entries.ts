/**
 * How the String Inspector fills its history records (the declaration is history.ts): the payload, the label and the
 * excerpt. Imported by the component only, so none of it reaches the start page. The label is counts only — the
 * History list never shows the inspected text, which may be a secret, nor its invisible or bidirectional characters,
 * which would reorder the list's own line.
 */
import type { Inspection } from '@workspace/tool-logic-string-inspector';
import type { HistoryDraft } from '@workspace/tools-host';

export type Copied = 'summary' | 'table';

/** Payload of schema 1; the text itself is the blob `input`. `copied` is set when a result was copied (a commit). */
export type InspectPayload = {
  graphemes: number;
  codePoints: number;
  utf8Bytes: number;
  invisible: number;
  copied?: Copied;
};

const number = (n: number): string => n.toLocaleString('en-US');
const plural = (n: number, one: string, many: string): string => `${number(n)} ${n === 1 ? one : many}`;

export const isCopied = (v: unknown): v is Copied => v === 'summary' || v === 'table';

/** The History list's line: `10 characters · 19 UTF-8 bytes · 1 invisible · copied summary`. */
export const entryLabel = (p: InspectPayload): string =>
  [
    plural(p.graphemes, 'character', 'characters'),
    plural(p.utf8Bytes, 'UTF-8 byte', 'UTF-8 bytes'),
    p.invisible > 0 ? `${number(p.invisible)} invisible` : '',
    p.copied ? `copied ${p.copied}` : '',
  ]
    .filter(Boolean)
    .join(' \u{B7} ');

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

/** The record of a text and what was found in it (null: nothing to record — an empty text). */
export const draftOf = (text: string, inspection: Inspection, copied?: Copied): HistoryDraft | null => {
  if (text === '') return null;
  const { summary, warnings } = inspection;
  const payload: InspectPayload = {
    graphemes: summary.graphemes,
    codePoints: summary.codePoints,
    utf8Bytes: summary.utf8Bytes,
    invisible: warnings.invisible.reduce((n, x) => n + x.count, 0),
    ...(copied ? { copied } : {}),
  };
  return {
    kind: 'inspect',
    payload,
    label: entryLabel(payload),
    text: text.slice(0, 2000),
    blobs: { input: plain(text) },
  };
};
