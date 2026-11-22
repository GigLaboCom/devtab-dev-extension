/**
 * The String Escape tool's page (docs/tools/specs/backslash-escape.md §8): the direction, the dialect, its quote and the
 * options in one row, input and result side by side, the error under the input and the notes under the result. All
 * logic is in @workspace/tool-logic-backslash-escape. The result follows every edit up to LIVE_INPUT characters; up to
 * MAX_INPUT it comes SETTLE_MS after the last edit, from the tool's worker (compute.ts), and until it does Copy and Swap
 * wait; above that the tool refuses (§12). It records into the tool history through its host: an edit snapshot of the
 * input, the choices and the result (`change`), and a commit when the result is taken — Copy or Swap; an entry the host
 * asks to open comes back as the input and the choices. The page frame (title, summary, the history line) is the host's.
 */
import { createCompute } from './compute';
import { entryLabel, excerpt, isDialect, isMode, isQuoteOf } from './entries';
import { backslashEscapeHistory } from './history';
import { EMPTY, TOO_LARGE, toOutcome } from './outcome';
import { runJob } from './work';
import {
  DIALECTS,
  DIALECT_NAMES,
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  quotesFor,
} from '@workspace/tool-logic-backslash-escape';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { BackslashEscapePayload, Mode } from './history';
import type { Outcome } from './outcome';
import type { Job } from './work';
import type { Dialect, Quote } from '@workspace/tool-logic-backslash-escape';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** The quotes as the Quote select shows them, with their names for a screen reader (§8). */
const QUOTE_NAMES: Record<Quote, string> = { '"': 'Double quote', "'": 'Single quote', '`': 'Backtick' };

const PLACEHOLDER: Record<Mode, string> = {
  escape: 'Text to escape',
  unescape: 'Text with \\n, \\" and other escapes',
};

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

const draftOf = (input: string, outcome: Outcome, action?: 'copy' | 'swap'): HistoryDraft | null => {
  if (input === '' || !outcome.payload) return null;
  const payload: BackslashEscapePayload = { ...outcome.payload, ...(action ? { action } : {}) };
  return {
    kind: payload.mode,
    payload,
    label: entryLabel(payload, input.length),
    text: excerpt(input, outcome.output),
    blobs: outcome.output === '' ? { input: plain(input) } : { input: plain(input), output: plain(outcome.output) },
  };
};

/** The input is worked on as it is typed (up to LIVE_INPUT), refused at once (above MAX_INPUT), or else in the worker. */
const isLive = (input: string): boolean => input.length <= LIVE_INPUT || input.length > MAX_INPUT;

const workOnPage = (job: Job): Outcome => {
  if (job.input === '') return EMPTY;
  if (job.input.length > MAX_INPUT) return { ...EMPTY, error: TOO_LARGE };
  return toOutcome(job, runJob(job));
};

/**
 * The outcome for `job`, and whether it belongs to it. A large job is sent to the worker SETTLE_MS after the last
 * change; until its answer comes, the last outcome stays on screen, marked as not this job's (`current` false).
 */
