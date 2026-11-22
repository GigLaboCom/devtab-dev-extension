/**
 * The QR Code tool's pure helpers (docs/tools/specs/qr.md §5, §9): the mode the library picks for a text and the
 * count it reports, the capacities of ISO/IEC 18004 table 7, the message for a text that does not fit, the SVG path and
 * file of a module matrix, the information line, and what a text's content means for the history. No library here:
 * the component imports these with its own chunk, and the encoder (`make.ts`) and the reader (`read.ts`) load only when
 * they are first needed.
 */
import { bytesToHex } from '@workspace/tools-shared/hex';

export type Level = 'L' | 'M' | 'Q' | 'H';
export type Mode = 'numeric' | 'alphanumeric' | 'byte';

export const LEVELS: readonly Level[] = ['L', 'M', 'Q', 'H'];
export const DEFAULT_LEVEL: Level = 'M';
/** The share of a damaged code each level recovers (§4). */
export const LEVEL_LABELS: Readonly<Record<Level, string>> = {
  L: 'L — 7%',
  M: 'M — 15%',
  Q: 'Q — 25%',
  H: 'H — 30%',
};

/** Version 40, ISO/IEC 18004 table 7 (§5.2): characters in numeric and alphanumeric mode, bytes in byte mode. */
export const CAPACITY: Readonly<Record<Mode, Readonly<Record<Level, number>>>> = {
  numeric: { L: 7089, M: 5596, Q: 3993, H: 3057 },
  alphanumeric: { L: 4296, M: 3391, Q: 2420, H: 1852 },
  byte: { L: 2953, M: 2331, Q: 1663, H: 1273 },
};

/** Quiet zone in modules (§4); ISO/IEC 18004 asks for 4. */
export const QUIET_ZONES = [0, 1, 2, 3, 4, 6, 8] as const;
export type QuietZone = (typeof QUIET_ZONES)[number];
export const DEFAULT_QUIET: QuietZone = 4;
export const STANDARD_QUIET = 4;
/** Pixels per module of the PNG, the copied image and the SVG file's size (§4). */
export const MODULE_PX = [4, 8, 16, 32] as const;
export type ModulePx = (typeof MODULE_PX)[number];
export const DEFAULT_MODULE_PX: ModulePx = 8;
export const MAX_PNG_SIDE = 8192;

/** The code's colours: black on white in every theme — the code is content a camera reads (§5.4). */
export const DARK = '#000000';
export const LIGHT = '#ffffff';

export type BuildResult =
  | {
      ok: true;
      /** Without quiet zone; true = dark. */
      modules: boolean[][];
      size: number;
      version: number;
      mode: Mode;
      /** Bytes in byte mode, characters otherwise. */
      units: number;
    }
  | { ok: false; message: string }
  | { ok: false; empty: true };
export type BuiltQr = Extract<BuildResult, { ok: true }>;

/** Bytes as spaced lowercase hex (`00 ff 41`) — how the tool shows a code's bytes that are not text. */
export const hexBytes = (bytes: Uint8Array): string => bytesToHex(bytes, { format: 'spaced' });

const ALPHANUMERIC = /^[0-9A-Z $%*+\-./:]*$/;
const NUMERIC = /^[0-9]*$/;

/** The mode the library chooses for the whole text (its `detectType`; no mixed segments). */
export const modeOf = (text: string): Mode =>
  NUMERIC.test(text) ? 'numeric' : ALPHANUMERIC.test(text) ? 'alphanumeric' : 'byte';

/** UTF-8 bytes of a text, as TextEncoder writes them (a lone surrogate becomes U+FFFD, three bytes). */
export const utf8Length = (text: string): number => {
  let n = 0;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && i + 1 < text.length) {
      const d = text.charCodeAt(i + 1);
      if (d >= 0xdc00 && d <= 0xdfff) {
        n += 4;
        i++;
      } else n += 3;
    } else n += 3;
  }
  return n;
};

/** What the information line counts: UTF-8 bytes in byte mode, characters (all ASCII) in the others. */
export const unitsOf = (text: string, mode: Mode = modeOf(text)): number =>
  mode === 'byte' ? utf8Length(text) : text.length;

const count = (n: number): string => n.toLocaleString('en-US');
const unitWord = (mode: Mode, n: number): string =>
  mode === 'byte' ? (n === 1 ? 'byte' : 'bytes') : n === 1 ? 'character' : 'characters';

