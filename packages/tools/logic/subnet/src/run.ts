/**
 * What Match and Summarize compute from the fields' text (docs/tools/specs/subnet.md §5 п. 20–22, 27–28, §6): the same
 * code on the page for small lists and in the package's worker for large ones (§12), answers as plain data.
 */
import { formatAddress } from './address';
import { formatBlock, formatRange, rangeOf } from './block';
import { groupDigits } from './explain';
import { addressOf, listErrorText, listNoteText, parseList } from './list';
import { matchAddresses } from './match';
import { summarize } from './summarize';
import type { Range } from './block';
import type { ParsedList } from './list';

/** Up to this many entries and characters a list is computed on the page at each edit; above, in the worker. */
export const LIVE_ENTRIES = 2_000;
export const LIVE_CHARS = 64 * 1024;
export const SETTLE_MS = 300;

/** A rough count of a list's entries without reading it (lines and commas). */
export const roughEntries = (text: string): number => {
  let n = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 10 || c === 44) n++;
  }
  return n;
};

export const isLive = (...texts: string[]): boolean =>
  texts.every(t => t.length <= LIVE_CHARS && roughEntries(t) <= LIVE_ENTRIES);

export interface ListReport {
  /** The first error and the count, or ''. */
  error: string;
  /** Notes, one line each. */
  notes: string[];
  /** The list is over the limits. */
  tooLong?: string;
  entries: number;
}

const report = (list: ParsedList): ListReport => ({
  error: listErrorText(list.errors),
  notes: list.notes.map(listNoteText),
  ...(list.tooLong ? { tooLong: list.tooLong } : {}),
  entries: list.items.length,
});

export interface MatchTableRow {
  address: string;
  block: string | null;
  count: number;
}

export interface MatchResult {
  addresses: ListReport;
  blocks: ListReport;
  rows: MatchTableRow[];
  inside: number;
}

const entryRange = (item: ParsedList['items'][number]): Range =>
  item.entry.kind === 'range' ? item.entry.range : rangeOf(item.entry.block);

const entryText = (item: ParsedList['items'][number]): string =>
  item.entry.kind === 'range' ? formatRange(item.entry.range) : formatBlock(item.entry.block);

export const runMatch = (addressesText: string, blocksText: string): MatchResult => {
  const addressList = parseList(addressesText, { addresses: true });
  const blockList = parseList(blocksText);
  const addresses = addressList.items.map(addressOf);
  const ranges = blockList.items.map(entryRange);
  const matched = blockList.tooLong || addressList.tooLong ? [] : matchAddresses(addresses, ranges);
  const rows = matched.map(m => ({
    address: formatAddress(m.address),
    block: m.best === null ? null : entryText(blockList.items[m.best]!),
    count: m.count,
  }));
  return {
    addresses: report(addressList),
    blocks: report(blockList),
    rows,
    inside: rows.filter(r => r.count > 0).length,
  };
};

/** 'N of M addresses are in a block.' (§5 п. 22). */
export const matchStatus = (inside: number, total: number): string => {
  if (inside === 0) return total === 1 ? 'The address is in no block.' : 'No address is in a block.';
  const of = `${groupDigits(BigInt(inside))} of ${groupDigits(BigInt(total))}`;
  return total === 1 ? `${of} address is in a block.` : `${of} addresses are in a block.`;
};

export type MatchCopy = 'table' | 'inside' | 'outside';

export const matchCopyText = (rows: readonly MatchTableRow[], what: MatchCopy): string => {
  if (what === 'table')
    return ['Address\tBlock\tIn blocks', ...rows.map(r => `${r.address}\t${r.block ?? ''}\t${r.count}`)].join('\n');
  return rows
    .filter(r => (what === 'inside' ? r.count > 0 : r.count === 0))
    .map(r => r.address)
    .join('\n');
};

export interface SummarizeResult {
  list: ListReport;
  /** The blocks, one per line. */
  text: string;
  blocks: number;
  status: string;
  /** Lines that could not be read and are left out. */
  skipped: number;
}

export const runSummarize = (text: string): SummarizeResult => {
  const list = parseList(text);
  const summary = summarize(list.items.map(entryRange));
  const lines = summary.blocks.map(formatBlock);
  const skipped = new Set(list.errors.map(e => e.line)).size;
  const entries = list.items.length;
  const plural = (n: number, one: string, many: string): string => `${groupDigits(BigInt(n))} ${n === 1 ? one : many}`;
  const v4 = summary.addresses[4];
  const v6 = summary.addresses[6];
  const count = (n: bigint): string => `${groupDigits(n)} ${n === 1n ? 'address' : 'addresses'}`;
  const addresses = v4 && v6 ? `${groupDigits(v4)} IPv4 and ${groupDigits(v6)} IPv6 addresses` : count(v4 || v6);
  return {
    list: report(list),
    text: lines.join('\n'),
    blocks: lines.length,
    status: entries
      ? `${plural(entries, 'entry', 'entries')} → ${plural(lines.length, 'block', 'blocks')} · ${addresses}`
      : '',
    skipped,
  };
};

export const skippedText = (skipped: number): string =>
  skipped === 0
    ? ''
    : skipped === 1
      ? '1 line could not be read and is not in the result.'
      : `${groupDigits(BigInt(skipped))} lines could not be read and are not in the result.`;
