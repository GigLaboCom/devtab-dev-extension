/**
 * The Random String tool's page (docs/tools/specs/random-string.md §8): the mode, the options of the mode, How many,
 * Generate with the copy action, the entropy line, the batch and the hint. All rules are in
 * @workspace/tool-logic-random-string; randomness is its default source (crypto.getRandomValues through
 * @workspace/tools-shared/random). The host wraps the page in the kit's ToolPage.
 *
 * Every change of a setting makes a new batch, so what is shown always matches the settings shown; while any setting is
 * invalid no string is shown and the buttons are off. A batch of up to 100,000 characters (or bytes) is made at once; a
 * larger one 300 ms after the last change, Generate saying "Generating…" meanwhile (§12). A batch of up to 20 strings is
 * a row each with its own copy button; a larger one is one read-only field (docs/tools/README.md, «Копирование»).
 *
 * History (D17): one secret kind, `generated`, recorded through the host — Generate and every copy `commit`, a change of
 * the settings is a `change`. The history keeps it only encrypted, with a master password set and unlocked; the hint
 * says which applies now. An entry opened from History brings its settings and its batch back.
 *
 * "Copy automatically after generating" (the host's per-tool setting, docs/tools/copying.md): a press of Generate also
 * copies the whole batch, as Copy / Copy all would — never a change of the settings, the opening of the tool or of an
 * entry. It is not recorded again (Generate committed the batch); the screen reader hears one sentence for both.
 */
