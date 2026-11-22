/**
 * The URL tool's page (docs/tools/specs/url.md §8): Encode and Decode — input and result side by side, recomputed as
 * you type; Parse — the URL, the normalized URL, its parts and its query parameters. The host wraps it in the kit's
 * ToolPage (title, summary, the history line); this is the body. Logic: @workspace/tool-logic-url. History: through the
 * host — `recorder.change` when a person edits the text, the mode or its option, `recorder.commit` on Swap and when the
 * result is copied; `useRestore` opens an entry the host asks for. Nothing typed here becomes a link or is fetched.
 */
import { urlHistory } from './history';
import { carriesCredentials, excerpt, isMode, isStyle, urlLabel } from './record';
import {
  decodeUrl,
  detectedMode,
  encodeUrl,
  isBlankUrl,
  LIVE_INPUT,
  MAX_INPUT,
  MAX_PARAM_ROWS,
  MAX_PARSE_INPUT,
  PART_LABELS,
  paramsToJson,
  parseUrl,
} from '@workspace/tool-logic-url';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { UrlMode, UrlStyle } from './history';
import type { UrlPayload } from './record';
import type { ParseResult, QueryParam } from '@workspace/tool-logic-url';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const STYLES: Array<{ value: UrlStyle; label: string }> = [
  { value: 'component', label: 'Component' },
  { value: 'form', label: 'Form (+ for spaces)' },
  { value: 'whole', label: 'Whole URL' },
];

const PLACEHOLDER: Record<UrlMode, string> = {
  encode: 'Text to encode',
  decode: 'Text with %XX to decode',
  parse: 'https://example.com/path?query=value#fragment',
};

/** How long an icon copy button shows its check (§8). */
const ICON_RESET_MS = 1500;
/** Encode and Decode above LIVE_INPUT: recomputed this long after the last change (§12). */
const SETTLE_MS = 300;

const text = (value: string): Blob => new Blob([value], { type: 'text/plain' });
const count = (n: number): string => n.toLocaleString('en-US');

interface Coded {
  result: string;
  notes: string[];
  tooLarge: boolean;
}

const TOO_LARGE: Coded = { result: '', notes: [], tooLarge: true };

const code = (source: string, mode: 'encode' | 'decode', style: UrlStyle, plusAsSpace: boolean): Coded => {
  if (source.length > MAX_INPUT) return TOO_LARGE;
  if (mode === 'encode') return { result: encodeUrl(source, style), notes: [], tooLarge: false };
  const decoded = decodeUrl(source, { plusAsSpace });
  const notes: string[] = [];
  if (decoded.malformed > 0)
    notes.push(
      decoded.malformed === 1
        ? '1 malformed % sequence left as is.'
        : `${count(decoded.malformed)} malformed % sequences left as is.`,
    );
  if (decoded.invalidUtf8) notes.push('Invalid UTF-8 replaced with U+FFFD.');
  return { result: decoded.text, notes, tooLarge: false };
};

type Parsed = { state: 'blank' } | { state: 'too-long' } | ({ state: 'parsed' } & ParseResult);

const parse = (input: string): Parsed => {
  if (input.length > MAX_PARSE_INPUT) return { state: 'too-long' };
  if (isBlankUrl(input)) return { state: 'blank' };
  return { state: 'parsed', ...parseUrl(input) };
};

const Muted = ({ children }: { children: string }): ReactElement => (
  <span className="font-sans text-sm text-muted-foreground">{children}</span>
);

const ParamsTable = ({ params }: { params: readonly QueryParam[] }): ReactElement => (
  <Table aria-label="Query parameters">
    <TableHeader>
      <TableRow>
        <TableHead className="w-10">#</TableHead>
        <TableHead>Name</TableHead>
        <TableHead>Value</TableHead>
      </TableRow>
    </TableHeader>
    <TableBody>
      {params.slice(0, MAX_PARAM_ROWS).map((p, i) => (
        <TableRow key={i}>
          <TableCell className="text-muted-foreground tabular-nums">{i + 1}</TableCell>
          <TableCell className="font-mono text-code break-all">
            {p.name === '' ? <Muted>empty</Muted> : p.name}
          </TableCell>
          <TableCell>
            <div className="flex items-center justify-between gap-2">
              <span className="min-w-0 font-mono text-code break-all">
                {p.value === '' ? <Muted>empty</Muted> : p.value}
              </span>
              {p.value !== '' && (
                <CopyButton
                  icon
                  value={p.value}
                  label={`Copy value of ${p.name === '' ? 'empty' : p.name}`}
                  resetAfterMs={ICON_RESET_MS}
                />
              )}
            </div>
          </TableCell>
        </TableRow>
      ))}
    </TableBody>
  </Table>
);

const UrlTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  // Text handed over from the start page opens in the mode that recognised it (§7: a URL — Parse, %XX — Decode).
  const [mode, setMode] = useState<UrlMode>(() => (initial ? (detectedMode(initial) ?? 'encode') : 'encode'));
  const [style, setStyle] = useState<UrlStyle>('component');
  const [plusAsSpace, setPlusAsSpace] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'url', urlHistory);

  // Above LIVE_INPUT, Encode and Decode wait for the typing to stop.
  const live = mode === 'parse' || input.length <= LIVE_INPUT;
  const [settled, setSettled] = useState(input);
  useEffect(() => {
    if (live) {
      setSettled(input);
      return;
    }
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, live]);
  const source = live ? input : settled;
  // The refusal is at once: only a computation waits.
  const tooLarge = mode !== 'parse' && input.length > MAX_INPUT;

  const coded = useMemo(
    () => (mode === 'parse' ? null : tooLarge ? TOO_LARGE : code(source, mode, style, plusAsSpace)),
    [source, mode, style, plusAsSpace, tooLarge],
  );
  const parsed = useMemo(() => (mode === 'parse' ? parse(input) : null), [mode, input]);
  const ok = parsed?.state === 'parsed' && parsed.ok ? parsed : null;
  const result = coded ? coded.result : (ok?.href ?? '');
  const json = useMemo(() => (ok && ok.params.length > 0 ? paramsToJson(ok.params) : ''), [ok]);

  // What the history keeps of the current state: the text, the mode with its option, the result.
  const draft = useMemo((): HistoryDraft | null => {
    if (mode === 'parse' ? !ok : source === '' || tooLarge) return null;
    const payload: UrlPayload = { mode, style, plusAsSpace };
    const hostname = ok?.parts.find(p => p.key === 'hostname')?.value;
    return {
      kind: carriesCredentials(source, result) ? 'credentials' : mode,
      payload,
      label: urlLabel(payload, source, hostname),
      text: excerpt(source),
      blobs: result === '' ? { input: text(source) } : { input: text(source), output: text(result) },
    };
  }, [mode, style, plusAsSpace, source, result, ok, tooLarge]);

  // A snapshot only after a person's edit (handed text counts as one), never after an entry is opened.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (edited.current && draft) recorder.change(draft);
  }, [recorder, draft]);
  const commit = (): void => {
    if (draft) void recorder.commit(draft);
  };

  const edit = (next: { input?: string; mode?: UrlMode; style?: UrlStyle; plusAsSpace?: boolean }): void => {
    edited.current = true;
    setRestored(null);
    if (next.input !== undefined) setInput(next.input);
    if (next.mode !== undefined) setMode(next.mode);
    if (next.style !== undefined) setStyle(next.style);
    if (next.plusAsSpace !== undefined) setPlusAsSpace(next.plusAsSpace);
  };

  // Swap: the result becomes the input, Encode ↔ Decode; the options stay as they are (§4).
  const swap = (): void => {
    commit();
    edit({ input: result, mode: mode === 'encode' ? 'decode' : 'encode' });
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
    const p = (opened.payload ?? {}) as Partial<UrlPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(source => {
      edited.current = false;
      setInput(source);
      setSettled(source);
      setMode(isMode(p.mode) ? p.mode : 'encode');
      setStyle(isStyle(p.style) ? p.style : 'component');
      setPlusAsSpace(p.plusAsSpace === true);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const field = (className: string, rows?: number): ReactElement => (
    <Textarea
      id="url-input"
      className={className}
      rows={rows}
      spellCheck={false}
      placeholder={PLACEHOLDER[mode]}
      value={input}
      onChange={e => edit({ input: e.target.value })}
    />
  );

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Mode"
          value={mode}
          onValueChange={value => {
            if (isMode(value)) edit({ mode: value });
          }}>
          <ToggleGroupItem value="encode">Encode</ToggleGroupItem>
          <ToggleGroupItem value="decode">Decode</ToggleGroupItem>
          <ToggleGroupItem value="parse">Parse</ToggleGroupItem>
        </ToggleGroup>
        {mode === 'encode' && (
          <>
            <Label htmlFor="url-style" className="ml-2 text-muted-foreground">
              Encode as
            </Label>
            <Select
              value={style}
              onValueChange={value => {
                if (isStyle(value)) edit({ style: value });
              }}>
              <SelectTrigger id="url-style" className="min-w-44">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {STYLES.map(s => (
                  <SelectItem key={s.value} value={s.value}>
                    {s.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {mode === 'decode' && (
          <div className="ml-2 flex items-center gap-2">
            <Checkbox
              id="url-plus"
              checked={plusAsSpace}
              onCheckedChange={checked => edit({ plusAsSpace: checked === true })}
            />
            <Label htmlFor="url-plus" className="font-normal">
              Decode + as space
            </Label>
          </div>
        )}
        {mode !== 'parse' && (
          <Button variant="outline" className="ml-auto" disabled={result === ''} onClick={swap}>
            Swap
          </Button>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      {coded && (
        <ToolPanes>
          <ToolPane label="Input" htmlFor="url-input">
            {field('h-90 resize-y font-mono text-code field-sizing-fixed')}
            <ToolMessage tone={coded.tooLarge ? 'error' : 'note'}>
              {coded.tooLarge ? 'Input is larger than 5 MB. This tool works with up to 5 MB.' : null}
            </ToolMessage>
          </ToolPane>
          <ToolPane label="Result" htmlFor="url-output" actions={<CopyButton value={result} onCopied={commit} />}>
            <ResultField
              id="url-output"
              className="h-90 resize-y font-mono text-code field-sizing-fixed"
              spellCheck={false}
              value={result}
            />
            {coded.notes.length === 0 ? (
              <ToolMessage />
            ) : (
              coded.notes.map(note => <ToolMessage key={note}>{note}</ToolMessage>)
            )}
          </ToolPane>
        </ToolPanes>
      )}

      {parsed && (
        <>
          <ToolPane label="URL" htmlFor="url-input">
            {field('resize-y font-mono text-code field-sizing-fixed', 4)}
            {/* Live while typing: an error is read out politely (status), not as an alert on every keystroke. */}
            {parsed.state === 'too-long' ? (
              <ToolMessage tone="error" role="status">
                URL is longer than 1 MB. Parse works with up to 1 MB.
              </ToolMessage>
            ) : parsed.state === 'parsed' && !parsed.ok ? (
              <ToolMessage tone="error" role="status">
                {parsed.message}
              </ToolMessage>
            ) : (
              <ToolMessage>
                {ok?.removedWhitespace ? 'Tabs and line breaks inside the URL were removed.' : null}
              </ToolMessage>
            )}
          </ToolPane>
          {ok && (
            <>
              <ResultRows>
                <ResultRow
                  label="Normalized URL"
                  value={ok.href}
                  copy={{ icon: false, label: 'Copy', onCopied: commit }}
                />
              </ResultRows>
              <ResultRows aria-label="Parts">
                {ok.parts.map(part => {
                  const label = PART_LABELS[part.key];
                  return (
                    <ResultRow
                      key={part.key}
                      label={label}
                      value={part.value}
                      empty="empty"
                      copyLabel={`Copy ${label}`}
                      copy={{ resetAfterMs: ICON_RESET_MS }}
                      extra={
                        part.isDefault ? (
                          <Muted>default</Muted>
                        ) : part.decoded !== undefined ? (
                          <span className="basis-full text-sm break-all text-muted-foreground">
                            Decoded: <span className="font-mono text-code">{part.decoded}</span>
                          </span>
                        ) : undefined
                      }
                    />
                  );
                })}
              </ResultRows>
              <ToolPane
                label={`Query parameters (${count(ok.params.length)})`}
                actions={
                  json === '' ? undefined : (
                    <CopyButton key={ok.href} value={json} label="Copy JSON" onCopied={commit} />
                  )
                }>
                {ok.params.length === 0 ? (
                  <p className="m-0 text-sm text-muted-foreground">No query parameters.</p>
                ) : (
                  <ParamsTable params={ok.params} />
                )}
                {ok.params.length > MAX_PARAM_ROWS && (
                  <ToolMessage>
                    Showing the first {count(MAX_PARAM_ROWS)} of {count(ok.params.length)} parameters. Copy JSON copies
                    all.
                  </ToolMessage>
                )}
              </ToolPane>
            </>
          )}
        </>
      )}
    </div>
  );
};

export default UrlTool;
