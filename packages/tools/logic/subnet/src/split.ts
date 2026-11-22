/**
 * Splitting a block (docs/tools/specs/subnet.md §5 п. 23–26): into subnets of a prefix length, or into a number of
 * parts — the first power of two not below it. A row is computed from its number, so a page of 1,000 rows costs the
 * same whether the split has 4 subnets or 2^128; the copy is built whole only up to 65,536 rows.
 */
import { BITS, formatValue } from './address';
import { blockSize, formatBlock, lastOf, usableHosts } from './block';
import { groupDigits } from './explain';
import type { Block } from './block';

export const MAX_COPY_ROWS = 65_536;
export const PAGE_ROWS = 1_000;

export type SplitBy = { by: 'prefix'; prefix: number } | { by: 'count'; count: bigint };

export type SplitPlan =
  | { ok: true; prefix: number; count: bigint; /** The number of parts asked, when split by number. */ asked?: bigint }
  | { ok: false; message: string };

const bitLength = (n: bigint): number => (n === 0n ? 0 : n.toString(2).length);

export const planSplit = (block: Block, by: SplitBy): SplitPlan => {
  const bits = BITS[block.family];
  if (by.by === 'prefix') {
    if (by.prefix > bits)
      return { ok: false, message: `An IPv${block.family} prefix length is 0 to ${bits}; this is ${by.prefix}.` };
    if (by.prefix < block.prefix)
      return {
        ok: false,
        message: `A /${by.prefix} is larger than the block /${block.prefix}: choose ${block.prefix} to ${bits}.`,
      };
    return { ok: true, prefix: by.prefix, count: 1n << BigInt(by.prefix - block.prefix) };
  }
  if (by.count < 1n) return { ok: false, message: 'Choose at least 1 subnet.' };
  const size = blockSize(block);
  if (by.count > size)
    return {
      ok: false,
      message: `A /${block.prefix} has ${groupDigits(size)} ${size === 1n ? 'address' : 'addresses'}: it cannot be split into ${groupDigits(by.count)} subnets.`,
    };
  const extra = bitLength(by.count - 1n);
  return { ok: true, prefix: block.prefix + extra, count: 1n << BigInt(extra), asked: by.count };
};

/** Subnet number `index` (from 0) of `block` split at `prefix`. */
export const subnetAt = (block: Block, prefix: number, index: bigint): Block => ({
  family: block.family,
  network: block.network + (index << BigInt(BITS[block.family] - prefix)),
  prefix,
});

export interface SplitRow {
  /** From 0. */
  index: bigint;
  subnet: string;
  first: string;
  last: string;
}

export const splitRows = (block: Block, prefix: number, from: bigint, n: number, total: bigint): SplitRow[] => {
  const rows: SplitRow[] = [];
  for (let k = 0; k < n; k++) {
    const index = from + BigInt(k);
    if (index >= total) break;
    const sub = subnetAt(block, prefix, index);
    rows.push({
      index,
      subnet: formatBlock(sub),
      first: formatValue(sub.family, sub.network),
      last: formatValue(sub.family, lastOf(sub)),
    });
  }
  return rows;
};

/** Every subnet, one CIDR per line — or a table with a header, by tabs; null over MAX_COPY_ROWS. */
export const splitText = (block: Block, prefix: number, table: boolean): string | null => {
  const total = 1n << BigInt(prefix - block.prefix);
  if (total > BigInt(MAX_COPY_ROWS)) return null;
  const lines: string[] = table ? ['Subnet\tFirst address\tLast address'] : [];
  for (const r of splitRows(block, prefix, 0n, MAX_COPY_ROWS, total))
    lines.push(table ? `${r.subnet}\t${r.first}\t${r.last}` : r.subnet);
  return lines.join('\n');
};

/** '4 subnets /26 · 64 addresses each · 62 usable hosts each' (§5 п. 25), with what a split by number left spare. */
export const splitSummary = (block: Block, plan: Extract<SplitPlan, { ok: true }>): string => {
  const sub: Block = { family: block.family, network: block.network, prefix: plan.prefix };
  const size = blockSize(sub);
  const hosts = usableHosts(sub).count;
  const plural = (n: bigint, one: string, many: string): string => `${groupDigits(n)} ${n === 1n ? one : many}`;
  const line = `${plural(plan.count, 'subnet', 'subnets')} /${plan.prefix} · ${plural(size, 'address', 'addresses')} each · ${plural(hosts, 'usable host', 'usable hosts')} each`;
  if (plan.asked === undefined) return line;
  const spare = plan.count - plan.asked;
  const asked = `${plural(plan.asked, 'subnet', 'subnets')} asked: /${plan.prefix} gives ${plural(plan.count, 'subnet', 'subnets')} of ${plural(size, 'address', 'addresses')}`;
  return spare === 0n ? `${asked}.` : `${asked} (${groupDigits(spare)} spare).`;
};
