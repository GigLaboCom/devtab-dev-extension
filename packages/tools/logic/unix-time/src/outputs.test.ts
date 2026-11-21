/**
 * docs/tools/specs/unix-time.md §10 «Строки результата» and the rows of «Числа» / «ISO» that name output rows, §5.6
 * and §5.7. `outputs` gets the zone and the language explicitly; «now» is 2026-11-20T12:00:00Z.
 */
import { outputs, nowText, zoneSummary } from './outputs';
import { parseInput } from './parse';
import { daysFromCivil, formatIsoUtc, formatReadable, timeZones } from '@workspace/tools-shared/time';
import { describe, expect, it } from 'vitest';
import type { UnitOption } from './parse';

const NOW = 1_795_176_000_000;
const DAY = 86_400_000;
const s = (seconds: number): bigint => BigInt(seconds) * 1_000_000_000n;
const ms = (millis: number): bigint => BigInt(millis) * 1_000_000n;
const at = (epochNs: bigint, zone = 'UTC', locale = 'en-US') => outputs(epochNs, zone, NOW, locale);
/** ICU writes a narrow no-break space before AM / PM; the specification a plain one. */
const plain = (text: string | null) => text?.replace(/\u202f/g, ' ') ?? null;

describe('§5.6: 1700000000 in Europe/Berlin — every row (§2.1, the first row of §10)', () => {
  it('all rows, in the order of the table', () => {
    const o = at(s(1_700_000_000), 'Europe/Berlin');
    expect({ ...o, readable: plain(o.readable) }).toEqual({
      seconds: '1700000000',
      milliseconds: '1700000000000',
      microseconds: '1700000000000000',
      nanoseconds: '1700000000000000000',
      isoUtc: '2023-11-14T22:13:20Z',
      isoZone: '2023-11-14T23:13:20+01:00',
      rfc2822: 'Tue, 14 Nov 2023 23:13:20 +0100',
      httpDate: 'Tue, 14 Nov 2023 22:13:20 GMT',
      readable: 'Nov 14, 2023, 11:13:20 PM GMT+1',
      dayOfWeek: 'Tuesday',
      dayOfYear: 318,
      isoWeekDate: '2023-W46-2',
      relative: '3 years ago',
    });
  });
});

describe('the output rows named in «Числа» and «ISO»', () => {
  it('0: Thursday, day 1, 1970-W01-4, RFC 2822 with +0000', () => {
    expect(at(0n)).toMatchObject({
      dayOfWeek: 'Thursday',
      dayOfYear: 1,
      isoWeekDate: '1970-W01-4',
      rfc2822: 'Thu, 01 Jan 1970 00:00:00 +0000',
    });
  });

  it('-1: Wednesday, day 365, 1970-W01-3, the HTTP date', () => {
    expect(at(s(-1))).toMatchObject({
      dayOfWeek: 'Wednesday',
      dayOfYear: 365,
      isoWeekDate: '1970-W01-3',
      httpDate: 'Wed, 31 Dec 1969 23:59:59 GMT',
    });
  });

  it('-1.5 s: integers are floored', () => {
    expect(at(-1_500_000_000n)).toMatchObject({
      seconds: '-2',
      milliseconds: '-1500',
      microseconds: '-1500000',
      nanoseconds: '-1500000000',
      isoUtc: '1969-12-31T23:59:58.500Z',
    });
  });

  it('-1 ns: every integer is -1', () => {
    expect(at(-1n)).toMatchObject({ seconds: '-1', milliseconds: '-1', microseconds: '-1', nanoseconds: '-1' });
  });

  it('-000001-01-01T00:00:00Z: Friday, day 1, -000002-W53-5; no RFC 2822, HTTP date or readable form', () => {
    expect(at(s(-62_198_755_200))).toMatchObject({
      isoUtc: '-000001-01-01T00:00:00Z',
      dayOfWeek: 'Friday',
      dayOfYear: 1,
      isoWeekDate: '-000002-W53-5',
      rfc2822: null,
      httpDate: null,
      readable: null,
    });
  });

  it('0000-01-01T00:00:00Z: Saturday, -000001-W52-6', () => {
    expect(at(s(-62_167_219_200))).toMatchObject({ dayOfWeek: 'Saturday', isoWeekDate: '-000001-W52-6' });
  });

  it('9007199254740993123 ns: milliseconds beyond 2^53 are exact', () => {
    expect(at(9_007_199_254_740_993_123n)).toMatchObject({
      milliseconds: '9007199254740',
      isoUtc: '2255-06-05T23:47:34.740993123Z',
    });
  });
});

