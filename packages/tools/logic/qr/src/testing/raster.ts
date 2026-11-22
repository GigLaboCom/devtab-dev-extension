/**
 * Test pictures of a module matrix (only the tests import this): RGBA pixels with a quiet zone, scaled, optionally
 * turned, blurred by noise or inverted — the "photo" of §10 made without a camera. Seeded, so a failure repeats.
 */
import type { Pixels } from '../read';

export interface RasterOptions {
  /** Pixels per module. */
  px?: number;
  /** Quiet zone in modules. */
  quiet?: number;
  /** Degrees, clockwise, about the picture's centre. */
  rotate?: number;
  /** 0…1: share of the full range added as noise to every pixel. */
  noise?: number;
  /** Light on dark. */
  invert?: boolean;
  seed?: number;
  /** Extra white margin in pixels (room to turn). */
  margin?: number;
}

/** mulberry32: small, fast, seeded. */
export const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

export const raster = (modules: readonly (readonly boolean[])[], options: RasterOptions = {}): Pixels => {
  const { px = 8, quiet = 4, rotate = 0, noise = 0, invert = false, seed = 1, margin = rotate ? 0.25 : 0 } = options;
  const n = modules.length + 2 * quiet;
  const symbol = n * px;
  const pad = Math.round(margin * symbol);
  const side = symbol + 2 * pad;
  const data = new Uint8ClampedArray(side * side * 4);
  const rnd = random(seed);
  const a = (-rotate * Math.PI) / 180;
  const cos = Math.cos(a);
  const sin = Math.sin(a);
  const c = side / 2;
  for (let y = 0; y < side; y++)
    for (let x = 0; x < side; x++) {
      // The point of the upright picture this pixel shows.
      const sx = cos * (x + 0.5 - c) - sin * (y + 0.5 - c) + c - pad;
      const sy = sin * (x + 0.5 - c) + cos * (y + 0.5 - c) + c - pad;
      const mx = Math.floor(sx / px) - quiet;
      const my = Math.floor(sy / px) - quiet;
      const dark = my >= 0 && my < modules.length && mx >= 0 && mx < modules.length && modules[my]![mx]!;
      let v = dark !== invert ? 0 : 255;
      if (noise) v += (rnd() - 0.5) * 2 * noise * 255;
      const i = (y * side + x) * 4;
      data[i] = data[i + 1] = data[i + 2] = v;
      data[i + 3] = 255;
    }
  return { width: side, height: side, data };
};

/** Two pictures side by side on white. */
export const besideEachOther = (left: Pixels, right: Pixels): Pixels => {
  const width = left.width + right.width;
  const height = Math.max(left.height, right.height);
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (const [img, dx] of [
    [left, 0],
    [right, left.width],
  ] as const)
    for (let y = 0; y < img.height; y++)
      data.set(img.data.subarray(y * img.width * 4, (y + 1) * img.width * 4), (y * width + dx) * 4);
  return { width, height, data };
};

/** A picture of nothing: white with grey noise. */
export const blank = (width: number, height: number, seed = 3): Pixels => {
  const rnd = random(seed);
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) {
    const v = 200 + rnd() * 55;
    data[i] = data[i + 1] = data[i + 2] = v;
    data[i + 3] = 255;
  }
  return { width, height, data };
};
