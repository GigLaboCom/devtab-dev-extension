/**
 * The tool against CSS Color 4 itself, not against the colour library: the specification's sample code (CSS Color 4,
 * §18 «Sample code for Color Conversions» and §14.2 «CSS Gamut Mapping to an RGB Destination», Candidate Recommendation
 * Draft of 2026-11-18) transcribed here — the forward matrices as the specification gives them, their inverses computed —
 * and every notation the tool writes compared with it, over the §10 inputs and a thousand generated colours.
 */
import { convertColor, parseColor, roundTo } from './logic';
import { describe, expect, it } from 'vitest';

type V3 = [number, number, number];
type M3 = [V3, V3, V3];
const mul = (m: M3, v: V3): V3 => m.map(r => r[0] * v[0] + r[1] * v[1] + r[2] * v[2]) as V3;
const inverse = (m: M3): M3 => {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  return [
    [A / det, -(b * i - c * h) / det, (b * f - c * e) / det],
    [B / det, (a * i - c * g) / det, -(a * f - c * d) / det],
    [C / det, -(a * h - b * g) / det, (a * e - b * d) / det],
  ];
};

// CSS Color 4 §18.
const LIN_SRGB_TO_XYZ: M3 = [
  [506752 / 1228815, 87881 / 245763, 12673 / 70218],
  [87098 / 409605, 175762 / 245763, 12673 / 175545],
  [7918 / 409605, 87881 / 737289, 1001167 / 1053270],
];
const LIN_P3_TO_XYZ: M3 = [
  [608311 / 1250200, 189793 / 714400, 198249 / 1000160],
  [35783 / 156275, 247089 / 357200, 198249 / 2500400],
  [0, 32229 / 714400, 5220557 / 5000800],
];
const D65_TO_D50: M3 = [
  [1.0479297925449969, 0.022946870601609652, -0.05019226628920524],
  [0.02962780877005599, 0.9904344267538799, -0.017073799063418826],
  [-0.009243040646204504, 0.015055191490298152, 0.7518742814281371],
];
const XYZ_TO_LMS: M3 = [
  [0.819022437996703, 0.3619062600528904, -0.1288737815209879],
  [0.0329836539323885, 0.9292868615863434, 0.0361446663506424],
  [0.0481771893596242, 0.2642395317527308, 0.6335478284694309],
];
const LMS_TO_OKLAB: M3 = [
  [0.210454268309314, 0.7936177747023054, -0.0040720430116193],
  [1.9779985324311684, -2.42859224204858, 0.450593709617411],
  [0.0259040424655478, 0.7827717124575296, -0.8086757549230774],
];
const D50: V3 = [0.3457 / 0.3585, 1, (1 - 0.3457 - 0.3585) / 0.3585];
const XYZ_TO_LIN_SRGB = inverse(LIN_SRGB_TO_XYZ);
const XYZ_TO_LIN_P3 = inverse(LIN_P3_TO_XYZ);
const OKLAB_TO_LMS = inverse(LMS_TO_OKLAB);
const LMS_TO_XYZ = inverse(XYZ_TO_LMS);

const lin = (c: number) => (Math.abs(c) <= 0.04045 ? c / 12.92 : Math.sign(c) * ((Math.abs(c) + 0.055) / 1.055) ** 2.4);
const gam = (c: number) =>
  Math.abs(c) > 0.0031308 ? Math.sign(c) * (1.055 * Math.abs(c) ** (1 / 2.4) - 0.055) : 12.92 * c;
