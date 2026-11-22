/**
 * The clock arithmetic the three parts share (docs/tools/specs/date-calc.md §5.1–§5.3): a moment's wall clock in its zone,
 * a wall time back to a moment, lengths in words, the clock changes between two moments. Every question about a zone
 * goes to @workspace/tools-shared/time (Intl underneath): no table of zones here.
 */
import {
  MAX_EPOCH_MS,
  civilFromDays,
  daysFromCivil,
  formatIsoInZone,
  formatOffset,
  formatYear,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';

export const DAY_MS = 86_400_000;
export const MAX_INPUT = 200;

export const OUT_OF_RANGE =
  'Out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
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
] as const;

export const two = (n: number): string => String(n).padStart(2, '0');
export const mod = (a: number, b: number): number => ((a % b) + b) % b;
export const inRange = (ms: number): boolean => Math.abs(ms) <= MAX_EPOCH_MS;

/** Days in a month of the proleptic Gregorian calendar (astronomical years). */
export const daysInMonth = (year: number, month: number): number =>
  month === 2
    ? (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
      ? 29
      : 28
    : [4, 6, 9, 11].includes(month)
      ? 30
      : 31;

export const monthName = (month: number): string => MONTHS[month - 1]!;

/** The wall clock of a moment in a zone, written as UTC milliseconds: the instant plus the zone's offset then. */
export const localMs = (epochMs: number, zone: string): number => epochMs + zoneOffsetMs(epochMs, zone);

/** Day 0 = 1970-01-01, a Thursday. */
export const weekdayOfDay = (epochDay: number): string => WEEKDAYS[mod(epochDay + 4, 7)]!;

/** "2024-03-31" of an epoch day. */
export const dateText = (epochDay: number): string => {
  const { year, month, day } = civilFromDays(epochDay);
  return `${formatYear(year)}-${two(month)}-${two(day)}`;
};

/** "02:30", with seconds when there are any ("01:04:30"). */
const clockText = (msOfDay: number): string => {
  const s = Math.floor(msOfDay / 1000);
  const seconds = s % 60;
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}${seconds ? `:${two(seconds)}` : ''}`;
};

/** ISO 8601 in the zone with the offset (the shared writer: a fraction of 0 or 3 digits, offsets with seconds). */
export const isoIn = (epochMs: number, zone: string): string => formatIsoInZone(BigInt(epochMs) * 1_000_000n, zone);

/** "1 hour", "30 minutes", "44 minutes 30 seconds", "24 hours" — a length of whole seconds (unix-time §5.5). */
export const lengthWords = (ms: number): string => {
  const total = Math.round(Math.abs(ms) / 1000);
  const parts: Array<[number, string]> = [
    [Math.floor(total / 3600), 'hour'],
    [Math.floor(total / 60) % 60, 'minute'],
    [total % 60, 'second'],
  ];
  const words = parts
    .filter(([n]) => n > 0)
    .map(([n, unit]) => `${n} ${unit}${n === 1 ? '' : 's'}`)
    .join(' ');
  return words || `${Math.abs(ms)} milliseconds`;
};

/** One change of a zone's offset: `atMs` is the first millisecond with the new offset. */
export interface ClockChange {
  atMs: number;
  beforeMs: number;
  afterMs: number;
}

/** Scanned only over spans up to three years (§5.6): one offset a day, a binary search where it changed. */
export const MAX_SCAN_DAYS = 1096;
const MAX_LISTED = 5;

/**
 * The changes of the zone's offset in (from, to], found by the offset at the start of every day of the span and a binary
 * search to the millisecond where it changed; null when the span is longer than MAX_SCAN_DAYS. A change that comes and
 * goes within one day is not found (the IANA data has none).
 */
export const clockChanges = (a: number, b: number, zone: string): ClockChange[] | null => {
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (hi - lo > MAX_SCAN_DAYS * DAY_MS) return null;
  const found: ClockChange[] = [];
  let prevT = lo;
  let prevOff = zoneOffsetMs(lo, zone);
  while (prevT < hi) {
    const t = Math.min(prevT + DAY_MS, hi);
    const off = zoneOffsetMs(t, zone);
    if (off !== prevOff) {
      // The first millisecond in (prevT, t] whose offset is no longer prevOff.
      let left = prevT;
      let right = t;
      while (right - left > 1) {
        const mid = left + Math.floor((right - left) / 2);
        if (zoneOffsetMs(mid, zone) === prevOff) left = mid;
        else right = mid;
      }
      found.push({ atMs: right, beforeMs: prevOff, afterMs: zoneOffsetMs(right, zone) });
      // Go on from the change itself: another one may follow within the day.
      prevOff = zoneOffsetMs(right, zone);
      prevT = right;
      continue;
    }
    prevT = t;
    prevOff = off;
  }
  return found;
};

/** "2024-03-31T02:00 → 03:00 (+01:00 → +02:00)"; the full date on the right when the clocks jumped to another day. */
export const clockChangeText = ({ atMs, beforeMs, afterMs }: ClockChange): string => {
  const before = atMs + beforeMs;
  const after = atMs + afterMs;
  const dayBefore = Math.floor(before / DAY_MS);
  const dayAfter = Math.floor(after / DAY_MS);
  const left = `${dateText(dayBefore)}T${clockText(mod(before, DAY_MS))}`;
  const right =
    dayAfter === dayBefore ? clockText(mod(after, DAY_MS)) : `${dateText(dayAfter)}T${clockText(mod(after, DAY_MS))}`;
  return `${left} → ${right} (${formatOffset(beforeMs)} → ${formatOffset(afterMs)})`;
};

/** " Clock changes: …; …." with at most five, "… and 3 more."; empty when the span was not scanned or none was found. */
export const clockChangesSentence = (a: number, b: number, zone: string): string => {
  const changes = clockChanges(a, b, zone);
  if (!changes || changes.length === 0) return '';
  const listed = changes.slice(0, MAX_LISTED).map(clockChangeText).join('; ');
  const more = changes.length > MAX_LISTED ? ` and ${changes.length - MAX_LISTED} more` : '';
  return ` Clock changes: ${listed}${more}.`;
};

/** A local date and time from its parts as UTC milliseconds (days_from_civil, so any year of the range works). */
export const localOf = (year: number, month: number, day: number, msOfDay: number): number =>
  daysFromCivil(year, month, day) * DAY_MS + msOfDay;
