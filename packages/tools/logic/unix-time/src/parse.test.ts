/**
 * docs/tools/specs/unix-time.md §10 — every row of «Числа», «ISO 8601 / RFC 3339», «RFC 2822, HTTP, JavaScript»,
 * «Отказы» and «Переходы времени» is a test here (the row's input in the test name), plus the rules of §5 and §6 the
 * table does not show. Zones are always named; nothing depends on the machine's zone or language.
 */
import {
  DECIMAL_COMMA,
  EXPONENT,
  FINER_DROPPED,
  LEAP_SECOND,
  MAX_INPUT,
  NOT_READ,
  OUT_OF_RANGE,
  TOO_LONG,
  formatDuration,
  parseInput,
  unitByDigits,
} from './parse';
import { formatIsoInZone, formatIsoUtc } from '@workspace/tools-shared/time';
import { afterAll, describe, expect, it } from 'vitest';
import type { ParsedInput, UnitOption } from './parse';

type Instant = Extract<ParsedInput, { empty: false }>;

const parse = (text: string, timeZone = 'UTC', unit: UnitOption = 'auto'): ParsedInput =>
  parseInput(text, { timeZone, unit });
/** The instant, failing the test with the message when there is none. */
const read = (text: string, timeZone = 'UTC', unit: UnitOption = 'auto'): Instant => {
  const r = parse(text, timeZone, unit);
  if (!r.ok) throw new Error(`${text}: ${r.message}`);
  if (r.empty) throw new Error(`${text}: empty`);
  return r;
};
const seconds = (r: Instant): bigint => {
  const q = r.epochNs / 1_000_000_000n;
  return r.epochNs < 0n && q * 1_000_000_000n !== r.epochNs ? q - 1n : q;
};
const iso = (text: string, timeZone = 'UTC', unit: UnitOption = 'auto'): string =>
  formatIsoUtc(read(text, timeZone, unit).epochNs);
const error = (text: string, timeZone = 'UTC', unit: UnitOption = 'auto'): string => {
  const r = parse(text, timeZone, unit);
  if (r.ok) throw new Error(`${text}: no error`);
  return r.message;
};