const useOutcome = (job: Job): { outcome: Outcome; current: boolean } => {
  const live = isLive(job.input);
  const onPage = useMemo(() => (live ? workOnPage(job) : null), [live, job]);
  const compute = useMemo(() => createCompute(), []);
  useEffect(() => () => compute.dispose(), [compute]);
  const [answered, setAnswered] = useState<{ job: Job; outcome: Outcome } | null>(null);
  useEffect(() => {
    if (live) {
      compute.cancel();
      return;
    }
    const timer = setTimeout(() => {
      compute.run(job).then(
        computed => {
          if (computed) setAnswered({ job, outcome: toOutcome(job, computed) });
        },
        (error: Error) => setAnswered({ job, outcome: { ...EMPTY, error: `Could not finish: ${error.message}` } }),
      );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [live, job, compute]);
  // What was last shown for a job of its own stays on screen while a large job waits for its answer.
  const shown = useRef<Outcome>(EMPTY);
  const current = onPage !== null || answered?.job === job;
  const outcome = onPage ?? (current && answered ? answered.outcome : shown.current);
  useEffect(() => {
    if (current) shown.current = outcome;
  }, [current, outcome]);
  return { outcome, current };
};

const BackslashEscapeTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page was recognised as escaped text (detectBackslashEscape): it is there to be read.
  const [mode, setMode] = useState<Mode>(initial ? 'unescape' : 'escape');
  const [dialect, setDialect] = useState<Dialect>('json');
  const [quote, setQuote] = useState<Quote>('"');
  const [nonAscii, setNonAscii] = useState(false);
  const [withQuotes, setWithQuotes] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'backslash-escape', backslashEscapeHistory);

  const job = useMemo<Job>(
    () => ({ input, mode, dialect, quote, nonAscii, withQuotes }),
    [input, mode, dialect, quote, nonAscii, withQuotes],
  );
  const { outcome, current } = useOutcome(job);

  // A person's edit (or text handed over from the start page) is recorded once its result is there; opening an entry
  // from History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || !current) return;
    const draft = draftOf(job.input, outcome);
    if (draft) recorder.change(draft);
  }, [recorder, job, outcome, current]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  const take = (action: 'copy' | 'swap'): void => {
    const draft = draftOf(job.input, outcome, action);
    if (draft) void recorder.commit(draft);
  };

  const swap = (): void => {
    take('swap');
    edit(() => {
      setInput(outcome.output);
      setMode(mode === 'escape' ? 'unescape' : 'escape');
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
    const p = (opened.payload ?? {}) as Partial<BackslashEscapePayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      const openedDialect = isDialect(p.dialect) ? p.dialect : 'json';
      setInput(text);
      setMode(isMode(p.mode) ? p.mode : opened.entry.kind === 'unescape' ? 'unescape' : 'escape');
      setDialect(openedDialect);
      setQuote(isQuoteOf(openedDialect, p.quote) ? p.quote : '"');
      setNonAscii(p.nonAscii === true);
      setWithQuotes(p.withQuotes === true);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const quotes = quotesFor(dialect);
  const ready = current && outcome.output !== '';
  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Mode"
          value={mode}
          onValueChange={value => {
            if (isMode(value) && value !== mode) edit(() => setMode(value));
          }}>
          <ToggleGroupItem value="escape">Escape</ToggleGroupItem>
          <ToggleGroupItem value="unescape">Unescape</ToggleGroupItem>
        </ToggleGroup>
        <Label htmlFor="backslash-escape-dialect" className="ml-2 text-muted-foreground">
          Dialect
        </Label>
        <Select
          value={dialect}
          onValueChange={value => {
            if (!isDialect(value) || value === dialect) return;
            edit(() => {
              setDialect(value);
              // §4: a new dialect starts from the double quote.
              setQuote('"');
            });
          }}>
          <SelectTrigger id="backslash-escape-dialect" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {DIALECTS.map(d => (
              <SelectItem key={d} value={d}>
                {DIALECT_NAMES[d]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {mode === 'escape' && quotes.length > 1 && (
          <>
            <Label htmlFor="backslash-escape-quote" className="ml-2 text-muted-foreground">
              Quote
            </Label>
            <Select
              value={quote}
              onValueChange={value => {
                if (isQuoteOf(dialect, value)) edit(() => setQuote(value));
              }}>
              <SelectTrigger id="backslash-escape-quote" className="min-w-16 font-mono">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {quotes.map(q => (
                  <SelectItem key={q} value={q} textValue={QUOTE_NAMES[q]}>
                    {/* The option's name is read from its text (Radix labels it by it): the quote is seen, its name heard. */}
                    <span aria-hidden="true" className="font-mono">
                      {q}
                    </span>
                    <span className="sr-only">{QUOTE_NAMES[q]}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {mode === 'escape' && (
          <div className="ml-2 flex items-center gap-2">
            <Checkbox
              id="backslash-escape-non-ascii"
              checked={nonAscii}
              onCheckedChange={checked => edit(() => setNonAscii(checked === true))}
            />
            <Label htmlFor="backslash-escape-non-ascii" className="font-normal">
              Escape non-ASCII
            </Label>
          </div>
        )}
        <div className="ml-2 flex items-center gap-2">
          <Checkbox
            id="backslash-escape-with-quotes"
            checked={withQuotes}
            onCheckedChange={checked => edit(() => setWithQuotes(checked === true))}
          />
          <Label htmlFor="backslash-escape-with-quotes" className="font-normal">
            With quotes
          </Label>
        </div>
        <Button variant="outline" className="ml-auto" disabled={!ready} onClick={swap}>
          Swap
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor="backslash-escape-input">
          <Textarea
            id="backslash-escape-input"
            className={code}
            spellCheck={false}
            placeholder={PLACEHOLDER[mode]}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
          />
          {/* Changes while typing: colored as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {(current && outcome.error) || ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor="backslash-escape-output"
          actions={<CopyButton value={outcome.output} size="sm" disabled={!current} onCopied={() => take('copy')} />}>
          <ResultField id="backslash-escape-output" className={code} spellCheck={false} value={outcome.output} />
          {outcome.notes.length === 0 || !current ? (
            <ToolMessage data-part="note" />
          ) : (
            outcome.notes.map(note => (
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

export default BackslashEscapeTool;
