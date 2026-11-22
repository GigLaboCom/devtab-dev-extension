/**
 * The Compress / Decompress tool's page (docs/tools/specs/compress.md §8). Decompress: Base64, hex or a file — chosen,
 * dropped or pasted — in gzip, zlib, raw deflate, zstd or brotli (Auto by the first bytes), shown as text when the bytes
 * are UTF-8, else in hex or Base64, with the sizes, the ratio and the gzip header's fields. Compress: text, hex, Base64
 * or a file into one of them, shown in Base64 or hex. All work is in the package's workers (runner.ts); a result over
 * 1 MiB is previewed, not shown, and Save writes it as a stream (save.ts). The host wraps it in the kit's ToolPage.
 *
 * History (D17): an edit is a snapshot once its result is there; choosing a file, Copy and Save are commits; an input
 * over 1 MiB is not kept (entries.ts). An entry opens back with its direction, options and input; the result is made
 * again.
 */
import { draftOf, readEntry } from './entries';
import { compressHistory } from './history';
import { createRunner, familyOf } from './runner';
import { canWriteFiles, downloadBytes, pickFile, writeBytes } from './save';
import {
  BOM_NOTE,
  BROTLI_QUALITIES,
  DEFAULT_BROTLI_QUALITY,
  DEFAULT_ZSTD_LEVEL,
  EDGE_SPACE,
  FORMAT_LABELS,
  LIVE_INPUT,
  MAX_KEPT_INPUT,
  MAX_TEXT_INPUT,
  NOT_KEPT,
  NOT_RECOGNISED,
  NOT_SAVED,
  PREVIEW_BYTES,
  PROGRESS_AFTER_MS,
  SAVE_NEEDS_FILES,
  SETTLE_MS,
  SHOW_LIMITS,
  SIGNATURES,
  TEXT_TOO_LARGE,
  TRAILING_NEWLINE,
  ZSTD_LEVELS,
  HEX_HINT,
  alsoCompressed,
  base64View,
  encodeOutput,
  hexView,
  compressedName,
  controlsNote,
  countControls,
  decompressedName,
  formatSize,
  gzipMembers,
  gzipTrailing,
  headerRows,
  hexInsteadOfBase64,
  notUtf8,
  nulByte,
  parseInput,
  previewLabel,
  recogniseFormat,
  showControls,
  sizesLine,
  streamTrailing,
  textBytes,
  textHints,
  tooLargeToShow,
} from '@workspace/tool-logic-compress';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action, CompressPayload } from './entries';
import type { Work } from './runner';
import type {
  Collected,
  CompressInput,
  DecompressInput,
  Direction,
  Format,
  FormatChoice,
  Job,
  OutputEncoding,
  ResultView,
  RunOutcome,
} from '@workspace/tool-logic-compress';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const DECOMPRESS_FORMATS: readonly FormatChoice[] = ['auto', 'gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'];
const COMPRESS_FORMATS: readonly Format[] = ['gzip', 'zlib', 'deflate-raw', 'zstd', 'brotli'];
const DECOMPRESS_INPUTS: ReadonlyArray<[DecompressInput, string]> = [
  ['base64', 'Base64'],
  ['hex', 'Hex'],
  ['file', 'File'],
];
const COMPRESS_INPUTS: ReadonlyArray<[CompressInput, string]> = [
  ['text', 'Text'],
  ['hex', 'Hex'],
  ['base64', 'Base64'],
  ['file', 'File'],
];
const VIEWS: ReadonlyArray<[ResultView, string]> = [
  ['text', 'Text'],
  ['hex', 'Hex'],
  ['base64', 'Base64'],
];
const ENCODINGS: ReadonlyArray<[OutputEncoding, string]> = [
  ['base64', 'Base64'],
  ['base64url', 'Base64 URL-safe'],
  ['hex', 'Hex'],
];
const PLACEHOLDERS: Readonly<Record<string, string>> = {
  base64: 'H4sIAAAAAAAA/…',
  hex: '1f 8b 08 00 …',
  text: 'Text to compress',
};
const CODE = 'h-72 resize-y font-mono text-code field-sizing-fixed';
const DECODER = new TextDecoder('utf-8', { ignoreBOM: true });
const HEXISH = /^[\s0-9a-fA-F]+$/;

