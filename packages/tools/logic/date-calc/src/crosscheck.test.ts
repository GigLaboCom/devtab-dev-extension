/**
 * The cross-check of docs/tools/specs/date-calc.md §10 against two independent implementations already on the machine —
 * opt-in, never part of the normal tests (it needs python3 and a file made in Chrome):
 *
 *   node packages/tools/logic/date-calc/crosscheck/temporal.mjs          # once: Temporal's answers in Chrome
 *   DATE_CALC_CROSSCHECK=1 pnpm --filter @workspace/tool-logic-date-calc test crosscheck
 *
 * Python (`crosscheck/zoneinfo.py`, datetime and zoneinfo over the machine's IANA data) answers wall clocks, offsets and
 * daylight saving of instants, wall times back to instants (fold=0 — `compatible`), and additions of calendar days and
 * months; Temporal in Chrome answers additions and differences with every field. Every mismatch is classified: the two
 * zone databases differ there (the offsets at the instants involved are not the same — a version difference, not a bug),
 * or the rule differs (daylight saving read from offsets, §5.7), or unexplained — which fails the test. The report goes
 * to .state/date-calc/crosscheck-report.json.
 */
import { addDuration, difference, dstAt, parseMoment, zoneRow } from './index';
import { timeZones, zoneOffsetMs } from '@workspace/tools-shared/time';
import { describe, expect, it } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Duration } from './index';

const ON = process.env.DATE_CALC_CROSSCHECK === '1';
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, '../../../../..');
const STATE = join(ROOT, '.state/date-calc');
const SEED = Number(process.env.DATE_CALC_SEED ?? 39);
const COUNT = Number(process.env.DATE_CALC_COUNT ?? 4000);

interface PyCase {
  kind: 'wall' | 'resolve' | 'add_days' | 'add_months';
  zone: string;
  t: number;
  iso?: string;
  offset?: number;
  dst?: boolean;
  wall?: string;
  expected?: number;
  resolution?: 'gap' | 'overlap' | 'exact';
  days?: number;
  months?: number;
  ms?: number;
}
interface Py {
  tzdata: string | null;
  zones: number;
  missing: string[];
  cases: PyCase[];
  instants: number[];
  offsets: Record<string, number[]>;
}
interface TemporalParts {
  years?: number;
  months?: number;
  days?: number;
  hours?: number;
  minutes?: number;
  seconds?: number;
  milliseconds?: number;
}
interface TCase {
  kind: 'add' | 'until' | 'error';
  zone: string;
  start: number;
  end?: number;
  fields?: Record<string, number>;
  negative?: boolean;
  op?: 'add' | 'subtract';
  expected?: number;
  years?: TemporalParts;
  days?: TemporalParts;
  offsets?: [number, number];
}

const durationOf = (fields: Record<string, number>, negative: boolean): Duration => ({
  sign: negative ? -1 : 1,
  years: BigInt(fields.years ?? 0),
  months: BigInt(fields.months ?? 0),
  weeks: BigInt(fields.weeks ?? 0),
  days: BigInt(fields.days ?? 0),
  hours: BigInt(fields.hours ?? 0),
  minutes: BigInt(fields.minutes ?? 0),
  seconds: BigInt(fields.seconds ?? 0),
  milliseconds: BigInt(fields.milliseconds ?? 0),
});
const timeOf = (p: TemporalParts): bigint =>
  BigInt(p.hours ?? 0) * 3_600_000n +
  BigInt(p.minutes ?? 0) * 60_000n +
  BigInt(p.seconds ?? 0) * 1000n +
  BigInt(p.milliseconds ?? 0);

/** The months (1900–2100) where two sets of offsets differ, per zone: the first and the count. */
const dataDifferences = (
  instants: number[],
  left: Record<string, number[]>,
  right: Record<string, number[]>,
): Record<string, { first: string; months: number }> => {
  const out: Record<string, { first: string; months: number }> = {};
  for (const zone of Object.keys(left)) {
    const r = right[zone];
    if (!r) continue;
    const l = left[zone]!;
    let first = -1;
    let months = 0;
    for (let i = 0; i < instants.length; i++)
      if (l[i] !== r[i]) {
        months++;
        if (first < 0) first = i;
      }
    if (months) out[zone] = { first: new Date(instants[first]!).toISOString().slice(0, 7), months };
  }
  return out;
};

