/**
 * The state of the three parts (docs/tools/specs/date-calc.md §3–§5) and what each part shows for it — pure, computed on
 * every render (cheap: a few dozen Intl calls). The page keeps the state; history drafts and restoring read it here.
 */
import {
  MAX_ZONES,
  addDuration,
  difference,
  dstText,
  formatCalendar,
  formatExact,
  formatIsoUtc,
  isoCalendar,
  isoDuration,
  isoExact,
  parseDuration,
  parseMoment,
  rfc9557,
  total,
  zoneRow,
} from '@workspace/tool-logic-date-calc';
import type { MomentResult, Operation, TotalUnit, ZoneRow } from '@workspace/tool-logic-date-calc';

/** A moment field: the text as typed and the zone chosen beside it. */
export type Field = {
  text: string;
  zone: string;
};
export interface DifferenceState {
  from: Field;
  to: Field;
}
export interface ShiftState {
  start: Field;
  duration: string;
  operation: Operation;
}
export interface ZonesState {
  moment: Field;
  zones: string[];
}

export const emptyField = (zone: string): Field => ({ text: '', zone });

/** One result row: its label, the value shown, what Copy copies, the copy button's name. */
export interface Row {
  key: string;
  label: string;
  shown: string;
  copy: string;
  copyLabel: string;
}

/** "Calendar days" → "calendar days"; names that keep their capital (ISO, Unix) stay. */
const lowerFirst = (text: string): string =>
  /^(?:ISO|Unix)\b/.test(text) ? text : `${text[0]!.toLowerCase()}${text.slice(1)}`;
const row = (key: string, label: string, shown: string, copy = shown): Row => ({
  key,
  label,
  shown,
  copy,
  copyLabel: `Copy ${lowerFirst(label)}`,
});

const read = (field: Field): MomentResult => parseMoment(field.text, field.zone);

const TOTALS: Array<[TotalUnit, string]> = [
  ['days', 'Total days'],
  ['hours', 'Total hours'],
  ['minutes', 'Total minutes'],
  ['seconds', 'Total seconds'],
  ['milliseconds', 'Total milliseconds'],
];

export interface DifferenceView {
  from: MomentResult;
  to: MomentResult;
  rows: Row[] | null;
  notes: string[];
  /** For history: the two ISO durations. */
  calendarIso?: string;
  exactIso?: string;
}

/** §5.6 for the Difference part. */
export const differenceView = (s: DifferenceState): DifferenceView => {
  const from = read(s.from);
  const to = read(s.to);
  if (!from.ok || from.empty || !to.ok || to.empty) return { from, to, rows: null, notes: [] };
  const d = difference(from.moment, to.moment);
  const calendarIso = isoCalendar(d.calendar);
  const exactIso = isoExact(d.exactMs);
  const rows = [
    row('calendar', 'Calendar', formatCalendar(d.calendar)),
    row(
      'calendarDays',
      'Calendar days',
      formatCalendar({ years: 0, months: 0, days: d.calendarDays.days, timeMs: d.calendarDays.timeMs }),
    ),
    row('exact', 'Exact', formatExact(d.exactMs)),
    ...TOTALS.map(([unit, label]) => {
      const t = total(d.exactMs, unit);
      return row(`total-${unit}`, label, t.text, t.value);
    }),
    row('isoCalendar', 'ISO 8601, calendar', calendarIso),
    row('isoExact', 'ISO 8601, exact', exactIso),
  ];
  return { from, to, rows, notes: d.notes, calendarIso, exactIso };
};

export interface ShiftView {
  start: MomentResult;
  duration: ReturnType<typeof parseDuration>;
  rows: Row[] | null;
  notes: string[];
  error?: string;
  resultIso?: string;
  durationIso?: string;
}

const WEEKDAY = (epochMs: number, zone: string): string => zoneRow(epochMs, zone).weekday;

/** §5.5 for the Add or subtract part. */
export const shiftView = (s: ShiftState): ShiftView => {
  const start = read(s.start);
  const duration = parseDuration(s.duration);
  if (!start.ok || start.empty || !duration.ok || duration.empty) return { start, duration, rows: null, notes: [] };
  const r = addDuration(start.moment, duration.duration, s.operation);
  if (!r.ok) return { start, duration, rows: null, notes: [], error: r.message };
  const zone = start.moment.zone;
  const inZone = zoneRow(r.epochMs, zone).iso;
  const utc = formatIsoUtc(BigInt(r.epochMs) * 1_000_000n);
  const rows = [
    { ...row('result', `Result, ${zone}`, inZone), copyLabel: `Copy result in ${zone}` },
    ...(zone === 'UTC' ? [] : [{ ...row('resultUtc', 'Result, UTC', utc), copyLabel: 'Copy result in UTC' }]),
    row('weekday', 'Day of week', WEEKDAY(r.epochMs, zone)),
    row('seconds', 'Unix seconds', String(Math.floor(r.epochMs / 1000))),
    row('milliseconds', 'Unix milliseconds', String(r.epochMs)),
    { ...row('elapsed', 'Elapsed (exact)', formatExact(r.elapsedMs)), copyLabel: 'Copy elapsed time' },
  ];
  return { start, duration, rows, notes: r.notes, resultIso: inZone, durationIso: isoDuration(duration.duration) };
};

export interface ZonesView {
  moment: MomentResult;
  rows: Array<{ zone: string; row: ZoneRow | null; dst: string }>;
  copyAll: string;
}

/** §5.7 for the Time zones part: rows without a moment show only the zone. */
export const zonesView = (s: ZonesState): ZonesView => {
  const moment = read(s.moment);
  const at = moment.ok && !moment.empty ? moment.moment.epochMs : null;
  const rows = s.zones.map(zone => {
    const r = at === null ? null : zoneRow(at, zone);
    return { zone, row: r, dst: r ? dstText(r.dst) : '' };
  });
  return { moment, rows, copyAll: at === null ? '' : s.zones.map(zone => rfc9557(at, zone)).join('\n') };
};

/** Adding a zone to the list (§5.7): the reason it is refused, or null. */
export const addZoneRefusal = (zones: readonly string[], zone: string): string | null =>
  zones.includes(zone)
    ? `${zone} is already in the list.`
    : zones.length >= MAX_ZONES
      ? `The list holds up to ${MAX_ZONES} time zones.`
      : null;
