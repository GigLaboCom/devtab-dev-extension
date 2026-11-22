/**
 * docs/tools/specs/date-calc.md §10 — every row a test with the specification's expected value — and the rules of §5 and
 * §6 the table does not reach. Every case names its zone; nothing depends on the machine's zone (the block at the end
 * repeats answers under other `TZ` values).
 */
import {
  addDuration,
  clockChanges,
  detectDateCalc,
  difference,
  dstText,
  formatCalendar,
  formatExact,
  handOver,
  isoCalendar,
  isoDuration,
  isoExact,
  nowText,
  parseDuration,
  parseMoment,
  rfc9557,
  total,
  zoneRow,
} from './index';
import { describe, expect, it } from 'vitest';
import type { Duration, Moment, Operation } from './index';

const moment = (text: string, zone = 'UTC'): Moment => {
  const r = parseMoment(text, zone);
  if (!r.ok || r.empty) throw new Error(`not a moment: ${text} (${r.ok ? 'empty' : r.message})`);
  return r.moment;
};
const duration = (text: string): Duration => {
  const r = parseDuration(text);
  if (!r.ok || r.empty) throw new Error(`not a duration: ${text} (${r.ok ? 'empty' : r.message})`);
  return r.duration;
};
const iso = (epochMs: number, zone: string): string => zoneRow(epochMs, zone).iso;
const add = (start: string, zone: string, op: Operation, d: string) => {
  const s = moment(start, zone);
  const r = addDuration(s, duration(d), op);
  if (!r.ok) return { error: r.message };
  return { iso: iso(r.epochMs, s.zone), elapsed: formatExact(r.elapsedMs), notes: r.notes, epochMs: r.epochMs };
};
const diff = (from: string, to: string, zone = 'UTC', toZone = zone) => {
  const r = difference(moment(from, zone), moment(to, toZone));
  return {
    calendar: formatCalendar(r.calendar),
    days: formatCalendar({ years: 0, months: 0, days: r.calendarDays.days, timeMs: r.calendarDays.timeMs }),
    exact: formatExact(r.exactMs),
    isoCalendar: isoCalendar(r.calendar),
    isoExact: isoExact(r.exactMs),
    total: (unit: Parameters<typeof total>[1]) => total(r.exactMs, unit).text,
    notes: r.notes,
    r,
  };
};

