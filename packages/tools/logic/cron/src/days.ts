/**
 * Which calendar days an expression selects (docs/tools/specs/cron.md §5.2, §5.3): the year, the month, the day of
 * month (with L, L-n, LW, nW) and the day of week (with nL, n#k), combined by the expression's day rule. Proleptic
 * Gregorian through the shared calendar; no Date, no zone — a day is a date on the zone's own calendar.
 */
import { daysFromCivil } from '@workspace/tools-shared/time';
import type { DomSpec, DowSpec, ParsedCron } from './parse';

const LENGTHS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

const isLeap = (year: number): boolean => (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;

export const monthLength = (year: number, month: number): number =>
  month === 2 && isLeap(year) ? 29 : LENGTHS[month - 1]!;

/** 0 = Sunday … 6 = Saturday (1970-01-01 was a Thursday). */
export const weekday = (year: number, month: number, day: number): number =>
  (((daysFromCivil(year, month, day) + 4) % 7) + 7) % 7;

/** LW: the last Monday-to-Friday of the month. */
const lastWeekday = (year: number, month: number): number => {
  const last = monthLength(year, month);
  const w = weekday(year, month, last);
  return w === 6 ? last - 1 : w === 0 ? last - 2 : last;
};

/**
 * nW: the weekday nearest the n-th, never leaving the month — Saturday → Friday (the 1st: Monday the 3rd), Sunday →
 * Monday (the last day: Friday); an n past the month's end is its last day.
 */
const nearestWeekday = (year: number, month: number, n: number): number => {
  const last = monthLength(year, month);
  const target = Math.min(n, last);
  const w = weekday(year, month, target);
  if (w === 6) return target === 1 ? 3 : target - 1;
  if (w === 0) return target === last ? target - 2 : target + 1;
  return target;
};

const domMatches = (dom: DomSpec, year: number, month: number, day: number): boolean => {
  switch (dom.kind) {
    case 'set':
      return dom.days.has(day);
    case 'last':
      return day === monthLength(year, month) - dom.offset;
    case 'lastWeekday':
      return day === lastWeekday(year, month);
    case 'nearestWeekday':
      return day === nearestWeekday(year, month, dom.day);
  }
};

const dowMatches = (dow: DowSpec, year: number, month: number, day: number): boolean => {
  const w = weekday(year, month, day);
  switch (dow.kind) {
    case 'set':
      return dow.days.has(w);
    case 'last':
      return w === dow.day && day + 7 > monthLength(year, month);
    case 'nth':
      return w === dow.day && Math.ceil(day / 7) === dow.n;
  }
};

/** §5.2, §5.3: does the expression run on this date (month 1–12)? */
export const dayMatches = (cron: ParsedCron, year: number, month: number, day: number): boolean => {
  if (cron.years && !cron.years.has(year)) return false;
  if (!cron.months.has(month)) return false;
  switch (cron.dayRule) {
    case 'dom':
      return domMatches(cron.dom, year, month, day);
    case 'dow':
      return dowMatches(cron.dow, year, month, day);
    case 'or':
      return domMatches(cron.dom, year, month, day) || dowMatches(cron.dow, year, month, day);
    case 'and':
      return domMatches(cron.dom, year, month, day) && dowMatches(cron.dow, year, month, day);
  }
};
