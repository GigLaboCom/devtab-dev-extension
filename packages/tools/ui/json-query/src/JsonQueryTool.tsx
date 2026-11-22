/**
 * The JSON Query tool's page (docs/tools/specs/json-query.md §8): a JSONPath query (RFC 9535), a JSON document, and
 * every node the query selects — its normalized path and its value as written. The host wraps it in the kit's
 * ToolPage; this is the body.
 *
 * The query is parsed on the page at every edit (linear, at most 10,000 characters): an error shows at once, with its
 * position and an echo of the query with the place marked, and the results of the last valid query stay — the status
 * line says so. Reading the document and running the query happen in the tool's worker (runner.ts) 150 ms after the
 * last edit, with a limit of 1 s — 10 s once the person allows it — after which the worker is terminated: a query that
 * takes too long never freezes the page. The worker keeps the document's tree, so editing only the query does not read
 * the document again.
 *
 * History (D17, entries.ts): every edit is a snapshot (`recorder.change`), refreshed with the number of results when
 * the run of that edit answers; each copy is committed — the moments something was taken. An entry opened from
 * History comes back as the query and the document, and runs again.
 */
import { Echo } from './Echo';
import { editDraft, readQuery, resultDraft } from './entries';
import { jsonQueryHistory } from './history';
import { ResultRows } from './ResultRows';
import { QueryRunner } from './runner';
import { startJsonQueryWorker } from './startWorker';
import {
  DEBOUNCE_MS,
  detectJsonQuery,
  errorText,
  LONG_TIMEOUT_MS,
  MAX_DOCUMENT,
  MAX_ROWS,
  parseQuery,
  queryNotes,
  resultCountText,
  shortQuery,
  TIMEOUT_MS,
} from '@workspace/tool-logic-json-query';
import { useRestore, useToolHistory } from '@workspace/tools-host';
import { Button } from '@workspace/ui/button';
import { CopyButton } from '@workspace/ui/copy-button';
import { Input } from '@workspace/ui/input';
import { InputField } from '@workspace/ui/input-field';
import { Table, TableBody, TableHead, TableHeader, TableRow } from '@workspace/ui/table';
import { ToolMessage, ToolPane, ToolPanes } from '@workspace/ui/tool-page';
import { CircleAlertIcon } from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { QueryState } from './entries';
import type { QueryEditPayload, QueryResultPayload } from './history';
import type { Taken } from './ResultRows';
import type { JobResult } from './runner';
import type { JsonErrorInfo } from '@workspace/tool-logic-json-query';
import type { ToolProps } from '@workspace/tools-host';
import type { ReactElement } from 'react';

type Ok = Extract<JobResult, { ok: true }>;

/** After this long without an answer the status line says `Running…` (§5 п. 27). */
const SLOW_MS = 300;

const counted = (n: number): string => resultCountText(n).replace(/^No results$/, 'no results');

export const TEXTS = {
  hint: "JSONPath as RFC 9535 defines it: $.name, ['name'], [0], [-1], [0:2], *, .., [?@.price < 10], length(), count(), match(), search(), value().",
  running: 'Running…',
  documentTooLong: 'The document is longer than 16 MB. JSON Query works with up to 16 MB.',
  staleQuery: (n: number, query: string) =>
    n === 0
      ? `The query has an error. The last valid query, ${shortQuery(query)}, gave no results.`
      : `The query has an error. Showing ${counted(n)} of the last valid query: ${shortQuery(query)}`,
  staleDocument: (n: number) =>
    n === 0
      ? 'The document has an error. The last valid document gave no results.'
      : `The document has an error. Showing ${counted(n)} of the last valid document.`,
  stopped: (ms: number) =>
    `Stopped after ${ms === TIMEOUT_MS ? '1 second' : `${ms / 1000} seconds`}: the query takes too long on this document. Descendant queries inside a filter (?@..x) and patterns such as (a+)+ in match() or search() often cause this.`,
  crashed: (message: string) => `The query could not be run: ${message.replace(/\.$/, '')}.`,
  shownRows: (n: number) => `Showing ${MAX_ROWS.toLocaleString('en-US')} of ${n.toLocaleString('en-US')} results.`,
  valuesTooLarge: 'The values are longer than 16 MB together: narrow the query to copy them.',
  pathsTooLarge: 'The paths are longer than 16 MB together: narrow the query to copy them.',
  lonePath: 'A path holds a lone surrogate (\\ud800): RFC 9535 cannot write it, so this path is not a valid query.',
} as const;