describe('§10 Add and subtract', () => {
  it('January 31 + 1 month is the last day of February, said in a note (Temporal)', () => {
    const r = add('2024-01-31', 'UTC', 'add', 'P1M');
    expect(r.iso).toBe('2024-02-29T00:00:00+00:00');
    expect(r.notes).toEqual(['Day 31 does not exist in February 2024: the last day, 29, is used.']);
    expect(add('2023-01-31', 'UTC', 'add', '1 month').iso).toBe('2023-02-28T00:00:00+00:00');
    expect(add('2023-01-31', 'UTC', 'add', '1 month').notes).toEqual([
      'Day 31 does not exist in February 2023: the last day, 28, is used.',
    ]);
  });

  it('February 29 + 1 year / 4 years (Temporal)', () => {
    const one = add('2024-02-29', 'UTC', 'add', 'P1Y');
    expect(one.iso).toBe('2025-02-28T00:00:00+00:00');
    expect(one.notes).toEqual(['Day 29 does not exist in February 2025: the last day, 28, is used.']);
    expect(add('2024-02-29', 'UTC', 'add', 'P4Y').iso).toBe('2028-02-29T00:00:00+00:00');
  });

  it('years and months together, then weeks and days, then time: the order matters (Temporal)', () => {
    expect(add('2024-02-29', 'UTC', 'add', 'P1Y1M').iso).toBe('2025-03-29T00:00:00+00:00');
    const stepwise = addDuration(
      { epochMs: add('2024-02-29', 'UTC', 'add', 'P1Y').epochMs!, zone: 'UTC' },
      duration('P1M'),
      'add',
    );
    expect(stepwise.ok && iso(stepwise.epochMs, 'UTC')).toBe('2025-03-28T00:00:00+00:00');
    expect(add('2023-01-30', 'UTC', 'add', 'P1M1D').iso).toBe('2023-03-01T00:00:00+00:00');
    const dayFirst = addDuration(
      { epochMs: add('2023-01-30', 'UTC', 'add', 'P1D').epochMs!, zone: 'UTC' },
      duration('P1M'),
      'add',
    );
    expect(dayFirst.ok && iso(dayFirst.epochMs, 'UTC')).toBe('2023-02-28T00:00:00+00:00');
  });

  it('subtracting; adding then subtracting a month is not the identity (Temporal)', () => {
    expect(add('2024-03-31', 'UTC', 'subtract', '1mo').iso).toBe('2024-02-29T00:00:00+00:00');
    expect(add('2024-02-29', 'UTC', 'subtract', 'P1M').iso).toBe('2024-01-29T00:00:00+00:00');
  });

  it('a week is seven calendar days; signs (Temporal, reasoned)', () => {
    expect(add('2024-01-01', 'UTC', 'add', '1w').iso).toBe('2024-01-08T00:00:00+00:00');
    expect(add('2024-01-01', 'UTC', 'add', 'P2W').iso).toBe('2024-01-15T00:00:00+00:00');
    expect(add('2024-03-01', 'UTC', 'add', '-1d').iso).toBe('2024-02-29T00:00:00+00:00');
    expect(add('2024-03-01', 'UTC', 'subtract', '1d').iso).toBe('2024-02-29T00:00:00+00:00');
    expect(add('2024-03-01', 'UTC', 'subtract', '-1d').iso).toBe('2024-03-02T00:00:00+00:00');
  });

  it('months, days and time in one duration (Temporal)', () => {
    expect(add('2024-01-31T10:00', 'UTC', 'add', 'P1M2DT3H').iso).toBe('2024-03-02T13:00:00+00:00');
  });

  it('a calendar day is not 24 hours across a clock change (Temporal)', () => {
    const day = add('2024-03-30T12:00', 'Europe/Berlin', 'add', '1d');
    expect(day.iso).toBe('2024-03-31T12:00:00+02:00');
    expect(day.elapsed).toBe('23 hours');
    expect(day.notes).toEqual([
      'Europe/Berlin changed its clocks between Start and the result (+01:00 at Start, +02:00 at the result). Clock changes: 2024-03-31T02:00 → 03:00 (+01:00 → +02:00).',
    ]);
    const hours = add('2024-03-30T12:00', 'Europe/Berlin', 'add', '24h');
    expect(hours.iso).toBe('2024-03-31T13:00:00+02:00');
    expect(hours.elapsed).toBe('1 day');
  });

  it('a result in a gap moves forward; in an overlap it is the first, said in notes (Temporal)', () => {
    const gap = add('2024-03-30T02:30', 'Europe/Berlin', 'add', 'P1D');
    expect(gap.iso).toBe('2024-03-31T03:30:00+02:00');
    expect(gap.notes?.[0]).toBe(
      '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. The result is 2024-03-31T03:30:00+02:00.',
    );
    const overlap = add('2024-10-26T02:30', 'Europe/Berlin', 'add', 'P1D');
    expect(overlap.iso).toBe('2024-10-27T02:30:00+02:00');
    expect(overlap.notes?.[0]).toBe(
      '02:30 happens twice in Europe/Berlin on 2024-10-27: the clocks moved back by 1 hour. The result is the first (+02:00); the second is 2024-10-27T02:30:00+01:00.',
    );
  });

  it('exact time across the clock change (Temporal)', () => {
    expect(add('2024-10-27T00:00', 'Europe/Berlin', 'add', 'PT3H').iso).toBe('2024-10-27T02:00:00+01:00');
    const week = add('2024-03-25T12:00', 'Europe/Berlin', 'add', '1 week');
    expect(week.iso).toBe('2024-04-01T12:00:00+02:00');
    expect(week.elapsed).toBe('6 days, 23 hours');
    expect(add('2024-03-31T01:30', 'Europe/Berlin', 'add', '1h').iso).toBe('2024-03-31T03:30:00+02:00');
  });

  it('Samoa skipped 2011-12-30: one calendar day later is two dates later, 24 hours (Temporal)', () => {
    const r = add('2011-12-29T12:00', 'Pacific/Apia', 'add', '1d');
    expect(r.iso).toBe('2011-12-31T12:00:00+14:00');
    expect(r.elapsed).toBe('1 day');
  });

  it('one hour and a half, however written (reasoned)', () => {
    for (const d of ['1.5h', '90 min', '1 hour and 30 minutes', '1h, 30m', 'PT1H30M', 'PT1.5H', 'PT5400S', '1h30m'])
      expect(add('2024-01-01T00:00:00Z', 'UTC', 'add', d).iso, d).toBe('2024-01-01T01:30:00+00:00');
  });

  it('the edges of the range (reasoned)', () => {
    expect(add('+275760-09-13T00:00:00Z', 'UTC', 'add', '1ms').error).toBe(
      'The result is out of range: moments from -271821-04-20 to +275760-09-13 UTC (±8.64e15 ms) are supported.',
    );
    expect(add('+275760-09-13T00:00:00Z', 'UTC', 'subtract', '1ms').iso).toBe('+275760-09-12T23:59:59.999+00:00');
    expect(add('2024-01-01', 'UTC', 'add', 'P547581Y').error).toMatch(/^The result is out of range/);
    expect(parseDuration('P1000000Y')).toEqual({
      ok: true,
      empty: false,
      duration: expect.anything(),
      readAs: expect.any(String),
      notes: [],
    });
    expect(parseDuration('P1000001Y')).toEqual({
      ok: false,
      message: 'Too large: no moment plus this duration stays within -271821-04-20 to +275760-09-13 UTC.',
    });
    expect(add('2024-01-01', 'UTC', 'add', 'P1000000Y').error).toMatch(/^The result is out of range/);
  });
});

