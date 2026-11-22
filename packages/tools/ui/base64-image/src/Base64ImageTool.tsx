/**
 * The Base64 Image tool's page (docs/tools/specs/base64-image.md §8). Encode: an image chosen, dropped or pasted is
 * recognised by its bytes and shown with its facts beside its Base64 in the chosen form (Data URI, Base64, HTML <img>,
 * CSS url()). Decode: a data URI or Base64 — also inside url(…) or an <img src> — is shown as the image it holds, with
 * its facts, a warning when the declared type is not the bytes' one, Save image, Copy data URI and Copy image. The host
 * wraps it in the kit's ToolPage; this is the body. Logic: @workspace/tool-logic-base64-image; the preview, saving and
 * copying under the extension's policy: image.ts; large inputs go to a worker (codec.ts).
 *
 * A pasted image is caught anywhere on the tool's page: it does not reach a field, the page switches to Encode and
 * takes it. Pasted image data with nothing focused in Encode switches to Decode. A paste into Decode's field over the
 * input limit is stopped before it reaches the field.
 *
 * History (D17): choosing an image, Copy, Save, Save image, Copy data URI and Copy image are commits; a change of the
 * output form, or a person's edit of Decode's text that gives an image, is a snapshot; an image over 1 MiB is not kept
 * (entries.ts). An entry opens back into the direction it was made in, with its image.
 */
import { createCodec } from './codec';
import { FORM_LABELS, draftOf, readEntry } from './entries';
import { base64ImageHistory } from './history';
import { copyPng, pngOf, saveText, saveUrl, useObjectUrl } from './image';
import { Facts, Preview } from './parts';
import {
  ACTIVE_SVG_NOTE,
  INPUT_TOO_LARGE,
  LIVE_INPUT_CHARS,
  MAX_IMAGE_BYTES,
  MAX_INPUT_CHARS,
  SETTLE_MS,
  SHOWN_OUTPUT_CHARS,
  TRUNCATE_OUTPUT_ABOVE,
  declaredMismatch,
  decodeImageInput,
  detectBase64Image,
  fileTooLarge,
  formatOutput,
  previewRefusal,
  toDataUri,
  truncatedNote,
} from '@workspace/tool-logic-base64-image';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { FileDrop } from '@workspace/ui/file-drop';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Encoded } from './codec.worker';
import type { Action, Mode } from './entries';
import type {
  DecodeImageResult,
  DecodedImage,
  Dimensions,
  InputShape,
  LineLength,
  OutputForm,
} from '@workspace/tool-logic-base64-image';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** `accept` of the file chooser (§3): the MIME types of §5, and the extensions systems do not map to them. */
const ACCEPT = 'image/png,image/jpeg,image/gif,image/webp,image/avif,image/bmp,image/x-icon,image/svg+xml,.svg,.ico';
const FORMS: readonly OutputForm[] = ['dataUri', 'base64', 'img', 'css'];
const LINE_LENGTHS: ReadonlyArray<{ value: LineLength; label: string }> = [
  { value: 0, label: 'No wrapping' },
  { value: 64, label: '64' },
  { value: 76, label: '76' },
];
const ONLY_FIRST = 'Only the first file is used.';
const CODE = 'h-90 resize-y font-mono text-code field-sizing-fixed';

type EncodeState =
  | { state: 'empty' }
  | { state: 'reading'; name: string }
  | { state: 'done'; name: string | null; image: DecodedImage; base64: string }
  | { state: 'failed'; name: string; message: string };

type DecodeOutcome = { state: 'done'; result: DecodeImageResult } | { state: 'working' } | { state: 'too-large' };

/** The input the result follows: the live one when small, the one 300 ms after the last edit when large. */
const useSettled = (input: string): string => {
  const [settled, setSettled] = useState(input);
  const live = input.length <= LIVE_INPUT_CHARS || input.length > MAX_INPUT_CHARS;
  useEffect(() => {
    if (live) return setSettled(input);
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, live]);
  return live ? input : settled;
};

