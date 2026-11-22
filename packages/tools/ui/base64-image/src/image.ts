/**
 * Showing, saving and copying someone else's image under the extension pages' policy (`img-src 'self'`; `data:`
 * images are blocked — docs/tools/specs/base64-image.md §5 «Превью», §11):
 *
 * - The preview is `<img>` on an object URL of a Blob typed with the recognised MIME — never the declared one, never
 *   markup in the page, a frame, `<object>`, `<embed>` or `<use>`: an SVG shown as an image runs no script and loads
 *   nothing (proved in the built extension, scripts/e2e-tools/base64-image.mjs). One URL per image, revoked when the
 *   image is replaced or cleared, the mode changes or the tool's page goes away (`useObjectUrl`).
 * - If `<img>` fails, `createImageBitmap` tells damaged from refused: a raster image it decodes is drawn on a canvas
 *   (the path that keeps working if a later Chrome stops loading `blob:` images under `'self'`); an SVG it cannot
 *   decode, so a tiny PNG through the same kind of URL says whether such URLs load here at all.
 * - Save image is a temporary `<a download>` on the same URL, clicked in the press (a download, not an image load:
 *   no `downloads` permission, `img-src` does not apply).
 * - Copy image hands the clipboard a promise of a PNG from the press, so the write starts inside the gesture: a PNG as
 *   it is, any other raster image's first frame drawn on a canvas, an SVG drawn from the loaded preview.
 */
import { MAX_PREVIEW_PIXELS } from '@workspace/tool-logic-base64-image';
import { useEffect, useState } from 'react';
import type { DecodedImage } from '@workspace/tool-logic-base64-image';

export const blobOf = (image: Pick<DecodedImage, 'bytes' | 'type'>): Blob =>
  new Blob([image.bytes as Uint8Array<ArrayBuffer>], { type: image.type.mime });

/** The object URL of the current image, revoked when the image changes or the component goes away. */
export const useObjectUrl = (image: Pick<DecodedImage, 'bytes' | 'type'> | null): string | null => {
  const [url, setUrl] = useState<{ of: unknown; url: string } | null>(null);
  useEffect(() => {
    if (!image) return;
    const created = URL.createObjectURL(blobOf(image));
    setUrl({ of: image, url: created });
    return () => {
      URL.revokeObjectURL(created);
      setUrl(null);
    };
  }, [image]);
  return url && url.of === image ? url.url : null;
};

/** A raster image decoded without an `<img>` (the policy's `img-src` does not apply), or null when it does not decode. */
export const decodeBitmap = async (blob: Blob): Promise<ImageBitmap | null> => {
  try {
    return await createImageBitmap(blob);
  } catch {
    return null;
  }
};

/** A 1 × 1 PNG: whether `blob:` images load on this page at all, asked once. */
const PROBE_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR42mP4z8AAAAMBAQD3A0FDAAAAAElFTkSuQmCC';
let blobImages: Promise<boolean> | null = null;
export const blobImagesLoad = (): Promise<boolean> =>
  (blobImages ??= new Promise<boolean>(resolve => {
    const bytes = Uint8Array.from(atob(PROBE_PNG), c => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: 'image/png' }));
    const probe = new Image();
    const done = (ok: boolean) => {
      URL.revokeObjectURL(url);
      resolve(ok);
    };
    probe.onload = () => done(true);
    probe.onerror = () => done(false);
    probe.src = url;
  }));

/** Save image (§5 «Сохранение файлом»): a temporary `<a download>` on the image's URL, clicked and removed. */
export const saveUrl = (url: string, fileName: string): void => {
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
};

/** Saves a text (Encode's Save): its own short-lived URL, revoked after the click. */
export const saveText = (text: string, fileName: string): void => {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }));
  saveUrl(url, fileName);
  URL.revokeObjectURL(url);
};

/** The longest side an SVG is drawn at for Copy image (it is vector; its own size is used when smaller). */
const SVG_COPY_SIDE = 4096;

const toPng = async (draw: CanvasImageSource, width: number, height: number): Promise<Blob> => {
  const canvas = new OffscreenCanvas(width, height);
  const g = canvas.getContext('2d');
  if (!g) throw new Error('No 2D canvas.');
  g.drawImage(draw, 0, 0, width, height);
  return canvas.convertToBlob({ type: 'image/png' });
};

/** The image as a PNG for the clipboard: as it is, its first frame, or the SVG drawn from its loaded preview. */
export const pngOf = async (image: DecodedImage, shown: HTMLImageElement | null): Promise<Blob> => {
  if (image.type.mime === 'image/png') return blobOf(image);
  if (image.type.mime === 'image/svg+xml') {
    if (!shown?.complete || !shown.naturalWidth) throw new Error('The SVG is not shown.');
    const w = image.dimensions?.width ?? shown.naturalWidth;
    const h = image.dimensions?.height ?? shown.naturalHeight;
    const scale = Math.min(1, SVG_COPY_SIDE / Math.max(w, h));
    return toPng(shown, Math.max(1, Math.round(w * scale)), Math.max(1, Math.round(h * scale)));
  }
  const bitmap = await decodeBitmap(blobOf(image));
  if (!bitmap) throw new Error('The image does not decode.');
  try {
    if (bitmap.width * bitmap.height > MAX_PREVIEW_PIXELS) throw new Error('Too large.');
    return await toPng(bitmap, bitmap.width, bitmap.height);
  } finally {
    bitmap.close();
  }
};

/** Copy image: resolves when the clipboard took the PNG, rejects when it refused. Called from the press itself. */
export const copyPng = (png: Promise<Blob>): Promise<void> =>
  navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
