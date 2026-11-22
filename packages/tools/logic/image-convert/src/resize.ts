/**
 * The size of a result (docs/tools/specs/image-convert.md §5.5): from the source's size and the person's choice —
 * original, a width, a height, both with a fit (contain, cover, exact), or a percentage — keeping the aspect ratio
 * except in Stretch. A raster is never enlarged silently: without "Allow enlarging" the scale stops at 1 and the plan
 * says so; with it, the plan says that it enlarged. An SVG is drawn at any size: nothing is enlarged. The canvas's own
 * bounds (§5.1) stop a plan before a canvas is made. And the steps a raster is shrunk by: halves while it is at least
 * twice the target, then one draw (§12: much closer to an exact area average than one draw in this Chrome).
 */
import { count, sizeText } from './format';
import { MAX_OUTPUT_PIXELS, MAX_SIDE } from './limits';
import type { Rect, Size } from './types';

export type SizeMode = 'original' | 'width' | 'height' | 'both' | 'percent';
export type Fit = 'contain' | 'cover' | 'exact';

export interface ResizeOptions {
  mode: SizeMode;
  width: number;
  height: number;
  percent: number;
  fit: Fit;
  enlarge: boolean;
}

export type SizePlan =
  | {
      ok: true;
      size: Size;
      /** The part of the source drawn (Fill and crop); null for all of it. */
      crop: Rect | null;
      /** The raster was enlarged ("Allow enlarging"). */
      enlarged: boolean;
      /** The plan would have enlarged the raster and was held at its size. */
      notEnlarged: boolean;
    }
  | { ok: false; message: string };

const whole = (n: number): number => Math.max(1, Math.round(n));

export const notEnlargedNote = (source: Size): string =>
  `Not enlarged: the image is ${sizeText(source)}. Tick “Allow enlarging” to make it larger.`;
export const enlargedNote = (source: Size): string => `Enlarged from ${sizeText(source)}: enlarging adds no detail.`;
export const tooWide = (size: Size): string =>
  `The result would be ${sizeText(size)} pixels, wider or taller than ${count(MAX_SIDE)} pixels, the largest canvas Chrome makes.`;
export const tooManyPixels = (size: Size): string =>
  `The result would be ${sizeText(size)} pixels, more than the ${count(MAX_OUTPUT_PIXELS / 1_000_000)} megapixels this tool makes.`;

/** The largest centred rectangle of the box's aspect ratio inside the source. */
const centredCrop = (source: Size, box: Size): Rect => {
  const ratio = box.width / box.height;
  const width = Math.min(source.width, source.height * ratio);
  const height = Math.min(source.height, source.width / ratio);
  return { x: (source.width - width) / 2, y: (source.height - height) / 2, width, height };
};

/** The plan before the enlarging rule and the bounds. */
const wanted = (source: Size, o: ResizeOptions): { size: Size; crop: Rect | null } => {
  const { width: w, height: h } = source;
  if (o.mode === 'width') return { size: { width: o.width, height: whole((h * o.width) / w) }, crop: null };
  if (o.mode === 'height') return { size: { width: whole((w * o.height) / h), height: o.height }, crop: null };
  if (o.mode === 'percent')
    return { size: { width: whole((w * o.percent) / 100), height: whole((h * o.percent) / 100) }, crop: null };
  if (o.mode === 'both') {
    const box = { width: o.width, height: o.height };
    if (o.fit === 'exact') return { size: box, crop: null };
    if (o.fit === 'cover') {
      const crop = centredCrop(source, box);
      const all = crop.width === w && crop.height === h;
      return { size: box, crop: all ? null : crop };
    }
    const s = Math.min(o.width / w, o.height / h);
    return { size: { width: whole(w * s), height: whole(h * s) }, crop: null };
  }
  return { size: { ...source }, crop: null };
};

/** The raster held at its own scale: what each mode gives when it may not enlarge. */
const held = (source: Size, o: ResizeOptions): { size: Size; crop: Rect | null } => {
  if (o.mode === 'both' && o.fit === 'exact')
    return { size: { width: Math.min(o.width, source.width), height: Math.min(o.height, source.height) }, crop: null };
  if (o.mode === 'both' && o.fit === 'cover') {
    const crop = centredCrop(source, { width: o.width, height: o.height });
    const size = { width: whole(crop.width), height: whole(crop.height) };
    const all = crop.width === source.width && crop.height === source.height;
    return { size, crop: all ? null : crop };
  }
  return { size: { ...source }, crop: null };
};

export const planSize = (source: Size, options: ResizeOptions, vector: boolean): SizePlan => {
  let { size, crop } = wanted(source, options);
  const drawn = crop ?? { width: source.width, height: source.height };
  const enlarging = !vector && (size.width > drawn.width || size.height > drawn.height);
  let enlarged = false;
  let notEnlarged = false;
  if (enlarging && options.enlarge) enlarged = true;
  else if (enlarging) {
    ({ size, crop } = held(source, options));
    notEnlarged = true;
  }
  if (size.width > MAX_SIDE || size.height > MAX_SIDE) return { ok: false, message: tooWide(size) };
  if (size.width * size.height > MAX_OUTPUT_PIXELS) return { ok: false, message: tooManyPixels(size) };
  return { ok: true, size, crop, enlarged, notEnlarged };
};

/** The halves a raster passes through on its way down to `to` (the last may equal `to`; then no last draw is needed). */
export const halvingSteps = (from: Size, to: Size): Size[] => {
  const steps: Size[] = [];
  let current = from;
  while (current.width / 2 >= to.width && current.height / 2 >= to.height) {
    current = { width: Math.round(current.width / 2), height: Math.round(current.height / 2) };
    steps.push(current);
  }
  return steps;
};

/** A field's whole number in [min, max], or null: digits only, after trimming. */
export const parseWhole = (text: string, min: number, max: number): number | null => {
  const trimmed = text.trim();
  if (!/^\d{1,9}$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return n >= min && n <= max ? n : null;
};

/** The words under a field whose number is out of range (§5.5). */
export const wholeNumberError = (label: string, min: number, max: number): string =>
  `${label} must be a whole number from ${count(min)} to ${count(max)}.`;
