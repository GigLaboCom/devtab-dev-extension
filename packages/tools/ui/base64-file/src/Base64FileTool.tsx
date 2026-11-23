/**
 * The Base64 File tool's page (docs/tools/specs/base64-file.md §8). Encode: a file chosen, dropped or pasted is named by
 * its bytes (then its extension) and shown as Base64 — standard or URL-safe, padded or not, wrapped or not — or a data
 * URI whose type the person may correct; Copy takes an output up to 16 Mi characters, Save any, streaming. Decode: Base64,
 * a data URI or a PEM block — typed, pasted, or a text file — becomes bytes the tool names (type, size), with a file name
 * to save them under; text can be shown. Nothing decoded is ever shown, run or loaded. The host wraps it in the kit's
 * ToolPage; this is the body. Logic: @workspace/tool-logic-base64-file; the work: codec.ts (a worker of this package).
 *
 * History (D17, entries.ts): choosing a file, Copy, Save and Save file are commits; a change of the output's options,
 * or a person's edit in Decode that gives bytes, is a snapshot. Private keys and files over 1 MiB are never kept, bytes
 * of an unknown type only encrypted; the page says which applies.
 *
 * The direction and Encode's output options are saved parameters (settings.ts; docs/tools/settings.md): the person's
 * change is saved (`set`); text handed over opens Decode, a file or a text pasted on the page and an opened entry choose
 * for the visit only (`visit`).
 */
import { createCodec } from './codec';
import { draftOf, keepingNote, keepingOf, readEntry } from './entries';
import { base64FileHistory } from './history';
import { Facts, Working, saveBlob } from './parts';
import { base64FileSettings } from './settings';
import {
  COPY_MAX_CHARS,
  FIELD_MAX_CHARS,
  HEAD_BYTES,
  IS_TEXT,
  LIVE_CHARS,
  MAX_FILE_BYTES,
  MAX_TEXT_BYTES,
  NOT_TEXT_FILE,
  ONLY_FIRST,
  SETTLE_MS,
  SHOW_TEXT_BYTES,
  SHOW_WHOLE_CHARS,
  SHOWN_CHARS,
  TYPE_MESSAGE,
  UNREADABLE,
  cleanFileName,
  decodeInput,
  defaultPadding,
  describe,
  encodedLength,
  fileTooLarge,
  formatCount,
  formatSize,
  inputOf,
  isMimeType,
  pastedNote,
  pemBase,
  recogniseBytes,
  sampleOf,
  shownNote,
  suggestName,
  textEncodingOf,
  textFileName,
  textFileNote,
  textFileTooLarge,
  textShownNote,
} from '@workspace/tool-logic-base64-file';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Input } from '@workspace/ui/input';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Decoded } from './codec.worker';
import type { Action } from './entries';
import type { EncodeOptions, InputError, LineLength, Recognised } from '@workspace/tool-logic-base64-file';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const CODE = 'h-90 resize-y font-mono text-code field-sizing-fixed';
const LINE_LENGTHS: ReadonlyArray<{ value: LineLength; label: string }> = [
  { value: 0, label: 'No wrapping' },
  { value: 64, label: '64' },
  { value: 76, label: '76' },
];
const BINARY = 'application/octet-stream';

interface Source {
  file: Blob;
  /** The file's name, for showing, its extension and Save's name; null for a file from History. */
  name: string | null;
}

type DecodeOutcome =
  | { state: 'empty' }
  | { state: 'working'; progress: { done: number; total: number } | null }
  | { state: 'done'; decoded: Decoded }
  | { state: 'invalid'; error: InputError };

const errorText = (error: InputError): string =>
  error.line !== undefined ? `Line ${error.line}, column ${error.column}: ${error.message}` : error.message;

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** The input the result follows: the live one when small, the one 300 ms after the last edit when larger. */
const useSettled = (input: string): string => {
  const [settled, setSettled] = useState(input);
  const live = input.length <= LIVE_CHARS;
  useEffect(() => {
    if (live) return setSettled(input);
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, live]);
  return live ? input : settled;
};

