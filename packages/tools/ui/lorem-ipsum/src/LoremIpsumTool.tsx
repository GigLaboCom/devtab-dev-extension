/**
 * The Lorem Ipsum tool's page (docs/tools/specs/lorem-ipsum.md §8): one row of settings — Unit, Count, the classic
 * opening, Format and Generate —, the Count message, the result with its Copy button and the line under it
 * (`N words · M characters`, the page's announcement). All rules are in @workspace/tool-logic-lorem-ipsum. The host
 * wraps the page in the kit's ToolPage.
 *
 * Randomness (§5.6): the page keeps a replay source — a record of random bytes, new ones from `cryptoRandom`. Every text
 * is made from the record's start, so a change of a setting remakes the text from the same bytes (more paragraphs: the
 * same first paragraphs and new ones at the end; HTML: the same text in tags); Generate forgets the record first. The page
 * opens with a text already made (§2.1); while Count is not a whole number in the unit's range the last text stays.
 *
 * History (D17): the settings only, in clear (entries.ts) — Generate and Copy `commit`, a change of a setting is a
 * `change`. An entry opened from History brings its settings back and makes a new text with them: the text was never
 * kept, and the page says so.
 *
 * "Copy automatically after generating" (the host's per-tool setting, docs/tools/copying.md): a press of Generate also
 * copies the text, as Copy would — never the opening of the page (its first text is not copied), a change of a setting
 * that remakes the text, or the opening of an entry. It records nothing more (Generate committed); the line under the
 * result says what the copy did (`… · copied`, `… · not copied automatically`).
 */
