/**
 * The JSON tool's page: input, the actions, the result. All logic is in @workspace/tool-logic-json. It records into the
 * tool history through its host (ToolHost.history, @workspace/tools-host): an edit snapshot when the text or the options
 * change (the checkpoint rule decides when one is written), and every Format / Minify with its result; an entry the host
 * asks to open comes back as the text, the options and the result. Without a host the history is the page's memory.
 * The page frame (title, summary, the history line) is the host's; the body is built from the kit's tool parts.
 */
import { editLabel, excerpt, isIndent, resultLabel } from './entries';
import { jsonHistory } from './history';
import { formatJson, locateJsonError, minifyJson } from '@workspace/tool-logic-json';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { Label } from '@workspace/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Textarea } from '@workspace/ui/textarea';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { useEffect, useMemo, useRef, useState } from 'react';
import type { JsonEditPayload, JsonResultPayload } from './history';
import type { Indent, JsonResult } from '@workspace/tool-logic-json';
import type { HistoryDraft, ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

const INDENTS: Array<{ value: Indent; label: string }> = [
  { value: 2, label: '2 spaces' },
  { value: 4, label: '4 spaces' },
  { value: 'tab', label: 'Tab' },
];

const text = (value: string): Blob => new Blob([value], { type: 'application/json' });

const editDraft = (input: string, options: JsonEditPayload): HistoryDraft => ({
  kind: 'edit',
  payload: options,
  label: editLabel(input),
  text: excerpt(input),
  blobs: { input: text(input) },
});

const JsonTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [input, setInput] = useState(initial ?? '');
  const [indent, setIndent] = useState<Indent>(2);
  const [sortKeys, setSortKeys] = useState(false);
  const [result, setResult] = useState<JsonResult | null>(null);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'json', jsonHistory);

  const validity = useMemo(() => (input.trim() === '' ? null : locateJsonError(input)), [input]);

  // Text handed over from the start page is the first edit of this visit.
  const handed = useRef(initial);
  useEffect(() => {
    if (handed.current) recorder.change(editDraft(handed.current, { indent: 2, sortKeys: false }));
  }, [recorder]);

  const edit = (next: { input?: string; indent?: Indent; sortKeys?: boolean }): void => {
    const state = { input, indent, sortKeys, ...next };
    if (next.input !== undefined) setInput(next.input);
    if (next.indent !== undefined) setIndent(next.indent);
    if (next.sortKeys !== undefined) setSortKeys(next.sortKeys);
    setRestored(null);
    if (state.input.trim() !== '')
      recorder.change(editDraft(state.input, { indent: state.indent, sortKeys: state.sortKeys }));
  };

  const run = (action: 'format' | 'minify'): void => {
    const next = action === 'format' ? formatJson(input, { indent, sortKeys }) : minifyJson(input, { sortKeys });
    setResult(next);
    setRestored(null);
    if (input.trim() === '') return;
    const payload: JsonResultPayload = {
      action,
      indent,
      sortKeys,
      ok: next.ok,
      ...(next.ok ? {} : { error: { line: next.error.line, column: next.error.column, message: next.error.message } }),
    };
    void recorder.commit({
      kind: 'result',
      payload,
      label: resultLabel(payload),
      text: excerpt(input),
      blobs: next.ok ? { input: text(input), output: text(next.text) } : { input: text(input) },
    });
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
    const p = (opened.payload ?? {}) as Partial<JsonResultPayload>;
    const nextIndent = isIndent(p.indent) ? p.indent : 2;
    const nextSort = p.sortKeys === true;
    void Promise.all([opened.blobs.input?.text() ?? '', opened.blobs.output?.text()]).then(([source, output]) => {
      setInput(source);
      setIndent(nextIndent);
      setSortKeys(nextSort);
      if (opened.entry.kind === 'result' && p.action)
        setResult(
          output !== undefined
            ? { ok: true, text: output }
            : p.action === 'format'
              ? formatJson(source, { indent: nextIndent, sortKeys: nextSort })
              : minifyJson(source, { sortKeys: nextSort }),
        );
      else setResult(null);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const code = 'h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';
  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <Button onClick={() => run('format')}>Format</Button>
        <Button variant="outline" onClick={() => run('minify')}>
          Minify
        </Button>
        <Label htmlFor="json-indent" className="ml-2 text-muted-foreground">
          Indent
        </Label>
        <Select
          value={String(indent)}
          onValueChange={value => edit({ indent: value === 'tab' ? 'tab' : (Number(value) as Indent) })}>
          <SelectTrigger id="json-indent" className="min-w-28">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INDENTS.map(i => (
              <SelectItem key={String(i.value)} value={String(i.value)}>
                {i.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <div className="ml-2 flex items-center gap-2">
          <Checkbox
            id="json-sort"
            checked={sortKeys}
            onCheckedChange={checked => edit({ sortKeys: checked === true })}
          />
          <Label htmlFor="json-sort" className="font-normal">
            Sort keys
          </Label>
        </div>
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}
      <ToolPanes>
        <ToolPane label="Input" htmlFor="json-input">
          <Textarea
            id="json-input"
            className={code}
            spellCheck={false}
            placeholder='{"paste": "JSON here"}'
            value={input}
            onChange={e => edit({ input: e.target.value })}
          />
          {/* Live while typing: read out politely (status), not as an alert on every keystroke. */}
          <ToolMessage tone={validity ? 'error' : 'success'} role="status" className="validity">
            {input.trim() === ''
              ? ' '
              : validity
                ? `Line ${validity.line}, column ${validity.column}: ${validity.message}`
                : 'Valid JSON'}
          </ToolMessage>
        </ToolPane>
        <ToolPane label="Result" htmlFor="json-output" actions={<CopyButton value={result?.ok ? result.text : ''} />}>
          <Textarea
            id="json-output"
            className={code}
            spellCheck={false}
            readOnly
            value={result?.ok ? result.text : ''}
          />
          {result && !result.ok && (
            <ToolMessage tone="error" className="validity">
              Line {result.error.line}, column {result.error.column}: {result.error.message}
            </ToolMessage>
          )}
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default JsonTool;
