/**
 * The Base64 Image tool's logic: the functions of docs/tools/specs/base64-image.md §9, with their signatures. Pure: no
 * React, no DOM, no chrome. Base64 comes from @workspace/tools-shared/base64 (`bytesToBase64`, `parseBase64`); the
 * tool's own code is recognising the type (sniff.ts), the size from the header (dimensions.ts), what an SVG carries
 * (svg.ts), reading Decode's input (input.ts) and the forms of the output. Reading files, object URLs, the preview,
 * saving and pasting are the component's: they need a DOM.
 */
import { imageDimensions } from './dimensions';
import { parseImageInput } from './input';
import { MAX_PREVIEW_PIXELS, SHOWN_OUTPUT_CHARS } from './limits';
import { IMAGE_TYPES, sniffImage } from './sniff';
import { svgHasActiveContent } from './svg';
import { bytesToBase64 } from '@workspace/tools-shared/base64';
import type { InputError, InputShape } from './input';
import type { ImageMime, ImageType } from './sniff';
import type { Dimensions } from './svg';

export type OutputForm = 'dataUri' | 'base64' | 'img' | 'css';
export type LineLength = 0 | 64 | 76;

export interface DecodedImage {
  bytes: Uint8Array;
  type: ImageType;
  dimensions: Dimensions | null;
  /** The type a data: URI declared, lowercased, without parameters; null for bare Base64 or none. */
  declaredMime: string | null;
  /** SVG only: contains a script, an event attribute or an external reference. */
  svgActiveContent: boolean;
}

export type DecodeImageResult =
  { ok: true; image: DecodedImage | null; shape?: InputShape } | { ok: false; error: InputError };

export const INPUT_TOO_LARGE = 'Input is larger than 14 MB of Base64 (about 10 MiB of image).';
export const ACTIVE_SVG_NOTE =
  'This SVG contains scripts or external references. They do not run here, but may run if you open the saved file in a browser.';

const count = (n: number): string => n.toLocaleString('en-US');

/** '78 bytes', '1,024 bytes (1.0 KiB)', '1,269,328 bytes (1.2 MiB)'. */
export const formatSize = (bytes: number): string => {
  if (bytes < 1024) return `${count(bytes)} ${bytes === 1 ? 'byte' : 'bytes'}`;
  const kib = bytes / 1024;
  // The unit follows the rounded value: 1,048,575 bytes is 1.0 MiB, not 1024.0 KiB.
  const inKib = Number(kib.toFixed(1)) < 1024;
  return `${count(bytes)} bytes (${inKib ? `${kib.toFixed(1)} KiB` : `${(bytes / 1048576).toFixed(1)} MiB`})`;
};

/** §6: a file over MAX_IMAGE_BYTES, said before it is read. */
export const fileTooLarge = (bytes: number): string =>
  `The image is ${count(bytes)} bytes (${(bytes / 1048576).toFixed(1)} MiB). This tool works with images up to 10 MiB.`;

/** §6: what a long output says under its field. */
export const truncatedNote = (length: number): string =>
  `Showing the first ${count(SHOWN_OUTPUT_CHARS)} of ${count(length)} characters. Copy copies all.`;

/** Characters of the padded, unwrapped Base64 of `bytes` bytes. */
export const base64Length = (bytes: number): number => Math.ceil(bytes / 3) * 4;

/** Wraps Base64 into lines of `lineLength` characters joined by `\n` (0: as it is). */
const wrap = (text: string, lineLength: LineLength): string => {
  if (lineLength === 0 || text.length <= lineLength) return text;
  const lines: string[] = [];
  for (let at = 0; at < text.length; at += lineLength) lines.push(text.slice(at, at + lineLength));
  return lines.join('\n');
};

/** §5 «Формы вывода»: `base64` is the padded standard Base64 of the file, unwrapped. */
export const formatOutput = (
  base64: string,
  image: Pick<DecodedImage, 'type' | 'dimensions'>,
  form: OutputForm,
  lineLength: LineLength,
): string => {
  const uri = `data:${image.type.mime};base64,${base64}`;
  if (form === 'base64') return wrap(base64, lineLength);
  if (form === 'css') return `url("${uri}")`;
  if (form === 'img') {
    const d = image.dimensions;
    return `<img src="${uri}"${d ? ` width="${d.width}" height="${d.height}"` : ''} alt="">`;
  }
  return uri;
};

