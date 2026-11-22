/**
 * The HTML Entities tool's page (docs/tools/specs/html-entities.md §8): the direction and the Encode options, input and
 * result side by side, the size refusal under the input and notes under the result. All logic is in
 * @workspace/tool-logic-html-entities; the table of names (about 23 KB) is loaded on first need — an `&` before a
 * letter in the input — never with the page. The result follows every edit up to LIVE_INPUT characters,
 * SETTLE_MS after the last edit up to MAX_INPUT, and above that the tool refuses (§12). It records into the tool history
 * through its host: an edit snapshot (`change`) and a commit when the result is taken — Copy or Swap; an entry the host
 * asks to open comes back as the input and the options. The page frame (title, summary, the history line) is the host's.
 */
import {
  ENCODED_AGAIN,
  FORMAT_LABEL,
  SCOPE_LABEL,
  TOO_LARGE,
  entryLabel,
  excerpt,
  isFormat,
  isMode,
  isScope,
  keptC1Note,
  unknownNote,
} from './entries';
import { htmlEntitiesHistory } from './history';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  containsReferences,
  decodeHtml,
  encodeHtml,
  loadReferenceTable,
  mayContainNames,
} from '@workspace/tool-logic-html-entities';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HtmlEntitiesPayload, Mode } from './history';
import type { EncodeScope, NumericFormat, ReferenceTable } from '@workspace/tool-logic-html-entities';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

interface Outcome {
  output: string;
  /** Under the input. */
  error: string | null;
  /** Under the result, one line each. */
  notes: string[];
  /** For the history; null when there is nothing to record (empty, refused or still waiting for the table). */
  payload: Omit<HtmlEntitiesPayload, 'action'> | null;
}

const EMPTY: Outcome = { output: '', error: null, notes: [], payload: null };
/** Numbers decode by rule; until the table is there, no name is known. */
const NO_NAMES: ReferenceTable = new Map();

/** Does this input need the table of names — is there an `&` before a letter? Numbers decode without it. */
const needsTable = (input: string): boolean => input.length <= MAX_INPUT && mayContainNames(input);

const work = (
  input: string,
  mode: Mode,
  scope: EncodeScope,
  format: NumericFormat,
  table: ReferenceTable | null,
): Outcome => {
  if (input.length > MAX_INPUT) return { ...EMPTY, error: TOO_LARGE };
  if (input === '') return EMPTY;
  const payload = { mode, scope, format };
  if (mode === 'encode') {
    const { text, keptC1 } = encodeHtml(input, { scope, format });
    const notes: string[] = [];
    if (containsReferences(input, table ?? NO_NAMES)) notes.push(ENCODED_AGAIN);
    if (keptC1 > 0) notes.push(keptC1Note(keptC1));
    return { output: text, error: null, notes, payload };
  }
  if (table === null && needsTable(input)) return EMPTY; // the table arrives within a frame or two
  const { text, unknown } = decodeHtml(input, table ?? NO_NAMES);
  return { output: text, error: null, notes: unknown.length > 0 ? [unknownNote(unknown)] : [], payload };
};

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

const draftOf = (input: string, outcome: Outcome, action?: 'copy' | 'swap'): HistoryDraft | null => {
  if (input === '' || !outcome.payload) return null;
  const payload: HtmlEntitiesPayload = { ...outcome.payload, ...(action ? { action } : {}) };
  return {
    kind: payload.mode,
    payload,
    label: entryLabel(payload, input.length),
    text: excerpt(input, outcome.output),
    blobs: { input: plain(input), output: plain(outcome.output) },
  };
};

/** The input the result is computed from: the live one when small, the one SETTLE_MS after the last edit when large. */
const useSettled = (input: string): string => {
  const [settled, setSettled] = useState(input);
  useEffect(() => {
    if (input.length <= LIVE_INPUT || input.length > MAX_INPUT) {
      setSettled(input);
      return;
    }
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input]);
  // A refused input needs no wait: the refusal is said at once.
  return input.length <= LIVE_INPUT || input.length > MAX_INPUT ? input : settled;
};

