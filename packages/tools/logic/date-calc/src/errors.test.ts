/** docs/tools/specs/date-calc.md §6 — every row, its text word for word — and the edges of §5.1–§5.4. */
import { addDuration, parseDuration, parseMoment } from './index';
import { describe, expect, it } from 'vitest';

const momentError = (text: string, zone = 'UTC'): string => {
  const r = parseMoment(text, zone);
  return r.ok ? `(read: ${r.empty ? 'empty' : r.readAs})` : r.message;
};
const momentNotes = (text: string, zone = 'UTC'): string[] => {
  const r = parseMoment(text, zone);
  if (!r.ok || r.empty) throw new Error(text);
  return [r.readAs, ...r.notes];
};
const durationError = (text: string): string => {
  const r = parseDuration(text);
  return r.ok ? `(read: ${r.empty ? 'empty' : r.readAs})` : r.message;
};

const RANGE = 'Out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.';
const NOT_MOMENT =
  'Not a moment this tool reads. Write 2024-03-31, 2024-03-31T14:30, 2024-03-31T14:30:00Z or a Unix timestamp such as 1711895400.';
const NOT_DURATION = 'Not a duration this tool reads. Write 1h30m, 90 min, 2 weeks, -3d or P3DT4H.';

describe('§6 moments', () => {
  it('empty and blank are nothing, not an error', () => {
    expect(parseMoment('', 'UTC')).toEqual({ ok: true, empty: true });
    expect(parseMoment('   ', 'UTC')).toEqual({ ok: true, empty: true });
    expect(parseDuration(' \t')).toEqual({ ok: true, empty: true });
  });

  it('too long', () => {
    expect(momentError('1'.repeat(201))).toBe('Too long for a moment (more than 200 characters).');
    expect(durationError('1h'.repeat(101))).toBe('Too long for a duration (more than 200 characters).');
  });

  it('timestamps: too many digits, a dropped fraction, the date and year hints', () => {
    expect(momentError('10000000000000000')).toBe(
      '17 digits: microseconds and nanoseconds are not read here. Unix Time reads them.',
    );
    expect(momentError('100000000000000')).toBe(
      '15 digits: microseconds and nanoseconds are not read here. Unix Time reads them.',
    );
    expect(momentNotes('1700000000.123456')).toEqual([
      'Read as Unix seconds (10 digits): 2023-11-14T22:13:20.123+00:00 (Tuesday).',
      'Digits finer than 1 millisecond were dropped.',
    ]);
    expect(momentNotes('1700000000.123000')).toHaveLength(1);
    expect(momentNotes('20240131')).toEqual([
      'Read as Unix seconds (8 digits): 1970-08-23T06:15:31+00:00 (Sunday).',
      'If this is a date (2024-01-31), write it with dashes.',
    ]);
    expect(momentNotes('2024')).toEqual([
      'Read as Unix seconds (4 digits): 1970-01-01T00:33:44+00:00 (Thursday).',
      'If this is a year, write 2024-01-01.',
    ]);
    // A fraction is floored: to the past, also before 1970.
    const r = parseMoment('-1.0005', 'UTC');
    expect(r.ok && !r.empty && r.moment.epochMs).toBe(-1001);
  });

  it('dates and times that do not exist, offsets out of range, year -000000', () => {
    expect(momentError('2023-02-29')).toBe('2023-02-29 is not a date: February 2023 has 28 days.');
    expect(momentError('2023-13-01')).toBe('Month 13 does not exist.');
    expect(momentError('2023-00-01')).toBe('Month 00 does not exist.');
    expect(momentError('2023-01-00')).toBe('Day 00 does not exist.');
    expect(momentError('2023-11-14T24:00')).toBe('Hours go from 00 to 23.');
    expect(momentError('2023-11-14T22:60')).toBe('Minutes go from 00 to 59.');
    expect(momentError('2023-11-14T22:13:61Z')).toBe('Seconds go from 00 to 59.');
    expect(momentError('2023-11-14T22:13:20+24:00')).toBe('Offset +24:00 is out of range: offsets go up to ±23:59.');
    expect(momentError('-000000-01-01')).toBe('Year -000000 is not allowed: write 0000.');
  });

  it('second 60 is the next second', () => {
    expect(momentNotes('2016-12-31T23:59:60Z')).toEqual([
      'Read as 2017-01-01T00:00:00+00:00 (Sunday).',
      'Second 60 (a leap second) has no Unix time of its own: read as the next second, as POSIX does.',
    ]);
  });

  it('brackets: unknown zone; an offset that does not match; Z and -00:00 never mismatch; u-ca skipped', () => {
    expect(momentError('2024-03-31T12:00[Mars/Base]')).toBe('Unknown time zone "Mars/Base".');
    expect(momentNotes('2024-03-31T12:00+05:30[Asia/Tokyo]')).toEqual([
      'Read as 2024-03-31T15:30:00+09:00 (Sunday).',
      'The zone in brackets is used: Asia/Tokyo.',
      'The offset +05:30 does not match Asia/Tokyo (+09:00) at that moment; the offset is used.',
    ]);
    expect(momentNotes('2024-03-31T12:00Z[Asia/Tokyo]', 'Asia/Tokyo')).toEqual([
      'Read as 2024-03-31T21:00:00+09:00 (Sunday).',
    ]);
    expect(momentNotes('2024-03-31T12:00-00:00[Asia/Tokyo]', 'Asia/Tokyo')).toHaveLength(1);
    expect(momentNotes('2024-03-31T12:00[u-ca=gregory][!asia/tokyo]')).toEqual([
      'Read as 2024-03-31T12:00:00+09:00 (Sunday).',
      'The zone in brackets is used: Asia/Tokyo.',
    ]);
    // Without an offset the time is read on the clocks of the zone in brackets.
    expect(momentNotes('2024-03-31T12:00[Asia/Calcutta]')[0]).toBe('Read as 2024-03-31T12:00:00+05:30 (Sunday).');
  });

  it('dates with / or . and everything else', () => {
    for (const t of ['01/02/2024', '31.01.2024', '2024/01/31'])
      expect(momentError(t), t).toBe('Dates with / or . are not read: write YYYY-MM-DD.');
    for (const t of [
      'yesterday',
      'Tue, 14 Nov 2023 22:13:20 GMT',
      '2024-W05-3',
      '20240131T120000Z',
      '١٧٠٠٠٠٠٠٠٠',
      '2024-03-31😀',
      '2024-03-31Z',
      '1.7e9',
      '2024-3-31',
    ])
      expect(momentError(t), t).toBe(NOT_MOMENT);
  });

  it('the edges of the range', () => {
    expect(momentError('+275760-09-13T00:00:00.001Z')).toBe(RANGE);
    expect(momentError('-271821-04-19T23:59:59Z')).toBe(RANGE);
    expect(momentNotes('+275760-09-13T00:00:00Z')[0]).toBe('Read as +275760-09-13T00:00:00+00:00 (Saturday).');
    expect(momentNotes('-271821-04-20T00:00:00Z')[0]).toBe('Read as -271821-04-20T00:00:00+00:00 (Tuesday).');
    const ny = parseMoment('-271821-04-20', 'America/New_York');
    expect(ny.ok && !ny.empty && new Date(ny.moment.epochMs).toISOString()).toBe('-271821-04-20T04:56:02.000Z');
    expect(momentError('+275760-09-13', 'America/New_York')).toBe(RANGE);
    // A timestamp cannot leave the range: 14 digits of milliseconds stay below 1e14, and 15 digits are refused.
    expect(momentError('99999999999999')).toBe(
      '(read: Read as Unix milliseconds (14 digits): 5138-11-16T09:46:39.999+00:00 (Wednesday).)',
    );
    expect(momentError('+999999-01-01')).toBe(RANGE);
  });
});

