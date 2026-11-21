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

/*
 * Time zones (unix-time.md §5.4, §5.5, §9; used by cron, jwt, uuid, x509): offsets, wall clocks and the zone list,
 * through Intl and the calendar above — no library, no Temporal, no Date methods in local time (they know only the
 * machine's zone and round historical offsets such as Africa/Monrovia's −00:44:30 to minutes).
 */

/** "+05:30", "-05:00", "+00:00", with seconds when there are any ("-00:44:30"); colon = false → "+0530", "-004430". */
export const formatOffset = (offsetMs: number, colon = true): string => {
  const total = Math.floor(Math.abs(offsetMs) / 1000);
  const sep = colon ? ':' : '';
  const seconds = total % 60;
  return `${offsetMs < 0 ? '-' : '+'}${two(Math.floor(total / 3600))}${sep}${two(Math.floor(total / 60) % 60)}${
    seconds === 0 ? '' : `${sep}${two(seconds)}`
  }`;
};

/** A wall clock: what the clocks of a zone show, to the second. */
export interface WallClock {
  /** Astronomical: 0 = 1 BC. */
  year: number;
  /** 1–12. */
  month: number;
  day: number;
  /** 0–23. */
  hour: number;
  minute: number;
  second: number;
}

const DAY_MS = 86_400_000;
const wallFormats = new Map<string, Intl.DateTimeFormat>();
const nameFormats = new Map<string, Intl.DateTimeFormat>();
const cached = (cache: Map<string, Intl.DateTimeFormat>, timeZone: string, options: Intl.DateTimeFormatOptions) => {
  let format = cache.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { timeZone, ...options });
    cache.set(timeZone, format);
  }
  return format;
};

/**
 * The wall clock in the zone at the instant (§5.4): one `formatToParts` of a formatter cached per zone; a year of the
 * era BC becomes astronomical (1 − year); `h23` so that midnight is 0, not 24. Throws a RangeError for an unknown zone
 * or an instant outside ±MAX_EPOCH_MS.
 */
