/**
 * The zone part of the time module (docs/tools/specs/unix-time.md §5.4, §5.5, §9, §10 «Переходы времени» and «Строки
 * результата»). Every test names its zone; none depends on the machine's — the last block runs the same answers under
 * other machine zones, and checks the wall-time rule against the machine's own `new Date(y, m, d, h, mi)`.
 */
import {
  LEGACY_ZONE_NAMES,
  MAX_EPOCH_MS,
  browserTimeZone,
  daysFromCivil,
  formatIsoInZone,
  formatOffset,
  isTimeZone,
  resolveTimeZone,
  timeZones,
  wallClock,
  wallClockAsUtcMs,
  wallTimeToEpochMs,
  zoneLongName,
  zoneOffsetMs,
} from './time';
import { afterAll, describe, expect, it } from 'vitest';
import type { WallClock } from './time';

const HOUR = 3_600_000;
const MINUTE = 60_000;
const DAY = 86_400_000;
const s = (seconds: number): bigint => BigInt(seconds) * 1_000_000_000n;
/** "2024-03-31T02:30" (or with seconds) as wall-clock milliseconds. */
const local = (text: string): number => {
  const [, y, mo, d, h = '0', mi = '0', sec = '0'] = /^(-?\d+)-(\d\d)-(\d\d)(?:T(\d\d):(\d\d)(?::(\d\d))?)?$/.exec(
    text,
  )!;
  return wallClockAsUtcMs({
    year: Number(y),
    month: Number(mo),
    day: Number(d),
    hour: Number(h),
    minute: Number(mi),
    second: Number(sec),
  });
};
const wall = (y: number, mo: number, d: number, h = 0, mi = 0, sec = 0): WallClock => ({
  year: y,
  month: mo,
  day: d,
  hour: h,
  minute: mi,
  second: sec,
});

describe('formatOffset', () => {
  it('±hh:mm, seconds only when there are any, without colons for RFC 2822', () => {
    expect(formatOffset(0)).toBe('+00:00');
    expect(formatOffset(HOUR)).toBe('+01:00');
    expect(formatOffset(-5 * HOUR)).toBe('-05:00');
    expect(formatOffset(5 * HOUR + 30 * MINUTE)).toBe('+05:30');
    expect(formatOffset(5 * HOUR + 45 * MINUTE)).toBe('+05:45');
    expect(formatOffset(-(44 * MINUTE + 30_000))).toBe('-00:44:30');
    expect(formatOffset(-(4 * HOUR + 56 * MINUTE + 2000))).toBe('-04:56:02');
    expect(formatOffset(0, false)).toBe('+0000');
    expect(formatOffset(5 * HOUR + 30 * MINUTE, false)).toBe('+0530');
    expect(formatOffset(-(44 * MINUTE + 30_000), false)).toBe('-004430');
  });
});

