/**
 * Durations (docs/tools/specs/date-calc.md §5.4, §5.8): written as people write them (`1h30m`, `90 min`, `2 weeks`,
 * `-3d`, `1 hour and 30 minutes`) or as ISO 8601 (`P3DT4H`, `P1M`, `PT0.5S`). Eight integer fields of one sign, read as
 * bigint (a duration is refused for its size only after it is read); calendar fields stay apart from exact ones, and
 * nothing is balanced: `90 min` is ninety minutes. Also the writing of durations in words and in ISO 8601.
 */
import { MAX_INPUT } from './clock';

export interface Duration {
  sign: 1 | -1;
  years: bigint;
  months: bigint;
  weeks: bigint;
  days: bigint;
  hours: bigint;
  minutes: bigint;
  seconds: bigint;
  milliseconds: bigint;
}

export type DurationResult =
  | { ok: true; empty: true }
  | { ok: true; empty: false; duration: Duration; readAs: string; notes: string[] }
  | { ok: false; message: string };

type Field = Exclude<keyof Duration, 'sign'>;
const FIELDS: readonly Field[] = ['years', 'months', 'weeks', 'days', 'hours', 'minutes', 'seconds', 'milliseconds'];
const FIELD_MS: Partial<Record<Field, bigint>> = {
  hours: 3_600_000n,
  minutes: 60_000n,
  seconds: 1000n,
  milliseconds: 1n,
};

export const TOO_LONG_DURATION = 'Too long for a duration (more than 200 characters).';
export const NOT_A_DURATION = 'Not a duration this tool reads. Write 1h30m, 90 min, 2 weeks, -3d or P3DT4H.';
export const SIGN_AT_START = 'A sign goes only at the start: -1h30m.';
export const WHOLE_NUMBERS = 'Years, months, weeks and days take whole numbers: write 1 day 12 hours, not 1.5 days.';
export const FINER_THAN_MS = 'Finer than a millisecond: durations are counted in whole milliseconds.';
export const M_IS_MINUTES = 'm is read as minutes; months are mo.';
export const ISO_NEEDS_NUMBER = 'An ISO 8601 duration needs at least one number: P3D, PT1H30M.';
export const ISO_TIME_AFTER_T = 'In an ISO 8601 duration, hours, minutes and seconds come after T: PT1H.';
export const ISO_ORDER =
  'An ISO 8601 duration lists years, months, weeks, days, then T and hours, minutes, seconds, in this order.';
export const ISO_FRACTION_LAST = 'Only the last number of an ISO 8601 duration may have a fraction.';
export const TOO_LARGE = 'Too large: no moment plus this duration stays within -271821-04-20 to +275760-09-13 UTC.';

/** Beyond these no moment of the range plus the duration stays in the range (§5.4). */
const LIMITS: Partial<Record<Field, bigint>> = {
  years: 1_000_000n,
  months: 12_000_000n,
  weeks: 60_000_000n,
  days: 400_000_000n,
};
const MAX_TIME_MS = 20_000_000_000_000_000n;

const UNITS: Readonly<Record<string, Field>> = {
  y: 'years',
  yr: 'years',
  yrs: 'years',
  year: 'years',
  years: 'years',
  mo: 'months',
  mon: 'months',
  mons: 'months',
  month: 'months',
  months: 'months',
  w: 'weeks',
  wk: 'weeks',
  wks: 'weeks',
  week: 'weeks',
  weeks: 'weeks',
  d: 'days',
  day: 'days',
  days: 'days',
  h: 'hours',
  hr: 'hours',
  hrs: 'hours',
  hour: 'hours',
  hours: 'hours',
  m: 'minutes',
  min: 'minutes',
  mins: 'minutes',
  minute: 'minutes',
  minutes: 'minutes',
  s: 'seconds',
  sec: 'seconds',
  secs: 'seconds',
  second: 'seconds',
  seconds: 'seconds',
  ms: 'milliseconds',
  msec: 'milliseconds',
  msecs: 'milliseconds',
  millisecond: 'milliseconds',
  milliseconds: 'milliseconds',
};

