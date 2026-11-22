/**
 * Units of data size and rate (docs/tools/specs/data-units.md §5 items 6–9 and 12): what a written unit means, its
 * factor in bits, and the ladders of every unit at once.
 */
import { div, power, ratio, showNumber } from './ratio';
import type { Digits, Ratio, Shown } from './ratio';

export type Base = 'bit' | 'byte';
/** How a prefix without `i` (K, M, G … but lower-case k) is read: the person's choice (§5 item 8). */
export type Reading = 'decimal' | 'binary';
export type UnitSystem = 'none' | 'decimal' | 'binary' | 'ambiguous';

/** Ten steps in both systems: k … Q and Ki … Qi (§5 item 7). */
export const STEPS = 10;
const DECIMAL_SYMBOLS = ['', 'k', 'M', 'G', 'T', 'P', 'E', 'Z', 'Y', 'R', 'Q'] as const;
const BINARY_SYMBOLS = ['', 'Ki', 'Mi', 'Gi', 'Ti', 'Pi', 'Ei', 'Zi', 'Yi', 'Ri', 'Qi'] as const;
const DECIMAL_NAMES = ['', 'kilo', 'mega', 'giga', 'tera', 'peta', 'exa', 'zetta', 'yotta', 'ronna', 'quetta'];
const BINARY_NAMES = ['', 'kibi', 'mebi', 'gibi', 'tebi', 'pebi', 'exbi', 'zebi', 'yobi', 'robi', 'quebi'];
const LETTERS = 'kmgtpezyrq';

export interface Unit {
  base: Base;
  /** 0 — no prefix; 1 — kilo or kibi; … 10 — quetta or quebi. */
  step: number;
  system: UnitSystem;
  rate: boolean;
  /** As written in the input: `MB`, `Mbps`, `megabytes`. */
  written: string;
  /** The base is a word (`bytes`, `bit`), not one letter. */
  word: boolean;
  /** The prefix as written (`M`, `Mi`, `mega`), '' without one. */
  prefix: string;
}

export type UnitProblem =
  | { problem: 'unknown' }
  | { problem: 'prefix-only'; step: number; binary: boolean }
  | { problem: 'per-other'; stem: string };

interface PrefixMeaning {
  step: number;
  system: UnitSystem;
}

/** A prefix symbol (`k`, `M`, `Gi`, `KIB`'s `KI`) or name (`mega`, `kibi`), or null. */
const readPrefix = (text: string): PrefixMeaning | null => {
  if (text === '') return { step: 0, system: 'none' };
  const lower = text.toLowerCase();
  const named = DECIMAL_NAMES.indexOf(lower);
  if (named > 0) return { step: named, system: named >= 9 ? 'decimal' : 'ambiguous' };
  const binaryNamed = BINARY_NAMES.indexOf(lower);
  if (binaryNamed > 0) return { step: binaryNamed, system: 'binary' };
  const letter = lower[0];
  const step = LETTERS.indexOf(letter) + 1;
  if (step === 0) return null;
  if (text.length === 2 && lower[1] === 'i') return { step, system: 'binary' };
  if (text.length !== 1) return null;
  // Lower-case k is the SI symbol (JEDEC writes K); R and Q have no binary reading without i (§5 item 8).
  return { step, system: text === 'k' || letter === 'r' || letter === 'q' ? 'decimal' : 'ambiguous' };
};

const WORD_BASES: readonly [string, Base][] = [
  ['bytes', 'byte'],
  ['byte', 'byte'],
  ['bits', 'bit'],
  ['bit', 'bit'],
];

/** What a written unit means (§5 item 6), or why it is not a unit. */
export const readUnit = (written: string): Unit | UnitProblem => {
  let stem = written;
  let rate: '' | 'per' | 'ps' = '';
  if (stem.endsWith('/sec')) [stem, rate] = [stem.slice(0, -4), 'per'];
  else if (stem.endsWith('/s')) [stem, rate] = [stem.slice(0, -2), 'per'];
  else if (/^[^/]*[bB]ps$/.test(stem)) [stem, rate] = [stem.slice(0, -2), 'ps'];
  if (stem.includes('/')) {
    const before = stem.slice(0, stem.indexOf('/'));
    const unit = before === '' ? null : readUnit(before);
    return unit && 'base' in unit && !unit.rate ? { problem: 'per-other', stem: before } : { problem: 'unknown' };
  }
  const lower = stem.toLowerCase();
  for (const [ending, base] of WORD_BASES) {
    if (!lower.endsWith(ending) || rate === 'ps') continue;
    const prefix = stem.slice(0, stem.length - ending.length);
    const meaning = readPrefix(prefix);
    if (meaning) return { base, ...meaning, rate: rate !== '', written, word: true, prefix };
  }
  const last = stem[stem.length - 1];
  if (last === 'b' || last === 'B') {
    const prefix = stem.slice(0, -1);
    const meaning = readPrefix(prefix);
    if (meaning && (prefix === '' || prefix.length <= 2))
      return { base: last === 'B' ? 'byte' : 'bit', ...meaning, rate: rate !== '', written, word: false, prefix };
  }
  if (rate === '' && stem.length <= 2) {
    const meaning = readPrefix(stem);
    if (meaning && meaning.step > 0)
      return { problem: 'prefix-only', step: meaning.step, binary: meaning.system === 'binary' };
  }
  return { problem: 'unknown' };
};

