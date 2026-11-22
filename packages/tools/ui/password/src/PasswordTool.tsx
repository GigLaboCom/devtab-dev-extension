/**
 * The Password Generator's page (docs/tools/specs/password.md §8): the mode, the result with its copy actions and
 * Generate, the strength line, the options of the mode, How many and the hint. All logic is in
 * @workspace/tool-logic-password; the word list loads on the first switch to Words. Every change of a setting makes
 * new passwords at once, so what is shown always matches the settings shown; while any setting is invalid no password
 * is shown.
 *
 * History (D17): one secret kind, `generated`, recorded through the host — Generate, Copy and Copy all `commit`, a
 * change of the settings is a `change`. The history keeps it only encrypted, with a master password set and unlocked;
 * the hint says which applies now. An entry opened from History brings its settings and its passwords back.
 * The page frame (title, summary, the history line) is the host's.
 *
 * "Copy automatically after generating" (the host's per-tool setting, docs/tools/copying.md): a press of Generate also
 * copies what Copy / Copy all would — never a change of the settings, the opening of the tool or of an entry. It is
 * not recorded again (Generate committed the set already); the screen reader hears one sentence for both.
 *
 * How passwords are made is a saved parameter (settings.ts; docs/tools/settings.md): the page opens with what the person
 * chose last time where the host remembers it, and makes its first passwords with it; an opened entry shows its own
 * settings for the visit without changing what is saved; the host's reset makes new passwords with the defaults.
 */
import { passwordHistory } from './history';
import { DEFAULT_FIELDS, fieldsOf, generatedLabel, readPayload, settingsOf } from './payload';
import { fieldsFromSaved, passwordSettings, savedOf } from './settings';
import {
  CHAR_SETS,
  DEFAULT_SYMBOLS,
  LIMITS,
  generate,
  loadWordList,
  strength,
  strengthLine,
  strengthNote,
} from '@workspace/tool-logic-password';
import {
  AUTO_COPY_REFUSED,
  announceGenerated,
  useAutoCopy,
  useRestore,
  useSavedSettings,
  useToolHistory,
} from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useEffect, useRef, useState } from 'react';
import type { PasswordPayload } from './history';
import type { Fields, Mode } from './payload';
import type { CharSet, FieldError, Generated, Separator, Settings } from '@workspace/tool-logic-password';
import type { HistoryDraft, RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement, ReactNode } from 'react';

const SET_LABELS: Record<CharSet, string> = {
  upper: 'Uppercase (A–Z)',
  lower: 'Lowercase (a–z)',
  digits: 'Digits (0–9)',
  symbols: 'Symbols',
};

const SEPARATOR_LABELS: Record<Separator, string> = {
  '-': 'Hyphen (-)',
  ' ': 'Space',
  '.': 'Period (.)',
  _: 'Underscore (_)',
};

const LIST_FAILED: Generated = {
  ok: false,
  errors: [{ field: 'generation', message: 'Could not load the word list.' }],
};

/**
 * What the hint says about keeping the passwords, in the words of the host's history line for secrets (§8 said "not
 * stored" before D17; now that depends on the history and its master password).
 */
const keptSentence = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'Generated passwords are not kept (history is off).'
    : status.secrets === 'unlocked'
      ? 'Generated passwords are kept encrypted in this browser.'
      : status.secrets === 'locked'
        ? 'Generated passwords are not kept while the history is locked.'
        : 'Generated passwords are not kept (no master password).';

/** What made the passwords: the page opening (nothing recorded or said), a person's edit, or Generate. */
type Origin = 'open' | 'edit' | 'generate';