describe('§10 «Числа»', () => {
  it('1700000000 (Europe/Berlin): seconds, the note', () => {
    const r = read('1700000000', 'Europe/Berlin');
    expect(r).toMatchObject({ source: 'number', unit: 's', notes: ['Read as seconds (10 digits).'] });
    expect(r.epochNs).toBe(1_700_000_000_000_000_000n);
  });

  it('1700000000000: milliseconds', () => {
    const r = read('1700000000000');
    expect(r.unit).toBe('ms');
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T22:13:20Z');
    expect(r.notes).toEqual(['Read as milliseconds (13 digits).']);
  });

  it('1700000000123456: microseconds', () => {
    const r = read('1700000000123456');
    expect(r.unit).toBe('us');
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T22:13:20.123456Z');
    expect(r.epochNs / 1_000_000n).toBe(1_700_000_000_123n);
  });

  it('1700000000123456789: nanoseconds, every digit', () => {
    const r = read('1700000000123456789');
    expect(r.unit).toBe('ns');
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T22:13:20.123456789Z');
    expect(seconds(r)).toBe(1_700_000_000n);
  });

  it('9007199254740993123: nanoseconds beyond 2^53', () => {
    const r = read('9007199254740993123');
    expect(r.unit).toBe('ns');
    expect(r.epochNs / 1_000_000n).toBe(9_007_199_254_740n);
    expect(formatIsoUtc(r.epochNs)).toBe('2255-06-05T23:47:34.740993123Z');
  });

  it.each([
    ['99999999999', 's', '5138-11-16T09:46:39Z'],
    ['100000000000', 'ms', '1973-03-03T09:46:40Z'],
    ['99999999999999', 'ms', '5138-11-16T09:46:39.999Z'],
    ['100000000000000', 'us', '1973-03-03T09:46:40Z'],
    ['99999999999999999', 'us', '5138-11-16T09:46:39.999999Z'],
    ['100000000000000000', 'ns', '1973-03-03T09:46:40Z'],
    ['99999999999999999999', 'ns', '5138-11-16T09:46:39.999999999Z'],
  ])('the boundary on a power of a thousand: %s → %s, %s', (text, unit, expected) => {
    const r = read(text);
    expect(r.unit).toBe(unit);
    expect(formatIsoUtc(r.epochNs)).toBe(expected);
  });

  it('100000000000000000000 (21 digits): too many', () => {
    expect(error('100000000000000000000')).toBe('Too many digits for a timestamp: 21. Nanoseconds have at most 20.');
  });

  it('0: the epoch, one digit', () => {
    const r = read('0');
    expect(formatIsoUtc(r.epochNs)).toBe('1970-01-01T00:00:00Z');
    expect(r.notes).toEqual(['Read as seconds (1 digit).']);
  });

  it('-1: a second before the epoch', () => {
    expect(iso('-1')).toBe('1969-12-31T23:59:59Z');
  });

  it('-1.5: floor, so the fraction stays positive', () => {
    const r = read('-1.5');
    expect(seconds(r)).toBe(-2n);
    expect(r.epochNs).toBe(-1_500_000_000n);
    expect(formatIsoUtc(r.epochNs)).toBe('1969-12-31T23:59:58.500Z');
  });

  it('-0.000000001: one nanosecond before', () => {
    const r = read('-0.000000001');
    expect(r.epochNs).toBe(-1n);
    expect(seconds(r)).toBe(-1n);
    expect(formatIsoUtc(r.epochNs)).toBe('1969-12-31T23:59:59.999999999Z');
  });

  it('-0: zero', () => {
    expect(read('-0').epochNs).toBe(0n);
  });

  it('1700000000.123: seconds with a fraction', () => {
    const r = read('1700000000.123');
    expect(r.unit).toBe('s');
    expect(r.epochNs / 1_000_000n).toBe(1_700_000_000_123n);
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T22:13:20.123Z');
  });

  it('1700000000.1234567891: digits beyond a nanosecond are dropped, with a note', () => {
    const r = read('1700000000.1234567891');
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T22:13:20.123456789Z');
    expect(r.notes).toEqual(['Read as seconds (10 digits).', FINER_DROPPED]);
  });

  it('1700000000123456789.5: nanoseconds have no fraction', () => {
    const r = read('1700000000123456789.5');
    expect(r.epochNs).toBe(1_700_000_000_123_456_789n);
    expect(r.notes).toEqual(['Read as nanoseconds (19 digits).', FINER_DROPPED]);
  });

  it('1700000000, Unit Milliseconds: no note', () => {
    const r = read('1700000000', 'UTC', 'ms');
    expect(formatIsoUtc(r.epochNs)).toBe('1970-01-20T16:13:20Z');
    expect(r.notes).toEqual([]);
    expect(r.unit).toBe('ms');
  });

  it('1700000000000, Unit Seconds: any number of digits within the range', () => {
    expect(iso('1700000000000', 'UTC', 's')).toBe('+055840-11-08T22:13:20Z');
  });

  it('8640000000000 / 8640000000001, Unit Seconds: the end of the range / beyond', () => {
    expect(iso('8640000000000', 'UTC', 's')).toBe('+275760-09-13T00:00:00Z');
    expect(error('8640000000001', 'UTC', 's')).toBe(OUT_OF_RANGE);
  });

  it('-8640000000000000, Unit Milliseconds: the start of the range', () => {
    expect(iso('-8640000000000000', 'UTC', 'ms')).toBe('-271821-04-20T00:00:00Z');
  });

  it('8640000000000000001, Unit Microseconds: beyond', () => {
    expect(error('8640000000000000001', 'UTC', 'us')).toBe(OUT_OF_RANGE);
  });

  it('20240131: seconds, and the hint about dashes', () => {
    const r = read('20240131');
    expect(formatIsoUtc(r.epochNs)).toBe('1970-08-23T06:15:31Z');
    expect(r.notes).toEqual(['Read as seconds (8 digits).', 'If this is a date (2024-01-31), write it with dashes.']);
  });

  it.each(['00001700000000', '+1700000000', ' "1700000000" ', "'1700000000'"])(
    '%j: leading zeros, a plus sign, quotes — still 10 digits',
    text => {
      const r = read(text);
      expect(seconds(r)).toBe(1_700_000_000n);
      expect(r.notes).toEqual(['Read as seconds (10 digits).']);
    },
  );

  it('1.7e9 / 1,700,000,000 / 1700000000,5: the errors of §6', () => {
    expect(error('1.7e9')).toBe(EXPONENT);
    expect(error('1,700,000,000')).toBe('Remove the digit separators: 1700000000.');
    expect(error('1700000000,5')).toBe(DECIMAL_COMMA);
  });
});