/** §5.2: `Too long for a QR code: 2,332 bytes; level M holds up to 2,331 bytes in byte mode.` */
export const tooLongMessage = (units: number, mode: Mode, level: Level): string => {
  const limit = CAPACITY[mode][level];
  return `Too long for a QR code: ${count(units)} ${unitWord(mode, units)}; level ${level} holds up to ${count(limit)} ${unitWord(mode, limit)} in ${mode} mode.`;
};

/** Does the text fit version 40 at this level? The check `buildQr` makes before it asks the library. */
export const capacityCheck = (
  text: string,
  level: Level,
): { mode: Mode; units: number; fits: boolean; message?: string } => {
  const mode = modeOf(text);
  const units = unitsOf(text, mode);
  const fits = units <= CAPACITY[mode][level];
  return fits ? { mode, units, fits } : { mode, units, fits, message: tooLongMessage(units, mode, level) };
};

/**
 * §5.4: for every row and every run of dark modules of length n starting at column x of row y,
 * `M{x+quiet} {y+quiet}h{n}v1h-{n}z` — rows top to bottom, runs left to right, nothing between the commands.
 */
export const svgPath = (modules: readonly (readonly boolean[])[], quiet: number): string => {
  const parts: string[] = [];
  for (let y = 0; y < modules.length; y++) {
    const row = modules[y]!;
    for (let x = 0; x < row.length;) {
      if (!row[x]) {
        x++;
        continue;
      }
      let n = 1;
      while (x + n < row.length && row[x + n]) n++;
      parts.push(`M${x + quiet} ${y + quiet}h${n}v1h-${n}z`);
      x += n;
    }
  }
  return parts.join('');
};

/** The side of the symbol with its quiet zone, in modules. */
export const sideOf = (size: number, quiet: number): number => size + 2 * quiet;

/** §5.5, the downloaded file: the page's markup with a size in pixels, UTF-8, no XML prolog, one line break. */
export const svgFile = (modules: readonly (readonly boolean[])[], quiet: number, modulePx: number): string => {
  const n = sideOf(modules.length, quiet);
  const px = n * modulePx;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${px}" height="${px}" viewBox="0 0 ${n} ${n}" shape-rendering="crispEdges">` +
    `<rect width="${n}" height="${n}" fill="${LIGHT}"/><path d="${svgPath(modules, quiet)}" fill="${DARK}"/></svg>\n`
  );
};

/** §5.4: `Version 2 · 25 × 25 modules · level M · 20 bytes (byte mode)`. */
export const infoLine = (result: BuiltQr, level: Level): string =>
  `Version ${result.version} · ${result.size} × ${result.size} modules · level ${level} · ${count(result.units)} ${unitWord(result.mode, result.units)} (${result.mode} mode)`;

/**
 * §5.5: pixels per module for the PNG — the chosen size, or the largest of MODULE_PX whose side stays within
 * MAX_PNG_SIDE (never reached in practice: version 40 with a quiet zone of 8 at 32 px is 6,176 px).
 */
export const pngModulePx = (size: number, quiet: number, wanted: ModulePx): { px: number; reduced: boolean } => {
  const n = sideOf(size, quiet);
  if (n * wanted <= MAX_PNG_SIDE) return { px: wanted, reduced: false };
  const fit = [...MODULE_PX].reverse().find(p => n * p <= MAX_PNG_SIDE) ?? Math.max(1, Math.floor(MAX_PNG_SIDE / n));
  return { px: fit, reduced: true };
};

/** §3: a space or a line break at the end is encoded too — the tool says so. */
export const endsWithSpace = (text: string): boolean => /\s$/u.test(text);

/** §5.6 step 9: a link is shown as text and never opened. */
export const isLink = (text: string): boolean => /^https?:\/\//i.test(text);

/**
 * What a code's text holds that the history keeps only encrypted (docs/tools/history.md §10, row `qr`: the tool's logic
 * picks the kind by content): Wi-Fi details (`WIFI:` — the network's name and password) and, read cautiously, the key of
 * a one-time password (`otpauth://`, `otpauth-migration://` — the secret of a second factor). Anything else: null.
 */
export const secretContent = (text: string): 'wifi' | 'one-time-key' | null =>
  /^WIFI:/i.test(text) ? 'wifi' : /^otpauth(?:-migration)?:/i.test(text) ? 'one-time-key' : null;

/** `Found a QR code: 28 characters.` — counted in code points, as a person counts them. */
export const foundLine = (text: string): string => {
  const n = [...text].length;
  return `Found a QR code: ${count(n)} ${n === 1 ? 'character' : 'characters'}.`;
};