import { DEFAULT_FIELDS, draftOf, fieldsOf, readEntry, settingsOf } from './entries';
import { randomStringHistory } from './history';
import {
  ENCODING_LABELS,
  ENCODING_ORDER,
  LIMITS,
  LIVE_TOTAL,
  PRESET_LABELS,
  PRESET_ORDER,
  SETTLE_MS,
  check,
  entropyLine,
  generate,
  generatedLine,
  wholeBits,
} from '@workspace/tool-logic-random-string';
import { AUTO_COPY_REFUSED, announceGenerated, useAutoCopy, useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import type { Fields } from './entries';
import type { Encoding, FieldError, Generated, Preset, Settings } from '@workspace/tool-logic-random-string';
import type { RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

/** Up to this many strings each is a row with its own copy button; more are one field (docs/tools/README.md). */
const MAX_ROWS = 20;

/**
 * What the hint says about keeping the strings, in the words of the host's history line for secrets (§8 said "Nothing
 * is stored." before D17; now that depends on the history and its master password).
 */
const keptSentence = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'Generated strings are not kept (history is off).'
    : status.secrets === 'unlocked'
      ? 'Generated strings are kept encrypted in this browser.'
      : status.secrets === 'locked'
        ? 'Generated strings are not kept while the history is locked.'
        : 'Generated strings are not kept (no master password).';

type Made = Extract<Generated, { ok: true }>;
/** What the page shows: a batch and the settings it was made with, or why there is none. */
type Shown = { settings: Settings; made: Made; bits: number } | { errors: FieldError[] };
type Origin = 'edit' | 'generate';

/** The large batch's field, rendered again only when its text changes: a megabyte in a text area is costly to touch. */
const BatchField = memo(({ text }: { text: string }) => (
  <Textarea
    aria-label="Generated strings"
    className="h-90 resize-y font-mono text-code field-sizing-fixed"
    spellCheck={false}
    readOnly
    value={text}
  />
));
BatchField.displayName = 'BatchField';

/** After the browser has painted (so "Generating…" is seen), then `fn`. */
const afterPaint = (fn: () => void): void => {
  if (typeof requestAnimationFrame === 'function') requestAnimationFrame(() => setTimeout(fn, 0));
  else setTimeout(fn, 0);
};

const makeShown = (settings: Settings): Shown => {
  const made = generate(settings);
  return made.ok ? { settings, made, bits: wholeBits(settings) } : { errors: made.errors };
};

const RandomStringTool = ({ host, restore }: ToolProps): ReactElement => {
  const [fields, setFields] = useState<Fields>(DEFAULT_FIELDS);
  // The batch is made when the tool opens (§4, §6).
  const [shown, setShown] = useState<Shown>(() => makeShown(settingsOf(DEFAULT_FIELDS)));
  const [pending, setPending] = useState(false);
  const [announcement, setAnnouncement] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'random-string', randomStringHistory);
  const autoCopy = useAutoCopy(host, 'random-string');
  const latest = useRef(fields);
  // Every new request (an edit, Generate, an entry opened) takes a new number; late work of an older one is dropped.
  const request = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  const settings = useMemo(() => settingsOf(fields), [fields]);
  const checked = useMemo(() => check(settings), [settings]);
  const bits = useMemo(() => (checked.ok ? wholeBits(settings) : 0), [checked, settings]);

  /** Makes a batch for `next`: a person's edit is a change, Generate a commit (and the automatic copy). */
  const run = (next: Fields, origin: Origin): void => {
    const mine = ++request.current;
    clearTimeout(timer.current);
    const nextSettings = settingsOf(next);
    const nextChecked = check(nextSettings);
    if (!nextChecked.ok) {
      setPending(false);
      setShown({ errors: nextChecked.errors });
      return;
    }
    const make = (): void => {
      if (request.current !== mine) return;
      const result = makeShown(nextSettings);
      setPending(false);
      setShown(result);
      if (!('made' in result)) return;
      const generated = generatedLine(result.made.values.length);
      const draft = draftOf(nextSettings, result.made, result.bits);
      if (origin === 'edit') {
        setAnnouncement(generated);
        recorder.change(draft);
        return;
      }
      void recorder.commit(draft);
      if (!autoCopy.on) setAnnouncement(generated);
      // What Copy / Copy all copies; announced once, with what the copy did. Still the press of Generate: a large batch
      // only waited for the "Generating…" frame to be painted.
      else
        void autoCopy
          .afterGenerate(result.made.values.join('\n'))
          .then(o => setAnnouncement(announceGenerated(generated, o)));
    };
    if (nextChecked.total <= LIVE_TOTAL) {
      make();
      return;
    }
    setPending(true);
    if (origin === 'edit') timer.current = setTimeout(make, SETTLE_MS);
    else afterPaint(make);
  };

  const edit = (change: Partial<Fields>): void => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setFields(next);
    setRestored(null);
    run(next, 'edit');
  };

  const onGenerate = (): void => {
    setRestored(null);
    run(latest.current, 'generate');
  };

  const copied = (): void => {
    if ('made' in shown && !pending) void recorder.commit(draftOf(shown.settings, shown.made, shown.bits));
  };

  useRestore(history, restore, opened => {
    const mine = ++request.current;
    clearTimeout(timer.current);
    setPending(false);
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
    void readEntry(opened).then(
      entry => {
        if (request.current !== mine) return;
        if (!entry) {
          setRestored('This entry could not be opened.');
          return;
        }
        const next = fieldsOf(entry.settings, latest.current);
        latest.current = next;
        setFields(next);
        // The batch as it was, not a new one: opening an entry generates, records and copies nothing.
        const entropyBits = check(entry.settings);
        setShown({
          settings: entry.settings,
          made: {
            ok: true,
            values: entry.values,
            entropyBits: entropyBits.ok ? entropyBits.entropyBits : NaN,
            ...(entry.bytes ? { bytes: entry.bytes } : {}),
          },
          bits: wholeBits(entry.settings),
        });
        setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
      },
      () => {
        if (request.current === mine) setRestored('This entry could not be opened.');
      },
    );
  });

  const values = useMemo(() => ('made' in shown ? shown.made.values : []), [shown]);
  const text = useMemo(() => values.join('\n'), [values]);
  const errors = 'errors' in shown ? shown.errors : checked.ok ? [] : checked.errors;
  const errorOf = (field: FieldError['field']): string | undefined => errors.find(e => e.field === field)?.message;
  const ready = values.length > 0 && !pending;
  const many = values.length > 1 || (values.length === 0 && fields.count.trim() !== '1');
  const refused = autoCopy.outcome?.ok === false && autoCopy.outcome.text === text;
  const countError = errorOf('count') ?? errorOf('total');

  /** A field's error under it, tied to the field by aria-describedby; changes while typing, so read out politely. */
  const fieldError = (id: string, message: string | undefined): ReactNode =>
    message && (
      <ToolMessage tone="error" role="status" id={id}>
        {message}
      </ToolMessage>
    );
  const described = (id: string, message: string | undefined) =>
    message ? { 'aria-invalid': true, 'aria-describedby': id } : {};

  const numberField = (
    id: string,
    label: string,
    value: string,
    max: number,
    onChange: (value: string) => void,
    message: string | undefined,
  ): ReactElement => (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <Label htmlFor={id}>{label}</Label>
        <Input
          id={id}
          type="number"
          inputMode="numeric"
          min={1}
          max={max}
          step={1}
          className="w-24"
          spellCheck={false}
          autoComplete="off"
          value={value}
          onChange={e => onChange(e.target.value)}
          {...described(`${id}-error`, message)}
        />
      </div>
      {fieldError(`${id}-error`, message)}
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Mode"
          value={fields.mode}
          onValueChange={(value: string) => {
            if (value === 'chars' || value === 'bytes') edit({ mode: value });
          }}>
          <ToggleGroupItem value="chars">Characters</ToggleGroupItem>
          <ToggleGroupItem value="bytes">Bytes</ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      {fields.mode === 'chars' ? (
        <div className="flex flex-col gap-2" data-options="chars">
          <div className="flex items-center gap-2">
            <Label htmlFor="random-string-alphabet">Alphabet</Label>
            <Select value={fields.preset} onValueChange={value => edit({ preset: value as Preset })}>
              <SelectTrigger id="random-string-alphabet" className="min-w-60">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRESET_ORDER.map(preset => (
                  <SelectItem key={preset} value={preset}>
                    {PRESET_LABELS[preset]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {fields.preset === 'custom' && (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-center gap-2">
                <Label htmlFor="random-string-custom">Custom alphabet</Label>
                <Input
                  id="random-string-custom"
                  className="w-80 max-w-full font-mono text-code"
                  placeholder="e.g. ACGT"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={fields.custom}
                  onChange={e => edit({ custom: e.target.value })}
                  {...described('random-string-custom-error', errorOf('custom'))}
                />
              </div>
              {fieldError('random-string-custom-error', errorOf('custom'))}
            </div>
          )}
          {numberField(
            'random-string-length',
            'Length',
            fields.length,
            LIMITS.length,
            length => edit({ length }),
            errorOf('length'),
          )}
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-options="bytes">
          {numberField(
            'random-string-bytes',
            'Bytes',
            fields.bytes,
            LIMITS.bytes,
            n => edit({ bytes: n }),
            errorOf('bytes'),
          )}
          <div className="flex items-center gap-2">
            <Label htmlFor="random-string-encoding">Encoding</Label>
            <Select value={fields.encoding} onValueChange={value => edit({ encoding: value as Encoding })}>
              <SelectTrigger id="random-string-encoding" className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {ENCODING_ORDER.map(encoding => (
                  <SelectItem key={encoding} value={encoding}>
                    {ENCODING_LABELS[encoding]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {numberField('random-string-count', 'How many', fields.count, LIMITS.count, count => edit({ count }), countError)}

      <div className="flex items-center gap-2">
        <Button onClick={onGenerate} disabled={!checked.ok || pending}>
          {pending ? 'Generating…' : 'Generate'}
        </Button>
        <CopyButton
          variant="outline"
          label={many ? 'Copy all' : 'Copy'}
          value={ready ? text : ''}
          onCopied={copied}
          outcome={autoCopy.outcome}
        />
      </div>
      {errorOf('random') && <ToolMessage tone="error">{errorOf('random')}</ToolMessage>}

      {checked.ok && (
        <p className="m-0 text-sm text-foreground" data-entropy>
          {entropyLine(bits)}
        </p>
      )}

      {values.length > MAX_ROWS ? (
        <BatchField text={text} />
      ) : values.length > 1 ? (
        <ResultRows role="group" aria-label="Generated strings" className="max-w-full">
          {values.map((value, i) => (
            <ResultRow
              key={i}
              label={String(i + 1)}
              value={value}
              outputLabel={`Generated string ${i + 1}`}
              copyLabel={`Copy string ${i + 1}`}
              copy={{ onCopied: copied, disabled: pending }}
            />
          ))}
        </ResultRows>
      ) : values.length === 1 ? (
        <output aria-label="Generated string" aria-live="off" className="kit-result-row-value min-h-5 min-w-0">
          {values[0]}
        </output>
      ) : null}

      {/* Read out within the announcement below, not again here. */}
      {refused && (
        <ToolMessage role={undefined} data-auto-copy="refused">
          {AUTO_COPY_REFUSED}
        </ToolMessage>
      )}
      {/* Says that strings were made and how many, never what they are: they are tokens and keys (§8). */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      <p className="m-0 text-sm text-muted-foreground" data-hint>
        {`Made in this tab with the browser's cryptographic random generator. ${keptSentence(status)}`}
      </p>
    </div>
  );
};

export default RandomStringTool;