describe('§10 Difference', () => {
  it('1 March → 1 April in Berlin: one month, 31 calendar days, 30 days 23 hours exact, and why (Temporal)', () => {
    const d = diff('2024-03-01', '2024-04-01', 'Europe/Berlin');
    expect([d.calendar, d.days, d.exact, d.isoCalendar, d.isoExact]).toEqual([
      '1 month',
      '31 days',
      '30 days, 23 hours',
      'P1M',
      'PT743H',
    ]);
    expect(d.total('hours')).toBe('743');
    expect(d.notes).toEqual([
      'Calendar days and exact time differ by 1 hour: Europe/Berlin changed its clocks between the two moments (+01:00 at From, +02:00 at To). Clock changes: 2024-03-31T02:00 → 03:00 (+01:00 → +02:00).',
    ]);
  });

  it('a 23-hour and a 25-hour day (Temporal)', () => {
    const short = diff('2024-03-31', '2024-04-01', 'Europe/Berlin');
    expect([short.calendar, short.days, short.exact, short.isoCalendar, short.isoExact]).toEqual([
      '1 day',
      '1 day',
      '23 hours',
      'P1D',
      'PT23H',
    ]);
    const long = diff('2024-10-27', '2024-10-28', 'Europe/Berlin');
    expect([long.calendar, long.days, long.exact, long.isoCalendar, long.isoExact]).toEqual([
      '1 day',
      '1 day',
      '1 day, 1 hour',
      'P1D',
      'PT25H',
    ]);
    expect(long.notes[0]).toMatch(/Clock changes: 2024-10-27T03:00 → 02:00 \(\+02:00 → \+01:00\)\.$/);
  });

  it('months by "do not surpass": the day is not constrained while comparing (Temporal)', () => {
    const rows: Array<[string, string, string, string, string, string]> = [
      ['2024-01-31', '2024-02-29', '29 days', '29 days', 'P29D', 'PT696H'],
      ['2024-01-31', '2024-03-01', '1 month, 1 day', '30 days', 'P1M1D', 'PT720H'],
      ['2024-02-29', '2025-02-28', '11 months, 30 days', '365 days', 'P11M30D', 'PT8760H'],
      ['2024-02-29', '2025-03-01', '1 year, 1 day', '366 days', 'P1Y1D', 'PT8784H'],
      ['2024-02-29', '2028-02-29', '4 years', '1461 days', 'P4Y', 'PT35064H'],
      ['2024-03-31', '2024-02-29', '-1 month', '-31 days', '-P1M', '-PT744H'],
      ['2024-02-29', '2024-01-31', '-29 days', '-29 days', '-P29D', '-PT696H'],
    ];
    for (const [from, to, calendar, days, isoCal, isoEx] of rows) {
      const d = diff(from, to);
      expect([d.calendar, d.days, d.isoCalendar, d.isoExact], `${from} → ${to}`).toEqual([
        calendar,
        days,
        isoCal,
        isoEx,
      ]);
    }
    expect(diff('2024-03-31', '2024-02-29').notes).toEqual(['To is earlier than From: the durations are negative.']);
    expect(diff('2024-03-31', '2024-02-29').exact).toBe('-31 days');
  });

  it('negative across a clock change (Temporal)', () => {
    const d = diff('2024-04-01', '2024-03-01', 'Europe/Berlin');
    expect([d.calendar, d.days, d.exact, d.isoCalendar, d.isoExact]).toEqual([
      '-1 month',
      '-31 days',
      '-(30 days, 23 hours)',
      '-P1M',
      '-PT743H',
    ]);
  });

  it('dates and times; totals (Temporal)', () => {
    const d = diff('2024-01-15T10:00', '2024-03-14T08:30');
    expect([d.calendar, d.days, d.isoCalendar, d.isoExact]).toEqual([
      '1 month, 27 days, 22 hours, 30 minutes',
      '58 days, 22 hours, 30 minutes',
      'P1M27DT22H30M',
      'PT1414H30M',
    ]);
    expect(d.total('hours')).toBe('1414.5');
    const back = diff('2024-01-31T10:00', '2024-01-31T09:00');
    expect([back.calendar, back.days, back.exact, back.isoCalendar, back.isoExact]).toEqual([
      '-1 hour',
      '-1 hour',
      '-1 hour',
      '-PT1H',
      '-PT1H',
    ]);
  });

  it('zones that skipped midnight, half-hour changes, a skipped day, local mean time (Temporal)', () => {
    const sao = diff('2018-11-03', '2018-11-05', 'America/Sao_Paulo');
    expect([sao.calendar, sao.days, sao.exact, sao.isoCalendar, sao.isoExact]).toEqual([
      '2 days',
      '2 days',
      '1 day, 23 hours',
      'P2D',
      'PT47H',
    ]);
    expect(sao.notes[0]).toMatch(/Clock changes: 2018-11-04T00:00 → 01:00 \(-03:00 → -02:00\)\.$/);
    const howe = diff('2024-10-05', '2024-10-07', 'Australia/Lord_Howe');
    expect([howe.calendar, howe.exact, howe.isoExact]).toEqual(['2 days', '1 day, 23 hours, 30 minutes', 'PT47H30M']);
    expect(howe.notes[0]).toMatch(/^Calendar days and exact time differ by 30 minutes: /);
    const apia = diff('2011-12-29', '2011-12-31', 'Pacific/Apia');
    expect([apia.calendar, apia.days, apia.exact, apia.isoCalendar, apia.isoExact]).toEqual([
      '2 days',
      '2 days',
      '1 day',
      'P2D',
      'PT24H',
    ]);
    expect(apia.notes[0]).toBe(
      'Calendar days and exact time differ by 24 hours: Pacific/Apia changed its clocks between the two moments (-10:00 at From, +14:00 at To). Clock changes: 2011-12-30T00:00 → 2011-12-31T00:00 (-10:00 → +14:00).',
    );
    const ny = diff('1883-11-18', '1883-11-19', 'America/New_York');
    expect([ny.calendar, ny.days, ny.exact, ny.isoCalendar, ny.isoExact]).toEqual([
      '1 day',
      '1 day',
      '1 day, 3 minutes, 58 seconds',
      'P1D',
      'PT24H3M58S',
    ]);
    expect(ny.notes[0]).toContain('(-04:56:02 at From, -05:00 at To)');
  });

  it('exact over the whole range, in integers (Temporal)', () => {
    const d = diff('0001-01-01', '9999-12-31T23:59:59.999');
    expect(d.calendar).toBe('9998 years, 11 months, 30 days, 23 hours, 59 minutes, 59.999 seconds');
    expect(d.days).toBe('3652058 days, 23 hours, 59 minutes, 59.999 seconds');
    expect(d.isoCalendar).toBe('P9998Y11M30DT23H59M59.999S');
    expect(d.isoExact).toBe('PT87649415H59M59.999S');
    expect(d.total('milliseconds')).toBe('315537897599999');
    const all = diff('-271821-04-20T00:00:00Z', '+275760-09-13T00:00:00Z');
    expect([all.calendar, all.days, all.isoCalendar, all.isoExact]).toEqual([
      '547581 years, 4 months, 24 days',
      '200000000 days',
      'P547581Y4M24D',
      'PT4800000000H',
    ]);
    expect(all.total('milliseconds')).toBe('17280000000000000');
    expect(all.r.exactMs > BigInt(Number.MAX_SAFE_INTEGER)).toBe(true);
    expect(all.total('days')).toBe('200000000');
  });

  it('two zones: the calendar on the clocks of From (reasoned)', () => {
    const d = diff('2024-03-30T12:00', '2024-03-31T12:00', 'Europe/Berlin', 'America/New_York');
    expect([d.calendar, d.isoExact]).toEqual(['1 day, 6 hours', 'PT29H']);
    expect(d.notes[0]).toBe(
      'Calendar units are counted on the clocks of Europe/Berlin, the zone of From; To is 2024-03-31T18:00:00+02:00 there.',
    );
  });

  it('From = To; a third of an hour (reasoned)', () => {
    const same = diff('2024-01-01', '2024-01-01');
    expect([same.calendar, same.days, same.exact, same.isoCalendar, same.isoExact, same.total('hours')]).toEqual([
      '0 seconds',
      '0 seconds',
      '0 seconds',
      'PT0S',
      'PT0S',
      '0',
    ]);
    const third = diff('2024-01-01T00:00:00Z', '2024-01-01T00:20:00Z');
    expect([third.total('hours'), third.total('minutes'), third.total('days')]).toEqual([
      '≈0.333333',
      '20',
      '≈0.013889',
    ]);
    expect(total(1_200_000n, 'hours').value).toBe('0.333333');
  });
});

