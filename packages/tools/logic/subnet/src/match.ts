/**
 * Addresses against blocks (docs/tools/specs/subnet.md §5 п. 20–22, 31): for each address the narrowest block that
 * holds it — the longest-prefix choice of a router — and how many hold it. Sorting and one pass, not every pair:
 * the count is two binary searches (starts ≤ a, ends < a); the narrowest is a heap by size from which blocks that ended
 * before the address are dropped for good, since the addresses come in ascending order.
 */
import type { Address, Family } from './address';
import type { Range } from './block';

export interface MatchRow {
  /** Index of the address in the input. */
  index: number;
  address: Address;
  /** Index of the narrowest block that holds it, or null. */
  best: number | null;
  /** How many blocks hold it. */
  count: number;
}

const compare = (a: bigint, b: bigint): number => (a < b ? -1 : a > b ? 1 : 0);

/** How many of the sorted values are ≤ x (`strict`: < x). */
const countBelow = (sorted: readonly bigint[], x: bigint, strict: boolean): number => {
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    const v = sorted[mid]!;
    if (strict ? v < x : v <= x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
};

interface Item {
  size: bigint;
  index: number;
  last: bigint;
}

/** A binary min-heap by (size, index). */
class Heap {
  private readonly items: Item[] = [];
  private less(a: Item, b: Item): boolean {
    return a.size < b.size || (a.size === b.size && a.index < b.index);
  }
  get size(): number {
    return this.items.length;
  }
  top(): Item | undefined {
    return this.items[0];
  }
  push(item: Item): void {
    const h = this.items;
    h.push(item);
    let i = h.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(h[i]!, h[p]!)) break;
      [h[i], h[p]] = [h[p]!, h[i]!];
      i = p;
    }
  }
  pop(): void {
    const h = this.items;
    const last = h.pop()!;
    if (!h.length) return;
    h[0] = last;
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < h.length && this.less(h[l]!, h[m]!)) m = l;
      if (r < h.length && this.less(h[r]!, h[m]!)) m = r;
      if (m === i) break;
      [h[i], h[m]] = [h[m]!, h[i]!];
      i = m;
    }
  }
}

/** One row per address, in the order of `addresses` (§5 п. 21); families never match each other. */
export const matchAddresses = (addresses: readonly Address[], blocks: readonly Range[]): MatchRow[] => {
  const rows: MatchRow[] = addresses.map((address, index) => ({ index, address, best: null, count: 0 }));
  for (const family of [4, 6] as Family[]) {
    const mine = blocks.map((b, index) => ({ ...b, index })).filter(b => b.family === family);
    const points = rows.filter(r => r.address.family === family);
    if (!mine.length || !points.length) continue;
    const starts = mine.map(b => b.first).sort(compare);
    const ends = mine.map(b => b.last).sort(compare);
    const byStart = [...mine].sort((a, b) => compare(a.first, b.first) || a.index - b.index);
    const order = [...points].sort((a, b) => compare(a.address.value, b.address.value) || a.index - b.index);
    const heap = new Heap();
    let next = 0;
    for (const row of order) {
      const x = row.address.value;
      row.count = countBelow(starts, x, false) - countBelow(ends, x, true);
      while (next < byStart.length && byStart[next]!.first <= x) {
        const b = byStart[next++]!;
        heap.push({ size: b.last - b.first, index: b.index, last: b.last });
      }
      while (heap.size && heap.top()!.last < x) heap.pop();
      row.best = row.count ? heap.top()!.index : null;
    }
  }
  return rows;
};
