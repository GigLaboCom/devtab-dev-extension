/**
 * The JSON Schema tool's history entries (schema 1): the drafts, their labels for the History list, the search excerpt
 * and the reading of an opened entry back into the page's fields. Kept out of history.ts, which every host page that
 * lists the tools loads.
 */
import { violationCount } from '@workspace/tool-logic-json-schema';
import type { DraftId, InferPayload, ResultPayload, ValidatePayload } from './history';
import type { HistoryDraft } from '@workspace/tools-host';

export interface ValidateState {
  schema: string;
  document: string;
  referenced: string[];
  draft: DraftId;
  formats: boolean;
}

export interface InferState {
  samples: string;
  draft: DraftId;
  enums: boolean;
  formats: boolean;
  closed: boolean;
}

const DRAFT_IDS: readonly DraftId[] = ['2020-12', '2019-09', 'draft-07', 'draft-06', 'draft-04'];
const isDraftId = (v: unknown): v is DraftId => DRAFT_IDS.includes(v as DraftId);

const chars = (n: number): string => `${n.toLocaleString('en-US')} characters`;

const outcomeLabel = (o: ValidatePayload['outcome'], length: number): string => {
  if (!o) return chars(length);
  if ('error' in o) return 'error';
  if ('problems' in o)
    return `schema has ${o.problems === 1 ? '1 problem' : `${o.problems.toLocaleString('en-US')} problems`}`;
  return o.valid ? 'valid' : violationCount(o.count);
};

const samplesLabel = (n: number | undefined, length: number): string =>
  n === undefined ? chars(length) : n === 1 ? '1 sample' : `${n.toLocaleString('en-US')} samples`;

const json = (text: string): Blob => new Blob([text], { type: 'application/json' });

const validateBlobs = (s: ValidateState): Record<string, Blob> => {
  const blobs: Record<string, Blob> = { schema: json(s.schema), document: json(s.document) };
  s.referenced.forEach((t, i) => (blobs[`referenced-${i}`] = json(t)));
  return blobs;
};

const validateText = (s: ValidateState): string => `${s.schema}\n${s.document}`.slice(0, 2000);

export const validateDraft = (s: ValidateState, outcome?: ValidatePayload['outcome']): HistoryDraft => {
  const payload: ValidatePayload = {
    draft: s.draft,
    formats: s.formats,
    referenced: s.referenced.length,
    ...(outcome ? { outcome } : {}),
  };
  return {
    kind: 'validate',
    payload,
    label: `Validate · ${outcomeLabel(outcome, s.schema.length + s.document.length)}`,
    text: validateText(s),
    blobs: validateBlobs(s),
  };
};

export const inferDraft = (s: InferState, samples?: number): HistoryDraft => {
  const payload: InferPayload = {
    draft: s.draft,
    enums: s.enums,
    formats: s.formats,
    closed: s.closed,
    ...(samples !== undefined ? { samples } : {}),
  };
  return {
    kind: 'infer',
    payload,
    label: `Generate schema · ${samplesLabel(samples, s.samples.length)}`,
    text: s.samples.slice(0, 2000),
    blobs: { samples: json(s.samples) },
  };
};

export const copiedValidation = (
  s: ValidateState,
  action: 'copy-violations' | 'copy-problems',
  count: number,
): HistoryDraft => {
  const payload: ResultPayload = {
    task: 'validate',
    action,
    count,
    draft: s.draft,
    formats: s.formats,
    referenced: s.referenced.length,
  };
  return {
    kind: 'result',
    payload,
    label:
      action === 'copy-violations'
        ? `Copied violations · ${violationCount(count)}`
        : `Copied problems · ${count === 1 ? '1 problem' : `${count.toLocaleString('en-US')} problems`}`,
    text: validateText(s),
    blobs: validateBlobs(s),
  };
};

export const takenSchema = (
  s: InferState,
  action: 'copy-schema' | 'validate-with-it',
  samples: number,
): HistoryDraft => {
  const payload: ResultPayload = {
    task: 'infer',
    action,
    samples,
    draft: s.draft,
    enums: s.enums,
    formats: s.formats,
    closed: s.closed,
  };
  return {
    kind: 'result',
    payload,
    label: `${action === 'copy-schema' ? 'Copied schema' : 'Validate with it'} · ${samplesLabel(samples, s.samples.length)}`,
    text: s.samples.slice(0, 2000),
    blobs: { samples: json(s.samples) },
  };
};

/** An opened entry: which task it was and that task's fields. What is missing or not understood takes the defaults. */
export type Opened = { task: 'validate'; state: ValidateState } | { task: 'infer'; state: InferState };

export const readEntry = async (kind: string, payload: unknown, blobs: Record<string, Blob>): Promise<Opened> => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  const text = async (name: string): Promise<string> => (blobs[name] ? blobs[name].text() : '');
  const draft = isDraftId(p.draft) ? p.draft : '2020-12';
  const task = kind === 'infer' || (kind === 'result' && p.task === 'infer') ? 'infer' : 'validate';
  if (task === 'infer')
    return {
      task,
      state: {
        samples: await text('samples'),
        draft,
        enums: p.enums === true,
        formats: p.formats === true,
        closed: p.closed === true,
      },
    };
  const n = typeof p.referenced === 'number' && p.referenced >= 0 ? Math.min(20, Math.floor(p.referenced)) : 0;
  const referenced: string[] = [];
  for (let i = 0; i < n; i++) referenced.push(await text(`referenced-${i}`));
  return {
    task,
    state: {
      schema: await text('schema'),
      document: await text('document'),
      referenced,
      draft,
      formats: p.formats === true,
    },
  };
};
