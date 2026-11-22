/**
 * The SQL Formatter's page (docs/tools/specs/sql-format.md §8): Dialect, Keyword case, Indent and Layout, Run and
 * Cancel, Open file; the query and the formatted result side by side, the query's state under it (an error is a link to
 * its place) and under the result the line that formatting does not check. Formatting runs in the worker of the chosen
 * dialect (runner.ts, workers.ts): 150 ms after the last edit up to LIVE_INPUT characters, by Run up to MAX_INPUT,
 * refused above (§12); a run past the time limit is stopped. It records into the tool history through its host: an
 * edit snapshot with its result (`change`), and a commit when the result is taken or asked for — Copy, Save, Run; an
 * entry the host asks to open comes back as the query and its options. The page frame is the host's.
 */
import { entryLabel, excerpt, INDENT_LABELS, KEYWORD_CASE_LABELS, kindOf, LAYOUT_LABELS, payloadOf } from './entries';
import { sqlFormatHistory } from './history';
import { SqlRunner } from './runner';
import { startSqlWorker } from './workers';
import {
  DEFAULT_OPTIONS,
  DIALECTS,
  DIALECT_LABELS,
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  SHOW_RESULT_CHARS,
  SHOW_RESULT_LINES,
  TIME_LIMIT_MS,
  decodeTextFile,
  describeError,
  isDialect,
  isIndent,
  isKeywordCase,
  isLayout,
} from '@workspace/tool-logic-sql-format';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { SqlFormatPayload } from './entries';
import type { WorkerLike } from './runner';
import type { SqlDialect, SqlIndent, SqlLayout, SqlOptions, SqlResult } from '@workspace/tool-logic-sql-format';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const TOO_LARGE = 'Input is larger than 2 MB. This tool formats up to 2 MB.';
const LARGE = 'Large input: press Run (Ctrl+Enter) to format it.';
const NOT_CHECKED = "Formatting doesn't check that the query is valid.";
const TIMED_OUT = `Formatting took longer than ${TIME_LIMIT_MS / 1000} seconds and was stopped.`;
const ACCEPT = '.sql,text/plain';
const INDENTS: SqlIndent[] = [2, 4, 'tab'];
const LAYOUTS: SqlLayout[] = ['standard', 'tabularLeft', 'tabularRight'];

interface Job {
  text: string;
  options: SqlOptions;
}

interface Done {
  job: Job;
  result: SqlResult;
}

const lineCount = (text: string): number => {
  let lines = 1;
  for (let i = text.indexOf('\n'); i !== -1; i = text.indexOf('\n', i + 1)) lines++;
  return lines;
};

const formatSize = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const sqlBlob = (value: string): Blob => new Blob([value], { type: 'application/sql' });

const draftOf = (done: Done, action?: SqlFormatPayload['action']): HistoryDraft | null => {
  const { job, result } = done;
  if (job.text.trim() === '') return null;
  const payload = payloadOf(job.options, result, action);
  const output = result.ok ? result.text : '';
  return {
    kind: kindOf(job.text),
    payload,
    label: entryLabel(payload, job.text.length),
    text: excerpt(job.text, output),
    blobs: output === '' ? { input: sqlBlob(job.text) } : { input: sqlBlob(job.text), output: sqlBlob(output) },
  };
};

const save = (text: string): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(sqlBlob(text));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'formatted.sql';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

export interface SqlFormatToolProps extends ToolProps {
  /** Where a dialect's worker comes from: the package's files by default, a fake in a test. */
  startWorker?: (dialect: SqlDialect) => WorkerLike;
}