export const wallClock = (epochMs: number, timeZone: string): WallClock => {
  const fields: Partial<Record<Intl.DateTimeFormatPartTypes, string>> = {};
  const format = cached(wallFormats, timeZone, {
    hourCycle: 'h23',
    era: 'short',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  for (const part of format.formatToParts(Math.floor(epochMs))) fields[part.type] = part.value;
  const year = Number(fields.year);
  return {
    year: fields.era === 'BC' ? 1 - year : year,
    month: Number(fields.month),
    day: Number(fields.day),
    hour: Number(fields.hour) % 24,
    minute: Number(fields.minute),
    second: Number(fields.second),
  };
};

/** The wall clock written as UTC milliseconds (days_from_civil, so years 0–99 and the edges of the range work). */
export const wallClockAsUtcMs = (wall: WallClock): number =>
  daysFromCivil(wall.year, wall.month, wall.day) * DAY_MS + (wall.hour * 3600 + wall.minute * 60 + wall.second) * 1000;

/** The offset of the zone at the instant, in ms, whole seconds (§5.4): the wall clock as UTC minus the instant's second. */
export const zoneOffsetMs = (epochMs: number, timeZone: string): number =>
  wallClockAsUtcMs(wallClock(epochMs, timeZone)) - Math.floor(epochMs / 1000) * 1000;

/** "2023-11-14T23:13:20+01:00": `formatIsoUtc`'s fraction and years, the zone's offset (with seconds if it has them). */
export const formatIsoInZone = (epochNs: bigint, timeZone: string): string => {
  const [epochMs] = floorDiv(epochNs, 1_000_000n);
  const offset = zoneOffsetMs(Number(epochMs), timeZone);
  return `${formatIsoUtc(epochNs + BigInt(offset) * 1_000_000n).slice(0, -1)}${formatOffset(offset)}`;
};

/**
 * How a wall time in a zone maps to an instant (§5.5). `exact` — one instant; `gap` — that time never happened (the
 * clocks moved forward): the instant `shiftMs` later on the clocks, i.e. the wall time read with the offset before the
 * change; `overlap` — it happened twice (the clocks moved back): `epochMs` the earlier, `laterEpochMs` the later.
 */
export type WallResolution =
  | { kind: 'exact'; epochMs: number }
  | { kind: 'gap'; epochMs: number; shiftMs: number }
  | { kind: 'overlap'; epochMs: number; laterEpochMs: number; shiftMs: number };

const clampMs = (t: number): number => Math.max(-MAX_EPOCH_MS, Math.min(MAX_EPOCH_MS, t));

/**
 * The instant at which the zone's clocks show `localMs` (a wall time written as UTC milliseconds, whole ms) — §5.5, the
 * behaviour of Temporal's `disambiguation: 'compatible'` and of `new Date(y, m, d, …)`: the offsets a day before and
 * a day after give the candidates; one that fits is the answer, two are an overlap (the earlier first), none is a gap
 * (read with the offset before it, so the time moves forward by the gap's length). Null when the answer is outside
 * ±MAX_EPOCH_MS. A gap's instant is not the moment the clocks jump: a tool that needs that (cron) searches for it.
 */
export const wallTimeToEpochMs = (localMs: number, timeZone: string): WallResolution | null => {
  const before = zoneOffsetMs(clampMs(localMs - DAY_MS), timeZone);
  const after = zoneOffsetMs(clampMs(localMs + DAY_MS), timeZone);
  const fits = (c: number): boolean => Math.abs(c) <= MAX_EPOCH_MS && zoneOffsetMs(c, timeZone) === localMs - c;
  const found = [...new Set([localMs - before, localMs - after])].filter(fits).sort((a, b) => a - b);
  if (found.length === 2)
    return { kind: 'overlap', epochMs: found[0]!, laterEpochMs: found[1]!, shiftMs: found[1]! - found[0]! };
  if (found.length === 1) return { kind: 'exact', epochMs: found[0]! };
  const epochMs = localMs - before;
  return Math.abs(epochMs) > MAX_EPOCH_MS ? null : { kind: 'gap', epochMs, shiftMs: after - before };
};

/**
 * Old zone names ICU (and so V8 and Node) still reports, and their current names (the IANA `backward` file): a person
 * looks for Kolkata and Kyiv. Intl accepts both.
 */
export const LEGACY_ZONE_NAMES: Readonly<Record<string, string>> = {
  'Africa/Asmera': 'Africa/Asmara',
  'America/Buenos_Aires': 'America/Argentina/Buenos_Aires',
  'America/Catamarca': 'America/Argentina/Catamarca',
  'America/Cordoba': 'America/Argentina/Cordoba',
  'America/Jujuy': 'America/Argentina/Jujuy',
  'America/Mendoza': 'America/Argentina/Mendoza',
  'America/Coral_Harbour': 'America/Atikokan',
  'America/Godthab': 'America/Nuuk',
  'America/Indianapolis': 'America/Indiana/Indianapolis',
  'America/Louisville': 'America/Kentucky/Louisville',
  'Asia/Calcutta': 'Asia/Kolkata',
  'Asia/Katmandu': 'Asia/Kathmandu',
  'Asia/Rangoon': 'Asia/Yangon',
  'Asia/Saigon': 'Asia/Ho_Chi_Minh',
  'Atlantic/Faeroe': 'Atlantic/Faroe',
  'Europe/Kiev': 'Europe/Kyiv',
  'Pacific/Enderbury': 'Pacific/Kanton',
  'Pacific/Ponape': 'Pacific/Pohnpei',
  'Pacific/Truk': 'Pacific/Chuuk',
};

let zoneList: readonly string[] | undefined;
let zoneIndex: Map<string, string> | undefined;

/** "UTC" first, then `Intl.supportedValuesOf('timeZone')` through LEGACY_ZONE_NAMES, sorted by code units. */
export const timeZones = (): readonly string[] =>
  (zoneList ??= [
    'UTC',
    ...[...new Set(Intl.supportedValuesOf('timeZone').map(name => LEGACY_ZONE_NAMES[name] ?? name))]
      .filter(name => name !== 'UTC')
      .sort(),
  ]);

/** Does Intl know the zone (any case: "europe/berlin" too)? */
export const isTimeZone = (name: string): boolean => {
  if (name === '') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
};

/**
 * The name a zone is shown and kept under, or null when Intl does not know it: the listed name whatever the case
 * ("europe/berlin" → "Europe/Berlin", "Asia/Calcutta" → "Asia/Kolkata", "utc" → "UTC"); an alias that is not in the
 * list ("US/Eastern") as Intl resolves it, through LEGACY_ZONE_NAMES.
 */
export const resolveTimeZone = (name: string): string | null => {
  if (!isTimeZone(name)) return null;
  if (!zoneIndex) {
    zoneIndex = new Map(timeZones().map(zone => [zone.toLowerCase(), zone]));
    for (const [old, current] of Object.entries(LEGACY_ZONE_NAMES)) zoneIndex.set(old.toLowerCase(), current);
  }
  const listed = zoneIndex.get(name.toLowerCase());
  if (listed) return listed;
  const resolved = new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  return LEGACY_ZONE_NAMES[resolved] ?? resolved;
};

/** The machine's zone through LEGACY_ZONE_NAMES (Chrome in India reports Asia/Calcutta); "UTC" when unknown. */
export const browserTimeZone = (): string => {
  const name = new Intl.DateTimeFormat().resolvedOptions().timeZone;
  return (typeof name === 'string' && resolveTimeZone(name)) || 'UTC';
};

/** "Central European Standard Time" (en-US, long) at the instant; ICU writes "GMT+14:00" where it has no name. */
export const zoneLongName = (epochMs: number, timeZone: string): string =>
  cached(nameFormats, timeZone, { timeZoneName: 'long' })
    .formatToParts(Math.floor(epochMs))
    .find(part => part.type === 'timeZoneName')?.value ?? '';

/**
 * A row of a time zone picker (unix-time.md §8; cron.md §8): the name, its offset at the instant shown, and what else
 * finds it. Moved here from the Unix Time tool unchanged when Cron needed the same picker (2026-11-21).
 */
export interface ZoneOption {
  value: string;
  label: string;
  /** "UTC+05:30" at the instant. */
  hint: string;
  /** The old name of LEGACY_ZONE_NAMES and the English long name: "Asia/Calcutta India Standard Time". */
  keywords: string;
}

let oldNames: Map<string, string> | undefined;

/** Every zone of `timeZones()` for the picker, its offset and long name at the instant (computed when it opens). */
export const zoneOptions = (epochMs: number): ZoneOption[] => {
  oldNames ??= new Map(Object.entries(LEGACY_ZONE_NAMES).map(([old, current]) => [current, old]));
  return timeZones().map(zone => ({
    value: zone,
    label: zone,
    hint: `UTC${formatOffset(zoneOffsetMs(epochMs, zone))}`,
    keywords: [oldNames!.get(zone), zoneLongName(epochMs, zone)].filter(Boolean).join(' '),
  }));
};