describe('§5.2 beyond the table', () => {
  it('unitByDigits', () => {
    expect([1, 11, 12, 14, 15, 17, 18, 20, 21, 0].map(unitByDigits)).toEqual([
      's',
      's',
      'ms',
      'ms',
      'us',
      'us',
      'ns',
      'ns',
      null,
      null,
    ]);
  });

  it('negative numbers take the unit by their magnitude', () => {
    const r = read('-1700000000000');
    expect(r.unit).toBe('ms');
    expect(formatIsoUtc(r.epochNs)).toBe('1916-02-18T01:46:40Z');
  });

  it('fractions are exact per unit: 6 digits for ms, 3 for µs; a zero tail drops nothing', () => {
    expect(read('1700000000123.456789').epochNs).toBe(1_700_000_000_123_456_789n);
    expect(read('1700000000123456.789').epochNs).toBe(1_700_000_000_123_456_789n);
    expect(read('1700000000.1234567890000').notes).toEqual(['Read as seconds (10 digits).']);
  });

  it('a chosen unit has no note and no digit limit, but a fraction finer than 1 ns still says so', () => {
    expect(read('100000000000000000000', 'UTC', 'ns').epochNs).toBe(100_000_000_000_000_000_000n);
    expect(read('1.0000000001', 'UTC', 's').notes).toEqual([FINER_DROPPED]);
  });

  it('eight digits that are not a date, or not in 1900–2099, get no hint', () => {
    expect(read('20230229').notes).toEqual(['Read as seconds (8 digits).']);
    expect(read('18991231').notes).toEqual(['Read as seconds (8 digits).']);
    expect(read('+20240131').notes).toEqual(['Read as seconds (8 digits).']);
  });

  it('the digit separators of §6 in all three forms, and the fraction kept', () => {
    expect(error('1 700 000 000')).toBe('Remove the digit separators: 1700000000.');
    expect(error('1_700_000_000')).toBe('Remove the digit separators: 1700000000.');
    expect(error('1,700,000,000.5')).toBe('Remove the digit separators: 1700000000.5.');
  });
});