const fail = (message: string): DurationResult => ({ ok: false, message });
const zero = (): Duration => ({
  sign: 1,
  years: 0n,
  months: 0n,
  weeks: 0n,
  days: 0n,
  hours: 0n,
  minutes: 0n,
  seconds: 0n,
  milliseconds: 0n,
});

/**
 * A number of a time field with a fraction, spread down the fields exactly ("1.5" hours → 1 hour 30 minutes); null when
 * the fraction is not a whole number of milliseconds.
 */
const addTime = (d: Duration, field: Field, whole: string, fraction: string): boolean => {
  d[field] += BigInt(whole);
  if (!fraction) return true;
  const unit = FIELD_MS[field]!;
  const scale = 10n ** BigInt(fraction.length);
  const scaled = BigInt(fraction) * unit;
  if (scaled % scale !== 0n) return false;
  let rest = scaled / scale;
  for (const lower of FIELDS.slice(FIELDS.indexOf(field) + 1)) {
    const size = FIELD_MS[lower]!;
    d[lower] += rest / size;
    rest %= size;
  }
  return true;
};

const timeMs = (d: Duration): bigint => d.hours * 3_600_000n + d.minutes * 60_000n + d.seconds * 1000n + d.milliseconds;

const sizeCheck = (d: Duration): string | null => {
  for (const [field, limit] of Object.entries(LIMITS) as Array<[Field, bigint]>) if (d[field] > limit) return TOO_LARGE;
  return timeMs(d) > MAX_TIME_MS ? TOO_LARGE : null;
};

/** ISO 8601: [sign] P [nY] [nM] [nW] [nD] [T [nH] [nM] [nS]], letters of any case, a fraction only on the last time field. */
const parseIso = (body: string, d: Duration): string | null => {
  let i = 1; // after P
  let inTime = false;
  let sawTime = false;
  let last = -1;
  let fractionSeen = false;
  let count = 0;
  while (i < body.length) {
    const c = body[i]!;
    if (c === 'T' || c === 't') {
      if (inTime) return ISO_ORDER;
      inTime = true;
      i++;
      continue;
    }
    const number = /^(\d+)(?:[.,](\d{1,9}))?/.exec(body.slice(i));
    if (!number) return NOT_A_DURATION;
    i += number[0].length;
    const letter = body[i]?.toUpperCase();
    i++;
    let index: number;
    if (!inTime) {
      index = { Y: 0, M: 1, W: 2, D: 3 }[letter as 'Y'] ?? -1;
      if (letter === 'H' || letter === 'S') return ISO_TIME_AFTER_T;
    } else {
      index = { H: 4, M: 5, S: 6 }[letter as 'H'] ?? -1;
      if (letter === 'Y' || letter === 'W' || letter === 'D') return ISO_ORDER;
    }
    if (index < 0) return NOT_A_DURATION;
    if (index <= last) return ISO_ORDER;
    if (fractionSeen) return ISO_FRACTION_LAST;
    const field = FIELDS[index]!;
    const fraction = number[2] ?? '';
    if (fraction && index < 4) return WHOLE_NUMBERS;
    if (fraction) fractionSeen = true;
    if (!addTime(d, field, number[1]!, fraction)) return FINER_THAN_MS;
    last = index;
    count++;
    if (inTime) sawTime = true;
  }
  if (count === 0 || (inTime && !sawTime)) return ISO_NEEDS_NUMBER;
  return null;
};

const PART = /^(\d+)(?:\.(\d+))?\s*([a-z]+)/;

/** As people write them: parts of a number and a unit, in any order, each unit once, one sign at the start. */
const parseHuman = (body: string, d: Duration, notes: string[]): string | null => {
  const seen = new Set<Field>();
  let usedM = false;
  let rest = body;
  let first = true;
  while (rest.length > 0) {
    if (!first) {
      const sep = /^(?:\s*,\s*|\s+and\s+|\s+)/.exec(rest);
      if (sep) rest = rest.slice(sep[0].length);
      else if (!/^\d/.test(rest)) return /^[+-]/.test(rest) ? SIGN_AT_START : NOT_A_DURATION;
      if (/^[+-]/.test(rest)) return SIGN_AT_START;
    }
    const part = PART.exec(rest);
    if (!part) return NOT_A_DURATION;
    const field = UNITS[part[3]!];
    if (!field) return NOT_A_DURATION;
    if (seen.has(field)) return `Each unit can appear once: ${field} appear twice.`;
    seen.add(field);
    if (part[3] === 'm') usedM = true;
    const fraction = part[2] ?? '';
    if (fraction && !FIELD_MS[field]) return WHOLE_NUMBERS;
    if (!addTime(d, field, part[1]!, fraction)) return FINER_THAN_MS;
    rest = rest.slice(part[0].length);
    first = false;
  }
  if (usedM && !seen.has('hours') && !seen.has('seconds') && !seen.has('milliseconds')) notes.push(M_IS_MINUTES);
  return null;
};

