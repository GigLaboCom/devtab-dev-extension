/**
 * The next runs of an expression in a time zone (docs/tools/specs/cron.md §5.4, §5.5, §5.8, §5.9): day by day on the
 * zone's calendar, every time of a matching day as a wall time of that zone, and the daylight-saving rule of Vixie
 * cron. Everything about zones comes from the shared time module: `wallTimeToEpochMs` says whether a wall time is in a
 * gap or an overlap; what the job then does is decided here.
 *
 * - Gap (the clocks move forward): a job at a fixed time runs once, at the moment the clocks jump (`gapEndMs`); several
 *   of its times in one gap are one run, and a run that falls on a normal run of the job is that run. Other jobs skip
 *   the missing times.
 * - Overlap (the clocks move back): a job at a fixed time runs once, on the first pass; other jobs run on both passes,
 *   the second marked.
 */
import { dayMatches, monthLength } from './days';
import {
  civilFromDays,
  daysFromCivil,
  formatOffset,
  formatYear,
  wallClock,
  wallTimeToEpochMs,
  zoneOffsetMs,
} from '@workspace/tools-shared/time';
import type { ParsedCron } from './parse';

const SECOND_MS = 1000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;
const HORIZON_DAYS = 146_097;
/** Far enough before a local midnight and after the next one to be outside the day in every zone (−12 h … +14 h). */
const MARGIN_MS = 18 * HOUR_MS;

export interface Run {
  epochMs: number;
  kind: 'normal' | 'repeated' | 'after-gap';
}

const RANK: Record<Run['kind'], number> = { normal: 0, repeated: 1, 'after-gap': 2 };

const sorted = (set: ReadonlySet<number>): number[] => [...set].sort((a, b) => a - b);

/**
 * §5.5: the instant the clocks jump, for a wall time in a gap — the first second at which the zone's offset is already
 * the one after the gap. `epochMsAfterGap` is `wallTimeToEpochMs`'s answer (the wall time read with the offset before
 * the gap, so it lies after the jump); the search runs between `localMs − after` (before the jump) and it, by seconds.
 */
export const gapEndMs = (localMs: number, epochMsAfterGap: number, zone: string): number => {
  const after = zoneOffsetMs(epochMsAfterGap, zone);
  let lo = Math.floor((localMs - after) / SECOND_MS); // offset not yet `after`
  let hi = Math.floor(epochMsAfterGap / SECOND_MS); // offset `after`
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    if (zoneOffsetMs(mid * SECOND_MS, zone) === after) hi = mid;
    else lo = mid;
  }
  return hi * SECOND_MS;
};

/** The first second in (lo, hi] at which the zone's offset is no longer `before` — the moment its clocks change. */
const changeMs = (lo: number, hi: number, before: number, zone: string): number => {
  let a = Math.floor(lo / SECOND_MS); // offset `before`
  let b = Math.ceil(hi / SECOND_MS); // another offset
  while (b - a > 1) {
    const mid = Math.floor((a + b) / 2);
    if (zoneOffsetMs(mid * SECOND_MS, zone) === before) a = mid;
    else b = mid;
  }
  return b * SECOND_MS;
};

/** The last day the search may look at, as days since 1970-01-01; null when every year of the field is past. */
const lastDay = (cron: ParsedCron, today: number): number | null => {
  if (!cron.years) return today + HORIZON_DAYS;
  const last = Math.max(...cron.years);
  const end = daysFromCivil(last, 12, 31);
  return end < today ? null : end;
};

/**
 * §5.8: the runs strictly after `nowMs`, in order, without repeats, at most `count` — day by day from today's date in
 * the zone, up to 400 years ahead (or the last year of the year field).
 */
