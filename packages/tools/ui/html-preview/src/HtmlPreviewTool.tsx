/**
 * The HTML Preview tool's page (docs/tools/specs/html-preview.md §8): the HTML on the left; on the right the preview
 * with Width and Copy HTML, the line of what is not shown above it, the hint under it. The preview is the kit's
 * FramedDocument — a srcdoc frame sandboxed without scripts — with this tool's policy, which lets nothing load at all,
 * and without the extension's theme (a light page, as a browser shows HTML without styles). The page checks the input
 * (@workspace/tool-logic-html-preview: DOMParser, the CSS made to load nothing) and puts it into the frame's document as
 * nodes, constructed sheets and CSSOM inline styles — never markup, never `innerHTML` on this page (§5.1–§5.3). The
 * preview follows every edit up to LIVE_INPUT characters, comes SETTLE_MS after the last edit up to MAX_INPUT, and above
 * that the tool refuses (§6, §12). It records into the tool history through its host: an edit snapshot (`change`) and a
 * commit when the HTML is taken (Copy HTML); an entry the host asks to open comes back as the HTML and its width (for
 * the visit). The width the person chooses is a saved parameter (settings.ts); it sizes the frame and nothing else. The
 * page frame (title, summary, the history line, the reset of saved parameters) is the host's.
 */
import { HINT, PLACEHOLDER, TOO_DEEP, TOO_LARGE, WIDTHS, entryLabel, excerpt, isWidth, readPayload } from './entries';
import { htmlPreviewHistory } from './history';
import { htmlPreviewSettings } from './settings';
import {
  FRAME_POLICY,
  LIVE_INPUT,
  MAX_DEPTH,
  MAX_INPUT,
  nestingDepth,
  SETTLE_MS,
  removedText,
  renderInto,
  sanitizeHtml,
  serializeSanitized,
} from '@workspace/tool-logic-html-preview';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { FramedDocument } from '@workspace/ui/framed-document';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { ShieldCheck } from 'lucide-react';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Width } from './entries';
import type { HtmlPreviewPayload } from './history';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** The input the preview is drawn from: the live one when small, the one SETTLE_MS after the last edit when large. */
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
  return input.length <= LIVE_INPUT || input.length > MAX_INPUT ? input : settled;
};

const draftOf = (input: string, width: Width, action?: 'copy'): HistoryDraft | null => {
  if (input.trim() === '' || input.length > MAX_INPUT || nestingDepth(input, MAX_DEPTH) > MAX_DEPTH) return null;
  const payload: HtmlPreviewPayload = action ? { width, action } : { width };
  return {
    kind: 'preview',
    payload,
    label: entryLabel(input, payload),
    text: excerpt(input),
    blobs: { input: new Blob([input], { type: 'text/html' }) },
  };
};

const HtmlPreviewTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const saved = useSavedSettings(host, 'html-preview', htmlPreviewSettings);
  const { width } = saved.values;
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'html-preview', htmlPreviewHistory);

  const source = useSettled(input);
  // The size refusal is the input's, said at once; the preview — and the refusal of a nesting the parser would take
  // seconds over (§12) — the settled source's.
  const tooLarge = input.length > MAX_INPUT;
  const tooDeep = useMemo(() => source.length <= MAX_INPUT && nestingDepth(source, MAX_DEPTH) > MAX_DEPTH, [source]);
  const refused = source.length > MAX_INPUT || tooDeep;
  const checked = useMemo(
    () => sanitizeHtml(refused ? '' : source, document),
    // a new result for each source: the frame draws when it changes
    [source, refused],
  );
  const empty = source.trim() === '' || refused;
  const notShown = empty ? '' : removedText(checked.counts);
  // §4: Fit — the column's width (the kit's frame is as wide as its column); otherwise the chosen width, in pixels
  const frameWidth = width === 'fit' ? undefined : `${width}px`;

  // A person's edit (or text handed over from the start page) is recorded; opening an entry is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current) return;
    const draft = draftOf(source, width);
    if (draft) recorder.change(draft);
  }, [recorder, source, width]);

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
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      saved.visit({ width: readPayload(opened.payload).width });
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="HTML" htmlFor="html-preview-input">
          <Textarea
            id="html-preview-input"
            className="h-120 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
          />
          {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {tooLarge ? TOO_LARGE : tooDeep ? TOO_DEEP : ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Preview"
          className="min-w-0"
          actions={
            <>
              <Label htmlFor="html-preview-width" className="text-muted-foreground">
                Width
              </Label>
              <Select
                value={width}
                onValueChange={value => {
                  if (isWidth(value) && value !== width) edit(() => saved.set({ width: value }));
                }}>
                <SelectTrigger id="html-preview-width" size="sm" className="min-w-24">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {WIDTHS.map(w => (
                    <SelectItem key={w.value} value={w.value}>
                      {w.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <CopyButton
                label="Copy HTML"
                value={() => serializeSanitized(checked)}
                resetKey={checked}
                disabled={empty}
                onCopied={() => {
                  const draft = draftOf(source, width, 'copy');
                  if (draft) void recorder.commit(draft);
                }}
              />
            </>
          }>
          <ToolMessage data-part="removed" className="flex items-center gap-1.5">
            {notShown && <ShieldCheck aria-hidden="true" className="size-3.5 shrink-0" />}
            {notShown || ' '}
          </ToolMessage>
          <div className="overflow-x-auto" data-part="viewport">
            <FramedDocument
              title="HTML preview"
              data-part="preview"
              className="h-120"
              style={{ width: frameWidth }}
              policy={FRAME_POLICY}
              theme={false}
              render={doc => renderInto(doc, checked)}
              version={checked}
            />
          </div>
          <p className="self-end text-right text-xs text-muted-foreground">{HINT}</p>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default HtmlPreviewTool;
