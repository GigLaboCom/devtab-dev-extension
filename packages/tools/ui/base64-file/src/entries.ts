/**
 * The Base64 File tool's history entries (the component's chunk only; docs/tools/specs/base64-file.md §11): which kind a
 * file goes to — or why none — the payload of schema 1, its label, the draft a commit or a snapshot writes, and reading
 * an entry back. The file is the blob `file`; the payload never holds Base64 or a file's name.
 */
import { base64FileHistory } from './history';
import { FILE_TYPES, formatSize } from '@workspace/tool-logic-base64-file';
import type { FileType, InputShape, LineLength, OutputForm, TypeId } from '@workspace/tool-logic-base64-file';
import type { HistoryDraft, OpenedEntry, RecordingStatus } from '@workspace/tools-host';

/** A file larger than this is not kept: no entry is written (the declaration's `maxBlobBytes`). */
export const MAX_KEPT_BYTES = base64FileHistory.maxBlobBytes!;

export type Mode = 'encode' | 'decode';
export type Action = 'chose' | 'copy' | 'save';

/** Where a file goes: an open kind, a secret one, or nowhere (and why). */
export type Keeping = 'open' | 'secret' | 'private-key' | 'too-large' | 'empty';

/** §11: a private key never; over 1 MiB no entry; unrecognised bytes only encrypted; the rest open. */
export const keepingOf = (recognised: FileType, size: number): Keeping => {
  if (size === 0) return 'empty';
  if (recognised.secret) return 'private-key';
  if (size > MAX_KEPT_BYTES) return 'too-large';
  return recognised.id === 'unknown' ? 'secret' : 'open';
};

/** What the page says about keeping, true at that moment (§11); null when there is nothing to say. */
export const keepingNote = (keeping: Keeping, status: RecordingStatus): string | null => {
  if (status.gate !== 'on') return null;
  if (keeping === 'private-key') return 'Not kept in history: a private key is never kept.';
  if (keeping === 'too-large') return 'Not kept in history: files over 1 MiB are not kept.';
  if (keeping === 'secret')
    return status.secrets === 'unlocked'
      ? 'Kept encrypted: bytes of an unknown type may be a key.'
      : 'Not kept in history: bytes of an unknown type are kept only with a master password.';
  return null;
};

/** Payload of schema 1. `action` is set for a commit (what the person did), absent for a snapshot. */
export interface Base64FilePayload {
  mode: Mode;
  /** The type recognised by the bytes (`by-name` never: the refinement is made again on opening). */
  type: TypeId;
  /** The MIME type shown (and, in Encode with Data URI, the one the data URI had). */
  mime: string;
  bytes: number;
  form?: OutputForm;
  alphabet?: 'standard' | 'url';
  padding?: boolean;
  lineLength?: LineLength;
  /** Decode: how the input was written, the type a data URI declared, a PEM block's label. */
  shape?: InputShape;
  declaredMime?: string;
  pemLabel?: string;
  action?: Action;
}

const ACTION_LABELS: Readonly<Record<Action, string>> = { chose: 'chosen', copy: 'copied', save: 'saved' };

export const entryLabel = (p: Base64FilePayload, typeName: string): string =>
  [
    p.mode === 'encode' ? 'Encode' : 'Decode',
    typeName,
    formatSize(p.bytes),
    p.mode === 'encode' ? (p.form === 'dataUri' ? 'Data URI' : 'Base64') : '',
    p.mode === 'encode' && p.form !== 'dataUri' && p.alphabet === 'url' ? 'URL-safe' : '',
    p.mode === 'encode' && p.form !== 'dataUri' && p.lineLength ? `lines of ${p.lineLength}` : '',
    p.action ? ACTION_LABELS[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What one entry keeps, or null when nothing is (§11). */
export const draftOf = (
  file: Blob,
  recognised: FileType,
  shown: FileType,
  payload: Omit<Base64FilePayload, 'type' | 'mime' | 'bytes'> & { mime: string },
): HistoryDraft | null => {
  const keeping = keepingOf(recognised, file.size);
  if (keeping !== 'open' && keeping !== 'secret') return null;
  const full: Base64FilePayload = { ...payload, type: recognised.id, bytes: file.size };
  return {
    kind: keeping === 'secret' ? `${payload.mode}-unknown` : payload.mode,
    payload: full as unknown as HistoryDraft['payload'],
    label: entryLabel(full, shown.name),
    // A plain Blob of the bytes: a File would carry its name into the store.
    blobs: { file: new Blob([file]) },
  };
};

const FORMS: readonly OutputForm[] = ['base64', 'dataUri'];
const SHAPES: readonly InputShape[] = ['base64', 'data-uri', 'pem'];

export interface ReadEntry {
  mode: Mode;
  file: Blob;
  type: TypeId;
  form: OutputForm;
  alphabet: 'standard' | 'url';
  padding: boolean;
  lineLength: LineLength;
  /** Encode with Data URI: the type the data URI had. */
  dataType: string | null;
  shape: InputShape;
  declaredMime: string | null;
  pemLabel: string | null;
}

/** An opened entry, read defensively: what the tool needs to show it again, or null when it cannot be. */
export const readEntry = (opened: OpenedEntry & { ok: true }): ReadEntry | null => {
  const p = (opened.payload ?? {}) as Partial<Base64FilePayload>;
  const file = opened.blobs.file;
  if (!file) return null;
  const mode: Mode = opened.entry.kind.startsWith('decode') || p.mode === 'decode' ? 'decode' : 'encode';
  const form = FORMS.includes(p.form as OutputForm) ? (p.form as OutputForm) : 'base64';
  return {
    mode,
    file,
    type: typeof p.type === 'string' && p.type in FILE_TYPES ? p.type : 'unknown',
    form,
    alphabet: p.alphabet === 'url' ? 'url' : 'standard',
    padding: typeof p.padding === 'boolean' ? p.padding : p.alphabet !== 'url',
    lineLength: p.lineLength === 64 || p.lineLength === 76 ? p.lineLength : 0,
    dataType: form === 'dataUri' && typeof p.mime === 'string' ? p.mime : null,
    shape: SHAPES.includes(p.shape as InputShape) ? (p.shape as InputShape) : 'base64',
    declaredMime: typeof p.declaredMime === 'string' ? p.declaredMime : null,
    pemLabel: typeof p.pemLabel === 'string' && /^[\x20-\x2C\x2E-\x7E]{1,64}$/.test(p.pemLabel) ? p.pemLabel : null,
  };
};
