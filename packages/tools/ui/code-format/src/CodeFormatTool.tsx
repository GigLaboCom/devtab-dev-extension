/**
 * The Code Formatter's page (docs/tools/specs/code-format.md §8): the language (Auto names what it recognised), the
 * indent and the line width, Run and Cancel, Open file; a second row with only the chosen language's options; the code
 * and the result side by side, the code's state under it (an error is a link to its place) and, for HTML, the note
 * about <script> and <style> under the result. Formatting runs in the tool's workers (formatter.ts): 300 ms after the
 * last edit up to LIVE_INPUT characters (an option change at once), by Run up to the language's limit, refused above
 * (§12). It records into the tool history through its host: an edit snapshot with its result (`change`) and a commit
 * when the result is made by Run or taken — Copy, Save; an entry the host asks to open comes back as the code, the
 * language and the options. The page frame is the host's.
 *
 * The Language choice and the options are saved parameters (settings.ts; docs/tools/settings.md): the tool opens with
 * what the person chose last. A paste from the start page opens Auto, an opened file its own language and an opened
 * entry its own choice and options, all for the visit only. A saved language loads nothing: the formatter's modules
 * load with the first code to format, as before.
 */
import { MIME, entryLabel, excerpt, isChoice, isLanguage, settingsOf } from './entries';
import { createFormatter, NO_WORKERS } from './formatter';
import { codeFormatHistory } from './history';
import { codeFormatSettings } from './settings';
import {
  HTML_NOTE,
  LANGUAGES,
  LANGUAGE_EXTENSIONS,
  LANGUAGE_LABELS,
  LARGE_MESSAGE,
  LIVE_INPUT,
  MAX_INPUT,
  OPTIONS_OF,
  SETTLE_MS,
  SHOW_RESULT_CHARS,
  SHOW_RESULT_LINES,
  TIMED_OUT_MESSAGE,
  UNDETECTED_MESSAGE,
  decodeTextFile,
  detectLanguage,
  effectiveIndent,
  isPlaced,
  languageOfFile,
  loadingMessage,
  tooLargeMessage,
} from '@workspace/tool-logic-code-format';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
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
import type { Choice, CodeFormatPayload } from './entries';
import type { FormatJob, FormatOutcome } from './formatter';
import type {
  CodeLanguage,
  FormatResult,
  FormatSettings,
  Indent,
  LineWidth,
  ProseWrap,
  TrailingComma,
  Whitespace,
} from '@workspace/tool-logic-code-format';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

const INDENTS: Array<{ value: Indent; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
];
const WIDTHS: LineWidth[] = [80, 100, 120];
const TRAILING: Array<{ value: TrailingComma; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'es5', label: 'ES5' },
  { value: 'none', label: 'None' },
];
const WHITESPACE: Array<{ value: Whitespace; label: string }> = [
  { value: 'css', label: 'CSS' },
  { value: 'strict', label: 'Strict' },
  { value: 'ignore', label: 'Ignore' },
];
const PROSE: Array<{ value: ProseWrap; label: string }> = [
  { value: 'preserve', label: 'Preserve' },
  { value: 'always', label: 'Always' },
  { value: 'never', label: 'Never' },
];
const ACCEPT =
  '.js,.mjs,.cjs,.jsx,.ts,.mts,.cts,.tsx,.css,.scss,.less,.html,.htm,.xml,.svg,.xsd,.xsl,.xslt,.plist,.md,.markdown,.yaml,.yml,text/*';
/** Bytes per UTF-16 unit at most in UTF-8: a file larger than the limit times this cannot fit in characters. */
const UTF8_MAX = 3;

