/**
 * Where pixels are decoded, resized and encoded (docs/tools/specs/image-convert.md §5.3, §12): a 50-megapixel photo
 * takes seconds of decoding and drawing, and the page would stand still for all of it. Loaded from this file by
 * `runner.ts` — never from `blob:` or `data:`. One job at a time; cancelling is the page terminating the worker.
 *
 * - `convert`: a raster file — its head checked again (type, the bound on pixels before anything is decoded),
 *   `createImageBitmap` with the EXIF orientation applied, the size planned, shrunk by halves, encoded.
 * - `encode`: an SVG the page drew already at the result's size (an SVG decodes only as an `<img>`, which a worker
 *   has not got) — only the background and the encoding are left.
 * - `icons`: one source, every size it is needed at — squared, by halves — then the PNG files and favicon.ico.
 * - `zip`: the files' bytes in a store-only archive (parts, never one copied array).
 *
 * Every ImageBitmap is closed once drawn and every intermediate canvas released (width 0) once the next is drawn, so
 * 50 conversions in a row leave nothing behind.
 */
import {
  DIB_MAX_SIZE,
  FORMAT_MIME,
  HEAD_BYTES,
  ICO_NAME,
  JPEG_ALPHA_NOTE,
  NOT_SQUARE_NOTE,
  UNDECODABLE,
  enlargedNote,
  halvingSteps,
  icoDib,
  icoNote,
  iconsEnlargedNote,
  inspectHead,
  notEnlargedNote,
  planSize,
  writeIco,
  zipParts,
} from '@workspace/tool-logic-image-convert';
import type { IconFile, OutputFormat, Rect, ResizeOptions, Size } from '@workspace/tool-logic-image-convert';

export interface ConvertOptions {
  format: OutputFormat;
  /** 1–100: the encoder's quality is N / 100 (JPEG, WebP). */
  quality: number;
  /** WebP without loss: quality 1.0 (Chrome writes lossless WebP then, §5.1). */
  lossless: boolean;
  /** `#rrggbb` under transparent pixels (JPEG; opaque icons). */
  background: string;
  resize: ResizeOptions;
}

export interface IconsOptions {
  files: readonly IconFile[];
  icoSizes: readonly number[];
  icoImages: 'png' | 'bmp';
  background: string;
}

export type WorkerRequest =
  | { id: number; type: 'convert'; file: Blob; options: ConvertOptions }
  | { id: number; type: 'encode'; bitmap: ImageBitmap; options: ConvertOptions; mayHaveAlpha: boolean }
  | {
      id: number;
      type: 'icons';
      file?: Blob;
      bitmaps?: Array<{ size: number; bitmap: ImageBitmap }>;
      options: IconsOptions;
    }
  | { id: number; type: 'zip'; files: Array<{ name: string; blob: Blob }> };

export interface Converted {
  blob: Blob;
  size: Size;
  source: Size;
  notes: string[];
}
export interface IconResult {
  name: string;
  blob: Blob;
  /** The PNG's size, or the sizes inside favicon.ico. */
  sizes: number[];
}

export type WorkerReply =
  | ({ id: number; type: 'converted' } & Converted)
  | { id: number; type: 'icons'; files: IconResult[]; notes: string[] }
  | { id: number; type: 'zip'; blob: Blob }
  | { id: number; type: 'failed'; message: string };

/** The worker's global scope, as much of it as is used here (the package compiles against the page's DOM types). */
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<WorkerRequest>) => void) | null;
  postMessage: (reply: WorkerReply) => void;
};

class Refusal extends Error {}

const context = (canvas: OffscreenCanvas): OffscreenCanvasRenderingContext2D => {
  const g = canvas.getContext('2d');
  if (!g) throw new Refusal('This browser gave no 2D canvas.');
  g.imageSmoothingEnabled = true;
  g.imageSmoothingQuality = 'high';
  return g;
};

const release = (source: CanvasImageSource): void => {
  if (source instanceof OffscreenCanvas) source.width = 0;
  else if (source instanceof ImageBitmap) source.close();
};

/**
 * `region` of `source` at `target`: halves while the region is at least twice the target, then one draw (§5.5). The
 * source is released (closed or emptied) once it has been drawn. `background` fills the last canvas first.
 */
