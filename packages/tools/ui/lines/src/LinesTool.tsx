/**
 * The Lines tool's page (docs/tools/specs/lines.md §8): nine steps applied from top to bottom, each a checkbox with its
 * options and, for the steps that change the number of lines, a counter; then the input and the result side by side,
 * the limit's message under the input and the summary under the result. All logic is in @workspace/tool-logic-lines.
 * The result follows every edit up to 20,000 lines and 1 Mi characters; above that it is computed in the tool's worker
 * (compute.ts) 300 ms after the last edit, with "Updating…" meanwhile; above 200,000 lines or 8 Mi characters the tool
 * refuses (§12). Shuffle draws from a tape of random bytes kept here (§5.9.6), so editing other steps keeps the order.
 * It records into the tool history through its host: an edit snapshot (`change`) and a commit when the result is taken
 * — Copy, Use as input; an entry the host asks to open comes back as the input, the steps and the shuffled order. The
 * page frame (title, summary, the history line) is the host's.
 */
import { createCompute } from './compute';
import { draftOf } from './entries';
import { linesHistory } from './history';
import {
  BLANK_MODES,
  DEFAULT_STEPS,
  DIRECTIONS,
  DUPLICATE_MODES,
  FILTER_MODES,
  JOIN_WITH,
  NUMBER_FORMATS,
  ORDER_KINDS,
  PADDING,
  SORT_BY,
  SPLIT_ON,
  START_AT,
  STEP_ORDER,
  TRIM_WHERE,
  allOff,
  isShuffling,
  readSteps,
  takesUppercaseFirst,
  toPipeline,
} from './steps';
import {
  LIMITS,
  SETTLE_MS,
  countLines,
  countSplit,
  createShuffleTape,
  deltaText,
  runPipeline,
  summaryText,
} from '@workspace/tool-logic-lines';
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
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { LinesPayload } from './entries';
import type { Choice, StepId, Steps } from './steps';
import type { CountedStep, Pipeline, PipelineResult, ShuffleTape } from '@workspace/tool-logic-lines';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

/** How the result is computed for this input (§12). */
type Tier = 'empty' | 'live' | 'delayed' | 'refused';

const tierOf = (text: string, pipeline: Pipeline): Tier => {
  if (text === '') return 'empty';
  if (text.length > LIMITS.maxChars) return 'refused';
  const lines = countLines(text);
  if (lines > LIMITS.maxLines) return 'refused';
  const after = pipeline.split.enabled ? countSplit(text, pipeline.split.separator) : lines;
  if (after > LIMITS.maxLines) return 'refused';
  return text.length > LIMITS.liveChars || Math.max(lines, after) > LIMITS.liveLines ? 'delayed' : 'live';
};

interface Job {
  text: string;
  steps: Steps;
  pipeline: Pipeline;
  /** Changes when the shuffle tape is replaced: the same text and steps are computed again. */
  shuffleKey: number;
}

const COUNTED: ReadonlySet<StepId> = new Set<CountedStep>(['split', 'filter', 'blank', 'duplicates']);

const OptionSelect = <T extends string>({
  label,
  value,
  choices,
  disabled,
  onChange,
  className = 'min-w-32',
}: {
  label: string;
  value: T;
  choices: ReadonlyArray<Choice<T>>;
  disabled: boolean;
  onChange: (value: T) => void;
  className?: string;
}): ReactElement => (
  <Select
    value={value}
    disabled={disabled}
    onValueChange={next => {
      const found = choices.find(c => c.value === next);
      if (found) onChange(found.value);
    }}>
    <SelectTrigger aria-label={label} size="sm" className={className}>
      <SelectValue />
    </SelectTrigger>
    <SelectContent>
      {choices.map(c => (
        <SelectItem key={c.value} value={c.value}>
          {c.label}
        </SelectItem>
      ))}
    </SelectContent>
  </Select>
);

const OptionCheck = ({
  id,
  label,
  checked,
  disabled,
  onChange,
}: {
  id: string;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
}): ReactElement => (
  <div className="flex items-center gap-2">
    <Checkbox id={id} checked={checked} disabled={disabled} onCheckedChange={c => onChange(c === true)} />
    <Label htmlFor={id} className="font-normal">
      {label}
    </Label>
  </div>
);

const OptionInput = ({
  label,
  placeholder,
  value,
  disabled,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
}): ReactElement => (
  <Input
    aria-label={label}
    placeholder={placeholder}
    spellCheck={false}
    autoComplete="off"
    className="h-7 w-32"
    value={value}
    disabled={disabled}
    onChange={e => onChange(e.target.value)}
  />
);

const LinesTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [steps, setSteps] = useState<Steps>(DEFAULT_STEPS);
  const [shuffleKey, setShuffleKey] = useState(0);
  const [restored, setRestored] = useState<string | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const tape = useRef<ShuffleTape>(createShuffleTape());
  const { history, recorder } = useToolHistory(host, 'lines', linesHistory);

  const pipeline = useMemo(() => toPipeline(steps), [steps]);
  const job = useMemo<Job>(() => ({ text: input, steps, pipeline, shuffleKey }), [input, steps, pipeline, shuffleKey]);
  const tier = useMemo(() => tierOf(job.text, job.pipeline), [job]);

  // Small inputs follow every edit on the page; a refusal is said at once (the limits are checked before any work).
  // Reading the tape here twice (React's strict mode) reads the same bytes: the tape replays from its start.
  const immediate = useMemo<PipelineResult | null>(
    () => (tier === 'live' || tier === 'refused' ? runPipeline(job.text, job.pipeline, tape.current.reader()) : null),
    [job, tier],
  );

  // Large inputs: 300 ms after the last edit, in the worker; a newer job replaces the one under way.
  const compute = useMemo(() => createCompute(), []);
  useEffect(() => () => compute.dispose(), [compute]);
  const [done, setDone] = useState<{ job: Job; result: PipelineResult } | null>(null);
  const latest = useRef<Job | null>(null);
  useEffect(() => {
    latest.current = job;
    if (tier !== 'delayed') {
      compute.cancel();
      return;
    }
    const timer = setTimeout(() => {
      const used = tape.current;
      compute.run({ text: job.text, pipeline: job.pipeline, tape: used.bytes() }).then(
        reply => {
          if (!reply || latest.current !== job) return;
          if (reply.tape && tape.current === used) tape.current = createShuffleTape(undefined, reply.tape);
          setFailure(null);
          setDone({ job, result: reply.result });
        },
        (error: unknown) => {
          if (latest.current !== job) return;
          setFailure(`Processing stopped: ${error instanceof Error ? error.message : String(error)}`);
          setDone(null);
        },
      );
    }, SETTLE_MS);
    return () => clearTimeout(timer);
  }, [job, tier, compute]);

  /** The result of exactly this input and these steps, when it is there. */
  const current = immediate ?? (done && done.job === job ? done.result : null);
  const updating = tier === 'delayed' && current === null && failure === null;
  // While a large input settles, the previous result stays in view under "Updating…".
  const shown = tier === 'empty' ? null : (current ?? (tier === 'delayed' ? (done?.result ?? null) : null));
  const output = shown?.ok ? shown.text : '';
  const taken = tier !== 'empty' && !updating && current?.ok === true ? current : null;
  const error = tier === 'delayed' && failure ? failure : shown && !shown.ok ? shown.message : null;

  // A person's edit (or text handed over by the host) is recorded once its result is there; opening an entry from
  // History is not an edit.
  const edited = useRef(Boolean(initial));
  const takenOf = (result: Extract<PipelineResult, { ok: true }>) => ({
    input: job.text,
    steps: job.steps,
    output: result.text,
    linesIn: result.linesIn,
    linesOut: result.linesOut,
    tape: isShuffling(job.steps) ? tape.current.bytes() : null,
  });
  const latestTakenOf = useRef(takenOf);
  latestTakenOf.current = takenOf;
  useEffect(() => {
    if (!edited.current || !taken) return;
    const draft = draftOf(latestTakenOf.current(taken));
    if (draft) recorder.change(draft);
  }, [recorder, taken]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };
  const resetTape = (): void => {
    tape.current = createShuffleTape();
    setShuffleKey(k => k + 1);
  };
  const set = <K extends StepId>(id: K, patch: Partial<Steps[K]>): void =>
    edit(() => setSteps(s => ({ ...s, [id]: { ...s[id], ...patch } })));
  const toggle = (id: StepId, enabled: boolean): void => {
    // Turning Order on with Shuffle chosen draws a new order (§5.9.6).
    if (id === 'order' && enabled && steps.order.kind === 'shuffle') resetTape();
    set(id, { enabled });
  };

  const take = (action: LinesPayload['action']): void => {
    if (!taken) return;
    const draft = draftOf(takenOf(taken), action);
    if (draft) void recorder.commit(draft);
  };

  const useAsInput = (): void => {
    if (!taken) return;
    take('use');
    const next = taken.text;
    edit(() => {
      setInput(next);
      setSteps(s => allOff(s));
      resetTape();
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
    const p = (opened.payload ?? {}) as Partial<LinesPayload>;
    void Promise.all([
      opened.blobs.input?.text() ?? Promise.resolve(''),
      opened.blobs.tape?.arrayBuffer() ?? Promise.resolve(null),
    ]).then(([text, bytes]) => {
      edited.current = false;
      tape.current = createShuffleTape(undefined, bytes ? new Uint8Array(bytes) : undefined);
      setShuffleKey(k => k + 1);
      setInput(text);
      setSteps(readSteps(p.steps));
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const deltas = shown?.ok ? shown.deltas : {};
  const counter = (id: StepId): ReactNode => {
    if (!COUNTED.has(id) || !steps[id].enabled || tier === 'empty') return null;
    const delta = deltas[id as CountedStep];
    return delta === undefined ? null : deltaText(delta);
  };

  const s = steps;
  const params: Record<StepId, ReactNode> = {
    split: (
      <>
        <OptionSelect
          label="Split on"
          value={s.split.on}
          choices={SPLIT_ON}
          disabled={!s.split.enabled}
          onChange={on => set('split', { on })}
        />
        {s.split.on === 'custom' && (
          <OptionInput
            label="Custom separator"
            placeholder="Separator"
            value={s.split.custom}
            disabled={!s.split.enabled}
            onChange={custom => set('split', { custom })}
          />
        )}
      </>
    ),
    trim: (
      <>
        <OptionSelect
          label="Trim where"
          value={s.trim.mode}
          choices={TRIM_WHERE}
          disabled={!s.trim.enabled}
          onChange={mode => set('trim', { mode })}
        />
        <OptionCheck
          id="lines-trim-collapse"
          label="Collapse inner whitespace"
          checked={s.trim.collapse}
          disabled={!s.trim.enabled}
          onChange={collapse => set('trim', { collapse })}
        />
      </>
    ),
    filter: (
      <>
        <OptionSelect
          label="Filter mode"
          value={s.filter.mode}
          choices={FILTER_MODES}
          disabled={!s.filter.enabled}
          className="min-w-52"
          onChange={mode => set('filter', { mode })}
        />
        <OptionInput
          label="Filter text"
          placeholder="Text"
          value={s.filter.text}
          disabled={!s.filter.enabled}
          onChange={text => set('filter', { text })}
        />
        <OptionCheck
          id="lines-filter-case"
          label="Match case"
          checked={s.filter.matchCase}
          disabled={!s.filter.enabled}
          onChange={matchCase => set('filter', { matchCase })}
        />
      </>
    ),
    blank: (
      <OptionSelect
        label="Which blank lines"
        value={s.blank.mode}
        choices={BLANK_MODES}
        disabled={!s.blank.enabled}
        onChange={mode => set('blank', { mode })}
      />
    ),
    duplicates: (
      <>
        <OptionSelect
          label="Duplicates mode"
          value={s.duplicates.mode}
          choices={DUPLICATE_MODES}
          disabled={!s.duplicates.enabled}
          className="min-w-44"
          onChange={mode => set('duplicates', { mode })}
        />
        <OptionCheck
          id="lines-duplicates-case"
          label="Ignore case"
          checked={s.duplicates.ignoreCase}
          disabled={!s.duplicates.enabled}
          onChange={ignoreCase => set('duplicates', { ignoreCase })}
        />
        <OptionCheck
          id="lines-duplicates-space"
          label="Ignore whitespace"
          checked={s.duplicates.ignoreWhitespace}
          disabled={!s.duplicates.enabled}
          onChange={ignoreWhitespace => set('duplicates', { ignoreWhitespace })}
        />
      </>
    ),
    order: (
      <>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Order"
          value={s.order.kind}
          disabled={!s.order.enabled}
          onValueChange={value => {
            const found = ORDER_KINDS.find(c => c.value === value);
            if (!found || found.value === s.order.kind) return;
            if (found.value === 'shuffle') resetTape();
            set('order', { kind: found.value });
          }}>
          {ORDER_KINDS.map(c => (
            <ToggleGroupItem key={c.value} value={c.value}>
              {c.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        {s.order.kind === 'sort' && (
          <>
            <OptionSelect
              label="Sort by"
              value={s.order.sort}
              choices={SORT_BY}
              disabled={!s.order.enabled}
              className="min-w-56"
              onChange={sort => set('order', { sort })}
            />
            <OptionSelect
              label="Direction"
              value={s.order.descending ? 'descending' : 'ascending'}
              choices={DIRECTIONS}
              disabled={!s.order.enabled}
              onChange={direction => set('order', { descending: direction === 'descending' })}
            />
            <OptionCheck
              id="lines-order-upper"
              label="Uppercase first"
              checked={s.order.uppercaseFirst}
              disabled={!s.order.enabled || !takesUppercaseFirst(s.order.sort)}
              onChange={uppercaseFirst => set('order', { uppercaseFirst })}
            />
          </>
        )}
        {s.order.kind === 'shuffle' && (
          <Button variant="outline" size="sm" disabled={!s.order.enabled} onClick={() => edit(resetTape)}>
            Shuffle again
          </Button>
        )}
      </>
    ),
    affix: (
      <>
        <OptionInput
          label="Prefix"
          placeholder="Prefix"
          value={s.affix.prefix}
          disabled={!s.affix.enabled}
          onChange={prefix => set('affix', { prefix })}
        />
        <OptionInput
          label="Suffix"
          placeholder="Suffix"
          value={s.affix.suffix}
          disabled={!s.affix.enabled}
          onChange={suffix => set('affix', { suffix })}
        />
      </>
    ),
    number: (
      <>
        <OptionSelect
          label="Number format"
          value={s.number.format}
          choices={NUMBER_FORMATS}
          disabled={!s.number.enabled}
          onChange={format => set('number', { format })}
        />
        <OptionSelect
          label="Start at"
          value={s.number.start === 0 ? '0' : '1'}
          choices={START_AT}
          disabled={!s.number.enabled}
          onChange={start => set('number', { start: start === '0' ? 0 : 1 })}
        />
        <OptionSelect
          label="Padding"
          value={s.number.pad}
          choices={PADDING}
          disabled={!s.number.enabled}
          className="min-w-36"
          onChange={pad => set('number', { pad })}
        />
      </>
    ),
    join: (
      <>
        <OptionSelect
          label="Join with"
          value={s.join.with}
          choices={JOIN_WITH}
          disabled={!s.join.enabled}
          className="min-w-44"
          onChange={w => set('join', { with: w })}
        />
        {s.join.with === 'custom' && (
          <OptionInput
            label="Custom join separator"
            placeholder="Separator"
            value={s.join.custom}
            disabled={!s.join.enabled}
            onChange={custom => set('join', { custom })}
          />
        )}
      </>
    ),
  };

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  const summary =
    tier === 'empty'
      ? ' '
      : updating
        ? 'Updating…'
        : current?.ok
          ? summaryText(current.linesIn, current.linesOut)
          : ' ';
  return (
    <div className="flex flex-col gap-3">
      <section aria-labelledby="lines-steps-title" className="flex flex-col gap-2" data-part="steps">
        <div className="flex flex-wrap items-baseline gap-x-3">
          <h3 id="lines-steps-title" className="m-0 text-sm font-medium">
            Steps
          </h3>
          <p className="m-0 text-sm text-muted-foreground">Applied from top to bottom.</p>
        </div>
        {STEP_ORDER.map(({ id, label }) => (
          <div
            key={id}
            role="group"
            aria-labelledby={`lines-${id}-label`}
            data-step={id}
            className="flex min-h-8 flex-wrap items-center gap-x-3 gap-y-2">
            <div className="flex w-44 shrink-0 items-center gap-2">
              <Checkbox id={`lines-${id}`} checked={s[id].enabled} onCheckedChange={c => toggle(id, c === true)} />
              <Label id={`lines-${id}-label`} htmlFor={`lines-${id}`}>
                {label}
              </Label>
            </div>
            {params[id]}
            <span className="ml-auto text-sm text-muted-foreground" data-part="delta">
              {counter(id)}
            </span>
          </div>
        ))}
      </section>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor="lines-input">
          <InputField
            id="lines-input"
            className={code}
            spellCheck={false}
            wrap="off"
            placeholder="One item per line"
            value={input}
            onValueChange={next => edit(() => setInput(next))}
          />
          {/* Changes while typing: colored as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {error ?? ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor="lines-output"
          actions={
            <>
              <Button variant="ghost" size="sm" disabled={!taken} onClick={useAsInput}>
                Use as input
              </Button>
              <CopyButton value={taken ? taken.text : ''} onCopied={() => take('copy')} />
            </>
          }>
          <ResultField id="lines-output" className={code} spellCheck={false} wrap="off" value={output} />
          <ToolMessage data-part="summary">{summary}</ToolMessage>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default LinesTool;