export const isUnit = (u: Unit | UnitProblem): u is Unit => 'base' in u;

/** Base units per unit: 1000^n, 1024^n or 1. */
export const multiplierOf = (unit: Unit, reading: Reading): bigint => {
  const system = unit.system === 'ambiguous' ? reading : unit.system;
  return system === 'binary' ? power(1024n, unit.step) : system === 'decimal' ? power(1000n, unit.step) : 1n;
};

/** Bits per unit (or bits per second per unit). */
export const factorOf = (unit: Unit, reading: Reading): bigint =>
  multiplierOf(unit, reading) * (unit.base === 'byte' ? 8n : 1n);

/** The symbol for bytes with this prefix, for a note (`mb` → `MB`, `kb` → `kB`, `kib` → `KiB`). */
export const byteSymbol = (unit: Unit): string => {
  if (unit.step === 0) return 'B';
  const p = unit.system === 'binary' ? BINARY_SYMBOLS[unit.step] : DECIMAL_SYMBOLS[unit.step];
  return `${p}B`;
};

/** The prefix's name with "bits" (`megabits`, `kibibits`). */
export const bitsName = (unit: Unit): string =>
  `${unit.system === 'binary' ? BINARY_NAMES[unit.step] : DECIMAL_NAMES[unit.step]}bits`;

/** The three ways to write a suffix alone as a unit, for the error (§6): '512 MB, 512 MiB or 512 Mbit'. */
export const prefixSuggestions = (number: string, step: number, binary: boolean): string => {
  const d = DECIMAL_SYMBOLS[step];
  const b = BINARY_SYMBOLS[step];
  return binary
    ? `${number} ${b}B, ${number} ${d}B or ${number} ${b}bit`
    : `${number} ${d}B, ${number} ${b}B or ${number} ${d}bit`;
};

export interface LadderRow {
  id: string;
  label: string;
  /** The everyday abbreviation beside a decimal bit rate (`Mbps`). */
  alias?: string;
  value: Shown;
}

export interface LadderColumn {
  title: string;
  rows: LadderRow[];
}

export interface LadderSection {
  id: 'bytes' | 'bits';
  title: string;
  base: LadderRow;
  decimal: LadderColumn;
  binary: LadderColumn;
}

const section = (bits: Ratio, rate: boolean, base: Base, digits: Digits): LadderSection => {
  const perBase = base === 'byte' ? 8n : 1n;
  const per = rate ? '/s' : '';
  const name = base === 'byte' ? 'B' : 'bit';
  const row = (prefix: string, multiplier: bigint, alias?: string): LadderRow => {
    const label = `${prefix}${name}${per}`;
    const value = showNumber(div(bits, ratio(perBase * multiplier)), digits);
    return { id: label, label, ...(alias ? { alias } : {}), value };
  };
  const decimal: LadderRow[] = [];
  const binary: LadderRow[] = [];
  for (let step = 1; step <= STEPS; step++) {
    const alias = rate && base === 'bit' ? `${DECIMAL_SYMBOLS[step]}bps` : undefined;
    decimal.push(row(DECIMAL_SYMBOLS[step], power(1000n, step), alias));
    binary.push(row(BINARY_SYMBOLS[step], power(1024n, step)));
  }
  const baseRow = row('', 1n);
  const baseLabel = rate ? baseRow.label : base === 'byte' ? 'bytes' : 'bits';
  return {
    id: base === 'byte' ? 'bytes' : 'bits',
    title: `${base === 'byte' ? 'Bytes' : 'Bits'}${rate ? ' per second' : ''}`,
    base: { ...baseRow, id: baseLabel, label: baseLabel },
    decimal: {
      title: base === 'byte' ? 'Decimal (SI) · 1 kB = 1,000 B' : 'Decimal (SI) · 1 kbit = 1,000 bits',
      rows: decimal,
    },
    binary: {
      title:
        base === 'byte'
          ? 'Binary (IEC) · 1 KiB = 1,024 B · Windows writes these as KB, MB, GB'
          : 'Binary (IEC) · 1 Kibit = 1,024 bits',
      rows: binary,
    },
  };
};

/**
 * Every unit at once (§5 item 12): the section of the input's base first, then the other; in each, the base unit and
 * the decimal and binary columns of ten steps.
 */
export const ladder = (bits: Ratio, rate: boolean, first: Base, digits: Digits): LadderSection[] => {
  const bytes = section(bits, rate, 'byte', digits);
  const bitSection = section(bits, rate, 'bit', digits);
  return first === 'byte' ? [bytes, bitSection] : [bitSection, bytes];
};
