/**
 * The Markdown Preview tool's page (docs/tools/specs/markdown-preview.md §8): the Markdown on the left, the preview on
 * the right with Copy HTML. The preview is a sandboxed frame (FramedDocument.tsx) whose body the page fills with nodes
 * the allowlist of @workspace/tool-logic-markdown-preview builds from markdown-it's output — never markup, never
 * `innerHTML` on this page. The preview follows every edit up to LIVE_INPUT characters (markdown-it on the page), comes
 * SETTLE_MS after the last edit up to MAX_INPUT (markdown-it in a worker, renderer.ts), and above that the tool refuses
 * (§6, §12). It records into the tool history through its host: an
 * edit snapshot (`change`) and a commit when the HTML is taken (Copy HTML); an entry the host asks to open comes back as
 * the Markdown. The page frame (title, summary, the history line) is the host's.
 */
import { EMPTY_PREVIEW, PLACEHOLDER, TOO_LARGE, entryLabel, excerpt } from './entries';
import { FramedDocument } from './FramedDocument';
import { markdownPreviewHistory } from './history';
import stylesheet from './preview.css?url';
import { createLargeRenderer } from './renderer';
import {
  LIVE_INPUT,
  MAX_INPUT,
  SETTLE_MS,
  renderMarkdown,
  toSafeFragment,
} from '@workspace/tool-logic-markdown-preview';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { MarkdownPreviewPayload } from './history';
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

/** What the preview shows: markdown-it's HTML of `source` (empty for a refused input). */
interface Markup {
  source: string;
  html: string;
}

/**
 * The markup of `source`: at once up to LIVE_INPUT, from the worker above it (null while it works — the preview keeps
 * what it shows), nothing above MAX_INPUT.
 */
const useMarkup = (source: string): Markup | null => {
  const small = source.length <= LIVE_INPUT;
  const refused = source.length > MAX_INPUT;
  const renderer = useRef<ReturnType<typeof createLargeRenderer> | null>(null);
  useEffect(() => () => renderer.current?.dispose(), []);
  const live = useMemo(() => (small ? { source, html: renderMarkdown(source) } : null), [source, small]);
  const none = useMemo(() => ({ source, html: '' }), [source]);
  const [large, setLarge] = useState<Markup | null>(null);
  useEffect(() => {
    if (small || refused) return;
    let current = true;
    renderer.current ??= createLargeRenderer();
    renderer.current.render(source).then(
      html => {
        if (current && html !== null) setLarge({ source, html });
      },
      () => {
        // The worker stopped: the page renders it, late rather than never.
        if (current) setLarge({ source, html: renderMarkdown(source) });
      },
    );
    return () => {
      current = false;
    };
  }, [source, small, refused]);
  if (live) return live;
  if (refused) return none;
  return large?.source === source ? large : null;
};

const draftOf = (input: string, action?: 'copy'): HistoryDraft | null => {
  if (input === '' || input.length > MAX_INPUT) return null;
  const payload: MarkdownPreviewPayload = action ? { action } : {};
  return {
    kind: 'preview',
    payload,
    label: entryLabel(input, payload),
    text: excerpt(input),
    blobs: { input: new Blob([input], { type: 'text/markdown' }) },
  };
};

const MarkdownPreviewTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [restored, setRestored] = useState<string | null>(null);
  // The preview's HTML as it is in the frame (§3: what Copy HTML takes); '' when there is nothing to copy.
  const [html, setHtml] = useState('');
  const { history, recorder } = useToolHistory(host, 'markdown-preview', markdownPreviewHistory);

  const source = useSettled(input);
  // The refusal is the input's, said at once; the preview is the settled source's.
  const refused = input.length > MAX_INPUT;
  // While a large input is in the worker, the preview keeps the markup it shows.
  const latest = useMarkup(source);
  const shown = useRef<Markup>({ source: '', html: '' });
  if (latest) shown.current = latest;
  const markup = shown.current;

  // A person's edit (or text handed over from the start page) is recorded; opening an entry from History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current) return;
    const draft = draftOf(source);
    if (draft) recorder.change(draft);
  }, [recorder, source]);

  const draw = (doc: Document): void => {
    const body = doc.body;
    body.className = 'md-preview';
    if (markup.source === '') {
      const empty = doc.createElement('p');
      empty.className = 'md-empty';
      empty.textContent = EMPTY_PREVIEW;
      body.replaceChildren(empty);
      setHtml('');
      return;
    }
    body.replaceChildren(toSafeFragment(markup.html, doc));
    setHtml(body.childElementCount === 0 ? '' : body.innerHTML);
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
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Markdown" htmlFor="markdown-preview-input">
          <Textarea
            id="markdown-preview-input"
            className="h-90 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            value={input}
            onChange={e => {
              const next = e.target.value;
              edited.current = true;
              setRestored(null);
              setInput(next);
            }}
          />
          {/* Changes while typing: coloured as an error, read out politely (status), as the recipe says. */}
          <ToolMessage tone="error" role="status" data-part="error">
            {refused ? TOO_LARGE : ' '}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Preview"
          actions={
            <CopyButton
              label="Copy HTML"
              value={html}
              onCopied={() => {
                const draft = draftOf(source, 'copy');
                if (draft) void recorder.commit(draft);
              }}
            />
          }>
          <FramedDocument
            title="Preview"
            data-part="preview"
            className="h-90 w-full rounded-md border border-input bg-background"
            stylesheet={stylesheet}
            render={draw}
            version={markup}
          />
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default MarkdownPreviewTool;