describe('§10 The moment field', () => {
  it('Unix seconds and milliseconds, a dropped fraction, before 1970', () => {
    expect(parseMoment('1711878000', 'Europe/Berlin')).toEqual({
      ok: true,
      empty: false,
      moment: { epochMs: 1_711_878_000_000, zone: 'Europe/Berlin' },
      readAs: 'Read as Unix seconds (10 digits): 2024-03-31T11:40:00+02:00 (Sunday).',
      notes: [],
    });
    const ms = parseMoment('1711878000123', 'UTC');
    expect(ms.ok && !ms.empty && ms.readAs).toBe(
      'Read as Unix milliseconds (13 digits): 2024-03-31T09:40:00.123+00:00 (Sunday).',
    );
    const fine = parseMoment('1711878000.123456', 'UTC');
    expect(fine.ok && !fine.empty && [fine.moment.epochMs, fine.notes]).toEqual([
      1_711_878_000_123,
      ['Digits finer than 1 millisecond were dropped.'],
    ]);
    const before = parseMoment('-1', 'UTC');
    expect(before.ok && !before.empty && before.readAs).toBe(
      'Read as Unix seconds (1 digit): 1969-12-31T23:59:59+00:00 (Wednesday).',
    );
  });

  it('a gap, an overlap, a midnight that did not happen (Temporal)', () => {
    const gap = parseMoment('2024-03-31T02:30', 'Europe/Berlin');
    expect(gap.ok && !gap.empty && [gap.readAs, gap.notes]).toEqual([
      'Read as 2024-03-31T03:30:00+02:00 (Sunday).',
      [
        '02:30 does not exist in Europe/Berlin on 2024-03-31: the clocks moved forward by 1 hour. Read as 2024-03-31T03:30:00+02:00.',
      ],
    ]);
    const overlap = parseMoment('2024-10-27T02:30', 'Europe/Berlin');
    expect(overlap.ok && !overlap.empty && [overlap.readAs, overlap.notes]).toEqual([
      'Read as 2024-10-27T02:30:00+02:00 (Sunday).',
      [
        '02:30 happens twice in Europe/Berlin on 2024-10-27: the clocks moved back by 1 hour. Read as the first (+02:00); for the second, write 2024-10-27T02:30:00+01:00.',
      ],
    ]);
    const sao = parseMoment('2018-11-04', 'America/Sao_Paulo');
    expect(sao.ok && !sao.empty && [sao.readAs, sao.notes[0]]).toEqual([
      'Read as 2018-11-04T01:00:00-02:00 (Sunday).',
      '00:00 does not exist in America/Sao_Paulo on 2018-11-04: the clocks moved forward by 1 hour. Read as 2018-11-04T01:00:00-02:00.',
    ]);
  });

  it('a zone in brackets is the moment’s zone; quotes; local mean time', () => {
    const java = parseMoment('2023-11-14T23:13:20+01:00[Europe/Berlin]', 'UTC');
    expect(java.ok && !java.empty && [java.moment, java.readAs, java.notes]).toEqual([
      { epochMs: 1_700_000_000_000, zone: 'Europe/Berlin' },
      'Read as 2023-11-14T23:13:20+01:00 (Tuesday).',
      ['The zone in brackets is used: Europe/Berlin.'],
    ]);
    expect(parseMoment('"2024-03-31"', 'UTC')).toEqual(parseMoment('2024-03-31', 'UTC'));
    const lmt = parseMoment('1883-11-18T12:00', 'America/New_York');
    expect(lmt.ok && !lmt.empty && lmt.readAs).toBe('Read as 1883-11-18T12:00:00-04:56:02 (Sunday).');
  });
});

