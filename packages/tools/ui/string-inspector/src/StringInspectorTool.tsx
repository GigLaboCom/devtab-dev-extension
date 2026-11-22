/**
 * The String Inspector's page (docs/tools/specs/string-inspector.md §8): the text on top, then the summary with Copy
 * summary, the warnings, the visible text and the table by code point with Copy table. All logic is in
 * @workspace/tool-logic-string-inspector. The results follow every edit up to LIVE_INPUT characters; up to MAX_INPUT
 * they come 300 ms after the last edit and the passes over the whole text run in a module worker (runner.ts), so a
 * megabyte never holds the page; above that the tool refuses (§12). The visible text and the table read only the start
 * of the text, on the page. The character names are a lazy part of their own (`loadNames`).
 *
 * History, through the host: the tool has no run button, so a person's edit is a snapshot (`recorder.change`, by the
 * factory's rule, once its results are there) and Copy summary or Copy table — the moment a result is taken — is a
 * commit naming it. An entry the host asks to open comes back as the text; everything else follows from it. The page
 * frame (title, summary, the history line) is the host's.
 */
import { draftOf, isCopied } from './entries';
import { stringInspectorHistory } from './history';
import { CharacterTable, FormsLine, SectionHead, SummaryGrid, VisibleText, WarningList } from './parts';
import { createRunner } from './runner';
import {
  LIVE_INPUT,
  MAX_INPUT,
  MAX_ROWS,
  MAX_VISIBLE,
  SETTLE_MS,
  inspect,
  loadNames,
  rows as rowsOf,
  summaryText,
  tableTsv,
  unicodeVersion,
  visibleParts,
  warningLines,
} from '@workspace/tool-logic-string-inspector';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Copied, InspectPayload } from './entries';
import type { Runner } from './runner';
import type { Inspection, NameTable } from '@workspace/tool-logic-string-inspector';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const PLACEHOLDER = 'Paste a string to inspect';
const TOO_LARGE = 'Text is larger than 1 MB. String Inspector works with up to 1 MB.';
const EMPTY = inspect('');
const UNICODE = unicodeVersion();

/** The text the results are for: the live one when small, the one 300 ms after the last edit when large. */
const useSettled = (input: string): string => {
  const [settled, setSettled] = useState(input);
  const live = input.length <= LIVE_INPUT || input.length > MAX_INPUT;
  useEffect(() => {
    if (live) {
      setSettled(input);
      return;
    }
    const timer = setTimeout(() => setSettled(input), SETTLE_MS);
    return () => clearTimeout(timer);
  }, [input, live]);
  // A refused text needs no wait: the refusal is said at once.
  return live ? input : settled;
};

/**
 * The inspection of `text`: computed on the page up to LIVE_INPUT, in the worker above it. `of` is the text it belongs
 * to; while a large text is being inspected, the last inspection stays (`of` tells them apart).
 */
const useInspection = (text: string): { of: string; inspection: Inspection } => {
  const live = text.length <= LIVE_INPUT;
  const here = useMemo(() => (live ? inspect(text) : null), [text, live]);
  const [far, setFar] = useState<{ of: string; inspection: Inspection }>({ of: '', inspection: EMPTY });
  const runner = useRef<Runner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);
  useEffect(() => {
    // A small text needs no worker: one still busy with a large text is stopped.
    if (live) {
      runner.current?.dispose();
      return;
    }
    runner.current ??= createRunner();
    let current = true;
    runner.current.run(text).then(
      done => {
        if (current && done) setFar({ of: text, inspection: done });
      },
      () => {
        // The worker died: inspect on the page rather than show nothing.
        if (current) setFar({ of: text, inspection: inspect(text) });
      },
    );
    return () => {
      current = false;
    };
  }, [text, live]);
  // While a large text is counted, the results last shown stay (not those of an older large text).
  const last = useRef<{ of: string; inspection: Inspection }>({ of: '', inspection: EMPTY });
  const result = here ? { of: text, inspection: here } : far.of === text ? far : last.current;
  useEffect(() => {
    last.current = result;
  });
  return result;
};

