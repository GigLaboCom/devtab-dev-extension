/**
 * The three parts of the page (docs/tools/specs/date-calc.md §8): Difference, Add or subtract, Time zones. Each gets its
 * state and its view (model.ts) from the page, says edits through `onChange` and copies through `onCopied` (a history
 * commit of its kind).
 */
import { addZoneRefusal } from './model';
import { MomentField, Messages, NO_ZONE_MATCH, zoneRows } from './MomentField';
import { Button } from '@workspace/ui/button';
import { Combobox } from '@workspace/ui/combobox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage } from '@workspace/ui/tool-page';
import { ArrowDownIcon, ArrowUpIcon, XIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import type { DifferenceState, DifferenceView, Row, ShiftState, ShiftView, ZonesState, ZonesView } from './model';
import type { Operation } from '@workspace/tool-logic-date-calc';
import type { ReactElement, ReactNode } from 'react';

const Section = ({ id, title, children }: { id: string; title: string; children: ReactNode }): ReactElement => (
  <section aria-labelledby={`${id}-title`} className="flex flex-col gap-3" data-part={id}>
    <h3 id={`${id}-title`} className="text-base font-semibold text-foreground">
      {title}
    </h3>
    {children}
  </section>
);

const Rows = ({ rows, onCopied }: { rows: Row[]; onCopied: () => void }): ReactElement => (
  <ResultRows className="max-w-3xl">
    {rows.map(r => (
      <ResultRow
        key={r.key}
        data-row={r.key}
        label={r.label}
        value={r.shown}
        outputLabel={r.label}
        copyLabel={r.copyLabel}
        copy={{ value: r.copy, resetAfterMs: 2000, onCopied }}
      />
    ))}
  </ResultRows>
);

const Notes = ({ notes }: { notes: string[] }): ReactElement | null =>
  notes.length === 0 ? null : (
    <div role="status" className="flex max-w-3xl flex-col" data-notes>
      {notes.map(note => (
        <ToolMessage key={note} role={undefined}>
          {note}
        </ToolMessage>
      ))}
    </div>
  );

export const DifferencePart = ({
  state,
  view,
  onChange,
  onCopied,
}: {
  state: DifferenceState;
  view: DifferenceView;
  onChange: (next: DifferenceState) => void;
  onCopied: () => void;
}): ReactElement => (
  <Section id="date-calc-difference" title="Difference">
    <MomentField
      id="date-calc-from"
      label="From"
      value={state.from}
      result={view.from}
      onChange={from => onChange({ ...state, from })}
    />
    <MomentField
      id="date-calc-to"
      label="To"
      value={state.to}
      result={view.to}
      onChange={to => onChange({ ...state, to })}
    />
    {view.rows && <Rows rows={view.rows} onCopied={onCopied} />}
    <Notes notes={view.notes} />
  </Section>
);

export const ShiftPart = ({
  state,
  view,
  onChange,
  onCopied,
}: {
  state: ShiftState;
  view: ShiftView;
  onChange: (next: ShiftState) => void;
  onCopied: () => void;
}): ReactElement => {
  const d = view.duration;
  return (
    <Section id="date-calc-shift" title="Add or subtract">
      <MomentField
        id="date-calc-start"
        label="Start"
        value={state.start}
        result={view.start}
        onChange={start => onChange({ ...state, start })}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="date-calc-duration">Duration</Label>
        <div className="flex flex-wrap items-center gap-2">
          <ToggleGroup
            type="single"
            variant="segmented"
            aria-label="Operation"
            value={state.operation}
            onValueChange={value => {
              if ((value === 'add' || value === 'subtract') && value !== state.operation)
                onChange({ ...state, operation: value as Operation });
            }}>
            <ToggleGroupItem value="add">Add</ToggleGroupItem>
            <ToggleGroupItem value="subtract">Subtract</ToggleGroupItem>
          </ToggleGroup>
          <Input
            id="date-calc-duration"
            className="min-w-64 flex-1 font-mono text-code"
            placeholder="1h30m, 90 min, 2 weeks, -3d or P3DT4H"
            spellCheck={false}
            autoComplete="off"
            autoCapitalize="off"
            aria-describedby="date-calc-duration-messages"
            aria-invalid={d.ok ? undefined : true}
            value={state.duration}
            onChange={e => onChange({ ...state, duration: e.target.value })}
          />
        </div>
        <Messages
          id="date-calc-duration-messages"
          lines={d.ok && !d.empty ? [d.readAs, ...d.notes] : []}
          error={d.ok ? undefined : d.message}
        />
      </div>
      {view.error && (
        <ToolMessage tone="error" role="status" data-shift-error>
          {view.error}
        </ToolMessage>
      )}
      {view.rows && <Rows rows={view.rows} onCopied={onCopied} />}
      <Notes notes={view.notes} />
    </Section>
  );
};

type Focus = { zone: string; action: 'up' | 'down' | 'remove' } | { zone: null; action: 'add' } | null;

export const ZonesPart = ({
  state,
  view,
  onChange,
  onCopied,
}: {
  state: ZonesState;
  view: ZonesView;
  onChange: (next: ZonesState) => void;
  onCopied: () => void;
}): ReactElement => {
  const [refusal, setRefusal] = useState<string | null>(null);
  const [focus, setFocus] = useState<Focus>(null);
  const table = useRef<HTMLDivElement>(null);
  const at = view.moment.ok && !view.moment.empty ? view.moment.moment.epochMs : Date.now();

  // After a move or a removal the focus stays with the row it acted on (§8).
  useEffect(() => {
    if (!focus) return;
    const root = table.current?.closest('[data-part]');
    const target =
      focus.zone === null
        ? root?.querySelector<HTMLInputElement>('#date-calc-add-zone')
        : [
            ...(root?.querySelectorAll<HTMLButtonElement>(`[data-zone-row] button[data-action="${focus.action}"]`) ??
              []),
          ].find(b => b.closest<HTMLElement>('[data-zone-row]')?.dataset.zoneRow === focus.zone);
    target?.focus();
    setFocus(null);
  }, [focus]);

  const add = (zone: string): void => {
    const refused = addZoneRefusal(state.zones, zone);
    setRefusal(refused);
    if (!refused) onChange({ ...state, zones: [...state.zones, zone] });
  };
  const move = (index: number, by: -1 | 1): void => {
    const zones = [...state.zones];
    const [zone] = zones.splice(index, 1);
    zones.splice(index + by, 0, zone!);
    const after = index + by;
    const atEdge = by < 0 ? after === 0 : after === zones.length - 1;
    setRefusal(null);
    onChange({ ...state, zones });
    setFocus({ zone: zone!, action: atEdge ? (by < 0 ? 'down' : 'up') : by < 0 ? 'up' : 'down' });
  };
  const remove = (index: number): void => {
    const zones = state.zones.filter((_, i) => i !== index);
    setRefusal(null);
    onChange({ ...state, zones });
    const next = zones[index] ?? zones[index - 1];
    setFocus(next ? { zone: next, action: 'remove' } : { zone: null, action: 'add' });
  };

  return (
    <Section id="date-calc-zones" title="Time zones">
      <MomentField
        id="date-calc-moment"
        label="Moment"
        value={state.moment}
        result={view.moment}
        onChange={moment => onChange({ ...state, moment })}
      />
      <div className="flex flex-col gap-1">
        <Label htmlFor="date-calc-add-zone">Add a time zone</Label>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Combobox
            id="date-calc-add-zone"
            className="w-64 max-w-full"
            value=""
            onValueChange={add}
            items={() => zoneRows(at)}
            listLabel="Time zones"
            empty={NO_ZONE_MATCH}
            aria-describedby="date-calc-add-zone-messages"
          />
          <CopyButton label="Copy all" value={view.copyAll} onCopied={onCopied} />
        </div>
        <Messages id="date-calc-add-zone-messages" lines={refusal ? [refusal] : []} />
      </div>
      <div ref={table}>
        {state.zones.length === 0 ? (
          <ToolMessage role={undefined} data-empty-zones>
            No time zones in the list: add one above.
          </ToolMessage>
        ) : (
          <Table aria-label="Time zones">
            <TableHeader>
              <TableRow>
                <TableHead>Time zone</TableHead>
                <TableHead>Local time</TableHead>
                <TableHead>Offset</TableHead>
                <TableHead>Daylight saving</TableHead>
                <TableHead>
                  <span className="sr-only">Actions</span>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.rows.map(({ zone, row, dst }, index) => (
                <TableRow key={zone} data-zone-row={zone}>
                  <TableCell>
                    <div className="font-mono text-code">{zone}</div>
                    {row && <div className="text-sm text-muted-foreground">{row.longName}</div>}
                  </TableCell>
                  <TableCell>
                    {row && (
                      <>
                        <div className="font-mono text-code" data-local>
                          {row.iso}
                        </div>
                        <div className="text-sm text-muted-foreground">{row.weekday}</div>
                      </>
                    )}
                  </TableCell>
                  <TableCell className="font-mono text-code" data-offset>
                    {row?.offset}
                  </TableCell>
                  <TableCell data-dst>{dst}</TableCell>
                  <TableCell>
                    <div className="flex items-center gap-1">
                      <CopyButton
                        icon
                        size="icon-sm"
                        label={`Copy time in ${zone}`}
                        resetAfterMs={2000}
                        value={row?.iso ?? ''}
                        onCopied={onCopied}
                      />
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-action="up"
                        aria-label={`Move ${zone} up`}
                        disabled={index === 0}
                        onClick={() => move(index, -1)}>
                        <ArrowUpIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-action="down"
                        aria-label={`Move ${zone} down`}
                        disabled={index === state.zones.length - 1}
                        onClick={() => move(index, 1)}>
                        <ArrowDownIcon aria-hidden="true" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        data-action="remove"
                        aria-label={`Remove ${zone}`}
                        onClick={() => remove(index)}>
                        <XIcon aria-hidden="true" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Time zone rules come from this browser. Dates far in the future follow today&apos;s rules.
      </p>
    </Section>
  );
};
