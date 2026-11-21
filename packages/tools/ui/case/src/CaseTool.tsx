/**
 * The Case Converter's page (docs/tools/specs/case.md §8): the text on top, a hint under it, then the 13 forms in the
 * order of §4 — each a name, its result in a read-only field and its own Copy. All logic is in
 * @workspace/tool-logic-case. Every form follows every edit up to LIVE_INPUT characters, 300 ms after the last edit up
 * to MAX_INPUT, and above that the tool refuses (§12).
 *
 * History, through the host: the tool has no run button, so a person's edit is a snapshot (`recorder.change`, by the
 * factory's rule) and copying a form — the moment a result is taken — is a commit naming the form. An entry the host
 * asks to open comes back as the text; the results follow from it. The page frame (title, summary, the history line)
 * is the host's.
 */
import { draftOf, formLabel, isForm } from './entries';
import { caseHistory } from './history';
import { CASE_FORMS, LIVE_INPUT, MAX_INPUT, SETTLE_MS, convertAll } from '@workspace/tool-logic-case';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { CasePayload } from './entries';
import type { CaseForm } from '@workspace/tool-logic-case';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const PLACEHOLDER = 'Paste names or text, one per line';
const HINT = 'Each line is converted on its own. Words split at spaces, punctuation, _ - . / and at case changes.';
const TOO_LARGE = 'Text is larger than 512 KB. Case Converter works with up to 512 KB.';

const EMPTY = Object.fromEntries(CASE_FORMS.map(f => [f.id, ''])) as Record<CaseForm, string>;
const ZEROS = Object.fromEntries(CASE_FORMS.map(f => [f.id, 0])) as Record<CaseForm, number>;

/** The input the forms are computed from: the live one when small, the one 300 ms after the last edit when large. */
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
  // A refused input needs no wait: the refusal is said at once.
  return live ? input : settled;
};

/**
 * How many forms of `results` are on the page. Thirteen fields of half a megabyte take the browser most of a second to
 * lay out (§12 measured it), so above LIVE_INPUT the forms come one per frame — the page answers in between — and a
 * form not there yet is empty with its Copy off. Up to LIVE_INPUT all of them come at once.
 */
const useShown = (results: Record<CaseForm, string>, large: boolean): number => {
  const [progress, setProgress] = useState(() => ({ of: results, count: large ? 0 : CASE_FORMS.length }));
  const count = progress.of === results ? progress.count : large ? 0 : CASE_FORMS.length;
  useEffect(() => {
    if (count >= CASE_FORMS.length) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // After the next frame is painted, not before it: one field's layout per frame.
    const frame = requestAnimationFrame(() => {
      timer = setTimeout(() => setProgress({ of: results, count: count + 1 }), 0);
    });
    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(timer);
    };
  }, [results, count]);
  return count;
};

const CaseTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [restored, setRestored] = useState<string | null>(null);
  // The form whose Copy was pressed last, while its result has not changed: its button is named "Copied …".
  const [copied, setCopied] = useState<CaseForm | null>(null);
  // Pressing one Copy takes "Copied" off the others (§8): their buttons start afresh (a new key).
  const [stamps, setStamps] = useState(ZEROS);
  const { history, recorder } = useToolHistory(host, 'case', caseHistory);

  const source = useSettled(input);
  const tooLarge = source.length > MAX_INPUT;
  const results = useMemo(() => (tooLarge ? EMPTY : convertAll(source)), [source, tooLarge]);
  const shown = useShown(results, source.length > LIVE_INPUT);
  const pending = shown < CASE_FORMS.length;

  // A person's edit (or text handed over by another place) is recorded once its results are there; opening an entry
  // from History is not an edit.
  const edited = useRef(Boolean(initial));
  useEffect(() => {
    if (!edited.current || tooLarge) return;
    const draft = draftOf(source);
    if (draft) recorder.change(draft);
  }, [recorder, source, tooLarge]);

  const edit = (next: string): void => {
    edited.current = true;
    setRestored(null);
    setCopied(null);
    setInput(next);
  };

  const onCopied = (form: CaseForm): void => {
    setCopied(form);
    setStamps(s => Object.fromEntries(CASE_FORMS.map(f => [f.id, f.id === form ? s[f.id] : s[f.id] + 1])) as typeof s);
    const draft = draftOf(source, form);
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
    const p = (opened.payload ?? {}) as Partial<CasePayload>;
    void (opened.blobs.input?.text() ?? Promise.resolve('')).then(text => {
      edited.current = false;
      setCopied(null);
      setInput(text);
      const label = opened.label ?? (isForm(p.copied) ? `copied ${formLabel(p.copied)}` : 'an entry');
      setRestored(`Opened from History: ${label}.`);
    });
  });

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes layout="stacked">
        <ToolPane label="Text" htmlFor="case-input">
          <Textarea
            id="case-input"
            className="h-44 resize-y font-mono text-code field-sizing-fixed"
            spellCheck={false}
            placeholder={PLACEHOLDER}
            value={input}
            onChange={e => edit(e.target.value)}
          />
          {/* The hint, and in its place the refusal: it changes while typing, so it is read out politely (status). */}
          <ToolMessage tone={tooLarge ? 'error' : 'note'} role="status" data-part="hint">
            {tooLarge ? TOO_LARGE : HINT}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>
      <div
        role="group"
        aria-label="Cases"
        aria-busy={pending || undefined}
        className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-start gap-x-3 gap-y-2">
        {CASE_FORMS.map(({ id, label }, index) => (
          <div key={id} data-form={id} className="col-span-3 grid grid-cols-subgrid items-start">
            <Label htmlFor={`case-${id}`} className="min-h-9 font-mono text-code">
              {label}
            </Label>
            <Textarea
              id={`case-${id}`}
              className="max-h-55 min-h-0 resize-none overflow-auto font-mono text-code"
              rows={1}
              spellCheck={false}
              readOnly
              value={index < shown ? results[id] : ''}
            />
            <CopyButton
              key={`${id}-${stamps[id]}`}
              className="mt-0.5"
              value={index < shown ? results[id] : ''}
              aria-label={`${copied === id ? 'Copied' : 'Copy'} ${label}`}
              onCopied={() => onCopied(id)}
            />
          </div>
        ))}
      </div>
    </div>
  );
};

export default CaseTool;