describe('§10 «ISO 8601 / RFC 3339»', () => {
  it.each([
    '2023-11-14T22:13:20Z',
    '2023-11-14t22:13:20z',
    '2023-11-14 22:13:20Z',
    '2023-11-14T23:13:20+0100',
    '2023-11-14T22:13:20-00:00',
    '2023-11-14T23:13:20+01',
  ])('%s → 1700000000, no notes', text => {
    const r = read(text);
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(r.notes).toEqual([]);
    expect(r.source).toBe('date');
    expect(r.unit).toBeUndefined();
  });

  it('2023-11-14T23:13:20+01:00 in America/New_York: the offset decides', () => {
    const r = read('2023-11-14T23:13:20+01:00', 'America/New_York');
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(formatIsoInZone(r.epochNs, 'America/New_York')).toBe('2023-11-14T17:13:20-05:00');
  });

  it('2023-11-14T22:13:20.5Z / …20,123456Z: a fraction with a dot or a comma', () => {
    expect(read('2023-11-14T22:13:20.5Z').epochNs / 1_000_000n).toBe(1_700_000_000_500n);
    expect(iso('2023-11-14T22:13:20.5Z')).toBe('2023-11-14T22:13:20.500Z');
    expect(iso('2023-11-14T22:13:20,123456Z')).toBe('2023-11-14T22:13:20.123456Z');
  });

  it('2023-11-14T22:13:20 in Europe/Berlin: no offset — read in the zone, the note', () => {
    const r = read('2023-11-14T22:13:20', 'Europe/Berlin');
    expect(seconds(r)).toBe(1_699_996_400n);
    expect(r.notes).toEqual(['No offset in the text: read as Europe/Berlin time.']);
  });

  it('2023-11-14T22:13 in Asia/Kolkata: seconds are optional', () => {
    const r = read('2023-11-14T22:13', 'Asia/Kolkata');
    expect(seconds(r)).toBe(1_699_980_180n);
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T16:43:00Z');
  });

  it('2023-11-14 in America/New_York: midnight in the zone, not UTC', () => {
    const r = read('2023-11-14', 'America/New_York');
    expect(seconds(r)).toBe(1_699_938_000n);
    expect(formatIsoUtc(r.epochNs)).toBe('2023-11-14T05:00:00Z');
    expect(r.notes).toEqual(['No offset in the text: read as America/New_York time.']);
  });

  it('2023-11-14T22:13:20+05:30[Europe/Berlin]: the offset is used, with a note', () => {
    const r = read('2023-11-14T22:13:20+05:30[Europe/Berlin]');
    expect(seconds(r)).toBe(1_699_980_200n);
    expect(r.notes).toEqual([
      'The offset +05:30 does not match Europe/Berlin (+01:00) at that moment; the offset is used.',
    ]);
  });

  it.each([
    '2023-11-14T23:13:20+01:00[Europe/Berlin]',
    '2023-11-14T23:13:20+01:00[!Europe/Berlin]',
    '2023-11-14T22:13:20Z[Europe/Kyiv]',
    '2023-11-14T22:13:20Z[u-ca=gregory]',
    '2023-11-14T22:13:20Z[Europe/Kiev][u-ca=gregory]',
    '2023-11-14T22:13:20-00:00[Asia/Tokyo]',
  ])('%s → 1700000000, no notes', text => {
    const r = read(text);
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(r.notes).toEqual([]);
  });

  it('2023-11-14T22:13:20[Asia/Tokyo] / …[europe/berlin] in UTC: read in the zone of the brackets, no note', () => {
    const tokyo = read('2023-11-14T22:13:20[Asia/Tokyo]');
    expect(seconds(tokyo)).toBe(1_699_967_600n);
    expect(tokyo.notes).toEqual([]);
    const berlin = read('2023-11-14T22:13:20[europe/berlin]');
    expect(seconds(berlin)).toBe(1_699_996_400n);
    expect(berlin.notes).toEqual([]);
  });

  it('2023-11-14T22:13:20[Mars/Base]: unknown zone', () => {
    expect(error('2023-11-14T22:13:20[Mars/Base]')).toBe('Unknown time zone "Mars/Base".');
  });

  it('2023-02-29 / 2024-02-29', () => {
    expect(error('2023-02-29')).toBe('2023-02-29 is not a date: February 2023 has 28 days.');
    expect(seconds(read('2024-02-29'))).toBe(1_709_164_800n);
  });

  it('2023-13-01, …T24:00:00Z, …T22:60:00Z, …+24:00: the errors of §6', () => {
    expect(error('2023-13-01')).toBe('Month 13 does not exist.');
    expect(error('2023-11-14T24:00:00Z')).toBe('Hours go from 00 to 23.');
    expect(error('2023-11-14T22:60:00Z')).toBe('Minutes go from 00 to 59.');
    expect(error('2023-11-14T22:13:20+24:00')).toBe('Offset +24:00 is out of range: offsets go up to ±23:59.');
  });

  it('2016-12-31T23:59:60Z: the leap second is the next second', () => {
    const r = read('2016-12-31T23:59:60Z');
    expect(seconds(r)).toBe(1_483_228_800n);
    expect(formatIsoUtc(r.epochNs)).toBe('2017-01-01T00:00:00Z');
    expect(r.notes).toEqual([LEAP_SECOND]);
  });

  it('+275760-09-13T00:00:00Z / ….001Z', () => {
    expect(seconds(read('+275760-09-13T00:00:00Z'))).toBe(8_640_000_000_000n);
    expect(error('+275760-09-13T00:00:00.001Z')).toBe(OUT_OF_RANGE);
  });

  it('-271821-04-20T00:00:00Z: the start of the range', () => {
    expect(seconds(read('-271821-04-20T00:00:00Z'))).toBe(-8_640_000_000_000n);
    expect(error('-271821-04-19T23:59:59.999999999Z')).toBe(OUT_OF_RANGE);
  });

  it('-000001-01-01T00:00:00Z: 2 BC', () => {
    expect(seconds(read('-000001-01-01T00:00:00Z'))).toBe(-62_198_755_200n);
  });

  it('0000-01-01T00:00:00Z: 1 BC', () => {
    expect(seconds(read('0000-01-01T00:00:00Z'))).toBe(-62_167_219_200n);
  });

  it('0099-06-15T00:00:00Z: the year 99, not 1999', () => {
    expect(seconds(read('0099-06-15T00:00:00Z'))).toBe(-59_028_739_200n);
  });

  it('-000000-01-01: not allowed', () => {
    expect(error('-000000-01-01')).toBe('Year -000000 is not allowed: write 0000.');
  });
});

