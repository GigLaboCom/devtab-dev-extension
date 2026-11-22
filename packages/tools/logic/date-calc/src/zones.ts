/**
 * One moment in many time zones (docs/tools/specs/date-calc.md §5.7): the local date and time, the offset, the English
 * long name, and whether daylight saving is in effect. Intl does not say the last one; it is read from the offsets:
 * above the lowest offset of the year (24 probes, the 1st and the 16th of every month at 00:00 UTC) is daylight saving.
 */
import { DAY_MS, isoIn, lengthWords, localMs, weekdayOfDay } from './clock';
import {
  MAX_EPOCH_MS,
  civilFromDays,
  daysFromCivil,
  formatOffset,
  formatYear,
  zoneLongName,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';

export const MAX_ZONES = 24;

export type Dst = { kind: 'dst'; saveMs: number } | { kind: 'standard' } | { kind: 'none'; year: number };

export interface ZoneRow {
  zone: string;
  /** "2024-03-31T19:30:00+09:00". */
  iso: string;
  weekday: string;
  /** "UTC+09:00". */
  offset: string;
  dst: Dst;
  /** "Japan Standard Time" (en-US, long); ICU writes "GMT+03:00" where it has no name. */
  longName: string;
}

const probes = new Map<string, number[]>();

/** The zone's offsets at 00:00 UTC on the 1st and the 16th of every month of the year (kept per zone and year). */
const yearProbes = (zone: string, year: number): number[] => {
  const key = `${zone} ${year}`;
  let found = probes.get(key);
  if (!found) {
    found = [];
    for (let month = 1; month <= 12; month++)
      for (const day of [1, 16]) {
        const t = Math.max(-MAX_EPOCH_MS, Math.min(MAX_EPOCH_MS, daysFromCivil(year, month, day) * DAY_MS));
        found.push(zoneOffsetMs(t, zone));
      }
    probes.set(key, found);
  }
  return found;
};

/** §5.7: daylight saving from the offsets of the year of the local date. */
export const dstAt = (epochMs: number, zone: string): Dst => {
  const offset = zoneOffsetMs(epochMs, zone);
  const { year } = civilFromDays(Math.floor((epochMs + offset) / DAY_MS));
  const year24 = yearProbes(zone, year);
  const lowest = Math.min(...year24);
  if (year24.every(o => o === offset)) return { kind: 'none', year };
  return offset > lowest ? { kind: 'dst', saveMs: offset - lowest } : { kind: 'standard' };
};

export const dstText = (dst: Dst): string =>
  dst.kind === 'dst'
    ? `Daylight saving time (+${lengthWords(dst.saveMs)})`
    : dst.kind === 'standard'
      ? 'Standard time'
      : `No daylight saving in ${formatYear(dst.year)}`;

export const zoneRow = (epochMs: number, zone: string): ZoneRow => ({
  zone,
  iso: isoIn(epochMs, zone),
  weekday: weekdayOfDay(Math.floor(localMs(epochMs, zone) / DAY_MS)),
  offset: `UTC${formatOffset(zoneOffsetMs(epochMs, zone))}`,
  dst: dstAt(epochMs, zone),
  longName: zoneLongName(epochMs, zone),
});

/** RFC 9557: "2024-03-31T19:30:00+09:00[Asia/Tokyo]" — what Copy all writes, one line per zone. */
export const rfc9557 = (epochMs: number, zone: string): string => `${isoIn(epochMs, zone)}[${zone}]`;
