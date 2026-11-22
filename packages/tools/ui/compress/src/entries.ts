/**
 * The tool's history entries (the component's chunk only): the payload of schema 1, its label, the draft a commit or a
 * snapshot writes, and reading an entry back. The input is the blob `input`; the payload never holds the result.
 */
import { MAX_KEPT_INPUT, sizesLine } from '@workspace/tool-logic-compress';
import type {
  CompressInput,
  DecompressInput,
  Direction,
  Format,
  FormatChoice,
  OutputEncoding,
  ResultView,
} from '@workspace/tool-logic-compress';
import type { HistoryDraft, OpenedEntry } from '@workspace/tools-host';

export type Action = 'chose' | 'copy' | 'save';

/** Payload of schema 1. `action` is set for a commit (what the person did), absent for a snapshot. */
export interface CompressPayload {
  direction: Direction;
  format: FormatChoice;
  /** The format Auto recognised. */
  recognised?: Format;
  input: DecompressInput | CompressInput;
  level?: number;
  keepName?: boolean;
  view?: ResultView | OutputEncoding;
  inputBytes: number;
  outputBytes?: number;
  /** What the page said instead of a result, or the notes beside it. */
  error?: string;
  notes?: string[];
  action?: Action;
}

const ACTIONS: Readonly<Record<Action, string>> = { chose: 'chosen', copy: 'copied', save: 'saved' };
const SHORT: Readonly<Record<Format, string>> = {
  gzip: 'gzip',
  zlib: 'zlib',
  'deflate-raw': 'deflate',
  zstd: 'zstd',
  brotli: 'brotli',
};

export const entryLabel = (p: CompressPayload): string => {
  const format = p.format === 'auto' ? (p.recognised ? SHORT[p.recognised] : 'auto') : SHORT[p.format];
  const level =
    p.direction === 'compress' && p.level !== undefined && (p.format === 'zstd' || p.format === 'brotli')
      ? ` ${p.level}`
      : '';
  return [
    p.direction === 'decompress' ? 'Decompress' : 'Compress',
    `${format}${level}`,
    p.outputBytes !== undefined ? sizesLine(p.inputBytes, p.outputBytes, p.direction) : p.error ? 'failed' : '',
    p.action ? ACTIONS[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');
};

/** What one entry keeps, or null when nothing is kept (no input, or one over MAX_KEPT_INPUT). */
export const draftOf = (
  payload: CompressPayload,
  input: { text: string } | { bytes: Blob } | null,
): HistoryDraft | null => {
  if (!input) return null;
  const blob = 'text' in input ? new Blob([input.text], { type: 'text/plain' }) : input.bytes;
  if (blob.size > MAX_KEPT_INPUT || blob.size === 0) return null;
  return {
    kind: payload.direction,
    payload: payload as unknown as HistoryDraft['payload'],
    label: entryLabel(payload),
    ...('text' in input ? { text: input.text.slice(0, 2000) } : {}),
    blobs: { input: blob },
  };
};

const DECOMPRESS_INPUTS: readonly string[] = ['base64', 'hex', 'file'];
const COMPRESS_INPUTS: readonly string[] = ['text', 'hex', 'base64', 'file'];
const CHOICES: readonly string[] = ['auto', 'gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'];

export interface ReadEntry {
  direction: Direction;
  format: FormatChoice;
  input: DecompressInput | CompressInput;
  level?: number;
  keepName: boolean;
  view?: string;
  blob: Blob;
}

/** An opened entry, read defensively: what the tool needs to show it again, or null when it cannot be. */
export const readEntry = (opened: OpenedEntry & { ok: true }): ReadEntry | null => {
  const p = (opened.payload ?? {}) as Partial<CompressPayload>;
  const blob = opened.blobs.input;
  const direction: Direction = opened.entry.kind === 'compress' ? 'compress' : 'decompress';
  const inputs = direction === 'compress' ? COMPRESS_INPUTS : DECOMPRESS_INPUTS;
  if (!blob || !inputs.includes(p.input as string)) return null;
  const format =
    CHOICES.includes(p.format as string) && !(direction === 'compress' && p.format === 'auto')
      ? (p.format as FormatChoice)
      : direction === 'compress'
        ? 'gzip'
        : 'auto';
  return {
    direction,
    format,
    input: p.input as DecompressInput | CompressInput,
    ...(typeof p.level === 'number' ? { level: p.level } : {}),
    keepName: p.keepName === true,
    ...(typeof p.view === 'string' ? { view: p.view } : {}),
    blob,
  };
};
