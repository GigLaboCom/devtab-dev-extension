/**
 * The Color tool's logic (docs/tools/specs/color.md §5, §9): read a colour in any CSS Color 4 notation, write it in
 * all of them, map it into sRGB and Display P3 by CSS Color 4 §13.2, name it, and the WCAG 2.2 contrast of two colours.
 * The only module that imports the colour library (`culori/fn`, 4.0.2); `detect` does not. Pure: no React, no DOM.
 *
 * The chain (§5.3): parse and clamp → the colour as written; → sRGB, in gamut within half an 8-bit step, else gamut
 * mapped → HEX, RGB, HSL, HWB, the name and the contrast; LAB, LCH, OKLAB and OKLCH from the colour as written; Display
 * P3 like sRGB, in its own gamut.
 */
import { MAX_INPUT } from './detect';
import { COLOR_FUNCTIONS, isColorFunction } from './syntax';
import {
  colorsNamed,
  converter,
  differenceEuclidean,
  getMode,
  modeA98,
  modeHsl,
  modeHwb,
  modeLab,
  modeLch,
  modeLrgb,
  modeOklab,
  modeOklch,
  modeP3,
  modeProphoto,
  modeRec2020,
  modeRgb,
  modeXyz50,
  modeXyz65,
  parse,
  toGamut,
  useMode as registerMode,
} from 'culori/fn';
import type { Color as CuloriColor } from 'culori/fn';

// The modes of CSS Color 4: what `parse` reads and the spaces the formats are written in.
for (const mode of [
  modeRgb,
  modeHsl,
  modeHwb,
  modeLab,
  modeLch,
  modeOklab,
  modeOklch,
  modeP3,
  modeLrgb,
  modeXyz50,
  modeXyz65,
  modeRec2020,
  modeA98,
  modeProphoto,
])
  registerMode(mode);

/** culori's object after the clamping of §5.1: every channel a number (`none` is 0), `alpha` 0–1. */
export interface Color {
  mode: string;
  alpha?: number;
  [channel: string]: number | string | undefined;
}

export type ParseColorResult =
  | { ok: true; color: Color; /** "Read as #ff8800" */ note?: string }
  | { ok: false; message: string }
  | { ok: false; empty: true };

export const NOT_A_COLOUR = 'Not a CSS colour. Try #ff8800, rgb(255 136 0), hsl(32 100% 50%) or oklch(74% 0.18 56).';
export const UNSUPPORTED = 'Relative colours, color-mix(), light-dark() and device-cmyk() are not supported.';
export const TOO_LONG = `The colour is longer than ${MAX_INPUT} characters.`;

