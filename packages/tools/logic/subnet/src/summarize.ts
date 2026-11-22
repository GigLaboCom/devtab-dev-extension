/**
 * Summarizing (docs/tools/specs/subnet.md §5 п. 27–28): blocks, addresses and ranges → the fewest CIDR blocks that
 * cover exactly the same addresses. Ranges of one family are sorted, overlapping and adjacent ones merged, and each
 * merged range cut greedily into the largest aligned blocks — the one decomposition whose every block's parent is not
 * inside the union, and the smallest.
 */
import { BITS } from './address';
import type { Family } from './address';
import type { Block, Range } from './block';

const bitLength = (n: bigint): number => (n === 0n ? 0 : n.toString(2).length);

/** The blocks of one range, largest aligned first (Python's `summarize_address_range`). */
export const rangeToBlocks = (range: Range, out: Block[] = []): Block[] => {
  const bits = BITS[range.family];
  let start = range.first;
  for (;;) {
    // The largest block that starts at `start` (its alignment) and does not pass the end.
    let k = start === 0n ? bits : bitLength(start & -start) - 1;
    const room = range.last - start + 1n;
    const fits = bitLength(room) - 1;
    if (fits < k) k = fits;
    out.push({ family: range.family, network: start, prefix: bits - k });
    const next = start + (1n << BigInt(k));
    if (next > range.last) return out;
    start = next;
  }
};

export interface Summary {
  blocks: Block[];
  /** Addresses of the union, by family. */
  addresses: Record<Family, bigint>;
}

const compare = (a: Range, b: Range): number => (a.first < b.first ? -1 : a.first > b.first ? 1 : 0);

/** Merged ranges of one family, ascending: overlapping and adjacent ones joined. */
export const mergeRanges = (ranges: readonly Range[]): Range[] => {
  const sorted = [...ranges].sort(compare);
  const out: Range[] = [];
  for (const r of sorted) {
    const top = out[out.length - 1];
    if (top && r.first <= top.last + 1n) {
      if (r.last > top.last) top.last = r.last;
    } else out.push({ family: r.family, first: r.first, last: r.last });
  }
  return out;
};

export const summarize = (ranges: readonly Range[]): Summary => {
  const blocks: Block[] = [];
  const addresses: Record<Family, bigint> = { 4: 0n, 6: 0n };
  for (const family of [4, 6] as Family[]) {
    for (const merged of mergeRanges(ranges.filter(r => r.family === family))) {
      addresses[family] += merged.last - merged.first + 1n;
      rangeToBlocks(merged, blocks);
    }
  }
  return { blocks, addresses };
};