import { draftOf, labelOf, readSettings } from './entries';
import { loremIpsumHistory } from './history';
import {
  DEFAULT_SETTINGS,
  FORMAT_LABELS,
  FORMATS,
  RANDOM_FAILED,
  UNIT_LABELS,
  UNITS,
  countForUnit,
  countMessage,
  createReplaySource,
  generate,
  parseCount,
  statusLine,
} from '@workspace/tool-logic-lorem-ipsum';
import { AUTO_COPY_REFUSED, useAutoCopy, useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane } from '@workspace/ui/tool-page';
import { cn } from '@workspace/ui/utils';
import { memo, useRef, useState } from 'react';
import type { LoremFormat, LoremResult, LoremSettings, LoremUnit } from '@workspace/tool-logic-lorem-ipsum';
import type { AutoCopyOutcome, RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** The form: Count as typed (an empty or a fractional one is a message under it, §6). */
interface Fields {
  unit: LoremUnit;
  count: string;
  startWithLorem: boolean;
  format: LoremFormat;
}

/** What the page shows: a text and the settings it was made with, or why there is none (the source failed). */
type Shown = { settings: LoremSettings; result: LoremResult } | { failed: true };

const fieldsOf = (s: LoremSettings): Fields => ({ ...s, count: String(s.count) });

/** The settings the form says, or null while Count is not a whole number in the unit's range. */
const settingsOf = (f: Fields): LoremSettings | null => {
  const count = parseCount(f.count, f.unit);
  return count === null ? null : { unit: f.unit, count, startWithLorem: f.startWithLorem, format: f.format };
};

/** What the history keeps, said where the text is (the host's line says whether the history is on). */
const keptSentence = (status: RecordingStatus): string =>
  status.gate === 'on'
    ? 'History keeps the settings, not the text: an entry opens with a new text.'
    : 'Nothing is kept: the history is off.';

/** The result field, rendered again only when its text or format changes: 65,000 characters are costly to touch. */
const ResultField = memo(({ text, format }: { text: string; format: LoremFormat }) => (
  <Textarea
    id="lorem-ipsum-result"
    className={cn('h-80 resize-y field-sizing-fixed', format === 'html' && 'font-mono text-code')}
    spellCheck={false}
    readOnly
    value={text}
  />
));
ResultField.displayName = 'ResultField';

const LoremIpsumTool = ({ host, restore }: ToolProps): ReactElement => {
  const replay = useRef<ReturnType<typeof createReplaySource> | null>(null);
  replay.current ??= createReplaySource();
  const make = (settings: LoremSettings): Shown => {
    try {
      return { settings, result: generate(settings, replay.current!.reader()) };
    } catch {
      return { failed: true };
    }
  };

  const [fields, setFields] = useState<Fields>(() => fieldsOf(DEFAULT_SETTINGS));
  // §2.1: the page opens with a text (made from the empty record, so already random) — not copied, not recorded.
  const [shown, setShown] = useState<Shown>(() => make(DEFAULT_SETTINGS));
  // The automatic copy of the last Generate; any other change of the text forgets it.
  const [autoCopied, setAutoCopied] = useState<AutoCopyOutcome | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'lorem-ipsum', loremIpsumHistory);
  const autoCopy = useAutoCopy(host, 'lorem-ipsum');
  const latest = useRef(fields);

  /** A person's edit: the form changes; a valid one remakes the text from the same bytes and is a `change`. */
  const edit = (change: Partial<Fields>): void => {
    const next = { ...latest.current, ...change };
    latest.current = next;
    setFields(next);
    setRestored(null);
    setAutoCopied(null);
    const settings = settingsOf(next);
    if (!settings) return;
    const made = make(settings);
    setShown(made);
    if ('result' in made) recorder.change(draftOf(settings));
  };

  const onUnit = (value: string): void => {
    const unit = UNITS.find(u => u === value);
    if (unit) edit({ unit, count: countForUnit(latest.current.count, unit) });
  };

  /** Generate: new bytes, a new text, a `commit`, and the automatic copy when it is on. */
  const onGenerate = (): void => {
    const settings = settingsOf(latest.current);
    if (!settings) return;
    replay.current!.reset();
    setRestored(null);
    setAutoCopied(null);
    const made = make(settings);
    setShown(made);
    if (!('result' in made)) return;
    void recorder.commit(draftOf(settings));
    if (autoCopy.on) void autoCopy.afterGenerate(made.result.text).then(setAutoCopied);
  };

  const onCopied = (): void => {
    if ('result' in shown) void recorder.commit(draftOf(shown.settings));
  };

  useRestore(history, restore, opened => {
    setAutoCopied(null);
    const settings = opened.ok ? readSettings(opened.payload) : null;
    if (!opened.ok || !settings) {
      setRestored(
        !opened.ok && opened.reason === 'newer-schema'
          ? 'This entry was kept by a newer version of the tool.'
          : 'This entry could not be opened.',
      );
      return;
    }
    const next = fieldsOf(settings);
    latest.current = next;
    setFields(next);
    // The text was never kept: new bytes, a new text with the entry's settings — not recorded, not copied.
    replay.current!.reset();
    setShown(make(settings));
    setRestored(
      `Opened from History: ${opened.label ?? labelOf(settings)}. The text is new: only the settings were kept.`,
    );
  });

  const countValid = parseCount(fields.count, fields.unit) !== null;
  const text = 'result' in shown ? shown.result.text : '';
  const copiedNow = autoCopied !== null && autoCopied.text === text ? autoCopied : null;
  const line =
    'result' in shown
      ? `${statusLine(shown.result)}${copiedNow ? (copiedNow.ok ? ' · copied' : ' · not copied automatically') : ''}`
      : '';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1">
        <ToolOptions>
          <ToggleGroup type="single" variant="segmented" aria-label="Unit" value={fields.unit} onValueChange={onUnit}>
            {UNITS.map(unit => (
              <ToggleGroupItem key={unit} value={unit}>
                {UNIT_LABELS[unit]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Label htmlFor="lorem-ipsum-count" className="ml-2">
            Count
          </Label>
          <Input
            id="lorem-ipsum-count"
            className="w-20"
            inputMode="numeric"
            spellCheck={false}
            autoComplete="off"
            value={fields.count}
            onChange={e => edit({ count: e.target.value })}
            aria-invalid={countValid ? undefined : true}
            aria-describedby={countValid ? undefined : 'lorem-ipsum-count-error'}
          />
          <div className="ml-2 flex items-center gap-2">
            <Checkbox
              id="lorem-ipsum-start"
              checked={fields.startWithLorem}
              onCheckedChange={checked => edit({ startWithLorem: checked === true })}
            />
            <Label htmlFor="lorem-ipsum-start" className="font-normal">
              Start with &quot;Lorem ipsum…&quot;
            </Label>
          </div>
          <ToggleGroup
            type="single"
            variant="segmented"
            aria-label="Format"
            className="ml-2"
            value={fields.format}
            onValueChange={(value: string) => {
              const format = FORMATS.find(f => f === value);
              if (format) edit({ format });
            }}>
            {FORMATS.map(format => (
              <ToggleGroupItem key={format} value={format}>
                {FORMAT_LABELS[format]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
          <Button className="ml-auto" onClick={onGenerate} disabled={!countValid}>
            Generate
          </Button>
        </ToolOptions>
        {/* Changes while typing, so read out politely (the recipe's rule over §8's `alert`). */}
        {!countValid && (
          <ToolMessage id="lorem-ipsum-count-error" tone="error" role="status">
            {countMessage(fields.unit)}
          </ToolMessage>
        )}
      </div>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPane
        label="Result"
        htmlFor="lorem-ipsum-result"
        actions={<CopyButton value={text} onCopied={onCopied} outcome={copiedNow} />}>
        <ResultField text={text} format={'result' in shown ? shown.settings.format : fields.format} />
        {'failed' in shown ? (
          <ToolMessage tone="error">{RANDOM_FAILED}</ToolMessage>
        ) : (
          <p role="status" className="m-0 text-sm text-muted-foreground" data-status>
            {line}
          </p>
        )}
        {/* Said within the line above, not read out again here. */}
        {copiedNow?.ok === false && (
          <ToolMessage role={undefined} data-auto-copy="refused">
            {AUTO_COPY_REFUSED}
          </ToolMessage>
        )}
      </ToolPane>

      <p className="m-0 text-sm text-muted-foreground" data-hint>
        {keptSentence(status)}
      </p>
    </div>
  );
};

export default LoremIpsumTool;