const oklabToXyz = (lab: V3): V3 => mul(LMS_TO_XYZ, mul(OKLAB_TO_LMS, lab).map(v => v ** 3) as V3);
const xyzToOklab = (xyz: V3): V3 => mul(LMS_TO_OKLAB, mul(XYZ_TO_LMS, xyz).map(Math.cbrt) as V3);
const xyzToLab = (xyz: V3): V3 => {
  const e = 216 / 24389;
  const k = 24389 / 27;
  const f = mul(D65_TO_D50, xyz)
    .map((v, i) => v / D50[i]!)
    .map(v => (v > e ? Math.cbrt(v) : (k * v + 16) / 116));
  return [116 * f[1]! - 16, 500 * (f[0]! - f[1]!), 200 * (f[1]! - f[2]!)];
};
const toLch = ([l, a, b]: V3): V3 => [l, Math.hypot(a, b), ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360];
const oklchToOklab = ([l, c, h]: V3): V3 => [l, c * Math.cos((h * Math.PI) / 180), c * Math.sin((h * Math.PI) / 180)];
const srgbOf = (xyz: V3): V3 => mul(XYZ_TO_LIN_SRGB, xyz).map(gam) as V3;
const p3Of = (xyz: V3): V3 => mul(XYZ_TO_LIN_P3, xyz).map(gam) as V3;
const xyzOfSrgb = (rgb: V3): V3 => mul(LIN_SRGB_TO_XYZ, rgb.map(lin) as V3);
const xyzOfP3 = (rgb: V3): V3 => mul(LIN_P3_TO_XYZ, rgb.map(lin) as V3);

/** CSS Color 4 §14.2, step by step: OKLCH in, an RGB destination (`to`: XYZ → gamma-encoded RGB, `from`: back). */
const gamutMap = (oklch: V3, to: (x: V3) => V3, from: (x: V3) => V3): V3 => {
  const JND = 0.02;
  const EPSILON = 0.0001;
  const clip = (c: V3): V3 => c.map(v => Math.min(1, Math.max(0, v))) as V3;
  const inGamut = (c: V3) => c.every(v => v >= 0 && v <= 1);
  const dest = (lch: V3) => to(oklabToXyz(oklchToOklab(lch)));
  const deltaEOK = (rgb: V3, lch: V3) => {
    const a = xyzToOklab(from(rgb));
    const b = oklchToOklab(lch);
    return Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
  };
  if (oklch[0] >= 1) return [1, 1, 1];
  if (oklch[0] <= 0) return [0, 0, 0];
  if (inGamut(dest(oklch))) return dest(oklch);
  let clipped = clip(dest(oklch));
  if (deltaEOK(clipped, oklch) < JND) return clipped;
  let min = 0;
  let max = oklch[1];
  let minInGamut = true;
  const current: V3 = [...oklch];
  while (max - min > EPSILON) {
    const chroma = (min + max) / 2;
    current[1] = chroma;
    if (minInGamut && inGamut(dest(current))) {
      min = chroma;
      continue;
    }
    clipped = clip(dest(current));
    const E = deltaEOK(clipped, current);
    if (E < JND) {
      if (JND - E < EPSILON) return clipped;
      minInGamut = false;
      min = chroma;
    } else max = chroma;
  }
  return clipped;
};

