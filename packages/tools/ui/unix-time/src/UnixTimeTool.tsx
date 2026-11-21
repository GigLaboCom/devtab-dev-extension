/**
 * The Unix Time tool's page (docs/tools/specs/unix-time.md §8): one field for a timestamp or a date with Now and Clear,
 * how it was read (notes) or why not (the error), Unit and Time zone, then every form of the instant with its copy
 * button. All rules are in @workspace/tool-logic-unix-time; the host wraps the page in the kit's ToolPage.
 *
 * The page itself does not follow the clock: an empty field shows the time now through `LiveResults` and
 * `LiveZoneLine`, a filled one has only its Relative row ticking (Results.tsx).
 *
 * History (D17, docs/tools/history.md §10): an edit of the field, the unit or the zone that reads as an instant is a
 * snapshot (`change`); Now and a copied row are commits; an entry the host opens comes back as the field, the unit and
 * the zone.
 */
import { convertDraft, readConvertPayload } from './entries';
import { unixTimeHistory } from './history';
import { EmptyResults, FixedResults, LiveResults, LiveZoneLine, ZoneLine } from './Results';
import {
  browserTimeZone,
  formatIsoUtc,
  nowText,
  parseInput,
  resolveTimeZone,
  unitApplies,
  zoneOptions,
} from '@workspace/tool-logic-unix-time';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Combobox } from '@workspace/ui/combobox';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useRef, useState } from 'react';
import type { ConvertPayload } from './entries';
import type { ParsedInput, UnitOption } from '@workspace/tool-logic-unix-time';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ComboboxRows } from '@workspace/ui/combobox';
import type { ReactElement } from 'react';

const UNITS: Array<{ value: UnitOption; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 's', label: 'Seconds' },
  { value: 'ms', label: 'Milliseconds' },
  { value: 'us', label: 'Microseconds' },
  { value: 'ns', label: 'Nanoseconds' },
];
const SHOWING_NOW = 'Showing the current time.';
const NO_MATCH = 'No time zones match.';

type State = { input: string; unit: UnitOption; zone: string };

const draftOf = ({ input, unit, zone }: State, parsed: ParsedInput): HistoryDraft | null => {
  if (!parsed.ok || parsed.empty) return null;
  const payload: ConvertPayload = {
    input,
    unit,
    timeZone: zone,
    epochNs: String(parsed.epochNs),
    isoUtc: formatIsoUtc(parsed.epochNs),
  };
  return convertDraft(payload);
};

const UnixTimeTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const field = useRef<HTMLInputElement>(null);
  const [input, setInput] = useState(initial ?? '');
  const [unit, setUnit] = useState<UnitOption>('auto');
  const [zone, setZone] = useState(browserTimeZone);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'unix-time', unixTimeHistory);

  // Cheap (§12: ≈ 0.1 ms) and no clock in it: once per render of the page, which does not tick.
  const parsed = parseInput(input, { timeZone: zone, unit });
  const state: State = { input, unit, zone };

  const edit = (next: Partial<State>): void => {
    const after = { ...state, ...next };
    if (next.input !== undefined) setInput(next.input);
    if (next.unit !== undefined) setUnit(next.unit);
    if (next.zone !== undefined) setZone(next.zone);
    setRestored(null);
    const draft = draftOf(after, parseInput(after.input, { timeZone: after.zone, unit: after.unit }));
    if (draft) recorder.change(draft);
  };

  // Text handed over from the start page is the first edit of this visit.
  const handed = useRef({ input: initial ?? '', unit, zone });
  useEffect(() => {
    const first = handed.current;
    const draft = draftOf(first, parseInput(first.input, { timeZone: first.zone, unit: first.unit }));
    if (draft) recorder.change(draft);
  }, [recorder]);

  const now = (): void => {
    const text = nowText(Date.now(), unit);
    const after = { ...state, input: text };
    setInput(text);
    setRestored(null);
    field.current?.focus();
    const draft = draftOf(after, parseInput(text, { timeZone: zone, unit }));
    if (draft) void recorder.commit(draft);
  };

  const clear = (): void => {
    setInput('');
    setRestored(null);
    field.current?.focus();
  };

  const copied = (): void => {
    const draft = draftOf(state, parsed);
    if (draft) void recorder.commit(draft);
  };

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
    const p = readConvertPayload(opened.payload);
    setInput(p.input);
    setUnit(p.unit);
    setZone((p.timeZone && resolveTimeZone(p.timeZone)) || browserTimeZone());
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  // The zone picker's rows, for the instant shown when it opens (§8): the browser's zone and UTC first.
  const zoneRows = (): ComboboxRows => {
    const at = parsed.ok && !parsed.empty ? Number(parsed.epochNs / 1_000_000n) : Date.now();
    const options = zoneOptions(at);
    const mine = browserTimeZone();
    const find = (value: string) => options.find(o => o.value === value);
    const pinned = [{ ...find(mine)!, badge: 'Your time zone' }, ...(mine === 'UTC' ? [] : [find('UTC')!])].filter(
      item => item.value !== undefined,
    );
    return { pinned, rest: options };
  };

  const messages = !parsed.ok ? (
    <ToolMessage tone="error" role={undefined}>
      {parsed.message}
    </ToolMessage>
  ) : parsed.empty ? (
    <ToolMessage role={undefined}>{SHOWING_NOW}</ToolMessage>
  ) : (
    parsed.notes.map(note => (
      <ToolMessage key={note} role={undefined}>
        {note}
      </ToolMessage>
    ))
  );

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="unix-time-input">Timestamp or date</Label>
        <div className="flex items-center gap-2">
          <Input
            ref={field}
            id="unix-time-input"
            className="flex-1 font-mono text-code"
            placeholder="1700000000, 1700000000000 or 2023-11-14T22:13:20Z"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-describedby="unix-time-messages"
            aria-invalid={parsed.ok ? undefined : true}
            value={input}
            onChange={e => edit({ input: e.target.value })}
          />
          <Button variant="outline" onClick={now}>
            Now
          </Button>
          <Button variant="ghost" onClick={clear} disabled={input === ''}>
            Clear
          </Button>
        </div>
        {/* Changes while typing: read out politely (status), as the recipe says — never an alert per keystroke. */}
        <div id="unix-time-messages" role="status" className="flex flex-col">
          {messages}
        </div>
      </div>

      <ToolOptions className="items-start">
        <div className="flex items-center gap-2">
          <Label htmlFor="unix-time-unit" className="text-muted-foreground">
            Unit
          </Label>
          <Select
            value={unit}
            disabled={!unitApplies(input)}
            onValueChange={value => edit({ unit: value as UnitOption })}>
            <SelectTrigger id="unix-time-unit" className="min-w-36">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {UNITS.map(u => (
                <SelectItem key={u.value} value={u.value}>
                  {u.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-2 flex items-start gap-2">
          <Label htmlFor="unix-time-zone" className="mt-2 text-muted-foreground">
            Time zone
          </Label>
          <div className="flex w-80 max-w-full flex-col gap-1">
            <Combobox
              id="unix-time-zone"
              value={zone}
              onValueChange={value => edit({ zone: value })}
              items={zoneRows}
              listLabel="Time zones"
              empty={NO_MATCH}
              aria-describedby="unix-time-zone-line"
            />
            {parsed.ok && !parsed.empty ? (
              <ZoneLine id="unix-time-zone-line" epochNs={parsed.epochNs} zone={zone} />
            ) : (
              <LiveZoneLine id="unix-time-zone-line" zone={zone} />
            )}
          </div>
        </div>
      </ToolOptions>

      {!parsed.ok ? (
        <EmptyResults zone={zone} />
      ) : parsed.empty ? (
        <LiveResults zone={zone} />
      ) : (
        <FixedResults epochNs={parsed.epochNs} zone={zone} onCopied={copied} />
      )}
    </div>
  );
};

export default UnixTimeTool;