const PasswordTool = ({ host, restore }: ToolProps): ReactElement => {
  // The reset control (the host's): new passwords with the defaults, as after any change of the settings.
  const saved = useSavedSettings(host, 'password', passwordSettings, {
    onReset: () => apply({ ...DEFAULT_FIELDS }, 'edit'),
  });
  const [opened] = useState<Fields>(() => fieldsFromSaved(saved.values));
  const [fields, setFields] = useState<Fields>(opened);
  // The passwords are made when the tool opens (§4); null while the word list loads.
  const [result, setResult] = useState<Generated | null>(() =>
    opened.mode === 'words' ? null : generate(settingsOf(opened)),
  );
  const [announcement, setAnnouncement] = useState('');
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'password', passwordHistory);
  const autoCopy = useAutoCopy(host, 'password');
  const latest = useRef(opened);
  const wordList = useRef<readonly string[] | null>(null);
  const loading = useRef<Promise<readonly string[]> | null>(null);

  const needWordList = (): Promise<readonly string[]> =>
    (loading.current ??= loadWordList().then(
      list => (wordList.current = list),
      error => {
        loading.current = null;
        throw error;
      },
    ));

  const draftOf = (settings: Settings, g: Extract<Generated, { ok: true }>): HistoryDraft => {
    const payload: PasswordPayload = { settings, values: g.values };
    // Plain JSON (numbers, strings, booleans); the logic's option types are interfaces, which TypeScript does not
    // take for JSON objects.
    return {
      kind: 'generated',
      payload: payload as unknown as HistoryDraft['payload'],
      label: generatedLabel(settings, g.entropyBits),
    };
  };

  /** Shows a fresh result for `next`; a person's edit is a change, Generate a commit (and the automatic copy). */
  const shown = (next: Fields, g: Generated, origin: Origin): void => {
    setResult(g);
    if (!g.ok || origin === 'open') return;
    const generated = g.values.length === 1 ? 'New password generated' : `${g.values.length} new passwords generated`;
    const draft = draftOf(settingsOf(next), g);
    if (origin !== 'generate') {
      setAnnouncement(generated);
      recorder.change(draft);
      return;
    }
    void recorder.commit(draft);
    if (!autoCopy.on) setAnnouncement(generated);
    // What Copy / Copy all copies; announced once, with what the copy did.
    else void autoCopy.afterGenerate(g.values.join('\n')).then(o => setAnnouncement(announceGenerated(generated, o)));
  };

  const apply = (next: Fields, origin: Origin): void => {
    latest.current = next;
    setFields(next);
    setRestored(null);
    const settings = settingsOf(next);
    if (settings.mode === 'words' && !wordList.current) {
      const checked = strength(settings);
      if (!checked.ok) {
        setResult(checked);
        return;
      }
      setResult(null);
      needWordList().then(
        list => {
          if (latest.current === next) shown(next, generate(settings, list), origin);
        },
        () => {
          if (latest.current === next) setResult(LIST_FAILED);
        },
      );
      return;
    }
    shown(next, generate(settings, wordList.current ?? undefined), origin);
  };

  const edit = (change: Partial<Fields>): void => {
    saved.set(savedOf(change));
    apply({ ...latest.current, ...change }, 'edit');
  };

  // Opened in Words (saved): the first passwords wait for the word list.
  useEffect(() => {
    if (opened.mode === 'words') apply(opened, 'open');
    // eslint-disable-next-line react-hooks/exhaustive-deps -- once, when the page opens
  }, []);

  const copied = (): void => {
    if (result?.ok) void recorder.commit(draftOf(settingsOf(latest.current), result));
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
    const entry = readPayload(opened.payload);
    const checked = entry && strength(entry.settings);
    if (!entry || !checked?.ok || entry.values.length !== entry.settings.count) {
      setRestored('This entry could not be opened.');
      return;
    }
    const next = fieldsOf(entry.settings, latest.current);
    latest.current = next;
    setFields(next);
    // The passwords as they were, not new ones: opening an entry generates and records nothing.
    setResult({ ok: true, values: entry.values, entropyBits: checked.entropyBits, summary: checked.summary });
    if (next.mode === 'words') void needWordList().catch(() => undefined);
    setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
  });

  const errors = result && !result.ok ? result.errors : [];
  const errorOf = (field: FieldError['field']): string | undefined => errors.find(e => e.field === field)?.message;
  const values = result?.ok ? result.values : [];
  const ready = result?.ok === true;
  const enabledSets = CHAR_SETS.filter(s => fields.sets[s]).length;
  const general = errorOf('random') ?? errorOf('generation');
  const refused = autoCopy.outcome?.ok === false && autoCopy.outcome.text === values.join('\n');

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
    limit: { min: number; max: number },
    onChange: (value: string) => void,
    message: string | undefined,
  ): ReactElement => (
    <div className="flex items-center gap-2">
      <Label htmlFor={id}>{label}</Label>
      <Input
        id={id}
        type="number"
        inputMode="numeric"
        min={limit.min}
        max={limit.max}
        step={1}
        className="w-20"
        spellCheck={false}
        autoComplete="off"
        value={value}
        onChange={e => onChange(e.target.value)}
        {...described(`${id}-error`, message)}
      />
    </div>
  );

  const generateButton = (
    <Button onClick={() => apply(latest.current, 'generate')} disabled={!ready}>
      Generate
    </Button>
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
            if (value === 'chars' || value === 'words') edit({ mode: value satisfies Mode });
          }}>
          {/* Sized by their words: the segmented look gives both segments one width, too narrow for the longer. */}
          <ToggleGroupItem value="chars" className="flex-auto">
            Random characters
          </ToggleGroupItem>
          <ToggleGroupItem value="words" className="flex-auto">
            Words
          </ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      {general && <ToolMessage tone="error">{general}</ToolMessage>}

      {values.length > 1 ? (
        <div className="flex flex-col gap-2">
          <div className="flex items-center gap-2">
            <CopyButton
              label="Copy all"
              variant="outline"
              value={values.join('\n')}
              onCopied={copied}
              outcome={autoCopy.outcome}
            />
            {generateButton}
          </div>
          <ResultRows className="w-fit max-w-full">
            {values.map((value, i) => (
              <ResultRow
                key={i}
                label={String(i + 1)}
                value={value}
                outputLabel={`Generated password ${i + 1}`}
                copyLabel={`Copy password ${i + 1}`}
                copy={{ onCopied: copied }}
              />
            ))}
          </ResultRows>
        </div>
      ) : fields.count !== '1' && !ready ? (
        <div className="flex items-center gap-2">
          <CopyButton label="Copy all" variant="outline" value="" />
          {generateButton}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <output
            aria-label="Generated password"
            className="kit-result-row-value min-h-5 min-w-0"
            data-empty={values.length === 0 || undefined}>
            {values[0] ?? ''}
          </output>
          <CopyButton variant="outline" value={values[0] ?? ''} onCopied={copied} outcome={autoCopy.outcome} />
          {generateButton}
        </div>
      )}

      {/* Read out within the announcement below, not again here. */}
      {refused && (
        <ToolMessage role={undefined} data-auto-copy="refused">
          {AUTO_COPY_REFUSED}
        </ToolMessage>
      )}

      {result?.ok && (
        <div className="flex flex-col gap-0.5">
          <p className="m-0 text-sm text-foreground" data-strength>
            {strengthLine(result.entropyBits, result.summary)}
          </p>
          <p className="m-0 text-xs text-muted-foreground">{strengthNote(result.entropyBits)}</p>
        </div>
      )}
      {/* Says that passwords were made, never what they are: reading one aloud would leak it (§8). */}
      <p className="sr-only" aria-live="polite">
        {announcement}
      </p>

      {fields.mode === 'chars' ? (
        <div className="flex flex-col gap-2" data-options="chars">
          <div className="flex flex-col gap-1">
            {numberField(
              'password-length',
              'Length',
              fields.length,
              LIMITS.length,
              length => edit({ length }),
              errorOf('length'),
            )}
            {fieldError('password-length-error', errorOf('length'))}
          </div>
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {CHAR_SETS.map(set => (
                <div key={set} className="flex items-center gap-2">
                  <Checkbox
                    id={`password-set-${set}`}
                    checked={fields.sets[set]}
                    // The last chosen set cannot be turned off (§5.3).
                    disabled={fields.sets[set] && enabledSets === 1}
                    onCheckedChange={checked => edit({ sets: { ...latest.current.sets, [set]: checked === true } })}
                    {...described('password-sets-error', errorOf('sets'))}
                  />
                  <Label htmlFor={`password-set-${set}`} className="font-normal">
                    {SET_LABELS[set]}
                  </Label>
                </div>
              ))}
              <div className="flex items-center gap-1">
                <Input
                  aria-label="Symbols to use"
                  className="w-80 font-mono text-code"
                  spellCheck={false}
                  autoComplete="off"
                  autoCapitalize="off"
                  autoCorrect="off"
                  disabled={!fields.sets.symbols}
                  value={fields.symbols}
                  onChange={e => edit({ symbols: e.target.value })}
                  {...described('password-symbols-error', errorOf('symbols'))}
                />
                <Button
                  variant="link"
                  size="sm"
                  disabled={!fields.sets.symbols || fields.symbols === DEFAULT_SYMBOLS}
                  onClick={() => edit({ symbols: DEFAULT_SYMBOLS })}>
                  Reset
                </Button>
              </div>
            </div>
            {fieldError('password-symbols-error', errorOf('symbols'))}
            {fieldError('password-sets-error', errorOf('sets'))}
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id="password-look-alike"
              checked={fields.avoidLookAlike}
              onCheckedChange={checked => edit({ avoidLookAlike: checked === true })}
            />
            <Label htmlFor="password-look-alike" className="font-normal">
              Avoid look-alike characters (0 O 1 I l |)
            </Label>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2" data-options="words">
          <div className="flex flex-col gap-1">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
              {numberField(
                'password-words',
                'Words',
                fields.words,
                LIMITS.words,
                words => edit({ words }),
                errorOf('words'),
              )}
              <div className="flex items-center gap-2">
                <Label htmlFor="password-separator">Separator</Label>
                <Select value={fields.separator} onValueChange={value => edit({ separator: value as Separator })}>
                  <SelectTrigger id="password-separator" className="min-w-36">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(Object.keys(SEPARATOR_LABELS) as Separator[]).map(sep => (
                      <SelectItem key={sep} value={sep}>
                        {SEPARATOR_LABELS[sep]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="password-capitalize"
                  checked={fields.capitalize}
                  onCheckedChange={checked => edit({ capitalize: checked === true })}
                />
                <Label htmlFor="password-capitalize" className="font-normal">
                  Capitalize words
                </Label>
              </div>
            </div>
            {fieldError('password-words-error', errorOf('words'))}
          </div>
          <p className="m-0 text-sm text-muted-foreground">Word list: EFF Large Wordlist (CC BY).</p>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {numberField(
          'password-count',
          'How many',
          fields.count,
          LIMITS.count,
          count => edit({ count }),
          errorOf('count'),
        )}
        {fieldError('password-count-error', errorOf('count'))}
      </div>

      <p className="m-0 text-sm text-muted-foreground" data-hint>
        {`Passwords are made in this tab with the browser's cryptographic random generator. They are not sent anywhere. ${keptSentence(status)} Copied passwords stay in the clipboard until you copy something else.`}
      </p>
    </div>
  );
};

export default PasswordTool;
