/**
 * What the Unix Time tool shows for an instant (docs/tools/specs/unix-time.md §5.6, §5.7): the four integers, ISO 8601
 * in UTC and in the zone, RFC 2822, the HTTP date, the readable form, the calendar rows and the relative time; the
 * zone line under the picker and the text of the Now button. The ISO forms, offsets and wall clocks come from the
 * shared time module; RFC 2822, the HTTP date and the calendar rows are this tool's own.
 */
import {
  civilFromDays,
  daysFromCivil,
  formatIsoInZone,
  formatIsoUtc,
  formatOffset,
  formatReadable,
  formatYear,
  relativeTime,
  zoneLongName,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';
import type { UnitOption } from './parse';

export interface Outputs {
  seconds: string;
  milliseconds: string;
  microseconds: string;
  nanoseconds: string;
  isoUtc: string;
  isoZone: string;
  /** Null outside the years 1900–9999. */
  rfc2822: string | null;
  /** Null outside the years 1900–9999. */
  httpDate: string | null;
  /** Null before the year 1. */
  readable: string | null;
  dayOfWeek: string;
  dayOfYear: number;
  isoWeekDate: string;
  relative: string;
}

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const two = (n: number): string => String(n).padStart(2, '0');

const floorDiv = (a: bigint, b: bigint): bigint => {
  const r = ((a % b) + b) % b;
  return (a - r) / b;
};

interface Civil {
  /** Days since 1970-01-01. */
  days: number;
  year: number;
  month: number;
  day: number;
  time: string;
  /** 0 = Sunday. */
  weekday: number;
}

/** The calendar date and clock of nanoseconds since the epoch, read as UTC (pure arithmetic, any year). */
const civil = (ns: bigint): Civil => {
  const seconds = floorDiv(ns, 1_000_000_000n);
  const days = Number(floorDiv(seconds, 86_400n));
  const s = Number(seconds - BigInt(days) * 86_400n);
  return {
    days,
    ...civilFromDays(days),
    time: `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`,
    weekday: (((days + 4) % 7) + 7) % 7,
  };
};

/** "Tue, 14 Nov 2023 23:13:20 +0100" — RFC 5322 §3.3 with the year 1900–9999 and a two-digit day. */
const mailDate = (c: Civil, zone: string): string | null =>
  c.year >= 1900 && c.year <= 9999
    ? `${DAYS[c.weekday]!.slice(0, 3)}, ${two(c.day)} ${MONTHS[c.month - 1]} ${c.year} ${c.time} ${zone}`
    : null;

/** "2023-W46-2": the ISO 8601 week is the one that holds the Thursday, its year is that Thursday's. */
const isoWeekDate = (c: Civil): string => {
  const isoDay = c.weekday === 0 ? 7 : c.weekday;
  const thursday = c.days + 4 - isoDay;
  const weekYear = civilFromDays(thursday).year;
  const week = Math.floor((thursday - daysFromCivil(weekYear, 1, 1)) / 7) + 1;
  return `${formatYear(weekYear)}-W${two(week)}-${isoDay}`;
};

/** Every row of §5.6 for the instant in the zone; locale undefined = the browser's (tests pass 'en-US'). */
export const outputs = (epochNs: bigint, timeZone: string, nowMs: number, locale?: string): Outputs => {
  const epochMs = Number(floorDiv(epochNs, 1_000_000n));
  const offset = zoneOffsetMs(epochMs, timeZone);
  const zoned = civil(epochNs + BigInt(offset) * 1_000_000n);
  const utc = civil(epochNs);
  // ±hhmm cannot hold seconds (Africa/Monrovia before 1972): then RFC 2822 is written in UTC.
  const whole = offset % 60_000 === 0;
  return {
    seconds: String(floorDiv(epochNs, 1_000_000_000n)),
    milliseconds: String(epochMs),
    microseconds: String(floorDiv(epochNs, 1000n)),
    nanoseconds: String(epochNs),
    isoUtc: formatIsoUtc(epochNs),
    isoZone: formatIsoInZone(epochNs, timeZone),
    rfc2822: whole ? mailDate(zoned, formatOffset(offset, false)) : mailDate(utc, '+0000'),
    httpDate: mailDate(utc, 'GMT'),
    readable: formatReadable(epochMs, timeZone, locale),
    dayOfWeek: DAYS[zoned.weekday]!,
    dayOfYear: zoned.days - daysFromCivil(zoned.year, 1, 1) + 1,
    isoWeekDate: isoWeekDate(zoned),
    relative: relativeTime(epochMs, nowMs),
  };
};

/** The line under the zone picker: "UTC+01:00 · Central European Standard Time" at the instant shown. */
export const zoneSummary = (epochNs: bigint, timeZone: string): string => {
  const epochMs = Number(floorDiv(epochNs, 1_000_000n));
  return `UTC${formatOffset(zoneOffsetMs(epochMs, timeZone))} · ${zoneLongName(epochMs, timeZone)}`;
};

/** The Relative row alone (§5.7), for the one part of the page that follows the clock. */
export const relativeOf = (epochNs: bigint, nowMs: number): string =>
  relativeTime(Number(floorDiv(epochNs, 1_000_000n)), nowMs);

/** The zone picker's rows (§8): moved to the shared time module when Cron needed the same picker (2026-11-21). */
export { zoneOptions } from '@workspace/tools-shared/time';
export type { ZoneOption } from '@workspace/tools-shared/time';

/** §5.7: what Now writes — milliseconds for Auto and Milliseconds, whole seconds, or milliseconds with zeros. */
export const nowText = (nowMs: number, unit: UnitOption): string => {
  const ms = Math.floor(nowMs);
  switch (unit) {
    case 's':
      return String(Math.floor(ms / 1000));
    case 'us':
      return `${ms}000`;
    case 'ns':
      return `${ms}000000`;
    default:
      return String(ms);
  }
};

/** For the component, from the shared time module: the zone a page starts in, the check of a kept zone, the ISO label. */
export { browserTimeZone, formatIsoUtc, resolveTimeZone } from '@workspace/tools-shared/time';