describe.skipIf(!ON)('cross-check with Python zoneinfo and Chrome Temporal', () => {
  it('agrees, and every mismatch is a zone data difference or the stated daylight-saving rule', () => {
    mkdirSync(STATE, { recursive: true });
    const zones = [...timeZones()];
    const zonesPath = join(STATE, 'zones.json');
    writeFileSync(zonesPath, JSON.stringify(zones));
    const run = spawnSync(
      'python3',
      ['-I', join(HERE, '../crosscheck/zoneinfo.py'), zonesPath, String(SEED), String(COUNT)],
      {
        maxBuffer: 512 * 1024 * 1024,
        encoding: 'utf8',
      },
    );
    expect(run.status, run.stderr).toBe(0);
    const py = JSON.parse(run.stdout) as Py;

    // Node's own offsets at the same instants, through the shared module (seconds, like the other two).
    const node: Record<string, number[]> = {};
    for (const zone of Object.keys(py.offsets)) node[zone] = py.instants.map(t => zoneOffsetMs(t, zone) / 1000);
    const nodeVsPython = dataDifferences(py.instants, node, py.offsets);

    const nodeOffsetDiffers = (zone: string, ...instants: number[]): boolean =>
      instants.some(t => {
        const z = py.offsets[zone] ? zone : null;
        if (!z) return false;
        // Python's offset at an arbitrary instant is not in the table: ask whether the zone differs near it.
        const year = new Date(t).getUTCFullYear();
        const diff = nodeVsPython[zone];
        if (!diff) return false;
        const i0 = Math.max(0, (Math.min(2100, Math.max(1900, year)) - 1900) * 12 - 12);
        const l = node[zone]!;
        const r = py.offsets[zone]!;
        for (let i = i0; i < Math.min(l.length, i0 + 36); i++) if (l[i] !== r[i]) return true;
        return year < 1900 || year > 2100;
      });

    type Row = { kind: string; zone: string; class: 'data' | 'dst-rule' | 'unexplained'; detail: string };
    const mismatches: Row[] = [];
    const counts: Record<string, number> = {};
    for (const c of py.cases) {
      counts[c.kind] = (counts[c.kind] ?? 0) + 1;
      const push = (detail: string, dataSuspect: boolean, dstOnly = false) =>
        mismatches.push({
          kind: `python:${c.kind}`,
          zone: c.zone,
          class: dataSuspect ? 'data' : dstOnly ? 'dst-rule' : 'unexplained',
          detail,
        });
      if (c.kind === 'wall') {
        const row = zoneRow(c.t, c.zone);
        const offset = zoneOffsetMs(c.t, c.zone) / 1000;
        if (offset !== c.offset || row.iso !== c.iso)
          push(`${new Date(c.t).toISOString()} ours ${row.iso} python ${c.iso}`, true);
        else if ((dstAt(c.t, c.zone).kind === 'dst') !== c.dst)
          // The offsets of the year decide daylight saving (§5.7): where the zone's data differs in that year, so may
          // the answer.
          push(
            `${new Date(c.t).toISOString()} ${row.iso} ours ${dstAt(c.t, c.zone).kind} python dst=${c.dst}`,
            nodeOffsetDiffers(c.zone, c.t),
            true,
          );
      } else if (c.kind === 'resolve') {
        const r = parseMoment(c.wall!, c.zone);
        const got = r.ok && !r.empty ? r.moment.epochMs : NaN;
        if (got !== c.expected)
          push(
            `${c.wall} ours ${Number.isNaN(got) ? (r.ok ? 'empty' : r.message) : new Date(got).toISOString()} python ${new Date(c.expected!).toISOString()} (${c.resolution})`,
            nodeOffsetDiffers(c.zone, c.expected!, c.t),
          );
      } else {
        const d: Duration = durationOf({ months: c.months ?? 0, days: c.days ?? 0 }, false);
        const extra = BigInt(c.ms ?? 0);
        const sign: 1 | -1 = extra < 0n ? -1 : 1;
        // Calendar part first, then the exact milliseconds (a second addition: exact time after calendar time is
        // what one duration does too — §5.5 step 6).
        const first = addDuration({ epochMs: c.t, zone: c.zone }, d, 'add');
        const second =
          first.ok && extra !== 0n
            ? addDuration(
                { epochMs: first.epochMs, zone: c.zone },
                { ...durationOf({}, sign < 0), milliseconds: sign < 0 ? -extra : extra },
                'add',
              )
            : first;
        const got = second.ok ? second.epochMs : NaN;
        if (got !== c.expected)
          push(
            `${new Date(c.t).toISOString()} +${c.months ?? 0}mo ${c.days}d ${c.ms}ms ours ${Number.isNaN(got) ? 'error' : new Date(got).toISOString()} python ${new Date(c.expected!).toISOString()}`,
            nodeOffsetDiffers(c.zone, c.t, c.expected!),
          );
      }
    }

    // Temporal in Chrome.
    const temporalPath = join(STATE, 'temporal.json');
    const temporal = existsSync(temporalPath)
      ? (JSON.parse(readFileSync(temporalPath, 'utf8')) as {
          userAgent: string;
          cases: TCase[];
          instants: number[];
          offsets: Record<string, number[]>;
        })
      : null;
    const tCounts: Record<string, number> = {};
    let nodeVsChrome: Record<string, { first: string; months: number }> = {};
    let chromeVsPython: Record<string, { first: string; months: number }> = {};
    if (temporal) {
      const nodeAtChrome: Record<string, number[]> = {};
      for (const zone of Object.keys(temporal.offsets))
        nodeAtChrome[zone] = temporal.instants.map(t => zoneOffsetMs(t, zone) / 1000);
      nodeVsChrome = dataDifferences(temporal.instants, nodeAtChrome, temporal.offsets);
      chromeVsPython = dataDifferences(temporal.instants, temporal.offsets, py.offsets);
      for (const c of temporal.cases) {
        tCounts[c.kind] = (tCounts[c.kind] ?? 0) + 1;
        const dataSuspect = c.offsets
          ? zoneOffsetMs(c.start, c.zone) !== c.offsets[0] ||
            zoneOffsetMs(c.kind === 'add' ? c.expected! : c.end!, c.zone) !== c.offsets[1]
          : false;
        const push = (detail: string) =>
          mismatches.push({
            kind: `temporal:${c.kind}`,
            zone: c.zone,
            class: dataSuspect ? 'data' : 'unexplained',
            detail,
          });
        if (c.kind === 'add') {
          const r = addDuration({ epochMs: c.start, zone: c.zone }, durationOf(c.fields!, c.negative!), c.op!);
          if (!r.ok || r.epochMs !== c.expected)
            push(
              `${new Date(c.start).toISOString()} ${c.op} ${c.negative ? '-' : ''}${JSON.stringify(c.fields)} ours ${r.ok ? new Date(r.epochMs).toISOString() : r.message} temporal ${new Date(c.expected!).toISOString()}`,
            );
        } else if (c.kind === 'until') {
          const r = difference({ epochMs: c.start, zone: c.zone }, { epochMs: c.end!, zone: c.zone });
          const y = c.years!;
          const d = c.days!;
          const same =
            r.calendar.years === (y.years ?? 0) &&
            r.calendar.months === (y.months ?? 0) &&
            r.calendar.days === (y.days ?? 0) &&
            r.calendar.timeMs === timeOf(y) &&
            r.calendarDays.days === (d.days ?? 0) &&
            r.calendarDays.timeMs === timeOf(d) &&
            r.exactMs === BigInt(c.end! - c.start);
          if (!same)
            push(
              `${new Date(c.start).toISOString()} → ${new Date(c.end!).toISOString()} ours ${JSON.stringify({ ...r.calendar, timeMs: String(r.calendar.timeMs), days2: r.calendarDays.days })} temporal ${JSON.stringify(y)} / ${JSON.stringify(d)}`,
            );
        }
      }
    }

    const byClass = (cls: Row['class']) => mismatches.filter(m => m.class === cls);
    const report = {
      python: { tzdata: py.tzdata, zones: py.zones, missing: py.missing, cases: counts },
      temporal: temporal ? { userAgent: temporal.userAgent, cases: tCounts } : 'not generated',
      node: { version: process.versions.node, icu: process.versions.icu, tz: process.versions.tz },
      dataDifferences: { nodeVsPython, nodeVsChrome, chromeVsPython },
      mismatches: {
        data: byClass('data').length,
        dstRule: byClass('dst-rule').length,
        unexplained: byClass('unexplained').length,
      },
      rows: mismatches,
    };
    writeFileSync(join(STATE, 'crosscheck-report.json'), JSON.stringify(report, null, 1));
    // A summary for the person running it.
    process.stdout.write(
      `${JSON.stringify({ ...report, rows: undefined, dataDifferences: { nodeVsPython: Object.keys(nodeVsPython).length, nodeVsChrome: Object.keys(nodeVsChrome).length, chromeVsPython: Object.keys(chromeVsPython).length } }, null, 1)}\n`,
    );
    expect(byClass('unexplained')).toEqual([]);
  }, 600_000);
});