describe('§10 Durations', () => {
  const read = (text: string) => {
    const r = parseDuration(text);
    return r.ok && !r.empty ? [r.readAs, ...r.notes] : r;
  };
  it('as people write them and as ISO 8601 (reasoned)', () => {
    expect(read('1h30m')).toEqual(['Read as PT1H30M (1 hour, 30 minutes).']);
    expect(read('90 min')).toEqual(['Read as PT90M (90 minutes).']);
    expect(read('2 weeks')).toEqual(['Read as P2W (2 weeks).']);
    expect(read('-3d')).toEqual(['Read as -P3D (minus 3 days).']);
    expect(read('P3DT4H')).toEqual(['Read as P3DT4H (3 days, 4 hours).']);
    expect(read('p3dt4h')).toEqual(['Read as P3DT4H (3 days, 4 hours).']);
    expect(read('P1Y2M3W4DT5H6M7.008S')).toEqual([
      'Read as P1Y2M3W4DT5H6M7.008S (1 year, 2 months, 3 weeks, 4 days, 5 hours, 6 minutes, 7.008 seconds).',
    ]);
    expect(read('PT0,5S')).toEqual(['Read as PT0.5S (0.5 seconds).']);
    expect(read('PT1.5H')).toEqual(['Read as PT1H30M (1 hour, 30 minutes).']);
    expect(read('2.75m')).toEqual(['Read as PT2M45S (2 minutes, 45 seconds).', 'm is read as minutes; months are mo.']);
    expect(read('1m')).toEqual(['Read as PT1M (1 minute).', 'm is read as minutes; months are mo.']);
    expect(read('1mo')).toEqual(['Read as P1M (1 month).']);
    expect(read('1 year, 2 months and 3 days')).toEqual(['Read as P1Y2M3D (1 year, 2 months, 3 days).']);
  });
});

