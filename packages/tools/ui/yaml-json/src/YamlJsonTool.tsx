/**
 * The YAML and JSON tool's page (docs/tools/specs/yaml-json.md §8): the direction, the YAML version and the indent,
 * Swap, Run and Cancel, Open file; input and result side by side, the input's state under it (an error is a link to its
 * place) and the notes under the result. The conversion runs in the tool's worker (conversion.ts): 150 ms after the last
 * edit up to LIVE_INPUT characters, by Run up to MAX_INPUT, refused above (§12). It records into the tool history
 * through its host: an edit snapshot with its result (`change`) and a commit when the result is taken — Copy, Save,
 * Swap; an entry the host asks to open comes back as the input and the options. The page frame is the host's.
 */
import { createConversion } from './conversion';
import { entryLabel, excerpt, isDirection, isLayout, isVersion, isYamlIndent, kindOf } from './entries';
import { yamlJsonHistory } from './history';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  SHOW_RESULT_CHARS,
  SHOW_RESULT_LINES,
  decodeTextFile,
  describeNotes,
} from '@workspace/tool-logic-yaml-json';
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
import type { ConvertJob } from './conversion';
import type { YamlJsonPayload } from './entries';
import type { ConvertResult, Direction, Layout, YamlVersion } from '@workspace/tool-logic-yaml-json';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const JSON_LAYOUTS: Array<{ value: Layout; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
  { value: 'minify', label: 'Minified' },
];
const YAML_INDENTS: Array<{ value: 2 | 4; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
];

const TOO_LARGE = 'Input is larger than 8 MB. This tool converts up to 8 MB.';
const LARGE = 'Large input: press Run (Ctrl+Enter) to convert it.';
const ACCEPT = '.yaml,.yml,.json,application/json,application/yaml';

interface Done {
  job: ConvertJob;
  result: ConvertResult;
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

const typed = (value: string, type: string): Blob => new Blob([value], { type });

const payloadOf = (job: ConvertJob, result: ConvertResult): Omit<YamlJsonPayload, 'action'> => ({
  direction: job.direction,
  version: job.version,
  layout: job.layout,
  indent: job.indent,
  ...(result.ok
    ? { outcome: 'ok', documents: result.notes.documents }
    : {
        outcome: 'error',
        error: { message: result.error.message, line: result.error.line, column: result.error.column },
      }),
});

const draftOf = (done: Done, action?: YamlJsonPayload['action']): HistoryDraft | null => {
  const { job, result } = done;
  if (job.text.trim() === '') return null;
  const payload: YamlJsonPayload = { ...payloadOf(job, result), ...(action ? { action } : {}) };
  const output = result.ok ? result.text : '';
  const [inType, outType] =
    job.direction === 'yaml-to-json'
      ? ['application/yaml', 'application/json']
      : ['application/json', 'application/yaml'];
  return {
    kind: kindOf(job.direction),
    payload,
    label: entryLabel(payload, job.text.length),
    text: excerpt(job.text, output),
    blobs:
      output === ''
        ? { input: typed(job.text, inType) }
        : { input: typed(job.text, inType), output: typed(output, outType) },
  };
};

const save = (text: string, direction: Direction): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const json = direction === 'yaml-to-json';
  const url = URL.createObjectURL(typed(text, json ? 'application/json' : 'application/yaml'));
  const link = document.createElement('a');
  link.href = url;
  link.download = json ? 'converted.json' : 'converted.yaml';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const YamlJsonTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page was recognised as YAML (detectYaml): it is there to become JSON.
  const [direction, setDirection] = useState<Direction>('yaml-to-json');
  const [version, setVersion] = useState<YamlVersion>('1.2');
  const [layout, setLayout] = useState<Layout>(2);
  const [indent, setIndent] = useState<2 | 4>(2);
  const [done, setDone] = useState<Done | null>(null);
  const [working, setWorking] = useState<ConvertJob | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { history, recorder } = useToolHistory(host, 'yaml-json', yamlJsonHistory);

  const conversion = useMemo(() => createConversion(), []);
  useEffect(() => () => conversion.dispose(), [conversion]);