describe('§5.3 ISO beyond the table', () => {
  it('any length of fraction, the first 9 digits count', () => {
    expect(iso('2023-11-14T22:13:20.1234567891234Z')).toBe('2023-11-14T22:13:20.123456789Z');
  });

  it('the day is checked against its month and leap years', () => {
    expect(error('2023-04-31')).toBe('2023-04-31 is not a date: April 2023 has 30 days.');
    expect(error('1900-02-29')).toBe('1900-02-29 is not a date: February 1900 has 28 days.');
    expect(seconds(read('2000-02-29T00:00Z'))).toBe(951_782_400n);
  });

  it('seconds 61 and minutes of the offset', () => {
    expect(error('2023-11-14T22:13:61Z')).toBe('Seconds go from 00 to 59.');
    expect(error('2023-11-14T22:13:20+05:60')).toBe('Offset +05:60 is out of range: offsets go up to ±23:59.');
  });

  it('a date with brackets and no time is midnight in that zone', () => {
    expect(formatIsoUtc(read('2023-11-14[Asia/Tokyo]', 'Europe/Berlin').epochNs)).toBe('2023-11-13T15:00:00Z');
  });

  it('the basic format, week and ordinal dates are not read', () => {
    expect(error('20240131T120000Z')).toBe('Write the date and time with dashes and colons: 2024-01-31T….');
    expect(error('2024-W05-3')).toBe(NOT_READ);
    expect(error('2024-031')).toBe(NOT_READ);
  });
});

describe('§10 «RFC 2822, HTTP, JavaScript»', () => {
  it.each([
    'Tue, 14 Nov 2023 22:13:20 GMT',
    'Tue, 14 Nov 2023 23:13:20 +0100',
    'Tue, 14 Nov 23 22:13:20 +0000',
    'Tue, 14 Nov 2023 22:13:20 +0000 (UTC)',
    'tue, 14 nov 2023 22:13:20 gmt',
    '14 Nov 2023 22:13:20 UT',
    'Tue, 14 Nov 2023 22:13:20 Z',
  ])('%s → 1700000000, no notes', text => {
    const r = read(text, 'Europe/Berlin');
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(r.notes).toEqual([]);
  });

  it('Tue Nov 14 2023 23:13:20 GMT+0100 (Central European Standard Time)', () => {
    const r = read('Tue Nov 14 2023 23:13:20 GMT+0100 (Central European Standard Time)', 'Asia/Tokyo');
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(r.notes).toEqual([]);
  });

  it('14 Nov 2023 17:13 EST: no weekday, no seconds, a US zone', () => {
    expect(seconds(read('14 Nov 2023 17:13 EST'))).toBe(1_699_999_980n);
  });

  it('Mon, 14 Nov 2023 22:13:20 +0000: the wrong weekday is a note, not an error', () => {
    const r = read('Mon, 14 Nov 2023 22:13:20 +0000');
    expect(seconds(r)).toBe(1_700_000_000n);
    expect(r.notes).toEqual(['The text says Mon, but 2023-11-14 is a Tuesday.']);
  });

  it('Sunday, 06-Nov-94 08:49:37 GMT (RFC 850)', () => {
    expect(seconds(read('Sunday, 06-Nov-94 08:49:37 GMT'))).toBe(784_111_777n);
  });

  it('Sun Nov  6 08:49:37 1994 (asctime) in UTC / in Europe/Berlin', () => {
    const utc = read('Sun Nov  6 08:49:37 1994');
    expect(seconds(utc)).toBe(784_111_777n);
    expect(utc.notes).toEqual(['No offset in the text: read as UTC time.']);
    const berlin = read('Sun Nov  6 08:49:37 1994', 'Europe/Berlin');
    expect(seconds(berlin)).toBe(784_108_177n);
    expect(berlin.notes).toEqual(['No offset in the text: read as Europe/Berlin time.']);
  });
});

describe('§5.3 mail forms beyond the table', () => {
  it('two- and three-digit years (RFC 5322 §4.3)', () => {
    expect(iso('14 Nov 49 00:00 GMT')).toBe('2049-11-14T00:00:00Z');
    expect(iso('14 Nov 50 00:00 GMT')).toBe('1950-11-14T00:00:00Z');
    expect(iso('14 Nov 123 00:00 GMT')).toBe('2023-11-14T00:00:00Z');
  });

  it('every named zone of RFC 5322 §4.3; the other military letters are not read', () => {
    const at = (zone: string) => Number(seconds(read(`14 Nov 2023 12:00 ${zone}`)) - 1_699_963_200n) / 3600;
    expect(['UT', 'GMT', 'Z', 'EST', 'EDT', 'CST', 'CDT', 'MST', 'MDT', 'PST', 'PDT'].map(at)).toEqual([
      0, 0, 0, 5, 4, 6, 5, 7, 6, 8, 7,
    ]);
    expect(error('14 Nov 2023 12:00 A')).toBe(NOT_READ);
    expect(error('14 Nov 2023 12:00 CET')).toBe(NOT_READ);
  });

  it('an offset out of range and an impossible date', () => {
    expect(error('Tue, 14 Nov 2023 22:13:20 +0175')).toBe('Offset +0175 is out of range.');
    expect(error('Tue, 31 Nov 2023 22:13:20 GMT')).toBe('2023-11-31 is not a date: November 2023 has 30 days.');
  });

  it('a wrong weekday in RFC 850 and asctime too', () => {
    expect(read('Monday, 06-Nov-94 08:49:37 GMT').notes).toEqual(['The text says Monday, but 1994-11-06 is a Sunday.']);
    expect(read('Mon Nov  6 08:49:37 1994').notes).toEqual([
      'No offset in the text: read as UTC time.',
      'The text says Mon, but 1994-11-06 is a Sunday.',
    ]);
  });

  it('a leap second in an e-mail date', () => {
    const r = read('Sat, 31 Dec 2016 23:59:60 +0000');
    expect(formatIsoUtc(r.epochNs)).toBe('2017-01-01T00:00:00Z');
    expect(r.notes).toEqual([LEAP_SECOND]);
  });

  it('Date.prototype.toString() with an extended year', () => {
    expect(iso('Fri Jan 01 -000001 00:00:00 GMT+0000 (Coordinated Universal Time)')).toBe('-000001-01-01T00:00:00Z');
  });
});

