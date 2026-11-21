/**
 * The Cron tool's page (docs/tools/specs/cron.md §8): the expression with how it was read (Read as) or why not (the
 * error, with its column), Dialect, Time zone and Runs, the description in words with its notes, and the next runs. All
 * rules are in @workspace/tool-logic-cron; the host wraps the page in the kit's ToolPage.
 *
 * The page does not follow the clock: only the next runs do (Runs.tsx), so typing and the description are not
 * rendered again every second.
 *
 * History (D17, docs/tools/history.md §10): an edit of the expression, the dialect, the zone or the number of runs that
 * reads is a snapshot (`change`); Copy description and Copy runs are commits; an entry the host opens comes back as the
 * expression and the three options.
 */
import { explainDraft, readExplainPayload } from './entries';
import { cronHistory } from './history';
import { NextRuns } from './Runs';
import {
  browserTimeZone,
  describeCron,
  errorText,
  MAX_INPUT,
  NO_DESCRIPTION,
  NOTE_TEXTS,
  parseCron,
  readAsText,
  resolveTimeZone,
  RUN_COUNTS,
  TOO_LONG,
  zoneOptions,
} from '@workspace/tool-logic-cron';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Combobox } from '@workspace/ui/combobox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { ExplainPayload } from './entries';
import type { DialectOption, ParsedCron } from '@workspace/tool-logic-cron';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ComboboxRows } from '@workspace/ui/combobox';
import type { ReactElement } from 'react';

const DIALECTS: Array<{ value: DialectOption; label: string }> = [
  { value: 'auto', label: 'Auto' },
  { value: 'unix', label: 'Unix cron (5 fields)' },
  { value: 'seconds', label: 'With seconds (6 fields)' },
  { value: 'quartz', label: 'Quartz (6–7 fields)' },
];
const NO_MATCH = 'No time zones match.';
/** §4: UTC — the zone most schedules that are read here run in (GitHub Actions, Kubernetes, servers). */
const DEFAULT_ZONE = 'UTC';
const DEFAULT_RUNS = 10;

type State = { input: string; dialect: DialectOption; zone: string; runs: number };

/** What the field holds: nothing, an error to show, or an expression read. */
type Reading =
  | { kind: 'empty' }
  | { kind: 'error'; text: string }
  | { kind: 'read'; cron: ParsedCron; readAs: string; description: string | null };

const read = (input: string, dialect: DialectOption): Reading => {
  if (input.trim() === '') return { kind: 'empty' };
  if (input.length > MAX_INPUT) return { kind: 'error', text: TOO_LONG };
  const parsed = parseCron(input, dialect);
  if (!parsed.ok) return { kind: 'error', text: errorText(input, parsed.message, parsed.offset) };
  return { kind: 'read', cron: parsed.cron, readAs: readAsText(parsed.cron), description: describeCron(parsed.cron) };
};

const draftOf = (state: State, reading: Reading): HistoryDraft | null => {
  if (reading.kind !== 'read') return null;
  const payload: ExplainPayload = {
    expression: state.input,
    dialect: state.dialect,
    timeZone: state.zone,
    runs: state.runs,
    readAs: reading.readAs,
    description: reading.description,
  };
  return explainDraft(payload);
};

const CronTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [dialect, setDialect] = useState<DialectOption>('auto');
  const [zone, setZone] = useState(DEFAULT_ZONE);
  const [runs, setRuns] = useState(DEFAULT_RUNS);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'cron', cronHistory);

  // A few microseconds to a millisecond (cronstrue included): once per change of the field or the dialect.
  const reading = useMemo(() => read(input, dialect), [input, dialect]);
  const state: State = { input, dialect, zone, runs };

  const edit = (next: Partial<State>): void => {
    const after = { ...state, ...next };
    if (next.input !== undefined) setInput(next.input);
    if (next.dialect !== undefined) setDialect(next.dialect);
    if (next.zone !== undefined) setZone(next.zone);
    if (next.runs !== undefined) setRuns(next.runs);
    setRestored(null);
    const draft = draftOf(after, read(after.input, after.dialect));
    if (draft) recorder.change(draft);
  };

  // Text handed over from the start page is the first edit of this visit.
  const handed = useRef<State>({ input: initial ?? '', dialect, zone, runs });
  useEffect(() => {
    const first = handed.current;
    const draft = draftOf(first, read(first.input, first.dialect));
    if (draft) recorder.change(draft);
  }, [recorder]);

  const copied = (): void => {
    const draft = draftOf(state, reading);
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
    const p = readExplainPayload(opened.payload);
    setInput(p.expression);
    setDialect(p.dialect);
    setZone((p.timeZone && resolveTimeZone(p.timeZone)) || DEFAULT_ZONE);
    setRuns(p.runs);
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  // The zone picker's rows, with their offsets now (§8): the browser's zone and UTC first.
  const zoneRows = (): ComboboxRows => {
    const options = zoneOptions(Date.now());
    const mine = browserTimeZone();
    const find = (value: string) => options.find(o => o.value === value);
    const pinned = [{ ...find(mine)!, badge: 'Your time zone' }, ...(mine === 'UTC' ? [] : [find('UTC')!])].filter(
      item => item.value !== undefined,
    );
    return { pinned, rest: options };
  };

  const description = reading.kind === 'read' ? (reading.description ?? NO_DESCRIPTION) : '';
  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <div className="flex flex-col gap-1">
        <Label htmlFor="cron-input">Expression</Label>
        <Input
          id="cron-input"
          className="font-mono text-code"
          placeholder="0 9 * * 1-5"
          spellCheck={false}
          autoComplete="off"
          autoCapitalize="off"
          aria-describedby="cron-read-as"
          aria-invalid={reading.kind === 'error' ? true : undefined}
          value={input}
          onChange={e => edit({ input: e.target.value })}
        />
        {/* Changes while typing: read out politely (status), as the recipe says — never an alert per keystroke. */}
        <div id="cron-read-as" role="status" className="flex flex-col">
          {reading.kind === 'error' ? (
            <ToolMessage tone="error" role={undefined}>
              {reading.text}
            </ToolMessage>
          ) : reading.kind === 'read' ? (
            <ToolMessage role={undefined}>Read as: {reading.readAs}</ToolMessage>
          ) : (
            <ToolMessage role={undefined} />
          )}
        </div>
      </div>

      <ToolOptions className="items-start">
        <div className="flex items-center gap-2">
          <Label htmlFor="cron-dialect" className="text-muted-foreground">
            Dialect
          </Label>
          <Select value={dialect} onValueChange={value => edit({ dialect: value as DialectOption })}>
            <SelectTrigger id="cron-dialect" className="min-w-52">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DIALECTS.map(d => (
                <SelectItem key={d.value} value={d.value}>
                  {d.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="ml-2 flex items-center gap-2">
          <Label htmlFor="cron-zone" className="text-muted-foreground">
            Time zone
          </Label>
          <Combobox
            id="cron-zone"
            className="w-72 max-w-full"
            value={zone}
            onValueChange={value => edit({ zone: value })}
            items={zoneRows}
            listLabel="Time zones"
            empty={NO_MATCH}
          />
        </div>
        <div className="ml-2 flex items-center gap-2">
          <Label htmlFor="cron-runs" className="text-muted-foreground">
            Runs
          </Label>
          <Select value={String(runs)} onValueChange={value => edit({ runs: Number(value) })}>
            <SelectTrigger id="cron-runs" className="min-w-20">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {RUN_COUNTS.map(n => (
                <SelectItem key={n} value={String(n)}>
                  {n}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </ToolOptions>

      <div className="flex flex-col gap-1" data-description-block="">
        <div className="flex min-h-8 items-start justify-between gap-3">
          <p data-description="" className="m-0 min-w-0 text-base text-foreground">
            {description}
          </p>
          <CopyButton label="Copy description" value={description} onCopied={copied} />
        </div>
        {/* The notes change with the expression: read out politely, once. */}
        <div role="status" className="flex flex-col" data-notes="">
          {reading.kind === 'read' &&
            reading.cron.notes.map(note => (
              <ToolMessage key={note} role={undefined}>
                {NOTE_TEXTS[note]}
              </ToolMessage>
            ))}
        </div>
      </div>

      <NextRuns cron={reading.kind === 'read' ? reading.cron : null} zone={zone} count={runs} onCopied={copied} />
    </div>
  );
};

export default CronTool;
