/**
 * The Subnet Calculator's history entries (schema 1 of `subnetHistory`): the drafts with their labels for the History
 * list and what is searched, and the reading of an entry back into the page. Loaded with the component.
 */
import { groupDigits } from '@workspace/tool-logic-subnet';
import type { ExplainPayload, MatchPayload, SplitPayload, SummarizePayload } from './history';
import type { HistoryDraft } from '@workspace/tools-host';

export type Task = 'explain' | 'match' | 'split' | 'summarize';

const clip = (text: string, n = 60): string => (text.length > n ? `${text.slice(0, n - 1)}…` : text);

const plural = (n: number | bigint, one: string, many: string): string =>
  `${groupDigits(BigInt(n))} ${BigInt(n) === 1n ? one : many}`;

const textBlob = (text: string): Blob => new Blob([text], { type: 'text/plain' });

/** `10.0.12.5/22 · 10.0.12.0/22 · Private-Use`. */
export const explainDraft = (block: string, network: string, kind: string): HistoryDraft => {
  const payload: ExplainPayload = { block, network };
  const typed = block.trim();
  return {
    kind: 'explain',
    payload,
    label: [clip(typed), ...(typed === network ? [] : [network]), kind].join(' · '),
    text: `${typed}\n${network}`.slice(0, 2000),
  };
};

/** `Split 10.0.0.0/8 into /24 · 65,536 subnets`. */
export const splitDraft = (payload: SplitPayload, network: string, prefix: number): HistoryDraft => ({
  kind: 'split',
  payload,
  label: `Split ${network} into /${prefix} · ${plural(BigInt(payload.subnets), 'subnet', 'subnets')}`,
  text: `${payload.block.trim()}\n${network}`.slice(0, 2000),
});

/** `Match 3 addresses against 3 blocks · 2 inside`. */
export const matchDraft = (addresses: string, blocks: string, payload: MatchPayload): HistoryDraft => ({
  kind: 'match',
  payload,
  label: `Match ${plural(payload.addresses, 'address', 'addresses')} against ${plural(payload.blocks, 'block', 'blocks')} · ${groupDigits(BigInt(payload.inside))} inside`,
  text: `${addresses.slice(0, 1000)}\n${blocks.slice(0, 1000)}`,
  blobs: { addresses: textBlob(addresses), blocks: textBlob(blocks) },
});

/** `Summarize 4 entries → 2 blocks`. */
export const summarizeDraft = (list: string, payload: SummarizePayload): HistoryDraft => ({
  kind: 'summarize',
  payload,
  label: `Summarize ${plural(payload.entries, 'entry', 'entries')} → ${plural(payload.blocks, 'block', 'blocks')}`,
  text: list.slice(0, 2000),
  blobs: { list: textBlob(list) },
});

const str = (v: unknown): string => (typeof v === 'string' ? v : '');

/** What an opened entry puts back: the task and its fields (what is missing reads as empty). */
export interface Restored {
  task: Task;
  block?: string;
  by?: 'prefix' | 'count';
  prefix?: string;
  count?: string;
}

export const readEntry = (kind: string, payload: unknown): Restored => {
  const p = (payload && typeof payload === 'object' ? payload : {}) as Record<string, unknown>;
  if (kind === 'split')
    return {
      task: 'split',
      block: str(p.block),
      by: p.by === 'count' ? 'count' : 'prefix',
      prefix: str(p.prefix),
      count: str(p.count),
    };
  if (kind === 'match') return { task: 'match' };
  if (kind === 'summarize') return { task: 'summarize' };
  return { task: 'explain', block: str(p.block) };
};
