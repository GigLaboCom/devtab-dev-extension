/**
 * The JSON Query tool's history entries (schema 1): the drafts, their labels for the History list, the search excerpt
 * and the reading of a payload. Kept out of history.ts, which every host page that lists the tools loads.
 */
import { resultCountText, shortQuery } from '@workspace/tool-logic-json-query';
import type { QueryEditPayload, QueryResultPayload } from './history';
import type { HistoryDraft } from '@workspace/tools-host';

export interface QueryState {
  query: string;
  document: string;
}

const ACTION: Record<QueryResultPayload['action'], string> = {
  'copy-values': 'copied values',
  'copy-paths': 'copied paths',
  'copy-value': 'copied a value',
  'copy-path': 'copied a path',
};

const outcomeLabel = (o: QueryEditPayload['outcome']): string =>
  o === undefined ? '' : 'error' in o ? 'error' : resultCountText(o.count).toLowerCase();

/** `$.store.book[*].author · 4 results`, `Edit · 1,234 characters` when there is no query yet. */
export const editLabel = (p: QueryEditPayload, documentLength: number): string =>
  p.query === ''
    ? `Edit · ${documentLength.toLocaleString('en-US')} characters`
    : [shortQuery(p.query), outcomeLabel(p.outcome)].filter(Boolean).join(' · ');

/** `$.store.book[*].author · 4 results · copied values`. */
export const resultLabel = (p: QueryResultPayload): string =>
  [shortQuery(p.query), resultCountText(p.count).toLowerCase(), ACTION[p.action]].join(' · ');

/** What the History list searches: the query and the start of the document. */
export const excerpt = (s: QueryState): string => `${s.query}\n${s.document}`.slice(0, 2000);

const documentBlob = (text: string): Blob => new Blob([text], { type: 'application/json' });

export const editDraft = (s: QueryState, outcome?: QueryEditPayload['outcome']): HistoryDraft => {
  const payload: QueryEditPayload = { query: s.query, ...(outcome ? { outcome } : {}) };
  return {
    kind: 'edit',
    payload,
    label: editLabel(payload, s.document.length),
    text: excerpt(s),
    blobs: { document: documentBlob(s.document) },
  };
};

export const resultDraft = (s: QueryState, action: QueryResultPayload['action'], count: number): HistoryDraft => {
  const payload: QueryResultPayload = { query: s.query, action, count };
  return {
    kind: 'result',
    payload,
    label: resultLabel(payload),
    text: excerpt(s),
    blobs: { document: documentBlob(s.document) },
  };
};

/** The query of a payload of either kind; what is missing or not understood is the empty query. */
export const readQuery = (payload: unknown): string => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Partial<QueryEditPayload>;
  return typeof p.query === 'string' ? p.query : '';
};