/** What the page shows of the last run that answered. */
type Shown =
  | { kind: 'none' }
  | { kind: 'result'; result: Ok; query: string; docId: number }
  | { kind: 'stopped'; ms: number }
  | { kind: 'refused'; message: string }
  | { kind: 'failed'; message: string };

const NONE: Shown = { kind: 'none' };

let documents = 0;

const JsonQueryTool = ({ input: initial, host, restore }: ToolProps): ReactElement => {
  const [query, setQuery] = useState(() => (initial && detectJsonQuery(initial) ? initial : ''));
  const [document, setDocument] = useState(() => (initial && !detectJsonQuery(initial) ? initial : ''));
  const [allowLong, setAllowLong] = useState(false);
  const [shown, setShown] = useState<Shown>(NONE);
  const [docError, setDocError] = useState<{ docId: number; error: JsonErrorInfo } | null>(null);
  const [slow, setSlow] = useState(false);
  const [restored, setRestored] = useState<string | null>(null);
  const { history, recorder } = useToolHistory(host, 'json-query', jsonQueryHistory);

  const latest = useRef<QueryState>({ query, document });
  latest.current = { query, document };
  /** The person changed something since the last restore: their runs refresh the snapshot. */
  const edited = useRef(false);
  const queryField = useRef<HTMLInputElement>(null);
  const documentField = useRef<HTMLTextAreaElement>(null);

  const parsed = useMemo(() => (query === '' ? null : parseQuery(query)), [query]);
  const notes = useMemo(() => (parsed?.ok ? queryNotes(parsed.query) : []), [parsed]);
  const blank = useMemo(() => !/\S/.test(document), [document]);
  const docId = useMemo(() => {
    void document;
    return ++documents;
  }, [document]);
  const tooLong = document.length > MAX_DOCUMENT;
  const request = useMemo(
    () => (parsed?.ok && !blank && !tooLong ? { docId, document, query } : null),
    [parsed, blank, tooLong, docId, document, query],
  );
  /** With no request: clear the results (nothing to query) or keep them (the query is being typed). */
  const keep = parsed !== null && !parsed.ok && !blank && !tooLong;
  const limit = allowLong ? LONG_TIMEOUT_MS : TIMEOUT_MS;

  const runner = useRef<QueryRunner | null>(null);
  useEffect(() => () => runner.current?.dispose(), []);

  useEffect(() => {
    // A new edit cancels the run in flight at once (its worker is terminated).
    runner.current?.cancel();
    setSlow(false);
    if (!request) {
      if (!keep) setShown(NONE);
      return;
    }
    // A stop or a failure was about the input before this edit: it goes; results stay until the new ones come.
    setShown(s => (s.kind === 'result' || s.kind === 'none' ? s : NONE));
    let live = true;
    let slowTimer: ReturnType<typeof setTimeout> | undefined;
    const send = setTimeout(() => {
      runner.current ??= new QueryRunner(startJsonQueryWorker);
      slowTimer = setTimeout(() => live && setSlow(true), SLOW_MS);
      void runner.current.run(request, limit).then(outcome => {
        if (!live || outcome.kind === 'cancelled') return;
        clearTimeout(slowTimer);
        setSlow(false);
        let summary: QueryEditPayload['outcome'];
        if (outcome.kind === 'timeout') setShown({ kind: 'stopped', ms: limit });
        else if (outcome.kind === 'crashed') setShown({ kind: 'failed', message: outcome.message });
        else if (outcome.result.ok) {
          const result = outcome.result;
          setShown({ kind: 'result', result, query: request.query, docId: request.docId });
          setDocError(null);
          summary = { count: result.count };
        } else if (outcome.result.where === 'document') {
          setDocError({ docId: request.docId, error: outcome.result.error });
          summary = { error: outcome.result.error.message };
        } else {
          setShown({ kind: 'refused', message: outcome.result.message });
          summary = { error: outcome.result.message };
        }
        if (edited.current && summary) recorder.change(editDraft(latest.current, summary));
      });
    }, DEBOUNCE_MS);
    return () => {
      live = false;
      clearTimeout(send);
      clearTimeout(slowTimer);
    };
  }, [request, keep, limit, recorder]);

  const edit = (next: Partial<QueryState>): void => {
    const s = { ...latest.current, ...next };
    latest.current = s;
    if (next.query !== undefined) setQuery(next.query);
    if (next.document !== undefined) setDocument(next.document);
    setAllowLong(false);
    setRestored(null);
    edited.current = true;
    if (/\S/.test(s.document) && s.document.length <= MAX_DOCUMENT) {
      const p = s.query === '' ? null : s.query === query ? parsed : parseQuery(s.query);
      recorder.change(editDraft(s, p && !p.ok ? { error: p.error.message } : undefined));
    }
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
    const nextQuery = readQuery(opened.payload);
    void (opened.blobs.document?.text() ?? Promise.resolve('')).then(nextDocument => {
      edited.current = false;
      latest.current = { query: nextQuery, document: nextDocument };
      setQuery(nextQuery);
      setDocument(nextDocument);
      setAllowLong(false);
      setRestored(`Opened from History: ${opened.label ?? 'an entry'}.`);
    });
  });

  const result = shown.kind === 'result' ? shown : null;
  const count = result?.result.count ?? 0;

  const commit = useCallback(
    (action: QueryResultPayload['action']): void => {
      const s = latest.current;
      if (!/\S/.test(s.document) || s.document.length > MAX_DOCUMENT) return;
      void recorder.commit(resultDraft(s, action, count));
    },
    [recorder, count],
  );
  const onTaken = useCallback((action: Taken) => commit(action), [commit]);

  const selectError = (start: number, end: number): void => {
    const el = queryField.current;
    if (!el) return;
    el.focus();
    el.setSelectionRange(start, end);
  };

  const goToDocument = (error: JsonErrorInfo): void => {
    const el = documentField.current;
    if (!el) return;
    // Focus and caret on the place; the field scrolls to its line (a third from the top), as the JSON tool does.
    el.focus();
    el.setSelectionRange(error.offset, error.offset);
    const height = Number.parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.scrollTop = Math.max(0, (error.line - 1) * height - el.clientHeight / 3);
  };

  const queryError = parsed && !parsed.ok ? parsed.error : null;
  const currentDocError = docError && docError.docId === docId ? docError.error : null;

  let status = '';
  if (result && (request || keep)) {
    if (queryError) status = TEXTS.staleQuery(count, result.query);
    else if (currentDocError) status = TEXTS.staleDocument(count);
    else status = resultCountText(count);
  }

  const documentNotes = result && result.docId === docId && !currentDocError ? result.result.notes : [];
  const resultLines: string[] = [];
  if (result) {
    if (count > MAX_ROWS) resultLines.push(TEXTS.shownRows(count));
    if (count > 0 && !result.result.valuesComplete) resultLines.push(TEXTS.valuesTooLarge);
    if (count > 0 && result.result.paths === null) resultLines.push(TEXTS.pathsTooLarge);
    if (result.result.lonePath) resultLines.push(TEXTS.lonePath);
  }
  const rows = result?.result.rows ?? [];
  const values = result?.result.values ?? '';

  return (
    <div className="flex flex-col gap-3">
      {restored && <ToolMessage data-restored>{restored}</ToolMessage>}

      <ToolPane label="Query" htmlFor="json-query-query">
        <Input
          ref={queryField}
          id="json-query-query"
          className="font-mono text-code"
          spellCheck={false}
          autoComplete="off"
          placeholder="$.store.book[?@.price < 10].title"
          value={query}
          onChange={e => edit({ query: e.target.value })}
          aria-invalid={queryError ? true : undefined}
          aria-describedby="json-query-hint json-query-message"
        />
        <p id="json-query-hint" className="m-0 text-sm text-muted-foreground">
          {TEXTS.hint}
        </p>
        {/* Live while typing: read out politely (status), not as an alert on every keystroke (the recipe, §5). */}
        <ToolMessage id="json-query-message" tone={queryError ? 'error' : 'note'} role="status" data-field="query">
          {queryError ? (
            queryError.start < 0 ? (
              errorText(queryError)
            ) : (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-left whitespace-normal text-destructive"
                data-part="error"
                onClick={() => selectError(queryError.start, queryError.end)}>
                <CircleAlertIcon aria-hidden="true" />
                {errorText(queryError)}
              </Button>
            )
          ) : (
            notes.join(' ') || ' '
          )}
        </ToolMessage>
        {queryError && queryError.start >= 0 && <Echo query={query} error={queryError} />}
      </ToolPane>

      {shown.kind === 'stopped' && request ? (
        <div className="flex flex-wrap items-center gap-2" data-stopped>
          <ToolMessage tone="error">{TEXTS.stopped(shown.ms)}</ToolMessage>
          {!allowLong && (
            <Button variant="outline" size="sm" onClick={() => setAllowLong(true)}>
              Allow 10 seconds
            </Button>
          )}
          {slow && <span className="text-sm text-muted-foreground">{TEXTS.running}</span>}
        </div>
      ) : shown.kind === 'failed' && request ? (
        <ToolMessage tone="error" data-failed>
          {TEXTS.crashed(shown.message)}
        </ToolMessage>
      ) : shown.kind === 'refused' && request ? (
        <ToolMessage tone="error" data-refused>
          {shown.message}
        </ToolMessage>
      ) : (
        <p role="status" className="m-0 flex min-h-5 items-center gap-2 text-sm" data-status>
          <span>{status}</span>
          {slow && <span className="text-muted-foreground">{TEXTS.running}</span>}
        </p>
      )}

      <ToolPanes>
        <ToolPane label="Document" htmlFor="json-query-document">
          <InputField
            ref={documentField}
            id="json-query-document"
            className="h-90 resize-y font-mono text-code field-sizing-fixed [tab-size:4]"
            spellCheck={false}
            placeholder='{"store": {"book": [{"title": "Sayings of the Century", "price": 8.95}]}}'
            value={document}
            onValueChange={next => edit({ document: next })}
          />
          <ToolMessage tone={tooLong || currentDocError ? 'error' : 'note'} role="status" data-field="document">
            {tooLong ? (
              TEXTS.documentTooLong
            ) : currentDocError ? (
              <Button
                variant="link"
                size="sm"
                className="h-auto p-0 text-left whitespace-normal text-destructive"
                data-part="document-error"
                onClick={() => goToDocument(currentDocError)}>
                <CircleAlertIcon aria-hidden="true" />
                {`Line ${currentDocError.line}, column ${currentDocError.column}: ${currentDocError.message}`}
              </Button>
            ) : (
              documentNotes.join(' ') || ' '
            )}
          </ToolMessage>
        </ToolPane>
        <ToolPane
          label="Results"
          actions={
            <>
              <CopyButton
                label="Copy values"
                value={result && result.result.valuesComplete ? values : ''}
                onCopied={() => commit('copy-values')}
              />
              <CopyButton label="Copy paths" value={result?.result.paths ?? ''} onCopied={() => commit('copy-paths')} />
            </>
          }>
          {rows.length > 0 && (
            <div className="max-h-90 overflow-y-auto" data-part="results">
              <Table aria-label="Results">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Path</TableHead>
                    <TableHead>Value</TableHead>
                    <TableHead className="w-16">
                      <span className="sr-only">Copy</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody className="font-mono text-code">
                  <ResultRows rows={rows} values={values} onTaken={onTaken} />
                </TableBody>
              </Table>
            </div>
          )}
          <ToolMessage role="status" data-field="results">
            {resultLines.join(' ') || ' '}
          </ToolMessage>
        </ToolPane>
      </ToolPanes>
    </div>
  );
};

export default JsonQueryTool;
