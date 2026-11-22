/**
 * The Hex and Text tool's page (docs/tools/specs/hex-ascii.md §8): the direction, the encoding and the Text to hex
 * options in one row, the input and the result side by side, the byte count under the hex side, an error under the input
 * and notes under the result. All logic is in @workspace/tool-logic-hex-ascii. The result follows every edit up to
 * LIVE_INPUT characters and comes SETTLE_MS after the last edit above that; above 1 MB of text or 5 MB of hex the tool
 * refuses (§12). It records into the tool history through its host: an edit snapshot (`change`) and a commit when the
 * result is taken — Copy or Swap; an entry the host asks to open comes back as the input and the options. The page frame
 * (title, summary, the history line) is the host's.
 */
import {
  BYTES_PER_LINE,
  ENCODINGS,
  FORMATS,
  entryLabel,
  excerpt,
  isBytesPerLine,
  isEncoding,
  isFormat,
  isMode,
} from './entries';
import { hexAsciiHistory } from './history';
import {
  BOM_NOTE,
  HEX_TOO_LARGE,
  LIVE_INPUT,
  MAX_HEX_INPUT,
  MAX_TEXT_INPUT,
  SETTLE_MS,
  SURROGATES_NOTE,
  TEXT_TOO_LARGE,
  bytesLabel,
  bytesToText,
  controlsNote,
  formatBytes,
  invalidNote,
  parseHex,
  showControls,
  textToBytes,
} from '@workspace/tool-logic-hex-ascii';
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
import type { BytesPerLine, HexAsciiPayload, Mode } from './history';
import type { HexError, OutputFormat, TextEncodingId } from '@workspace/tool-logic-hex-ascii';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

interface Options {
  encoding: TextEncodingId;
  format: OutputFormat;
  uppercase: boolean;
  bytesPerLine: BytesPerLine;
}

interface Outcome {
  /** The real result: what Copy and Swap take. */
  output: string;
  /** What the result field shows: control characters as symbols (§5). */
  shown: string;
  /** Under the input. */
  error: string | null;
  /** Under the hex side; null when there are no bytes to count (an error, a refusal). */
  byteCount: number | null;
  /** Under the result, one line each. */
  notes: string[];
  /** For the history; null when there is nothing to record. */
  payload: Omit<HexAsciiPayload, 'action'> | null;
}

const EMPTY: Outcome = { output: '', shown: '', error: null, byteCount: 0, notes: [], payload: null };

const placed = (e: HexError): string => `Line ${e.line}, column ${e.column}: ${e.message}`;
const limitOf = (mode: Mode): number => (mode === 'to-hex' ? MAX_TEXT_INPUT : MAX_HEX_INPUT);

const work = (input: string, mode: Mode, options: Options): Outcome => {
  if (input.length > limitOf(mode))
    return { ...EMPTY, byteCount: null, error: mode === 'to-hex' ? TEXT_TOO_LARGE : HEX_TOO_LARGE };
  const base = { mode, ...options };
  const failed = (e: HexError): Outcome => ({
    ...EMPTY,
    byteCount: null,
    error: placed(e),
    payload: { ...base, outcome: 'error', error: { message: e.message, line: e.line, column: e.column } },
  });
  const recorded = input === '' ? null : base;
  if (mode === 'to-hex') {
    const r = textToBytes(input, options.encoding);
    if (!r.ok) return failed(r.error);
    const output = formatBytes(r.bytes, options);
    return {
      output,
      shown: output,
      error: null,
      byteCount: r.bytes.length,
      notes: r.replacedSurrogates ? [SURROGATES_NOTE] : [],
      payload: recorded && { ...recorded, outcome: 'ok', byteCount: r.bytes.length },
    };
  }
  const parsed = parseHex(input);
  if (!parsed.ok) return failed(parsed.error);
  const t = bytesToText(parsed.bytes, options.encoding);
  const notes = [
    t.firstInvalidByte === null ? '' : invalidNote(options.encoding, t.firstInvalidByte),
    t.bom ? BOM_NOTE : '',
    t.controlCount > 0 ? controlsNote(t.controlCount, t.c1Count) : '',
  ].filter(Boolean);
  return {
    output: t.text,
    shown: showControls(t.text),
    error: null,
    byteCount: parsed.bytes.length,
    notes,
    payload: recorded && {
      ...recorded,
      outcome: 'ok',
      byteCount: parsed.bytes.length,
      ...(t.firstInvalidByte === null ? {} : { firstInvalidByte: t.firstInvalidByte }),
    },
  };
};

const plain = (value: string): Blob => new Blob([value], { type: 'text/plain' });

const draftOf = (input: string, outcome: Outcome, action?: 'copy' | 'swap'): HistoryDraft | null => {
  if (input === '' || !outcome.payload) return null;
  const payload: HexAsciiPayload = { ...outcome.payload, ...(action ? { action } : {}) };
  return {
    kind: payload.mode,
    payload,
    label: entryLabel(payload, input.length),
    text: excerpt(input, outcome.output),
    blobs: outcome.output === '' ? { input: plain(input) } : { input: plain(input), output: plain(outcome.output) },
  };
};