/** The table of names, loaded the first time `needed` is true (a chunk of its own); null until then. */
const useReferenceTable = (needed: boolean): ReferenceTable | null => {
  const [table, setTable] = useState<ReferenceTable | null>(null);
  useEffect(() => {
    if (!needed || table !== null) return;
    let live = true;
    void loadReferenceTable().then(loaded => {
      if (live) setTable(loaded);
    });
    return () => {
      live = false;
    };
  }, [needed, table]);
  return table;
};

const HtmlEntitiesTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page was recognised as text with references (detect): it is there to be decoded.
  const [mode, setMode] = useState<Mode>(initial ? 'decode' : 'encode');
  const [scope, setScope] = useState<EncodeScope>('special');
  const [format, setFormat] = useState<NumericFormat>('decimal');
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'html-entities', htmlEntitiesHistory);

  const source = useSettled(input);
  const table = useReferenceTable(needsTable(source));
  const outcome = useMemo(() => work(source, mode, scope, format, table), [source, mode, scope, format, table]);

  // A person's edit (or text handed over from the start page) is recorded once its result is there; opening an entry
  // from History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current) return;
    const draft = draftOf(source, outcome);
    if (draft) recorder.change(draft);
  }, [recorder, source, outcome]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  const take = (action: 'copy' | 'swap'): void => {
    const draft = draftOf(source, outcome, action);
    if (draft) void recorder.commit(draft);
  };

  const swap = (): void => {
    take('swap');
    edit(() => {
      setInput(outcome.output);
      setMode(mode === 'encode' ? 'decode' : 'encode');
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
    const p = (opened.payload ?? {}) as Partial<HtmlEntitiesPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      setMode(isMode(p.mode) ? p.mode : opened.entry.kind === 'decode' ? 'decode' : 'encode');
      setScope(isScope(p.scope) ? p.scope : 'special');
      setFormat(isFormat(p.format) ? p.format : 'decimal');
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={mode}
          onValueChange={value => {
            if (isMode(value) && value !== mode) edit(() => setMode(value));
          }}>
          <ToggleGroupItem value="encode">Encode</ToggleGroupItem>
          <ToggleGroupItem value="decode">Decode</ToggleGroupItem>
        </ToggleGroup>
        {mode === 'encode' && (
          <>
            <Label htmlFor="html-entities-scope" className="ml-2 text-muted-foreground">
              Encode
            </Label>
            <Select
              value={scope}
              onValueChange={value => {
                if (isScope(value)) edit(() => setScope(value));
              }}>
              <SelectTrigger id="html-entities-scope" className="min-w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="special">{SCOPE_LABEL.special}</SelectItem>
                <SelectItem value="nonAscii">{SCOPE_LABEL.nonAscii}</SelectItem>
              </SelectContent>
            </Select>
            <Label htmlFor="html-entities-format" className="ml-2 text-muted-foreground">
              Numbers as
            </Label>
            <Select
              value={format}
              disabled={scope === 'special'}
              onValueChange={value => {
                if (isFormat(value)) edit(() => setFormat(value));
              }}>
              <SelectTrigger id="html-entities-format" className="min-w-24">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="decimal">{FORMAT_LABEL.decimal}</SelectItem>
                <SelectItem value="hex">{FORMAT_LABEL.hex}</SelectItem>
              </SelectContent>
            </Select>
          </>
        )}
        <Button variant="outline" className="ml-auto" disabled={outcome.output === ''} onClick={swap}>
          Swap
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor="html-entities-input">
          <Textarea
            id="html-entities-input"
            className={code}
            spellCheck={false}
            placeholder={mode === 'encode' ? 'Text to escape' : 'Text with &amp; and other references'}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
          />
          {/* Changes while typing: colored as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {outcome.error ?? ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor="html-entities-output"
          actions={<CopyButton value={outcome.output} onCopied={() => take('copy')} />}>
          <ResultField id="html-entities-output" className={code} spellCheck={false} value={outcome.output} />
          {outcome.notes.length === 0 ? (
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

export default HtmlEntitiesTool;