describe('§10 «Строки результата»', () => {
  it('1700000000 s in America/New_York', () => {
    const o = at(s(1_700_000_000), 'America/New_York');
    expect(o.isoZone).toBe('2023-11-14T17:13:20-05:00');
    expect(o.rfc2822).toBe('Tue, 14 Nov 2023 17:13:20 -0500');
    expect(plain(o.readable)).toBe('Nov 14, 2023, 5:13:20 PM EST');
    expect(zoneSummary(s(1_700_000_000), 'America/New_York')).toBe('UTC-05:00 · Eastern Standard Time');
  });

  it('1700000000 s in Asia/Kolkata (a half-hour offset that crosses midnight)', () => {
    const o = at(s(1_700_000_000), 'Asia/Kolkata');
    expect(o).toMatchObject({
      isoZone: '2023-11-15T03:43:20+05:30',
      rfc2822: 'Wed, 15 Nov 2023 03:43:20 +0530',
      dayOfWeek: 'Wednesday',
      dayOfYear: 319,
      isoWeekDate: '2023-W46-3',
    });
    expect(zoneSummary(s(1_700_000_000), 'Asia/Kolkata')).toBe('UTC+05:30 · India Standard Time');
  });

  it('1700000000 s in Australia/Lord_Howe (southern summer)', () => {
    expect(at(s(1_700_000_000), 'Australia/Lord_Howe').isoZone).toBe('2023-11-15T09:13:20+11:00');
    expect(zoneSummary(s(1_700_000_000), 'Australia/Lord_Howe')).toBe('UTC+11:00 · Lord Howe Daylight Time');
  });

  it('1960-01-01T12:00:00Z in Africa/Monrovia: seconds in the offset, RFC 2822 in UTC', () => {
    const t = ms(Date.UTC(1960, 0, 1, 12));
    const o = at(t, 'Africa/Monrovia');
    expect(o.isoZone).toBe('1960-01-01T11:15:30-00:44:30');
    expect(o.rfc2822).toBe('Fri, 01 Jan 1960 12:00:00 +0000');
    expect(zoneSummary(t, 'Africa/Monrovia')).toBe('UTC-00:44:30 · GMT-00:44:30');
  });

  it('1850-01-01T00:00:00Z: no RFC 2822 or HTTP date; the readable form is there', () => {
    const o = at(ms(Date.UTC(1850, 0, 1)));
    expect(o.rfc2822).toBeNull();
    expect(o.httpDate).toBeNull();
    expect(plain(o.readable)).toBe('Jan 1, 1850, 12:00:00 AM UTC');
  });

  it.each([
    [daysFromCivil(2024, 12, 30), '2025-W01-1', 365],
    [daysFromCivil(2021, 1, 3), '2020-W53-7', 3],
    [daysFromCivil(2020, 12, 31), '2020-W53-4', 366],
    [daysFromCivil(2026, 12, 31), '2026-W53-4', 365],
  ])('ISO week of day %i: %s, day of year %i', (days, week, dayOfYear) => {
    expect(at(ms(days * DAY))).toMatchObject({ isoWeekDate: week, dayOfYear });
  });

  it('+8.64e15 ms in Pacific/Kiritimati', () => {
    const o = at(ms(8.64e15), 'Pacific/Kiritimati');
    expect(o.isoZone).toBe('+275760-09-13T14:00:00+14:00');
    expect(o.relative).toBe('in 273,915 years');
    expect(o.rfc2822).toBeNull();
  });

  it('−8.64e15 ms in America/New_York', () => {
    const o = at(ms(-8.64e15), 'America/New_York');
    expect(o.isoZone).toBe('-271821-04-19T19:03:58-04:56:02');
    expect(o.dayOfWeek).toBe('Monday');
    expect(o.readable).toBeNull();
    // ±hhmm cannot hold LMT's seconds: RFC 2822 falls back to UTC — and the year is out of its range anyway.
    expect(o.rfc2822).toBeNull();
  });

  it('formatReadable in four languages (ICU 77)', () => {
    const t = 1_700_000_000_000;
    expect(plain(formatReadable(t, 'Europe/Berlin', 'en-US'))).toBe('Nov 14, 2023, 11:13:20 PM GMT+1');
    expect(formatReadable(t, 'Europe/Berlin', 'en-GB')).toBe('14 Nov 2023, 23:13:20 CET');
    expect(formatReadable(t, 'Europe/Berlin', 'ru-RU')).toBe('14 нояб. 2023 г., 23:13:20 GMT+1');
    expect(formatReadable(t, 'Europe/Berlin', 'de-DE')).toBe('14.11.2023, 23:13:20 MEZ');
  });

  it.each([
    [0, 'now'],
    [999, 'now'],
    [-1000, '1 second ago'],
    [29 * DAY, 'in 29 days'],
    [30 * DAY, 'in 1 month'],
    [364 * DAY, 'in 12 months'],
    [-365 * DAY, '1 year ago'],
    [-1e12, '31 years ago'],
  ])('relativeTime, t − now = %i ms → %s', (delta, expected) => {
    expect(at(ms(NOW + delta)).relative).toBe(expected);
  });

  it('timeZones(): 419 names, UTC first, current names only', () => {
    const zones = timeZones();
    expect(zones.length).toBe(419);
    expect(zones[0]).toBe('UTC');
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Europe/Kyiv');
    expect(zones).not.toContain('Asia/Calcutta');
  });

  it.each([
    ['auto', '1795176000123', '2026-11-20T12:00:00.123Z'],
    ['ms', '1795176000123', '2026-11-20T12:00:00.123Z'],
    ['s', '1795176000', '2026-11-20T12:00:00Z'],
    ['us', '1795176000123000', '2026-11-20T12:00:00.123Z'],
    ['ns', '1795176000123000000', '2026-11-20T12:00:00.123Z'],
  ])('nowText(1795176000123, %s) = %s, read back with the same unit as %s', (unit, text, back) => {
    expect(nowText(1_795_176_000_123, unit as UnitOption)).toBe(text);
    const parsed = parseInput(text, { timeZone: 'UTC', unit: unit as UnitOption });
    expect(parsed.ok && !parsed.empty && formatIsoUtc(parsed.epochNs)).toBe(back);
  });
});

