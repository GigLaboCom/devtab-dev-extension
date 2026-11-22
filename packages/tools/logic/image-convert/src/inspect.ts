/**
 * One source file, before anything is decoded (docs/tools/specs/image-convert.md §5.2, §5.6, §5.9): its type from the
 * first bytes, its header facts, the bounds checked against them — size of the file, pixels the header claims — and the
 * notes the page shows under it. The page runs it on choosing a file (the list says at once what will not work), the
 * worker again before decoding (the bound holds even for a caller that skips the page).
 */
import { count, megapixels, mib, sizeText } from './format';
import { orientedSize, readHeader } from './header';
import { MAX_FILE_BYTES, MAX_SOURCE_PIXELS, MAX_SVG_BYTES } from './limits';
import { sniffImage } from './sniff';
import { svgActiveContent, svgHasForeignObject, svgSize } from './svg';
import type { HeaderFacts, ImageType, Size } from './types';

export const fileTooLarge = (bytes: number): string =>
  `The file is ${count(bytes)} bytes (${mib(bytes)}). This tool reads images up to ${MAX_FILE_BYTES / 1024 / 1024} MiB.`;
export const svgTooLarge = (bytes: number): string =>
  `The SVG is ${count(bytes)} bytes (${mib(bytes)}). This tool reads SVG up to ${MAX_SVG_BYTES / 1024 / 1024} MiB.`;
export const tooManySourcePixels = (size: Size): string =>
  `The image says it is ${sizeText(size)} pixels (${megapixels(size)} megapixels), more than the ${count(MAX_SOURCE_PIXELS / 1_000_000)} megapixels this tool decodes.`;
export const SIZE_UNKNOWN = 'The image’s size could not be read from its header, so it is not decoded.';
export const UNDECODABLE = 'The image could not be decoded: the file may be damaged or truncated.';
export const SVG_UNDRAWABLE = 'The SVG could not be drawn: the markup may be damaged.';
export const SVG_FOREIGN_OBJECT =
  'This SVG cannot be rasterised here: Chrome does not let a page read pixels drawn from a foreignObject.';

export const ANIMATED_NOTE = 'Animated image: only the first frame is converted.';
export const DEPTH_NOTE = '16-bit PNG: converted to 8 bits per channel.';
export const CMYK_NOTE = 'CMYK JPEG: converted to RGB.';
export const orientationNote = (orientation: number): string =>
  `EXIF orientation ${orientation}: turned upright; the result carries no orientation.`;
export const icoNote = (images: number, size: Size): string =>
  `ICO with ${count(images)} images: the one Chrome decodes is used (${sizeText(size)}).`;
export const SVG_ACTIVE_NOTE =
  'This SVG contains scripts or external references. They do not run or load here: the SVG is drawn as an image.';
export const svgViewBoxNote = (size: Size): string =>
  `This SVG has no width and height: its own size comes from its viewBox (${sizeText(size)}).`;
export const SVG_DEFAULT_NOTE =
  'This SVG has no size of its own: it is drawn at 300 × 150, as a browser would. Choose a size to draw it larger.';
export const JPEG_ALPHA_NOTE = 'JPEG has no transparency: transparent areas are filled with the background colour.';
export const NOT_SQUARE_NOTE = 'The image is not square: it is centred on a transparent square.';
export const iconsEnlargedNote = (source: Size): string =>
  `The image is ${sizeText(source)}: icons larger than it are enlarged and look soft.`;
export const METADATA_NOTE =
  'Metadata is not copied: EXIF (camera, date and GPS location), comments and colour profiles are dropped. Colours are converted to sRGB.';

export type Inspected =
  | {
      ok: true;
      type: ImageType;
      facts: HeaderFacts;
      /** The size the picture shows at (after EXIF orientation); for an SVG, its own size (§5.6). */
      size: Size;
      notes: string[];
    }
  | { ok: false; message: string; type?: ImageType };

/** The notes a raster's header facts give (§5.9), in the page's order. ICO's needs the decoded size: the worker adds it. */
export const headerNotes = (facts: HeaderFacts): string[] =>
  [
    facts.animated ? ANIMATED_NOTE : null,
    facts.bitDepth16 ? DEPTH_NOTE : null,
    facts.cmyk ? CMYK_NOTE : null,
    facts.orientation > 1 ? orientationNote(facts.orientation) : null,
  ].filter((n): n is string => n !== null);

/** A raster file from its first bytes and its length; an SVG answers with its type only (inspectSvg reads its text). */
export const inspectHead = (head: Uint8Array, fileBytes: number): Inspected => {
  if (fileBytes > MAX_FILE_BYTES) return { ok: false, message: fileTooLarge(fileBytes) };
  const sniffed = sniffImage(head);
  if (!sniffed.ok) return { ok: false, message: sniffed.message };
  const { type } = sniffed;
  const facts = readHeader(head, type.kind);
  if (type.kind === 'svg') {
    if (fileBytes > MAX_SVG_BYTES) return { ok: false, message: svgTooLarge(fileBytes), type };
    return { ok: true, type, facts, size: { width: 0, height: 0 }, notes: [] };
  }
  if (!facts.size) return { ok: false, message: SIZE_UNKNOWN, type };
  if (facts.size.width * facts.size.height > MAX_SOURCE_PIXELS)
    return { ok: false, message: tooManySourcePixels(facts.size), type };
  return { ok: true, type, facts, size: orientedSize(facts.size, facts.orientation), notes: headerNotes(facts) };
};

/** An SVG's text: its own size and its notes, or why it cannot be rasterised (§5.6). */
export const inspectSvg = (
  text: string,
): { ok: true; size: Size; notes: string[] } | { ok: false; message: string } => {
  if (svgHasForeignObject(text)) return { ok: false, message: SVG_FOREIGN_OBJECT };
  const own = svgSize(text);
  const notes = [
    own.source === 'viewBox' ? svgViewBoxNote(own.size) : null,
    own.source === 'default' ? SVG_DEFAULT_NOTE : null,
    svgActiveContent(text) ? SVG_ACTIVE_NOTE : null,
  ].filter((n): n is string => n !== null);
  return { ok: true, size: own.size, notes };
};