type Prepared =
  { ok: true; bytes: Uint8Array } | { ok: true; file: File } | { ok: false; message: string; hint?: string } | null;

type Shown =
  | { kind: 'none' }
  | { kind: 'done'; outcome: Extract<RunOutcome, { ok: true }>; collected: Collected; recognised: boolean }
  | { kind: 'failed'; outcome: Extract<RunOutcome, { ok: false }> | null; message: string; hint?: string };

/** The field's text the result follows: live when small, SETTLE_MS after the last edit when large. */
const useSettled = (text: string): string => {
  const [settled, setSettled] = useState(text);
  const live = text.length <= LIVE_INPUT || text.length > MAX_TEXT_INPUT;
  useEffect(() => {
    if (live) return setSettled(text);
    const timer = setTimeout(() => setSettled(text), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [text, live]);
  return live ? text : settled;
};

const percent = (read: number, total: number): string => `${total > 0 ? Math.floor((read / total) * 100) : 100}%`;

const CompressTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [direction, setDirection] = useState<Direction>('decompress');
  const [dFormat, setDFormat] = useState<FormatChoice>('auto');
  const [cFormat, setCFormat] = useState<Format>('gzip');
  const [zstdLevel, setZstdLevel] = useState(DEFAULT_ZSTD_LEVEL);
  const [brotliQuality, setBrotliQuality] = useState(DEFAULT_BROTLI_QUALITY);
  const [keepName, setKeepName] = useState(false);
  // Text handed over from the start page was recognised as compressed data (detectCompress): Base64 or hex.
  const [dKind, setDKind] = useState<DecompressInput>(initial && HEXISH.test(initial) ? 'hex' : 'base64');
  const [cKind, setCKind] = useState<CompressInput>('text');
  const [dText, setDText] = useState(initial ?? '');
  const [cText, setCText] = useState('');
  const [dFile, setDFile] = useState<File | null>(null);
  const [cFile, setCFile] = useState<File | null>(null);
  const [view, setView] = useState<ResultView | null>(null);
  const [encoding, setEncoding] = useState<OutputEncoding>('base64');
  const [shown, setShown] = useState<Shown>({ kind: 'none' });
  const [working, setWorking] = useState<{ read: number; total: number; visible: boolean; saving: boolean } | null>(
    null,
  );
  const [saved, setSaved] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'compress', compressHistory);
  const runner = useMemo(() => createRunner(), []);
  useEffect(() => () => runner.dispose(), [runner]);
  /** A person changed something since the page opened or an entry was opened: only then is a result recorded. */
  const edited = useRef(Boolean(initial));
  const chose = useRef(false);
  const lastWork = useRef<Work | null>(null);
  const paramsKey = useRef('');

  const decompressing = direction === 'decompress';
  const kind: DecompressInput | CompressInput = decompressing ? dKind : cKind;
  const text = decompressing ? dText : cText;
  const file = decompressing ? dFile : cFile;
  const format: FormatChoice = decompressing ? dFormat : cFormat;
  const level = cFormat === 'zstd' ? zstdLevel : cFormat === 'brotli' ? brotliQuality : undefined;
  const settled = useSettled(text);

  const prepared: Prepared = useMemo(() => {
    if (kind === 'file') return file ? { ok: true, file } : null;
    if (settled.length > MAX_TEXT_INPUT) return { ok: false, message: TEXT_TOO_LARGE };
    if (settled === '') return null;
    if (kind === 'text') return { ok: true, bytes: textBytes(settled) };
    const parsed = parseInput(settled, kind);
    if (parsed.ok) return parsed.bytes.length ? { ok: true, bytes: parsed.bytes } : null;
    return { ok: false, message: parsed.error.message, ...(parsed.hint ? { hint: parsed.hint } : {}) };
  }, [kind, file, settled]);

  // ---- The work: whenever the input or an option changes.
  useEffect(() => {
    setSaved(null);
    if (!prepared || !prepared.ok) {
      runner.cancel();
      setWorking(null);
      setShown(
        prepared
          ? {
              kind: 'failed',
              outcome: null,
              message: prepared.message,
              ...(prepared.hint ? { hint: prepared.hint } : {}),
            }
          : { kind: 'none' },
      );
      return;
    }
    let live = true;
    const key = [direction, format, level, keepName, kind, 'file' in prepared ? prepared.file : 'text']
      .map(String)
      .join('|');
    const typing = key === paramsKey.current;
    paramsKey.current = key;
    void (async () => {
      let target: Format;
      let recognised = false;
      if (format === 'auto') {
        const head =
          'file' in prepared
            ? new Uint8Array(await prepared.file.slice(0, 4).arrayBuffer())
            : prepared.bytes.subarray(0, 4);
        if (!live) return;
        const found = recogniseFormat(head);
        if (!found) {
          const hint =
            !('file' in prepared) && dKind === 'base64' && hexInsteadOfBase64(settled) ? HEX_HINT : undefined;
          runner.cancel();
          setWorking(null);
          setShown({
            kind: 'failed',
            outcome: null,
            message:
              'file' in prepared && prepared.file.size === 0
                ? 'The file is empty: there is nothing to decompress.'
                : NOT_RECOGNISED,
            ...(hint ? { hint } : {}),
          });
          return;
        }
        target = found;
        recognised = true;
      } else target = format;
      const job: Job = {
        direction,
        format: target,
        ...(level !== undefined && !decompressing ? { level } : {}),
        ...(keepName && !decompressing && target === 'gzip' && 'file' in prepared
          ? { keep: { name: prepared.file.name, mtime: prepared.file.lastModified / 1000 } }
          : {}),
      };
      const work: Work = {
        family: familyOf(target, direction),
        job,
        input:
          'file' in prepared ? { kind: 'file', file: prepared.file } : { kind: 'bytes', bytes: prepared.bytes.slice() },
        sink: { kind: 'collect' },
      };
      lastWork.current = { ...work, input: 'file' in prepared ? work.input : { kind: 'bytes', bytes: prepared.bytes } };
      setWorking({
        read: 0,
        total: 'file' in prepared ? prepared.file.size : prepared.bytes.length,
        visible: false,
        saving: false,
      });
      const onProgress = (read: number, total: number) => live && setWorking(w => (w ? { ...w, read, total } : w));
      const result = await (typing ? runner.submit(work, onProgress) : runner.replace(work, onProgress));
      if (!live || result.type === 'dropped') return;
      setWorking(null);
      if (result.type === 'failure') return setShown({ kind: 'failed', outcome: null, message: result.message });
      const { outcome, collected } = result;
      if (outcome.ok && collected) setShown({ kind: 'done', outcome, collected, recognised });
      else if (!outcome.ok) setShown({ kind: 'failed', outcome, message: outcome.message });
    })();
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prepared, direction, format, level, keepName]);

  // The progress line and Cancel appear only for work that takes a while.
  const busy = working !== null;
  useEffect(() => {
    if (!busy) return;
    const timer = setTimeout(() => setWorking(w => (w ? { ...w, visible: true } : w)), PROGRESS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [busy]);

  // ---- What is shown
  const done = shown.kind === 'done' ? shown : null;
  const collected = done?.collected ?? null;
  const verdict = collected?.verdict;
  const isText = Boolean(verdict?.text);
  const effectiveView: ResultView =
    view === 'text' && done && !isText ? 'hex' : (view ?? (done && !isText ? 'hex' : 'text'));
  const showLimit = SHOW_LIMITS[decompressing ? effectiveView : encoding === 'hex' ? 'plain-hex' : encoding];
  const showable = collected ? collected.size <= showLimit : false;
  const shownBytes = collected ? (showable ? collected.head : collected.head.subarray(0, PREVIEW_BYTES)) : null;
  const rendered = useMemo(() => {
    if (!shownBytes) return { display: '', copy: '' };
    if (decompressing) {
      if (effectiveView === 'text') {
        const decoded = DECODER.decode(shownBytes);
        return { display: showControls(decoded), copy: decoded, controls: countControls(decoded) };
      }
      const out = effectiveView === 'hex' ? hexView(shownBytes) : base64View(shownBytes);
      return { display: out, copy: out };
    }
    const out = encodeOutput(shownBytes, encoding);
    return { display: out, copy: out };
  }, [shownBytes, decompressing, effectiveView, encoding]);

  const fileName = file?.name ?? null;
  const header = done?.outcome.header;
  const saveName = decompressing
    ? decompressedName(kind === 'file' ? fileName : null, header?.name, isText)
    : compressedName(kind === 'file' ? fileName : null, cFormat, cKind);

  // ---- History
  const payloadOf = (action?: Action): CompressPayload => ({
    direction,
    format,
    ...(done?.recognised ? { recognised: done.outcome.format } : {}),
    input: kind,
    ...(level !== undefined && !decompressing ? { level } : {}),
    ...(keepName && !decompressing && cFormat === 'gzip' ? { keepName: true } : {}),
    view: decompressing ? effectiveView : encoding,
    inputBytes: prepared && prepared.ok ? ('file' in prepared ? prepared.file.size : prepared.bytes.length) : 0,
    ...(done ? { outputBytes: done.outcome.outputBytes } : {}),
    ...(shown.kind === 'failed' ? { error: shown.message } : {}),
    ...(action ? { action } : {}),
  });
  const inputForHistory = (): { text: string } | { bytes: Blob } | null =>
    kind === 'file' ? (file ? { bytes: new Blob([file]) } : null) : text ? { text } : null;
  const commit = (action: Action): void => {
    const draft = draftOf(payloadOf(action), inputForHistory());
    if (draft) void recorder.commit(draft);
  };
  useEffect(() => {
    if (!edited.current || shown.kind === 'none') return;
    if (chose.current && shown.kind === 'done') {
      chose.current = false;
      commit('chose');
      return;
    }
    const draft = draftOf(payloadOf(), inputForHistory());
    if (draft) recorder.change(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [shown]);
  const inputSize = kind === 'file' ? (file?.size ?? 0) : text.length;
  const notKept = inputSize > MAX_KEPT_INPUT;

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  // ---- Files: chosen, dropped, or pasted anywhere on the page
  const takeFile = (f: File | undefined): void => {
    if (!f) return;
    edit(() => {
      chose.current = true;
      if (decompressing) {
        setDKind('file');
        setDFile(f);
      } else {
        setCKind('file');
        setCFile(f);
      }
    });
  };
  const latestTake = useRef(takeFile);
  latestTake.current = takeFile;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const files = Array.from(event.clipboardData?.files ?? []);
      if (!files.length) return;
      event.preventDefault();
      latestTake.current(files[0]);
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, []);

  // ---- Opening an entry of the history
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
    const entry = readEntry(opened);
    if (!entry) return setRestored('This entry could not be opened.');
    void (entry.input === 'file' ? Promise.resolve('') : entry.blob.text()).then(content => {
      edited.current = false;
      setDirection(entry.direction);
      if (entry.direction === 'decompress') {
        setDFormat(entry.format);
        setDKind(entry.input as DecompressInput);
        if (entry.input === 'file') setDFile(new File([entry.blob], 'input.bin'));
        else setDText(content);
        setView(VIEWS.some(([v]) => v === entry.view) ? (entry.view as ResultView) : null);
      } else {
        setCFormat(entry.format === 'auto' ? 'gzip' : entry.format);
        if (entry.level !== undefined && entry.format === 'zstd') setZstdLevel(entry.level);
        if (entry.level !== undefined && entry.format === 'brotli') setBrotliQuality(entry.level);
        setKeepName(entry.keepName);
        setCKind(entry.input as CompressInput);
        if (entry.input === 'file') setCFile(new File([entry.blob], 'input.bin'));
        else setCText(content);
        if (ENCODINGS.some(([e]) => e === entry.view)) setEncoding(entry.view as OutputEncoding);
      }
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  // ---- Save
  const save = async (): Promise<void> => {
    if (!collected || !done) return;
    setSaved(null);
    try {
      if (canWriteFiles()) {
        const handle = await pickFile(saveName);
        if (!handle) return;
        if (collected.bytes) await writeBytes(handle, collected.bytes);
        else {
          const work = lastWork.current;
          if (!work) return;
          setWorking({ read: 0, total: 0, visible: true, saving: true });
          const input =
            work.input.kind === 'bytes' ? { kind: 'bytes' as const, bytes: work.input.bytes.slice() } : work.input;
          const result = await runner.replace({ ...work, input, sink: { kind: 'file', handle } }, (read, total) =>
            setWorking(w => (w ? { ...w, read, total } : w)),
          );
          setWorking(null);
          if (result.type !== 'done' || !result.outcome.ok)
            return setSaved(result.type === 'done' && !result.outcome.ok ? result.outcome.message : NOT_SAVED);
        }
        setSaved(`Saved as ${handle.name}.`);
        commit('save');
      } else if (collected.bytes) {
        downloadBytes(collected.bytes, saveName);
        commit('save');
      } else setSaved(SAVE_NEEDS_FILES);
    } catch {
      setWorking(null);
      setSaved(NOT_SAVED);
    }
  };

  const decompressAgain = (): void => {
    if (!collected?.bytes) return;
    const bytes = collected.bytes;
    edit(() => {
      setDirection('decompress');
      setDFormat('auto');
      setDKind('file');
      setDFile(new File([bytes as Uint8Array<ArrayBuffer>], saveName));
      setView(null);
    });
  };

  const clear = (): void =>
    edit(() => {
      runner.cancel();
      if (decompressing) {
        setDText('');
        setDFile(null);
      } else {
        setCText('');
        setCFile(null);
      }
    });

  // ---- Notes and facts
  const notes: string[] = [];
  if (done && decompressing && verdict) {
    if (verdict.bom) notes.push(BOM_NOTE);
    if (!verdict.text)
      notes.push(verdict.firstInvalid !== null ? notUtf8(verdict.firstInvalid) : nulByte(verdict.firstNul!));
    if (effectiveView === 'text' && rendered.controls) notes.push(controlsNote(rendered.controls));
    const t = done.outcome.trailing;
    if (t && t.bytes > 0)
      notes.push(done.outcome.format === 'gzip' ? gzipTrailing(t.bytes, t.at + 1) : streamTrailing(t.bytes, t.at + 1));
    if ((done.outcome.members ?? 1) > 1) notes.push(gzipMembers(done.outcome.members!));
  }
  const nested = done && decompressing && collected ? recogniseFormat(collected.head.subarray(0, 4)) : null;
  if (nested) notes.push(alsoCompressed(nested));
  const hints = kind === 'text' ? textHints(text) : [];
  const failed = shown.kind === 'failed' ? shown : null;
  const stopped = failed?.outcome?.reason === 'limit';
  const facts = done
    ? `${FORMAT_LABELS[done.outcome.format]}${done.recognised && SIGNATURES[done.outcome.format] ? ` (recognised by ${SIGNATURES[done.outcome.format]})` : ''} · ${sizesLine(done.outcome.inputBytes, done.outcome.outputBytes, direction)}`
    : '';

  const formats = decompressing ? DECOMPRESS_FORMATS : COMPRESS_FORMATS;
  const inputs = decompressing ? DECOMPRESS_INPUTS : COMPRESS_INPUTS;

  return (
    <div className="flex flex-col gap-3" data-direction={direction}>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={direction}
          onValueChange={value => {
            if ((value === 'decompress' || value === 'compress') && value !== direction)
              edit(() => setDirection(value));
          }}>
          <ToggleGroupItem value="decompress">Decompress</ToggleGroupItem>
          <ToggleGroupItem value="compress">Compress</ToggleGroupItem>
        </ToggleGroup>
        <Label htmlFor="compress-format" className="ml-2 text-muted-foreground">
          Format
        </Label>
        <Select
          value={format}
          onValueChange={value => {
            if (!formats.includes(value as Format)) return;
            edit(() => (decompressing ? setDFormat(value as FormatChoice) : setCFormat(value as Format)));
          }}>
          <SelectTrigger id="compress-format" className="min-w-36">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {formats.map(f => (
              <SelectItem key={f} value={f}>
                {FORMAT_LABELS[f]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {!decompressing && (cFormat === 'zstd' || cFormat === 'brotli') && (
          <>
            <Label htmlFor="compress-level" className="ml-2 text-muted-foreground">
              {cFormat === 'zstd' ? 'Level' : 'Quality'}
            </Label>
            <Select
              value={String(cFormat === 'zstd' ? zstdLevel : brotliQuality)}
              onValueChange={value =>
                edit(() => (cFormat === 'zstd' ? setZstdLevel(Number(value)) : setBrotliQuality(Number(value))))
              }>
              <SelectTrigger id="compress-level" className="min-w-16">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(cFormat === 'zstd' ? ZSTD_LEVELS : BROTLI_QUALITIES).map(n => (
                  <SelectItem key={n} value={String(n)}>
                    {String(n)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </>
        )}
        {!decompressing && cFormat === 'gzip' && cKind === 'file' && (
          <div className="ml-2 flex items-center gap-2">
            <Checkbox
              id="compress-keep-name"
              checked={keepName}
              onCheckedChange={c => edit(() => setKeepName(c === true))}
            />
            <Label htmlFor="compress-keep-name">Keep the file’s name and time</Label>
          </div>
        )}
        <Button variant="outline" className="ml-auto" onClick={clear}>
          Clear
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPanes>
        <ToolPane
          label="Input"
          htmlFor={kind === 'file' ? undefined : 'compress-input'}
          actions={
            <ToggleGroup
              type="single"
              variant="segmented"
              aria-label="Input encoding"
              value={kind}
              onValueChange={value => {
                if (!value || value === kind) return;
                edit(() => (decompressing ? setDKind(value as DecompressInput) : setCKind(value as CompressInput)));
              }}>
              {inputs.map(([value, label]) => (
                <ToggleGroupItem key={value} value={value}>
                  {label}
                </ToggleGroupItem>
              ))}
            </ToggleGroup>
          }>
          {kind === 'file' ? (
            <FileDrop className="grow" onFiles={files => latestTake.current(files[0])}>
              {file && (
                <p className="m-0 font-mono text-code" data-part="file">
                  {file.name} — {formatSize(file.size)}
                </p>
              )}
            </FileDrop>
          ) : (
            <Textarea
              id="compress-input"
              className={CODE}
              spellCheck={false}
              placeholder={PLACEHOLDERS[kind]}
              value={text}
              onChange={event => {
                const next = event.target.value;
                edit(() => (decompressing ? setDText(next) : setCText(next)));
              }}
            />
          )}
          {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {failed && !stopped ? failed.message : ' '}
          </ToolMessage>
          <div className="flex flex-col" role="status" data-part="hints">
            {failed?.hint && <ToolMessage role={undefined}>{failed.hint}</ToolMessage>}
            {hints.includes('trailing-newline') && <ToolMessage role={undefined}>{TRAILING_NEWLINE}</ToolMessage>}
            {hints.includes('edge-space') && <ToolMessage role={undefined}>{EDGE_SPACE}</ToolMessage>}
            {notKept && <ToolMessage role={undefined}>{NOT_KEPT}</ToolMessage>}
          </div>
          {working?.visible && (
            <div className="flex items-center gap-2" data-part="progress">
              <p className="m-0 text-sm text-muted-foreground" role="status">
                {working.saving ? 'Saving…' : decompressing ? 'Decompressing…' : 'Compressing…'}{' '}
                {percent(working.read, working.total)}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  edit(() => {
                    runner.cancel();
                    setWorking(null);
                    setShown({ kind: 'failed', outcome: null, message: 'Cancelled.' });
                  })
                }>
                Cancel
              </Button>
            </div>
          )}
        </ToolPane>

        <ToolPane
          label="Result"
          htmlFor="compress-result"
          actions={
            <>
              <ToggleGroup
                type="single"
                variant="segmented"
                aria-label="View"
                value={decompressing ? effectiveView : encoding}
                onValueChange={value => {
                  if (!value) return;
                  if (decompressing) setView(value as ResultView);
                  else setEncoding(value as OutputEncoding);
                }}>
                {(decompressing ? VIEWS : ENCODINGS).map(([value, label]) => (
                  <ToggleGroupItem
                    key={value}
                    value={value}
                    disabled={decompressing && value === 'text' && Boolean(done) && !isText}>
                    {label}
                  </ToggleGroupItem>
                ))}
              </ToggleGroup>
              <CopyButton
                value={showable ? rendered.copy : ''}
                size="sm"
                disabled={!showable || rendered.copy === ''}
                onCopied={() => commit('copy')}
              />
              <Button variant="ghost" size="sm" disabled={!done} onClick={() => void save()}>
                Save
              </Button>
            </>
          }>
          {done && !showable && (
            <ToolMessage role={undefined} data-part="too-large">
              {tooLargeToShow(done.outcome.outputBytes)}{' '}
              {previewLabel(Math.min(PREVIEW_BYTES, done.outcome.outputBytes))}
            </ToolMessage>
          )}
          <Textarea
            id="compress-result"
            className={CODE}
            spellCheck={false}
            readOnly
            wrap={decompressing && effectiveView === 'hex' ? 'off' : 'soft'}
            value={rendered.display}
          />
          <div className="flex flex-col" role="status" data-part="notes">
            {notes.map(note => (
              <ToolMessage key={note} role={undefined}>
                {note}
              </ToolMessage>
            ))}
            {saved && <ToolMessage role={undefined}>{saved}</ToolMessage>}
          </div>
          {nested && collected?.bytes && (
            <div>
              <Button variant="outline" size="sm" onClick={decompressAgain}>
                Decompress again
              </Button>
            </div>
          )}
        </ToolPane>
      </ToolPanes>

      <div className="flex flex-col gap-2" data-part="facts">
        <ToolMessage role="status" data-part="sizes">
          {facts || ' '}
        </ToolMessage>
        {stopped && (
          <ToolMessage tone="error" role="status" data-part="stopped">
            {failed!.message}
          </ToolMessage>
        )}
        {header && (
          <dl
            className="m-0 grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1 text-sm"
            aria-label="gzip header"
            data-part="header">
            {headerRows(header).map(row => (
              <div key={row.label} className="contents">
                <dt className="text-muted-foreground">{row.label}</dt>
                <dd className="m-0 font-mono text-code break-all">{row.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </div>
    </div>
  );
};

export default CompressTool;
