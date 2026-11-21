/**
 * The Base64 tool's page (docs/tools/specs/base64.md §8): the direction and the Encode options, input and result side
 * by side, an error under the input and notes under the result. All logic is in @workspace/tool-logic-base64. The result
 * follows every edit up to LIVE_INPUT characters, 300 ms after the last edit up to MAX_INPUT, and above that the tool
 * refuses (§12). It records into the tool history through its host: an edit snapshot of the input, the options and the
 * result (`change`), and a commit when the result is taken — Copy or Swap; an entry the host asks to open comes back as
 * the input and the options. The page frame (title, summary, the history line) is the host's.
 */
import { entryLabel, excerpt, isAlphabet, isLineLength, isMode } from './entries';
import { base64History } from './history';
import { LIVE_INPUT, MAX_INPUT, SETTLE_MS, decodeText, defaultPadding, encodeText } from '@workspace/tool-logic-base64';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Base64Payload, LineLength, Mode } from './history';
import type { Base64Alphabet, Base64Options } from '@workspace/tool-logic-base64';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const LINE_LENGTHS: Array<{ value: LineLength; label: string }> = [
  { value: 0, label: 'No wrapping' },
  { value: 64, label: '64' },
  { value: 76, label: '76' },
];

const TOO_LARGE = 'Input is larger than 5 MB. This tool works with up to 5 MB.';

interface Outcome {
  output: string;
  /** Under the input. */
  error: string | null;
  /** Under the result, one line each. */
  notes: string[];
  /** The result is text Swap can take back (not hex, not an error). */
  swappable: boolean;
  /** For the history; null when there is nothing to record. */
  payload: Omit<Base64Payload, 'action'> | null;
}

const EMPTY: Outcome = { output: '', error: null, notes: [], swappable: false, payload: null };

const bytesNote = (n: number): string =>
  `Not UTF-8 text: showing ${n.toLocaleString('en-US')} ${n === 1 ? 'byte' : 'bytes'} as hex.`;

const work = (input: string, mode: Mode, options: Base64Options): Outcome => {
  if (input.length > MAX_INPUT) return { ...EMPTY, error: TOO_LARGE };
  if (mode === 'encode') {
    const output = encodeText(input, options);
    return {
      output,
      error: null,
      notes: [],
      swappable: output !== '',
      payload: { mode, ...options, outcome: 'text' },
    };
  }
  const base = { mode, ...options };
  const result = decodeText(input);
  if (!result.ok) {
    const { message, line, column } = result.error;
    const placed = line !== undefined && column !== undefined;
    return {
      ...EMPTY,
      error: placed ? `Line ${line}, column ${column}: ${message}` : message,
      payload: { ...base, outcome: 'error', error: placed ? { message, line, column } : { message } },
    };
  }
  if (result.kind === 'hex')
    return {
      output: result.text,
      error: null,
      notes: [bytesNote(result.byteCount)],
      swappable: false,
      payload: { ...base, outcome: 'hex', byteCount: result.byteCount },
    };
  return {
    output: result.text,
    error: null,
    notes: result.bom ? ['Starts with a byte order mark (U+FEFF).'] : [],
    swappable: result.text !== '',
    payload: { ...base, outcome: 'text' },
  };
};

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

const draftOf = (input: string, outcome: Outcome, action?: 'copy' | 'swap'): HistoryDraft | null => {
  if (input === '' || !outcome.payload) return null;
  const payload: Base64Payload = { ...outcome.payload, ...(action ? { action } : {}) };
  return {
    kind: payload.mode,
    payload,
    label: entryLabel(payload, input.length),
    text: excerpt(input, outcome.output),
    blobs: outcome.output === '' ? { input: plain(input) } : { input: plain(input), output: plain(outcome.output) },
  };
};

/** The input the result is computed from: the live one when small, the one 300 ms after the last edit when large. */
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

const Base64Tool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page was recognised as Base64 (detectBase64): it is there to be decoded.
  const [mode, setMode] = useState<Mode>(initial ? 'decode' : 'encode');
  const [alphabet, setAlphabet] = useState<Base64Alphabet>('standard');
  const [padding, setPadding] = useState(true);
  const [lineLength, setLineLength] = useState<LineLength>(0);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'base64', base64History);

  const source = useSettled(input);
  const outcome = useMemo(
    () => work(source, mode, { alphabet, padding, lineLength }),
    [source, mode, alphabet, padding, lineLength],
  );

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
    const p = (opened.payload ?? {}) as Partial<Base64Payload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      setMode(isMode(p.mode) ? p.mode : opened.entry.kind === 'decode' ? 'decode' : 'encode');
      setAlphabet(isAlphabet(p.alphabet) ? p.alphabet : 'standard');
      setPadding(
        typeof p.padding === 'boolean' ? p.padding : defaultPadding(isAlphabet(p.alphabet) ? p.alphabet : 'standard'),
      );
      setLineLength(isLineLength(p.lineLength) ? p.lineLength : 0);
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
        {mode === 'encode' ? (
          <>
            <Label htmlFor="base64-alphabet" className="ml-2 text-muted-foreground">
              Alphabet
            </Label>
            <Select
              value={alphabet}
              onValueChange={value => {
                if (!isAlphabet(value)) return;
                edit(() => {
                  setAlphabet(value);
                  setPadding(defaultPadding(value));
                });
              }}>
              <SelectTrigger id="base64-alphabet" className="min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="standard">Standard</SelectItem>
                <SelectItem value="url">URL-safe</SelectItem>
              </SelectContent>
            </Select>
            <div className="ml-2 flex items-center gap-2">
              <Checkbox
                id="base64-padding"
                checked={padding}
                onCheckedChange={checked => edit(() => setPadding(checked === true))}
              />
              <Label htmlFor="base64-padding" className="font-normal">
                Padding
              </Label>
            </div>
            <Label htmlFor="base64-line-length" className="ml-2 text-muted-foreground">
              Line length
            </Label>
            <Select
              value={String(lineLength)}
              onValueChange={value => {
                const next = Number(value);
                if (isLineLength(next)) edit(() => setLineLength(next));
              }}>
              <SelectTrigger id="base64-line-length" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LINE_LENGTHS.map(l => (
                  <SelectItem key={l.value} value={String(l.value)}>
                    {l.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        ) : (
          <p className="m-0 ml-2 text-sm text-muted-foreground">
            Accepts standard and URL-safe alphabets, with or without padding.
          </p>
        )}
        <Button variant="outline" className="ml-auto" disabled={!outcome.swappable} onClick={swap}>
          Swap
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor="base64-input">
          <Textarea
            id="base64-input"
            className={code}
            spellCheck={false}
            placeholder={mode === 'encode' ? 'Text to encode' : 'Base64 to decode'}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
          />
          {/* Changes while typing: colored as an error, read out politely (status), as the JSON tool does. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {outcome.error ?? ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Result"
          htmlFor="base64-output"
          actions={<CopyButton value={outcome.output} onCopied={() => take('copy')} />}>
          <Textarea id="base64-output" className={code} spellCheck={false} readOnly value={outcome.output} />
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

export default Base64Tool;
