/**
 * What has to happen on the page (docs/tools/specs/image-convert.md §5.3, §5.6, §3):
 *
 * - An SVG is drawn only as an image: its text in a Blob of type `image/svg+xml`, an object URL, an `Image` decoded and
 *   the URL revoked at once. As an image Chrome runs none of its scripts and loads nothing it names (proved by the
 *   e2e). Never markup in the page, `<object>`, `<embed>`, `<iframe>` or `<use>`. It is drawn on an OffscreenCanvas at the
 *   result's size — a vector drawn at that size, not a raster stretched — and handed to the worker as an ImageBitmap.
 *   A canvas a `foreignObject` tainted cannot be read: said in words.
 * - Saving is the `base64-file` way: a temporary `<a download>` on an object URL of an `application/octet-stream`
 *   Blob, clicked in the press and revoked at once — a download, never a page or an image; no permission.
 */
import { SVG_FOREIGN_OBJECT, SVG_UNDRAWABLE } from '@workspace/tool-logic-image-convert';
import type { Rect, Size } from '@workspace/tool-logic-image-convert';

/** The SVG decoded as an image; the object URL lives only while it loads. */
export const loadSvg = async (text: string): Promise<HTMLImageElement> => {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }));
  const image = new Image();
  try {
    image.src = url;
    await image.decode();
    return image;
  } catch {
    throw new Error(SVG_UNDRAWABLE);
  } finally {
    URL.revokeObjectURL(url);
  }
};

const readable = (canvas: OffscreenCanvas, g: OffscreenCanvasRenderingContext2D): ImageBitmap => {
  try {
    g.getImageData(0, 0, 1, 1);
  } catch {
    canvas.width = 0;
    throw new Error(SVG_FOREIGN_OBJECT);
  }
  return canvas.transferToImageBitmap();
};

const context = (canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D => {
  const g = canvas.getContext('2d');
  if (!g) throw new Error('This browser gave no 2D canvas.');
  g.imageSmoothingQuality = 'high';
  return g;
};

/**
 * The SVG at the planned size: all of it, or for Fill and crop the part `crop` names in its own coordinates (`own`) —
 * the whole drawing scaled and shifted so that part fills the canvas.
 */
export const drawSvg = (image: HTMLImageElement, own: Size, size: Size, crop: Rect | null): ImageBitmap => {
  const canvas = new OffscreenCanvas(size.width, size.height);
  const g = context(canvas);
  if (crop) {
    const s = size.width / crop.width;
    g.drawImage(image, -crop.x * s, -crop.y * s, own.width * s, own.height * s);
  } else g.drawImage(image, 0, 0, size.width, size.height);
  return readable(canvas, g);
};

/** The SVG fitted into a transparent square, centred (an icon, §5.8). */
export const drawSvgSquare = (image: HTMLImageElement, own: Size, size: number): ImageBitmap => {
  const canvas = new OffscreenCanvas(size, size);
  const g = context(canvas);
  const s = Math.min(size / own.width, size / own.height);
  const w = own.width * s;
  const h = own.height * s;
  g.drawImage(image, (size - w) / 2, (size - h) / 2, w, h);
  return readable(canvas, g);
};

/** Save (§3): a download of the Blob under `name`. */
export const saveBlob = (blob: Blob, name: string): void => {
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/octet-stream' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
};