describe('§10 Time zones', () => {
  const at = Date.parse('2024-03-31T10:30:00Z');
  const row = (zone: string, t = at) => {
    const r = zoneRow(t, zone);
    return [r.iso, r.offset, dstText(r.dst)];
  };
  it('local time, offset and daylight saving (Intl)', () => {
    expect(row('Europe/Berlin')).toEqual(['2024-03-31T12:30:00+02:00', 'UTC+02:00', 'Daylight saving time (+1 hour)']);
    expect(row('UTC')).toEqual(['2024-03-31T10:30:00+00:00', 'UTC+00:00', 'No daylight saving in 2024']);
    expect(row('Asia/Tokyo')).toEqual(['2024-03-31T19:30:00+09:00', 'UTC+09:00', 'No daylight saving in 2024']);
    expect(row('America/New_York')).toEqual([
      '2024-03-31T06:30:00-04:00',
      'UTC-04:00',
      'Daylight saving time (+1 hour)',
    ]);
    expect(row('Australia/Lord_Howe')).toEqual([
      '2024-03-31T21:30:00+11:00',
      'UTC+11:00',
      'Daylight saving time (+30 minutes)',
    ]);
    expect(row('Asia/Kathmandu')).toEqual(['2024-03-31T16:15:00+05:45', 'UTC+05:45', 'No daylight saving in 2024']);
    expect(row('Pacific/Chatham')).toEqual([
      '2024-04-01T00:15:00+13:45',
      'UTC+13:45',
      'Daylight saving time (+1 hour)',
    ]);
    expect(row('Africa/Casablanca')).toEqual(['2024-03-31T10:30:00+00:00', 'UTC+00:00', 'Standard time']);
    expect(row('Africa/Casablanca', Date.parse('2024-06-01T12:00:00Z'))[2]).toBe('Daylight saving time (+1 hour)');
  });

  it('zones that changed their rules (Intl)', () => {
    expect(row('America/Asuncion', Date.parse('2024-11-01T12:00:00Z')).slice(1)).toEqual([
      'UTC-03:00',
      'Daylight saving time (+1 hour)',
    ]);
    expect(row('America/Asuncion', Date.parse('2025-06-01T12:00:00Z')).slice(1)).toEqual([
      'UTC-03:00',
      'No daylight saving in 2025',
    ]);
    expect(row('Europe/Moscow', Date.parse('2012-06-01T12:00:00Z')).slice(1)).toEqual([
      'UTC+04:00',
      'No daylight saving in 2012',
    ]);
    expect(row('America/Caracas', Date.parse('2010-06-01T12:00:00Z')).slice(1)).toEqual([
      'UTC-04:30',
      'No daylight saving in 2010',
    ]);
    expect(row('Europe/Dublin', Date.parse('2024-07-01T12:00:00Z'))[2]).toBe('Daylight saving time (+1 hour)');
    expect(zoneRow(Date.parse('2024-07-01T12:00:00Z'), 'Europe/Dublin').longName).toBe('Irish Standard Time');
    expect(row('Europe/Dublin', Date.parse('2024-01-15T12:00:00Z'))[2]).toBe('Standard time');
  });

  it('Copy all writes RFC 9557 lines (reasoned)', () => {
    expect(['Europe/Berlin', 'Asia/Tokyo', 'UTC'].map(zone => rfc9557(at, zone)).join('\n')).toBe(
      '2024-03-31T12:30:00+02:00[Europe/Berlin]\n2024-03-31T19:30:00+09:00[Asia/Tokyo]\n2024-03-31T10:30:00+00:00[UTC]',
    );
  });
});

