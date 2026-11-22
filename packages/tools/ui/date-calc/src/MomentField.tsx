/**
 * A moment field (docs/tools/specs/date-calc.md §3, §8): the text, its zone (the kit's searchable list, the browser's
 * zone and UTC pinned first) and Now; under them, in one status region, how the text was read and the notes, or the error.
 * The page uses it four times: From, To, Start, Moment.
 */
import { browserTimeZone, nowText, zoneOptions } from '@workspace/tool-logic-date-calc';
import { Button } from '@workspace/ui/button';
import { Combobox } from '@workspace/ui/combobox';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ToolMessage } from '@workspace/ui/tool-page';
import { useRef } from 'react';
import type { Field } from './model';
import type { MomentResult } from '@workspace/tool-logic-date-calc';
import type { ComboboxRows } from '@workspace/ui/combobox';
import type { ReactElement } from 'react';

export const NO_ZONE_MATCH = 'No time zones match.';
const PLACEHOLDER = '2024-03-31T14:30, 2024-03-31 or 1711895400';

/** The zone picker's rows for the instant shown when it opens: the browser's zone and UTC first (unix-time §8). */
export const zoneRows = (at: number): ComboboxRows => {
  const options = zoneOptions(at);
  const mine = browserTimeZone();
  const find = (value: string) => options.find(o => o.value === value);
  const pinned = [
    ...(find(mine) ? [{ ...find(mine)!, badge: 'Your time zone' }] : []),
    ...(mine === 'UTC' || !find('UTC') ? [] : [find('UTC')!]),
  ];
  return { pinned, rest: options };
};

/** Messages under a field: `Read as …` and the notes, muted; or the error. */
export const Messages = ({ id, lines, error }: { id: string; lines: string[]; error?: string }): ReactElement => (
  // Changes while typing: read out politely (status), as the recipe says — never an alert per keystroke.
  <div id={id} role="status" className="flex flex-col" data-messages>
    {error ? (
      <ToolMessage tone="error" role={undefined}>
        {error}
      </ToolMessage>
    ) : (
      lines.map(line => (
        <ToolMessage key={line} role={undefined}>
          {line}
        </ToolMessage>
      ))
    )}
  </div>
);

interface MomentFieldProps {
  id: string;
  label: string;
  value: Field;
  result: MomentResult;
  onChange: (next: Field) => void;
}

export const MomentField = ({ id, label, value, result, onChange }: MomentFieldProps): ReactElement => {
  const input = useRef<HTMLInputElement>(null);
  const messagesId = `${id}-messages`;
  const at = result.ok && !result.empty ? result.moment.epochMs : Date.now();
  return (
    <div className="flex flex-col gap-1" data-moment={id}>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex flex-wrap items-center gap-2">
        <Input
          ref={input}
          id={id}
          className="min-w-64 flex-1 font-mono text-code"
          placeholder={PLACEHOLDER}
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-describedby={messagesId}
          aria-invalid={result.ok ? undefined : true}
          value={value.text}
          onChange={e => onChange({ ...value, text: e.target.value })}
        />
        <label htmlFor={`${id}-zone`} className="sr-only">
          {`${label} time zone`}
        </label>
        <Combobox
          id={`${id}-zone`}
          className="w-64 max-w-full"
          value={value.zone}
          onValueChange={zone => onChange({ ...value, zone })}
          items={() => zoneRows(at)}
          listLabel="Time zones"
          empty={NO_ZONE_MATCH}
        />
        <Button
          variant="outline"
          aria-label={`Now: ${label}`}
          onClick={() => {
            onChange({ ...value, text: nowText(Date.now(), value.zone) });
            input.current?.focus();
          }}>
          Now
        </Button>
      </div>
      <Messages
        id={messagesId}
        lines={result.ok && !result.empty ? [result.readAs, ...result.notes] : []}
        error={result.ok ? undefined : result.message}
      />
    </div>
  );
};