interface Done {
  job: FormatJob;
  outcome: FormatOutcome;
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

const typed = (value: string, language: CodeLanguage): Blob => new Blob([value], { type: MIME[language] });

const resultOf = (outcome: FormatOutcome | undefined): FormatResult | null =>
  outcome && 'result' in outcome ? outcome.result : null;

const draftOf = (done: Done, choice: Choice, action?: CodeFormatPayload['action']): HistoryDraft | null => {
  const { job } = done;
  const result = resultOf(done.outcome);
  if (job.text.trim() === '' || !result) return null;
  const output = result.ok ? result.text : '';
  const payload: CodeFormatPayload = {
    choice,
    language: job.language,
    settings: job.settings,
    ...(result.ok
      ? { outcome: 'ok', lines: output === '' ? 0 : lineCount(output) - 1 }
      : {
          outcome: 'error',
          error: isPlaced(result.error)
            ? { message: result.error.message, line: result.error.line, column: result.error.column }
            : { message: result.error.message },
        }),
    ...(action ? { action } : {}),
  };
  return {
    kind: 'format',
    payload,
    label: entryLabel(payload, job.text.length),
    text: excerpt(job.text, output),
    blobs:
      output === ''
        ? { input: typed(job.text, job.language) }
        : { input: typed(job.text, job.language), output: typed(output, job.language) },
  };
};

const save = (text: string, language: CodeLanguage): void => {
  if (typeof URL.createObjectURL !== 'function') return;
  const url = URL.createObjectURL(typed(text, language));
  const link = document.createElement('a');
  link.href = url;
  link.download = `formatted.${LANGUAGE_EXTENSIONS[language]}`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const CodeFormatTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page is formatted as what Auto recognises in it, for this visit; what is saved stays.
  const saved = useSavedSettings(host, 'code-format', codeFormatSettings, {
    opening: initial ? { language: 'auto' } : undefined,
  });
  const choice: Choice = saved.values.language;
  const { indent: chosenIndent, lineWidth, semi, singleQuote, trailingComma, whitespace, proseWrap } = saved.values;
  const settings = useMemo<FormatSettings>(
    () => ({ indent: chosenIndent, lineWidth, semi, singleQuote, trailingComma, whitespace, proseWrap }),
    [chosenIndent, lineWidth, semi, singleQuote, trailingComma, whitespace, proseWrap],
  );
  const [done, setDone] = useState<Done | null>(null);
  const [working, setWorking] = useState<FormatJob | null>(null);
  const [loading, setLoading] = useState<CodeLanguage | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  const { history, recorder } = useToolHistory(host, 'code-format', codeFormatHistory);

  const formatter = useMemo(() => createFormatter(), []);
  useEffect(() => () => formatter.dispose(), [formatter]);

  // Auto reads only the first 16 Ki characters (§5 п. 7).
  const detected = useMemo(() => (choice === 'auto' ? detectLanguage(input) : null), [choice, input]);
  const language: CodeLanguage | null = choice === 'auto' ? detected : choice;
  const job = useMemo<FormatJob | null>(
    () => (language === null ? null : { language, text: input, settings }),
    [language, input, settings],
  );
  const blank = input.trim() === '';
  const tooLarge = language !== null && input.length > MAX_INPUT[language];
  const large = !tooLarge && input.length > LIVE_INPUT;

  const latest = useRef<FormatJob | null>(null);
  /** The choice the latest job was made under, recorded with its result. */
  const choiceOf = useRef<Choice>('auto');
  choiceOf.current = choice;
  const runAction = useRef<'run' | null>(null);
  const start = useCallback(
    (next: FormatJob, restart: boolean, action: 'run' | null = null): void => {
      if (restart) formatter.cancel();
      latest.current = next;
      runAction.current = action;
      if (restart) setWorking(next);
      void formatter
        .run(next, loaded => {
          if (latest.current === next) setLoading(loaded);
        })
        .then(outcome => {
          if (latest.current !== next || outcome === null) return;
          setLoading(null);
          setDone({ job: next, outcome });
          setWorking(null);
        });
    },
    [formatter],
  );

  const cancel = useCallback((): void => {
    formatter.cancel();
    latest.current = null;
    setWorking(null);
    setLoading(null);
  }, [formatter]);

  // Live: 300 ms after the last edit of the code, at once after an option, up to LIVE_INPUT. A large input waits for
  // Run; a new edit stops a Run under way.
  const runOnce = useRef(false);
  const lastText = useRef<string | null>(null);
  useEffect(() => {
    if (working && working !== job) cancel();
    if (job === null || blank || tooLarge || large) {
      if (runOnce.current && job !== null && large) start(job, true, 'run');
      runOnce.current = false;
      if (job === null || blank) setLoading(null);
      return;
    }
    runOnce.current = false;
    const delay = lastText.current === job.text ? 0 : SETTLE_MS;
    lastText.current = job.text;
    if (delay === 0) {
      start(job, false);
      return;
    }
    const timer = setTimeout(() => start(job, false), delay);
    return () => clearTimeout(timer);
  }, [job, blank, tooLarge, large, working, start, cancel]);

  const cancelButton = useRef<HTMLButtonElement>(null);
  const focusCancel = useRef(false);
  useEffect(() => {
    if (working && focusCancel.current) cancelButton.current?.focus();
    focusCancel.current = false;
  }, [working]);

  const run = (): void => {
    if (job === null || blank || tooLarge) return;
    start(job, large, 'run');
  };

  const current = done && done.job === job ? done.outcome : null;
  // While a small input settles, the previous result stays (no flicker); a large one waits for Run.
  const shownOutcome =
    current ??
    (!blank && !tooLarge && !large && job !== null && done && done.job.language === job.language ? done.outcome : null);
  const shown = resultOf(shownOutcome ?? undefined);
  /** The previous result, shown while the new one is under way (the status says so through `data-stale`). */
  const stale = shownOutcome !== null && shownOutcome !== current;
  const output = shown?.ok ? shown.text : '';
  const fits = useMemo(() => output.length <= SHOW_RESULT_CHARS && lineCount(output) <= SHOW_RESULT_LINES, [output]);
  const summary = useMemo(
    () =>
      fits
        ? ''
        : `Result: ${formatSize(new TextEncoder().encode(output).length)}, ${lineCount(output).toLocaleString('en-US')} lines. Too large to show here.`,
    [fits, output],
  );

  // A person's edit (or text handed over from the start page) is recorded once its result is there; a Run's result is
  // committed (an explicit action).
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || !done) return;
    const action = runAction.current;
    runAction.current = null;
    const draft = draftOf(done, choiceOf.current, action ?? undefined);
    if (!draft) return;
    if (action) void recorder.commit(draft);
    else recorder.change(draft);
  }, [recorder, done]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setMessage(null);
    apply();
  };
  // The option the person chose: shown and saved.
  const setOption = <K extends keyof FormatSettings>(key: K, value: FormatSettings[K]): void =>
    edit(() => saved.set({ [key]: value } as Partial<FormatSettings>));

  const take = (action: 'copy' | 'save'): void => {
    if (!current || !done) return;
    const draft = draftOf(done, choice, action);
    if (draft) void recorder.commit(draft);
  };

  const openFile = async (file: File): Promise<void> => {
    const named = languageOfFile(file.name);
    const limit = MAX_INPUT[named ?? 'xml'];
    if (file.size > limit * UTF8_MAX) {
      edit(() => setMessage(tooLargeMessage(named ?? 'xml')));
      return;
    }
    const decoded = decodeTextFile(new Uint8Array(await file.arrayBuffer()));
    if (!decoded.ok) {
      edit(() => setMessage(decoded.message));
      return;
    }
    edit(() => {
      setInput(decoded.text);
      // The file's language (by its extension) for this visit; what is saved stays.
      saved.visit({ language: named ?? 'auto' });
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
    const p = (opened.payload ?? {}) as Partial<CodeFormatPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setMessage(null);
      setInput(text);
      // The entry's choice and options for this visit; what is saved stays as it was.
      saved.visit({
        language: isChoice(p.choice) ? p.choice : isLanguage(p.language) ? p.language : 'auto',
        ...settingsOf(p.settings),
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

  const failure = shownOutcome && !('result' in shownOutcome) ? shownOutcome : null;
  let status: ReactNode = ' ';
  let tone: 'error' | 'note' | 'success' = 'note';
  if (message) [status, tone] = [message, 'error'];
  else if (blank) status = ' ';
  else if (language === null) status = UNDETECTED_MESSAGE;
  else if (tooLarge) [status, tone] = [tooLargeMessage(language), 'error'];
  else if (loading) status = loadingMessage(loading);
  else if (working) status = 'Formatting…';
  else if (large && !current) status = LARGE_MESSAGE;
  else if (failure)
    [status, tone] = [
      'timedOut' in failure
        ? TIMED_OUT_MESSAGE
        : failure.failure === NO_WORKERS
          ? NO_WORKERS
          : `The formatter stopped: ${failure.failure}`,
      'error',
    ];
  else if (shown && !shown.ok) {
    tone = 'error';
    const { error } = shown;
    status = isPlaced(error) ? (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(error.offset)}>
        <CircleAlertIcon aria-hidden="true" />
        {`Line ${error.line}, column ${error.column}: ${error.message}`}
      </Button>
    ) : (
      error.message
    );
  }

  const has = language === null ? null : OPTIONS_OF[language];
  const indent = language === null ? settings.indent : effectiveIndent(language, settings.indent);
  const taken = current !== null && shown?.ok === true && output !== '';
  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  const languageLabel =
    choice === 'auto' && detected !== null ? `Auto (${LANGUAGE_LABELS[detected]})` : choice === 'auto' ? 'Auto' : null;
  const secondRow = has !== null && (has.semi || has.quotes || has.trailingComma || has.whitespace || has.proseWrap);

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Label htmlFor="code-format-language" className="text-muted-foreground">
          Language
        </Label>
        <Select
          value={choice}
          onValueChange={value => {
            if (isChoice(value) && value !== choice) edit(() => saved.set({ language: value }));
          }}>
          <SelectTrigger id="code-format-language" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{languageLabel ?? 'Auto'}</SelectItem>
            {LANGUAGES.map(l => (
              <SelectItem key={l} value={l}>
                {LANGUAGE_LABELS[l]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Label htmlFor="code-format-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(indent)}
          onValueChange={value => setOption('indent', value === 'tab' ? 'tab' : (Number(value) as Indent))}>
          <SelectTrigger id="code-format-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENTS.filter(i => i.value !== 'tab' || has === null || has.tabs).map(i => (
              <SelectItem key={String(i.value)} value={String(i.value)}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {(has === null || has.lineWidth) && (
          <>
            <Label htmlFor="code-format-width" className="ml-2 text-muted-foreground">
              Line width
            </Label>
            <Select
              value={String(settings.lineWidth)}
              onValueChange={value => setOption('lineWidth', Number(value) as LineWidth)}>
              <SelectTrigger id="code-format-width" className="min-w-20">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {WIDTHS.map(w => (
                  <SelectItem key={w} value={String(w)}>
                    {w}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {large && !tooLarge && !working && job !== null && !blank && (
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

      {secondRow && has && (
        <ToolOptions data-part="language-options">
          {has.semi && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="code-format-semi"
                checked={settings.semi}
                onCheckedChange={checked => setOption('semi', checked === true)}
              />
              <Label htmlFor="code-format-semi" className="font-normal">
                Semicolons
              </Label>
            </div>
          )}
          {has.quotes && (
            <>
              <span className="ml-2 text-sm text-muted-foreground" id="code-format-quotes">
                Quotes
              </span>
              <ToggleGroup
                type="single"
                variant="segmented"
                aria-labelledby="code-format-quotes"
                value={settings.singleQuote ? 'single' : 'double'}
                onValueChange={value => {
                  if (value === 'single' || value === 'double') setOption('singleQuote', value === 'single');
                }}>
                <ToggleGroupItem value="double">Double</ToggleGroupItem>
                <ToggleGroupItem value="single">Single</ToggleGroupItem>
              </ToggleGroup>
            </>
          )}
          {has.trailingComma && (
            <>
              <Label htmlFor="code-format-trailing" className="ml-2 text-muted-foreground">
                Trailing commas
              </Label>
              <Select
                value={settings.trailingComma}
                onValueChange={value => {
                  const next = TRAILING.find(t => t.value === value);
                  if (next) setOption('trailingComma', next.value);
                }}>
                <SelectTrigger id="code-format-trailing" className="min-w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TRAILING.map(t => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {has.whitespace && (
            <>
              <Label htmlFor="code-format-whitespace" className="text-muted-foreground">
                Whitespace
              </Label>
              <Select
                value={settings.whitespace}
                onValueChange={value => {
                  const next = WHITESPACE.find(w => w.value === value);
                  if (next) setOption('whitespace', next.value);
                }}>
                <SelectTrigger id="code-format-whitespace" className="min-w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WHITESPACE.map(w => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
          {has.proseWrap && (
            <>
              <Label htmlFor="code-format-prose" className="text-muted-foreground">
                Prose wrap
              </Label>
              <Select
                value={settings.proseWrap}
                onValueChange={value => {
                  const next = PROSE.find(p => p.value === value);
                  if (next) setOption('proseWrap', next.value);
                }}>
                <SelectTrigger id="code-format-prose" className="min-w-28">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {PROSE.map(p => (
                    <SelectItem key={p.value} value={p.value}>
                      {p.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </>
          )}
        </ToolOptions>
      )}

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Code" htmlFor="code-format-input">
          <Textarea
            ref={field}
            id="code-format-input"
            className={code}
            spellCheck={false}
            placeholder="Paste code: JavaScript, CSS, HTML, XML…"
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
          label="Formatted"
          htmlFor={fits ? 'code-format-output' : undefined}
          actions={
            <>
              <CopyButton value={taken ? output : ''} onCopied={() => take('copy')} />
              <Button
                variant="ghost"
                size="sm"
                disabled={!taken}
                onClick={() => {
                  if (!language) return;
                  save(output, language);
                  take('save');
                }}>
                Save
              </Button>
            </>
          }>
          {fits ? (
            <Textarea id="code-format-output" className={code} spellCheck={false} wrap="off" readOnly value={output} />
          ) : (
            <p className="m-0 text-sm text-muted-foreground" data-part="summary">
              {summary}
            </p>
          )}
          <ToolMessage data-part="note">{language === 'html' ? HTML_NOTE : ' '}</ToolMessage>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default CodeFormatTool;