  const job = useMemo<ConvertJob>(
    () => ({ direction, text: input, version, layout, indent }),
    [direction, input, version, layout, indent],
  );
  const blank = input.trim() === '';
  const tooLarge = input.length > MAX_INPUT;
  const large = !tooLarge && input.length > LIVE_INPUT;

  const latest = useRef<ConvertJob | null>(null);
  const start = useCallback(
    (next: ConvertJob, restart: boolean): void => {
      if (restart) conversion.cancel();
      latest.current = next;
      if (restart) setWorking(next);
      conversion.run(next).then(
        result => {
          if (latest.current !== next || result === null) return;
          setDone({ job: next, result });
          setWorking(null);
        },
        (error: unknown) => {
          if (latest.current !== next) return;
          // The worker died (out of memory, a crash): no result and no place, only why (§15).
          setMessage(`The conversion stopped: ${error instanceof Error ? error.message : String(error)}`);
          setDone(null);
          setWorking(null);
        },
      );
    },
    [conversion],
  );

  const cancel = useCallback((): void => {
    conversion.cancel();
    latest.current = null;
    setWorking(null);
  }, [conversion]);

  // Live: 150 ms after the last edit, up to LIVE_INPUT. A large input waits for Run; a new edit stops a Run under way.
  const runOnce = useRef(false);
  useEffect(() => {
    if (working && working !== job) cancel();
    if (blank || tooLarge || large) {
      if (runOnce.current && large) start(job, true);
      runOnce.current = false;
      return;
    }
    runOnce.current = false;
    const timer = setTimeout(() => start(job, false), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [job, blank, tooLarge, large, working, start, cancel]);

  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusCancel = useRef(false);
  useEffect(() => {
    if (working && focusCancel.current) cancelButton.current?.focus();
    focusCancel.current = false;
  }, [working]);

  const run = (): void => {
    if (blank || tooLarge) return;
    start(job, large);
  };

  const current = done && done.job === job ? done.result : null;
  // While a small input settles, the previous result stays (no flicker); a large one waits for Run.
  const shown =
    current ?? (!blank && !tooLarge && !large && done && done.job.direction === direction ? done.result : null);
  /** The previous result, shown while the new one is under way (the status says so through `data-stale`). */
  const stale = shown !== null && shown !== current;
  const output = shown?.ok ? shown.text : '';
  const fits = useMemo(() => output.length <= SHOW_RESULT_CHARS && lineCount(output) <= SHOW_RESULT_LINES, [output]);
  const summary = useMemo(
    () =>
      fits
        ? ''
        : `Result: ${formatSize(new TextEncoder().encode(output).length)}, ${lineCount(output).toLocaleString('en-US')} lines. Too large to show here.`,
    [fits, output],
  );
  const notes = shown?.ok && output !== '' ? describeNotes(shown.notes, direction) : [];

  // A person's edit (or text handed over from the start page) is recorded once its result is there.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || !done) return;
    const draft = draftOf(done);
    if (draft) recorder.change(draft);
  }, [recorder, done]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };

  const take = (action: 'copy' | 'save' | 'swap'): void => {
    if (!current || !done) return;
    const draft = draftOf(done, action);
    if (draft) void recorder.commit(draft);
  };

  const swap = (): void => {
    take('swap');
    const next = output;
    edit(() => {
      setInput(next);
      setDirection(direction === 'yaml-to-json' ? 'json-to-yaml' : 'yaml-to-json');
      // Swap is an explicit action: a large result is converted back at once.
      runOnce.current = true;
    });
  };

