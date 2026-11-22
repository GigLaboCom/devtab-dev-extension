/**
 * Reading an image the person gave (docs/tools/specs/qr.md §5.6), the page's side: checks the file (an image, at most
 * 50 MB), draws an SVG through `<img src="blob:…">` (the only way Chrome decodes one; an image of the page's own origin
 * leaves the canvas readable) and hands everything to the reading worker (read.worker.ts), one worker per image —
 * created on first use, so the reading half of the library loads only then, and terminated when the read ends or a
 * newer image replaces it.
 *
 * If a later Chrome stops loading `blob:` images under `img-src 'self'` (the CSP draft says `'self'` does not match
 * them), only SVG files stop being read: `SVG images can't be read here; use a PNG or a screenshot.`
 */
import { MAX_SIDE } from '@workspace/tool-logic-qr';
import type { ReadReply, ReadRequest } from './read.worker';
import type { ReadResult } from '@workspace/tool-logic-qr';

export const MAX_FILE_BYTES = 50 * 1024 * 1024;
/** The preview's side in CSS pixels (§8: a canvas of 240 × 240). */
export const PREVIEW_SIDE = 240;

export const READ_MESSAGES = {
  notImage: 'This file is not an image.',
  tooLarge: 'The image is larger than 50 MB.',
  open: 'This image could not be opened.',
  svg: "SVG images can't be read here; use a PNG or a screenshot.",
  notFound: 'No QR code found. Try a sharper or larger image, or crop it to the code.',
  unreadable:
    'A QR code was found, but its contents could not be read: it is damaged or uses a mode this reader lacks (Kanji).',
} as const;

export type ReadOutcome =
  { ok: true; result: ReadResult; width: number; height: number; ms: number } | { ok: false; message: string };

export interface ReadImageOptions {
  /** The image, fitted into the preview's square, as soon as it is decoded. */
  onPreview?: (bitmap: ImageBitmap, size: { width: number; height: number }) => void;
  signal?: AbortSignal;
  /** Device pixels per CSS pixel of the preview. */
  scale?: number;
}

const abortError = (): DOMException => new DOMException('The operation was aborted.', 'AbortError');

/** The file's first check (§5.6 step 1): a message, or null when it may be read. */
export const fileProblem = (file: File): string | null =>
  !file.type.startsWith('image/') ? READ_MESSAGES.notImage : file.size > MAX_FILE_BYTES ? READ_MESSAGES.tooLarge : null;

/** An SVG drawn on a canvas through an `<img>`, its long side between 1,024 and 4,096 px (it is vector: scale is free). */
const drawSvg = async (file: File): Promise<ImageBitmap> => {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    try {
      await img.decode();
    } catch {
      throw new Error('svg');
    }
    const w = img.naturalWidth || 1024;
    const h = img.naturalHeight || w;
    const long = Math.max(w, h);
    const scale = Math.min(MAX_SIDE, Math.max(1024, long)) / long;
    const canvas = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale));
    const g = canvas.getContext('2d');
    if (!g) throw new Error('svg');
    g.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.transferToImageBitmap();
  } finally {
    URL.revokeObjectURL(url);
  }
};

export const readImage = async (
  file: File,
  { onPreview, signal, scale = 1 }: ReadImageOptions = {},
): Promise<ReadOutcome> => {
  const problem = fileProblem(file);
  if (problem) return { ok: false, message: problem };
  let source: Blob | ImageBitmap = file;
  if (file.type === 'image/svg+xml')
    try {
      source = await drawSvg(file);
    } catch {
      return { ok: false, message: READ_MESSAGES.svg };
    }
  if (signal?.aborted) throw abortError();
  return new Promise<ReadOutcome>((resolve, reject) => {
    const worker = new Worker(new URL('./read.worker.ts', import.meta.url), { type: 'module', name: 'qr-read' });
    const stop = () => {
      worker.terminate();
      signal?.removeEventListener('abort', aborted);
    };
    const aborted = () => {
      stop();
      reject(abortError());
    };
    signal?.addEventListener('abort', aborted, { once: true });
    let size = { width: 0, height: 0 };
    worker.onmessage = ({ data }: MessageEvent<ReadReply>) => {
      if (data.type === 'preview') {
        size = { width: data.width, height: data.height };
        onPreview?.(data.bitmap, size);
        return;
      }
      stop();
      if (data.type === 'done') resolve({ ok: true, result: data.result, ...size, ms: data.ms });
      else resolve({ ok: false, message: READ_MESSAGES.open });
    };
    worker.onerror = event => {
      event.preventDefault();
      stop();
      resolve({ ok: false, message: READ_MESSAGES.open });
    };
    const request: ReadRequest = { source, preview: Math.round(PREVIEW_SIDE * scale) };
    worker.postMessage(request, source instanceof ImageBitmap ? [source] : []);
  });
};