describe('wallClock / zoneOffsetMs (§5.4)', () => {
  it('the wall clock in a zone, astronomical years, midnight as 0', () => {
    expect(wallClock(1_700_000_000_000, 'Europe/Berlin')).toEqual(wall(2023, 11, 14, 23, 13, 20));
    expect(wallClock(1_700_000_000_000, 'Asia/Kolkata')).toEqual(wall(2023, 11, 15, 3, 43, 20));
    expect(wallClock(Date.UTC(2023, 10, 14, 23), 'Europe/Berlin')).toEqual(wall(2023, 11, 15, 0, 0, 0));
    expect(wallClock(-MAX_EPOCH_MS, 'America/New_York')).toEqual(wall(-271821, 4, 19, 19, 3, 58));
    expect(wallClock(MAX_EPOCH_MS, 'Pacific/Kiritimati')).toEqual(wall(275760, 9, 13, 14, 0, 0));
    expect(wallClock(daysFromCivil(0, 1, 1) * DAY, 'UTC')).toEqual(wall(0, 1, 1));
    // Before 1970 the second counts down: −1.5 s is 23:59:58.500.
    expect(wallClock(-1500, 'UTC')).toEqual(wall(1969, 12, 31, 23, 59, 58));
  });

  it('offsets in whole seconds: half and three-quarter hours, both hemispheres, LMT, the ends of the range', () => {
    expect(zoneOffsetMs(1_700_000_000_000, 'UTC')).toBe(0);
    expect(zoneOffsetMs(1_700_000_000_000, 'Europe/Berlin')).toBe(HOUR);
    expect(zoneOffsetMs(1_720_000_000_000, 'Europe/Berlin')).toBe(2 * HOUR);
    expect(zoneOffsetMs(1_700_000_000_000, 'Asia/Kolkata')).toBe(5.5 * HOUR);
    expect(zoneOffsetMs(1_700_000_000_000, 'Asia/Kathmandu')).toBe(5.75 * HOUR);
    expect(zoneOffsetMs(1_700_000_000_000, 'Australia/Lord_Howe')).toBe(11 * HOUR);
    expect(zoneOffsetMs(1_720_000_000_000, 'Australia/Lord_Howe')).toBe(10.5 * HOUR);
    expect(zoneOffsetMs(1_700_000_000_000, 'Australia/Sydney')).toBe(11 * HOUR);
    expect(zoneOffsetMs(1_720_000_000_000, 'Australia/Sydney')).toBe(10 * HOUR);
    expect(zoneOffsetMs(1_700_000_000_000, 'Pacific/Chatham')).toBe(13.75 * HOUR);
    expect(zoneOffsetMs(Date.UTC(1960, 0, 1, 12), 'Africa/Monrovia')).toBe(-(44 * MINUTE + 30_000));
    expect(zoneOffsetMs(-MAX_EPOCH_MS, 'America/New_York')).toBe(-(4 * HOUR + 56 * MINUTE + 2000));
    expect(zoneOffsetMs(MAX_EPOCH_MS, 'Pacific/Kiritimati')).toBe(14 * HOUR);
  });
});

describe('formatIsoInZone (§5.6; §10 «Строки результата»)', () => {
  it.each([
    [s(1_700_000_000), 'Europe/Berlin', '2023-11-14T23:13:20+01:00'],
    [s(1_700_000_000), 'America/New_York', '2023-11-14T17:13:20-05:00'],
    [s(1_700_000_000), 'Asia/Kolkata', '2023-11-15T03:43:20+05:30'],
    [s(1_700_000_000), 'Australia/Lord_Howe', '2023-11-15T09:13:20+11:00'],
    [s(1_700_000_000), 'UTC', '2023-11-14T22:13:20+00:00'],
    [s(1_700_000_000) + 123_456_789n, 'Asia/Kathmandu', '2023-11-15T03:58:20.123456789+05:45'],
    [BigInt(Date.UTC(1960, 0, 1, 12)) * 1_000_000n, 'Africa/Monrovia', '1960-01-01T11:15:30-00:44:30'],
    [BigInt(MAX_EPOCH_MS) * 1_000_000n, 'Pacific/Kiritimati', '+275760-09-13T14:00:00+14:00'],
    [BigInt(-MAX_EPOCH_MS) * 1_000_000n, 'America/New_York', '-271821-04-19T19:03:58-04:56:02'],
    [-1_500_000_000n, 'America/Sao_Paulo', '1969-12-31T20:59:58.500-03:00'],
  ])('%s in %s → %s', (epochNs, zone, expected) => {
    expect(formatIsoInZone(epochNs, zone)).toBe(expected);
  });
});