describe('§6 durations', () => {
  it('not a duration', () => {
    for (const t of ['1x', 'abc', '1h30', 'h', '1 h 30', '1hh', 'P1X']) expect(durationError(t), t).toBe(NOT_DURATION);
  });

  it('a unit twice, a sign inside, fractions', () => {
    expect(durationError('1h 2h')).toBe('Each unit can appear once: hours appear twice.');
    expect(durationError('1 hour 2 hrs')).toBe('Each unit can appear once: hours appear twice.');
    expect(durationError('1h -30m')).toBe('A sign goes only at the start: -1h30m.');
    expect(durationError('1h-30m')).toBe('A sign goes only at the start: -1h30m.');
    expect(durationError('1.5d')).toBe(
      'Years, months, weeks and days take whole numbers: write 1 day 12 hours, not 1.5 days.',
    );
    expect(durationError('0.0001s')).toBe('Finer than a millisecond: durations are counted in whole milliseconds.');
    expect(durationError('1.5ms')).toBe('Finer than a millisecond: durations are counted in whole milliseconds.');
  });

  it('ISO 8601 refusals', () => {
    expect(durationError('P')).toBe('An ISO 8601 duration needs at least one number: P3D, PT1H30M.');
    expect(durationError('PT')).toBe('An ISO 8601 duration needs at least one number: P3D, PT1H30M.');
    expect(durationError('P1DT')).toBe('An ISO 8601 duration needs at least one number: P3D, PT1H30M.');
    expect(durationError('P1H')).toBe('In an ISO 8601 duration, hours, minutes and seconds come after T: PT1H.');
    expect(durationError('P1S')).toBe('In an ISO 8601 duration, hours, minutes and seconds come after T: PT1H.');
    expect(durationError('P1D1Y')).toBe(
      'An ISO 8601 duration lists years, months, weeks, days, then T and hours, minutes, seconds, in this order.',
    );
    expect(durationError('PT1H1H')).toBe(
      'An ISO 8601 duration lists years, months, weeks, days, then T and hours, minutes, seconds, in this order.',
    );
    expect(durationError('PT1.5H30M')).toBe('Only the last number of an ISO 8601 duration may have a fraction.');
    expect(durationError('P1.5D')).toBe(
      'Years, months, weeks and days take whole numbers: write 1 day 12 hours, not 1.5 days.',
    );
    expect(durationError('PT0.0001S')).toBe('Finer than a millisecond: durations are counted in whole milliseconds.');
  });

  it('too large; out of range', () => {
    expect(durationError('10000000000000000000y')).toBe(
      'Too large: no moment plus this duration stays within -271821-04-20 to +275760-09-13 UTC.',
    );
    expect(durationError('PT20000000000000001S')).toMatch(/^Too large/);
    const start = parseMoment('+275760-09-13T00:00:00Z', 'UTC');
    const ms = parseDuration('1ms');
    if (!start.ok || start.empty || !ms.ok || ms.empty) throw new Error('setup');
    expect(addDuration(start.moment, ms.duration, 'add')).toEqual({
      ok: false,
      message:
        'The result is out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.',
    });
  });
});