export const nextRuns = (cron: ParsedCron, nowMs: number, zone: string, count: number): Run[] => {
  if (count <= 0) return [];
  const start = wallClock(nowMs, zone);
  const today = daysFromCivil(start.year, start.month, start.day);
  const end = lastDay(cron, today);
  if (end === null) return [];
  const hours = sorted(cron.hours);
  const minutes = sorted(cron.minutes);
  const seconds = sorted(cron.seconds);
  // One run an instant (§5.8 item 4): the normal one stays, then the repeated one, then the one after a gap.
  const found = new Map<number, Run>();
  const add = (epochMs: number, kind: Run['kind']): void => {
    if (epochMs <= nowMs) return;
    const there = found.get(epochMs);
    if (!there || RANK[kind] < RANK[there.kind]) found.set(epochMs, { epochMs, kind });
  };

  // The count-th earliest instant found so far (Infinity until there are that many).
  let kth = Infinity;
  let kthOf = -1;
  const countth = (): number => {
    if (found.size < count) return Infinity;
    if (kthOf !== found.size) {
      kth = [...found.keys()].sort((a, b) => a - b)[count - 1]!;
      kthOf = found.size;
    }
    return kth;
  };

  const day = (localMidnight: number): void => {
    const before = zoneOffsetMs(localMidnight - MARGIN_MS, zone);
    const after = zoneOffsetMs(localMidnight + DAY_MS + MARGIN_MS, zone);
    // The wall times around a change of offset today (§5.8 item 3): a gap when the clocks move forward, an overlap when
    // they move back. Outside them every wall time is one instant, with the offset before the change or after it —
    // what wallTimeToEpochMs answers there; inside, wallTimeToEpochMs says gap or overlap and §5.5 decides.
    let lowWall = Infinity;
    let highWall = Infinity;
    if (before !== after) {
      const change = changeMs(localMidnight - MARGIN_MS, localMidnight + DAY_MS + MARGIN_MS, before, zone);
      lowWall = change + Math.min(before, after);
      highWall = change + Math.max(before, after);
    }
    let gapEnd: number | null | undefined; // the moment the clocks jumped, asked once a day (null: not a gap)
    for (const h of hours)
      for (const m of minutes)
        for (const s of seconds) {
          const local = localMidnight + (h * 3600 + m * 60 + s) * SECOND_MS;
          if (local < lowWall || local >= highWall) {
            const t = local - (local < lowWall ? before : after);
            if (t <= nowMs) continue;
            if (t > countth()) return; // later wall times are later instants: enough runs before them
            add(t, 'normal');
            continue;
          }
          const first = local - before;
          const second = local - after;
          if (Math.max(first, second) <= nowMs) continue; // every instant of this wall time is past
          if (Math.min(first, second) > countth()) return;
          if (before < after) {
            // A gap: only a job at a fixed time runs, once, when the clocks jump.
            if (!cron.fixedTime) continue;
            if (gapEnd === undefined) {
              const resolved = wallTimeToEpochMs(local, zone);
              gapEnd = resolved?.kind === 'gap' ? gapEndMs(local, resolved.epochMs, zone) : null;
            }
            if (gapEnd !== null) add(gapEnd, 'after-gap');
            continue;
          }
          // An overlap: the first pass, and the second unless the job is at a fixed time.
          if ((first > nowMs ? first : second) > countth()) continue;
          const resolved = wallTimeToEpochMs(local, zone);
          if (!resolved) continue;
          add(resolved.epochMs, 'normal');
          if (resolved.kind === 'overlap' && !cron.fixedTime) add(resolved.laterEpochMs, 'repeated');
        }
  };

  for (let n = today; n <= end;) {
    const { year, month, day: date } = civilFromDays(n);
    if ((cron.years && !cron.years.has(year)) || !cron.months.has(month)) {
      n += monthLength(year, month) - date + 1; // to the first of the next month
      continue;
    }
    if (dayMatches(cron, year, month, date)) {
      day(n * DAY_MS);
      // Enough runs, and the next day cannot hold an earlier one.
      if (found.size >= count && (n + 1) * DAY_MS - MARGIN_MS > countth()) break;
    }
    n++;
  }

  return [...found.values()].sort((a, b) => a.epochMs - b.epochMs).slice(0, count);
};

export type NoRuns =
  | { kind: 'past'; lastYear: number }
  | { kind: 'no-such-day'; day: number }
  | { kind: 'never-in-years'; years: number[] }
  | { kind: 'never' };

/**
 * §5.8 «Нет запусков», called when `nextRuns` returned nothing: every year of the field is past; or only the day of
 * month decides, without special values, and its smallest day is longer than every selected month (February: 29); or
 * no day matches: in the years of the year field, when there is one (only those were searched), or in the whole
 * horizon.
 */
export const whyNoRuns = (cron: ParsedCron, nowMs: number, zone: string): NoRuns => {
  if (cron.years) {
    const lastYear = Math.max(...cron.years);
    if (lastYear <= wallClock(nowMs, zone).year) return { kind: 'past', lastYear };
  }
  const onlyDom =
    cron.dayRule === 'dom' || (cron.dayRule === 'and' && cron.dow.kind === 'set' && cron.dow.days.size === 7);
  if (onlyDom && cron.dom.kind === 'set') {
    const day = Math.min(...cron.dom.days);
    const longest = Math.max(...[...cron.months].map(m => (m === 2 ? 29 : monthLength(2001, m))));
    if (day > longest) return { kind: 'no-such-day', day };
  }
  if (cron.years) {
    // The years still to come: only those were searched (a past one may well have had the day).
    const now = wallClock(nowMs, zone).year;
    return { kind: 'never-in-years', years: [...cron.years].filter(y => y >= now).sort((a, b) => a - b) };
  }
  return { kind: 'never' };
};

const two = (n: number): string => String(n).padStart(2, '0');
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/**
 * §5.9: "Fri 2026-11-20 09:00 UTC", "Sun 2027-03-28 03:00 +02:00" — the weekday, date and time on the zone's clocks
 * (seconds when asked for or when the run has any), then the offset, or `UTC` for the zone UTC.
 */
export const formatRunWhen = (epochMs: number, zone: string, withSeconds: boolean): string => {
  const w = wallClock(epochMs, zone);
  const weekdayName = WEEKDAYS[(((daysFromCivil(w.year, w.month, w.day) + 4) % 7) + 7) % 7];
  const time = `${two(w.hour)}:${two(w.minute)}${withSeconds || w.second !== 0 ? `:${two(w.second)}` : ''}`;
  const suffix = zone === 'UTC' ? 'UTC' : formatOffset(zoneOffsetMs(epochMs, zone));
  return `${weekdayName} ${formatYear(w.year)}-${two(w.month)}-${two(w.day)} ${time} ${suffix}`;
};
