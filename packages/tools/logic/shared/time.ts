/**
 * Instants for people (docs/tools/specs/unix-time.md §5.7, §5.8, §9; jwt.md §5.6; uuid.md §5.4): ISO 8601 in UTC
 * with the fraction the instant needs, the readable local form, and "3 minutes ago". The calendar is computed here
 * (proleptic Gregorian, astronomical years) so the whole range of a JavaScript Date — and nanoseconds — fit.
 *
 * One rule for every tool (docs/tools/README.md, «known inconsistencies», resolved 2026-11-21): an ISO instant is
 * written by `formatIsoUtc`, whose fraction is the shortest of 0, 3, 6 or 9 digits that is exact. The zone-related
 * part of unix-time.md §9 (offsets, wall clocks, the zone list) comes with that tool.
 */

/** The range of a JavaScript Date, ±100 000 000 days, in milliseconds and in nanoseconds. */
export const MAX_EPOCH_MS = 8.64e15;
export const MAX_EPOCH_NS = 8_640_000_000_000_000_000_000n;

/** Proleptic Gregorian, astronomical years, day 0 = 1970-01-01. No Date involved (H. Hinnant's days_from_civil). */
export const daysFromCivil = (year: number, month: number, day: number): number => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yoe = y - era * 400;
  const doy = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy;
  return era * 146_097 + doe - 719_468;
};

/** The inverse of `daysFromCivil`. */
export const civilFromDays = (days: number): { year: number; month: number; day: number } => {
  const z = days + 719_468;
  const era = Math.floor(z / 146_097);
  const doe = z - era * 146_097;
  const yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36_524) - Math.floor(doe / 146_096)) / 365);
  const doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100));
  const mp = Math.floor((5 * doy + 2) / 153);
  const day = doy - Math.floor((153 * mp + 2) / 5) + 1;
  const month = mp < 10 ? mp + 3 : mp - 9;
  return { year: yoe + era * 400 + (month <= 2 ? 1 : 0), month, day };
};

/** "0000"…"9999", otherwise sign + 6 digits ("-000002", "+010889"). */
export const formatYear = (year: number): string =>
  year >= 0 && year <= 9999
    ? String(year).padStart(4, '0')
    : `${year < 0 ? '-' : '+'}${String(Math.abs(year)).padStart(6, '0')}`;

const two = (n: number): string => String(n).padStart(2, '0');
const NS_PER_SECOND = 1_000_000_000n;
const SECONDS_PER_DAY = 86_400n;

/** Floor division and its non-negative remainder, for bigints. */
const floorDiv = (a: bigint, b: bigint): [bigint, bigint] => {
  const r = ((a % b) + b) % b;
  return [(a - r) / b, r];
};

/** "2023-11-14T22:13:20Z", fraction of 0, 3, 6 or 9 digits — the shortest that is exact; ±YYYYYY outside 0000–9999. */
export const formatIsoUtc = (epochNs: bigint): string => {
  const [seconds, nanos] = floorDiv(epochNs, NS_PER_SECOND);
  const [days, secondOfDay] = floorDiv(seconds, SECONDS_PER_DAY);
  const { year, month, day } = civilFromDays(Number(days));
  const s = Number(secondOfDay);
  const ns = Number(nanos);
  const fraction =
    ns === 0
      ? ''
      : ns % 1_000_000 === 0
        ? `.${String(ns / 1_000_000).padStart(3, '0')}`
        : ns % 1000 === 0
          ? `.${String(ns / 1000).padStart(6, '0')}`
          : `.${String(ns).padStart(9, '0')}`;
  const time = `${two(Math.floor(s / 3600))}:${two(Math.floor(s / 60) % 60)}:${two(s % 60)}`;
  return `${formatYear(year)}-${two(month)}-${two(day)}T${time}${fraction}Z`;
};

/**
 * The readable form: `dateStyle: 'medium'`, `timeStyle: 'long'`; locale undefined = the browser's, time zone undefined =
 * the browser's. Null for years before 1 (Intl writes them without an era) and outside the range of a Date.
 */
export const formatReadable = (epochMs: number, timeZone?: string, locale?: string): string | null => {
  if (!Number.isFinite(epochMs) || Math.abs(epochMs) > MAX_EPOCH_MS) return null;
  const era = new Intl.DateTimeFormat('en-US', { timeZone, year: 'numeric', era: 'short' })
    .formatToParts(epochMs)
    .find(part => part.type === 'era')?.value;
  if (era !== 'AD') return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeStyle: 'long', timeZone }).format(epochMs);
};

const SECOND = 1000;
const UNITS: ReadonlyArray<[Intl.RelativeTimeFormatUnit, number, number]> = [
  // unit, its length in ms, used below this distance
  ['second', SECOND, 60 * SECOND],
  ['minute', 60 * SECOND, 3600 * SECOND],
  ['hour', 3600 * SECOND, 86_400 * SECOND],
  ['day', 86_400 * SECOND, 30 * 86_400 * SECOND],
  ['month', 30 * 86_400 * SECOND, 365 * 86_400 * SECOND],
  ['year', 365 * 86_400 * SECOND, Infinity],
];
let relative: Intl.RelativeTimeFormat | undefined;

/**
 * "in 30 minutes", "59 seconds ago", "now" (jwt.md §5.6): under a second is `now`; otherwise the first unit that fits
 * — seconds, minutes, hours, days below 30, months of 30 days below 365 days, years of 365 days — counted down
 * (`floor` of the distance) with the sign of `tMs − nowMs`. English, grouped digits ("in 273,915 years").
 */
export const relativeTime = (tMs: number, nowMs: number): string => {
  const d = tMs - nowMs;
  const a = Math.abs(d);
  if (a < SECOND) return 'now';
  const [unit, length] = UNITS.find(([, , below]) => a < below)!;
  const value = Math.floor(a / length);
  relative ??= new Intl.RelativeTimeFormat('en', { numeric: 'always' });
  return relative.format(d < 0 ? -value : value, unit);
};