const drawPlanned = (
  source: CanvasImageSource,
  region: Rect,
  target: Size,
  background?: string,
  keepSource = false,
): OffscreenCanvas => {
  const done = (drawn: CanvasImageSource): void => {
    if (drawn !== source || !keepSource) release(drawn);
  };
  let current = source;
  let rect = region;
  for (const step of halvingSteps({ width: rect.width, height: rect.height }, target)) {
    const next = new OffscreenCanvas(step.width, step.height);
    context(next).drawImage(current, rect.x, rect.y, rect.width, rect.height, 0, 0, step.width, step.height);
    done(current);
    current = next;
    rect = { x: 0, y: 0, width: step.width, height: step.height };
  }
  const ready =
    current !== source &&
    current instanceof OffscreenCanvas &&
    !background &&
    current.width === target.width &&
    current.height === target.height;
  if (ready) return current as OffscreenCanvas;
  const out = new OffscreenCanvas(target.width, target.height);
  const g = context(out);
  if (background) {
    g.fillStyle = background;
    g.fillRect(0, 0, target.width, target.height);
  }
  g.drawImage(current, rect.x, rect.y, rect.width, rect.height, 0, 0, target.width, target.height);
  done(current);
  return out;
};

const encode = async (canvas: OffscreenCanvas, format: OutputFormat, quality: number, lossless: boolean) => {
  const type = FORMAT_MIME[format];
  const q = format === 'png' ? undefined : format === 'webp' && lossless ? 1 : quality / 100;
  const blob = await canvas.convertToBlob(q === undefined ? { type } : { type, quality: q });
  // Chrome writes PNG for a type it cannot encode (§5.1): say so rather than hand over the wrong format.
  if (blob.type !== type) throw new Refusal(`This browser cannot write ${format.toUpperCase()}.`);
  return blob;
};

const decode = async (file: Blob): Promise<ImageBitmap> => {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Refusal(UNDECODABLE);
  }
};

const fullRect = (size: Size): Rect => ({ x: 0, y: 0, ...size });

const convert = async (file: Blob, options: ConvertOptions): Promise<Converted> => {
  const head = new Uint8Array(await file.slice(0, HEAD_BYTES).arrayBuffer());
  const inspected = inspectHead(head, file.size);
  if (!inspected.ok) throw new Refusal(inspected.message);
  if (inspected.type.kind === 'svg') throw new Refusal('An SVG is drawn on the page, not here.');
  const bitmap = await decode(file);
  const source = { width: bitmap.width, height: bitmap.height };
  const plan = planSize(source, options.resize, false);
  if (!plan.ok) {
    bitmap.close();
    throw new Refusal(plan.message);
  }
  const jpeg = options.format === 'jpeg';
  const canvas = drawPlanned(bitmap, plan.crop ?? fullRect(source), plan.size, jpeg ? options.background : undefined);
  const blob = await encode(canvas, options.format, options.quality, options.lossless);
  canvas.width = 0;
  const notes = [
    ...inspected.notes,
    inspected.facts.icoImages > 1 ? icoNote(inspected.facts.icoImages, source) : null,
    plan.notEnlarged ? notEnlargedNote(source) : null,
    plan.enlarged ? enlargedNote(source) : null,
    jpeg && inspected.facts.mayHaveAlpha ? JPEG_ALPHA_NOTE : null,
  ].filter((n): n is string => n !== null);
  return { blob, size: plan.size, source, notes };
};

const encodeDrawn = async (bitmap: ImageBitmap, options: ConvertOptions, mayHaveAlpha: boolean): Promise<Converted> => {
  const size = { width: bitmap.width, height: bitmap.height };
  const jpeg = options.format === 'jpeg';
  const canvas = drawPlanned(bitmap, fullRect(size), size, jpeg ? options.background : undefined);
  const blob = await encode(canvas, options.format, options.quality, options.lossless);
  canvas.width = 0;
  return { blob, size, source: size, notes: jpeg && mayHaveAlpha ? [JPEG_ALPHA_NOTE] : [] };
};

/** The source fitted into a transparent square of `size`, centred (§5.8); the bitmap is not released. */
const squared = (bitmap: ImageBitmap, size: number): OffscreenCanvas => {
  const s = Math.min(size / bitmap.width, size / bitmap.height);
  const fitted = {
    width: Math.max(1, Math.round(bitmap.width * s)),
    height: Math.max(1, Math.round(bitmap.height * s)),
  };
  const drawn = drawPlanned(bitmap, fullRect({ width: bitmap.width, height: bitmap.height }), fitted, undefined, true);
  if (fitted.width === size && fitted.height === size) return drawn;
  const square = new OffscreenCanvas(size, size);
  context(square).drawImage(drawn, Math.floor((size - fitted.width) / 2), Math.floor((size - fitted.height) / 2));
  drawn.width = 0;
  return square;
};