describe('wallTimeToEpochMs (§5.5; §10 «Переходы времени»)', () => {
  const at = (text: string, zone: string) => wallTimeToEpochMs(local(text), zone)!;
  const iso = (epochMs: number, zone: string) => formatIsoInZone(BigInt(epochMs) * 1_000_000n, zone);

  it.each([
    ['2024-03-31T01:59:59', 'Europe/Berlin', 1_711_846_799, '2024-03-31T01:59:59+01:00'],
    ['2024-03-31T03:00', 'Europe/Berlin', 1_711_846_800, '2024-03-31T03:00:00+02:00'],
    ['2024-10-27T01:59:59', 'Europe/Berlin', 1_729_987_199, '2024-10-27T01:59:59+02:00'],
    ['2024-10-27T03:00', 'Europe/Berlin', 1_729_994_400, '2024-10-27T03:00:00+01:00'],
    ['2024-04-07T02:00', 'Australia/Lord_Howe', 1_712_417_400, '2024-04-07T02:00:00+10:30'],
    ['2011-12-29T23:59:59', 'Pacific/Apia', 1_325_239_199, '2011-12-29T23:59:59-10:00'],
    ['2011-12-31T00:00', 'Pacific/Apia', 1_325_239_200, '2011-12-31T00:00:00+14:00'],
    ['2024-06-01T12:00', 'Asia/Kathmandu', 1_717_222_500, '2024-06-01T12:00:00+05:45'],
    ['1960-01-01T12:00', 'Africa/Monrovia', -315_573_330, '1960-01-01T12:00:00-00:44:30'],
  ])('exact: %s in %s → %i s', (text, zone, seconds, shown) => {
    const r = at(text, zone);
    expect(r).toEqual({ kind: 'exact', epochMs: seconds * 1000 });
    expect(iso(r.epochMs, zone)).toBe(shown);
  });

  it.each([
    ['2024-03-31T02:00', 'Europe/Berlin', 1_711_846_800, HOUR, '2024-03-31T03:00:00+02:00'],
    ['2024-03-31T02:30', 'Europe/Berlin', 1_711_848_600, HOUR, '2024-03-31T03:30:00+02:00'],
    ['2024-03-10T02:30', 'America/New_York', 1_710_055_800, HOUR, '2024-03-10T03:30:00-04:00'],
    ['2024-10-06T02:15', 'Australia/Lord_Howe', 1_728_143_100, 30 * MINUTE, '2024-10-06T02:45:00+11:00'],
    ['2011-12-30T12:00', 'Pacific/Apia', 1_325_282_400, 24 * HOUR, '2011-12-31T12:00:00+14:00'],
    ['2018-11-04', 'America/Sao_Paulo', 1_541_300_400, HOUR, '2018-11-04T01:00:00-02:00'],
    ['2024-09-29T02:50', 'Pacific/Chatham', 1_727_532_300, HOUR, '2024-09-29T03:50:00+13:45'],
    ['1972-01-07T00:20', 'Africa/Monrovia', 63_594_270, 44 * MINUTE + 30_000, '1972-01-07T01:04:30+00:00'],
    ['2024-10-06T02:30', 'Australia/Sydney', 1_728_145_800, HOUR, '2024-10-06T03:30:00+11:00'],
  ])('gap: %s in %s → %i s, moved forward by %i ms', (text, zone, seconds, shift, shown) => {
    const r = at(text, zone);
    expect(r).toEqual({ kind: 'gap', epochMs: seconds * 1000, shiftMs: shift });
    expect(iso(r.epochMs, zone)).toBe(shown);
  });

  it.each([
    ['2024-10-27T02:00', 'Europe/Berlin', 1_729_987_200, HOUR, '2024-10-27T02:00:00+01:00'],
    ['2024-10-27T02:30', 'Europe/Berlin', 1_729_989_000, HOUR, '2024-10-27T02:30:00+01:00'],
    ['2024-11-03T01:30', 'America/New_York', 1_730_611_800, HOUR, '2024-11-03T01:30:00-05:00'],
    ['2024-04-07T01:45', 'Australia/Lord_Howe', 1_712_414_700, 30 * MINUTE, '2024-04-07T01:45:00+10:30'],
    ['2024-04-07T02:30', 'Australia/Sydney', 1_712_417_400, HOUR, '2024-04-07T02:30:00+10:00'],
  ])('overlap: %s in %s → %i s first, the second %s later', (text, zone, seconds, shift, second) => {
    const r = at(text, zone);
    expect(r).toEqual({
      kind: 'overlap',
      epochMs: seconds * 1000,
      laterEpochMs: seconds * 1000 + shift,
      shiftMs: shift,
    });
    if (r.kind === 'overlap') expect(iso(r.laterEpochMs, zone)).toBe(second);
  });

  it('the ends of the range: inside is answered, outside is null', () => {
    expect(at('275760-09-13T00:00', 'UTC')).toEqual({ kind: 'exact', epochMs: MAX_EPOCH_MS });
    expect(at('-271821-04-20T00:00', 'UTC')).toEqual({ kind: 'exact', epochMs: -MAX_EPOCH_MS });
    expect(at('-271821-04-19T19:03:58', 'America/New_York')).toEqual({ kind: 'exact', epochMs: -MAX_EPOCH_MS });
    expect(wallTimeToEpochMs(local('275760-09-13T00:00:01'), 'UTC')).toBeNull();
    expect(wallTimeToEpochMs(local('-271821-04-19T23:59:59'), 'UTC')).toBeNull();
    expect(wallTimeToEpochMs(local('275760-09-13T14:00:00'), 'Pacific/Kiritimati')).toEqual({
      kind: 'exact',
      epochMs: MAX_EPOCH_MS,
    });
  });

  // §10, the property row: every 15 minutes of 2024 (and a southern zone with a whole-hour change).
  it.each(['Europe/Berlin', 'America/New_York', 'Australia/Lord_Howe', 'Australia/Sydney'])(
    'every 15 minutes of 2024 in %s: the wall clock of the answer is the input, moved by the gap if any',
    zone => {
      const start = local('2024-01-01');
      const end = local('2025-01-01');
      let gaps = 0;
      let overlaps = 0;
      const wrong: string[] = [];
      for (let t = start; t < end; t += 15 * MINUTE) {
        const r = wallTimeToEpochMs(t, zone)!;
        const shown = wallClockAsUtcMs(wallClock(r.epochMs, zone));
        if (r.kind === 'gap') gaps++;
        if (shown !== (r.kind === 'gap' ? t + r.shiftMs : t)) wrong.push(`${t} ${r.kind}`);
        if (r.kind === 'overlap') {
          overlaps++;
          const later = wallClockAsUtcMs(wallClock(r.laterEpochMs, zone));
          if (later !== t || r.laterEpochMs - r.epochMs !== r.shiftMs) wrong.push(`${t} second pass`);
        }
      }
      expect(wrong).toEqual([]);
      // One change each way: an hour (four quarter-hours), Lord Howe half an hour (two).
      const quarters = zone === 'Australia/Lord_Howe' ? 2 : 4;
      expect([gaps, overlaps]).toEqual([quarters, quarters]);
    },
    30_000, // 35 136 wall times; a loaded machine runs this in seconds
  );
});

