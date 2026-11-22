/**
 * The Base64 Image tool's history entries (the component's chunk only): the payload of schema 1, its label, the draft a
 * commit or a snapshot writes, and reading an entry back. The image is the blob `image`; the payload never holds Base64.
 */
import { base64ImageHistory } from './history';
import { formatSize, imageTypeOf } from '@workspace/tool-logic-base64-image';
import type { DecodedImage, ImageType, InputShape, LineLength, OutputForm } from '@workspace/tool-logic-base64-image';
import type { HistoryDraft, OpenedEntry } from '@workspace/tools-host';

/** An image larger than this is not kept: no entry is written (the declaration's `maxBlobBytes`). */
export const MAX_KEPT_IMAGE_BYTES = base64ImageHistory.maxBlobBytes!;

export type Mode = 'encode' | 'decode';
export type Action = 'chose' | 'copy' | 'save' | 'copy-data-uri' | 'copy-image' | 'save-image';

/** Payload of schema 1. `action` is set for a commit (what the person did), absent for a snapshot. */
export interface Base64ImagePayload {
  mode: Mode;
  mime: string;
  bytes: number;
  width?: number;
  height?: number;
  /** Encode: the output form and its line length. */
  form?: OutputForm;
  lineLength?: LineLength;
  /** Decode: the type the data URI declared and how the input was written. */
  declaredMime?: string;
  shape?: InputShape;
  action?: Action;
}

export const FORM_LABELS: Readonly<Record<OutputForm, string>> = {
  dataUri: 'Data URI',
  base64: 'Base64',
  img: 'HTML <img>',
  css: 'CSS url()',
};

const ACTION_LABELS: Readonly<Record<Action, string>> = {
  chose: 'chosen',
  copy: 'copied',
  save: 'saved',
  'copy-data-uri': 'data URI copied',
  'copy-image': 'image copied',
  'save-image': 'saved',
};

export const entryLabel = (p: Base64ImagePayload): string =>
  [
    p.mode === 'encode' ? 'Encode' : 'Decode',
    imageTypeOf(p.mime)?.name ?? p.mime,
    p.width && p.height ? `${p.width} × ${p.height}` : '',
    formatSize(p.bytes),
    p.mode === 'encode' && p.form ? FORM_LABELS[p.form] : '',
    p.mode === 'encode' && p.form === 'base64' && p.lineLength ? `lines of ${p.lineLength}` : '',
    p.action ? ACTION_LABELS[p.action] : '',
  ]
    .filter(Boolean)
    .join(' · ');

/** What one entry keeps, or null when nothing is kept (no image, or one over MAX_KEPT_IMAGE_BYTES). */
export const draftOf = (
  mode: Mode,
  image: DecodedImage | null,
  extra: Pick<Base64ImagePayload, 'form' | 'lineLength' | 'shape' | 'action'>,
): HistoryDraft | null => {
  if (!image || image.bytes.length > MAX_KEPT_IMAGE_BYTES) return null;
  const d = image.dimensions;
  const payload: Base64ImagePayload = {
    mode,
    mime: image.type.mime,
    bytes: image.bytes.length,
    ...(d ? { width: d.width, height: d.height } : {}),
    ...(mode === 'encode' ? { form: extra.form, lineLength: extra.lineLength } : {}),
    ...(mode === 'decode' && image.declaredMime ? { declaredMime: image.declaredMime } : {}),
    ...(mode === 'decode' && extra.shape ? { shape: extra.shape } : {}),
    ...(extra.action ? { action: extra.action } : {}),
  };
  return {
    kind: mode,
    payload: payload as unknown as HistoryDraft['payload'],
    label: entryLabel(payload),
    blobs: { image: new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.type.mime }) },
  };
};

const FORMS: readonly OutputForm[] = ['dataUri', 'base64', 'img', 'css'];
const SHAPES: readonly InputShape[] = ['base64', 'data-uri', 'css', 'img'];

/** An opened entry, read defensively: what the tool needs to show it again, or null when it cannot be. */
export interface ReadEntry {
  mode: Mode;
  type: ImageType;
  image: Blob;
  form: OutputForm;
  lineLength: LineLength;
  declaredMime: string | null;
  shape: InputShape;
}

export const readEntry = (opened: OpenedEntry & { ok: true }): ReadEntry | null => {
  const p = (opened.payload ?? {}) as Partial<Base64ImagePayload>;
  const image = opened.blobs.image;
  const type = imageTypeOf(p.mime);
  if (!image || !type) return null;
  return {
    mode: opened.entry.kind === 'decode' || p.mode === 'decode' ? 'decode' : 'encode',
    type,
    image,
    form: FORMS.includes(p.form as OutputForm) ? (p.form as OutputForm) : 'dataUri',
    lineLength: p.lineLength === 64 || p.lineLength === 76 ? p.lineLength : 0,
    declaredMime: typeof p.declaredMime === 'string' ? p.declaredMime : null,
    shape: SHAPES.includes(p.shape as InputShape) ? (p.shape as InputShape) : 'data-uri',
  };
};