describe('§5.6 beyond the table', () => {
  it('the ISO row in UTC is the zone row with +00:00 (the component hides it for UTC)', () => {
    expect(at(s(1_700_000_000)).isoZone).toBe('2023-11-14T22:13:20+00:00');
    expect(zoneSummary(s(1_700_000_000), 'UTC')).toBe('UTC+00:00 · Coordinated Universal Time');
  });

  it('the calendar rows follow the zone: before and after 1970, around a change of the clocks', () => {
    // 2024-03-31T00:30Z is Sunday 01:30 in Berlin, 2024-03-30 20:30 in New York.
    const t = ms(Date.UTC(2024, 2, 31, 0, 30));
    expect(at(t, 'Europe/Berlin')).toMatchObject({ dayOfWeek: 'Sunday', dayOfYear: 91, isoWeekDate: '2024-W13-7' });
    expect(at(t, 'America/New_York')).toMatchObject({
      dayOfWeek: 'Saturday',
      dayOfYear: 90,
      isoWeekDate: '2024-W13-6',
    });
    expect(at(ms(Date.UTC(1969, 11, 31, 23)), 'Asia/Kathmandu')).toMatchObject({
      isoZone: '1970-01-01T04:30:00+05:30',
      dayOfWeek: 'Thursday',
      dayOfYear: 1,
    });
  });

  it('RFC 2822 and the HTTP date at the edges of 1900–9999', () => {
    expect(at(ms(Date.UTC(1900, 0, 1))).httpDate).toBe('Mon, 01 Jan 1900 00:00:00 GMT');
    expect(at(ms(Date.UTC(1899, 11, 31, 23, 59, 59))).httpDate).toBeNull();
    expect(at(ms(Date.UTC(9999, 11, 31, 23, 59, 59, 999))).httpDate).toBe('Fri, 31 Dec 9999 23:59:59 GMT');
    // In Tokyo it is already the year 10000: no RFC 2822 there, the HTTP date (UTC) still has one.
    const o = at(ms(Date.UTC(9999, 11, 31, 20)), 'Asia/Tokyo');
    expect(o.rfc2822).toBeNull();
    expect(o.httpDate).toBe('Fri, 31 Dec 9999 20:00:00 GMT');
  });

  it('the readable form follows the zone into the year 1 and before', () => {
    expect(at(ms(daysFromCivil(1, 1, 1) * DAY), 'America/New_York').readable).toBeNull();
    expect(at(ms(daysFromCivil(1, 1, 1) * DAY), 'Asia/Tokyo').readable).not.toBeNull();
  });
});