/** §5.4. */
export const parseDuration = (text: string): DurationResult => {
  const t = text.trim();
  if (t === '') return { ok: true, empty: true };
  if (t.length > MAX_INPUT) return fail(TOO_LONG_DURATION);
  const signed = /^([+-])\s*/.exec(t);
  const body = signed ? t.slice(signed[0].length) : t;
  const d = zero();
  d.sign = signed?.[1] === '-' ? -1 : 1;
  const notes: string[] = [];
  const error = /^p/i.test(body) ? parseIso(body, d) : parseHuman(body.toLowerCase(), d, notes);
  if (error) return fail(error);
  const tooLarge = sizeCheck(d);
  if (tooLarge) return fail(tooLarge);
  const iso = isoDuration(d);
  const words = durationWords(d);
  return {
    ok: true,
    empty: false,
    duration: d,
    readAs: `Read as ${iso} (${d.sign < 0 && !isZero(d) ? `minus ${words}` : words}).`,
    notes,
  };
};

export const isZero = (d: Duration): boolean => FIELDS.every(f => d[f] === 0n);

// ---- writing (§5.8) ----

const plural = (n: bigint | string, unit: string): string => `${n} ${unit}${n === 1n || n === '1' ? '' : 's'}`;

/** "7.008", "0.5", "12" — seconds and milliseconds as one decimal, no trailing zeros. */
const secondsText = (totalMs: bigint): string => {
  const s = totalMs / 1000n;
  const ms = totalMs % 1000n;
  return ms === 0n ? String(s) : `${s}.${String(ms).padStart(3, '0').replace(/0+$/, '')}`;
};

interface Parts {
  years?: bigint;
  months?: bigint;
  weeks?: bigint;
  days?: bigint;
  hours?: bigint;
  minutes?: bigint;
  /** Seconds and milliseconds, as milliseconds. */
  secondsMs?: bigint;
}

/** Magnitudes in words: "1 month, 2 days, 7.008 seconds"; "0 seconds" when all are zero. */
const words = (p: Parts): string => {
  const out: string[] = [];
  const add = (n: bigint | undefined, unit: string) => {
    if (n) out.push(plural(n, unit));
  };
  add(p.years, 'year');
  add(p.months, 'month');
  add(p.weeks, 'week');
  add(p.days, 'day');
  add(p.hours, 'hour');
  add(p.minutes, 'minute');
  if (p.secondsMs) out.push(plural(secondsText(p.secondsMs), 'second'));
  return out.length ? out.join(', ') : '0 seconds';
};

/** Magnitudes as ISO 8601: "P1Y2M3W4DT5H6M7.008S", "PT0S". */
const iso = (p: Parts): string => {
  const date = `${p.years ? `${p.years}Y` : ''}${p.months ? `${p.months}M` : ''}${p.weeks ? `${p.weeks}W` : ''}${
    p.days ? `${p.days}D` : ''
  }`;
  const time = `${p.hours ? `${p.hours}H` : ''}${p.minutes ? `${p.minutes}M` : ''}${
    p.secondsMs ? `${secondsText(p.secondsMs)}S` : ''
  }`;
  return date || time ? `P${date}${time ? `T${time}` : ''}` : 'PT0S';
};

const partsOf = (d: Duration): Parts => ({
  years: d.years,
  months: d.months,
  weeks: d.weeks,
  days: d.days,
  hours: d.hours,
  minutes: d.minutes,
  secondsMs: d.seconds * 1000n + d.milliseconds,
});

