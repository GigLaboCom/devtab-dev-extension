/**
 * Reading the one field of the Unix Time tool (docs/tools/specs/unix-time.md §5.1–§5.5, §6): a number in seconds,
 * milliseconds, microseconds or nanoseconds, or a date as ISO 8601 / RFC 3339 (with RFC 9557 brackets), RFC 5322 /
 * RFC 2822, the obsolete HTTP forms (RFC 850, asctime) or JavaScript's `Date.prototype.toString()`. Each form has its
 * own bounded regular expression and integer arithmetic: no `Date.parse`, no `Number()` of the digits (the instant is
 * a bigint of nanoseconds). A wall time without an offset goes through the shared `wallTimeToEpochMs` in the chosen
 * zone (or the zone in brackets), which answers gaps and overlaps.
 */
import {
  MAX_EPOCH_NS,
  daysFromCivil,
  formatIsoInZone,
  formatOffset,
  formatYear,
  resolveTimeZone,
  wallClockAsUtcMs,
  wallTimeToEpochMs,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';

export type Unit = 's' | 'ms' | 'us' | 'ns';
export type UnitOption = 'auto' | Unit;

/** Longer input (after trimming) is refused: no form this tool reads is that long (§12). */
export const MAX_INPUT = 200;

export interface ParseContext {
  /** Where a wall time without an offset is read. */
  timeZone: string;
  unit: UnitOption;
}

export type ParsedInput =
  | { ok: true; empty: true }
  | {
      ok: true;
      empty: false;
      epochNs: bigint;
      source: 'number' | 'date';
      /** The unit the number was read in (source 'number' only). */
      unit?: Unit;
      /** In display order (§5.2, §5.3, §5.5). */
      notes: string[];
    }
  | { ok: false; message: string };

export const UNIT_NS: Readonly<Record<Unit, bigint>> = { s: 1_000_000_000n, ms: 1_000_000n, us: 1000n, ns: 1n };
export const UNIT_NAMES: Readonly<Record<Unit, string>> = {
  s: 'seconds',
  ms: 'milliseconds',
  us: 'microseconds',
  ns: 'nanoseconds',
};
/** Digits of a fraction that still count, per unit: down to one nanosecond. */
const UNIT_FRACTION: Readonly<Record<Unit, number>> = { s: 9, ms: 6, us: 3, ns: 0 };

export const TOO_LONG = 'Too long for a timestamp or a date (more than 200 characters).';
export const OUT_OF_RANGE = 'Out of range: dates from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.';
export const EXPONENT = 'Exponent notation is not read: write all the digits.';
export const DECIMAL_COMMA = 'Use a dot for the decimal fraction.';
export const FINER_DROPPED = 'Digits finer than 1 nanosecond were dropped.';
export const LEAP_SECOND =
  'Second 60 (a leap second) has no Unix time of its own: read as the next second, as POSIX does.';
export const NOT_READ =
  'Not a timestamp or a date this tool reads. Try 1700000000, 2023-11-14T22:13:20Z or Tue, 14 Nov 2023 22:13:20 GMT.';
export const NOT_READ_SLASHED = 'Dates with / or . are not read. Write the date as YYYY-MM-DD.';
const HOURS = 'Hours go from 00 to 23.';
const MINUTES = 'Minutes go from 00 to 59.';
const SECONDS = 'Seconds go from 00 to 59.';

/** §5.2: 1–11 digits → 's', 12–14 → 'ms', 15–17 → 'us', 18–20 → 'ns', more → null. */
export const unitByDigits = (digits: number): Unit | null =>
  digits < 1 ? null : digits <= 11 ? 's' : digits <= 14 ? 'ms' : digits <= 17 ? 'us' : digits <= 20 ? 'ns' : null;

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const monthOf = (name: string): number => MONTHS.findIndex(m => m.slice(0, 3).toLowerCase() === name.toLowerCase()) + 1;
const weekdayOf = (name: string, full: boolean): number =>
  DAYS.findIndex(d => (full ? d : d.slice(0, 3)).toLowerCase() === name.toLowerCase());

const two = (n: number): string => String(n).padStart(2, '0');
const isLeap = (y: number): boolean => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
const monthLength = (y: number, m: number): number =>
  m === 2 ? (isLeap(y) ? 29 : 28) : [4, 6, 9, 11].includes(m) ? 30 : 31;
/** 0 = Sunday (1970-01-01 was a Thursday). */
const weekday = (y: number, m: number, d: number): number => (((daysFromCivil(y, m, d) + 4) % 7) + 7) % 7;
const fail = (message: string): ParsedInput => ({ ok: false, message });
const inRange = (ns: bigint): boolean => ns <= MAX_EPOCH_NS && ns >= -MAX_EPOCH_NS;
const floorMs = (ns: bigint): number => {
  const r = ((ns % 1_000_000n) + 1_000_000n) % 1_000_000n;
  return Number((ns - r) / 1_000_000n);
};
const civilDate = (y: number, m: number, d: number): string => `${formatYear(y)}-${two(m)}-${two(d)}`;

/** "1 hour", "30 minutes", "44 minutes 30 seconds", "24 hours" (§5.5). */
export const formatDuration = (ms: number): string => {
  const total = Math.round(Math.abs(ms) / 1000);
  const parts: Array<[number, string]> = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor(total / 60) % 60, 'minute'],
    [total % 60, 'second'],
  ];
  return parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`)
    .join(' ');
};

// ---- numbers (§5.2) ----

const NUMBER = /^([+-]?)(\d+)(?:\.(\d+))?$/;

const readNumber = (t: string, match: RegExpExecArray, option: UnitOption): ParsedInput => {
  const [, sign, whole = '', fraction = ''] = match;
  const integer = whole.replace(/^0+(?=\d)/, '');
  const digits = integer.length;
  const unit = option === 'auto' ? unitByDigits(digits) : option;
  if (!unit) return fail(`Too many digits for a timestamp: ${digits}. Nanoseconds have at most 20.`);
  const keep = UNIT_FRACTION[unit];
  let ns = BigInt(integer) * UNIT_NS[unit] + (keep > 0 ? BigInt(fraction.slice(0, keep).padEnd(keep, '0')) : 0n);
  if (sign === '-') ns = -ns;
  if (!inRange(ns)) return fail(OUT_OF_RANGE);
  const notes: string[] = [];
  if (option === 'auto') notes.push(`Read as ${UNIT_NAMES[unit]} (${digits} ${digits === 1 ? 'digit' : 'digits'}).`);
  if (/[1-9]/.test(fraction.slice(keep))) notes.push(FINER_DROPPED);
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(t);
  if (date) {
    const [y, m, d] = [Number(date[1]), Number(date[2]), Number(date[3])];
    if (y >= 1900 && y <= 2099 && m >= 1 && m <= 12 && d >= 1 && d <= monthLength(y, m))
      notes.push(`If this is a date (${date[1]}-${date[2]}-${date[3]}), write it with dashes.`);
  }
  return { ok: true, empty: false, epochNs: ns, source: 'number', unit, notes };
};

// ---- what is recognisably wrong (§6) ----

const EXPONENT_FORM = /^[+-]?\d+(?:\.\d+)?[eE][+-]?\d+$/;
const SEPARATOR = /[,\s_'’]/g;
const GROUPED = /^[+-]?\d{1,3}(?:[,\s_'’]\d{3})+(?:\.\d+)?$/;
const COMMA_FRACTION = /^[+-]?\d+,\d+$/;
const YEAR_FIRST = /^(\d{4})[/.](\d{1,2})[/.](\d{1,2})$/;
const YEAR_LAST = /^(\d{1,2})([/.])(\d{1,2})\2(\d{4}|\d{2})$/;
const BASIC_ISO = /^(\d{4})(\d{2})(\d{2})[Tt]\d{2}(?:\d{2}(?:\d{2}(?:[.,]\d{1,20})?)?)?(?:[Zz]|[+-]\d{2}(?:\d{2})?)?$/;

const slashed = (t: string, match: RegExpExecArray): string => {
  const [, first = '', , second = '', yearText = ''] = match;
  const a = Number(first);
  const b = Number(second);
  const Y = yearText.length === 4 ? yearText : 'YYYY';
  // A two-digit year could be any century: 2000 lets 29 February through.
  const year = yearText.length === 4 ? Number(yearText) : 2000;
  const valid = (m: number, d: number): boolean => m >= 1 && m <= 12 && d >= 1 && d <= monthLength(year, m);
  const monthFirst = valid(a, b);
  const dayFirst = valid(b, a);
  if (monthFirst && dayFirst && a !== b)
    return `${t} is ambiguous: ${MONTHS[a - 1]} ${b} or ${MONTHS[b - 1]} ${a}. Write ${Y}-${two(a)}-${two(b)} or ${Y}-${two(b)}-${two(a)}.`;
  if (!monthFirst && !dayFirst) return NOT_READ_SLASHED;
  const [m, d] = monthFirst ? [a, b] : [b, a];
  return `Dates with / or . are not read, the order of day and month differs between countries. Write ${Y}-${two(m)}-${two(d)}.`;
};

const wrongForm = (t: string): string | null => {
  if (EXPONENT_FORM.test(t)) return EXPONENT;
  if (GROUPED.test(t)) return `Remove the digit separators: ${t.replace(SEPARATOR, '')}.`;
  if (COMMA_FRACTION.test(t)) return DECIMAL_COMMA;
  const yearFirst = YEAR_FIRST.exec(t);
  if (yearFirst)
    return `Write the date with dashes: ${yearFirst[1]}-${two(Number(yearFirst[2]))}-${two(Number(yearFirst[3]))}.`;
  const yearLast = YEAR_LAST.exec(t);
  if (yearLast) return slashed(t, yearLast);
  const basic = BASIC_ISO.exec(t);
  if (basic) return `Write the date and time with dashes and colons: ${basic[1]}-${basic[2]}-${basic[3]}T….`;
  return null;
};

// ---- dates (§5.3) ----

/** A date and time as written, before it becomes an instant. */
interface Written {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  /** 0–60: 60 is a leap second, read as the next second. */
  second: number;
  /** The fraction of the second, in nanoseconds. */
  nanos: bigint;
  /** The date as written, for messages: "2023-02-29". */
  dateText: string;
}

type Offset = { ms: number; text: string; numeric: boolean };

/** Checks of the calendar and the clock; null when the wall time exists on paper. */
const checkWritten = (w: Written): string | null => {
  if (w.month < 1 || w.month > 12) return `Month ${w.month} does not exist.`;
  const length = monthLength(w.year, w.month);
  if (w.day < 1 || w.day > length)
    return `${w.dateText} is not a date: ${MONTHS[w.month - 1]} ${formatYear(w.year)} has ${length} days.`;
  if (w.hour > 23) return HOURS;
  if (w.minute > 59) return MINUTES;
  if (w.second > 60) return SECONDS;
  return null;
};

const transitionNote = (
  w: Written,
  zone: string,
  epochNs: bigint,
  resolution: ReturnType<typeof wallTimeToEpochMs>,
) => {
  if (!resolution || resolution.kind === 'exact') return null;
  const at = `${two(w.hour)}:${two(w.minute)}`;
  const on = civilDate(w.year, w.month, w.day);
  if (resolution.kind === 'gap')
    return `${at} does not exist in ${zone} on ${on}: the clocks moved forward by ${formatDuration(resolution.shiftMs)}. Showing ${formatIsoInZone(epochNs, zone)}.`;
  const later = BigInt(resolution.laterEpochMs) * 1_000_000n + w.nanos;
  return `${at} happens twice in ${zone} on ${on}: the clocks moved back by ${formatDuration(resolution.shiftMs)}. Showing the first (${formatOffset(zoneOffsetMs(resolution.epochMs, zone))}); the second is ${formatIsoInZone(later, zone)}.`;
};

interface Reading {
  written: Written;
  /** Null: no offset in the text — read in `zone`. */
  offset: Offset | null;
  /** The zone of RFC 9557 brackets, already resolved. */
  bracketZone?: string;
  /** "The text says Mon, but …" */
  weekdayNote?: string;
}

const toInstant = ({ written: w, offset, bracketZone, weekdayNote }: Reading, chosenZone: string): ParsedInput => {
  const problem = checkWritten(w);
  if (problem) return fail(problem);
  const localMs = wallClockAsUtcMs(w);
  const notes: string[] = [];
  let epochNs: bigint;
  let transition: string | null = null;
  let mismatch: string | null = null;
  if (offset) {
    epochNs = BigInt(localMs - offset.ms) * 1_000_000n + w.nanos;
    if (!inRange(epochNs)) return fail(OUT_OF_RANGE);
    if (bracketZone && offset.numeric) {
      const zoneMs = zoneOffsetMs(floorMs(epochNs), bracketZone);
      if (zoneMs !== offset.ms)
        mismatch = `The offset ${formatOffset(offset.ms)} does not match ${bracketZone} (${formatOffset(zoneMs)}) at that moment; the offset is used.`;
    }
  } else {
    const zone = bracketZone ?? chosenZone;
    const resolution = wallTimeToEpochMs(localMs, zone);
    if (!resolution) return fail(OUT_OF_RANGE);
    epochNs = BigInt(resolution.epochMs) * 1_000_000n + w.nanos;
    if (!inRange(epochNs)) return fail(OUT_OF_RANGE);
    if (!bracketZone) notes.push(`No offset in the text: read as ${zone} time.`);
    transition = transitionNote(w, zone, epochNs, resolution);
  }
  if (w.second === 60) notes.push(LEAP_SECOND);
  if (weekdayNote) notes.push(weekdayNote);
  if (mismatch) notes.push(mismatch);
  if (transition) notes.push(transition);
  return { ok: true, empty: false, epochNs, source: 'date', notes };
};

const checkWeekday = (written: string, index: number, w: Written): string | undefined => {
  if (w.month < 1 || w.month > 12 || w.day < 1 || w.day > monthLength(w.year, w.month)) return undefined;
  const actual = weekday(w.year, w.month, w.day);
  return actual === index
    ? undefined
    : `The text says ${written}, but ${civilDate(w.year, w.month, w.day)} is a ${DAYS[actual]}.`;
};

/** "±hh:mm", "±hhmm", "±hh"; null when out of range (the caller words the error). */
const numericOffset = (text: string): number | null => {
  const sign = text.startsWith('-') ? -1 : 1;
  const digits = text.slice(1).replace(':', '');
  const h = Number(digits.slice(0, 2));
  const m = digits.length > 2 ? Number(digits.slice(2, 4)) : 0;
  if (h > 23 || m > 59) return null;
  return sign * (h * 3600 + m * 60) * 1000;
};

const fractionNanos = (fraction: string | undefined): bigint =>
  fraction ? BigInt(fraction.slice(0, 9).padEnd(9, '0')) : 0n;

const ISO =
  /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})(?:[Tt ](\d{2}):(\d{2})(?::(\d{2})(?:[.,](\d{1,180}))?)?([Zz]|[+-]\d{2}(?::?\d{2})?)?)?((?:\[[^[\]]{0,180}\])*)$/;

const readIso = (match: RegExpExecArray): Reading | string => {
  const [, yearText = '', mm = '', dd = '', hh, mi, ss, fraction, zone, brackets = ''] = match;
  if (yearText === '-000000') return 'Year -000000 is not allowed: write 0000.';
  let bracketZone: string | undefined;
  for (const [, inner = ''] of brackets.matchAll(/\[([^[\]]*)\]/g)) {
    const item = inner.startsWith('!') ? inner.slice(1) : inner;
    if (item.includes('=') || bracketZone) continue;
    const resolved = resolveTimeZone(item);
    if (!resolved) return `Unknown time zone "${item}".`;
    bracketZone = resolved;
  }
  let offset: Offset | null = null;
  if (zone) {
    if (zone === 'Z' || zone === 'z') offset = { ms: 0, text: zone, numeric: false };
    else {
      const ms = numericOffset(zone);
      if (ms === null) return `Offset ${zone} is out of range: offsets go up to ±23:59.`;
      // RFC 3339 §4.3: -00:00 means "the offset is unknown" — UTC, like Z, never a mismatch.
      offset = { ms, text: zone, numeric: !/^-00(?::?00)?$/.test(zone) };
    }
  }
  return {
    written: {
      year: Number(yearText),
      month: Number(mm),
      day: Number(dd),
      hour: hh === undefined ? 0 : Number(hh),
      minute: mi === undefined ? 0 : Number(mi),
      second: ss === undefined ? 0 : Number(ss),
      nanos: fractionNanos(fraction),
      dateText: `${yearText}-${mm}-${dd}`,
    },
    offset,
    ...(bracketZone ? { bracketZone } : {}),
  };
};

/** RFC 5322 §4.3: two digits 00–49 → 2000–2049, 50–99 → 1950–1999; three digits + 1900. */
const mailYear = (text: string): number => {
  const y = Number(text);
  if (text.length === 2) return y < 50 ? 2000 + y : 1900 + y;
  if (text.length === 3) return 1900 + y;
  return y;
};

const MAIL_ZONES: Readonly<Record<string, number>> = {
  UT: 0,
  GMT: 0,
  Z: 0,
  EST: -5,
  EDT: -4,
  CST: -6,
  CDT: -5,
  MST: -7,
  MDT: -6,
  PST: -8,
  PDT: -7,
};

const writtenOf = (y: number, m: number, d: number, hh: string, mi: string, ss: string | undefined): Written => ({
  year: y,
  month: m,
  day: d,
  hour: Number(hh),
  minute: Number(mi),
  second: ss === undefined ? 0 : Number(ss),
  nanos: 0n,
  dateText: civilDate(y, m, d),
});

const RFC_2822 =
  /^(?:([a-z]{3})\s*,\s*)?(\d{1,2})\s+([a-z]{3})\s+(\d{2,4})\s+(\d{2}):(\d{2})(?::(\d{2}))?\s+([+-]\d{4}|[a-z]{1,3})(?:\s*\([^()]{0,100}\))?$/i;

const readMail = (match: RegExpExecArray): Reading | string | null => {
  const [, dayName, dd = '', mon = '', yy = '', hh = '', mi = '', ss, zone = ''] = match;
  const month = monthOf(mon);
  const dayIndex = dayName === undefined ? -1 : weekdayOf(dayName, false);
  const zoneHours = MAIL_ZONES[zone.toUpperCase()];
  if (month === 0 || (dayName !== undefined && dayIndex < 0)) return null;
  let ms: number;
  if (/^[+-]/.test(zone)) {
    const parsed = numericOffset(zone);
    if (parsed === null) return `Offset ${zone} is out of range.`;
    ms = parsed;
  } else if (zoneHours === undefined) return null;
  else ms = zoneHours * 3_600_000;
  const written = writtenOf(mailYear(yy), month, Number(dd), hh, mi, ss);
  const weekdayNote = dayName === undefined ? undefined : checkWeekday(dayName, dayIndex, written);
  return { written, offset: { ms, text: zone, numeric: true }, ...(weekdayNote ? { weekdayNote } : {}) };
};

const RFC_850 = /^([a-z]{6,9})\s*,\s*(\d{2})-([a-z]{3})-(\d{2}|\d{4})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT$/i;

const readRfc850 = (match: RegExpExecArray): Reading | null => {
  const [, dayName = '', dd = '', mon = '', yy = '', hh = '', mi = '', ss = ''] = match;
  const month = monthOf(mon);
  const dayIndex = weekdayOf(dayName, true);
  if (month === 0 || dayIndex < 0) return null;
  const written = writtenOf(mailYear(yy), month, Number(dd), hh, mi, ss);
  const weekdayNote = checkWeekday(dayName, dayIndex, written);
  return { written, offset: { ms: 0, text: 'GMT', numeric: true }, ...(weekdayNote ? { weekdayNote } : {}) };
};

const ASCTIME = /^([a-z]{3})\s+([a-z]{3})\s+(\d{1,2})\s+(\d{2}):(\d{2}):(\d{2})\s+(\d{4})$/i;

const readAsctime = (match: RegExpExecArray): Reading | null => {
  const [, dayName = '', mon = '', dd = '', hh = '', mi = '', ss = '', yyyy = ''] = match;
  const month = monthOf(mon);
  const dayIndex = weekdayOf(dayName, false);
  if (month === 0 || dayIndex < 0) return null;
  const written = writtenOf(Number(yyyy), month, Number(dd), hh, mi, ss);
  const weekdayNote = checkWeekday(dayName, dayIndex, written);
  return { written, offset: null, ...(weekdayNote ? { weekdayNote } : {}) };
};

const JS_STRING =
  /^([a-z]{3})\s+([a-z]{3})\s+(\d{2})\s+(-?\d{4,6})\s+(\d{2}):(\d{2}):(\d{2})\s+GMT([+-]\d{4})(?:\s*\([^()]{0,100}\))?$/i;

const readJsString = (match: RegExpExecArray): Reading | string | null => {
  const [, dayName = '', mon = '', dd = '', yyyy = '', hh = '', mi = '', ss = '', zone = ''] = match;
  const month = monthOf(mon);
  const dayIndex = weekdayOf(dayName, false);
  if (month === 0 || dayIndex < 0) return null;
  const ms = numericOffset(zone);
  if (ms === null) return `Offset ${zone} is out of range.`;
  const written = writtenOf(Number(yyyy), month, Number(dd), hh, mi, ss);
  const weekdayNote = checkWeekday(dayName, dayIndex, written);
  return { written, offset: { ms, text: zone, numeric: true }, ...(weekdayNote ? { weekdayNote } : {}) };
};

const DATE_FORMS: ReadonlyArray<[RegExp, (match: RegExpExecArray) => Reading | string | null]> = [
  [ISO, readIso],
  [RFC_2822, readMail],
  [RFC_850, readRfc850],
  [ASCTIME, readAsctime],
  [JS_STRING, readJsString],
];

/** Trims, then takes off one pair of quotes around the whole text (a value from JSON or code) and trims again. */
const unquote = (text: string): string => {
  const t = text.trim();
  return t.length >= 2 && (t[0] === '"' || t[0] === "'") && t.at(-1) === t[0] ? t.slice(1, -1).trim() : t;
};

/**
 * Reads the field (§5): empty (the component shows the time now), a number in the unit chosen or guessed by its digits,
 * or a date in one of the forms of §5.3, tried in order. Errors and notes are the words of §6.
 */
export const parseInput = (text: string, context: ParseContext): ParsedInput => {
  if (text.trim().length > MAX_INPUT) return fail(TOO_LONG);
  const t = unquote(text);
  if (t === '') return { ok: true, empty: true };
  const number = NUMBER.exec(t);
  if (number) return readNumber(t, number, context.unit);
  const wrong = wrongForm(t);
  if (wrong) return fail(wrong);
  const zone = resolveTimeZone(context.timeZone) ?? 'UTC';
  for (const [pattern, read] of DATE_FORMS) {
    const match = pattern.exec(t);
    if (!match) continue;
    const reading = read(match);
    if (reading === null) continue;
    return typeof reading === 'string' ? fail(reading) : toInstant(reading, zone);
  }
  return fail(NOT_READ);
};

/** Is the field empty or a number (§5.2) — where `Unit` applies? It is turned off for anything else (§4, §8). */
export const unitApplies = (text: string): boolean => {
  if (text.trim().length > MAX_INPUT) return false;
  const t = unquote(text);
  return t === '' || NUMBER.test(t);
};
