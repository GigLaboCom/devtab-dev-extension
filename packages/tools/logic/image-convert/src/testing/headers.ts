/**
 * Headers built byte by byte for the tests (docs/tools/specs/image-convert.md §10): a PNG signature and IHDR claiming
 * any size, a JPEG start with an EXIF orientation and a SOF — the header is all the logic reads.
 */
const enc = (text: string) => new TextEncoder().encode(text);

export const concat = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
};

/** A PNG chunk (its CRC left zero: the logic never checks it). */
export const pngChunk = (type: string, data = new Uint8Array(0)): Uint8Array => {
  const out = new Uint8Array(12 + data.length);
  new DataView(out.buffer).setUint32(0, data.length);
  out.set(enc(type), 4);
  out.set(data, 8);
  return out;
};

export const pngHeader = (
  width: number,
  height: number,
  depth = 8,
  colour = 6,
  chunks: Uint8Array[] = [],
): Uint8Array => {
  const ihdr = new Uint8Array(13);
  const v = new DataView(ihdr.buffer);
  v.setUint32(0, width);
  v.setUint32(4, height);
  ihdr[8] = depth;
  ihdr[9] = colour;
  return concat(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk('IHDR', ihdr), ...chunks);
};

/** SOI, an optional APP1 EXIF holding one orientation tag, then a SOF0 of the size and components. */
export const jpegHeader = (
  width: number,
  height: number,
  components = 3,
  orientation?: number,
  order: 'II' | 'MM' = 'MM',
): Uint8Array => {
  const parts: Uint8Array[] = [new Uint8Array([0xff, 0xd8])];
  if (orientation !== undefined) {
    const little = order === 'II';
    const tiff = new Uint8Array(8 + 2 + 12 + 4);
    const t = new DataView(tiff.buffer);
    tiff.set(enc(order), 0);
    t.setUint16(2, 42, little);
    t.setUint32(4, 8, little);
    t.setUint16(8, 1, little);
    t.setUint16(10, 0x0112, little);
    t.setUint16(12, 3, little);
    t.setUint32(14, 1, little);
    t.setUint16(18, orientation, little);
    const body = concat(enc('Exif\0\0'), tiff);
    const length = body.length + 2;
    parts.push(new Uint8Array([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]), body);
  }
  const sofLength = 8 + 3 * components;
  parts.push(
    new Uint8Array([0xff, 0xc0, 0, sofLength, 8, height >> 8, height & 0xff, width >> 8, width & 0xff, components]),
    new Uint8Array(3 * components),
  );
  return concat(...parts);
};