/** The duration as typed, in words (no sign: `Read as` says "minus"). */
export const durationWords = (d: Duration): string => words(partsOf(d));

/** The duration as typed, as ISO 8601 with its sign: "-P3D". */
export const isoDuration = (d: Duration): string => `${d.sign < 0 && !isZero(d) ? '-' : ''}${iso(partsOf(d))}`;

const abs = (n: bigint): bigint => (n < 0n ? -n : n);

/** Exact time split into days of 24 hours, hours, minutes, seconds (magnitudes). */
const exactParts = (ms: bigint, withDays: boolean): Parts => {
  let rest = abs(ms);
  const days = withDays ? rest / 86_400_000n : 0n;
  rest -= days * 86_400_000n;
  const hours = rest / 3_600_000n;
  rest -= hours * 3_600_000n;
  const minutes = rest / 60_000n;
  return { days, hours, minutes, secondsMs: rest - minutes * 60_000n };
};

/** A sign before words: "-1 month", "-(30 days, 23 hours)". */
const signed = (negative: boolean, text: string): string =>
  !negative ? text : text.includes(',') ? `-(${text})` : `-${text}`;

export interface CalendarParts {
  years: number;
  months: number;
  days: number;
  /** The exact remainder, with the same sign. */
  timeMs: bigint;
}

const negativeCalendar = (p: CalendarParts): boolean => p.years < 0 || p.months < 0 || p.days < 0 || p.timeMs < 0n;

const calendarParts = (p: CalendarParts): Parts => ({
  ...exactParts(p.timeMs, false),
  years: BigInt(Math.abs(p.years)),
  months: BigInt(Math.abs(p.months)),
  days: BigInt(Math.abs(p.days)),
});

/** "1 month, 1 day", "-1 month", "0 seconds". */
export const formatCalendar = (p: CalendarParts): string => signed(negativeCalendar(p), words(calendarParts(p)));
/** "P1M1D", "-P1M", "PT0S". */
export const isoCalendar = (p: CalendarParts): string => `${negativeCalendar(p) ? '-' : ''}${iso(calendarParts(p))}`;
/** Exact time in days of 24 hours, hours, minutes, seconds: "30 days, 23 hours", "-(30 days, 23 hours)". */
export const formatExact = (ms: bigint): string => signed(ms < 0n, words(exactParts(ms, true)));
/** Exact time with hours as the largest unit (ISO days are nominal): "PT743H", "-PT1H". */
export const isoExact = (ms: bigint): string => `${ms < 0n ? '-' : ''}${iso(exactParts(ms, false))}`;

export type TotalUnit = 'days' | 'hours' | 'minutes' | 'seconds' | 'milliseconds';
const TOTAL_DIVISORS: Readonly<Record<TotalUnit, bigint>> = {
  days: 86_400_000n,
  hours: 3_600_000n,
  minutes: 60_000n,
  seconds: 1000n,
  milliseconds: 1n,
};
const DECIMALS = 6;

/**
 * The exact time in one unit (§5.8), in bigint: whole when it divides; otherwise a decimal — exact when it ends within
 * six places, else rounded to six (half away from zero) and marked "≈". `value` is the text without "≈" (what Copy copies).
 */
export const total = (ms: bigint, unit: TotalUnit): { text: string; value: string; exact: boolean } => {
  const divisor = TOTAL_DIVISORS[unit];
  const sign = ms < 0n ? '-' : '';
  const a = abs(ms);
  if (a % divisor === 0n) {
    const value = `${sign}${a / divisor}`;
    return { text: value, value, exact: true };
  }
  const scale = 10n ** BigInt(DECIMALS);
  const scaled = a * scale;
  let q = scaled / divisor;
  const r = scaled % divisor;
  const exact = r === 0n;
  if (!exact && 2n * r >= divisor) q += 1n;
  const whole = q / scale;
  const frac = String(q % scale)
    .padStart(DECIMALS, '0')
    .replace(/0+$/, '');
  const value = `${sign}${whole}${frac ? `.${frac}` : ''}`;
  return { text: exact ? value : `≈${value}`, value, exact };
};