/** The input the result is computed from: the live one when small, the one SETTLE_MS after the last edit when large. */
const useSettled = (input: string, limit: number): string => {
  const now = input.length <= LIVE_INPUT || input.length > limit;
  const [settled, setSettled] = useState(input);
  useEffect(() => {
    if (now) {
      setSettled(input);
      return;
    }
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, now]);
  // A refused input needs no wait: the refusal is said at once.
  return now ? input : settled;
};

const HexAsciiTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page was recognised as hex of text (detectHex): it is there to be read.
  const [mode, setMode] = useState<Mode>(initial ? 'to-text' : 'to-hex');
  const [encoding, setEncoding] = useState<TextEncodingId>('utf-8');
  const [format, setFormat] = useState<OutputFormat>('plain');
  const [uppercase, setUppercase] = useState(false);
  const [bytesPerLine, setBytesPerLine] = useState<BytesPerLine>(0);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'hex-ascii', hexAsciiHistory);

  const source = useSettled(input, limitOf(mode));
  const outcome = useMemo(
    () => work(source, mode, { encoding, format, uppercase, bytesPerLine }),
    [source, mode, encoding, format, uppercase, bytesPerLine],
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

  const swappable = outcome.output !== '' && !(mode === 'to-hex' && format === 'dump');
  const swap = (): void => {
    take('swap');
    edit(() => {
      setInput(outcome.output);
      setMode(mode === 'to-hex' ? 'to-text' : 'to-hex');
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
    const p = (opened.payload ?? {}) as Partial<HexAsciiPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      setMode(isMode(p.mode) ? p.mode : opened.entry.kind === 'to-text' ? 'to-text' : 'to-hex');
      setEncoding(isEncoding(p.encoding) ? p.encoding : 'utf-8');
      setFormat(isFormat(p.format) ? p.format : 'plain');
      setUppercase(p.uppercase === true);
      setBytesPerLine(isBytesPerLine(p.bytesPerLine) ? p.bytesPerLine : 0);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const toHex = mode === 'to-hex';
  const count = (
    <ToolMessage role="status" data-part="bytes">
      {outcome.byteCount === null ? ' ' : bytesLabel(outcome.byteCount)}
    </ToolMessage>
  );
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
          <ToggleGroupItem value="to-hex">Text to hex</ToggleGroupItem>
          <ToggleGroupItem value="to-text">Hex to text</ToggleGroupItem>
        </ToggleGroup>
        <Label htmlFor="hex-ascii-encoding" className="ml-2 text-muted-foreground">
          Encoding
        </Label>
        <Select
          value={encoding}
          onValueChange={value => {
            if (isEncoding(value)) edit(() => setEncoding(value));
          }}>
          <SelectTrigger id="hex-ascii-encoding" className="min-w-32">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {ENCODINGS.map(e => (
              <SelectItem key={e.value} value={e.value}>
                {e.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {toHex && (
          <>
            <Label htmlFor="hex-ascii-format" className="ml-2 text-muted-foreground">
              Format
            </Label>
            <Select
              value={format}
              onValueChange={value => {
                if (isFormat(value)) edit(() => setFormat(value));
              }}>
              <SelectTrigger id="hex-ascii-format" className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMATS.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="ml-2 flex items-center gap-2">
              <Checkbox
                id="hex-ascii-uppercase"
                checked={uppercase}
                onCheckedChange={checked => edit(() => setUppercase(checked === true))}
              />
              <Label htmlFor="hex-ascii-uppercase" className="font-normal">
                Uppercase
              </Label>
            </div>
            <Label htmlFor="hex-ascii-per-line" className="ml-2 text-muted-foreground">
              Bytes per line
            </Label>
            <Select
              value={String(bytesPerLine)}
              disabled={format === 'dump'}
              onValueChange={value => {
                const next = Number(value);
                if (isBytesPerLine(next)) edit(() => setBytesPerLine(next));
              }}>
              <SelectTrigger id="hex-ascii-per-line" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {BYTES_PER_LINE.map(b => (
                  <SelectItem key={b.value} value={String(b.value)}>
                    {b.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        <Button variant="outline" className="ml-auto" disabled={!swappable} onClick={swap}>
          Swap
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label={toHex ? 'Text' : 'Hex'} htmlFor="hex-ascii-input">
          <Textarea
            id="hex-ascii-input"
            className={code}
            spellCheck={false}
            placeholder={toHex ? 'Text to turn into bytes' : '48 65 6c 6c 6f, 0x48 or \\x48'}
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
          {!toHex && count}
        </ToolPane>
        <ToolPane
          label={toHex ? 'Hex' : 'Text'}
          htmlFor="hex-ascii-output"
          actions={<CopyButton value={outcome.output} onCopied={() => take('copy')} />}>
          {/* The dump's columns line up only unwrapped: it scrolls sideways instead. */}
          <ResultField
            id="hex-ascii-output"
            className={code}
            spellCheck={false}
            wrap={toHex && format === 'dump' ? 'off' : undefined}
            value={outcome.shown}
          />
          {toHex && count}
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

export default HexAsciiTool;
