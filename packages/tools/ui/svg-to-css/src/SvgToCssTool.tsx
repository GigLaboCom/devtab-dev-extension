/**
 * The SVG to CSS tool's page (docs/tools/specs/svg-to-css.md §8): options in one row (Output, Encoding, Minify, Open
 * file); the SVG on the left with its error under it (a link to the place when the parser named one); on the right the
 * CSS with Copy, the sizes of both encodings and the notes, and the preview (preview.tsx). The host wraps it in the
 * kit's ToolPage; this is the body. Logic: @workspace/tool-logic-svg-to-css, given the page's `DOMParser`.
 *
 * The result follows every edit up to 256 Ki characters, 300 ms after the last edit up to 4 Mi — checked on the page,
 * converted in a worker (converter.ts); above, the input is refused (§12). A result over 1 Mi characters is shown by
 * its first 64 Ki in the field (the field itself costs a quarter of a second at 4 Mi); Copy takes all of it. A file —
 * chosen, or dropped on the SVG field — is read as UTF-8 into the field, up to 4 MiB.
 *
 * History (D17): an edit that gives a result is a snapshot; Copy and Open file are commits; an SVG over 1 MiB is not
 * kept (entries.ts). An entry opens back with its SVG and options; the result is made again.
 */
import { createConverter } from './converter';
import { MAX_KEPT_BYTES, OUTPUTS, OUTPUT_LABELS, draftOf, readEntry } from './entries';
import { svgToCssHistory } from './history';
import { Preview, useObjectUrl } from './preview';
import {
  DEFAULT_OPTIONS,
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  SHOWN_RESULT_CHARS,
  SHOW_RESULT_CHARS,
  TOO_LARGE,
  checkSvg,
  describeNotes,
  formatSizes,
  shownNote,
  svgToCss,
} from '@workspace/tool-logic-svg-to-css';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Action } from './entries';
import type { Output, SvgOptions, SvgResult } from '@workspace/tool-logic-svg-to-css';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const ACCEPT = '.svg,image/svg+xml';
const PLACEHOLDER = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24">…</svg>';
const NOT_KEPT = 'This SVG is over 1 MiB: History does not keep it.';
const UNREADABLE = 'This file could not be read.';

interface Current {
  text: string;
  options: SvgOptions;
  result: SvgResult;
}

const parseXml = (text: string): Document => new DOMParser().parseFromString(text, 'image/svg+xml');

/** The input the result follows: the live one when small (or refused), the one 300 ms after the last edit when large. */
const useSettled = (input: string): string => {
  const [settled, setSettled] = useState(input);
  const live = input.length <= LIVE_INPUT || input.length > MAX_INPUT;
  useEffect(() => {
    if (live) return setSettled(input);
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, live]);
  return live ? input : settled;
};

/** The offset of a 1-based line and column in the field's text (lines split at `\n`). */
const offsetAt = (text: string, line: number, column: number): number => {
  let start = 0;
  for (let l = 1; l < line; l++) {
    const next = text.indexOf('\n', start);
    if (next < 0) break;
    start = next + 1;
  }
  const end = text.indexOf('\n', start);
  return Math.min(start + column - 1, end < 0 ? text.length : end);
};

const SvgToCssTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [options, setOptions] = useState<SvgOptions>(DEFAULT_OPTIONS);
  const [fileError, setFileError] = useState<string | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder, status } = useToolHistory(host, 'svg-to-css', svgToCssHistory);
  const field = useRef<HTMLTextAreaElement>(null);
  const picker = useRef<HTMLInputElement>(null);
  /** A person changed something since the page opened or an entry was opened: only then is a result recorded. */
  const edited = useRef(Boolean(initial));
  /** A commit the next result is for (a file was opened). */
  const pendingCommit = useRef<Action | null>(null);

  const settled = useSettled(input);
  const tooLarge = input.length > MAX_INPUT;
  const live = settled.length <= LIVE_INPUT;
  // Small: on the page at once. Large: the check on the page, the rest in the worker; the result names what it is of.
  const liveResult = useMemo(
    () => (live ? { text: settled, options, result: svgToCss(settled, options, parseXml) } : null),
    [live, settled, options],
  );
  const converter = useMemo(() => createConverter(), []);
  useEffect(() => () => converter.dispose(), [converter]);
  const largeError = useMemo(
    () => (live || settled.length > MAX_INPUT ? null : checkSvg(settled, parseXml)),
    [live, settled],
  );
  const [converted, setConverted] = useState<Current | null>(null);
  useEffect(() => {
    if (live || settled.length > MAX_INPUT) return;
    if (largeError) return setConverted({ text: settled, options, result: { ok: false, error: largeError } });
    let alive = true;
    converter.convert(settled, options).then(
      result => alive && result && setConverted({ text: settled, options, result }),
      (error: unknown) =>
        alive &&
        setConverted({
          text: settled,
          options,
          result: { ok: false, error: { message: error instanceof Error ? error.message : String(error) } },
        }),
    );
    return () => {
      alive = false;
    };
  }, [live, settled, options, largeError, converter]);
  const current: Current | null = live
    ? liveResult
    : converted && converted.text === settled && converted.options === options
      ? converted
      : null;
  const working = !tooLarge && !live && current === null;
  const result = current?.result ?? null;
  const done = !tooLarge && result?.ok && result.text !== '' ? result : null;
  const output = done ? done.text : '';
  const cut = output.length > SHOW_RESULT_CHARS;
  const url = useObjectUrl(done ? done.svg : '');

  // ---- History
  useEffect(() => {
    if (!edited.current || !done || !current) return;
    const action = pendingCommit.current;
    pendingCommit.current = null;
    const draft = draftOf(current.text, done.text, current.options, done.sizes, action ?? undefined);
    if (!draft) return;
    if (action) void recorder.commit(draft);
    else recorder.change(draft);
    // `current` is what `done` was made of.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [done, recorder]);

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    setFileError(null);
    apply();
  };
  const setOption = <K extends keyof SvgOptions>(key: K, value: SvgOptions[K]): void =>
    edit(() => setOptions(o => ({ ...o, [key]: value })));

  const openFile = (file: File): void => {
    edit(() => undefined);
    if (file.size > MAX_INPUT) return setFileError(TOO_LARGE);
    file.text().then(
      text => {
        pendingCommit.current = 'open';
        setInput(text);
      },
      () => setFileError(UNREADABLE),
    );
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
    const entry = readEntry(opened);
    if (!entry) return setRestored('This entry could not be opened.');
    void entry.svg.text().then(text => {
      edited.current = false;
      pendingCommit.current = null;
      setFileError(null);
      setInput(text);
      setOptions(entry.options);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const goTo = (line: number, column: number): void => {
    const el = field.current;
    if (!el) return;
    const at = offsetAt(input, line, column);
    el.focus();
    el.setSelectionRange(at, at);
    const height = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (line - 1) * height - el.clientHeight / 3);
  };

  // ---- The line under the input
  let error: ReactElement | null = null;
  const words = fileError ?? (tooLarge ? TOO_LARGE : result && !result.ok ? result.error.message : null);
  if (words) {
    const place =
      !fileError && !tooLarge && result && !result.ok && result.error.line !== undefined ? result.error : null;
    error = place ? (
      <Button
        variant="link"
        size="sm"
        className="h-auto p-0 text-destructive"
        data-part="error"
        onClick={() => goTo(place.line!, place.column!)}>
        <CircleAlertIcon aria-hidden="true" />
        {words}
      </Button>
    ) : (
      <span className="inline-flex items-center gap-1" data-part="error">
        <CircleAlertIcon aria-hidden="true" className="size-4" />
        {words}
      </span>
    );
  }

  const notes = done ? describeNotes(done.notes) : [];
  if (cut) notes.unshift(shownNote(output.length));
  // UTF-8 is at most three bytes per UTF-16 unit: the exact count only when it could matter.
  const overKept =
    settled.length > MAX_KEPT_BYTES ||
    (settled.length * 3 > MAX_KEPT_BYTES && new Blob([settled]).size > MAX_KEPT_BYTES);
  if (done && status.gate === 'on' && overKept) notes.push(NOT_KEPT);

  const recordCopy = (): void => {
    if (!done || !current) return;
    const draft = draftOf(current.text, done.text, current.options, done.sizes, 'copy');
    if (draft) void recorder.commit(draft);
  };

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Label htmlFor="svg-to-css-output" className="text-muted-foreground">
          Output
        </Label>
        <Select
          value={options.output}
          onValueChange={value => {
            if (OUTPUTS.includes(value as Output)) setOption('output', value as Output);
          }}>
          <SelectTrigger id="svg-to-css-output" className="min-w-40">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OUTPUTS.map(o => (
              <SelectItem key={o} value={o}>
                {OUTPUT_LABELS[o]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Encoding"
          className="ml-2"
          value={options.encoding}
          onValueChange={value => {
            if ((value === 'url' || value === 'base64') && value !== options.encoding) setOption('encoding', value);
          }}>
          <ToggleGroupItem value="url">URL-encoded</ToggleGroupItem>
          <ToggleGroupItem value="base64">Base64</ToggleGroupItem>
        </ToggleGroup>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox
            id="svg-to-css-minify"
            checked={options.minify}
            onCheckedChange={checked => setOption('minify', checked === true)}
          />
          <Label htmlFor="svg-to-css-minify" className="font-normal">
            Minify
          </Label>
        </div>
        <Button variant="outline" className="ml-auto" onClick={() => picker.current?.click()}>
          Open file
        </Button>
        <input
          ref={picker}
          type="file"
          accept={ACCEPT}
          hidden
          tabIndex={-1}
          aria-hidden="true"
          data-part="file-input"
          onChange={e => {
            const picked = e.target.files?.[0];
            e.target.value = '';
            if (picked) openFile(picked);
          }}
        />
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPanes>
        <ToolPane
          label="SVG"
          htmlFor="svg-to-css-input"
          onDragOver={e => {
            if (Array.from(e.dataTransfer.types).includes('Files')) e.preventDefault();
          }}
          onDrop={e => {
            const file = e.dataTransfer.files[0];
            if (!file) return;
            e.preventDefault();
            openFile(file);
          }}>
          <Textarea
            ref={field}
            id="svg-to-css-input"
            className="h-90 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
          />
          {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="status">
            {error ?? ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="CSS"
          htmlFor="svg-to-css-result"
          actions={<CopyButton value={output} size="sm" onCopied={recordCopy} />}>
          <Textarea
            id="svg-to-css-result"
            className="h-40 resize-y font-mono text-code break-all field-sizing-fixed"
            spellCheck={false}
            readOnly
            value={cut ? output.slice(0, SHOWN_RESULT_CHARS) : output}
          />
          <div className="flex flex-col text-sm text-muted-foreground" role="status" data-part="facts">
            <p className="m-0 min-h-5" data-part="sizes">
              {working ? 'Working…' : done ? formatSizes(done.sizes, current!.options.encoding) : ' '}
            </p>
            {notes.map(note => (
              <p key={note} className="m-0" data-part="note">
                {note}
              </p>
            ))}
          </div>
          <span className="cn-label">Preview</span>
          <Preview key={url ?? 'none'} url={url} mask={options.output === 'mask-image'} />
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default SvgToCssTool;