describe('§7 detectDateCalc', () => {
  it('says yes to an ISO 8601 duration and to two moments on two lines', () => {
    for (const t of ['P3DT4H', 'PT1H30M', 'P1M', '-P2W', 'PT0.5S', 'P1Y2M3W4DT5H6M7.008S', ' P3D '])
      expect(detectDateCalc(t), t).toBe(true);
    for (const t of [
      '2024-03-01\n2024-04-01',
      '1700000000\n1700003600',
      '2024-03-31T10:30:00Z\r\n2024-03-31T18:00:00+02:00',
      '1700000000000\n2024-03-31',
    ])
      expect(detectDateCalc(t), t).toBe(true);
  });
  it('says no to the rest', () => {
    for (const t of [
      'P',
      'PT',
      'P1H',
      'PT1.5H30M',
      'p3d',
      'P3D T4H',
      'P3D4H',
      'PDF',
      'P2P',
      'P-3D',
      '1h30m',
      '2 weeks',
      '-3d',
      '90 min',
      '1700000000',
      '2023-11-14T22:13:20Z',
      '2023-11-14',
      '2024-03-01\n2024-04-01\n2024-05-01',
      '2024-03-01\nhello',
      '2024-02-30\n2024-03-01',
      '2024-03-01 2024-04-01',
      '{"a":1}',
      '0 0 * * *',
      '$.a',
      'SGVsbG8=',
      '',
    ])
      expect(detectDateCalc(t), JSON.stringify(t)).toBe(false);
  });
  it('is linear on a long paste', () => {
    const long = `P${'1'.repeat(1_000_000)}D`;
    const started = performance.now();
    expect(detectDateCalc(long)).toBe(false);
    expect(detectDateCalc(`2024-03-01\n${'x'.repeat(1_000_000)}`)).toBe(false);
    expect(performance.now() - started).toBeLessThan(500);
  });
  it('hands text over to the part that reads it (§3)', () => {
    expect(handOver('P3DT4H')).toEqual({ part: 'add', duration: 'P3DT4H' });
    expect(handOver('2024-03-01\n2024-04-01')).toEqual({ part: 'difference', from: '2024-03-01', to: '2024-04-01' });
    expect(handOver('2024-03-31T10:30:00Z')).toEqual({ part: 'zones', moment: '2024-03-31T10:30:00Z' });
  });
});