const icons = async (
  request: Extract<WorkerRequest, { type: 'icons' }>,
): Promise<{ files: IconResult[]; notes: string[] }> => {
  const { files, icoSizes, icoImages, background } = request.options;
  const needed = [...new Set([...icoSizes, ...files.map(f => f.size)])].sort((a, b) => a - b);
  const canvases = new Map<number, OffscreenCanvas>();
  const notes: string[] = [];
  if (request.file) {
    const head = new Uint8Array(await request.file.slice(0, HEAD_BYTES).arrayBuffer());
    const inspected = inspectHead(head, request.file.size);
    if (!inspected.ok) throw new Refusal(inspected.message);
    const bitmap = await decode(request.file);
    const source = { width: bitmap.width, height: bitmap.height };
    notes.push(...inspected.notes);
    if (source.width !== source.height) notes.push(NOT_SQUARE_NOTE);
    if (needed.some(size => size > Math.max(source.width, source.height))) notes.push(iconsEnlargedNote(source));
    try {
      for (const size of needed) canvases.set(size, squared(bitmap, size));
    } finally {
      bitmap.close();
    }
  } else
    for (const { size, bitmap } of request.bitmaps ?? []) {
      const canvas = new OffscreenCanvas(size, size);
      context(canvas).drawImage(bitmap, 0, 0);
      bitmap.close();
      canvases.set(size, canvas);
    }
  const canvasOf = (size: number): OffscreenCanvas => {
    const canvas = canvases.get(size);
    if (!canvas) throw new Refusal(`No ${size} × ${size} image was drawn.`);
    return canvas;
  };
  const pngs = new Map<number, Blob>();
  const pngOf = async (size: number): Promise<Blob> => {
    const known = pngs.get(size);
    if (known) return known;
    const blob = await encode(canvasOf(size), 'png', 100, false);
    pngs.set(size, blob);
    return blob;
  };
  const out: IconResult[] = [];
  if (icoSizes.length) {
    const images = await Promise.all(
      [...icoSizes]
        .sort((a, b) => a - b)
        .map(async size => {
          if (icoImages === 'bmp' && size <= DIB_MAX_SIZE) {
            const pixels = context(canvasOf(size)).getImageData(0, 0, size, size).data;
            return { size, data: icoDib(pixels, size) };
          }
          return { size, data: new Uint8Array(await (await pngOf(size)).arrayBuffer()) };
        }),
    );
    const ico = writeIco(images);
    out.push({
      name: ICO_NAME,
      blob: new Blob([ico as Uint8Array<ArrayBuffer>], { type: 'image/x-icon' }),
      sizes: images.map(i => i.size),
    });
  }
  for (const file of files) {
    if (!file.opaque) {
      out.push({ name: file.name, blob: await pngOf(file.size), sizes: [file.size] });
      continue;
    }
    const square = { width: file.size, height: file.size };
    const flat = drawPlanned(canvasOf(file.size), fullRect(square), square, background, true);
    out.push({ name: file.name, blob: await encode(flat, 'png', 100, false), sizes: [file.size] });
    flat.width = 0;
  }
  for (const canvas of canvases.values()) canvas.width = 0;
  return { files: out, notes };
};

const zip = async (files: Array<{ name: string; blob: Blob }>): Promise<Blob> => {
  const entries = await Promise.all(
    files.map(async f => ({ name: f.name, data: new Uint8Array(await f.blob.arrayBuffer()) })),
  );
  return new Blob(zipParts(entries, new Date()) as Uint8Array<ArrayBuffer>[], { type: 'application/zip' });
};

scope.onmessage = ({ data }) => {
  const reply = async (): Promise<WorkerReply> => {
    if (data.type === 'convert') return { id: data.id, type: 'converted', ...(await convert(data.file, data.options)) };
    if (data.type === 'encode')
      return { id: data.id, type: 'converted', ...(await encodeDrawn(data.bitmap, data.options, data.mayHaveAlpha)) };
    if (data.type === 'icons') return { id: data.id, type: 'icons', ...(await icons(data)) };
    return { id: data.id, type: 'zip', blob: await zip(data.files) };
  };
  reply().then(
    message => scope.postMessage(message),
    (error: unknown) =>
      scope.postMessage({
        id: data.id,
        type: 'failed',
        message:
          error instanceof Refusal
            ? error.message
            : `The image could not be converted: ${error instanceof Error ? error.message : String(error)}`,
      }),
  );
};