const isEditable = (target: EventTarget | null): boolean =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** Encode's Save: the output as a text file named after the image. */
const textFileName = (name: string | null): string => `${name ?? 'image'}.txt`;

/** The text an entry of Decode opens as: the same kind of input, rebuilt from the image. */
const inputOf = (image: Pick<DecodedImage, 'bytes' | 'type'>, declared: string | null, shape: InputShape): string => {
  const uri = toDataUri(image);
  const typed = declared ? uri.replace(image.type.mime, declared) : uri;
  if (shape === 'base64') return uri.slice(uri.indexOf(',') + 1);
  if (shape === 'css') return `url("${typed}")`;
  if (shape === 'img') return `<img src="${typed}" alt="">`;
  return typed;
};

type CopyState = { of: unknown; ok: boolean } | null;

const Base64ImageTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  // Text handed over from the start page was recognised as image data (detectBase64Image): it is there to be decoded.
  const [mode, setMode] = useState<Mode>(initial ? 'decode' : 'encode');
  const [form, setForm] = useState<OutputForm>('dataUri');
  const [lineLength, setLineLength] = useState<LineLength>(0);
  const [encoded, setEncoded] = useState<EncodeState>({ state: 'empty' });
  const [several, setSeveral] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [text, setText] = useState(initial ?? '');
  const [pasteRefused, setPasteRefused] = useState(false);
  const [outcome, setOutcome] = useState<DecodeOutcome>({ state: 'done', result: { ok: true, image: null } });
  const [decodedSize, setDecodedSize] = useState<{ of: unknown; size: Dimensions | null } | null>(null);
  const [copied, setCopied] = useState<CopyState>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'base64-image', base64ImageHistory);
  const root = useRef<HTMLDivElement>(null);
  const shown = useRef<HTMLImageElement | null>(null);
  const encoder = useMemo(() => createCodec(), []);
  const decoder = useMemo(() => createCodec(), []);
  useEffect(
    () => () => {
      encoder.dispose();
      decoder.dispose();
    },
    [encoder, decoder],
  );
  /** A person changed something since the page opened or an entry was opened: only then is an edit recorded. */
  const edited = useRef(Boolean(initial));
  const reads = useRef(0);
  const dragDepth = useRef(0);

  const commit = (draft: HistoryDraft | null): void => {
    if (draft) void recorder.commit(draft);
  };

  // ---- Encode
  const takeImage = (bytes: Uint8Array, name: string | null, record: boolean): void => {
    const serial = ++reads.current;
    setEncoded({ state: 'reading', name: name ?? '' });
    void encoder.encode(bytes).then(
      (result: Encoded | null) => {
        if (!result || serial !== reads.current) return;
        if (!result.ok) return setEncoded({ state: 'failed', name: name ?? '', message: result.message });
        setEncoded({ state: 'done', name, image: result.image, base64: result.base64 });
        if (record) commit(draftOf('encode', result.image, { form, lineLength, action: 'chose' }));
      },
      () =>
        serial === reads.current &&
        setEncoded({ state: 'failed', name: name ?? '', message: 'This file could not be read.' }),
    );
  };

  const takeFiles = (files: File[]): void => {
    const file = files[0];
    if (!file) return;
    edited.current = true;
    setRestored(null);
    setMode('encode');
    setSeveral(files.length > 1);
    // §6: refused by its size before it is read.
    if (file.size > MAX_IMAGE_BYTES) {
      ++reads.current;
      setEncoded({ state: 'failed', name: file.name, message: fileTooLarge(file.size) });
      return;
    }
    const serial = ++reads.current;
    setEncoded({ state: 'reading', name: file.name });
    file.arrayBuffer().then(
      buffer => serial === reads.current && takeImage(new Uint8Array(buffer), file.name, true),
      () =>
        serial === reads.current &&
        setEncoded({ state: 'failed', name: file.name, message: 'This file could not be read.' }),
    );
  };
  const latestTake = useRef(takeFiles);
  latestTake.current = takeFiles;

  const encodedImage = encoded.state === 'done' ? encoded.image : null;
  const output = useMemo(
    () => (encoded.state === 'done' ? formatOutput(encoded.base64, encoded.image, form, lineLength) : ''),
    [encoded, form, lineLength],
  );
  const cut = output.length > TRUNCATE_OUTPUT_ABOVE;

  // ---- Decode
  const settled = useSettled(text);
  useEffect(() => {
    if (settled.length > MAX_INPUT_CHARS) return setOutcome({ state: 'too-large' });
    if (settled.length <= LIVE_INPUT_CHARS) return setOutcome({ state: 'done', result: decodeImageInput(settled) });
    let live = true;
    setOutcome({ state: 'working' });
    decoder.decode(settled).then(
      result => live && result && setOutcome({ state: 'done', result }),
      (error: unknown) =>
        live &&
        setOutcome({
          state: 'done',
          result: { ok: false, error: { message: error instanceof Error ? error.message : String(error) } },
        }),
    );
    return () => {
      live = false;
    };
  }, [settled, decoder]);
  const decoded = outcome.state === 'done' && outcome.result.ok ? outcome.result.image : null;
  const shape = outcome.state === 'done' && outcome.result.ok ? (outcome.result.shape ?? 'base64') : 'base64';
  const decodeError =
    pasteRefused || outcome.state === 'too-large'
      ? INPUT_TOO_LARGE
      : outcome.state === 'done' && !outcome.result.ok
        ? outcome.result.error.line !== undefined
          ? `Line ${outcome.result.error.line}, column ${outcome.result.error.column}: ${outcome.result.error.message}`
          : outcome.result.error.message
        : null;

  // ---- The current image, its URL (one, revoked on change, Clear, the other mode and leaving) and its size
  const current = mode === 'encode' ? encodedImage : decoded;
  const url = useObjectUrl(current);
  const decodedDimensions = decodedSize && decodedSize.of === current ? decodedSize.size : null;
  // AVIF without a size in its header: the decoded one (§5); an SVG without one stays unknown (Chrome would say 300 × 150).
  const dimensions = current
    ? (current.dimensions ?? (current.type.mime === 'image/avif' ? decodedDimensions : null))
    : null;
  const refusal = current ? previewRefusal(current.dimensions) : null;

  // ---- History
  const take = (action: Action): void =>
    mode === 'encode'
      ? commit(draftOf('encode', encodedImage, { form, lineLength, action }))
      : commit(draftOf('decode', decoded, { shape, action }));
  // An edit is recorded by the factory's checkpoint rule once its result is there; opening an entry is not an edit.
  useEffect(() => {
    if (!edited.current || mode !== 'decode' || !decoded) return;
    const draft = draftOf('decode', decoded, { shape });
    if (draft) recorder.change(draft);
  }, [decoded, shape, mode, recorder]);
  const formEdited = useRef(false);
  useEffect(() => {
    if (!formEdited.current || !encodedImage) return;
    const draft = draftOf('encode', encodedImage, { form, lineLength });
    if (draft) recorder.change(draft);
  }, [form, lineLength, encodedImage, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  // ---- A paste anywhere on the tool's page (§5 «Вставка из буфера обмена»)
  const latestMode = useRef(mode);
  latestMode.current = mode;
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const target = event.target as Node | null;
      const ours =
        !target || target === document.body || target === document.documentElement || root.current?.contains(target);
      if (!ours || !event.clipboardData) return;
      const images = Array.from(event.clipboardData.items)
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter((file): file is File => file !== null);
      if (images.length) {
        event.preventDefault();
        latestTake.current(images);
        return;
      }
      if (latestMode.current !== 'encode' || isEditable(event.target)) return;
      const pasted = event.clipboardData.getData('text/plain');
      if (!detectBase64Image(pasted)) return;
      event.preventDefault();
      edited.current = true;
      setRestored(null);
      setPasteRefused(false);
      setText(pasted);
      setMode('decode');
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
    void entry.image.arrayBuffer().then(buffer => {
      const bytes = new Uint8Array(buffer);
      edited.current = false;
      formEdited.current = false;
      setForm(entry.form);
      setLineLength(entry.lineLength);
      setSeveral(false);
      setMode(entry.mode);
      if (entry.mode === 'encode') takeImage(bytes, null, false);
      else {
        setPasteRefused(false);
        setText(inputOf({ bytes, type: entry.type }, entry.declaredMime, entry.shape));
      }
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const clear = (): void => {
    edit(() => {
      if (mode === 'encode') {
        ++reads.current;
        setEncoded({ state: 'empty' });
        setSeveral(false);
      } else {
        setText('');
        setPasteRefused(false);
      }
    });
  };

  const copyImage = (image: DecodedImage): void => {
    const png = pngOf(image, shown.current);
    copyPng(png).then(
      () => {
        setCopied({ of: image, ok: true });
        take('copy-image');
      },
      () => setCopied({ of: image, ok: false }),
    );
  };
  const copyState = copied && copied.of === current ? copied : null;

  const notes = (image: DecodedImage): string[] =>
    [mode === 'decode' ? declaredMismatch(image) : null, image.svgActiveContent ? ACTIVE_SVG_NOTE : null].filter(
      (n): n is string => n !== null,
    );

  const preview = (image: DecodedImage, alt: string): ReactElement => (
    <Preview
      key={url ?? 'none'}
      url={url}
      image={image}
      alt={alt}
      refusal={refusal}
      shown={shown}
      onDecoded={size => setDecodedSize({ of: image, size })}
    />
  );

  return (
    <div ref={root} className="flex flex-col gap-3" data-mode={mode}>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Direction"
          value={mode}
          onValueChange={value => {
            if ((value === 'encode' || value === 'decode') && value !== mode) edit(() => setMode(value));
          }}>
          <ToggleGroupItem value="encode">Encode</ToggleGroupItem>
          <ToggleGroupItem value="decode">Decode</ToggleGroupItem>
        </ToggleGroup>
        {mode === 'encode' && (
          <>
            <Label htmlFor="base64-image-output" className="ml-2 text-muted-foreground">
              Output
            </Label>
            <Select
              value={form}
              onValueChange={value => {
                if (!FORMS.includes(value as OutputForm)) return;
                formEdited.current = true;
                edit(() => setForm(value as OutputForm));
              }}>
              <SelectTrigger id="base64-image-output" className="min-w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FORMS.map(f => (
                  <SelectItem key={f} value={f}>
                    {FORM_LABELS[f]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {form === 'base64' && (
              <>
                <Label htmlFor="base64-image-line-length" className="ml-2 text-muted-foreground">
                  Line length
                </Label>
                <Select
                  value={String(lineLength)}
                  onValueChange={value => {
                    const next = Number(value);
                    if (next !== 0 && next !== 64 && next !== 76) return;
                    formEdited.current = true;
                    edit(() => setLineLength(next));
                  }}>
                  <SelectTrigger id="base64-image-line-length" className="min-w-32">
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
          <ToolPane label="Image">
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
                label={dragging ? 'Drop the image here' : 'Drop an image here, paste it, or'}
                choose="Choose image"
                accept={ACCEPT}
                multiple
                onFiles={files => latestTake.current(files)}>
                <p className="m-0 text-xs text-muted-foreground">
                  PNG, JPEG, GIF, WebP, AVIF, BMP, ICO or SVG, up to 10 MiB
                </p>
                {encoded.state === 'done' && (
                  <div className="flex w-full flex-col gap-3 text-left" data-encoded>
                    {preview(encoded.image, `Preview of ${encoded.name ?? 'the image'}`)}
                    <Facts image={encoded.image} dimensions={dimensions} file={encoded.name} />
                  </div>
                )}
              </FileDrop>
            </div>
            {encoded.state === 'reading' && (
              <p className="m-0 text-sm text-muted-foreground" role="status">
                Reading…
              </p>
            )}
            {encoded.state === 'failed' && (
              <ToolMessage tone="error" data-part="error">
                {encoded.message}
              </ToolMessage>
            )}
            <div className="flex flex-col" role="status" data-part="notes">
              {several && <ToolMessage role={undefined}>{ONLY_FIRST}</ToolMessage>}
              {encodedImage &&
                notes(encodedImage).map(note => (
                  <ToolMessage key={note} role={undefined}>
                    {note}
                  </ToolMessage>
                ))}
            </div>
          </ToolPane>
          <ToolPane
            label="Result"
            htmlFor="base64-image-result"
            actions={
              <>
                <CopyButton value={output} size="sm" onCopied={() => take('copy')} />
                <Button
                  variant="ghost"
                  size="sm"
                  disabled={output === ''}
                  onClick={() => {
                    saveText(output, textFileName(encoded.state === 'done' ? encoded.name : null));
                    take('save');
                  }}>
                  Save
                </Button>
              </>
            }>
            <Textarea
              id="base64-image-result"
              className={CODE}
              spellCheck={false}
              readOnly
              value={cut ? output.slice(0, SHOWN_OUTPUT_CHARS) : output}
            />
            <ToolMessage data-part="truncated">{cut ? truncatedNote(output.length) : ' '}</ToolMessage>
          </ToolPane>
        </ToolPanes>
      ) : (
        <ToolPanes>
          <ToolPane label="Base64 or data URI" htmlFor="base64-image-input">
            <Textarea
              id="base64-image-input"
              className={CODE}
              spellCheck={false}
              placeholder="data:image/png;base64,iVBORw0KGgo…"
              value={text}
              onPaste={event => {
                const pasted = event.clipboardData.getData('text/plain');
                const field = event.currentTarget;
                const after = text.length - (field.selectionEnd - field.selectionStart) + pasted.length;
                if (after <= MAX_INPUT_CHARS) return;
                // §6: a paste over the limit never reaches the field.
                event.preventDefault();
                setPasteRefused(true);
              }}
              onChange={event => {
                const next = event.target.value;
                edit(() => {
                  setPasteRefused(false);
                  setText(next);
                });
              }}
            />
            {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
            <ToolMessage tone="error" role="status" data-part="error">
              {decodeError ?? ' '}
            </ToolMessage>
          </ToolPane>
          <ToolPane label="Image">
            {outcome.state === 'working' && (
              <p className="m-0 text-sm text-muted-foreground" role="status">
                Decoding…
              </p>
            )}
            {decoded && (
              <div className="flex flex-col gap-3" data-decoded>
                {preview(decoded, 'Preview of the decoded image')}
                <Facts image={decoded} dimensions={dimensions} />
              </div>
            )}
            <div className="flex flex-col" role="status" data-part="notes">
              {decoded &&
                notes(decoded).map(note => (
                  <ToolMessage key={note} role={undefined}>
                    {note}
                  </ToolMessage>
                ))}
              {copyState && !copyState.ok && (
                <ToolMessage role={undefined}>Not copied: the browser did not allow it.</ToolMessage>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                variant="outline"
                disabled={!decoded || !url}
                onClick={() => {
                  if (!decoded || !url) return;
                  saveUrl(url, `image.${decoded.type.ext}`);
                  take('save-image');
                }}>
                Save image
              </Button>
              <CopyButton
                variant="outline"
                size="default"
                label="Copy data URI"
                value={() => (decoded ? toDataUri(decoded) : '')}
                resetKey={decoded}
                disabled={!decoded}
                onCopied={() => take('copy-data-uri')}
              />
              <Button
                variant="outline"
                disabled={!decoded || refusal !== null}
                onClick={() => decoded && copyImage(decoded)}>
                {copyState ? (copyState.ok ? 'Copied' : 'Not copied') : 'Copy image'}
              </Button>
            </div>
          </ToolPane>
        </ToolPanes>
      )}
    </div>
  );
};

export default Base64ImageTool;