describe('§5.9 Now', () => {
  it('writes the current second in the field’s zone', () => {
    expect(nowText(Date.parse('2026-11-22T12:00:00.789Z'), 'Europe/Berlin')).toBe('2026-11-22T13:00:00+01:00');
    expect(nowText(Date.parse('2026-11-22T12:00:00.789Z'), 'UTC')).toBe('2026-11-22T12:00:00+00:00');
  });
});

describe('isoDuration and clockChanges', () => {
  it('writes a duration as typed', () => {
    expect(isoDuration(duration('90 min'))).toBe('PT90M');
    expect(isoDuration(duration('-0d'))).toBe('PT0S');
  });
  it('finds the two changes of a year in Berlin and none in Tokyo', () => {
    const a = Date.parse('2024-01-01T00:00:00Z');
    const b = Date.parse('2025-01-01T00:00:00Z');
    expect(clockChanges(a, b, 'Europe/Berlin')!.map(c => new Date(c.atMs).toISOString())).toEqual([
      '2024-03-31T01:00:00.000Z',
      '2024-10-27T01:00:00.000Z',
    ]);
    expect(clockChanges(a, b, 'Asia/Tokyo')).toEqual([]);
    expect(clockChanges(a, Date.parse('2030-01-01T00:00:00Z'), 'Europe/Berlin')).toBeNull();
  });
});
