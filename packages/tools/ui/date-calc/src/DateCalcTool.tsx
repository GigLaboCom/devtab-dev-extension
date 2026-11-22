/**
 * The Date Calculator's page (docs/tools/specs/date-calc.md §8): Difference, Add or subtract, Time zones — three parts on
 * one page, each with its own moment fields and zones. All rules are in @workspace/tool-logic-date-calc; what each part
 * shows is model.ts; the host wraps the page in the kit's ToolPage.
 *
 * Nothing follows the clock: an empty field shows nothing, and Now writes the current second into the field (§5.9).
 *
 * History (D17, docs/tools/history.md §10): one kind per part — an edit after which the part has a result is a snapshot
 * (`change`), a copy in the part a commit; an entry the host opens comes back into its own part only.
 *
 * Saved parameters (settings.ts; docs/tools/settings.md): the list of time zones and Add or Subtract open as the person
 * left them where the host remembers them; an opened entry shows its own for the visit without changing what is saved.
 */
import { differenceDraft, readEntry, shiftDraft, zonesDraft } from './entries';
import { dateCalcHistory } from './history';
import { differenceView, emptyField, shiftView, zonesView } from './model';
import { DifferencePart, ShiftPart, ZonesPart } from './Parts';
import { dateCalcSettings } from './settings';
import { browserTimeZone, handOver } from '@workspace/tool-logic-date-calc';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { ToolMessage } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { DifferenceState, ShiftState, ZonesState } from './model';
import type { HistoryDraft, SettingsValues, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

interface Start {
  difference: DifferenceState;
  shift: ShiftState;
  zones: ZonesState;
}

/**
 * The state the page opens with (docs/defaults.md §3) — the zone list and the operation as saved — with text handed
 * over from the start page in its part.
 */
const startState = (initial: string | undefined, saved: SettingsValues<typeof dateCalcSettings>): Start => {
  const zone = browserTimeZone();
  const start: Start = {
    difference: { from: emptyField(zone), to: emptyField(zone) },
    shift: { start: emptyField(zone), duration: '', operation: saved.operation },
    zones: { moment: emptyField(zone), zones: [...saved.zones] },
  };
  if (!initial?.trim()) return start;
  const handed = handOver(initial);
  if (handed.part === 'add') start.shift.duration = handed.duration;
  else if (handed.part === 'difference') {
    start.difference.from.text = handed.from;
    start.difference.to.text = handed.to;
  } else start.zones.moment.text = handed.moment;
  return start;
};

const DateCalcTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const saved = useSavedSettings(host, 'date-calc', dateCalcSettings, {
    // The reset control: the list and the operation back to the defaults; the moments and the duration stay.
    onReset: defaults => {
      setShift(s => ({ ...s, operation: defaults.operation }));
      setZones(z => ({ ...z, zones: [...defaults.zones] }));
    },
  });
  const [first] = useState(() => startState(initial, saved.values));
  const [difference, setDifference] = useState(first.difference);
  const [shift, setShift] = useState(first.shift);
  const [zones, setZones] = useState(first.zones);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'date-calc', dateCalcHistory);

  const change = (draft: HistoryDraft | null): void => {
    if (draft) recorder.change(draft);
  };
  const commit = (draft: HistoryDraft | null): void => {
    if (draft) void recorder.commit(draft);
  };

  // Text handed over from the start page is the first edit of this visit.
  const handed = useRef(first);
  useEffect(() => {
    const s = handed.current;
    if (!initial?.trim()) return;
    change(differenceDraft(s.difference));
    change(shiftDraft(s.shift));
    change(zonesDraft(s.zones));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, for the text handed over
  }, [recorder]);

  useRestore(history, restore, opened => {
    if (!opened.ok) {
      setRestored(
        opened.reason === 'locked'
          ? 'This entry is encrypted: unlock the history to open it.'
          : opened.reason === 'newer-schema'
            ? 'This entry was kept by a newer version of the tool.'
            : 'This entry could not be opened.',
      );
      return;
    }
    const entry = readEntry(opened.entry.kind, opened.payload, browserTimeZone());
    if (!entry) {
      setRestored('This entry could not be opened.');
      return;
    }
    // The entry's operation or zone list is for this visit: what is saved stays as it was.
    if (entry.part === 'difference') setDifference(entry.state);
    else if (entry.part === 'shift') {
      setShift(entry.state);
      saved.visit({ operation: entry.state.operation });
    } else {
      setZones(entry.state);
      saved.visit({ zones: entry.state.zones });
    }
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  // Each part's view only when its own state changes: typing in one part does not recount the others (§12).
  const differenceShown = useMemo(() => differenceView(difference), [difference]);
  const shiftShown = useMemo(() => shiftView(shift), [shift]);
  const zonesShown = useMemo(() => zonesView(zones), [zones]);

  return (
    <div className="flex flex-col gap-6">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <DifferencePart
        state={difference}
        view={differenceShown}
        onChange={next => {
          setDifference(next);
          setRestored(null);
          change(differenceDraft(next));
        }}
        onCopied={() => commit(differenceDraft(difference))}
      />
      <ShiftPart
        state={shift}
        view={shiftShown}
        onChange={next => {
          if (next.operation !== shift.operation) saved.set({ operation: next.operation });
          setShift(next);
          setRestored(null);
          change(shiftDraft(next));
        }}
        onCopied={() => commit(shiftDraft(shift))}
      />
      <ZonesPart
        state={zones}
        view={zonesShown}
        onChange={next => {
          if (next.zones !== zones.zones) saved.set({ zones: next.zones });
          setZones(next);
          setRestored(null);
          change(zonesDraft(next));
        }}
        onCopied={() => commit(zonesDraft(zones))}
      />
    </div>
  );
};

export default DateCalcTool;
