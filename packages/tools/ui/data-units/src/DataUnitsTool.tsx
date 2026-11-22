/**
 * The Data Units tool's page (docs/tools/specs/data-units.md §8): Convert (one value in every unit), Transfer time (size,
 * rate and time — any one from the other two) and Config suffixes (how programs read a suffix). All rules are in
 * @workspace/tool-logic-data-units; the host wraps the page in the kit's ToolPage.
 *
 * History (D17, docs/tools/history.md §10): an edit that reads is a snapshot (`change`), a copy a commit; an opened entry
 * comes back into its task with its fields, and its reading and digits for the visit.
 *
 * Saved parameters (settings.ts; docs/tools/settings.md §3): the task, the reading of KB, MB, GB, the digits and what
 * Transfer time solves for; a paste opens Convert for the visit.
 */
import { convertDraft, readEntry, transferDraft } from './entries';
import { dataUnitsHistory } from './history';
import { Ladder, Lines } from './Ladder';
import { dataUnitsSettings } from './settings';
import {
  DIGITS,
  SUFFIXES,
  SUFFIXES_READ,
  errorText,
  ladder,
  parseValue,
  solveTransfer,
} from '@workspace/tool-logic-data-units';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { FieldReport, Solve, TransferFields } from '@workspace/tool-logic-data-units';
import type { HistoryDraft, SettingsValues, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

type Values = SettingsValues<typeof dataUnitsSettings>;
type Task = Values['task'];

const TASKS: readonly { id: Task; label: string }[] = [
  { id: 'convert', label: 'Convert' },
  { id: 'transfer', label: 'Transfer time' },
  { id: 'suffixes', label: 'Config suffixes' },
];
const SOLVES: readonly { id: Solve; label: string }[] = [
  { id: 'time', label: 'Time' },
  { id: 'rate', label: 'Rate' },
  { id: 'size', label: 'Size' },
];
const isTask = (v: string): v is Task => TASKS.some(t => t.id === v);
const isSolve = (v: string): v is Solve => SOLVES.some(t => t.id === v);

type Fields = Omit<TransferFields, 'solve'>;
const EMPTY_FIELDS: Fields = { size: '', rate: '', time: '', overhead: '' };

/** Under a field: its error, or its notes and the reading line (§6) — polite, it changes while typing. */
const Report = ({ id, report }: { id: string; report: FieldReport | null }): ReactElement => (
  <div id={id} role="status" className="flex flex-col gap-1">
    {report?.error ? (
      <ToolMessage tone="error" role={undefined}>
        {report.error}
      </ToolMessage>
    ) : (
      <>
        {report?.notes.map(note => (
          <ToolMessage key={note} role={undefined} data-note>
            {note}
          </ToolMessage>
        ))}
        {report?.reading && (
          <ToolMessage role={undefined} data-reading>
            {report.reading}
          </ToolMessage>
        )}
      </>
    )}
  </div>
);

const DataUnitsTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const handed = initial?.trim() ? initial : undefined;
  const saved = useSavedSettings(host, 'data-units', dataUnitsSettings, {
    opening: handed ? { task: 'convert' } : undefined,
  });
  const { task, reading, digits, solve } = saved.values;
  const [value, setValue] = useState(handed ?? '');
  const [fields, setFields] = useState<Fields>(EMPTY_FIELDS);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'data-units', dataUnitsHistory);

  const change = (draft: HistoryDraft | null): void => {
    if (draft) recorder.change(draft);
  };
  const copied = (): void => {
    const draft =
      task === 'convert'
        ? convertDraft({ value, reading, digits })
        : transferDraft({ ...fields, solve, reading, digits });
    if (draft) void recorder.commit(draft);
  };

  // Text handed over from the start page is the first edit of this visit.
  const first = useRef({ value, reading, digits });
  useEffect(() => {
    if (handed) change(convertDraft(first.current));
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
    const entry = readEntry(opened.entry.kind, opened.payload);
    if (!entry) {
      setRestored('This entry could not be opened.');
      return;
    }
    if (entry.task === 'convert') {
      setValue(entry.value);
      saved.visit({ task: 'convert', reading: entry.reading, digits: entry.digits });
    } else {
      setFields({ size: entry.size, rate: entry.rate, time: entry.time, overhead: entry.overhead });
      saved.visit({ task: 'transfer', reading: entry.reading, digits: entry.digits, solve: entry.solve });
    }
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  /** A person's change of a parameter: saved, and a snapshot of the task's work under it. */
  const setParameter = (next: Partial<Values>): void => {
    saved.set(next);
    setRestored(null);
    const r = next.reading ?? reading;
    const d = next.digits ?? digits;
    if (task === 'convert') change(convertDraft({ value, reading: r, digits: d }));
    if (task === 'transfer') change(transferDraft({ ...fields, solve: next.solve ?? solve, reading: r, digits: d }));
  };

  const converted = useMemo(() => {
    const parsed = parseValue(value, reading, digits);
    if (!parsed) return { report: null, sections: null };
    if (!parsed.ok) return { report: { error: errorText(parsed.error), notes: [] }, sections: null };
    const q = parsed.value;
    return {
      report: { notes: parsed.notes, ...(parsed.reading ? { reading: parsed.reading } : {}) },
      sections: ladder(q.bits, q.rate, q.unit?.base === 'bit' ? 'bit' : 'byte', digits),
    };
  }, [value, reading, digits]);

  const answer = useMemo(() => solveTransfer({ ...fields, solve }, reading, digits), [fields, solve, reading, digits]);

  const editField = (id: keyof Fields, text: string): void => {
    const next = { ...fields, [id]: text };
    setFields(next);
    setRestored(null);
    change(transferDraft({ ...next, solve, reading, digits }));
  };

  const field = (id: Exclude<keyof Fields, 'overhead'>, label: string, placeholder: string): ReactElement => (
    <div className="flex flex-col gap-1">
      <Label htmlFor={`data-units-${id}`}>{label}</Label>
      <Input
        id={`data-units-${id}`}
        className="max-w-96 font-mono text-code"
        spellCheck={false}
        autoComplete="off"
        autoCapitalize="off"
        placeholder={placeholder}
        aria-invalid={answer.fields[id]?.error ? true : undefined}
        aria-describedby={`data-units-${id}-message`}
        value={fields[id]}
        onChange={e => editField(id, e.target.value)}
      />
      <Report id={`data-units-${id}-message`} report={answer.fields[id] ?? null} />
    </div>
  );

  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Task"
          value={task}
          onValueChange={v => {
            if (isTask(v) && v !== task) {
              saved.set({ task: v });
              setRestored(null);
            }
          }}>
          {TASKS.map(t => (
            <ToggleGroupItem key={t.id} value={t.id}>
              {t.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {task !== 'suffixes' && (
          <>
            <span className="ml-2 text-muted-foreground" id="data-units-reading">
              Read KB, MB, GB as
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-labelledby="data-units-reading"
              value={reading}
              onValueChange={v => {
                if ((v === 'decimal' || v === 'binary') && v !== reading) setParameter({ reading: v });
              }}>
              <ToggleGroupItem value="decimal">Decimal (1000)</ToggleGroupItem>
              <ToggleGroupItem value="binary">Binary (1024)</ToggleGroupItem>
            </ToggleGroup>
            <Label htmlFor="data-units-digits" className="ml-2 text-muted-foreground">
              Digits
            </Label>
            <Select
              value={String(digits)}
              onValueChange={v => {
                const next = DIGITS.find(d => String(d) === v);
                if (next !== undefined && next !== digits) setParameter({ digits: next });
              }}>
              <SelectTrigger id="data-units-digits" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {DIGITS.map(d => (
                  <SelectItem key={String(d)} value={String(d)}>
                    {d === 'exact' ? 'Exact' : `${d} significant`}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </ToolOptions>

      {task === 'convert' && (
        <div className="flex flex-col gap-4" data-task="convert">
          <div className="flex flex-col gap-1">
            <Label htmlFor="data-units-value">Value</Label>
            <Input
              id="data-units-value"
              className="max-w-96 font-mono text-code"
              spellCheck={false}
              autoComplete="off"
              autoCapitalize="off"
              placeholder="1.5 GiB, 250 MB, 4096 or 100 Mbps"
              aria-invalid={converted.report?.error ? true : undefined}
              aria-describedby="data-units-value-hint data-units-value-message"
              value={value}
              onChange={e => {
                setValue(e.target.value);
                setRestored(null);
                change(convertDraft({ value: e.target.value, reading, digits }));
              }}
            />
            <p id="data-units-value-hint" className="text-muted-foreground">
              A size (1.5 GiB, 250 MB, 8 Mbit) or a rate (100 Mbps, 12.5 MB/s). A number alone is bytes; b is a bit, B a
              byte.
            </p>
            <Report id="data-units-value-message" report={converted.report} />
          </div>
          {converted.sections && <Ladder sections={converted.sections} onCopied={copied} />}
        </div>
      )}

      {task === 'transfer' && (
        <div className="flex flex-col gap-4" data-task="transfer">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-muted-foreground" id="data-units-solve">
              Solve for
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-labelledby="data-units-solve"
              value={solve}
              onValueChange={v => {
                if (isSolve(v) && v !== solve) setParameter({ solve: v });
              }}>
              {SOLVES.map(s => (
                <ToggleGroupItem key={s.id} value={s.id}>
                  {s.label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          </div>
          <div className="flex flex-col gap-3">
            {solve !== 'size' && field('size', 'Size', '4.7 GB')}
            {solve !== 'rate' && field('rate', 'Rate', '100 Mbps')}
            {solve !== 'time' && field('time', 'Time', '1 h 30 min or 1:30:00')}
            <div className="flex flex-col gap-1">
              <Label htmlFor="data-units-overhead">Overhead</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="data-units-overhead"
                  className="w-24 font-mono text-code"
                  spellCheck={false}
                  autoComplete="off"
                  inputMode="decimal"
                  placeholder="0"
                  aria-invalid={answer.fields.overhead?.error ? true : undefined}
                  aria-describedby="data-units-overhead-hint data-units-overhead-message"
                  value={fields.overhead}
                  onChange={e => editField('overhead', e.target.value)}
                />
                <span className="text-muted-foreground">%</span>
              </div>
              <p id="data-units-overhead-hint" className="text-muted-foreground">
                Share of the rate lost to protocol overhead (headers, retransmits); leave empty if unknown.
              </p>
              <Report id="data-units-overhead-message" report={answer.fields.overhead ?? null} />
            </div>
          </div>
          {answer.result?.kind === 'time' && (
            <Lines rows={answer.result.rows} label="Transfer time" onCopied={copied} />
          )}
          {answer.result?.kind === 'ladder' && (
            <div className="flex flex-col gap-3" data-part="solved">
              <h3 className="font-medium">{answer.result.title}</h3>
              <Lines rows={answer.result.rows} label={answer.result.title} onCopied={copied} />
              <Ladder sections={answer.result.sections} onCopied={copied} />
            </div>
          )}
        </div>
      )}

      {task === 'suffixes' && (
        <div className="flex flex-col gap-3" data-task="suffixes">
          <p className="text-muted-foreground">
            How programs read size suffixes, from each program&apos;s own documentation (read {SUFFIXES_READ}). The same
            letter means different things: K is 1024 in GNU dd, k is 1000 in Redis, m is a thousandth of a byte in
            Kubernetes.
          </p>
          <Table aria-label="Config suffixes">
            <TableHeader>
              <TableRow>
                <TableHead>Program</TableHead>
                <TableHead>Writes</TableHead>
                <TableHead>Means</TableHead>
                <TableHead>Source</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {SUFFIXES.map(row => (
                <TableRow key={row.program}>
                  <TableCell>{row.program}</TableCell>
                  <TableCell className="font-mono text-code">{row.writes}</TableCell>
                  <TableCell>{row.means}</TableCell>
                  <TableCell className="text-muted-foreground">{row.source}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
};

export default DataUnitsTool;