describe('the zone list and names (§5.4)', () => {
  it('UTC first, then the browser’s zones under their current names, sorted', () => {
    const zones = timeZones();
    expect(zones[0]).toBe('UTC');
    expect(zones.length).toBe(Intl.supportedValuesOf('timeZone').length + 1);
    expect(zones).toContain('Asia/Kolkata');
    expect(zones).toContain('Europe/Kyiv');
    expect(zones).toContain('America/Argentina/Buenos_Aires');
    for (const old of Object.keys(LEGACY_ZONE_NAMES)) expect(zones).not.toContain(old);
    expect(new Set(zones).size).toBe(zones.length);
    expect(zones.slice(1)).toEqual([...zones.slice(1)].sort());
    expect(timeZones()).toBe(zones);
  });

  it('Intl accepts every old and new name of the table', () => {
    for (const [old, current] of Object.entries(LEGACY_ZONE_NAMES)) {
      expect(isTimeZone(old)).toBe(true);
      expect(isTimeZone(current)).toBe(true);
    }
  });

  it('isTimeZone / resolveTimeZone: any case, current names, null for an unknown one', () => {
    expect(isTimeZone('europe/berlin')).toBe(true);
    expect(isTimeZone('Mars/Base')).toBe(false);
    expect(isTimeZone('')).toBe(false);
    expect(resolveTimeZone('europe/berlin')).toBe('Europe/Berlin');
    expect(resolveTimeZone('ASIA/CALCUTTA')).toBe('Asia/Kolkata');
    expect(resolveTimeZone('Asia/Kolkata')).toBe('Asia/Kolkata');
    expect(resolveTimeZone('utc')).toBe('UTC');
    expect(resolveTimeZone('Mars/Base')).toBeNull();
  });

  it('the long English name at the instant', () => {
    expect(zoneLongName(1_700_000_000_000, 'Europe/Berlin')).toBe('Central European Standard Time');
    expect(zoneLongName(1_720_000_000_000, 'Europe/Berlin')).toBe('Central European Summer Time');
    expect(zoneLongName(1_700_000_000_000, 'America/New_York')).toBe('Eastern Standard Time');
    expect(zoneLongName(1_700_000_000_000, 'Asia/Kolkata')).toBe('India Standard Time');
    expect(zoneLongName(1_700_000_000_000, 'Australia/Lord_Howe')).toBe('Lord Howe Daylight Time');
    expect(zoneLongName(Date.UTC(1960, 0, 1, 12), 'Africa/Monrovia')).toBe('GMT-00:44:30');
    expect(zoneLongName(0, 'UTC')).toBe('Coordinated Universal Time');
  });
});

