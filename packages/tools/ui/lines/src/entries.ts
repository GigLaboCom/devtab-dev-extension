/** Payload, label, search text and draft of the Lines tool's history entries (the component's chunk only). */
import { describeSteps, isShuffling } from './steps';
import { summaryText } from '@workspace/tool-logic-lines';
import type { Steps } from './steps';
import type { HistoryDraft } from '@workspace/tools-host';

export const KIND = 'process';

/** Payload of schema 1. `action` is set when the person took the result (committed), absent for an edit snapshot. */
export type LinesPayload = {
  steps: Steps;
  linesIn: number;
  linesOut: number;
  action?: 'copy' | 'use';
};

export const entryLabel = (p: LinesPayload): string =>
  [
    ...describeSteps(p.steps),
    summaryText(p.linesIn, p.linesOut),
    p.action === 'copy' ? 'copied' : p.action === 'use' ? 'used as input' : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What History's text search looks in: the start of the input and of the result. */
export const excerpt = (input: string, output: string): string =>
  output === input || output === '' ? input.slice(0, 2000) : `${input.slice(0, 1000)}\n${output.slice(0, 1000)}`;

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

export interface Taken {
  input: string;
  steps: Steps;
  output: string;
  linesIn: number;
  linesOut: number;
  /** The shuffle tape's bytes, when Shuffle is on. */
  tape: Uint8Array<ArrayBuffer> | null;
}

export const draftOf = (t: Taken, action?: LinesPayload['action']): HistoryDraft | null => {
  if (t.input === '') return null;
  const payload: LinesPayload = {
    steps: t.steps,
    linesIn: t.linesIn,
    linesOut: t.linesOut,
    ...(action ? { action } : {}),
  };
  const blobs: Record<string, Blob> = { input: plain(t.input), output: plain(t.output) };
  if (t.tape && isShuffling(t.steps)) blobs.tape = new Blob([t.tape], { type: 'application/octet-stream' });
  return {
    kind: KIND,
    payload: payload as unknown as HistoryDraft['payload'],
    label: entryLabel(payload),
    text: excerpt(t.input, t.output),
    blobs,
  };
};
