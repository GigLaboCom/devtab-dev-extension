/**
 * The JSON Schema tool's page (docs/tools/specs/json-schema.md §8): Validate — a schema, a document, the schemas its
 * references need, and every violation with its place; Generate schema — samples and the schema inferred from them.
 * The host wraps it in the kit's ToolPage; this is the body.
 *
 * Everything heavy happens in the tool's worker (runner.ts) 150 ms after the last edit, with a limit of 1 s — 10 s once
 * the person allows it — after which the worker is terminated: a pattern that backtracks never freezes the page. The
 * worker keeps the schema and the document it read, so editing one does not send or read the other again. The result
 * of the last valid input stays while the input has an error; the status line says so.
 *
 * History (D17, entries.ts): every edit is a snapshot (`recorder.change`), refreshed with the outcome when the worker
 * answers; each copy and Validate with it is committed. An entry opened from History comes back as its task, fields
 * and options (`saved.visit`), and runs again.
 */
import { copiedValidation, inferDraft as inferEntry, readEntry, takenSchema, validateDraft } from './entries';
import { jsonSchemaHistory } from './history';
import { SchemaRunner } from './runner';
import { jsonSchemaSettings } from './settings';
import { startJsonSchemaWorker } from './startWorker';
import { ViolationRows } from './ViolationRows';
import {
  DEBOUNCE_MS,
  detectJsonSchema,
  draftLabel,
  DRAFTS,
  LONG_TIMEOUT_MS,
  MAX_DOCUMENT,
  MAX_REFERENCED,
  MAX_ROWS,
  MAX_SCHEMA,
  MAX_VIOLATIONS,
  TIMEOUT_MS,
  violationCount,
} from '@workspace/tool-logic-json-schema';
import { useRestore, useSavedSettings, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { Checkbox } from '@workspace/ui/checkbox';
import { CopyButton } from '@workspace/ui/copy-button';
import { InputField } from '@workspace/ui/input-field';
import { Label } from '@workspace/ui/label';
import { ResultField } from '@workspace/ui/result-field';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@workspace/ui/select';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToggleGroup, ToggleGroupItem } from '@workspace/ui/toggle-group';
import { ToolMessage, ToolOptions, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon, PlusIcon, XIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { InferState, ValidateState } from './entries';
import type { DraftId, ValidatePayload } from './history';
import type { Job, RunOutcome } from './runner';
import type { GoTo, Placed } from './ViolationRows';
import type { InferenceReply, JsonErrorInfo, Outcome, ValidationReply } from '@workspace/tool-logic-json-schema';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

/** After this long without an answer the status line says `Running…` (§5 п. 40). */
const SLOW_MS = 300;

const mb = (n: number): string => `${n / 1024 / 1024} MB`;
const problemCount = (n: number): string => (n === 1 ? '1 problem' : `${n.toLocaleString('en-US')} problems`);
const seconds = (ms: number): string => (ms === TIMEOUT_MS ? '1 second' : `${ms / 1000} seconds`);

export const TEXTS = {
  running: 'Running…',
  valid: 'The document is valid.',
  stopped: (ms: number) =>
    `Stopped after ${seconds(ms)}: validation takes too long. A pattern such as (a+)+ in the schema often causes this.`,
  stoppedInfer: (ms: number) => `Stopped after ${seconds(ms)}: generating the schema takes too long on these samples.`,
  crashed: (message: string) => `Validation could not be run: ${message.replace(/\.$/, '')}.`,
  documentTooLong: `The document is longer than ${mb(MAX_DOCUMENT)}. JSON Schema works with up to ${mb(MAX_DOCUMENT)}.`,
  samplesTooLong: `The samples are longer than ${mb(MAX_DOCUMENT)}. JSON Schema works with up to ${mb(MAX_DOCUMENT)}.`,
  schemaTooLong: `The schema is longer than ${mb(MAX_SCHEMA)}. JSON Schema works with schemas up to ${mb(MAX_SCHEMA)}.`,
  staleSchema: 'The schema has an error. Showing the result of the last valid schema.',
  staleDocument: 'The document has an error. Showing the result of the last valid document.',
  problems: (n: number, draft: string) =>
    `The schema has ${problemCount(n)}: checked against the ${draft} meta-schema. The document is checked once the schema is valid.`,
  problemsPlain: (n: number) => `The schema has ${problemCount(n)}. The document is checked once the schema is valid.`,
  shownRows: (n: number) =>
    `Showing ${MAX_ROWS.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} violations. Copy violations copies all.`,
  truncated: `More than ${MAX_VIOLATIONS.toLocaleString('en-US')} violations: the first ${MAX_VIOLATIONS.toLocaleString('en-US')} are listed and copied.`,
  referencedHint: 'References to other files are never fetched. Paste each referenced schema here, with its "$id".',
  foundBy: (id: string) => `Found by "$id": ${id}`,
} as const;

type ValidateShown =
  | { kind: 'none' }
  | { kind: 'reply'; reply: ValidationReply; schemaKey: number; documentKey: number }
  | { kind: 'stopped'; ms: number }
  | { kind: 'failed'; message: string };

type InferShown =
  | { kind: 'none' }
  | { kind: 'reply'; reply: InferenceReply; key: number }
  | { kind: 'stopped'; ms: number }
  | { kind: 'failed'; message: string };

let keys = 0;
/** A new key for a new set of texts (the argument names what the key stands for). */
const next = (made: readonly unknown[]): number => (void made, ++keys);
const blank = (text: string): boolean => !/\S/.test(text);

/** Focus a field and put the caret on an offset, scrolled to its line (a third from the top), as the JSON tool does. */
const caretTo = (el: HTMLTextAreaElement | null | undefined, offset: number, line: number): void => {
  if (!el) return;
  el.focus();
  el.setSelectionRange(offset, offset);
  const height = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
  el.scrollTop = Math.max(0, (line - 1) * height - el.clientHeight / 3);
};

const ErrorLink = ({ error, onGo, part }: { error: JsonErrorInfo; onGo: () => void; part: string }): ReactElement => (
  <Button
    variant="link"
    size="sm"
    className="h-auto p-0 text-left whitespace-normal text-destructive"
    data-part={part}
    onClick={onGo}>
    <CircleAlertIcon aria-hidden="true" />
    {`Line ${error.line}, column ${error.column}: ${error.message}`}
  </Button>
);

const DraftSelect = ({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: DraftId;
  onChange: (d: DraftId) => void;
}): ReactElement => (
  <>
    <Label htmlFor={id} className="ml-2 text-muted-foreground">
      {label}
    </Label>
    <Select
      value={value}
      onValueChange={v => {
        const d = DRAFTS.find(x => x === v);
        if (d && d !== value) onChange(d);
      }}>
      <SelectTrigger id={id} className="min-w-28">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {DRAFTS.map(d => (
          <SelectItem key={d} value={d}>
            {draftLabel(d)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  </>
);

const Option = ({
  id,
  label,
  value,
  onChange,
}: {
  id: string;
  label: string;
  value: boolean;
  onChange: (on: boolean) => void;
}): ReactElement => (
  <div className="ml-2 flex items-center gap-2">
    <Checkbox id={id} checked={value} onCheckedChange={c => onChange(c === true)} />
    <Label htmlFor={id} className="font-normal">
      {label}
    </Label>
  </div>
);

const CODE = 'h-72 resize-y font-mono text-code field-sizing-fixed [tab-size:4]';

const JsonSchemaTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [detected] = useState(() => initial !== undefined && detectJsonSchema(initial));
  const saved = useSavedSettings(host, 'json-schema', jsonSchemaSettings, {
    opening: initial !== undefined ? { task: 'validate' } : undefined,
  });
  const { task, draft, formats, inferDraft, enums, inferFormats, closed } = saved.values;
  const [schema, setSchema] = useState(detected && initial !== undefined ? initial : '');
  const [document, setDocument] = useState(initial !== undefined && !detected ? initial : '');
  const [referenced, setReferenced] = useState<string[]>([]);
  const [samples, setSamples] = useState('');
  const [allowLong, setAllowLong] = useState(false);
  const [vShown, setVShown] = useState<ValidateShown>({ kind: 'none' });
  const [lastChecked, setLastChecked] = useState<Outcome | null>(null);
  const [iShown, setIShown] = useState<InferShown>({ kind: 'none' });
  const [slow, setSlow] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'json-schema', jsonSchemaHistory);

  const vState: ValidateState = { schema, document, referenced, draft, formats };
  const iState: InferState = { samples, draft: inferDraft, enums, formats: inferFormats, closed };
  const latest = useRef({ v: vState, i: iState });
  latest.current = { v: vState, i: iState };
  /** The person changed something since the page opened or an entry was restored: answers refresh the snapshot. */
  const edited = useRef(initial !== undefined);
  const schemaField = useRef<HTMLTextAreaElement>(null);
  const documentField = useRef<HTMLTextAreaElement>(null);
  const samplesField = useRef<HTMLTextAreaElement>(null);
  const referencedFields = useRef<Array<HTMLTextAreaElement | null>>([]);

  // A key stands for the texts it was made from: the runner sends a text to the worker only when its key is new.
  const schemaKey = useMemo(() => next([schema, referenced, draft]), [schema, referenced, draft]);
  const documentKey = useMemo(() => next([document]), [document]);
  const samplesKey = useMemo(
    () => next([samples, inferDraft, enums, inferFormats, closed]),
    [samples, inferDraft, enums, inferFormats, closed],
  );

  const schemaTooLong = schema.length > MAX_SCHEMA || referenced.some(t => t.length > MAX_SCHEMA);
  const documentTooLong = document.length > MAX_DOCUMENT;
  const samplesTooLong = samples.length > MAX_DOCUMENT;
  const limit = allowLong ? LONG_TIMEOUT_MS : TIMEOUT_MS;

  const fields = useRef({ schema, referenced, document, samples });
  fields.current = { schema, referenced, document, samples };
  const job: Job | null = useMemo(() => {
    const f = fields.current;
    if (task === 'validate') {
      if ((blank(f.schema) && blank(f.document)) || schemaTooLong || documentTooLong) return null;
      return {
        kind: 'validate',
        schemaKey,
        schema: f.schema,
        referenced: f.referenced,
        fallback: draft,
        documentKey,
        document: f.document,
        formats,
      };
    }
    if (blank(f.samples) || samplesTooLong) return null;
    return {
      kind: 'infer',
      key: samplesKey,
      samples: f.samples,
      options: { draft: inferDraft, enums, formats: inferFormats, closed },
    };
  }, [
    task,
    schemaKey,
    documentKey,
    samplesKey,
    draft,
    formats,
    inferDraft,
    enums,
    inferFormats,
    closed,
    schemaTooLong,
    documentTooLong,
    samplesTooLong,
  ]);

  const runner = useRef<SchemaRunner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);

  useEffect(() => {
    runner.current?.cancel();
    setSlow(false);
    if (!job) {
      setVShown({ kind: 'none' });
      setIShown({ kind: 'none' });
      setLastChecked(null);
      return;
    }
    // A stop or a failure was about the input before this edit: it goes; results stay until the new ones come.
    const keep = <S extends { kind: string }>(s: S): S | { kind: 'none' } =>
      s.kind === 'reply' || s.kind === 'none' ? s : { kind: 'none' };
    if (job.kind === 'validate') setVShown(keep);
    else setIShown(keep);
    let live = true;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const send = setTimeout(() => {
      runner.current ??= new SchemaRunner(startJsonSchemaWorker);
      slowTimer = setTimeout(() => live && setSlow(true), SLOW_MS);
      void runner.current.run(job, limit).then((outcome: RunOutcome) => {
        if (!live || outcome.kind === 'cancelled') return;
        clearTimeout(slowTimer);
        setSlow(false);
        if (job.kind === 'validate') {
          if (outcome.kind === 'timeout') return setVShown({ kind: 'stopped', ms: limit });
          if (outcome.kind === 'crashed') return setVShown({ kind: 'failed', message: outcome.message });
          if (outcome.result.kind !== 'validate') return;
          const reply = outcome.result.reply;
          setVShown({ kind: 'reply', reply, schemaKey: job.schemaKey, documentKey: job.documentKey });
          if (reply.outcome) setLastChecked(reply.outcome);
          let summary: ValidatePayload['outcome'];
          if (reply.outcome?.kind === 'checked') summary = { valid: reply.outcome.valid, count: reply.outcome.count };
          else if (reply.outcome?.kind === 'stopped') summary = { error: reply.outcome.message };
          else if (reply.schema.state === 'ok' && reply.schema.problems.length > 0)
            summary = { problems: reply.schema.problems.length };
          else if (reply.schema.state === 'error') summary = { error: reply.schema.error.message };
          else if (reply.document.state === 'error') summary = { error: reply.document.error.message };
          if (edited.current) recorder.change(validateDraft(latest.current.v, summary));
        } else {
          if (outcome.kind === 'timeout') return setIShown({ kind: 'stopped', ms: limit });
          if (outcome.kind === 'crashed') return setIShown({ kind: 'failed', message: outcome.message });
          if (outcome.result.kind !== 'infer') return;
          const reply = outcome.result.reply;
          setIShown({ kind: 'reply', reply, key: job.key });
          if (edited.current && reply.state === 'ok') recorder.change(inferEntry(latest.current.i, reply.samples));
        }
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(send);
      clearTimeout(slowTimer);
    };
  }, [job, limit, recorder]);

  /** A person's edit: the fields change, the stop and the restored line go, a snapshot is taken. */
  const editValidate = (next: Partial<ValidateState>): void => {
    if (next.schema !== undefined) setSchema(next.schema);
    if (next.document !== undefined) setDocument(next.document);
    if (next.referenced !== undefined) setReferenced(next.referenced);
    setAllowLong(false);
    setRestored(null);
    edited.current = true;
    const s = { ...latest.current.v, ...next };
    latest.current.v = s;
    if ((!blank(s.schema) || !blank(s.document)) && s.schema.length <= MAX_SCHEMA && s.document.length <= MAX_DOCUMENT)
      recorder.change(validateDraft(s));
  };
  const editInfer = (next: Partial<InferState>): void => {
    if (next.samples !== undefined) setSamples(next.samples);
    setAllowLong(false);
    setRestored(null);
    edited.current = true;
    const s = { ...latest.current.i, ...next };
    latest.current.i = s;
    if (!blank(s.samples) && s.samples.length <= MAX_DOCUMENT) recorder.change(inferEntry(s));
  };
  /** A person's change of an option: saved (D21), and the next answer refreshes the snapshot. */
  const setOption = (values: Parameters<typeof saved.set>[0]): void => {
    saved.set(values);
    setAllowLong(false);
    setRestored(null);
    edited.current = true;
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
    void readEntry(opened.entry.kind, opened.payload, opened.blobs).then(entry => {
      edited.current = false;
      if (entry.task === 'validate') {
        const s = entry.state;
        latest.current.v = s;
        setSchema(s.schema);
        setDocument(s.document);
        setReferenced(s.referenced);
        saved.visit({ task: 'validate', draft: s.draft, formats: s.formats });
      } else {
        const s = entry.state;
        latest.current.i = s;
        setSamples(s.samples);
        saved.visit({ task: 'infer', inferDraft: s.draft, enums: s.enums, inferFormats: s.formats, closed: s.closed });
      }
      setAllowLong(false);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  // ——— Validate: what the last answer says about the current fields ———
  const reply = vShown.kind === 'reply' ? vShown.reply : null;
  const freshSchema = vShown.kind === 'reply' && vShown.schemaKey === schemaKey;
  const freshDocument = vShown.kind === 'reply' && vShown.documentKey === documentKey;
  const schemaError = freshSchema && reply?.schema.state === 'error' ? reply.schema.error : null;
  const schemaOk = freshSchema && reply?.schema.state === 'ok' ? reply.schema : null;
  const documentState = freshDocument && reply ? reply.document : null;
  const documentError = documentState?.state === 'error' ? documentState.error : null;
  const problems = schemaOk?.problems ?? [];
  const outcome = reply?.outcome ?? null;
  const bothFilled = !blank(schema) && !blank(document);
  const shownOutcome: Outcome | null = outcome ?? ((schemaError || documentError) && bothFilled ? lastChecked : null);

  let status = '';
  if (reply && bothFilled) {
    if (schemaError && shownOutcome) status = TEXTS.staleSchema;
    else if (documentError && shownOutcome) status = TEXTS.staleDocument;
    else if (outcome?.kind === 'checked') status = outcome.valid ? TEXTS.valid : violationCount(outcome.count);
  }
  const checked = shownOutcome?.kind === 'checked' ? shownOutcome : null;
  const refusal = !schemaError && !documentError && outcome?.kind === 'stopped' ? outcome.message : null;

  const goToDocument: GoTo = useCallback((p: Placed) => caretTo(documentField.current, p.offset, p.line), []);
  const goToSchema: GoTo = useCallback((p: Placed) => {
    const n = p.source && p.source !== 'schema' ? Number(p.source.slice('referenced-'.length)) : -1;
    caretTo(n >= 0 ? referencedFields.current[n] : schemaField.current, p.offset, p.line);
  }, []);

  const commitValidation = (action: 'copy-violations' | 'copy-problems', count: number): void => {
    const s = latest.current.v;
    if (blank(s.schema) || s.schema.length > MAX_SCHEMA || s.document.length > MAX_DOCUMENT) return;
    void recorder.commit(copiedValidation(s, action, count));
  };

  // ——— Generate schema ———
  const iReply = iShown.kind === 'reply' ? iShown.reply : null;
  const inferred = iReply?.state === 'ok' ? iReply : null;
  const samplesError =
    iShown.kind === 'reply' && iShown.key === samplesKey && iReply?.state === 'error' ? iReply.error : null;

  const validateWithIt = (): void => {
    if (!inferred) return;
    void recorder.commit(takenSchema(latest.current.i, 'validate-with-it', inferred.samples));
    setOption({ task: 'validate' });
    editValidate({ schema: inferred.schema });
  };

  const running = slow ? <span className="text-sm text-muted-foreground">{TEXTS.running}</span> : null;
  const shown = task === 'validate' ? vShown : iShown;
  const metaDraft = schemaOk?.draftLine.replace(/ \(.*$/, '').replace(/^Draft/, 'draft') ?? '';

  return (
    <div className="flex flex-col gap-3">
      <ToolOptions>
        <ToggleGroup
          type="single"
          variant="segmented"
          aria-label="Task"
          value={task}
          onValueChange={value => {
            if ((value === 'validate' || value === 'infer') && value !== task) setOption({ task: value });
          }}>
          <ToggleGroupItem value="validate">Validate</ToggleGroupItem>
          <ToggleGroupItem value="infer">Generate schema</ToggleGroupItem>
        </ToggleGroup>
        {task === 'validate' ? (
          <>
            <DraftSelect
              id="json-schema-draft"
              label="Draft without $schema"
              value={draft}
              onChange={d => setOption({ draft: d })}
            />
            <Option
              id="json-schema-formats"
              label="Check formats"
              value={formats}
              onChange={on => setOption({ formats: on })}
            />
          </>
        ) : (
          <>
            <DraftSelect
              id="json-schema-infer-draft"
              label="Draft"
              value={inferDraft}
              onChange={d => setOption({ inferDraft: d })}
            />
            <Option id="json-schema-enums" label="Enums" value={enums} onChange={on => setOption({ enums: on })} />
            <Option
              id="json-schema-infer-formats"
              label="Formats"
              value={inferFormats}
              onChange={on => setOption({ inferFormats: on })}
            />
            <Option
              id="json-schema-closed"
              label="No additional properties"
              value={closed}
              onChange={on => setOption({ closed: on })}
            />
          </>
        )}
      </ToolOptions>

      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      {task === 'validate' ? (
        <>
          <ToolPanes>
            <ToolPane label="Schema" htmlFor="json-schema-schema">
              <InputField
                ref={schemaField}
                id="json-schema-schema"
                className={CODE}
                spellCheck={false}
                placeholder='{"type": "object", "properties": {"port": {"type": "integer"}}, "required": ["port"]}'
                value={schema}
                onValueChange={next => editValidate({ schema: next })}
              />
              <ToolMessage tone={schemaTooLong || schemaError ? 'error' : 'note'} role="status" data-field="schema">
                {schemaTooLong ? (
                  TEXTS.schemaTooLong
                ) : schemaError ? (
                  <ErrorLink
                    error={schemaError}
                    part="schema-error"
                    onGo={() => caretTo(schemaField.current, schemaError.offset, schemaError.line)}
                  />
                ) : schemaOk && !blank(schema) ? (
                  [schemaOk.draftLine, ...schemaOk.notes].join(' ')
                ) : (
                  ' '
                )}
              </ToolMessage>
            </ToolPane>
            <ToolPane label="Document" htmlFor="json-schema-document">
              <InputField
                ref={documentField}
                id="json-schema-document"
                className={CODE}
                spellCheck={false}
                placeholder='{"port": 8080}'
                value={document}
                onValueChange={next => editValidate({ document: next })}
              />
              <ToolMessage
                tone={documentTooLong || documentError ? 'error' : 'note'}
                role="status"
                data-field="document">
                {documentTooLong ? (
                  TEXTS.documentTooLong
                ) : documentError ? (
                  <ErrorLink
                    error={documentError}
                    part="document-error"
                    onGo={() => caretTo(documentField.current, documentError.offset, documentError.line)}
                  />
                ) : documentState?.state === 'ok' ? (
                  documentState.notes.join(' ') || ' '
                ) : (
                  ' '
                )}
              </ToolMessage>
            </ToolPane>
          </ToolPanes>

          {problems.length > 0 && (
            <ToolPane
              label="Schema problems"
              data-part="problems"
              actions={
                <CopyButton
                  label="Copy problems"
                  value={schemaOk?.problemsText ?? ''}
                  onCopied={() => commitValidation('copy-problems', problems.length)}
                />
              }>
              <ToolMessage tone="error" role="status" data-field="problems">
                {problems.some(p => p.keywordLocation)
                  ? TEXTS.problems(problems.length, metaDraft)
                  : TEXTS.problemsPlain(problems.length)}
              </ToolMessage>
              <div className="max-h-72 overflow-y-auto">
                <Table aria-label="Schema problems">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-12">#</TableHead>
                      <TableHead>Where</TableHead>
                      <TableHead>Problem</TableHead>
                      <TableHead>Meta-schema</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    <ViolationRows rows={problems} goTo={goToSchema} />
                  </TableBody>
                </Table>
              </div>
            </ToolPane>
          )}

          <section aria-label="Referenced schemas" className="flex flex-col gap-2" data-part="referenced">
            <span className="cn-label">Referenced schemas</span>
            <p className="m-0 text-sm text-muted-foreground">{TEXTS.referencedHint}</p>
            {referenced.map((text, n) => {
              const row = freshSchema ? schemaOk?.referenced[n] : undefined;
              const tooLong = text.length > MAX_SCHEMA;
              return (
                <div key={n} className="flex flex-col gap-1" data-referenced={n}>
                  <div className="flex items-center justify-between gap-2">
                    <Label htmlFor={`json-schema-referenced-${n}`}>{`Referenced schema ${n + 1}`}</Label>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      aria-label={`Remove referenced schema ${n + 1}`}
                      onClick={() => {
                        referencedFields.current.splice(n, 1);
                        editValidate({ referenced: referenced.filter((_, i) => i !== n) });
                      }}>
                      <XIcon aria-hidden="true" />
                    </Button>
                  </div>
                  <InputField
                    ref={el => {
                      referencedFields.current[n] = el;
                    }}
                    id={`json-schema-referenced-${n}`}
                    className="h-40 resize-y font-mono text-code field-sizing-fixed [tab-size:4]"
                    spellCheck={false}
                    placeholder='{"$id": "https://example.com/schemas/address.json", "type": "object"}'
                    value={text}
                    onValueChange={next => editValidate({ referenced: referenced.map((t, i) => (i === n ? next : t)) })}
                  />
                  <ToolMessage
                    tone={tooLong || row?.error ? 'error' : 'note'}
                    role="status"
                    data-field={`referenced-${n}`}>
                    {tooLong ? (
                      TEXTS.schemaTooLong
                    ) : row?.error ? (
                      <ErrorLink
                        error={row.error}
                        part="referenced-error"
                        onGo={() => caretTo(referencedFields.current[n], row.error!.offset, row.error!.line)}
                      />
                    ) : (
                      (row?.note ?? (row?.id ? TEXTS.foundBy(row.id) : ' '))
                    )}
                  </ToolMessage>
                </div>
              );
            })}
            <div>
              <Button
                variant="outline"
                size="sm"
                disabled={referenced.length >= MAX_REFERENCED}
                onClick={() => {
                  const n = referenced.length;
                  editValidate({ referenced: [...referenced, ''] });
                  requestAnimationFrame(() => referencedFields.current[n]?.focus());
                }}>
                <PlusIcon aria-hidden="true" />
                Add a referenced schema
              </Button>
            </div>
          </section>
        </>
      ) : (
        <ToolPanes>
          <ToolPane label="Samples" htmlFor="json-schema-samples">
            <InputField
              ref={samplesField}
              id="json-schema-samples"
              className={CODE}
              spellCheck={false}
              placeholder='{"id": 1, "name": "Ann", "tags": ["a"]}'
              value={samples}
              onValueChange={next => editInfer({ samples: next })}
            />
            <ToolMessage tone={samplesTooLong || samplesError ? 'error' : 'note'} role="status" data-field="samples">
              {samplesTooLong ? (
                TEXTS.samplesTooLong
              ) : samplesError ? (
                <ErrorLink
                  error={samplesError}
                  part="samples-error"
                  onGo={() => caretTo(samplesField.current, samplesError.offset, samplesError.line)}
                />
              ) : (
                ' '
              )}
            </ToolMessage>
          </ToolPane>
          <ToolPane
            label="Schema"
            htmlFor="json-schema-inferred"
            actions={
              <>
                <CopyButton
                  value={inferred?.schema ?? ''}
                  onCopied={() => {
                    if (inferred) void recorder.commit(takenSchema(latest.current.i, 'copy-schema', inferred.samples));
                  }}
                />
                <Button variant="ghost" size="sm" disabled={!inferred} onClick={validateWithIt}>
                  Validate with it
                </Button>
              </>
            }>
            <ResultField id="json-schema-inferred" className={CODE} spellCheck={false} value={inferred?.schema ?? ''} />
            <ToolMessage role="status" data-field="inferred">
              {inferred?.notes.join(' ') || ' '}
            </ToolMessage>
          </ToolPane>
        </ToolPanes>
      )}

      {shown.kind === 'stopped' && job ? (
        <div className="flex flex-wrap items-center gap-2" data-stopped>
          <ToolMessage tone="error">
            {task === 'validate' ? TEXTS.stopped(shown.ms) : TEXTS.stoppedInfer(shown.ms)}
          </ToolMessage>
          {!allowLong && (
            <Button variant="outline" size="sm" onClick={() => setAllowLong(true)}>
              Allow 10 seconds
            </Button>
          )}
          {running}
        </div>
      ) : shown.kind === 'failed' && job ? (
        <ToolMessage tone="error" data-failed>
          {TEXTS.crashed(shown.message)}
        </ToolMessage>
      ) : task === 'validate' && refusal ? (
        <ToolMessage tone="error" data-refused>
          {refusal}
        </ToolMessage>
      ) : task === 'validate' ? (
        <p role="status" className="m-0 flex min-h-5 items-center gap-2 text-sm" data-status>
          <span>{status}</span>
          {running}
        </p>
      ) : (
        running && <p className="m-0 flex min-h-5 items-center gap-2 text-sm">{running}</p>
      )}

      {task === 'validate' && checked && checked.count > 0 && (
        <ToolPane
          label="Violations"
          data-part="violations"
          actions={
            <CopyButton
              label="Copy violations"
              value={checked.text}
              onCopied={() => commitValidation('copy-violations', checked.count)}
            />
          }>
          <div className="max-h-120 overflow-y-auto">
            <Table aria-label="Violations">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-12">#</TableHead>
                  <TableHead>Where</TableHead>
                  <TableHead>Problem</TableHead>
                  <TableHead>Schema</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                <ViolationRows rows={checked.rows} goTo={goToDocument} />
              </TableBody>
            </Table>
          </div>
          <ToolMessage role="status" data-field="violations">
            {[checked.count > MAX_ROWS ? TEXTS.shownRows(checked.count) : '', checked.truncated ? TEXTS.truncated : '']
              .filter(Boolean)
              .join(' ') || ' '}
          </ToolMessage>
        </ToolPane>
      )}
    </div>
  );
};

export default JsonSchemaTool;
