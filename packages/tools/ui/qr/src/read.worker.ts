/**
 * Reads an image off the page's thread (docs/tools/specs/qr.md §5.6 steps 3–7; its §12 measured up to 66 ms, a large
 * noisy photo takes a few hundred, the reader's extra attempts up to 2 s more): the image is decoded here
 * (`createImageBitmap` of the File — PNG, JPEG, GIF's first frame, WebP, BMP, ICO, AVIF, whatever Chrome decodes; an SVG
 * comes already drawn, as an ImageBitmap, because it decodes only through an `<img>` on the page), drawn on an
 * OffscreenCanvas no larger than 4,096 px on its long side over white (transparent reads as white), and searched with
 * the reading half of `qr` — which only this worker loads. A small copy for the page's preview goes back first.
 * Loaded from this file by reader.ts — never from `blob:` or `data:`; the page cancels by terminating it.
 */
import { LIGHT, MAX_SIDE, readQr } from '@workspace/tool-logic-qr';
import type { ReadResult } from '@workspace/tool-logic-qr';

export interface ReadRequest {
  /** The person's image, or an SVG already drawn by the page. */
  source: Blob | ImageBitmap;
  /** The preview's side in device pixels. */
  preview: number;
}

export type ReadReply =
  | { type: 'preview'; bitmap: ImageBitmap; width: number; height: number }
  | { type: 'done'; result: ReadResult; ms: number }
  | { type: 'error'; reason: 'open' | 'failed'; message: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<ReadRequest>) => void) | null;
  postMessage: (reply: ReadReply, transfer?: Transferable[]) => void;
};

const draw = (bitmap: ImageBitmap, width: number, height: number): OffscreenCanvasRenderingContext2D => {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d', { willReadFrequently: true });
  if (!g) throw new Error('No 2D canvas.');
  g.fillStyle = LIGHT;
  g.fillRect(0, 0, width, height);
  g.imageSmoothingQuality = 'high';
  g.drawImage(bitmap, 0, 0, width, height);
  return g;
};

scope.onmessage = async ({ data }) => {
  let bitmap: ImageBitmap;
  try {
    bitmap = data.source instanceof Blob ? await createImageBitmap(data.source) : data.source;
  } catch (error) {
    scope.postMessage({
      type: 'error',
      reason: 'open',
      message: error instanceof Error ? error.message : String(error),
    });
    return;
  }
  try {
    const { width, height } = bitmap;
    if (!width || !height) throw new Error('empty image');
    const fit = (side: number) => Math.min(1, side / Math.max(width, height));
    const p = fit(data.preview);
    const preview = draw(bitmap, Math.max(1, Math.round(width * p)), Math.max(1, Math.round(height * p)));
    const shown = preview.canvas.transferToImageBitmap();
    scope.postMessage({ type: 'preview', bitmap: shown, width, height }, [shown]);

    const s = fit(MAX_SIDE);
    const w = Math.max(1, Math.round(width * s));
    const h = Math.max(1, Math.round(height * s));
    const pixels = draw(bitmap, w, h).getImageData(0, 0, w, h);
    bitmap.close();
    const began = performance.now();
    const result = await readQr(pixels);
    scope.postMessage({ type: 'done', result, ms: Math.round(performance.now() - began) });
  } catch (error) {
    scope.postMessage({
      type: 'error',
      reason: 'failed',
      message: error instanceof Error ? error.message : String(error),
    });
  }
};
