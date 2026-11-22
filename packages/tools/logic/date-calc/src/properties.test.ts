/**
 * Promises examples do not cover (docs/tools/specs/date-calc.md §5.1, §5.5, §5.6), on seeded generated cases — a failure
 * names its seed: exact time added is exactly the exact difference back, in integers over the whole range; calendar days
 * added come back as calendar days when the result's wall time exists; the answers do not depend on the machine's zone.
 * The independent checks (Python, Temporal) are crosscheck.test.ts.
 */
import { addDuration, difference, parseMoment, zoneRow } from './index';
import { describe, expect, it } from 'vitest';
import type { Duration } from './index';

/** mulberry32: small, fast, seeded. */
const random = (seed: number): (() => number) => {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const ZONES = [
  'UTC',
  'Europe/Berlin',
  'America/New_York',
  'Australia/Lord_Howe',
  'Pacific/Chatham',
  'Asia/Kathmandu',
  'America/Sao_Paulo',
  'Pacific/Apia',
  'Africa/Monrovia',
];
const empty: Duration = {
  sign: 1,
  years: 0n,
  months: 0n,
  weeks: 0n,
  days: 0n,
  hours: 0n,
  minutes: 0n,
  seconds: 0n,
  milliseconds: 0n,
};

describe('properties', () => {
  it('exact time added comes back exactly, anywhere in the range (seed 1)', () => {
    const rnd = random(1);
    for (let i = 0; i < 2000; i++) {
      const zone = ZONES[Math.floor(rnd() * ZONES.length)]!;
      const start = Math.round((rnd() * 2 - 1) * 8.64e15);
      const ms = BigInt(Math.round((rnd() * 2 - 1) * 1e15));
      const r = addDuration(
        { epochMs: start, zone },
        { ...empty, milliseconds: ms < 0n ? -ms : ms, sign: ms < 0n ? -1 : 1 },
        'add',
      );
      if (!r.ok) {
        expect(Math.abs(start + Number(ms)) > 8.64e15, `seed 1 case ${i}`).toBe(true);
        continue;
      }
      expect(r.elapsedMs, `seed 1 case ${i}`).toBe(ms);
      expect(difference({ epochMs: start, zone }, { epochMs: r.epochMs, zone }).exactMs).toBe(ms);
    }
  });

  it('calendar days added come back as calendar days when no gap moved the time (seed 2)', () => {
    const rnd = random(2);
    let checked = 0;
    for (let i = 0; i < 1500; i++) {
      const zone = ZONES[Math.floor(rnd() * ZONES.length)]!;
      const start = Math.round(Date.UTC(1950, 0, 1) + rnd() * (Date.UTC(2050, 0, 1) - Date.UTC(1950, 0, 1)));
      const days = Math.round((rnd() * 2 - 1) * 1000);
      const r = addDuration(
        { epochMs: start, zone },
        { ...empty, days: BigInt(Math.abs(days)), sign: days < 0 ? -1 : 1 },
        'add',
      );
      if (!r.ok || r.notes.some(n => n.includes('does not exist') || n.includes('happens twice'))) continue;
      // A start that was itself the second pass of an overlap reads back as the first: skip those too.
      const back = difference({ epochMs: start, zone }, { epochMs: r.epochMs, zone });
      if (back.calendarDays.timeMs !== 0n) continue;
      expect(back.calendarDays.days, `seed 2 case ${i} ${zone}`).toBe(days);
      checked++;
    }
    expect(checked).toBeGreaterThan(1300);
  });

  it('answers the same whatever the machine’s zone', () => {
    const before = process.env.TZ;
    const sample = () => {
      const m = parseMoment('2024-03-31T02:30', 'Europe/Berlin');
      const a = parseMoment('2024-03-01', 'Europe/Berlin');
      const b = parseMoment('2024-04-01', 'Europe/Berlin');
      if (!m.ok || m.empty || !a.ok || a.empty || !b.ok || b.empty) throw new Error('setup');
      const d = difference(a.moment, b.moment);
      return [
        m.moment.epochMs,
        zoneRow(m.moment.epochMs, 'Australia/Lord_Howe').iso,
        String(d.exactMs),
        d.calendar.months,
      ];
    };
    try {
      const expected = sample();
      for (const tz of ['UTC', 'Asia/Kolkata', 'Pacific/Chatham', 'America/Los_Angeles', 'Europe/Berlin']) {
        process.env.TZ = tz;
        expect(sample(), tz).toEqual(expected);
      }
    } finally {
      if (before === undefined) delete process.env.TZ;
      else process.env.TZ = before;
    }
  });
});