describe('§10 «Отказы»', () => {
  it('01/02/2024: ambiguous', () => {
    expect(error('01/02/2024')).toBe(
      '01/02/2024 is ambiguous: January 2 or February 1. Write 2024-01-02 or 2024-02-01.',
    );
  });

  it.each(['13/01/2024', '01/13/2024'])('%s: one reading only', text => {
    expect(error(text)).toBe(
      'Dates with / or . are not read, the order of day and month differs between countries. Write 2024-01-13.',
    );
  });

  it('31.01.2024 / 2024/01/31', () => {
    expect(error('31.01.2024')).toBe(
      'Dates with / or . are not read, the order of day and month differs between countries. Write 2024-01-31.',
    );
    expect(error('2024/01/31')).toBe('Write the date with dashes: 2024-01-31.');
  });

  it('20240131T120000Z: the basic format', () => {
    expect(error('20240131T120000Z')).toBe('Write the date and time with dashes and colons: 2024-01-31T….');
  });

  it.each(['yesterday', '2024-01-31T10', '١٧٠٠٠٠٠٠٠٠', '1700000000😀', 'now', '+1d', '0x6553f100'])(
    '%s: the general text',
    text => {
      expect(error(text)).toBe(NOT_READ);
    },
  );

  it('"" / "   ": empty', () => {
    expect(parse('')).toEqual({ ok: true, empty: true });
    expect(parse('   ')).toEqual({ ok: true, empty: true });
    expect(parse(' "" ')).toEqual({ ok: true, empty: true });
  });

  it('201 × x: too long; 200 is not', () => {
    expect(error('x'.repeat(201))).toBe(TOO_LONG);
    expect(error(`  ${'1'.repeat(MAX_INPUT)}  `)).toBe(
      'Too many digits for a timestamp: 200. Nanoseconds have at most 20.',
    );
  });

  it('the rest of §6 word for word', () => {
    expect(error('1 700 000 000')).toBe('Remove the digit separators: 1700000000.');
    expect(error('1_700_000_000')).toBe('Remove the digit separators: 1700000000.');
    expect(error('2023-11-14T22:13:61Z')).toBe('Seconds go from 00 to 59.');
    expect(error('Tue, 14 Nov 2023 22:13:20 +0175')).toBe('Offset +0175 is out of range.');
    expect(error('01/01/2024')).toBe(
      'Dates with / or . are not read, the order of day and month differs between countries. Write 2024-01-01.',
    );
    expect(error('01/02/24')).toBe('01/02/24 is ambiguous: January 2 or February 1. Write YYYY-01-02 or YYYY-02-01.');
    expect(error('40/40/2024')).toBe('Dates with / or . are not read. Write the date as YYYY-MM-DD.');
    expect(error('2024.1.31')).toBe('Write the date with dashes: 2024-01-31.');
    expect(error('Jan 31, 2024')).toBe(NOT_READ);
  });

  it('long input of every shape returns at once (bounded patterns)', () => {
    const shapes = [
      '1'.repeat(300_000),
      `2023-11-14T22:13:20.${'1'.repeat(300_000)}Z`,
      `2023-11-14T22:13:20Z${'['.repeat(300_000)}`,
      `${'1,'.repeat(150_000)}1`,
      `Tue, 14 Nov 2023 22:13:20 GMT (${'('.repeat(300_000)}`,
      `${'1 '.repeat(100)}`,
      `2023-11-14T22:13:20.${'1'.repeat(170)}Z`,
    ];
    const start = performance.now();
    for (const text of shapes) parse(text, 'Europe/Berlin');
    expect(performance.now() - start).toBeLessThan(500);
  });
});

