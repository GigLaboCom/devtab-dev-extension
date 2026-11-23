/**
 * The Hash tool's page (docs/tools/specs/hash.md §8): the five digests of a text, hex, Base64 or a file, or their HMAC,
 * written as hex, HEX or Base64, and a comparison with an expected hash. Logic: @workspace/tool-logic-hash; a file is
 * hashed by workers (fileHash.ts). The host wraps it in the kit's ToolPage; this is the body.
 *
 * History (D17): every kind is a secret, so the host keeps an entry only with a master password and the history
 * unlocked — the tool records the same way either way and says under the results what is true now. An edit of a text
 * is a `change` once its digests are there; a hashed file is a `commit` (choosing it is the action) with its name, size
 * and digests, never its contents.
 *
 * Input, Output, HMAC and Key format are saved parameters (settings.ts; docs/tools/settings.md): the tool opens with
 * what the person chose last time where the host remembers it; text handed over opens in Text and an opened entry shows
 * its own options, both for the visit only. The key and the expected hash are never saved.
 */
import { excerpt, fileLabel, isInputFormat, isOutputFormat, textLabel } from './entries';
import { hashFile } from './fileHash';
import { hashHistory } from './history';
import { hashSettings } from './settings';
import {
  ALGORITHMS,
  compareExpected,
  DEBOUNCE_MS,
  decodeInput,
  formatDigest,
  formatRate,
  formatRemaining,
  formatSize,
  hashAll,
  LIVE_BYTES,
  MAX_INPUT_BYTES,
  textHints,
} from '@workspace/tool-logic-hash';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { FileDrop } from '@workspace/ui/file-drop';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { ResultRow, ResultRows } from '@workspace/ui/result-row';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CheckIcon, EyeIcon, EyeOffIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { HashFilePayload, HashOptionsPayload, HashPayload, HashTextPayload } from './entries';
import type { Algorithm, Decoded, Digests, InputFormat, OutputFormat } from '@workspace/tool-logic-hash';
import type { HistoryDraft, RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

type Mode = InputFormat | 'file';

const MODES: Array<{ value: Mode; label: string }> = [
  { value: 'text', label: 'Text' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
  { value: 'file', label: 'File' },
];
const OUTPUTS: Array<{ value: OutputFormat; label: string }> = [
  { value: 'hex', label: 'hex' },
  { value: 'HEX', label: 'HEX' },
  { value: 'base64', label: 'Base64' },
];
const KEY_FORMATS: Array<{ value: InputFormat; label: string }> = [
  { value: 'text', label: 'Text (UTF-8)' },
  { value: 'hex', label: 'Hex' },
  { value: 'base64', label: 'Base64' },
];
const PLACEHOLDER: Record<InputFormat, string> = { text: 'Text to hash', hex: '00 ff 10 …', base64: 'SGVsbG8=' };
const PANE: Record<Mode, string> = { text: 'Text', hex: 'Hex', base64: 'Base64', file: 'File' };
const HINTS = {
  'trailing-newline': 'The text ends with a line break. It is part of the hashed bytes.',
  'edge-space': 'The text starts or ends with a space. It is part of the hashed bytes.',
} as const;

/** Where the digests are. */
type Run =
  | { state: 'idle' }
  | { state: 'waiting' }
  | { state: 'hashing'; percent: number; rate?: string; left?: string }
  | { state: 'done'; digests: Partial<Digests> }
  | { state: 'cancelled' }
  | { state: 'failed'; message: string };

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';
const hexDigests = (digests: Partial<Digests>): Partial<Record<Algorithm, string>> =>
  Object.fromEntries(ALGORITHMS.filter(a => digests[a]).map(a => [a, formatDigest(digests[a]!, 'hex')]));
const fromHex = (digests: Partial<Record<Algorithm, string>> | undefined): Partial<Digests> => {
  const out: Partial<Digests> = {};
  for (const a of ALGORITHMS) {
    const decoded = typeof digests?.[a] === 'string' ? decodeInput(digests[a]!, 'hex') : undefined;
    if (decoded?.ok) out[a] = decoded.bytes;
  }
  return out;
};

/** What the history keeps of this tool now, said plainly (D17: the specification's "nothing is stored" predates it). */
const keptLine = (status: RecordingStatus): string =>
  status.gate !== 'on'
    ? 'Nothing you hash here is kept: the history is off for this tool.'
    : status.secrets === 'unlocked'
      ? 'Kept in this browser’s history, encrypted: the text (or a file’s name and size), the key and the hashes — never a file’s contents.'
      : status.secrets === 'locked'
        ? 'Nothing you hash here is kept while the history is locked.'
        : 'Nothing you hash here is kept: this tool’s history needs a master password (Settings → History).';

const HashTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const saved = useSavedSettings(host, 'hash', hashSettings, {
    // Text handed over is text to hash, whatever was saved: Text for this visit.
    opening: initial ? { inputFormat: 'text' } : undefined,
    // Back to Text: the file is let go, as on any change of Input (§11).
    onReset: () => {
      setFile(null);
      setRestoredFile(null);
    },
  });
  const { inputFormat: mode, output, hmac, keyFormat } = saved.values;
  const [text, setText] = useState(initial ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [restoredFile, setRestoredFile] = useState<HashFilePayload['file'] | null>(null);
  const [key, setKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [expected, setExpected] = useState('');
  const [run, setRun] = useState<Run>({ state: 'idle' });
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'hash', hashHistory);
  /** A person changed something since the page opened or an entry was restored: only then is anything recorded. */
  const edited = useRef(false);
  const cancel = useRef<AbortController | null>(null);
  /** Every run gets a number; the answer of an older one is dropped, whichever finishes first (§12). */
  const generation = useRef(0);

  const decoded: Decoded | null = useMemo(() => (mode === 'file' ? null : decodeInput(text, mode)), [text, mode]);
  const keyDecoded: Decoded | null = useMemo(() => (hmac ? decodeInput(key, keyFormat) : null), [hmac, key, keyFormat]);
  const keyBytes = keyDecoded?.ok ? keyDecoded.bytes : undefined;
  const keyMissing = hmac && keyDecoded?.ok === true && keyDecoded.bytes.length === 0;
  const keyBlocked = hmac && (keyDecoded?.ok !== true || keyMissing);
  const tooLarge = decoded?.ok === true && decoded.bytes.length > MAX_INPUT_BYTES;

  // Text, hex, Base64: at once up to 1 MiB, 300 ms after the last edit up to 16 MiB (§12).
  useEffect(() => {
    if (mode === 'file') return;
    const mine = ++generation.current;
    if (!decoded?.ok || keyBlocked || tooLarge) {
      setRun({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    const settle = (next: Run) => generation.current === mine && setRun(next);
    const start = () =>
      hashAll(decoded.bytes, { ...(keyBytes ? { key: keyBytes } : {}), signal: controller.signal }).then(
        digests => settle({ state: 'done', digests }),
        error => !isAbort(error) && settle({ state: 'failed', message: 'The hashes could not be computed.' }),
      );
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (decoded.bytes.length <= LIVE_BYTES) void start();
    else {
      setRun({ state: 'waiting' });
      timer = setTimeout(() => void start(), DEBOUNCE_MS);
    }
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [mode, decoded, keyBytes, keyBlocked, tooLarge]);

  // A file, of any size: hashed by workers with progress; a new key waits for the pause in typing (§12), a new file
  // does not.
  const lastFile = useRef<File | null>(null);
  useEffect(() => {
    if (mode !== 'file' || !file) return;
    const mine = ++generation.current;
    const settle = (next: Run) => generation.current === mine && setRun(next);
    if (keyBlocked) {
      setRun({ state: 'idle' });
      return;
    }
    const controller = new AbortController();
    cancel.current = controller;
    const newFile = lastFile.current !== file;
    lastFile.current = file;
    const start = () => {
      setRun({ state: 'hashing', percent: 0 });
      let shown = 0;
      const began = performance.now();
      hashFile(file, {
        ...(keyBytes ? { key: keyBytes } : {}),
        signal: controller.signal,
        // The percentage, and after a second the throughput and the time left (§8): a large file takes a while.
        onProgress: fraction => {
          const percent = Math.floor(fraction * 100);
          if (percent === shown) return;
          shown = percent;
          const seconds = (performance.now() - began) / 1000;
          const rate = seconds >= 1 && fraction > 0 ? (fraction * file.size) / seconds : 0;
          settle({
            state: 'hashing',
            percent,
            ...(rate > 0 ? { rate: formatRate(rate), left: formatRemaining(((1 - fraction) * file.size) / rate) } : {}),
          });
        },
      }).then(
        digests => settle({ state: 'done', digests }),
        error => !isAbort(error) && settle({ state: 'failed', message: 'Could not read the file.' }),
      );
    };
    const timer = newFile ? undefined : setTimeout(start, DEBOUNCE_MS);
    if (newFile) start();
    else setRun({ state: 'waiting' });
    return () => {
      controller.abort();
      clearTimeout(timer);
      if (cancel.current === controller) cancel.current = null;
    };
  }, [mode, file, keyBytes, keyBlocked]);

  // Hidden at once — not one render later, when the run is reset — as soon as the input or the key cannot be hashed.
  const blocked = keyBlocked || (mode !== 'file' && (!decoded?.ok || tooLarge));
  const digests = run.state === 'done' && !blocked ? run.digests : null;
  const comparison = useMemo(
    () => (digests ? compareExpected(expected, digests) : compareExpected(expected, {})),
    [expected, digests],
  );
  const nameOf = (a: Algorithm): string => (hmac ? `HMAC-${a}` : a);

  // History: a person's edit once its digests are there — a text as a `change`, a newly chosen file as a `commit` (choosing
  // it is the action), later edits of that file's options (key, output, comparison) as a `change`. The host keeps them only encrypted (hashHistory).
  const now = { mode, text, file, hmac, key, keyFormat, output, expected };
  const current = useRef(now);
  current.current = now;
  /** The file whose hashing was last committed: hashing it again under another key is an edit, not a new result. */
  const committed = useRef<File | null>(null);
  useEffect(() => {
    if (!edited.current || !digests) return;
    const s = current.current;
    const options: HashOptionsPayload = {
      output: s.output,
      hmac: s.hmac,
      ...(s.hmac ? { key: s.key, keyFormat: s.keyFormat } : {}),
      compare: s.expected,
      digests: hexDigests(digests),
    };
    if (s.mode === 'file') {
      if (!s.file) return;
      const payload: HashFilePayload = {
        ...options,
        input: 'file',
        file: { name: s.file.name, size: s.file.size, type: s.file.type },
      };
      const draft: HistoryDraft = {
        kind: 'file',
        payload: { ...payload },
        label: fileLabel(s.file.name, formatSize(s.file.size), s.hmac),
      };
      if (committed.current === s.file) recorder.change(draft);
      else {
        committed.current = s.file;
        void recorder.commit(draft);
      }
    } else if (s.text !== '') {
      const payload: HashTextPayload = { ...options, input: s.mode };
      recorder.change({
        kind: 'text',
        payload: { ...payload },
        label: textLabel(s.mode, s.text, s.hmac),
        text: excerpt(s.text),
        blobs: { input: new Blob([s.text], { type: 'text/plain' }) },
      });
    }
  }, [digests, output, expected, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };
  const chooseMode = (next: Mode): void =>
    edit(() => {
      generation.current++;
      saved.set({ inputFormat: next });
      // The file is let go when the mode changes (§11).
      if (next !== 'file') setFile(null);
      setRestoredFile(null);
      setRun({ state: 'idle' });
    });

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
    const p = (opened.payload ?? {}) as Partial<HashPayload>;
    edited.current = false;
    generation.current++;
    // The entry's options for this visit; what is saved stays as it was.
    const options = {
      output: isOutputFormat(p.output) ? p.output : ('hex' as const),
      hmac: p.hmac === true,
      keyFormat: isInputFormat(p.keyFormat) ? p.keyFormat : ('text' as const),
    };
    setKey(typeof p.key === 'string' ? p.key : '');
    setExpected(typeof p.compare === 'string' ? p.compare : '');
    const label = opened.label ?? 'an entry';
    if (p.input === 'file' && p.file) {
      const kept = p.file;
      saved.visit({ ...options, inputFormat: 'file' });
      setFile(null);
      setRestoredFile(kept);
      setRun({ state: 'done', digests: fromHex(p.digests) });
      setRestored(`Opened from History: ${label}. The file itself is not kept: choose it again to hash it.`);
      return;
    }
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(source => {
      saved.visit({ ...options, inputFormat: isInputFormat(p.input) ? p.input : 'text' });
      setFile(null);
      setRestoredFile(null);
      setText(source);
      setRestored(`Opened from History: ${label}.`);
    });
  });

  const cancelRun = (): void => {
    generation.current++;
    cancel.current?.abort();
    cancel.current = null;
    setRun({ state: 'cancelled' });
  };

  const hints = mode === 'text' ? textHints(text) : [];
  const shownFile = file ? { name: file.name, size: file.size } : restoredFile;
  const summary =
    comparison.kind === 'match'
      ? { tone: 'success' as const, text: `Matches ${nameOf(comparison.algorithm)}.` }
      : comparison.kind === 'no-match'
        ? { tone: 'note' as const, text: 'No hash above matches.' }
        : comparison.kind === 'unparsed'
          ? { tone: 'error' as const, text: 'Not a hex or Base64 hash.' }
          : null;

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <span id="hash-mode-label" className="text-muted-foreground text-sm">
          Input
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="hash-mode-label"
          value={mode}
          onValueChange={value => value && chooseMode(value as Mode)}>
          {MODES.map(m => (
            <ToggleGroupItem key={m.value} value={m.value}>
              {m.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <span id="hash-output-label" className="text-muted-foreground ml-2 text-sm">
          Output
        </span>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-labelledby="hash-output-label"
          value={output}
          onValueChange={value => value && edit(() => saved.set({ output: value as OutputFormat }))}>
          {OUTPUTS.map(o => (
            <ToggleGroupItem key={o.value} value={o.value}>
              {o.label}
            </ToggleGroupItem>
          ))}
        </ToggleGroup>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox id="hash-hmac" checked={hmac} onCheckedChange={c => edit(() => saved.set({ hmac: c === true }))} />
          <Label htmlFor="hash-hmac" className="font-normal">
            HMAC
          </Label>
        </div>
      </ToolOptions>

      {hmac && (
        <div className="flex flex-col gap-1">
          <ToolOptions>
            <Label htmlFor="hash-key">Key</Label>
            <Input
              id="hash-key"
              className="w-80 max-w-full font-mono"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={key}
              onChange={e => edit(() => setKey(e.target.value))}
            />
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Show key"
              title={showKey ? 'Hide key' : 'Show key'}
              aria-pressed={showKey}
              onClick={() => setShowKey(s => !s)}>
              {showKey ? <EyeOffIcon aria-hidden="true" /> : <EyeIcon aria-hidden="true" />}
            </Button>
            <Label htmlFor="hash-key-format" className="ml-2 text-muted-foreground">
              Key format
            </Label>
            <Select value={keyFormat} onValueChange={v => edit(() => saved.set({ keyFormat: v as InputFormat }))}>
              <SelectTrigger id="hash-key-format" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {KEY_FORMATS.map(f => (
                  <SelectItem key={f.value} value={f.value}>
                    {f.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </ToolOptions>
          {keyDecoded && !keyDecoded.ok && (
            <ToolMessage tone="error" role="status" data-field="key">
              {keyDecoded.message}
            </ToolMessage>
          )}
        </div>
      )}

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPanes layout="stacked">
        <ToolPane label={PANE[mode]} {...(mode === 'file' ? {} : { htmlFor: 'hash-input' })}>
          {mode === 'file' ? (
            <FileDrop
              onFiles={([next]) =>
                next &&
                edit(() => {
                  setRestoredFile(null);
                  setFile(next);
                })
              }>
              {shownFile && (
                <span className="text-foreground" data-file>
                  {shownFile.name} — {formatSize(shownFile.size)}
                </span>
              )}
              {run.state === 'hashing' && (
                <span className="flex items-center gap-2" role="status">
                  <span
                    data-progress>{`Hashing… ${run.percent}%${run.rate ? ` · ${run.rate} · ${run.left}` : ''}`}</span>
                  <Button type="button" variant="outline" size="sm" onClick={cancelRun}>
                    Cancel
                  </Button>
                </span>
              )}
            </FileDrop>
          ) : (
            <Textarea
              id="hash-input"
              className="h-40 resize-y font-mono text-code field-sizing-fixed"
              spellCheck={false}
              placeholder={PLACEHOLDER[mode]}
              value={text}
              onChange={e => edit(() => setText(e.target.value))}
            />
          )}
          <div data-field="input">
            {decoded && !decoded.ok ? (
              <ToolMessage tone="error" role="status">
                {decoded.message}
              </ToolMessage>
            ) : tooLarge ? (
              <ToolMessage tone="error" role="status">
                Text is larger than 16 MB. Use File for large inputs.
              </ToolMessage>
            ) : run.state === 'failed' || run.state === 'cancelled' ? (
              <ToolMessage tone={run.state === 'failed' ? 'error' : 'note'}>
                {run.state === 'failed' ? run.message : 'Cancelled.'}
              </ToolMessage>
            ) : run.state === 'waiting' && mode !== 'file' ? (
              <ToolMessage>Hashing…</ToolMessage>
            ) : decoded?.ok && decoded.bytes.length === 0 ? (
              <ToolMessage>Hash of empty input.</ToolMessage>
            ) : hints.length ? (
              hints.map(h => <ToolMessage key={h}>{HINTS[h]}</ToolMessage>)
            ) : (
              <ToolMessage />
            )}
          </div>
        </ToolPane>

        <ToolPane label="Result">
          <ResultRows>
            {ALGORITHMS.map(a => {
              const matched = comparison.kind === 'match' && comparison.algorithm === a;
              return (
                <ResultRow
                  key={a}
                  label={nameOf(a)}
                  value={digests?.[a] ? formatDigest(digests[a], output) : ''}
                  {...(keyMissing ? { empty: 'Enter a key.' } : {})}
                  data-match={matched || undefined}
                  extra={
                    matched ? (
                      <span className="text-success flex items-center gap-1 text-sm">
                        <CheckIcon aria-hidden="true" className="size-4" />
                        Matches
                      </span>
                    ) : undefined
                  }
                />
              );
            })}
          </ResultRows>
        </ToolPane>

        <ToolPane label="Compare with" htmlFor="hash-compare">
          <Input
            id="hash-compare"
            className="font-mono"
            placeholder="Paste an expected hash"
            autoComplete="off"
            spellCheck={false}
            value={expected}
            onChange={e => edit(() => setExpected(e.target.value))}
          />
          <ToolMessage tone={summary?.tone ?? 'note'} data-field="compare">
            {summary?.text}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>

      <p className="text-muted-foreground m-0 text-sm">
        MD5 and SHA-1 are not collision-resistant. Use them only to compare with existing checksums.
      </p>
      <p className="text-muted-foreground m-0 text-sm" data-kept>
        {keptLine(status)}
      </p>
    </div>
  );
};

export default HashTool;
