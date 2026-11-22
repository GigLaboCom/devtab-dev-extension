/**
 * The JSON and CSV tool's page (docs/tools/specs/json-csv.md §8): the direction, the delimiter, Header row, Swap and
 * Open file on the first line; the direction's options on the second; input and result side by side, the input's
 * state under it (an error is a link to its place) and the notes under the result. Up to LIVE_INPUT characters the
 * result follows every change, computed on the page; above it Run (or Ctrl+Enter) converts in the tool's worker
 * (runner.ts); above MAX_INPUT the input is refused (§12). A text too large for the input field stays in memory behind
 * a card; a result too large for the result field is a summary with Copy and Save (§3).
 *
 * It records into the tool history through its host: an edit snapshot with its result when the input or an option
 * changes (`change`), and a commit when the result is taken — Copy, Save, Swap — both only for an input up to
 * RECORD_LIMIT characters (entries.ts: a larger table is not recorded at all). An entry the host asks to open comes
 * back as the input, the direction and every option. The page frame is the host's.
 */
import { convertWithSize, sameJob } from './conversion';
import { DEFAULT_OPTIONS, draftOf, isDirection, isLayout, readEntry } from './entries';
import { jsonCsvHistory } from './history';
import { createRunner } from './runner';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SHOW_RESULT_CHARS,
  SHOW_RESULT_LINES,
  decodeTextFile,
  describeNotes,
  describeTable,
  detectCsv,
  formatMegabytes,
  measureText,
  withBom,
} from '@workspace/tool-logic-json-csv';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConvertJob, Done } from './conversion';
import type { Direction, JsonCsvOptionsPayload, JsonCsvPayload } from './history';
import type { Delimiter, Layout, ToCsvOptions, ToJsonOptions } from '@workspace/tool-logic-json-csv';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

const DELIMITER_ITEMS: Array<{ value: string; delimiter: Delimiter; label: string }> = [
  { value: 'comma', delimiter: ',', label: 'Comma' },
  { value: 'semicolon', delimiter: ';', label: 'Semicolon' },
  { value: 'tab', delimiter: '\t', label: 'Tab' },
  { value: 'pipe', delimiter: '|', label: 'Pipe' },
];
const valueOfDelimiter = (d: Delimiter | 'auto'): string =>
  d === 'auto' ? 'auto' : DELIMITER_ITEMS.find(i => i.delimiter === d)!.value;
const delimiterOfValue = (v: string): Delimiter | 'auto' | null =>
  v === 'auto' ? 'auto' : (DELIMITER_ITEMS.find(i => i.value === v)?.delimiter ?? null);

const LAYOUTS: Array<{ value: Layout; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
  { value: 'minify', label: 'Minified' },
];
const EMPTY_ITEMS: Array<{ value: ToJsonOptions['empty']; label: string }> = [
  { value: 'null', label: 'null' },
  { value: 'string', label: 'Empty string' },
  { value: 'omit', label: 'Leave out' },
];

const TOO_LARGE = 'Input is larger than 32 MB. This tool converts up to 32 MB.';
const LARGE = 'Large input: press Run (Ctrl+Enter) to convert it.';
const NOT_UTF8 = 'The file is not valid UTF-8 text. Save it from the spreadsheet as "CSV UTF-8".';
const ACCEPT = '.json,.csv,.tsv,.txt,application/json,text/csv';

/** A text that does not go into the input field (§3): it stays in memory, the card shows its name and size. */
interface LoadedFile {
  name: string;
  bytes: number;
  text: string;
}

/** Does a text go into a field (§3, §12): up to SHOW_RESULT_CHARS characters and SHOW_RESULT_LINES lines. */
const fitsField = (text: string, lines?: number): boolean =>
  text.length <= SHOW_RESULT_CHARS && (lines ?? measureText(text).lines) <= SHOW_RESULT_LINES;

const save = (text: string, name: string, type: string): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

/** A checkbox with its label on one line of the options. */
const Option = ({
  id,
  checked,
  onChange,
  children,
}: {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  children: ReactNode;
}): ReactElement => (
  <div className="ml-2 flex items-center gap-2">
    <Checkbox id={id} checked={checked} onCheckedChange={value => onChange(value === true)} />
    <Label htmlFor={id} className="font-normal">
      {children}
    </Label>
  </div>
);

const JsonCsvTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [file, setFile] = useState<LoadedFile | null>(null);
  // Text handed over from the start page was recognised as CSV (detectCsv): it is there to become JSON.
  const [direction, setDirection] = useState<Direction>(() => (initial && detectCsv(initial) ? 'to-json' : 'to-csv'));
  const [header, setHeader] = useState(DEFAULT_OPTIONS.header);
  const [csv, setCsv] = useState(DEFAULT_OPTIONS.toCsv);
  const [json, setJson] = useState(DEFAULT_OPTIONS.toJson);
  /** What went wrong opening a file (too large, not UTF-8) or running. */
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  /** The last Run's job and what it gave. */
  const [ran, setRan] = useState<{ job: ConvertJob; done: Done } | null>(null);
  const [working, setWorking] = useState<ConvertJob | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { history, recorder } = useToolHistory(host, 'json-csv', jsonCsvHistory);

  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.dispose(), [runner]);

  const toCsv = direction === 'to-csv';
  const source = file?.text ?? input;
  const job = useMemo<ConvertJob>(() => {
    if (direction === 'to-csv') {
      const options: ToCsvOptions = {
        delimiter: csv.delimiter,
        header,
        flatten: csv.flatten,
        newline: csv.newline === 'lf' ? '\n' : '\r\n',
        quoteAll: csv.quoteAll,
        protectFormulas: csv.protectFormulas,
      };
      return { direction, text: source, options };
    }
    const options: ToJsonOptions = { ...json, header };
    return { direction, text: source, options };
  }, [direction, source, header, csv, json]);
  const blank = source.trim() === '';
  const tooLarge = source.length > MAX_INPUT;
  const large = !tooLarge && source.length > LIVE_INPUT;

  // Live up to LIVE_INPUT: the result follows every change, on the page (a few milliseconds, §12).
  const live = useMemo(() => (blank || tooLarge || large ? null : convertWithSize(job)), [job, blank, tooLarge, large]);
  const current = live ?? (ran && sameJob(ran.job, job) ? ran.done : null);

  // A change while Run is under way makes it out of date: stop it.
  useEffect(() => {
    if (working && !sameJob(working, job)) {
      runner.cancel();
      setWorking(null);
    }
  }, [job, working, runner]);

  /** What an entry keeps besides the texts: the direction and every option. */
  const kept = useMemo<JsonCsvOptionsPayload>(
    () => ({ direction, header, toCsv: csv, toJson: json }),
    [direction, header, csv, json],
  );

  // A person's edit — or the text handed over from the start page — is recorded with its result; opening an entry is not.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || !current) return;
    const draft = draftOf(job, current, kept);
    if (draft) recorder.change(draft);
  }, [recorder, job, current, kept]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };

  const take = (action: NonNullable<JsonCsvPayload['action']>): void => {
    if (!current) return;
    const draft = draftOf(job, current, kept, action);
    if (draft) void recorder.commit(draft);
  };

  const run = useCallback((): void => {
    if (!large || working) return;
    const next = job;
    setWorking(next);
    runner.run(next).then(
      done => {
        if (!done) return;
        setRan({ job: next, done });
        setWorking(null);
      },
      (error: unknown) => {
        // The worker died (out of memory, a crash): no result and no place, only why.
        setWorking(null);
        setMessage(`The conversion stopped: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }, [large, working, job, runner]);

  /** A text goes into the field, or behind a card when the field would not take it (§3). */
  const place = (text: string, name: string, bytes: number): void => {
    if (fitsField(text)) {
      setFile(null);
      setInput(text);
    } else {
      setFile({ name, bytes, text });
      setInput('');
    }
  };

  const openFile = async (picked: File): Promise<void> => {
    if (picked.size > MAX_INPUT) {
      edit(() => setMessage(TOO_LARGE));
      return;
    }
    const decoded = decodeTextFile(new Uint8Array(await picked.arrayBuffer()));
    if (!decoded.ok) {
      edit(() => setMessage(NOT_UTF8));
      return;
    }
    const name = picked.name.toLowerCase();
    edit(() => {
      place(decoded.text, picked.name, picked.size);
      if (name.endsWith('.json')) setDirection('to-csv');
      else if (name.endsWith('.csv')) setDirection('to-json');
      else if (name.endsWith('.tsv')) {
        setDirection('to-json');
        setJson(j => ({ ...j, delimiter: '\t' }));
      }
    });
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
    const entry = readEntry(opened.entry.kind, opened.payload);
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setMessage(null);
      place(text, 'History entry', measureText(text).bytes);
      setDirection(entry.direction);
      setHeader(entry.header);
      setCsv(entry.toCsv);
      setJson(entry.toJson);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const goTo = (offset: number, line: number): void => {
    const el = field.current;
    if (!el) return;
    // Focus and caret on the place; the field scrolls to its line (a third from the top).
    el.focus();
    el.setSelectionRange(offset, offset);
    const height = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (line - 1) * height - el.clientHeight / 3);
  };

  const result = current?.result ?? null;
  const output = result?.ok ? result.text : '';
  const fits = !current?.size || fitsField(output, current.size.lines);
  const notes = result?.ok ? describeNotes(result.notes) : [];
  const taken = output !== '';

  const swap = (): void => {
    if (!result?.ok || output === '') return;
    take('swap');
    const next = output;
    const used = 'delimiter' in result.notes ? result.notes.delimiter : csv.delimiter;
    edit(() => {
      place(next, toCsv ? 'converted.csv' : 'converted.json', measureText(next).bytes);
      if (toCsv) {
        // The CSV just written goes back with the delimiter it was written with.
        setJson(j => ({ ...j, delimiter: csv.delimiter }));
        setDirection('to-json');
      } else {
        setCsv(c => ({ ...c, delimiter: used }));
        setDirection('to-csv');
      }
    });
  };

  const saveName = toCsv ? (csv.delimiter === '\t' ? 'converted.tsv' : 'converted.csv') : 'converted.json';
  const saveType = toCsv ? (csv.delimiter === '\t' ? 'text/tab-separated-values' : 'text/csv') : 'application/json';

  let status: ReactElement | string = ' ';
  let tone: 'error' | 'note' | 'success' = 'note';
  if (message) [status, tone] = [message, 'error'];
  else if (blank) status = ' ';
  else if (tooLarge) [status, tone] = [TOO_LARGE, 'error'];
  else if (!result) status = LARGE;
  else if (!result.ok) {
    const { line, column, message: what, offset } = result.error;
    const words = `Line ${line}, column ${column}: ${what}`;
    tone = 'error';
    status = file ? (
      <span className="inline-flex items-center gap-1" data-part="error">
        <CircleAlertIcon aria-hidden="true" className="size-4" />
        {words}
      </span>
    ) : (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(offset, line)}>
        <CircleAlertIcon aria-hidden="true" />
        {words}
      </Button>
    );
  } else
    [status, tone] = [
      'protectedCells' in result.notes
        ? 'Valid JSON'
        : `Valid CSV: ${describeTable(result.notes.rows, result.notes.columns)}`,
      'success',
    ];

  const inputName = toCsv ? 'JSON' : 'CSV';
  const outputName = toCsv ? 'CSV' : 'JSON';
  const delimiter = toCsv ? csv.delimiter : json.delimiter;
  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        {large && (
          <Button disabled={working !== null} onClick={run}>
            {working ? 'Working…' : 'Run'}
          </Button>
        )}
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={direction}
          onValueChange={value => {
            if (isDirection(value) && value !== direction) edit(() => setDirection(value));
          }}>
          <ToggleGroupItem value="to-csv">JSON → CSV</ToggleGroupItem>
          <ToggleGroupItem value="to-json">CSV → JSON</ToggleGroupItem>
        </ToggleGroup>
        <Label htmlFor="json-csv-delimiter" className="ml-2 text-muted-foreground">
          Delimiter
        </Label>
        <Select
          value={valueOfDelimiter(delimiter)}
          onValueChange={value => {
            const next = delimiterOfValue(value);
            if (next === null) return;
            if (toCsv && next !== 'auto') edit(() => setCsv(c => ({ ...c, delimiter: next })));
            else if (!toCsv) edit(() => setJson(j => ({ ...j, delimiter: next })));
          }}>
          <SelectTrigger id="json-csv-delimiter" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {!toCsv && <SelectItem value="auto">Auto</SelectItem>}
            {DELIMITER_ITEMS.map(item => (
              <SelectItem key={item.value} value={item.value}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Option id="json-csv-header" checked={header} onChange={v => edit(() => setHeader(v))}>
          Header row
        </Option>
        <Button variant="outline" className="ml-auto" disabled={!taken || working !== null} onClick={swap}>
          Swap
        </Button>
        <Button variant="outline" onClick={() => picker.current?.click()}>
          Open file
        </Button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-part="file-input"
          onChange={e => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) void openFile(picked);
          }}
        />
      </ToolOptions>
      <ToolOptions data-part="direction-options">
        {toCsv ? (
          <>
            <Option
              id="json-csv-flatten"
              checked={csv.flatten}
              onChange={v => edit(() => setCsv(c => ({ ...c, flatten: v })))}>
              Flatten nested objects
            </Option>
            <Label htmlFor="json-csv-newline" className="ml-2 text-muted-foreground">
              Line breaks
            </Label>
            <Select
              value={csv.newline}
              onValueChange={value => {
                if (value === 'crlf' || value === 'lf') edit(() => setCsv(c => ({ ...c, newline: value })));
              }}>
              <SelectTrigger id="json-csv-newline" className="min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="crlf">CRLF</SelectItem>
                <SelectItem value="lf">LF</SelectItem>
              </SelectContent>
            </Select>
            <Option
              id="json-csv-quote-all"
              checked={csv.quoteAll}
              onChange={v => edit(() => setCsv(c => ({ ...c, quoteAll: v })))}>
              Quote all fields
            </Option>
            <Option
              id="json-csv-formulas"
              checked={csv.protectFormulas}
              onChange={v => edit(() => setCsv(c => ({ ...c, protectFormulas: v })))}>
              Protect from formulas
            </Option>
            <Option id="json-csv-bom" checked={csv.bom} onChange={v => edit(() => setCsv(c => ({ ...c, bom: v })))}>
              Add BOM (for Excel)
            </Option>
          </>
        ) : (
          <>
            <Option
              id="json-csv-types"
              checked={json.detectTypes}
              onChange={v => edit(() => setJson(j => ({ ...j, detectTypes: v })))}>
              Detect types
            </Option>
            <Label htmlFor="json-csv-empty" className="ml-2 text-muted-foreground">
              Empty cells
            </Label>
            <Select
              value={json.empty}
              onValueChange={value => {
                const next = EMPTY_ITEMS.find(i => i.value === value)?.value;
                if (next) edit(() => setJson(j => ({ ...j, empty: next })));
              }}>
              <SelectTrigger id="json-csv-empty" className="min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {EMPTY_ITEMS.map(item => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Option
              id="json-csv-nest"
              checked={json.nest}
              onChange={v => edit(() => setJson(j => ({ ...j, nest: v })))}>
              Nest dotted headers
            </Option>
            <Label htmlFor="json-csv-indent" className="ml-2 text-muted-foreground">
              Indent
            </Label>
            <Select
              value={String(json.layout)}
              onValueChange={value => {
                const next = value === 'tab' || value === 'minify' ? value : Number(value);
                if (isLayout(next)) edit(() => setJson(j => ({ ...j, layout: next })));
              }}>
              <SelectTrigger id="json-csv-indent" className="min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LAYOUTS.map(item => (
                  <SelectItem key={String(item.value)} value={String(item.value)}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label={inputName} htmlFor={file ? undefined : 'json-csv-input'}>
          {file ? (
            <div
              className="flex h-90 flex-col items-start justify-center gap-2 rounded-md border border-dashed border-border px-4"
              data-part="file">
              <p className="m-0 font-mono text-code">{`${file.name} — ${formatMegabytes(file.bytes)}`}</p>
              <Button variant="ghost" size="sm" onClick={() => edit(() => setFile(null))}>
                Clear
              </Button>
            </div>
          ) : (
            <Textarea
              ref={field}
              id="json-csv-input"
              className={code}
              spellCheck={false}
              placeholder={toCsv ? '[{"id": 1, "name": "Ann"}]' : 'id,name\n1,Ann'}
              value={input}
              onChange={e => {
                const next = e.target.value;
                edit(() => setInput(next));
              }}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && large) {
                  e.preventDefault();
                  run();
                }
              }}
            />
          )}
          {/* Changes while typing: read out politely (status), never as an alert on every keystroke. */}
          <ToolMessage tone={tone} role="status" data-part="status">
            {status}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label={outputName}
          htmlFor={fits ? 'json-csv-output' : undefined}
          actions={
            <>
              <CopyButton value={output} onCopied={() => take('copy')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!taken}
                onClick={() => {
                  save(toCsv && csv.bom ? withBom(output) : output, saveName, saveType);
                  take('save');
                }}>
                Save
              </Button>
            </>
          }>
          {fits ? (
            <Textarea id="json-csv-output" className={code} spellCheck={false} readOnly value={output} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-part="summary">
              {`Result: ${formatMegabytes(current!.size!.bytes)}, ${current!.size!.lines.toLocaleString('en-US')} lines. Too large to show here.`}
            </p>
          )}
          {notes.length === 0 ? (
            <ToolMessage data-part="note" />
          ) : (
            notes.map(note => (
              <ToolMessage key={note} data-part="note">
                {note}
              </ToolMessage>
            ))
          )}
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default JsonCsvTool;