describe('§10 «Переходы времени» (no offset in the text; the zone in the row)', () => {
  const gapNote = (at: string, zone: string, on: string, by: string, showing: string) =>
    `${at} does not exist in ${zone} on ${on}: the clocks moved forward by ${by}. Showing ${showing}.`;
  const overlapNote = (at: string, zone: string, on: string, by: string, first: string, second: string) =>
    `${at} happens twice in ${zone} on ${on}: the clocks moved back by ${by}. Showing the first (${first}); the second is ${second}.`;
  const noOffset = (zone: string) => `No offset in the text: read as ${zone} time.`;

  it.each([
    ['2024-03-31T01:59:59', 'Europe/Berlin', 1_711_846_799n, '2024-03-31T01:59:59+01:00'],
    ['2024-03-31T03:00', 'Europe/Berlin', 1_711_846_800n, '2024-03-31T03:00:00+02:00'],
    ['2024-10-27T01:59:59', 'Europe/Berlin', 1_729_987_199n, '2024-10-27T01:59:59+02:00'],
    ['2024-10-27T03:00', 'Europe/Berlin', 1_729_994_400n, '2024-10-27T03:00:00+01:00'],
    ['2024-04-07T02:00', 'Australia/Lord_Howe', 1_712_417_400n, '2024-04-07T02:00:00+10:30'],
    ['2011-12-29T23:59:59', 'Pacific/Apia', 1_325_239_199n, '2011-12-29T23:59:59-10:00'],
    ['2011-12-31T00:00', 'Pacific/Apia', 1_325_239_200n, '2011-12-31T00:00:00+14:00'],
    ['2024-06-01T12:00', 'Asia/Kathmandu', 1_717_222_500n, '2024-06-01T12:00:00+05:45'],
    ['1960-01-01T12:00', 'Africa/Monrovia', -315_573_330n, '1960-01-01T12:00:00-00:44:30'],
  ])('%s in %s → %i, no note about a change', (text, zone, s, shown) => {
    const r = read(text, zone);
    expect(seconds(r)).toBe(s);
    expect(formatIsoInZone(r.epochNs, zone)).toBe(shown);
    expect(r.notes).toEqual([noOffset(zone)]);
  });

  it.each([
    ['2024-03-31T02:00', 'Europe/Berlin', 1_711_846_800n, '02:00', '2024-03-31', '1 hour', '2024-03-31T03:00:00+02:00'],
    ['2024-03-31T02:30', 'Europe/Berlin', 1_711_848_600n, '02:30', '2024-03-31', '1 hour', '2024-03-31T03:30:00+02:00'],
    [
      '2024-03-10T02:30',
      'America/New_York',
      1_710_055_800n,
      '02:30',
      '2024-03-10',
      '1 hour',
      '2024-03-10T03:30:00-04:00',
    ],
    [
      '2024-10-06T02:15',
      'Australia/Lord_Howe',
      1_728_143_100n,
      '02:15',
      '2024-10-06',
      '30 minutes',
      '2024-10-06T02:45:00+11:00',
    ],
    [
      '2011-12-30T12:00',
      'Pacific/Apia',
      1_325_282_400n,
      '12:00',
      '2011-12-30',
      '24 hours',
      '2011-12-31T12:00:00+14:00',
    ],
    ['2018-11-04', 'America/Sao_Paulo', 1_541_300_400n, '00:00', '2018-11-04', '1 hour', '2018-11-04T01:00:00-02:00'],
    [
      '2024-09-29T02:50',
      'Pacific/Chatham',
      1_727_532_300n,
      '02:50',
      '2024-09-29',
      '1 hour',
      '2024-09-29T03:50:00+13:45',
    ],
    [
      '1972-01-07T00:20',
      'Africa/Monrovia',
      63_594_270n,
      '00:20',
      '1972-01-07',
      '44 minutes 30 seconds',
      '1972-01-07T01:04:30+00:00',
    ],
  ])('gap: %s in %s → %i, the note of §5.5', (text, zone, s, at, on, by, showing) => {
    const r = read(text, zone);
    expect(seconds(r)).toBe(s);
    expect(r.notes).toEqual([noOffset(zone), gapNote(at, zone, on, by, showing)]);
  });

  it('2024-03-31T02:30 in Europe/Berlin: the note word for word (§2.6)', () => {
    expect(read('2024-03-31T02:30', 'Europe/Berlin').notes[1]).toBe(
      '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. Showing 2024-03-31T03:30:00+02:00.',
    );
  });

  it.each([
    [
      '2024-10-27T02:00',
      'Europe/Berlin',
      1_729_987_200n,
      '02:00',
      '2024-10-27',
      '1 hour',
      '+02:00',
      '2024-10-27T02:00:00+01:00',
    ],
    [
      '2024-10-27T02:30',
      'Europe/Berlin',
      1_729_989_000n,
      '02:30',
      '2024-10-27',
      '1 hour',
      '+02:00',
      '2024-10-27T02:30:00+01:00',
    ],
    [
      '2024-11-03T01:30',
      'America/New_York',
      1_730_611_800n,
      '01:30',
      '2024-11-03',
      '1 hour',
      '-04:00',
      '2024-11-03T01:30:00-05:00',
    ],
    [
      '2024-04-07T01:45',
      'Australia/Lord_Howe',
      1_712_414_700n,
      '01:45',
      '2024-04-07',
      '30 minutes',
      '+11:00',
      '2024-04-07T01:45:00+10:30',
    ],
  ])('overlap: %s in %s → %i (the earlier), the second in the note', (text, zone, s, at, on, by, first, second) => {
    const r = read(text, zone);
    expect(seconds(r)).toBe(s);
    expect(r.notes).toEqual([noOffset(zone), overlapNote(at, zone, on, by, first, second)]);
  });

  it('2024-10-27T02:30 in Europe/Berlin: the note word for word; an explicit offset picks the second', () => {
    expect(read('2024-10-27T02:30', 'Europe/Berlin').notes[1]).toBe(
      '02:30 happens twice in Europe/Berlin on 2024-10-27: the clocks moved back by 1 hour. Showing the first (+02:00); the second is 2024-10-27T02:30:00+01:00.',
    );
    const second = read('2024-10-27T02:30+01:00', 'Europe/Berlin');
    expect(seconds(second)).toBe(1_729_992_600n);
    expect(second.notes).toEqual([]);
  });

  it('a fraction is kept through a gap and an overlap; the zone of the brackets names the note', () => {
    const gap = read('2024-03-31T02:30:00.123456789[Europe/Berlin]');
    expect(formatIsoInZone(gap.epochNs, 'Europe/Berlin')).toBe('2024-03-31T03:30:00.123456789+02:00');
    expect(gap.notes).toEqual([
      '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. Showing 2024-03-31T03:30:00.123456789+02:00.',
    ]);
    const overlap = read('2024-10-27T02:30:00.5', 'Europe/Berlin');
    expect(overlap.notes[1]).toContain('the second is 2024-10-27T02:30:00.500+01:00.');
  });

  it('asctime in a gap', () => {
    const r = read('Sun Mar 31 02:30:00 2024', 'Europe/Berlin');
    expect(seconds(r)).toBe(1_711_848_600n);
    expect(r.notes[1]).toContain('does not exist in Europe/Berlin');
  });
});

