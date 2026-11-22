/**
 * The `.ico` container, written by our own code (docs/tools/specs/image-convert.md §5.7; Microsoft's ICO format:
 * ICONDIR, ICONDIRENTRY, and each image as a PNG or a DIB). Square images only — icons are. Entries go in ascending size;
 * a size of 256 is written as 0 in the one-byte fields. `icoDib` writes the classic form for readers that know no PNG
 * inside an `.ico`: a BITMAPINFOHEADER with the height doubled, 32-bit BGRA rows from the bottom up, then the AND mask
 * (1 bit a pixel, rows padded to 32 bits, 1 where the pixel is fully transparent).
 */
import { u16le, u32le } from './sniff';

export interface IcoImage {
  /** Width and height in pixels, 1–256. */
  size: number;
  /** A PNG or a DIB (icoDib). */
  data: Uint8Array;
}

/** The icon sizes the page offers. */
export const ICO_SIZES: readonly number[] = [16, 32, 48, 64, 128, 256];
/** Sizes written as a DIB when the person asks for "BMP up to 48 px, PNG above". */
export const DIB_MAX_SIZE = 48;

const put16 = (out: Uint8Array, at: number, v: number): void => {
  out[at] = v & 0xff;
  out[at + 1] = (v >>> 8) & 0xff;
};
const put32 = (out: Uint8Array, at: number, v: number): void => {
  put16(out, at, v & 0xffff);
  put16(out, at + 2, (v >>> 16) & 0xffff);
};

export const writeIco = (images: readonly IcoImage[]): Uint8Array => {
  if (images.length === 0 || images.length > 0xffff) throw new Error('An .ico holds 1 to 65,535 images.');
  for (const image of images)
    if (!Number.isInteger(image.size) || image.size < 1 || image.size > 256)
      throw new Error('An .ico image is 1 to 256 pixels.');
  const sorted = [...images].sort((a, b) => a.size - b.size);
  const directory = 6 + 16 * sorted.length;
  const total = sorted.reduce((sum, image) => sum + image.data.length, directory);
  const out = new Uint8Array(total);
  put16(out, 0, 0);
  put16(out, 2, 1);
  put16(out, 4, sorted.length);
  let offset = directory;
  sorted.forEach((image, i) => {
    const at = 6 + 16 * i;
    out[at] = image.size === 256 ? 0 : image.size;
    out[at + 1] = image.size === 256 ? 0 : image.size;
    out[at + 2] = 0; // colours in the palette: none
    out[at + 3] = 0; // reserved
    put16(out, at + 4, 1); // colour planes
    put16(out, at + 6, 32); // bits per pixel
    put32(out, at + 8, image.data.length);
    put32(out, at + 12, offset);
    out.set(image.data, offset);
    offset += image.data.length;
  });
  return out;
};

/** A square RGBA image (rows top down, straight alpha, as `getImageData` gives it) as an ICO DIB. */
export const icoDib = (rgba: Uint8Array | Uint8ClampedArray, size: number): Uint8Array => {
  if (rgba.length !== size * size * 4) throw new Error('The pixels do not match the size.');
  const xor = size * size * 4;
  const maskRow = Math.ceil(size / 32) * 4;
  const and = maskRow * size;
  const out = new Uint8Array(40 + xor + and);
  put32(out, 0, 40); // biSize
  put32(out, 4, size); // biWidth
  put32(out, 8, size * 2); // biHeight: the image and its mask
  put16(out, 12, 1); // biPlanes
  put16(out, 14, 32); // biBitCount
  put32(out, 16, 0); // biCompression: BI_RGB
  put32(out, 20, xor + and); // biSizeImage
  // biXPelsPerMeter, biYPelsPerMeter, biClrUsed, biClrImportant: 0
  for (let row = 0; row < size; row++) {
    const y = size - 1 - row; // bottom up
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * 4;
      const to = 40 + (row * size + x) * 4;
      out[to] = rgba[from + 2]!;
      out[to + 1] = rgba[from + 1]!;
      out[to + 2] = rgba[from]!;
      out[to + 3] = rgba[from + 3]!;
      if (rgba[from + 3] === 0) out[40 + xor + row * maskRow + (x >> 3)]! |= 0x80 >> (x & 7);
    }
  }
  return out;
};

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** An `.ico`'s directory as written (for tests and checks); null when the bytes are not one. */
export const readIcoDirectory = (
  bytes: Uint8Array,
): Array<{ size: number; bytes: number; offset: number; png: boolean }> | null => {
  if (bytes.length < 6 || u16le(bytes, 0) !== 0 || u16le(bytes, 2) !== 1) return null;
  const count = u16le(bytes, 4);
  if (bytes.length < 6 + 16 * count) return null;
  return Array.from({ length: count }, (_, i) => {
    const at = 6 + 16 * i;
    const offset = u32le(bytes, at + 12);
    return {
      size: bytes[at] || 256,
      bytes: u32le(bytes, at + 8),
      offset,
      png: PNG_SIGNATURE.every((v, k) => bytes[offset + k] === v),
    };
  });
};
