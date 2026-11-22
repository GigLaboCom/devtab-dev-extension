/**
 * The SVG to CSS tool's history entries (the component's chunk only): the payload of schema 1, its label, the draft a
 * snapshot or a commit writes, and reading an entry back. The SVG is the blob `svg`, the result the blob `result`;
 * opening an entry puts the SVG back in the field with its options, and the result is made again from them.
 */
import { svgToCssHistory } from './history';
import type { Encoding, Output, SvgOptions } from '@workspace/tool-logic-svg-to-css';
import type { HistoryDraft, OpenedEntry } from '@workspace/tools-host';

/** An SVG (or a result) larger than this many UTF-8 bytes is not kept: no entry is written. */
export const MAX_KEPT_BYTES = svgToCssHistory.maxBlobBytes!;

export type Action = 'copy' | 'open';

/** Payload of schema 1. `action` is set for a commit (what the person did), absent for a snapshot. */
export interface SvgToCssPayload {
  output: Output;
  encoding: Encoding;
  minify: boolean;
  /** Lengths of both data: URIs, in characters. */
  sizes: { url: number; base64: number };
  action?: Action;
}

export const OUTPUT_LABELS: Readonly<Record<Output, string>> = {
  'background-image': 'background-image',
  'mask-image': 'mask-image',
  url: 'url()',
  'data-uri': 'Data URI',
};
export const OUTPUTS = Object.keys(OUTPUT_LABELS) as Output[];
export const ENCODING_LABELS: Readonly<Record<Encoding, string>> = { url: 'URL-encoded', base64: 'Base64' };

const ACTION_LABELS: Readonly<Record<Action, string>> = { copy: 'copied', open: 'file opened' };

export const entryLabel = (p: SvgToCssPayload): string =>
  [
    OUTPUT_LABELS[p.output],
    ENCODING_LABELS[p.encoding],
    p.minify ? '' : 'not minified',
    `${(p.encoding === 'url' ? p.sizes.url : p.sizes.base64).toLocaleString('en-US')} characters`,
    p.action ? ACTION_LABELS[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');

const bytesOf = (text: string): number => new Blob([text]).size;

/** What one entry keeps, or null when nothing is kept (an SVG or a result over MAX_KEPT_BYTES). */
export const draftOf = (
  input: string,
  result: string,
  options: SvgOptions,
  sizes: { url: number; base64: number },
  action?: Action,
): HistoryDraft | null => {
  if (input.length > MAX_KEPT_BYTES || bytesOf(input) > MAX_KEPT_BYTES || result.length > MAX_KEPT_BYTES) return null;
  const payload: SvgToCssPayload = { ...options, sizes, ...(action ? { action } : {}) };
  return {
    kind: 'convert',
    payload: payload as unknown as HistoryDraft['payload'],
    label: entryLabel(payload),
    text: input.slice(0, 2000),
    blobs: {
      svg: new Blob([input], { type: 'image/svg+xml' }),
      result: new Blob([result], { type: 'text/plain' }),
    },
  };
};

/** An opened entry, read defensively: the SVG and the options, or null when it cannot be shown again. */
export interface ReadEntry {
  svg: Blob;
  options: SvgOptions;
}

export const readEntry = (opened: OpenedEntry & { ok: true }): ReadEntry | null => {
  const p = (opened.payload ?? {}) as Partial<SvgToCssPayload>;
  const svg = opened.blobs.svg;
  if (!svg) return null;
  return {
    svg,
    options: {
      output: OUTPUTS.includes(p.output as Output) ? (p.output as Output) : 'background-image',
      encoding: p.encoding === 'base64' ? 'base64' : 'url',
      minify: p.minify !== false,
    },
  };
};
