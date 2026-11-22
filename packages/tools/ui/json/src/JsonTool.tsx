/**
 * The JSON tool's page (docs/tools/specs/json.md §8): Run (large input only), Format or Minify, the indent, Sort keys,
 * Allow comments, Open file; input and result side by side, the input's state under it (an error is a link to its
 * place) and the notes under the result. Up to LIVE_INPUT characters the result follows every change, computed on the
 * page; above it Run (or Ctrl+Enter) prints in the tool's worker (runner.ts); above MAX_INPUT the input is refused
 * (§12). A file too large for the input field stays in memory behind a card; a result too large for the result field
 * is a summary with Copy and Save (§3).
 *
 * It records into the tool history through its host (ToolHost.history, @workspace/tools-host): an edit snapshot when
 * the text or an option changes (`change`; the checkpoint rule decides when one is written) and a result a person takes
 * or asks for — Copy, Save, Run — with the result (`commit`); an entry the host asks to open comes back as the text and
 * the options, entries of the first version of the tool too (entries.ts). Without a host the history is the page's
 * memory. The page frame (title, summary, the history line) is the host's; the body is built from the kit's tool parts.
 *
 * Its options are saved parameters (settings.ts; docs/tools/settings.md): it opens with what the person chose last
 * time where the host remembers it, and an entry opened from History shows its own options for the visit without
 * changing what is saved.
 */
import { editDraft, isIndent, readEntry, resultDraft } from './entries';
import { jsonHistory } from './history';
import { printWithSize } from './printing';
import { createRunner } from './runner';
import { jsonSettings } from './settings';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SHOW_RESULT_CHARS,
  SHOW_RESULT_LINES,
  decodeTextFile,
  describeNotes,
  formatMegabytes,
  measureText,
} from '@workspace/tool-logic-json';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { InputField } from '@workspace/ui/input-field';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonOptionsPayload, JsonResultPayload } from './history';
import type { Printed, PrintJob } from './printing';
import type { Indent, Layout } from '@workspace/tool-logic-json';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const INDENTS: Array<{ value: Indent; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
];

const TOO_LARGE = 'Input is larger than 32 MB. This tool works with up to 32 MB.';
const LARGE = 'Large input: press Run (Ctrl+Enter) to check it.';
const ACCEPT = '.json,.jsonc,.geojson,application/json';

/** A file whose text does not go into the input field (§3): it stays in memory, the card shows its name and size. */
interface LoadedFile {
  name: string;
  bytes: number;
  text: string;
}

/** Does a text go into a field (§3, §12): up to SHOW_RESULT_CHARS characters and SHOW_RESULT_LINES lines. */
const fitsField = (text: string, lines?: number): boolean =>
  text.length <= SHOW_RESULT_CHARS && (lines ?? measureText(text).lines) <= SHOW_RESULT_LINES;

const save = (text: string, name: string): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const sameJob = (a: PrintJob, b: PrintJob): boolean =>
  a.text === b.text && a.layout === b.layout && a.sortKeys === b.sortKeys && a.allowComments === b.allowComments;

const JsonTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [file, setFile] = useState<LoadedFile | null>(null);
  const saved = useSavedSettings(host, 'json', jsonSettings);
  const { mode, indent, sortKeys, allowComments } = saved.values;
  /** What went wrong opening a file (too large, not UTF-8). */
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  /** The last Run's job and what it printed. */
  const [ran, setRan] = useState<{ job: PrintJob; printed: Printed } | null>(null);
  const [working, setWorking] = useState<PrintJob | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { history, recorder } = useToolHistory(host, 'json', jsonHistory);

  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.dispose(), [runner]);

  const source = file?.text ?? input;
  const layout: Layout = mode === 'minify' ? 'minify' : indent;
  const job = useMemo<PrintJob>(
    () => ({ text: source, layout, sortKeys, allowComments }),
    [source, layout, sortKeys, allowComments],
  );
  const blank = source.trim() === '';
  const tooLarge = source.length > MAX_INPUT;
  const large = !tooLarge && source.length > LIVE_INPUT;

  // Live up to LIVE_INPUT: the result follows every change, on the page (a few milliseconds, §12).
  const live = useMemo(() => (blank || tooLarge || large ? null : printWithSize(job)), [job, blank, tooLarge, large]);
  const current = live ?? (ran && sameJob(ran.job, job) ? ran.printed : null);

  // A change while Run is under way makes it out of date: stop it.
  useEffect(() => {
    if (working && !sameJob(working, job)) {
      runner.cancel();
      setWorking(null);
    }
  }, [job, working, runner]);

  /** The options an entry keeps (and the file's name when the text is behind a card). */
  const kept = useMemo<JsonOptionsPayload>(
    () => ({ layout, sortKeys, allowComments, ...(file ? { file: file.name } : {}) }),
    [layout, sortKeys, allowComments, file],
  );

  // A person's edit — or the text handed over from the start page — is an edit snapshot; opening an entry is not.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (edited.current && !blank && !tooLarge) recorder.change(editDraft(job.text, kept));
  }, [recorder, job, kept, blank, tooLarge]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };

  const take = (action: JsonResultPayload['action']): void => {
    if (current && !blank && !tooLarge) void recorder.commit(resultDraft(job.text, kept, action, current.result));
  };

  const run = useCallback((): void => {
    if (!large || working) return;
    const next = job;
    setWorking(next);
    runner.run(next).then(
      printed => {
        if (!printed) return;
        setRan({ job: next, printed });
        setWorking(null);
        void recorder.commit(resultDraft(next.text, kept, 'run', printed.result));
      },
      (error: unknown) => {
        // The worker died (out of memory, a crash): no result and no place, only why (§15).
        setWorking(null);
        setMessage(`The check stopped: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }, [large, working, job, kept, runner, recorder]);

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
      edit(() => setMessage(decoded.message));
      return;
    }
    edit(() => place(decoded.text, picked.name, picked.size));
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
    const entry = readEntry(opened.entry.schema, opened.payload);
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setMessage(null);
      place(text, entry.file ?? 'History entry', measureText(text).bytes);
      // The entry's options for this visit; what is saved stays as it was.
      saved.visit({
        mode: entry.layout === 'minify' ? 'minify' : 'format',
        ...(isIndent(entry.layout) ? { indent: entry.layout } : {}),
        sortKeys: entry.sortKeys,
        allowComments: entry.allowComments,
      });
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
  } else {
    const withComments = allowComments && result.notes.comments + result.notes.trailingCommas > 0;
    [status, tone] = [withComments ? 'Valid JSON with comments' : 'Valid JSON', 'success'];
  }

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
          aria-label="Mode"
          value={mode}
          onValueChange={value => {
            if ((value === 'format' || value === 'minify') && value !== mode) edit(() => saved.set({ mode: value }));
          }}>
          <ToggleGroupItem value="format">Format</ToggleGroupItem>
          <ToggleGroupItem value="minify">Minify</ToggleGroupItem>
        </ToggleGroup>
        <Label htmlFor="json-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(indent)}
          disabled={mode === 'minify'}
          onValueChange={value => {
            const next = value === 'tab' ? 'tab' : Number(value);
            if (isIndent(next)) edit(() => saved.set({ indent: next }));
          }}>
          <SelectTrigger id="json-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENTS.map(i => (
              <SelectItem key={String(i.value)} value={String(i.value)}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox
            id="json-sort"
            checked={sortKeys}
            onCheckedChange={checked => edit(() => saved.set({ sortKeys: checked === true }))}
          />
          <Label htmlFor="json-sort" className="font-normal">
            Sort keys
          </Label>
        </div>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox
            id="json-comments"
            checked={allowComments}
            onCheckedChange={checked => edit(() => saved.set({ allowComments: checked === true }))}
          />
          <Label htmlFor="json-comments" className="font-normal">
            Allow comments
          </Label>
        </div>
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
          data-part="file-input"
          onChange={e => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) void openFile(picked);
          }}
        />
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor={file ? undefined : 'json-input'}>
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
            <InputField
              ref={field}
              id="json-input"
              className={code}
              spellCheck={false}
              placeholder='{"paste": "JSON here"}'
              value={input}
              onValueChange={next => edit(() => setInput(next))}
              // The tool's own field bound (§3, §12), the one a file is held behind its card by: a paste is held too.
              maxChars={SHOW_RESULT_CHARS}
              maxLines={SHOW_RESULT_LINES}
              onKeyDown={e => {
                if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && large) {
                  e.preventDefault();
                  run();
                }
              }}
            />
          )}
          {/* Changes while typing: read out politely (status), never as an alert on every keystroke. */}
          <ToolMessage tone={tone} role="status" data-part="status" className="validity">
            {status}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor={fits ? 'json-output' : undefined}
          actions={
            <>
              <CopyButton value={output} onCopied={() => take('copy')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!taken}
                onClick={() => {
                  save(output, mode === 'minify' ? 'minified.json' : 'formatted.json');
                  take('save');
                }}>
                Save
              </Button>
            </>
          }>
          {fits ? (
            <Textarea id="json-output" className={code} spellCheck={false} readOnly value={output} />
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

export default JsonTool;