const SqlFormatTool = ({
  input: initial,
  host,
  restore,
  startWorker = startSqlWorker,
}: SqlFormatToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [options, setOptions] = useState<SqlOptions>(DEFAULT_OPTIONS);
  const [done, setDone] = useState<Done | null>(null);
  const [working, setWorking] = useState<Job | null>(null);
  const [loading, setLoading] = useState<SqlDialect | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { history, recorder } = useToolHistory(host, 'sql-format', sqlFormatHistory);

  const runner = useMemo(() => new SqlRunner(startWorker, { onLoading: setLoading }), [startWorker]);
  useEffect(() => () => runner.dispose(), [runner]);

  const job = useMemo<Job>(() => ({ text: input, options }), [input, options]);
  const blank = input.trim() === '';
  const tooLarge = input.length > MAX_INPUT;
  const large = !tooLarge && input.length > LIVE_INPUT;

  // Run (and the history's commit of it) is remembered per job: its result is committed once it is there.
  const ran = useRef<Job | null>(null);
  const latest = useRef<Job | null>(null);
  const start = useCallback(
    (next: Job, shown: boolean): void => {
      latest.current = next;
      if (shown) setWorking(next);
      void runner.run(next.text, next.options, { restart: shown }).then(outcome => {
        if (latest.current !== next || outcome.kind === 'cancelled') return;
        setWorking(null);
        if (outcome.kind === 'done') {
          setMessage(null);
          setDone({ job: next, result: outcome.result });
        } else {
          setDone(null);
          setMessage(outcome.kind === 'timeout' ? TIMED_OUT : `The formatter stopped: ${outcome.message}`);
        }
      });
    },
    [runner],
  );

  const cancel = useCallback((): void => {
    runner.cancel();
    latest.current = null;
    ran.current = null;
    setWorking(null);
  }, [runner]);

  // Live: 150 ms after the last edit, up to LIVE_INPUT. A large input waits for Run; an edit stops a Run under way.
  const runOnce = useRef(false);
  useEffect(() => {
    if (working && working !== job) cancel();
    if (blank || tooLarge || large) {
      if (runOnce.current && large) start(job, true);
      runOnce.current = false;
      if (blank || tooLarge) {
        runner.cancel();
        latest.current = null;
      }
      return;
    }
    runOnce.current = false;
    const timer = setTimeout(() => start(job, false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [job, blank, tooLarge, large, working, start, cancel, runner]);

  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusCancel = useRef(false);
  useEffect(() => {
    if (working && focusCancel.current) cancelButton.current?.focus();
    focusCancel.current = false;
  }, [working]);

  const run = (): void => {
    if (blank || tooLarge) return;
    ran.current = job;
    start(job, large);
  };

  const current = done && done.job === job ? done.result : null;
  // While a small input settles, the previous result stays (no flicker); a large one waits for Run.
  const shown = current ?? (!blank && !tooLarge && !large && done ? done.result : null);
  const stale = shown !== null && shown !== current;
  const output = !blank && shown?.ok ? shown.text : '';
  const fits = useMemo(() => output.length <= SHOW_RESULT_CHARS && lineCount(output) <= SHOW_RESULT_LINES, [output]);
  const summary = useMemo(
    () =>
      fits
        ? ''
        : `Result: ${formatSize(new TextEncoder().encode(output).length)}, ${lineCount(output).toLocaleString('en-US')} lines. Too large to show here.`,
    [fits, output],
  );

  // A person's edit (or text handed over from the start page) is recorded once its result is there; a Run at once.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!done) return;
    if (ran.current === done.job) {
      ran.current = null;
      const draft = draftOf(done, 'run');
      if (draft) void recorder.commit(draft);
      return;
    }
    if (!edited.current) return;
    const draft = draftOf(done);
    if (draft) recorder.change(draft);
  }, [recorder, done]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };

  const setOption = (patch: Partial<SqlOptions>): void =>
    edit(() =>
      setOptions(previous => {
        const next = { ...previous, ...patch };
        // §5 п. 3: Tabular aligns with spaces; Tab is not offered with it.
        if (next.layout !== 'standard' && next.indent === 'tab') next.indent = 2;
        return next;
      }),
    );

  const take = (action: 'copy' | 'save'): void => {
    if (!current || !done) return;
    const draft = draftOf(done, action);
    if (draft) void recorder.commit(draft);
  };

  const openFile = async (file: File): Promise<void> => {
    // UTF-8 takes up to 3 bytes for a character of the BMP: a larger file cannot fit the limit in characters.
    if (file.size > MAX_INPUT * 3) {
      edit(() => setMessage(TOO_LARGE));
      return;
    }
    const decoded = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
    if (!decoded.ok) {
      edit(() => setMessage(decoded.message));
      return;
    }
    if (decoded.text.length > MAX_INPUT) {
      edit(() => setMessage(TOO_LARGE));
      return;
    }
    edit(() => {
      setInput(decoded.text);
      // Opening a file is an explicit action: a large one is formatted at once.
      runOnce.current = true;
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
    const p = (opened.payload ?? {}) as Partial<SqlFormatPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      ran.current = null;
      setMessage(null);
      setInput(text);
      const layout = isLayout(p.layout) ? p.layout : DEFAULT_OPTIONS.layout;
      const indent = isIndent(p.indent) ? p.indent : DEFAULT_OPTIONS.indent;
      setOptions({
        dialect: isDialect(p.dialect) ? p.dialect : DEFAULT_OPTIONS.dialect,
        keywordCase: isKeywordCase(p.keywordCase) ? p.keywordCase : DEFAULT_OPTIONS.keywordCase,
        indent: layout !== 'standard' && indent === 'tab' ? 2 : indent,
        layout,
      });
      runOnce.current = true;
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const goTo = (offset: number): void => {
    const el = field.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(offset, offset);
  };

  let status: ReactElement | string = ' ';
  let tone: 'error' | 'note' = 'note';
  const pending = latest.current !== null && runner.busy;
  if (message) [status, tone] = [message, 'error'];
  else if (blank) status = ' ';
  else if (tooLarge) [status, tone] = [TOO_LARGE, 'error'];
  else if (loading && (pending || working)) status = `Loading the ${DIALECT_LABELS[loading]} formatter…`;
  else if (working) status = 'Formatting…';
  else if (large && !current) status = LARGE;
  else if (shown && !shown.ok) {
    tone = 'error';
    const error = shown.error;
    status =
      'offset' in error ? (
        <Button
          variant="link"
          size="sm"
          className="h-auto max-w-full p-0 text-left whitespace-normal text-destructive"
          data-part="error"
          onClick={() => goTo(error.offset)}>
          <CircleAlertIcon aria-hidden="true" />
          {describeError(error)}
        </Button>
      ) : (
        describeError(error)
      );
  }

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  const taken = current?.ok === true && output !== '';
  const tabular = options.layout !== 'standard';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Label htmlFor="sql-format-dialect" className="text-muted-foreground">
          Dialect
        </Label>
        <Select
          value={options.dialect}
          onValueChange={value => {
            if (isDialect(value) && value !== options.dialect) setOption({ dialect: value });
          }}>
          <SelectTrigger id="sql-format-dialect" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIALECTS.map(d => (
              <SelectItem key={d} value={d}>
                {DIALECT_LABELS[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <span id="sql-format-case-label" className="cn-label ml-2 text-muted-foreground">
          Keyword case
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-labelledby="sql-format-case-label"
          value={options.keywordCase}
          onValueChange={value => {
            if (isKeywordCase(value) && value !== options.keywordCase) setOption({ keywordCase: value });
          }}>
          {(['upper', 'lower', 'preserve'] as const).map(c => (
            <ToggleGroupItem key={c} value={c}>
              {KEYWORD_CASE_LABELS[c]}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <Label htmlFor="sql-format-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(options.indent)}
          onValueChange={value => {
            const next = value === 'tab' ? value : Number(value);
            if (isIndent(next)) setOption({ indent: next });
          }}>
          <SelectTrigger id="sql-format-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENTS.map(i => (
              <SelectItem key={String(i)} value={String(i)} disabled={i === 'tab' && tabular}>
                {INDENT_LABELS[String(i)]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="sql-format-layout" className="ml-2 text-muted-foreground">
          Layout
        </Label>
        <Select
          value={options.layout}
          onValueChange={value => {
            if (isLayout(value)) setOption({ layout: value });
          }}>
          <SelectTrigger id="sql-format-layout" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LAYOUTS.map(l => (
              <SelectItem key={l} value={l}>
                {LAYOUT_LABELS[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {large && !working && (
          <Button
            className="ml-2"
            onClick={() => {
              // The pressed button gives way to Cancel: the focus goes there, so Esc, Enter or Space stop the Run.
              focusCancel.current = true;
              run();
            }}>
            Run
          </Button>
        )}
        {working && (
          <Button
            ref={cancelButton}
            variant="outline"
            className="ml-2"
            onClick={cancel}
            onKeyDown={e => {
              if (e.key === 'Escape') {
                e.preventDefault();
                cancel();
              }
            }}>
            Cancel
          </Button>
        )}
        <Button variant="outline" className="ml-auto" onClick={() => picker.current?.click()}>
          Open file
        </Button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          onChange={e => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) void openFile(file);
          }}
        />
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="SQL" htmlFor="sql-format-input">
          <Textarea
            ref={field}
            id="sql-format-input"
            className={code}
            spellCheck={false}
            placeholder="select id, name from users where active = 1"
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                e.preventDefault();
                run();
              } else if (e.key === 'Escape' && working) {
                e.preventDefault();
                cancel();
              }
            }}
          />
          {/* Changes while typing: read out politely (status), never as an alert. */}
          <ToolMessage tone={tone} role="status" data-part="status" data-stale={stale || undefined}>
            {status}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Formatted"
          htmlFor={fits ? 'sql-format-output' : undefined}
          actions={
            <>
              <CopyButton value={taken ? output : ''} onCopied={() => take('copy')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!taken}
                onClick={() => {
                  save(output);
                  take('save');
                }}>
                Save
              </Button>
            </>
          }>
          {fits ? (
            <Textarea id="sql-format-output" className={code} spellCheck={false} readOnly value={output} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-part="summary">
              {summary}
            </p>
          )}
          <ToolMessage role={undefined} data-part="note">
            {NOT_CHECKED}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default SqlFormatTool;