const PAGE_KEYWORDS = new Set(['currentcolor', 'inherit', 'initial', 'unset', 'revert', 'revert-layer']);
const BARE_HEX = /^(?:[0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/;
/** `rgb(from …)`, `hsl(from …)` — the relative syntax; `from` right after the parenthesis. */
const RELATIVE = /^[a-z-]+\(\s*from[\s(]/;
const UNSUPPORTED_FUNCTIONS = /^(?:color-mix|light-dark|device-cmyk)\(/;
/** `… / none)`: the alpha is `none`, which CSS paints as 0 (culori leaves it out, which would read as 1). */
const ALPHA_NONE = /\/[ \t\n]*none[ \t\n]*\)$/;

const clamp01 = (v: number): number => Math.min(1, Math.max(0, v));
const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/**
 * Parsed-value clamping as CSS Color 4 §5–§9 and Chrome 159 do it (§5.1 rule 4), and `none` as 0. Inside `color()`
 * channels are not clamped.
 */
const settle = (parsed: CuloriColor, inColorFunction: boolean, alphaNone: boolean, legacy: boolean): Color => {
  const source = parsed as unknown as Record<string, unknown>;
  const out: Color = { mode: parsed.mode };
  for (const channel of getMode(parsed.mode).channels) if (channel !== 'alpha') out[channel] = num(source[channel]);
  out.alpha = alphaNone ? 0 : typeof parsed.alpha === 'number' ? clamp01(parsed.alpha) : 1;
  if (inColorFunction) return out;
  const clampTo = (keys: string[], lo: number, hi: number) => {
    for (const k of keys) out[k] = Math.min(hi, Math.max(lo, out[k] as number));
  };
  if (out.mode === 'rgb') clampTo(['r', 'g', 'b'], 0, 1);
  // hsl(): legacy (comma) syntax clamps both to 0–100 %, as Chrome does; the modern syntax only clamps them at 0 —
  // CSS Color 4 §7 clamps a negative saturation, Chrome 159 a negative lightness too; above 100 % stays (§15).
  if (out.mode === 'hsl') clampTo(['s', 'l'], 0, legacy ? 1 : Infinity);
  if (out.mode === 'hwb') clampTo(['w', 'b'], 0, 1);
  if (out.mode === 'lab' || out.mode === 'lch') clampTo(['l'], 0, 100);
  if (out.mode === 'oklab' || out.mode === 'oklch') clampTo(['l'], 0, 1);
  if (out.mode === 'lch' || out.mode === 'oklch') clampTo(['c'], 0, Infinity);
  return out;
};

/**
 * Reads what a person typed (§5.1): any notation of CSS Color 4, any case, the edges trimmed; hex without `#` with a
 * note; page-dependent keywords and the relative and mixing functions refused with their reason.
 */
export const parseColor = (input: string): ParseColorResult => {
  const typed = input.trim();
  if (typed === '') return { ok: false, empty: true };
  if (typed.length > MAX_INPUT) return { ok: false, message: TOO_LONG };
  let text = typed.toLowerCase();
  if (PAGE_KEYWORDS.has(text)) return { ok: false, message: `${typed} depends on the page; enter a concrete colour.` };
  if (UNSUPPORTED_FUNCTIONS.test(text) || RELATIVE.test(text)) return { ok: false, message: UNSUPPORTED };
  let note: string | undefined;
  if (BARE_HEX.test(text)) {
    note = `Read as #${text}`;
    text = `#${text}`;
  }
  const open = text.indexOf('(');
  if (open >= 0 && (!COLOR_FUNCTIONS.includes(text.slice(0, open)) || !isColorFunction(text)))
    return { ok: false, message: NOT_A_COLOUR };
  if (open < 0 && !(text.startsWith('#') ? BARE_HEX.test(text.slice(1)) : /^[a-z]+$/.test(text)))
    return { ok: false, message: NOT_A_COLOUR };
  const parsed = parse(text);
  if (!parsed) return { ok: false, message: NOT_A_COLOUR };
  const color = settle(parsed, text.startsWith('color('), ALPHA_NONE.test(text), text.includes(','));
  return note === undefined ? { ok: true, color } : { ok: true, color, note };
};

// ---- numbers ----

/** Half away from zero (2.5 → 3, −2.5 → −3); −0 → 0. Binary noise below 1e-9 of a step is absorbed. */
export const roundTo = (x: number, digits: number): number => {
  const f = 10 ** digits;
  const v = (Math.sign(x) * Math.floor(Math.abs(x) * f + 0.5 + 1e-9)) / f;
  return Object.is(v, -0) || v === 0 ? 0 : v;
};

/** 0–1 → 0–255 (§5.2 «8 бит»): noise taken off at 6 decimals, then half up — rgb(127.5 0 0) is 128, as in Chrome. */
export const to8bit = (channel: number): number => Math.round(roundTo(clamp01(channel) * 255, 6));

const text = (x: number, digits: number): string => String(roundTo(x, digits));
const byte = (n: number): string => n.toString(16).padStart(2, '0');
const alphaText = (a: number): string => (roundTo(a, 3) < 1 ? ` / ${text(a, 3)}` : '');

/** A hue in [0, 360) after rounding; `0` when it means nothing (§5.2). */
const hueText = (h: number | undefined, powerless: boolean, digits: number): string => {
  if (powerless || h === undefined || !Number.isFinite(h)) return '0';
  const v = roundTo(((h % 360) + 360) % 360, digits);
  return String(v >= 360 ? 0 : v);
};

// ---- the chain ----

type Rgb = { mode: 'rgb' | 'p3'; r: number; g: number; b: number; alpha?: number };

const toRgb = converter('rgb');
const toP3 = converter('p3');
const toHsl = converter('hsl');
const toHwb = converter('hwb');
const toLab = converter('lab');
const toLch = converter('lch');
const toOklab = converter('oklab');
const toOklch = converter('oklch');
// CSS Color 4 §13.2: in OKLCH, lightness and hue kept, chroma searched down until the clipped colour is within the
// JND of 0.02 (deltaEOK — culori's default difference, Euclidean in OKLCH with the hue term, is OKLab's distance).
const mapToSrgb = toGamut('rgb', 'oklch');
const mapToP3 = toGamut('p3', 'oklch');
const deltaEOK = differenceEuclidean('oklab');

/** Half an 8-bit step: a channel this far outside 0–1 does not change the hex when clamped (§5.3). */
const TOLERANCE = 0.5 / 255;
const inside = (c: Rgb): boolean => [c.r, c.g, c.b].every(v => num(v) >= -TOLERANCE && num(v) <= 1 + TOLERANCE);
const clampRgb = <T extends Rgb>(c: T): T => ({
  ...c,
  r: clamp01(num(c.r)),
  g: clamp01(num(c.g)),
  b: clamp01(num(c.b)),
});

const asCulori = (color: Color): CuloriColor => color as unknown as CuloriColor;

/** The colour in an RGB space: in gamut (clamped within the tolerance) or mapped into it. */
const inGamutOf = (color: Color, space: 'rgb' | 'p3'): { raw: Rgb; mapped: Rgb; inside: boolean } => {
  const raw = (space === 'rgb' ? toRgb(asCulori(color)) : toP3(asCulori(color))) as unknown as Rgb;
  const ok = inside(raw);
  const mapped = ok
    ? clampRgb(raw)
    : clampRgb((space === 'rgb' ? mapToSrgb : mapToP3)(asCulori(color)) as unknown as Rgb);
  return { raw, mapped, inside: ok };
};

const hexOf = (c: Rgb, alpha: number): string => {
  const a = to8bit(alpha);
  return `#${byte(to8bit(c.r))}${byte(to8bit(c.g))}${byte(to8bit(c.b))}${a < 255 ? byte(a) : ''}`;
};

export interface Formats {
  inSrgb: boolean;
  inP3: boolean;
  /** §5.4, only when !inSrgb. */
  clippedHex: string | null;
  hex: string;
  rgb: string;
  hsl: string;
  hwb: string;
  lab: string;
  lch: string;
  oklab: string;
  oklch: string;
  p3: string;
  /** Full-precision oklch() for the swatch's "As written" half. */
  swatch: string;
}

/** Every notation of §5.2 for a colour `parseColor` read. */
export const convertColor = (color: Color): Formats => {
  const alpha = color.alpha ?? 1;
  const a = alphaText(alpha);
  const srgb = inGamutOf(color, 'rgb');
  const p3 = inGamutOf(color, 'p3');
  const s = srgb.mapped;
  // HSL and HWB from the sRGB channels at 6 decimals: white from lab(100 0 0) is not hsl(69.5 100% 100%) (§5.2).
  const six = { mode: 'rgb' as const, r: roundTo(s.r, 6), g: roundTo(s.g, 6), b: roundTo(s.b, 6) };
  const hsl = toHsl(six) as { h?: number; s: number; l: number };
  const hwb = toHwb(six) as { h?: number; w: number; b: number };
  const lab = toLab(asCulori(color)) as { l: number; a: number; b: number };
  const lch = toLch(asCulori(color)) as { l: number; c: number; h?: number };
  const oklab = toOklab(asCulori(color)) as { l: number; a: number; b: number };
  const oklch = toOklch(asCulori(color)) as { l: number; c: number; h?: number };

  const hslL = roundTo(num(hsl.l) * 100, 1);
  const hslEnds = hslL === 0 || hslL === 100;
  const hslS = hslEnds ? 0 : roundTo(num(hsl.s) * 100, 1);
  const hwbW = roundTo(num(hwb.w) * 100, 1);
  const hwbB = roundTo(num(hwb.b) * 100, 1);
  const lchC = roundTo(num(lch.c), 2);
  const oklchC = roundTo(num(oklch.c), 4);
  const chromaless = roundTo(num(oklch.c), 6) === 0;

  return {
    inSrgb: srgb.inside,
    inP3: p3.inside,
    clippedHex: srgb.inside ? null : hexOf(clampRgb(srgb.raw), alpha),
    hex: hexOf(s, alpha),
    rgb: `rgb(${to8bit(s.r)} ${to8bit(s.g)} ${to8bit(s.b)}${a})`,
    hsl: `hsl(${hueText(hsl.h, hslS === 0 || hslEnds, 1)} ${hslS}% ${hslL}%${a})`,
    hwb: `hwb(${hueText(hwb.h, hwbW + hwbB >= 100, 1)} ${hwbW}% ${hwbB}%${a})`,
    lab: `lab(${text(num(lab.l), 2)} ${text(num(lab.a), 2)} ${text(num(lab.b), 2)}${a})`,
    lch: `lch(${text(num(lch.l), 2)} ${lchC} ${hueText(lch.h, lchC === 0, 2)}${a})`,
    oklab: `oklab(${text(num(oklab.l) * 100, 2)}% ${text(num(oklab.a), 4)} ${text(num(oklab.b), 4)}${a})`,
    oklch: `oklch(${text(num(oklch.l) * 100, 2)}% ${oklchC} ${hueText(oklch.h, oklchC === 0, 2)}${a})`,
    p3: `color(display-p3 ${text(p3.mapped.r, 4)} ${text(p3.mapped.g, 4)} ${text(p3.mapped.b, 4)}${a})`,
    swatch: `oklch(${text(num(oklch.l), 6)} ${text(num(oklch.c), 6)} ${hueText(oklch.h, chromaless, 6)}${
      roundTo(alpha, 6) < 1 ? ` / ${text(alpha, 6)}` : ''
    })`,
  };
};

// ---- the name (§5.5) ----

export type ColorName = { exact: string[] } | { nearest: string; distance: number };

/** The 8-bit sRGB channels of a colour after §5.3, and its alpha. */
const bytesOf = (color: Color): { r: number; g: number; b: number; a: number } => {
  const s = inGamutOf(color, 'rgb').mapped;
  return { r: to8bit(s.r), g: to8bit(s.g), b: to8bit(s.b), a: color.alpha ?? 1 };
};

const NAMES = Object.keys(colorsNamed).sort();
let namedLab: Array<{ name: string; hex: number; lab: CuloriColor }> | undefined;
const named = () =>
  (namedLab ??= NAMES.map(name => {
    const hex = colorsNamed[name as keyof typeof colorsNamed];
    const lab = toOklab({ mode: 'rgb', r: (hex >> 16) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 });
    return { name, hex, lab };
  }));

/**
 * The CSS name of the colour (§5.5): every name of its 8-bit value when it is opaque (`gray`, `grey`); `transparent`
 * for #00000000; otherwise the nearest name by Euclidean distance in OKLab (the first by alphabet on a tie).
 */
export const colorName = (color: Color): ColorName => {
  const { r, g, b, a } = bytesOf(color);
  if (r === 0 && g === 0 && b === 0 && to8bit(a) === 0) return { exact: ['transparent'] };
  const value = (r << 16) | (g << 8) | b;
  if (a >= 1) {
    const exact = named()
      .filter(n => n.hex === value)
      .map(n => n.name);
    if (exact.length > 0) return { exact };
  }
  const lab = toOklab({ mode: 'rgb', r: r / 255, g: g / 255, b: b / 255 });
  let best = { name: '', distance: Infinity };
  for (const n of named()) {
    const d = deltaEOK(lab, n.lab);
    if (d < best.distance - 1e-12) best = { name: n.name, distance: d };
  }
  return { nearest: best.name, distance: roundTo(best.distance, 3) };
};

// ---- contrast (§5.6) ----

export interface Contrast {
  ratio: number;
  /** Floored to 2 decimals: "4.54:1". */
  shown: string;
  aaNormal: boolean;
  aaLarge: boolean;
  aaaNormal: boolean;
  aaaLarge: boolean;
  nonText: boolean;
  /** 8-bit colours after blending (§5.6). */
  foreground: string;
  background: string;
  foregroundBlended: boolean;
  backgroundBlended: boolean;
}

type Bytes = { r: number; g: number; b: number; a: number };
const WHITE: Bytes = { r: 255, g: 255, b: 255, a: 1 };
const over = (top: Bytes, bottom: Bytes): Bytes => {
  const mix = (t: number, u: number) => Math.min(255, Math.max(0, Math.round(t * top.a + u * (1 - top.a))));
  return { r: mix(top.r, bottom.r), g: mix(top.g, bottom.g), b: mix(top.b, bottom.b), a: 1 };
};
const linear = (c: number): number => {
  const v = c / 255;
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
};
/** WCAG 2.2 relative luminance of 8-bit sRGB. */
const luminance = ({ r, g, b }: Bytes): number => 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b);
const hex6 = ({ r, g, b }: Bytes): string => `#${byte(r)}${byte(g)}${byte(b)}`;

/**
 * WCAG 2.2 contrast of a text colour on a background (§5.6): both as 8-bit sRGB after §5.3; a translucent background
 * over white, a translucent text over that background; shown floored to two decimals, the checks on the exact ratio.
 */
export const contrast = (foreground: Color, background: Color): Contrast => {
  let bg = bytesOf(background);
  const backgroundBlended = to8bit(bg.a) < 255;
  if (backgroundBlended) bg = over(bg, WHITE);
  let fg = bytesOf(foreground);
  const foregroundBlended = to8bit(fg.a) < 255;
  if (foregroundBlended) fg = over(fg, bg);
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((x, y) => y - x) as [number, number];
  const ratio = (hi + 0.05) / (lo + 0.05);
  return {
    ratio,
    shown: `${(Math.floor(roundTo(ratio * 100, 6)) / 100).toFixed(2)}:1`,
    aaNormal: ratio >= 4.5,
    aaLarge: ratio >= 3,
    aaaNormal: ratio >= 7,
    aaaLarge: ratio >= 4.5,
    nonText: ratio >= 3,
    foreground: hex6(fg),
    background: hex6(bg),
    foregroundBlended,
    backgroundBlended,
  };
};

/** The colour's 8-bit hex without alpha, for `<input type="color">` (§5.8). */
export const pickerValue = (color: Color): string => hexOf(inGamutOf(color, 'rgb').mapped, 1);