/** Decoding on the page (up to LIVE_CHARS): the same logic as the worker's, at once. */
const decodeOnPage = (text: string): DecodeOutcome => {
  const r = decodeInput(text);
  if (!r.ok) return { state: 'invalid', error: r.error };
  if (r.bytes.length === 0) return { state: 'empty' };
  const blob = new Blob([r.bytes as Uint8Array<ArrayBuffer>], { type: BINARY });
  return {
    state: 'done',
    decoded: { blob, size: r.bytes.length, header: r.header, recognised: recogniseBytes(sampleOf(r.bytes)) },
  };
};

const Base64FileTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  // Text handed over from the start page was recognised as this tool's input (detectBase64File): it is to be decoded.
  // It opens Decode for this visit; what is saved stays.
  const handedLarge = (initial?.length ?? 0) > FIELD_MAX_CHARS;
  const saved = useSavedSettings(host, 'base64-file', base64FileSettings, {
    opening: initial ? { mode: 'decode' } : undefined,
  });
  const { mode, form, alphabet, padding, lineLength } = saved.values;

  // ---- Encode
  const [source, setSource] = useState<Source | null>(null);
  const [encodeError, setEncodeError] = useState<string | null>(null);
  const [several, setSeveral] = useState(false);
  const [recognised, setRecognised] = useState<{ of: Source; value: Recognised } | null>(null);
  /** The data URI's type as the person typed it; null: the recognised one. */
  const [typeText, setTypeText] = useState<string | null>(null);
  const [output, setOutput] = useState<{ key: string; text: string; whole: boolean } | null>(null);
  const [saving, setSaving] = useState<{ done: number; total: number } | null>(null);

  // ---- Decode
  const [text, setText] = useState(handedLarge ? '' : (initial ?? ''));
  const [held, setHeld] = useState<{ blob: Blob; note: string } | null>(() =>
    handedLarge ? { blob: new Blob([initial!]), note: pastedNote(initial!.length) } : null,
  );
  const [decodeError, setDecodeError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<DecodeOutcome>({ state: 'empty' });
  const [name, setName] = useState<string | null>(null);
  const [shownText, setShownText] = useState<{ of: Decoded; text: string; note: string | null } | null>(null);
  const [restored, setRestored] = useState<string | null>(null);

  const { history, recorder, status } = useToolHistory(host, 'base64-file', base64FileHistory);
  const root = useRef<HTMLDivElement>(null);
  const textFileInput = useRef<HTMLInputElement>(null);
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const describer = useMemo(() => createCodec(), []);
  const encoder = useMemo(() => createCodec(), []);
  const saver = useMemo(() => createCodec(), []);
  const decoder = useMemo(() => createCodec(), []);
  useEffect(
    () => () => {
      for (const c of [describer, encoder, saver, decoder]) c.cancel();
    },
    [describer, encoder, saver, decoder],
  );
  /** A person changed something since the page opened or an entry was opened: only then is an edit recorded. */
  const edited = useRef(Boolean(initial));
  const optionsEdited = useRef(false);
  /** The choice of a file waits for its type to be known before it is committed. */
  const chose = useRef<Source | null>(null);

  const commit = (draft: HistoryDraft | null): void => {
    if (draft) void recorder.commit(draft);
  };

  // ---- Encode: the file, its type, the output
  const takeFile = (file: File | Blob, fileName: string | null, record: boolean): void => {
    setRestored(null);
    // A file chose Encode for this visit: what is saved stays.
    saved.visit({ mode: 'encode' });
    setSaving(null);
    saver.cancel();
    setOutput(null);
    setTypeText(null);
    // §6: refused by its size before it is read.
    if (file.size > MAX_FILE_BYTES) {
      setSource(null);
      setRecognised(null);
      setEncodeError(fileTooLarge(file.size));
      return;
    }
    setEncodeError(null);
    const next: Source = { file, name: fileName };
    chose.current = record ? next : null;
    setSource(next);
  };
  const takeFiles = (files: File[]): void => {
    const file = files[0];
    if (!file) return;
    edited.current = true;
    setSeveral(files.length > 1);
    takeFile(file, file.name, true);
  };
  const latestTake = useRef(takeFiles);
  latestTake.current = takeFiles;

  useEffect(() => {
    if (!source) return setRecognised(null);
    let live = true;
    void describer.run({ type: 'recognise', blob: source.file }).then(reply => {
      if (!live || !reply) return;
      if (reply.type === 'recognised') setRecognised({ of: source, value: reply.recognised });
      else {
        setSource(null);
        setEncodeError(UNREADABLE);
      }
    });
    return () => {
      live = false;
    };
  }, [source, describer]);

  const known = recognised && recognised.of === source ? recognised.value : null;
  const described = useMemo(
    () => (known && source ? describe(known, { fileName: source.name }) : null),
    [known, source],
  );
  const dataType = typeText ?? described?.dataUriType ?? BINARY;
  const typeValid = form !== 'dataUri' || isMimeType(dataType);
  const options: EncodeOptions = useMemo(
    () => ({ form, alphabet, padding, lineLength, type: dataType }),
    [form, alphabet, padding, lineLength, dataType],
  );
  const length = source && described ? encodedLength(source.file.size, options) : 0;
  const copyable = length <= COPY_MAX_CHARS;
  const outputKey = source && described && typeValid ? JSON.stringify(options) : null;

  useEffect(() => {
    if (!source || !outputKey) return setOutput(null);
    let live = true;
    void encoder.run({ type: copyable ? 'encode-text' : 'preview', file: source.file, options }).then(reply => {
      if (!live || !reply) return;
      if (reply.type === 'text') setOutput({ key: outputKey, text: reply.text, whole: copyable });
      else setEncodeError(UNREADABLE);
    });
    return () => {
      live = false;
    };
    // `options` is `outputKey`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source, outputKey, copyable, encoder]);

  const current = output && output.key === outputKey ? output : null;
  const shown = current
    ? current.whole && length > SHOW_WHOLE_CHARS
      ? current.text.slice(0, SHOWN_CHARS)
      : current.text
    : '';
  const copyText = current?.whole ? current.text : '';

  const encodeDraft = (action?: Action): HistoryDraft | null =>
    source && known && described
      ? draftOf(source.file, known.type, described.type, {
          mode: 'encode',
          mime: form === 'dataUri' ? dataType : described.type.mime,
          form,
          alphabet,
          padding,
          lineLength,
          ...(action ? { action } : {}),
        })
      : null;

  // The choice is committed once its type is known; an edit of the options is a snapshot.
  useEffect(() => {
    if (!known || !source || chose.current !== source) return;
    chose.current = null;
    commit(encodeDraft('chose'));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [known, source]);
  useEffect(() => {
    if (!optionsEdited.current) return;
    const draft = encodeDraft();
    if (draft) recorder.change(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [form, alphabet, padding, lineLength, dataType, recorder]);

  const editOption = (apply: () => void): void => {
    optionsEdited.current = true;
    edited.current = true;
    setRestored(null);
    apply();
  };

  const save = (): void => {
    if (!source || !outputKey) return;
    const fileName = textFileName(source.name);
    commit(encodeDraft('save'));
    if (current?.whole) return saveBlob(new Blob([current.text]), fileName);
    setSaving({ done: 0, total: source.file.size });
    void saver
      .run({ type: 'encode-blob', file: source.file, options }, (done, total) => setSaving({ done, total }))
      .then(reply => {
        setSaving(null);
        if (!reply) return;
        if (reply.type === 'blob') saveBlob(reply.blob, fileName);
        else setEncodeError(UNREADABLE);
      });
  };

  // ---- Decode
  const settled = useSettled(text);
  useEffect(() => {
    let live = true;
    const source = held?.blob ?? (settled.length > LIVE_CHARS ? settled : null);
    if (source === null) {
      setOutcome(settled.trim() === '' ? { state: 'empty' } : decodeOnPage(settled));
      return;
    }
    setOutcome({ state: 'working', progress: null });
    void decoder
      .run(
        { type: 'decode', source },
        (done, total) => live && setOutcome({ state: 'working', progress: { done, total } }),
      )
      .then(reply => {
        if (!live || !reply) return;
        if (reply.type === 'decoded')
          setOutcome(reply.decoded.size ? { state: 'done', decoded: reply.decoded } : { state: 'empty' });
        else if (reply.type === 'invalid') setOutcome({ state: 'invalid', error: reply.error });
        else setOutcome({ state: 'invalid', error: { message: UNREADABLE } });
      });
    return () => {
      live = false;
    };
  }, [settled, held, decoder]);

  const decoded = outcome.state === 'done' ? outcome.decoded : null;
  const decodedDescribed = useMemo(
    () => (decoded ? describe(decoded.recognised, { declaredMime: decoded.header?.declaredMime ?? null }) : null),
    [decoded],
  );
  const suggested =
    decoded && decodedDescribed
      ? suggestName(decoded.header?.name ?? pemBase(decoded.header?.pemLabel ?? null), decodedDescribed.type)
      : '';
  useEffect(() => {
    setName(null);
    setShownText(null);
  }, [decoded]);
  const fileName = name ?? suggested;

  const decodeDraft = (action?: Action): HistoryDraft | null =>
    decoded && decodedDescribed
      ? draftOf(decoded.blob, decoded.recognised.type, decodedDescribed.type, {
          mode: 'decode',
          mime: decodedDescribed.type.mime,
          ...(decoded.header ? { shape: decoded.header.shape } : {}),
          ...(decoded.header?.declaredMime ? { declaredMime: decoded.header.declaredMime } : {}),
          ...(decoded.header?.pemLabel ? { pemLabel: decoded.header.pemLabel } : {}),
          ...(action ? { action } : {}),
        })
      : null;
  useEffect(() => {
    if (!edited.current || !decoded) return;
    const draft = decodeDraft();
    if (draft) recorder.change(draft);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decoded, recorder]);

  const editText = (next: string): void => {
    edited.current = true;
    setRestored(null);
    setDecodeError(null);
    setHeld(null);
    setText(next);
  };
  const holdText = (pasted: string): void => {
    edited.current = true;
    setRestored(null);
    setDecodeError(null);
    setText('');
    setHeld({ blob: new Blob([pasted]), note: pastedNote(pasted.length) });
  };

  const takeTextFile = (file: File): void => {
    edited.current = true;
    setRestored(null);
    if (file.size > MAX_TEXT_BYTES) {
      setDecodeError(textFileTooLarge(file.size));
      return;
    }
    void file
      .slice(0, HEAD_BYTES)
      .arrayBuffer()
      .then(
        buffer => {
          if (file.size > 0 && textEncodingOf(new Uint8Array(buffer), file.size) === null) {
            // §3: a file that is not text is a file to encode.
            setSeveral(false);
            takeFile(file, file.name, true);
            setEncodeError(null);
            setRestored(NOT_TEXT_FILE);
            return;
          }
          setDecodeError(null);
          setText('');
          setHeld({ blob: file, note: textFileNote(cleanFileName(file.name), file.size) });
        },
        () => setDecodeError(UNREADABLE),
      );
  };

  const showText = (): void => {
    if (!decoded) return;
    const encoding = decoded.recognised.encoding ?? 'utf-8';
    void decoded.blob
      .slice(0, SHOW_TEXT_BYTES)
      .arrayBuffer()
      .then(buffer => {
        const value = new TextDecoder(encoding).decode(buffer);
        setShownText({
          of: decoded,
          text: value,
          note: decoded.size > SHOW_TEXT_BYTES ? textShownNote(SHOW_TEXT_BYTES, decoded.size) : null,
        });
      });
  };

  // ---- A paste anywhere on the tool's page (§5.8)
  const latestMode = useRef(mode);
  latestMode.current = mode;
  const latestHold = useRef(holdText);
  latestHold.current = holdText;
  const visitSaved = saved.visit;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as Node | null;
      const ours =
        !target || target === document.body || target === document.documentElement || root.current?.contains(target);
      if (!ours || !event.clipboardData) return;
      const files = Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file')
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (files.length) {
        event.preventDefault();
        latestTake.current(files);
        return;
      }
      if (latestMode.current !== 'encode' || isEditable(event.target)) return;
      const pasted = event.clipboardData.getData('text/plain');
      if (!pasted.trim()) return;
      event.preventDefault();
      // The pasted text chose Decode for this visit: what is saved stays.
      visitSaved({ mode: 'decode' });
      if (pasted.length > FIELD_MAX_CHARS) latestHold.current(pasted);
      else {
        edited.current = true;
        setRestored(null);
        setHeld(null);
        setText(pasted);
      }
    };
    document.addEventListener('paste', onPaste);
    return () => document.removeEventListener('paste', onPaste);
  }, [visitSaved]);

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
    edited.current = false;
    optionsEdited.current = false;
    setSeveral(false);
    const label = `Opened from History: ${opened.label ?? 'an entry'}.`;
    // The entry's direction, and an Encode entry's output options, for this visit; what is saved stays as it was. A
    // Decode entry carries no output options: Encode's stay as saved.
    if (entry.mode === 'encode') {
      saved.visit({
        form: entry.form,
        alphabet: entry.alphabet,
        padding: entry.padding,
        lineLength: entry.lineLength,
      });
      takeFile(entry.file, null, false);
      setTypeText(entry.dataType);
      setRestored(label);
      return;
    }
    void entry.file.arrayBuffer().then(buffer => {
      const restoredText = inputOf(new Uint8Array(buffer), entry.shape, entry.declaredMime, entry.pemLabel);
      saved.visit({ mode: 'decode' });
      setDecodeError(null);
      if (restoredText.length > FIELD_MAX_CHARS) {
        setText('');
        setHeld({ blob: new Blob([restoredText]), note: pastedNote(restoredText.length) });
      } else {
        setHeld(null);
        setText(restoredText);
      }
      setRestored(label);
    });
  });

  const clear = (): void => {
    edited.current = true;
    setRestored(null);
    if (mode === 'encode') {
      encoder.cancel();
      saver.cancel();
      setSaving(null);
      setSource(null);
      setEncodeError(null);
      setSeveral(false);
      setTypeText(null);
    } else {
      decoder.cancel();
      setText('');
      setHeld(null);
      setDecodeError(null);
    }
  };

  // ---- What is said about keeping (§11)
  const encodeKeeping = source && known ? keepingNote(keepingOf(known.type, source.file.size), status) : null;
  const decodeKeeping = decoded ? keepingNote(keepingOf(decoded.recognised.type, decoded.size), status) : null;

  const encodeFacts: Array<[string, string]> =
    source && described
      ? [
          ...(source.name !== null ? ([['File', source.name]] as Array<[string, string]>) : []),
          ['Type', `${described.type.name} (${described.type.mime})`],
          ['Size', formatSize(source.file.size)],
          ['Base64 length', typeValid ? `${formatCount(length)} characters` : '—'],
        ]
      : [];
  const decodeFacts: Array<[string, string]> =
    decoded && decodedDescribed
      ? [
          ['Type', `${decodedDescribed.type.name} (${decodedDescribed.type.mime})`],
          ['Size', formatSize(decoded.size)],
          ...(decoded.header?.declaredMime
            ? ([['Declared type', decoded.header.declaredMime]] as Array<[string, string]>)
            : []),
        ]
      : [];
  const inputError = decodeError ?? (outcome.state === 'invalid' ? errorText(outcome.error) : null);

  return (
    <div ref={root} className="flex flex-col gap-3" data-mode={mode}>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={mode}
          onValueChange={value => {
            if ((value === 'encode' || value === 'decode') && value !== mode) {
              edited.current = true;
              setRestored(null);
              saved.set({ mode: value });
            }
          }}>
          <ToggleGroupItem value="encode">Encode</ToggleGroupItem>
          <ToggleGroupItem value="decode">Decode</ToggleGroupItem>
        </ToggleGroup>
        {mode === 'encode' && (
          <>
            <Label htmlFor="base64-file-output" className="ml-2 text-muted-foreground">
              Output
            </Label>
            <Select
              value={form}
              onValueChange={value => {
                if (value === 'base64' || value === 'dataUri') editOption(() => saved.set({ form: value }));
              }}>
              <SelectTrigger id="base64-file-output" className="min-w-28">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="base64">Base64</SelectItem>
                <SelectItem value="dataUri">Data URI</SelectItem>
              </SelectContent>
            </Select>
            {form === 'base64' ? (
              <>
                <Label htmlFor="base64-file-alphabet" className="ml-2 text-muted-foreground">
                  Alphabet
                </Label>
                <Select
                  value={alphabet}
                  onValueChange={value => {
                    if (value !== 'standard' && value !== 'url') return;
                    // The alphabet's own padding comes with it: both are saved.
                    editOption(() => saved.set({ alphabet: value, padding: defaultPadding(value) }));
                  }}>
                  <SelectTrigger id="base64-file-alphabet" className="min-w-28">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="standard">Standard</SelectItem>
                    <SelectItem value="url">URL-safe</SelectItem>
                  </SelectContent>
                </Select>
                <div className="ml-2 flex items-center gap-2">
                  <Checkbox
                    id="base64-file-padding"
                    checked={padding}
                    onCheckedChange={checked => editOption(() => saved.set({ padding: checked === true }))}
                  />
                  <Label htmlFor="base64-file-padding" className="font-normal">
                    Padding
                  </Label>
                </div>
                <Label htmlFor="base64-file-line-length" className="ml-2 text-muted-foreground">
                  Line length
                </Label>
                <Select
                  value={String(lineLength)}
                  onValueChange={value => {
                    const next = Number(value);
                    if (next === 0 || next === 64 || next === 76) editOption(() => saved.set({ lineLength: next }));
                  }}>
                  <SelectTrigger id="base64-file-line-length" className="min-w-28">
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
              <>
                <Label htmlFor="base64-file-type" className="ml-2 text-muted-foreground">
                  Type
                </Label>
                <Input
                  id="base64-file-type"
                  className="w-72 font-mono text-code"
                  spellCheck={false}
                  autoComplete="off"
                  value={dataType}
                  aria-invalid={!typeValid}
                  onChange={event => {
                    const next = event.target.value;
                    editOption(() => setTypeText(next));
                  }}
                />
              </>
            )}
          </>
        )}
        <Button variant="outline" className="ml-auto" onClick={clear}>
          Clear
        </Button>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      {mode === 'encode' ? (
        <ToolPanes>
          <ToolPane label="File">
            <div
              className="flex grow flex-col"
              onDragEnter={event => {
                if (!Array.from(event.dataTransfer?.types ?? []).includes('Files')) return;
                dragDepth.current++;
                setDragging(true);
              }}
              onDragLeave={() => {
                dragDepth.current = Math.max(0, dragDepth.current - 1);
                if (dragDepth.current === 0) setDragging(false);
              }}
              onDrop={() => {
                dragDepth.current = 0;
                setDragging(false);
              }}>
              <FileDrop
                className="grow"
                label={dragging ? 'Drop the file here' : 'Drop a file here, paste it, or'}
                choose="Choose file"
                multiple
                onFiles={files => latestTake.current(files)}>
                <p className="m-0 text-xs text-muted-foreground">Any file, up to 2 GiB</p>
                {source && described && (
                  <div className="flex w-full flex-col gap-3 text-left" data-encoded>
                    <Facts rows={encodeFacts} label="File facts" />
                  </div>
                )}
              </FileDrop>
            </div>
            {source && !described && (
              <p className="m-0 text-sm text-muted-foreground" role="status">
                Reading…
              </p>
            )}
            {encodeError && (
              <ToolMessage tone="error" data-part="error">
                {encodeError}
              </ToolMessage>
            )}
            {form === 'dataUri' && !typeValid && (
              <ToolMessage tone="error" role="status" data-part="type-error">
                {TYPE_MESSAGE}
              </ToolMessage>
            )}
            <div className="flex flex-col" role="status" data-part="notes">
              {several && <ToolMessage role={undefined}>{ONLY_FIRST}</ToolMessage>}
              {described?.notes.map(note => (
                <ToolMessage key={note} role={undefined}>
                  {note}
                </ToolMessage>
              ))}
              {encodeKeeping && (
                <ToolMessage role={undefined} data-part="keeping">
                  {encodeKeeping}
                </ToolMessage>
              )}
            </div>
          </ToolPane>
          <ToolPane
            label="Result"
            htmlFor="base64-file-result"
            actions={
              <>
                <CopyButton
                  value={copyText}
                  size="sm"
                  disabled={!current?.whole || copyText === ''}
                  onCopied={() => commit(encodeDraft('copy'))}
                />
                <Button variant="ghost" size="sm" disabled={!current || saving !== null} onClick={save}>
                  Save
                </Button>
              </>
            }>
            <Textarea id="base64-file-result" className={CODE} spellCheck={false} readOnly value={shown} />
            <ToolMessage data-part="truncated">
              {current && length > SHOW_WHOLE_CHARS ? shownNote(length, copyable) : ' '}
            </ToolMessage>
            {saving && (
              <Working
                verb="Encoding"
                progress={saving}
                onCancel={() => {
                  saver.cancel();
                  setSaving(null);
                }}
              />
            )}
          </ToolPane>
        </ToolPanes>
      ) : (
        <ToolPanes>
          <ToolPane label="Base64 or data URI" htmlFor="base64-file-input">
            {held ? (
              <div className="flex flex-col gap-2" data-part="held">
                <p className="m-0 text-sm" data-held>
                  {held.note}
                </p>
              </div>
            ) : (
              <Textarea
                id="base64-file-input"
                className={CODE}
                spellCheck={false}
                placeholder="JVBERi0xLjcK… or data:application/pdf;base64,…"
                value={text}
                onPaste={event => {
                  const pasted = event.clipboardData.getData('text/plain');
                  const field = event.currentTarget;
                  const after = text.length - (field.selectionEnd - field.selectionStart) + pasted.length;
                  if (after <= FIELD_MAX_CHARS) return;
                  // §3: a paste over the field's limit never reaches it; it is kept as a Blob and decoded in the worker.
                  event.preventDefault();
                  holdText(pasted);
                }}
                onDragOver={event => {
                  if (Array.from(event.dataTransfer.types).includes('Files')) event.preventDefault();
                }}
                onDrop={event => {
                  const file = event.dataTransfer.files[0];
                  if (!file) return;
                  event.preventDefault();
                  takeTextFile(file);
                }}
                onChange={event => editText(event.target.value)}
              />
            )}
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={() => textFileInput.current?.click()}>
                Open text file
              </Button>
              <input
                ref={textFileInput}
                type="file"
                hidden
                aria-hidden="true"
                tabIndex={-1}
                onChange={event => {
                  const file = event.target.files?.[0];
                  event.target.value = '';
                  if (file) takeTextFile(file);
                }}
              />
            </div>
            {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
            <ToolMessage tone="error" role="status" data-part="error">
              {inputError ?? ' '}
            </ToolMessage>
          </ToolPane>
          <ToolPane label="File">
            {outcome.state === 'working' && (
              <Working
                verb="Decoding"
                progress={outcome.progress}
                onCancel={() => {
                  decoder.cancel();
                  setOutcome({ state: 'empty' });
                }}
              />
            )}
            {decoded && decodedDescribed && (
              <div className="flex flex-col gap-3" data-decoded>
                <Facts rows={decodeFacts} label="Decoded file facts" />
              </div>
            )}
            <div className="flex flex-col" role="status" data-part="notes">
              {decodedDescribed?.notes.map(note => (
                <ToolMessage key={note} role={undefined}>
                  {note}
                </ToolMessage>
              ))}
              {decodedDescribed?.type.text && (
                <ToolMessage role={undefined} data-part="is-text">
                  {IS_TEXT}
                </ToolMessage>
              )}
              {decodeKeeping && (
                <ToolMessage role={undefined} data-part="keeping">
                  {decodeKeeping}
                </ToolMessage>
              )}
            </div>
            <div className="flex flex-col gap-1">
              <Label htmlFor="base64-file-name">File name</Label>
              <Input
                id="base64-file-name"
                className="font-mono text-code"
                spellCheck={false}
                autoComplete="off"
                disabled={!decoded}
                value={fileName}
                onChange={event => setName(event.target.value)}
              />
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!decoded}
                onClick={() => {
                  if (!decoded) return;
                  commit(decodeDraft('save'));
                  saveBlob(decoded.blob, cleanFileName(fileName));
                }}>
                Save file
              </Button>
              {decodedDescribed?.type.text && (
                <Button variant="outline" onClick={showText}>
                  Show text
                </Button>
              )}
            </div>
            {shownText && shownText.of === decoded && (
              <div className="flex flex-col gap-1" data-part="text">
                <Label htmlFor="base64-file-text">Text</Label>
                <Textarea id="base64-file-text" className={CODE} spellCheck={false} readOnly value={shownText.text} />
                {shownText.note && <ToolMessage>{shownText.note}</ToolMessage>}
              </div>
            )}
          </ToolPane>
        </ToolPanes>
      )}
    </div>
  );
};

export default Base64FileTool;