describe('whatever the machine’s zone', () => {
  const original = process.env.TZ;
  afterAll(() => {
    if (original === undefined) delete process.env.TZ;
    else process.env.TZ = original;
  });

  it.each(['UTC', 'Asia/Kathmandu', 'America/Sao_Paulo', 'Pacific/Chatham', 'America/Los_Angeles'])(
    'machine zone %s: the same answers',
    machine => {
      process.env.TZ = machine;
      expect(formatIsoInZone(s(1_700_000_000), 'Europe/Berlin')).toBe('2023-11-14T23:13:20+01:00');
      expect(wallTimeToEpochMs(local('2024-03-31T02:30'), 'Europe/Berlin')).toEqual({
        kind: 'gap',
        epochMs: 1_711_848_600_000,
        shiftMs: HOUR,
      });
      expect(zoneOffsetMs(Date.UTC(1960, 0, 1, 12), 'Africa/Monrovia')).toBe(-(44 * MINUTE + 30_000));
      expect(browserTimeZone()).toBe(machine);
    },
  );

  it('the machine zone is reported under its current name', () => {
    process.env.TZ = 'Asia/Calcutta';
    expect(browserTimeZone()).toBe('Asia/Kolkata');
    process.env.TZ = 'Asia/Kolkata';
    expect(browserTimeZone()).toBe('Asia/Kolkata');
  });

  // §10 «TZ»: the rule agrees with the machine's own `new Date(y, m, d, h, mi)` in that zone (ECMA-262 LocalTime → UTC,
  // the same 'compatible' choice), every 15 minutes of a year. Not Monrovia: V8 rounds its offset to minutes.
  it.each([
    ['Europe/Berlin', 2024],
    ['America/New_York', 2024],
    ['Australia/Lord_Howe', 2024],
    ['America/Sao_Paulo', 2018],
    ['Asia/Kathmandu', 2024],
    ['Pacific/Apia', 2011],
    ['Europe/Moscow', 2011],
  ])(
    '%s %i agrees with new Date(y, m, d, h, mi) under TZ',
    (zone, year) => {
      process.env.TZ = zone;
      let differences = 0;
      for (let t = local(`${year}-01-01`); t < local(`${year + 1}-01-01`); t += 15 * MINUTE) {
        const w = wallClock(t, 'UTC');
        const machine = new Date(w.year, w.month - 1, w.day, w.hour, w.minute).getTime();
        if (wallTimeToEpochMs(t, zone)!.epochMs !== machine) differences++;
      }
      expect(differences).toBe(0);
    },
    30_000,
  );
});
