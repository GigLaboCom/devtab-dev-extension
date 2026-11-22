/**
 * The JSON to Code tool's page (docs/tools/specs/json-to-code.md §8): Language, Root type, and for TypeScript only
 * Declaration and Export; Generate on a large sample; the sample and the result side by side, the sample's state under
 * it (an error is a link to its place) and the notes under the result. Up to LIVE_INPUT characters the result follows
 * every change, computed on the page; above it Generate (or Ctrl+Enter) works in the tool's worker (runner.ts); above
 * MAX_INPUT the sample is refused (§12). The TypeScript options keep their values while another language is chosen.
 *
 * It records into the tool history through its host (ToolHost.history, @workspace/tools-host), as the JSON tool does:
 * an edit snapshot when the sample or an option changes (`change`) and a result a person takes or asks for — Copy,
 * Generate — with the result (`commit`); an entry the host asks to open comes back as the sample and the options.
 * Without a host the history is the page's memory. The page frame is the host's; the body is built from the kit's
 * tool parts.
 */
import { editDraft, readEntry, resultDraft } from './entries';
import { jsonToCodeHistory } from './history';
import { createRunner } from './runner';
import { LANGUAGES, LIVE_INPUT, MAX_INPUT, describeNotes, jsonToCode } from '@workspace/tool-logic-json-to-code';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { InputField } from '@workspace/ui/input-field';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { JsonToCodeOptionsPayload, JsonToCodeResultPayload } from './history';
import type { GenerateJob } from './runner';
import type { CodeOptions, CodeResult, Language } from '@workspace/tool-logic-json-to-code';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const TOO_LARGE = 'Input is larger than 16 MB; paste a smaller sample.';
const LARGE = 'Large input: press Generate (Ctrl+Enter).';

const sameJob = (a: GenerateJob, b: GenerateJob): boolean =>
  a.text === b.text &&
  a.options.language === b.options.language &&
  a.options.rootName === b.options.rootName &&
  a.options.declaration === b.options.declaration &&
  a.options.exportTypes === b.options.exportTypes;

const isLanguage = (value: string): value is Language => LANGUAGES.some(l => l.value === value);

const JsonToCodeTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [language, setLanguage] = useState<Language>('typescript');
  const [rootName, setRootName] = useState('');
  const [declaration, setDeclaration] = useState<'interface' | 'type'>('interface');
  const [exportTypes, setExportTypes] = useState(true);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  /** The last Generate's job and its result. */
  const [ran, setRan] = useState<{ job: GenerateJob; result: CodeResult } | null>(null);
  const [working, setWorking] = useState<GenerateJob | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const { history, recorder } = useToolHistory(host, 'json-to-code', jsonToCodeHistory);

  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.dispose(), [runner]);

  const options = useMemo<CodeOptions>(
    () => ({ language, rootName, declaration, exportTypes }),
    [language, rootName, declaration, exportTypes],
  );
  const job = useMemo<GenerateJob>(() => ({ text: input, options }), [input, options]);
  const blank = input.trim() === '';
  const tooLarge = input.length > MAX_INPUT;
  const large = !tooLarge && input.length > LIVE_INPUT;

  // Live up to LIVE_INPUT: the result follows every change, on the page (§12).
  const live = useMemo(
    () => (blank || tooLarge || large ? null : jsonToCode(job.text, job.options)),
    [job, blank, tooLarge, large],
  );
  const result = blank || tooLarge ? null : (live ?? (ran && sameJob(ran.job, job) ? ran.result : null));

  // A change while Generate is under way makes it out of date: stop it.
  useEffect(() => {
    if (working && !sameJob(working, job)) {
      runner.cancel();
      setWorking(null);
    }
  }, [job, working, runner]);

  const kept = options satisfies JsonToCodeOptionsPayload;

  // A person's edit — or a text handed over by the host — is an edit snapshot; opening an entry is not.
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

  const take = (action: JsonToCodeResultPayload['action']): void => {
    if (result && !blank && !tooLarge) void recorder.commit(resultDraft(job.text, kept, action, result));
  };

  const generate = useCallback((): void => {
    if (!large || working) return;
    const next = job;
    setWorking(next);
    runner.run(next).then(
      done => {
        if (!done) return;
        setRan({ job: next, result: done });
        setWorking(null);
        void recorder.commit(resultDraft(next.text, next.options, 'generate', done));
      },
      (error: unknown) => {
        // The worker died (out of memory, a crash): no result and no place, only why.
        setWorking(null);
        setMessage(`Generate stopped: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  }, [large, working, job, runner, recorder]);

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
    const entry = readEntry(opened.payload);
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setMessage(null);
      setInput(text);
      setLanguage(entry.language);
      setRootName(entry.rootName);
      setDeclaration(entry.declaration);
      setExportTypes(entry.exportTypes);
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

  const output = result?.ok ? result.text : '';
  const notes = result?.ok ? describeNotes(result.notes) : [];

  let status: ReactElement | string = ' ';
  let tone: 'error' | 'note' = 'note';
  if (message) [status, tone] = [message, 'error'];
  else if (blank) status = ' ';
  else if (tooLarge) [status, tone] = [TOO_LARGE, 'error'];
  else if (!result) status = LARGE;
  else if (!result.ok) {
    const { line, column, message: what, offset } = result.error;
    tone = 'error';
    status = (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(offset, line)}>
        <CircleAlertIcon aria-hidden="true" />
        {`Line ${line}, column ${column}: ${what}`}
      </Button>
    );
  }

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Label htmlFor="json-to-code-language" className="text-muted-foreground">
          Language
        </Label>
        <Select
          value={language}
          onValueChange={value => {
            if (isLanguage(value) && value !== language) edit(() => setLanguage(value));
          }}>
          <SelectTrigger id="json-to-code-language" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {LANGUAGES.map(l => (
              <SelectItem key={l.value} value={l.value}>
                {l.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="json-to-code-root" className="ml-2 text-muted-foreground">
          Root type
        </Label>
        <Input
          id="json-to-code-root"
          className="w-40 font-mono"
          spellCheck={false}
          autoComplete="off"
          placeholder="Root"
          value={rootName}
          onChange={e => {
            const next = e.target.value;
            edit(() => setRootName(next));
          }}
        />
        {language === 'typescript' && (
          <>
            <span id="json-to-code-declaration" className="cn-label ml-2 text-muted-foreground">
              Declaration
            </span>
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-labelledby="json-to-code-declaration"
              value={declaration}
              onValueChange={value => {
                if ((value === 'interface' || value === 'type') && value !== declaration)
                  edit(() => setDeclaration(value));
              }}>
              <ToggleGroupItem value="interface">interface</ToggleGroupItem>
              <ToggleGroupItem value="type">type</ToggleGroupItem>
            </ToggleGroup>
            <div className="ml-2 flex items-center gap-2">
              <Checkbox
                id="json-to-code-export"
                checked={exportTypes}
                onCheckedChange={checked => edit(() => setExportTypes(checked === true))}
              />
              <Label htmlFor="json-to-code-export" className="font-normal">
                Export
              </Label>
            </div>
          </>
        )}
        {large && (
          <Button className="ml-2" disabled={working !== null} onClick={generate}>
            {working ? 'Working…' : 'Generate'}
          </Button>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="JSON sample" htmlFor="json-to-code-input">
          <InputField
            ref={field}
            id="json-to-code-input"
            className={code}
            spellCheck={false}
            placeholder='{"id": 1, "name": "Ann"}'
            value={input}
            onValueChange={next => edit(() => setInput(next))}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && large) {
                e.preventDefault();
                generate();
              }
            }}
          />
          {/* Changes while typing: read out politely (status), never as an alert on every keystroke. */}
          <ToolMessage tone={tone} role="status" data-part="status">
            {status}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor="json-to-code-output"
          actions={<CopyButton value={output} onCopied={() => take('copy')} />}>
          <ResultField id="json-to-code-output" className={code} spellCheck={false} value={output} />
          <div role="status" data-part="notes">
            {notes.length === 0 ? (
              <ToolMessage role={undefined} data-part="note" />
            ) : (
              notes.map(note => (
                <ToolMessage key={note} role={undefined} data-part="note">
                  {note}
                </ToolMessage>
              ))
            )}
          </div>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default JsonToCodeTool;