/** The table of names, loaded once (a chunk of its own); null until it is there. */
const useNames = (): NameTable | null => {
  const [names, setNames] = useState<NameTable | null>(null);
  useEffect(() => {
    let live = true;
    void loadNames().then(table => {
      if (live) setNames(table);
    });
    return () => {
      live = false;
    };
  }, []);
  return names;
};

const StringInspectorTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'string-inspector', stringInspectorHistory);
  const names = useNames();

  const settled = useSettled(input);
  const tooLarge = settled.length > MAX_INPUT;
  const source = tooLarge ? '' : settled;
  const { of, inspection } = useInspection(source);
  const pending = of !== source;
  const { summary, warnings, forms } = inspection;
  const lines = useMemo(() => warningLines(warnings), [warnings]);
  // The start of the text, on the page: cheap at any size (the segmenter is read only as far as the limit).
  const parts = useMemo(() => (names ? visibleParts(of, MAX_VISIBLE, names) : []), [of, names]);
  const table = useMemo(() => (names ? rowsOf(of, MAX_ROWS, names) : []), [of, names]);
  const empty = of === '';

  // A person's edit (or text handed over by another place) is recorded once its results are there; opening an entry
  // from History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || pending) return;
    const draft = draftOf(of, inspection);
    if (draft) recorder.change(draft);
  }, [recorder, of, inspection, pending]);

  const edit = (next: string): void => {
    edited.current = true;
    setRestored(null);
    setInput(next);
  };

  const onCopied = (copied: Copied): void => {
    const draft = draftOf(of, inspection, copied);
    if (draft) void recorder.commit(draft);
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
    const p = (opened.payload ?? {}) as Partial<InspectPayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setInput(text);
      const label = opened.label ?? (isCopied(p.copied) ? `copied ${p.copied}` : 'an entry');
      setRestored(`Opened from History: ${label}.`);
    });
  });

  return (
    <div className="flex flex-col gap-4">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes layout="stacked">
        <ToolPane label="Text" htmlFor="string-inspector-input">
          <Textarea
            id="string-inspector-input"
            className="h-36 resize-y field-sizing-fixed"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            value={input}
            onChange={e => edit(e.target.value)}
          />
          {/* The refusal, and while a large text is counted a note: both change while typing (status). */}
          <ToolMessage tone={tooLarge ? 'error' : 'note'} role="status" data-part="input-message">
            {tooLarge ? TOO_LARGE : pending ? 'Counting\u{2026}' : undefined}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>

      {!tooLarge && (
        <>
          <section
            aria-labelledby="string-inspector-summary"
            aria-busy={pending || undefined}
            className="kit-tool-pane">
            <SectionHead
              id="string-inspector-summary"
              title="Summary"
              actions={
                <CopyButton
                  value={() => summaryText(summary)}
                  resetKey={of}
                  label="Copy summary"
                  variant="ghost"
                  size="sm"
                  disabled={empty}
                  onCopied={() => onCopied('summary')}
                />
              }
            />
            <SummaryGrid summary={summary} />
            {!empty && <FormsLine forms={forms} />}
            <p className="m-0 text-xs text-muted-foreground" data-part="unicode">
              {`Counted with this browser\u{2019}s Unicode data (${UNICODE}).`}
            </p>
          </section>

          {!empty && <WarningList warnings={warnings} lines={lines} />}

          {!empty && names && (
            <section aria-labelledby="string-inspector-visible" className="kit-tool-pane">
              <SectionHead id="string-inspector-visible" title="Visible text" />
              <VisibleText parts={parts} codePoints={summary.codePoints} />
            </section>
          )}

          {!empty && names && (
            <section aria-labelledby="string-inspector-table" className="kit-tool-pane">
              <SectionHead
                id="string-inspector-table"
                title="Characters"
                actions={
                  <CopyButton
                    value={() => tableTsv(table)}
                    resetKey={table}
                    label="Copy table"
                    variant="ghost"
                    size="sm"
                    onCopied={() => onCopied('table')}
                  />
                }
              />
              <CharacterTable rows={table} codePoints={summary.codePoints} />
            </section>
          )}
        </>
      )}
    </div>
  );
};

export default StringInspectorTool;
