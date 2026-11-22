/** The shapes the Image Converter's logic works with (docs/tools/specs/image-convert.md §9). */

/** What a file's first bytes say it is. */
export type ImageKind = 'png' | 'jpeg' | 'gif' | 'webp' | 'bmp' | 'ico' | 'avif' | 'svg';
/** What the canvas writes (§5.1: any other type comes out as PNG). */
export type OutputFormat = 'png' | 'jpeg' | 'webp';

export interface Size {
  width: number;
  height: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ImageType {
  kind: ImageKind;
  /** 'PNG', 'JPEG', … */
  name: string;
  mime: string;
  /** 'png', 'jpg', … */
  ext: string;
}

export type SniffResult = { ok: true; type: ImageType } | { ok: false; message: string };

/** What a file's header says without decoding it (§5.2). */
export interface HeaderFacts {
  /** As stored, before an EXIF orientation turns it; null when the header does not give it. */
  size: Size | null;
  animated: boolean;
  mayHaveAlpha: boolean;
  bitDepth16: boolean;
  cmyk: boolean;
  /** EXIF orientation 1–8 (JPEG); 1 when there is none. */
  orientation: number;
  /** ICO: the images its directory lists; 0 for other kinds. */
  icoImages: number;
}
