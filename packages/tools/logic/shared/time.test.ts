import {
  MAX_EPOCH_MS,
  MAX_EPOCH_NS,
  civilFromDays,
  daysFromCivil,
  formatIsoUtc,
  formatReadable,
  formatYear,
  relativeTime,
} from './time';
import { describe, expect, it } from 'vitest';

const ms = (n: number): bigint => BigInt(n) * 1_000_000n;
const MINUTE = 60_000;
const DAY = 86_400_000;

describe('daysFromCivil / civilFromDays', () => {
  it('day 0 is 1970-01-01; they agree with Date over the whole range and invert each other', () => {
    expect(daysFromCivil(1970, 1, 1)).toBe(0);
    expect(civilFromDays(0)).toEqual({ year: 1970, month: 1, day: 1 });
    for (const days of [-100_000_000, -719_528, -1, 1, 11_016, 19_675, 100_000_000, 2_932_896]) {
      const date = new Date(days * DAY);
      const civil = civilFromDays(days);
      if (Math.abs(days) <= 100_000_000)
        expect(civil).toEqual({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate() });
      expect(daysFromCivil(civil.year, civil.month, civil.day)).toBe(days);
    }
  });
});

describe('formatYear', () => {
  it('four digits inside 0000–9999, a sign and six outside', () => {
    expect([0, 1, 2024, 9999, 10_000, -1, -2, 10_889].map(formatYear)).toEqual([
      '0000',
      '0001',
      '2024',
      '9999',
      '+010000',
      '-000001',
      '-000002',
      '+010889',
    ]);
  });
});

describe('formatIsoUtc (the one rule for an ISO instant: the shortest exact fraction of 0, 3, 6 or 9 digits)', () => {
  it('whole seconds have no fraction', () => {
    expect(formatIsoUtc(ms(1_700_000_000_000))).toBe('2023-11-14T22:13:20Z');
    expect(formatIsoUtc(0n)).toBe('1970-01-01T00:00:00Z');
    // uuid.md §10 rows 12–14: v7 and v1/v6 times that fall on a whole second.
    expect(formatIsoUtc(ms(1_645_557_742_000))).toBe('2022-02-22T19:22:22Z');
  });

  it('milliseconds, microseconds, nanoseconds: 3, 6, 9 digits', () => {
    expect(formatIsoUtc(ms(1_469_922_850_259))).toBe('2016-07-30T23:54:10.259Z');
    expect(formatIsoUtc(ms(1_700_000_000_000) + 120_000n)).toBe('2023-11-14T22:13:20.000120Z');
    expect(formatIsoUtc(ms(1_700_000_000_000) + 100n)).toBe('2023-11-14T22:13:20.000000100Z');
  });

  it('before 1970 counts down from the next second', () => {
    expect(formatIsoUtc(-1n)).toBe('1969-12-31T23:59:59.999999999Z');
    expect(formatIsoUtc(ms(-1))).toBe('1969-12-31T23:59:59.999Z');
  });

  it('extended years outside 0000–9999, to the ends of a Date', () => {
    // uuid.md §6: the time of ULID 7ZZZZZZZZZZZZZZZZZZZZZZZZZ (2^48 − 1 ms).
    expect(formatIsoUtc(ms(2 ** 48 - 1))).toBe('+010889-08-02T05:31:50.655Z');
    expect(formatIsoUtc(MAX_EPOCH_NS)).toBe('+275760-09-13T00:00:00Z');
    expect(formatIsoUtc(-MAX_EPOCH_NS)).toBe('-271821-04-20T00:00:00Z');
    expect(formatIsoUtc(ms(-MAX_EPOCH_MS))).toBe(new Date(-MAX_EPOCH_MS).toISOString().replace('.000Z', 'Z'));
  });
});

describe('formatReadable', () => {
  it('dateStyle medium, timeStyle long, in the given zone and language', () => {
    expect(formatReadable(1_700_000_000_000, 'UTC', 'en-US')).toMatch(/^Nov 14, 2023, 10:13:20\sPM UTC$/u);
  });

  it('null before year 1 and outside the range of a Date', () => {
    expect(formatReadable(daysFromCivil(1, 1, 1) * DAY, 'UTC', 'en-US')).toMatch(/^Jan 1, 1, /);
    expect(formatReadable(daysFromCivil(0, 12, 31) * DAY, 'UTC', 'en-US')).toBeNull();
    expect(formatReadable(MAX_EPOCH_MS + 1, 'UTC', 'en-US')).toBeNull();
    expect(formatReadable(Number.NaN)).toBeNull();
  });
});

describe('relativeTime (jwt.md §5.6)', () => {
  const now = 1_700_000_000_000;
  it.each([
    [now, 'now'],
    [now + 999, 'now'],
    [now - 999, 'now'],
    [now + 1000, 'in 1 second'],
    [now - 59_999, '59 seconds ago'],
    [now + 30 * MINUTE, 'in 30 minutes'],
    [now - 3 * 60 * MINUTE, '3 hours ago'],
    [now + 29 * DAY, 'in 29 days'],
    [now + 30 * DAY, 'in 1 month'],
    [now - 300 * DAY, '10 months ago'],
    [now - 365 * DAY, '1 year ago'],
    [now + 273_915 * 365 * DAY, 'in 273,915 years'],
  ])('%i → %s', (t, expected) => {
    expect(relativeTime(t, now)).toBe(expected);
  });
});
