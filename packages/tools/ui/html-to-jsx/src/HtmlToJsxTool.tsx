/**
 * The HTML to JSX tool's page (docs/tools/specs/html-to-jsx.md §8): Wrap in a component and, for a large input,
 * Convert; the HTML and the JSX side by side, the size line under the input, the notes under the result. The markup is
 * parsed by the page's own DOMParser as a whole document — inert: nothing runs, nothing loads, no policy violation — and
 * walked by @workspace/tool-logic-html-to-jsx; the parsed tree never enters the page. The table of attribute names
 * (a chunk of its own) loads with the first input, never with the page. The result follows every edit up to
 * LIVE_INPUT characters; above that Convert (or Ctrl+Enter) runs it; above MAX_INPUT the input is refused (§12), and so
 * is markup nested deeper than MAX_NESTING levels — found by a linear scan before the parser sees it (§12, §15).
 * DOMParser does not exist in a worker, so the work stays on the page; Convert paints "Working…" first. History: an
 * edit snapshot (`change`) once the result is there, a commit on Copy and on Convert; an entry the host asks to open
 * comes back as the input and the option. Wrap in a component is a saved parameter (settings.ts;
 * docs/tools/settings.md): the tool opens with what the person chose last; an opened entry shows its own for the visit
 * only. The page frame (title, summary, the history line) is the host's.
 */
import { draftOf, readEntry } from './entries';
import { htmlToJsxHistory } from './history';
import { htmlToJsxSettings } from './settings';
import {
  LIVE_INPUT,
  MAX_INPUT,
  MAX_NESTING,
  describeNotes,
  htmlToJsx,
  loadAttributeNames,
  nestingDepth,
} from '@workspace/tool-logic-html-to-jsx';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { AttributeNames, JsxResult, ParseHtml } from '@workspace/tool-logic-html-to-jsx';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const LARGE = 'Large input: press Convert (Ctrl+Enter).';
const TOO_LARGE = 'Input is larger than 4 MB.';
const TOO_DEEP = `Input nests elements more than ${MAX_NESTING} levels deep.`;

/** The page's parser, on a whole document (docs/tools/README.md: never a fragment, never `<template>` of the page). */
const parseHtml: ParseHtml = markup => new DOMParser().parseFromString(markup, 'text/html');

/** What Convert made, and from what: shown while the input and the option are still the same. */
interface Conversion {
  input: string;
  component: boolean;
  result: JsxResult;
}

/** The table of attribute names, loaded the first time `needed` is true (a chunk of its own); null until then. */
const useAttributeNames = (needed: boolean): AttributeNames | null => {
  const [names, setNames] = useState<AttributeNames | null>(null);
  useEffect(() => {
    if (!needed || names !== null) return;
    let live = true;
    void loadAttributeNames().then(loaded => {
      if (live) setNames(loaded);
    });
    return () => {
      live = false;
    };
  }, [needed, names]);
  return names;
};

const HtmlToJsxTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const saved = useSavedSettings(host, 'html-to-jsx', htmlToJsxSettings);
  const { component } = saved.values;
  const [converted, setConverted] = useState<Conversion | null>(null);
  const [working, setWorking] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'html-to-jsx', htmlToJsxHistory);

  const tooLarge = input.length > MAX_INPUT;
  // Chrome's parser slows with the depth of what it nests and stops nesting at 512 levels: refused before parsing.
  const tooDeep = useMemo(() => !tooLarge && nestingDepth(input) > MAX_NESTING, [tooLarge, input]);
  const refused = tooLarge || tooDeep;
  const large = !refused && input.length > LIVE_INPUT;
  const blank = refused || input.trim() === '';
  const names = useAttributeNames(!blank);

  const live = useMemo(
    () => (blank || large || names === null ? null : htmlToJsx(input, { component }, parseHtml, names)),
    [blank, large, names, input, component],
  );
  const result: JsxResult | null =
    live ??
    (large && converted !== null && converted.input === input && converted.component === component
      ? converted.result
      : null);
  const output = result?.text ?? '';
  const notes = result ? describeNotes(result.notes) : [];

  // A person's edit (or text handed over by the host) is recorded once its result is there; opening an entry from
  // History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (edited.current && live !== null) recorder.change(draftOf(input, component, live));
  }, [recorder, input, component, live]);

  const mounted = useRef(true);
  useEffect(
    () => () => {
      mounted.current = false;
    },
    [],
  );

  const edit = (apply: () => void): void => {
    edited.current = true;
    setRestored(null);
    apply();
  };

  const convert = (): void => {
    if (!large || working) return;
    const job = { input, component };
    setWorking(true);
    // Let "Working…" paint before the page is busy: parsing and walking run in one task on the page.
    requestAnimationFrame(() =>
      setTimeout(() => {
        void loadAttributeNames().then(table => {
          if (!mounted.current) return;
          const made = htmlToJsx(job.input, { component: job.component }, parseHtml, table);
          setConverted({ ...job, result: made });
          setWorking(false);
          void recorder.commit(draftOf(job.input, job.component, made, 'convert'));
        });
      }, 0),
    );
  };

  const copied = (): void => {
    if (result && input.trim() !== '') void recorder.commit(draftOf(input, component, result, 'copy'));
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
    const entry = readEntry(opened.payload);
    void Promise.all([
      opened.blobs.input?.text() ?? Promise.resolve(''),
      opened.blobs.output?.text() ?? Promise.resolve(''),
    ]).then(([text, jsx]) => {
      if (!mounted.current) return;
      edited.current = false;
      setInput(text);
      // The entry's option for this visit; what is saved stays as it was.
      saved.visit({ component: entry.component });
      // A large input's result is the one kept: it would otherwise wait for Convert.
      setConverted(
        text.length > LIVE_INPUT && text.length <= MAX_INPUT
          ? { input: text, component: entry.component, result: { text: jsx, notes: entry.notes } }
          : null,
      );
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <div className="flex items-center gap-2">
          <Checkbox
            id="html-to-jsx-component"
            checked={component}
            onCheckedChange={checked => edit(() => saved.set({ component: checked === true }))}
          />
          <Label htmlFor="html-to-jsx-component" className="font-normal">
            Wrap in a component
          </Label>
        </div>
        {large && (
          <Button variant="default" className="ml-auto" disabled={working} onClick={convert}>
            {working ? 'Working…' : 'Convert'}
          </Button>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="HTML" htmlFor="html-to-jsx-input">
          <Textarea
            id="html-to-jsx-input"
            className={code}
            spellCheck={false}
            placeholder='<div class="card">Hello</div>'
            value={input}
            onChange={e => {
              const next = e.target.value;
              edit(() => setInput(next));
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && (e.ctrlKey || e.metaKey) && large) {
                e.preventDefault();
                convert();
              }
            }}
          />
          {/* Changes while typing: read out politely (status), never as an alert on every keystroke. */}
          <ToolMessage tone={refused ? 'error' : 'note'} role="status" data-part="status">
            {tooLarge ? TOO_LARGE : tooDeep ? TOO_DEEP : large ? LARGE : ''}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="JSX"
          htmlFor="html-to-jsx-output"
          actions={<CopyButton variant="ghost" size="sm" value={output} onCopied={copied} />}>
          <ResultField id="html-to-jsx-output" className={code} spellCheck={false} value={output} />
          {notes.length === 0 ? (
            <ToolMessage data-part="note" />
          ) : (
            notes.map(note => (
              <ToolMessage key={note} data-part="note">
                {note}
              </ToolMessage>
            ))
          )}
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default HtmlToJsxTool;
