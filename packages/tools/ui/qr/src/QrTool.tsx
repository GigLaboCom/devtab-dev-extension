/**
 * The QR Code tool's page (docs/tools/specs/qr.md §8): Generate — text or Wi-Fi details become a code on the page, saved
 * as SVG or PNG and copied as an image or as text — and Read — an image dropped, pasted or chosen is searched for codes.
 * The host wraps it in the kit's ToolPage; this is the body. Logic: @workspace/tool-logic-qr; the encoder loads the
 * first time there is a text to encode (maker.ts), the reader only in its worker on the first image (reader.ts).
 *
 * A pasted image is caught anywhere on the tool's page, in both halves: the paste does not reach a field, the page
 * switches to Read and reads it. A paste of text works as usual.
 *
 * History (D17): the kind follows the content (`secretContent` of the logic): Wi-Fi details and one-time password keys go
 * to the secret kinds — kept only encrypted, with a master password and the history unlocked. A person's edit of a code
 * that builds is a `change`; Copy image, Copy text, Download SVG and PNG are a `commit`; an image read is a `commit` of
 * the text read from it — the image itself is never kept.
 */
import { madeDraft, readDraft, readMade, readRead } from './entries';
import { qrHistory } from './history';
import { MakeView } from './MakeView';
import { fileProblem, PREVIEW_SIDE, READ_MESSAGES, readImage } from './reader';
import { ReadView } from './ReadView';
import {
  capacityCheck,
  DEFAULT_LEVEL,
  DEFAULT_MODULE_PX,
  DEFAULT_QUIET,
  EMPTY_WIFI,
  hexBytes,
  secretContent,
  wifiString,
} from '@workspace/tool-logic-qr';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions } from '@workspace/ui/tool-page';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { MadePayload, ReadPayload } from './entries';
import type * as MakerModule from './maker';
import type { ReadState } from './ReadView';
import type { BuildResult, Level, ModulePx, QuietZone, WifiDetails } from '@workspace/tool-logic-qr';
import type { RecordingStatus, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

type Half = 'generate' | 'read';
export type Content = 'text' | 'wifi';
type Maker = typeof MakerModule;

/** What the history does with secrets now, said under the Wi-Fi form and under a secret code read. */
export const keptLine = (status: RecordingStatus): string | null =>
  status.gate !== 'on'
    ? null
    : status.secrets === 'unlocked'
      ? 'Kept in this browser’s history, encrypted.'
      : status.secrets === 'locked'
        ? 'Not kept while the history is locked.'
        : 'Not kept: Wi-Fi details and one-time password keys need a master password (Settings → History).';

const isAbort = (error: unknown): boolean => error instanceof DOMException && error.name === 'AbortError';

const QrTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [half, setHalf] = useState<Half>('generate');
  const [content, setContent] = useState<Content>('text');
  const [text, setText] = useState(initial ?? '');
  const [wifi, setWifi] = useState<WifiDetails>(EMPTY_WIFI);
  const [level, setLevel] = useState<Level>(DEFAULT_LEVEL);
  const [quiet, setQuiet] = useState<QuietZone>(DEFAULT_QUIET);
  const [px, setPx] = useState<ModulePx>(DEFAULT_MODULE_PX);
  const [read, setRead] = useState<ReadState>({ state: 'empty' });
  const [reads, setReads] = useState(0);
  const [restored, setRestored] = useState<string | null>(null);
  const [maker, setMaker] = useState<Maker | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'qr', qrHistory);
  /** A person changed something since the page opened or an entry was opened: only then is an edit recorded. */
  const edited = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const preview = useRef<HTMLCanvasElement>(null);
  const reading = useRef<AbortController | null>(null);

  // What the code holds: the text as typed (no trimming, §3), or the Wi-Fi string once the network has a name.
  const encoded = content === 'text' ? text : wifi.ssid === '' ? '' : wifiString(wifi);

  // The encoder, on first need (§9: the making half loads separately).
  useEffect(() => {
    if (encoded === '' || maker) return;
    let live = true;
    void import('./maker').then(m => live && setMaker(m));
    return () => {
      live = false;
    };
  }, [encoded, maker]);

  const built: BuildResult | 'pending' = useMemo(() => {
    if (encoded === '') return { ok: false, empty: true };
    const check = capacityCheck(encoded, level);
    if (!check.fits) return { ok: false, message: check.message! };
    return maker ? maker.buildQr(encoded, level) : 'pending';
  }, [encoded, level, maker]);

  const payload = (): MadePayload =>
    content === 'wifi' ? { content, wifi, level, quiet, px } : { content, text, level, quiet, px };
  const draft = () => madeDraft(payload(), encoded, secretContent(encoded) !== null);
  const latestDraft = useRef(draft);
  latestDraft.current = draft;

  // An edit that makes a code is recorded by the factory's checkpoint rule.
  useEffect(() => {
    if (!edited.current || built === 'pending' || !built.ok) return;
    recorder.change(latestDraft.current());
  }, [built, quiet, px, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };
  const commitMade = (): void => {
    if (built !== 'pending' && built.ok) void recorder.commit(latestDraft.current());
  };

  // Reading an image: the worker's preview first, then the text.
  const drawPreview = useCallback((bitmap: ImageBitmap) => {
    const canvas = preview.current;
    const g = canvas?.getContext('2d');
    if (!canvas || !g) return bitmap.close();
    g.clearRect(0, 0, canvas.width, canvas.height);
    g.drawImage(bitmap, (canvas.width - bitmap.width) / 2, (canvas.height - bitmap.height) / 2);
    bitmap.close();
  }, []);
  const clearPreview = (): void => {
    const canvas = preview.current;
    canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
  };

  const readFile = (file: File): void => {
    edited.current = true;
    setRestored(null);
    setHalf('read');
    reading.current?.abort();
    clearPreview();
    // Every read that ends — found, not found or refused — counts once (`data-read-serial`: a test waits on it).
    const finish = (next: ReadState | ((r: ReadState) => ReadState)): void => {
      setRead(next);
      setReads(n => n + 1);
    };
    const problem = fileProblem(file);
    if (problem) {
      reading.current = null;
      finish({ state: 'failed', message: problem, preview: false });
      return;
    }
    const controller = new AbortController();
    reading.current = controller;
    setRead({ state: 'reading' });
    readImage(file, {
      signal: controller.signal,
      scale: Math.max(1, Math.min(3, globalThis.devicePixelRatio || 1)),
      onPreview: bitmap => {
        if (reading.current !== controller) return bitmap.close();
        setRead(r => (r.state === 'reading' ? { ...r, preview: true } : r));
        drawPreview(bitmap);
      },
    }).then(
      outcome => {
        if (reading.current !== controller) return;
        reading.current = null;
        if (!outcome.ok)
          return finish(r => ({
            state: 'failed',
            message: outcome.message,
            preview: r.state !== 'empty' && r.preview === true,
          }));
        const { result } = outcome;
        if (!result.ok)
          return finish({
            state: 'failed',
            message: result.located ? READ_MESSAGES.unreadable : READ_MESSAGES.notFound,
            preview: true,
          });
        const hex = result.bytes ? hexBytes(result.bytes) : null;
        finish({ state: 'done', text: result.text, count: result.count, hex, preview: true });
        const kept: ReadPayload = { text: result.text, count: result.count, ...(hex ? { hex } : {}) };
        void recorder.commit(readDraft(kept, secretContent(result.text) !== null));
      },
      error => {
        if (isAbort(error) || reading.current !== controller) return;
        reading.current = null;
        finish({ state: 'failed', message: READ_MESSAGES.open, preview: false });
      },
    );
  };
  const latestRead = useRef(readFile);
  latestRead.current = readFile;

  // A pasted image, anywhere on the tool's page (§5.6 step 2): from a field of the tool, or with nothing focused.
  useEffect(() => {
    const onPaste = (event: ClipboardEvent) => {
      const image = Array.from(event.clipboardData?.files ?? []).find(f => f.type.startsWith('image/'));
      if (!image) return;
      const target = event.target as Node | null;
      const ours =
        !target || target === document.body || target === document.documentElement || root.current?.contains(target);
      if (!ours) return;
      event.preventDefault();
      latestRead.current(image);
    };
    document.addEventListener('paste', onPaste);
    return () => {
      document.removeEventListener('paste', onPaste);
      reading.current?.abort();
    };
  }, []);

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
    edited.current = false;
    const label = opened.label ?? 'an entry';
    if (opened.entry.kind === 'read' || opened.entry.kind === 'read-secret') {
      const p = readRead(opened.payload);
      reading.current?.abort();
      reading.current = null;
      clearPreview();
      setHalf('read');
      setRead({ state: 'done', text: p.text, count: p.count, hex: p.hex ?? null, preview: false });
      setRestored(`Opened from History: ${label}. The image itself is not kept.`);
      return;
    }
    const p = readMade(opened.payload);
    setHalf('generate');
    setLevel(p.level);
    setQuiet(p.quiet);
    setPx(p.px);
    if (p.content === 'wifi') {
      setContent('wifi');
      setWifi(p.wifi);
    } else {
      setContent('text');
      setText(p.text);
    }
    setRestored(`Opened from History: ${label}.`);
  });

  const secretRead = read.state === 'done' && secretContent(read.text) !== null;

  return (
    <div ref={root} className="flex flex-col gap-3" data-half={half}>
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          size="sm"
          aria-label="Mode"
          value={half}
          onValueChange={value => value && setHalf(value as Half)}>
          <ToggleGroupItem value="generate">Generate</ToggleGroupItem>
          <ToggleGroupItem value="read">Read</ToggleGroupItem>
        </ToggleGroup>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      {half === 'generate' ? (
        <MakeView
          content={content}
          text={text}
          wifi={wifi}
          level={level}
          quiet={quiet}
          px={px}
          encoded={encoded}
          built={built}
          kept={content === 'wifi' || secretContent(encoded) ? keptLine(status) : null}
          onContent={next => edit(() => setContent(next))}
          onText={next => edit(() => setText(next))}
          onWifi={next => edit(() => setWifi(next))}
          onLevel={next => edit(() => setLevel(next))}
          onQuiet={next => edit(() => setQuiet(next))}
          onPx={next => edit(() => setPx(next))}
          onAction={commitMade}
        />
      ) : null}
      <ReadView
        hidden={half !== 'read'}
        read={read}
        serial={reads}
        preview={preview}
        previewSide={PREVIEW_SIDE}
        kept={secretRead ? keptLine(status) : null}
        onFile={readFile}
        onCopied={() => {
          if (read.state !== 'done') return;
          const kept: ReadPayload = { text: read.text, count: read.count, ...(read.hex ? { hex: read.hex } : {}) };
          void recorder.commit(readDraft(kept, secretContent(read.text) !== null));
        }}
      />
    </div>
  );
};

export default QrTool;