  const openFile = async (file: File): Promise<void> => {
    if (file.size > MAX_INPUT) {
      edit(() => setMessage(TOO_LARGE));
      return;
    }
    const decoded = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
    if (!decoded.ok) {
      edit(() => setMessage(decoded.message));
      return;
    }
    const name = file.name.toLowerCase();
    edit(() => {
      setInput(decoded.text);
      if (name.endsWith('.json')) setDirection('json-to-yaml');
      else if (name.endsWith('.yaml') || name.endsWith('.yml')) setDirection('yaml-to-json');
      // Opening a file is an explicit action: a large one is converted at once.
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
    const p = (opened.payload ?? {}) as Partial<YamlJsonPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setMessage(null);
      setInput(text);
      setDirection(
        isDirection(p.direction) ? p.direction : opened.entry.kind === 'to-yaml' ? 'json-to-yaml' : 'yaml-to-json',
      );
      setVersion(isVersion(p.version) ? p.version : '1.2');
      setLayout(isLayout(p.layout) ? p.layout : 2);
      setIndent(isYamlIndent(p.indent) ? p.indent : 2);
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

  const toJson = direction === 'yaml-to-json';
  const inputName = toJson ? 'YAML' : 'JSON';
  const outputName = toJson ? 'JSON' : 'YAML';

  let status: ReactElement | string = ' ';
  let tone: 'error' | 'note' | 'success' = 'note';
  if (message) [status, tone] = [message, 'error'];
  else if (blank) status = ' ';
  else if (tooLarge) [status, tone] = [TOO_LARGE, 'error'];
  else if (working) status = 'Converting…';
  else if (large && !current) status = LARGE;
  else if (shown && !shown.ok) {
    const { line, column, message: what, offset } = shown.error;
    const more = shown.moreErrors ? ` (and ${shown.moreErrors.toLocaleString('en-US')} more)` : '';
    tone = 'error';
    status = (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(offset)}>
        <CircleAlertIcon aria-hidden="true" />
        {`Line ${line}, column ${column}: ${what}${more}`}
      </Button>
    );
  } else if (shown?.ok) {
    if (shown.notes.documents === 0 && toJson) status = 'No YAML document.';
    else [status, tone] = [`Valid ${inputName}`, 'success'];
  }

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  const taken = current?.ok === true && output !== '';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={direction}
          onValueChange={value => {
            if (isDirection(value) && value !== direction) edit(() => setDirection(value));
          }}>
          <ToggleGroupItem value="yaml-to-json">YAML → JSON</ToggleGroupItem>
          <ToggleGroupItem value="json-to-yaml">JSON → YAML</ToggleGroupItem>
        </ToggleGroup>
        {toJson && (
          <>
            <Label htmlFor="yaml-json-version" className="ml-2 text-muted-foreground">
              YAML version
            </Label>
            <Select
              value={version}
              onValueChange={value => {
                if (isVersion(value)) edit(() => setVersion(value));
              }}>
              <SelectTrigger id="yaml-json-version" className="min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1.2">YAML 1.2</SelectItem>
                <SelectItem value="1.1">YAML 1.1</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        <Label htmlFor="yaml-json-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(toJson ? layout : indent)}
          onValueChange={value => {
            const next = value === 'tab' || value === 'minify' ? value : Number(value);
            if (toJson && isLayout(next)) edit(() => setLayout(next));
            else if (!toJson && isYamlIndent(next)) edit(() => setIndent(next));
          }}>
          <SelectTrigger id="yaml-json-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(toJson ? JSON_LAYOUTS : YAML_INDENTS).map(option => (
              <SelectItem key={String(option.value)} value={String(option.value)}>
                {option.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Button variant="outline" className="ml-2" disabled={!taken || working !== null} onClick={swap}>
          Swap
        </Button>
        {large && !working && (
          <Button
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
        <ToolPane label={inputName} htmlFor="yaml-json-input">
          <Textarea
            ref={field}
            id="yaml-json-input"
            className={code}
            spellCheck={false}
            placeholder={toJson ? 'key: value' : '{"key": "value"}'}
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
          {/* Changes while typing: read out politely (status), as the JSON tool does — never as an alert. */}
          <ToolMessage tone={tone} role="status" data-part="status" data-stale={stale || undefined}>
            {status}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label={outputName}
          htmlFor={fits ? 'yaml-json-output' : undefined}
          actions={
            <>
              <CopyButton value={taken ? output : ''} onCopied={() => take('copy')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!taken}
                onClick={() => {
                  save(output, direction);
                  take('save');
                }}>
                Save
              </Button>
            </>
          }>
          {fits ? (
            <Textarea id="yaml-json-output" className={code} spellCheck={false} readOnly value={output} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-part="summary">
              {summary}
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

export default YamlJsonTool;
