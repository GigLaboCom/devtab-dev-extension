/**
 * Calendar arithmetic by the Temporal proposal's rules for the ISO 8601 calendar (docs/tools/specs/date-calc.md §5.5–§5.6),
 * written out here in integers — Temporal itself is not used (Chrome 116, the extension's minimum, does not have it;
 * Node, where the tests run, neither):
 *
 *   - adding: `AddZonedDateTime` — years and months as one count of months, a day past the month's end constrained to
 *     its last day; then weeks and days as calendar days; the date and the old wall time back to an instant
 *     (`compatible`); the exact time last;
 *   - the difference: `DifferenceZonedDateTime` with `CalendarDateUntil` — in From's zone, the date part by "do not
 *     surpass" (the day is not constrained while comparing), the rest as exact time with the sign of the whole.
 */
import {
  DAY_MS,
  clockChangesSentence,
  daysInMonth,
  inRange,
  isoIn,
  lengthWords,
  localMs,
  monthName,
  mod,
} from './clock';
import { wallNotes } from './moment';
import {
  civilFromDays,
  daysFromCivil,
  formatOffset,
  formatYear,
  wallTimeToEpochMs,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';
import type { CalendarParts, Duration } from './duration';
import type { Moment } from './moment';

export type Operation = 'add' | 'subtract';

export type AddResult =
  { ok: true; epochMs: number; elapsedMs: bigint; notes: string[] } | { ok: false; message: string };

const OUT_OF_RANGE_RESULT =
  'The result is out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.';

const clockText = (msOfDay: number, withSeconds: boolean): string => {
  const s = Math.floor(msOfDay / 1000);
  const two = (n: number) => String(n).padStart(2, '0');
  return `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}${withSeconds ? `:${two(s % 60)}` : ''}`;
};

/** "Europe/Berlin changed its clocks between Start and the result (+01:00 at Start, +02:00 at the result)." */
const changedClocks = (a: number, b: number, zone: string, names: [string, string], lead: string): string => {
  const before = formatOffset(zoneOffsetMs(a, zone));
  const after = formatOffset(zoneOffsetMs(b, zone));
  return `${lead}${zone} changed its clocks between ${names[0] === 'From' ? 'the two moments' : 'Start and the result'} (${before} at ${names[0]}, ${after} at ${names[1]}).${clockChangesSentence(a, b, zone)}`;
};

/** §5.5: Start plus (or minus) the duration, in Start's zone. */
export const addDuration = (start: Moment, duration: Duration, operation: Operation): AddResult => {
  const sign = BigInt(duration.sign * (operation === 'subtract' ? -1 : 1));
  const months = sign * (duration.years * 12n + duration.months);
  const days = sign * (duration.weeks * 7n + duration.days);
  const time =
    sign *
    (duration.hours * 3_600_000n + duration.minutes * 60_000n + duration.seconds * 1000n + duration.milliseconds);
  const { zone } = start;
  const notes: string[] = [];
  let base = start.epochMs;

  if (months !== 0n || days !== 0n) {
    const local = localMs(start.epochMs, zone);
    const epochDay = Math.floor(local / DAY_MS);
    const msOfDay = mod(local, DAY_MS);
    const { year, month, day } = civilFromDays(epochDay);
    // Years and months as one count of months (BalanceISOYearMonth), the day constrained (RegulateISODate).
    const monthIndex = BigInt(year) * 12n + BigInt(month - 1) + months;
    const yearAfter = Number(monthIndex >= 0n ? monthIndex / 12n : -((-monthIndex + 11n) / 12n));
    const monthAfter = Number(monthIndex - BigInt(yearAfter) * 12n) + 1;
    if (Math.abs(yearAfter) > 300_000) return { ok: false, message: OUT_OF_RANGE_RESULT };
    const last = daysInMonth(yearAfter, monthAfter);
    const dayAfter = Math.min(day, last);
    if (dayAfter !== day)
      notes.push(
        `Day ${day} does not exist in ${monthName(monthAfter)} ${formatYear(yearAfter)}: the last day, ${last}, is used.`,
      );
    // Then weeks and days as calendar days (BalanceISODate).
    const dayNumber = daysFromCivil(yearAfter, monthAfter, dayAfter) + Number(days);
    if (Math.abs(dayNumber) > 100_000_002) return { ok: false, message: OUT_OF_RANGE_RESULT };
    const wanted = dayNumber * DAY_MS + msOfDay;
    const resolution = wallTimeToEpochMs(wanted, zone);
    if (!resolution) return { ok: false, message: OUT_OF_RANGE_RESULT };
    const date = civilFromDays(dayNumber);
    const dateText = `${formatYear(date.year)}-${String(date.month).padStart(2, '0')}-${String(date.day).padStart(2, '0')}`;
    notes.push(...wallNotes(resolution, zone, dateText, clockText(msOfDay, mod(msOfDay, 60_000) !== 0), 'result'));
    base = resolution.epochMs;
  }

  const result = BigInt(base) + time;
  if (result > 8_640_000_000_000_000n || result < -8_640_000_000_000_000n)
    return { ok: false, message: OUT_OF_RANGE_RESULT };
  const epochMs = Number(result);
  if (!inRange(epochMs)) return { ok: false, message: OUT_OF_RANGE_RESULT };
  if (zoneOffsetMs(start.epochMs, zone) !== zoneOffsetMs(epochMs, zone))
    notes.push(changedClocks(start.epochMs, epochMs, zone, ['Start', 'the result'], ''));
  return { ok: true, epochMs, elapsedMs: result - BigInt(start.epochMs), notes };
};

// ---- the difference (§5.6) ----

export interface DifferenceResult {
  sign: -1 | 0 | 1;
  exactMs: bigint;
  /** In From's zone, the largest unit years; every field carries the sign. */
  calendar: CalendarParts;
  /** The largest unit days. */
  calendarDays: { days: number; timeMs: bigint };
  notes: string[];
}

const signOf = (n: bigint | number): -1 | 0 | 1 => (n > 0 ? 1 : n < 0 ? -1 : 0);

/** ISODateSurpasses: is (y1, m1, d1) — the day not constrained — past `two` in the direction `sign`? */
const surpasses = (
  sign: number,
  y1: number,
  m1: number,
  d1: number,
  two: { year: number; month: number; day: number },
) => {
  if (y1 !== two.year) return sign * (y1 - two.year) > 0;
  if (m1 !== two.month) return sign * (m1 - two.month) > 0;
  if (d1 !== two.day) return sign * (d1 - two.day) > 0;
  return false;
};

/** BalanceISOYearMonth. */
const balance = (year: number, month: number): { year: number; month: number } => {
  const index = year * 12 + (month - 1);
  const y = Math.floor(index / 12);
  return { year: y, month: index - y * 12 + 1 };
};

/** CalendarDateUntil (ISO 8601) from one epoch day to another, the largest unit years. */
const dateUntil = (fromDay: number, toDay: number): { years: number; months: number; days: number } => {
  const sign = signOf(toDay - fromDay);
  if (sign === 0) return { years: 0, months: 0, days: 0 };
  const one = civilFromDays(fromDay);
  const two = civilFromDays(toDay);
  let years = 0;
  let candidateYears = two.year - one.year;
  if (candidateYears !== 0) candidateYears -= sign;
  while (!surpasses(sign, one.year + candidateYears, one.month, one.day, two)) {
    years = candidateYears;
    candidateYears += sign;
  }
  let months = 0;
  let candidateMonths = sign;
  let intermediate = balance(one.year + years, one.month + candidateMonths);
  while (!surpasses(sign, intermediate.year, intermediate.month, one.day, two)) {
    months = candidateMonths;
    candidateMonths += sign;
    intermediate = balance(intermediate.year, intermediate.month + sign);
  }
  const at = balance(one.year + years, one.month + months);
  const constrained = daysFromCivil(at.year, at.month, Math.min(one.day, daysInMonth(at.year, at.month)));
  return { years, months, days: toDay - constrained };
};

/**
 * DifferenceZonedDateTime: the wall dates and times of both moments in `zone`; the intermediate date — To's date less a
 * day or two when the time of day would otherwise make the remainder change sign — with From's time back to an instant
 * (`compatible`); the date part from From's date to it, the rest exact.
 */
const zonedUntil = (a: number, b: number, zone: string): { startDay: number; endDay: number; timeMs: bigint } => {
  const sign = signOf(b - a);
  const localA = localMs(a, zone);
  const localB = localMs(b, zone);
  const dayA = Math.floor(localA / DAY_MS);
  const dayB = Math.floor(localB / DAY_MS);
  const timeA = mod(localA, DAY_MS);
  if (sign === 0 || dayA === dayB) return { startDay: dayA, endDay: dayA, timeMs: BigInt(b) - BigInt(a) };
  const timeB = mod(localB, DAY_MS);
  let correction = signOf(timeB - timeA) === -sign ? 1 : 0;
  const maxCorrection = sign === 1 ? 2 : 1;
  while (correction <= maxCorrection) {
    const day = dayB - correction * sign;
    const resolution = wallTimeToEpochMs(day * DAY_MS + timeA, zone);
    if (resolution) {
      const rest = BigInt(b) - BigInt(resolution.epochMs);
      if (signOf(rest) !== -sign) return { startDay: dayA, endDay: day, timeMs: rest };
    }
    correction++;
  }
  // Not reached with the IANA data (at most one change of offset a day); keep the answer exact all the same.
  return { startDay: dayA, endDay: dayA, timeMs: BigInt(b) - BigInt(a) };
};

/** §5.6: From → To; the calendar parts on the clocks of From's zone. */
export const difference = (from: Moment, to: Moment): DifferenceResult => {
  const a = from.epochMs;
  const b = to.epochMs;
  const zone = from.zone;
  const exactMs = BigInt(b) - BigInt(a);
  const sign = signOf(exactMs);
  const notes: string[] = [];
  if (sign === 0)
    return {
      sign,
      exactMs,
      calendar: { years: 0, months: 0, days: 0, timeMs: 0n },
      calendarDays: { days: 0, timeMs: 0n },
      notes,
    };
  const { startDay, endDay, timeMs } = zonedUntil(a, b, zone);
  const { years, months, days } = dateUntil(startDay, endDay);
  const calendarDays = { days: endDay - startDay, timeMs };
  if (sign < 0) notes.push('To is earlier than From: the durations are negative.');
  if (to.zone !== zone)
    notes.push(`Calendar units are counted on the clocks of ${zone}, the zone of From; To is ${isoIn(b, zone)} there.`);
  const delta = exactMs - (BigInt(calendarDays.days) * BigInt(DAY_MS) + timeMs);
  if (delta !== 0n)
    notes.push(
      changedClocks(
        a,
        b,
        zone,
        ['From', 'To'],
        `Calendar days and exact time differ by ${lengthWords(Number(delta))}: `,
      ),
    );
  return { sign, exactMs, calendar: { years, months, days, timeMs }, calendarDays, notes };
};
