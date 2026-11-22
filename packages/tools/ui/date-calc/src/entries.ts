/**
 * The Date Calculator's history entries (schema 1 of `dateCalcHistory`, docs/tools/specs/date-calc.md §11): one kind per
 * part, its payload, the label for the History list, and reading a payload back field by field (a damaged entry falls
 * back to defaults; a zone this browser does not know — to the browser's). Loaded with the component.
 */
import { differenceView, shiftView, zonesView } from './model';
import { MAX_ZONES, resolveTimeZone } from '@workspace/tool-logic-date-calc';
import type { DifferenceState, Field, ShiftState, ZonesState } from './model';
import type { HistoryDraft } from '@workspace/tools-host';

const clip = (text: string, n = 40): string => {
  const t = text.trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** "2024-03-01 → 2024-04-01 · P1M · PT743H"; null while the part has no result. */
export const differenceDraft = (s: DifferenceState): HistoryDraft | null => {
  const view = differenceView(s);
  if (!view.rows) return null;
  return {
    kind: 'difference',
    payload: { from: s.from, to: s.to, calendar: view.calendarIso ?? '', exact: view.exactIso ?? '' },
    label: `${clip(s.from.text)} → ${clip(s.to.text)} · ${view.calendarIso} · ${view.exactIso}`,
    text: `${s.from.text}\n${s.to.text}\n${view.calendarIso}\n${view.exactIso}`.slice(0, 2000),
  };
};

/** "2024-01-31T10:00:00Z + P1M → 2024-02-29T10:00:00+00:00". */
export const shiftDraft = (s: ShiftState): HistoryDraft | null => {
  const view = shiftView(s);
  if (!view.rows) return null;
  const op = s.operation === 'add' ? '+' : '−';
  return {
    kind: 'shift',
    payload: { start: s.start, duration: s.duration, operation: s.operation, result: view.resultIso ?? '' },
    label: `${clip(s.start.text)} ${op} ${view.durationIso} → ${view.resultIso}`,
    text: `${s.start.text}\n${s.duration}\n${view.resultIso}`.slice(0, 2000),
  };
};

/** "2024-03-31T10:30:00Z in Europe/Berlin, UTC, Asia/Tokyo". */
export const zonesDraft = (s: ZonesState): HistoryDraft | null => {
  const view = zonesView(s);
  if (!view.copyAll) return null;
  return {
    kind: 'zones',
    payload: { moment: s.moment, zones: s.zones },
    label: `${clip(s.moment.text)} in ${clip(s.zones.join(', '), 120)}`,
    text: `${s.moment.text}\n${s.zones.join('\n')}`.slice(0, 2000),
  };
};

const zoneOr = (value: unknown, fallback: string): string =>
  (typeof value === 'string' && resolveTimeZone(value)) || fallback;

const fieldOf = (value: unknown, fallbackZone: string): Field => {
  const f = (value ?? {}) as Partial<Record<keyof Field, unknown>>;
  return { text: typeof f.text === 'string' ? f.text : '', zone: zoneOr(f.zone, fallbackZone) };
};

export type Restored =
  | { part: 'difference'; state: DifferenceState }
  | { part: 'shift'; state: ShiftState }
  | { part: 'zones'; state: ZonesState };

/** An opened entry back into its part's state. */
export const readEntry = (kind: string, payload: unknown, browserZone: string): Restored | null => {
  const p = (payload ?? {}) as Record<string, unknown>;
  if (kind === 'difference')
    return { part: 'difference', state: { from: fieldOf(p.from, browserZone), to: fieldOf(p.to, browserZone) } };
  if (kind === 'shift')
    return {
      part: 'shift',
      state: {
        start: fieldOf(p.start, browserZone),
        duration: typeof p.duration === 'string' ? p.duration : '',
        operation: p.operation === 'subtract' ? 'subtract' : 'add',
      },
    };
  if (kind === 'zones') {
    const zones = Array.isArray(p.zones)
      ? [...new Set(p.zones.map(z => (typeof z === 'string' ? resolveTimeZone(z) : null)).filter(z => z !== null))]
      : [];
    return { part: 'zones', state: { moment: fieldOf(p.moment, browserZone), zones: zones.slice(0, MAX_ZONES) } };
  }
  return null;
};