/** For Encode: a file's bytes, recognised by their content. */
export const describeImage = (
  bytes: Uint8Array,
): { ok: true; image: DecodedImage } | { ok: false; message: string } => {
  const sniffed = sniffImage(bytes);
  if (!sniffed.ok) return sniffed;
  const { type } = sniffed;
  return {
    ok: true,
    image: {
      bytes,
      type,
      dimensions: imageDimensions(bytes, type.mime),
      declaredMime: null,
      svgActiveContent: type.mime === 'image/svg+xml' && svgHasActiveContent(bytes),
    },
  };
};

/** For Encode, the whole of it: the file's bytes recognised, and their padded standard Base64 (§5 «Формы вывода»: B). */
export const encodeImage = (
  bytes: Uint8Array,
): { ok: true; image: DecodedImage; base64: string } | { ok: false; message: string } => {
  const described = describeImage(bytes);
  return described.ok ? { ...described, base64: bytesToBase64(bytes) } : described;
};

/** Decode's Copy data URI (§3): the image's bytes under the recognised type — the declared type and parameters dropped. */
export const toDataUri = (image: Pick<DecodedImage, 'bytes' | 'type'>): string =>
  `data:${image.type.mime};base64,${bytesToBase64(image.bytes)}`;

/**
 * Whether a preview may decode an image of this size (§15, the limit the measurements set): a header may claim any size
 * — a 1 KB PNG can say 50,000 × 50,000 — and decoding it would ask for gigabytes. Null: it may.
 */
export const previewRefusal = (dimensions: Dimensions | null): string | null =>
  dimensions && dimensions.width * dimensions.height > MAX_PREVIEW_PIXELS
    ? `No preview: the image says it is ${count(dimensions.width)} × ${count(dimensions.height)} pixels, more than the ${count(MAX_PREVIEW_PIXELS / 1_000_000)} megapixels a preview may decode.`
    : null;

/** For Decode: a data: URI or bare Base64 (or either inside `url(…)` / `<img src>`); image null for an empty input. */
export const decodeImageInput = (text: string): DecodeImageResult => {
  const parsed = parseImageInput(text);
  if (!parsed.ok) return parsed;
  if (parsed.bytes.length === 0) return { ok: true, image: null, shape: parsed.shape };
  const described = describeImage(parsed.bytes);
  if (!described.ok) return { ok: false, error: { message: described.message } };
  return { ok: true, image: { ...described.image, declaredMime: parsed.declaredMime }, shape: parsed.shape };
};

/** Declared names that mean one of the recognised types (common, if not registered). */
const ALIASES: Readonly<Record<string, ImageMime>> = {
  'image/jpg': 'image/jpeg',
  'image/pjpeg': 'image/jpeg',
  'image/apng': 'image/png',
  'image/x-png': 'image/png',
  'image/vnd.microsoft.icon': 'image/x-icon',
  'image/ico': 'image/x-icon',
  'image/icon': 'image/x-icon',
  'image/x-ico': 'image/x-icon',
  'image/x-ms-bmp': 'image/bmp',
  'image/x-bmp': 'image/bmp',
  'image/svg': 'image/svg+xml',
};

/** §5 step 5: 'Declared image/png, but the bytes are JPEG.' when a declared type is not the recognised one. */
export const declaredMismatch = (image: Pick<DecodedImage, 'declaredMime' | 'type'>): string | null => {
  const declared = image.declaredMime;
  if (declared === null || (ALIASES[declared] ?? declared) === image.type.mime) return null;
  return `Declared ${declared}, but the bytes are ${image.type.name}.`;
};

/** The type of a MIME string the tool recognises (a history entry's), or null. */
export const imageTypeOf = (mime: unknown): ImageType | null =>
  typeof mime === 'string' && Object.hasOwn(IMAGE_TYPES, mime) ? IMAGE_TYPES[mime as ImageMime] : null;