describe('whatever the machine’s zone (Node and Chrome give the same answers)', () => {
  const original = process.env.TZ;
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(['UTC', 'Asia/Kolkata', 'Australia/Lord_Howe', 'America/Sao_Paulo', 'Pacific/Chatham', 'Europe/Berlin'])(
    'machine zone %s',
    machine => {
      process.env.TZ = machine;
      expect(seconds(read('2023-11-14'))).toBe(1_699_920_000n);
      expect(seconds(read('2023-11-14T22:13:20', 'America/New_York'))).toBe(1_700_018_000n);
      expect(read('2024-03-31T02:30', 'Europe/Berlin').notes[1]).toContain('Showing 2024-03-31T03:30:00+02:00.');
      expect(seconds(read('Sun Nov  6 08:49:37 1994'))).toBe(784_111_777n);
      expect(seconds(read('1960-01-01T12:00', 'Africa/Monrovia'))).toBe(-315_573_330n);
      expect(iso('-1.5')).toBe('1969-12-31T23:59:58.500Z');
    },
  );
});

describe('formatDuration', () => {
  it('hours, minutes, seconds — only the non-zero ones', () => {
    expect([3_600_000, 1_800_000, 2_670_000, 86_400_000, 5_400_000, 1000].map(formatDuration)).toEqual([
      '1 hour',
      '30 minutes',
      '44 minutes 30 seconds',
      '24 hours',
      '1 hour 30 minutes',
      '1 second',
    ]);
  });
});