const hex = (rgb: V3) =>
  `#${rgb
    .map(v =>
      Math.round(roundTo(Math.min(1, Math.max(0, v)) * 255, 6))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
const nums = (s: string) => [...s.replace('display-p3', '').matchAll(/-?[\d.]+/g)].map(m => parseFloat(m[0]));

/** What CSS Color 4's code says each notation is, for a colour given as XYZ D65. */
const reference = (xyz: V3) => {
  const lab = xyzToLab(xyz);
  const oklab = xyzToOklab(xyz);
  const tolerance = 0.5 / 255;
  const inside = (c: V3) => c.every(v => v >= -tolerance && v <= 1 + tolerance);
  const oklch = toLch(oklab);
  const srgb = srgbOf(xyz);
  const p3 = p3Of(xyz);
  return {
    lab,
    lch: toLch(lab),
    oklab,
    oklch,
    hex: hex(inside(srgb) ? srgb : gamutMap(oklch, srgbOf, xyzOfSrgb)),
    p3: inside(p3) ? p3.map(v => Math.min(1, Math.max(0, v))) : gamutMap(oklch, p3Of, xyzOfP3),
  };
};

/** Largest difference, in units of the last digit shown, between the tool's numbers and the reference's. */
const units = (shown: string, want: number[], digits: number[], scale: number[] = [1, 1, 1]): number =>
  Math.max(
    ...nums(shown)
      .slice(0, 3)
      .map((v, i) => Math.abs(v - want[i]! * scale[i]!) * 10 ** digits[i]!),
  );

const compare = (input: string, xyz: V3) => {
  const parsed = parseColor(input);
  if (!parsed.ok) throw new Error(input);
  const f = convertColor(parsed.color);
  const r = reference(xyz);
  const hue = (c: number, h: number[]) => (c < 0.5 ? [h[0]!, h[1]!, nums(f.lch)[2]!] : h);
  return {
    f,
    r,
    lab: units(f.lab, r.lab, [2, 2, 2]),
    lch: units(f.lch, hue(r.lch[1], r.lch), [2, 2, 2]),
    oklab: units(f.oklab, r.oklab, [2, 4, 4], [100, 1, 1]),
    oklch: units(
      f.oklch,
      r.oklch[1] < 0.002 ? [r.oklch[0], r.oklch[1], nums(f.oklch)[2]!] : r.oklch,
      [2, 4, 2],
      [100, 1, 1],
    ),
    p3: units(f.p3, r.p3, [4, 4, 4]),
  };
};

describe('CSS Color 4 sample code as the reference', () => {
  it('the #7654CD worked example: lab(44.36% 36.05 -58.99), lch(44.36% 69.13 301.43)', () => {
    const r = reference(xyzOfSrgb([0x76 / 255, 0x54 / 255, 0xcd / 255]));
    expect(r.lab.map(v => roundTo(v, 2))).toEqual([44.36, 36.05, -58.99]);
    expect(r.lch.map(v => roundTo(v, 2))).toEqual([44.36, 69.13, 301.43]);
  });

  it('a thousand sRGB colours: every notation the same digits, but at a rounding boundary', () => {
    let seed = 13;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    const worst = { lab: 0, lch: 0, oklab: 0, oklch: 0, p3: 0 };
    for (let k = 0; k < 1000; k++) {
      const rgb: V3 = [next(), next(), next()].map(v => Math.round(v * 255) / 255) as V3;
      const c = compare(hex(rgb), xyzOfSrgb(rgb));
      expect(c.f.hex).toBe(c.r.hex);
      for (const key of Object.keys(worst) as Array<keyof typeof worst>) worst[key] = Math.max(worst[key], c[key]);
    }
    // Half a unit: the same digits, but where the two computations (agreeing to ~1e-5) straddle a rounding boundary.
    for (const value of Object.values(worst)) expect(value).toBeLessThan(0.51);
  });

  it('a thousand OKLCH colours, most of them outside sRGB: the same mapping as §14.2 to within one 8-bit step', () => {
    let seed = 29;
    const next = () => (seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31;
    let differ = 0;
    let largest = 0;
    for (let k = 0; k < 1000; k++) {
      const lch: V3 = [roundTo(0.05 + next() * 0.9, 4), roundTo(next() * 0.37, 4), roundTo(next() * 360, 2)];
      const c = compare(`oklch(${lch[0]} ${lch[1]} ${lch[2]})`, oklabToXyz(oklchToOklab(lch)));
      expect(c.oklch).toBeLessThanOrEqual(1);
      expect(c.lab).toBeLessThanOrEqual(1);
      const d = Math.max(
        ...[1, 3, 5].map(i => Math.abs(parseInt(c.f.hex.slice(i, i + 2), 16) - parseInt(c.r.hex.slice(i, i + 2), 16))),
      );
      largest = Math.max(largest, d);
      if (d > 0) differ++;
    }
    expect(largest).toBeLessThanOrEqual(1);
    expect(differ).toBeLessThan(50);
  });

  it('the §10 colours outside sRGB map as §14.2 does', () => {
    for (const [input, lch] of [
      ['oklch(70% 0.4 150)', [0.7, 0.4, 150]],
      ['oklch(62.8% 0.2577 29.23)', [0.628, 0.2577, 29.23]],
      ['oklch(120% 0.1 150)', [1, 0.1, 150]],
    ] as const) {
      const c = compare(input, oklabToXyz(oklchToOklab([...lch])));
      expect(c.f.hex, input).toBe(c.r.hex);
    }
    const p3 = compare('color(display-p3 0 1 0)', xyzOfP3([0, 1, 0]));
    expect(p3.f.hex).toBe(p3.r.hex);
  });
});
