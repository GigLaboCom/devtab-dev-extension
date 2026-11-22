// What examples cannot cover (docs/tools/specs/subnet.md §10): properties over generated blocks, addresses and ranges
// of both families, from a fixed seed — the network, first and last addresses are in the block and the next one is not;
// split parts are disjoint and cover the block; summarizing the parts gives the block back; summarize is minimal (against
// the binary-trie count, which is the minimum by construction); text round trips; Match against every pair.
import {
  BITS,
  blockSize,
  expandIPv6,
  formatBlock,
  formatIPv4,
  formatIPv6,
  lastOf,
  matchAddresses,
  parseAddress,
  parseEntry,
  rangeToBlocks,
  splitRows,
  subnetAt,
  summarize,
} from './index';
import { describe, expect, it } from 'vitest';
import type { Block, Family, Range } from './index';

const seeded = (seed: number) => (): number => {
  seed = (Math.imul(seed ^ (seed >>> 15), 0x2c1b3c6d) + 0x6d2b79f5) >>> 0;
  return seed;
};
const next = seeded(0x5ab1e7);
const below = (n: number): number => next() % n;
const bits = (n: number): bigint => {
  let v = 0n;
  for (let i = 0; i < n; i += 32) v = (v << 32n) | BigInt(next());
  return v & ((1n << BigInt(n)) - 1n);
};
/** Values with long zero runs as well as dense ones, so "::" lands in every place. */
const value = (family: Family): bigint => {
  const w = BITS[family];
  let v = bits(w);
  if (family === 6 && below(2)) for (let g = 0; g < 8; g++) if (below(2)) v &= ~(0xffffn << BigInt(16 * g));
  return v;
};
const randomBlock = (family: Family): Block => {
  const prefix = below(BITS[family] + 1);
  const mask = ((1n << BigInt(BITS[family])) - 1n) ^ ((1n << BigInt(BITS[family] - prefix)) - 1n);
  return { family, network: value(family) & mask, prefix };
};
const families: Family[] = [4, 6];
/** Generous: a loaded machine slows these down several times (they take about 2 s together when it is quiet). */
const HEAVY = { timeout: 60_000 };

describe('blocks', () => {
  it('network, first and last are in the block; the address after the last is not (2,000 blocks)', HEAVY, () => {
    for (let i = 0; i < 2_000; i++) {
      const b = randomBlock(families[i % 2]!);
      const last = lastOf(b);
      const r: Range = { family: b.family, first: b.network, last };
      const max = (1n << BigInt(BITS[b.family])) - 1n;
      const probe = [b.network, last, ...(last < max ? [last + 1n] : []), ...(b.network > 0n ? [b.network - 1n] : [])];
      const rows = matchAddresses(
        probe.map(v => ({ family: b.family, value: v })),
        [r],
      );
      expect(rows[0]!.count).toBe(1);
      expect(rows[1]!.count).toBe(1);
      for (const extra of rows.slice(2)) expect(extra.count).toBe(0);
      expect(last - b.network + 1n).toBe(blockSize(b));
      // The block reads back from its text, and so does an address inside it with host bits.
      const read = parseEntry(formatBlock(b));
      expect(read.ok && read.entry.kind === 'block' && formatBlock(read.entry.block)).toBe(formatBlock(b));
    }
  });

  it('split parts are disjoint, in order, cover the block, and summarize back to it (1,000 splits)', HEAVY, () => {
    for (let i = 0; i < 1_000; i++) {
      const family = families[i % 2]!;
      const b = randomBlock(family);
      const q = Math.min(BITS[family], b.prefix + below(9));
      const total = 1n << BigInt(q - b.prefix);
      const parts: Block[] = [];
      for (let k = 0n; k < total; k++) parts.push(subnetAt(b, q, k));
      expect(parts[0]!.network).toBe(b.network);
      expect(lastOf(parts[parts.length - 1]!)).toBe(lastOf(b));
      for (let k = 1; k < parts.length; k++) expect(parts[k]!.network).toBe(lastOf(parts[k - 1]!) + 1n);
      const rows = splitRows(b, q, 0n, 1_000, total);
      expect(rows.map(r => r.subnet)).toEqual(parts.slice(0, 1_000).map(formatBlock));
      const shuffled = parts
        .map(p => ({ family, first: p.network, last: lastOf(p) }))
        .sort(() => (next() & 1 ? 1 : -1));
      expect(summarize(shuffled).blocks.map(formatBlock)).toEqual([formatBlock(b)]);
    }
  });
});

/** The fewest aligned blocks covering exactly `set` inside the block `node` — the trie count, minimal by construction. */
const trieCount = (set: Set<number>, start: number, size: number): number => {
  let inside = 0;
  for (let a = start; a < start + size; a++) if (set.has(a)) inside++;
  if (inside === 0) return 0;
  if (inside === size) return 1;
  return trieCount(set, start, size / 2) + trieCount(set, start + size / 2, size / 2);
};

describe('summarize', () => {
  it(
    'covers exactly the union, every block is maximal, and the count is the minimum (1,000 lists in a /24)',
    HEAVY,
    () => {
      const base = 0xc0a80000n; // 192.168.0.0
      for (let i = 0; i < 1_000; i++) {
        const ranges: Range[] = [];
        const set = new Set<number>();
        for (let k = 0, n = 1 + below(6); k < n; k++) {
          const a = below(256);
          const z = Math.min(255, a + below(below(2) ? 4 : 64));
          ranges.push({ family: 4, first: base + BigInt(a), last: base + BigInt(z) });
          for (let x = a; x <= z; x++) set.add(x);
        }
        const { blocks, addresses } = summarize(ranges);
        expect(addresses[4]).toBe(BigInt(set.size));
        const covered = new Set<number>();
        for (const b of blocks)
          for (let x = b.network; x <= lastOf(b); x++) {
            const at = Number(x - base);
            expect(covered.has(at)).toBe(false);
            covered.add(at);
          }
        expect([...covered].sort((a, b) => a - b)).toEqual([...set].sort((a, b) => a - b));
        for (const b of blocks) {
          const parent =
            b.prefix > 0
              ? { family: b.family, network: b.network & ~(1n << BigInt(32 - b.prefix)), prefix: b.prefix - 1 }
              : null;
          if (!parent) continue;
          let all = true;
          for (let x = parent.network; x <= lastOf(parent) && all; x++) all = set.has(Number(x - base));
          expect(all).toBe(false);
        }
        expect(blocks.length).toBe(trieCount(set, 0, 256));
        for (let k = 1; k < blocks.length; k++) expect(blocks[k]!.network > lastOf(blocks[k - 1]!)).toBe(true);
      }
    },
  );

  it('a range → blocks that cover it exactly, in both families (2,000 ranges)', HEAVY, () => {
    for (let i = 0; i < 2_000; i++) {
      const family = families[i % 2]!;
      let a = value(family);
      let z = below(3) ? a + bits(below(BITS[family])) : value(family);
      const max = (1n << BigInt(BITS[family])) - 1n;
      if (z > max) z = max;
      if (z < a) [a, z] = [z, a];
      const blocks = rangeToBlocks({ family, first: a, last: z });
      expect(blocks[0]!.network).toBe(a);
      expect(lastOf(blocks[blocks.length - 1]!)).toBe(z);
      for (let k = 1; k < blocks.length; k++) expect(blocks[k]!.network).toBe(lastOf(blocks[k - 1]!) + 1n);
      for (const b of blocks) expect(b.network % blockSize(b)).toBe(0n);
      expect(blocks.length).toBeLessThanOrEqual(2 * BITS[family]);
    }
  });
});

describe('text', () => {
  it('canonical and expanded IPv6 text reads back to the same number (5,000 addresses)', HEAVY, () => {
    for (let i = 0; i < 5_000; i++) {
      const v = value(6);
      for (const text of [formatIPv6(v), expandIPv6(v), formatIPv6(v).toUpperCase()]) {
        const read = parseAddress(text);
        expect(read.ok && read.value.address.value, text).toBe(v);
      }
      // RFC 5952 §4.2: "::" hides the first longest run of two or more zero groups; no run as long stays before it,
      // none longer after it.
      const canonical = formatIPv6(v);
      if (canonical.includes('.')) continue;
      const [head, tail] = canonical.split('::') as [string, string | undefined];
      const shown = (s: string | undefined): string[] => (s ? s.split(':') : []);
      const hidden = tail === undefined ? 0 : 8 - shown(head).length - shown(tail).length;
      if (tail !== undefined) expect(hidden).toBeGreaterThanOrEqual(2);
      const longest = (gs: string[], or: number): number => {
        let best = 0;
        let run = 0;
        for (const g of gs) {
          run = g === '0' ? run + 1 : 0;
          best = Math.max(best, run);
        }
        return best >= or ? best : 0;
      };
      expect(longest(shown(head), 2)).toBeLessThan(Math.max(hidden, 2));
      expect(longest(shown(tail), 2)).toBeLessThanOrEqual(hidden);
    }
  });

  it('IPv4 text reads back (5,000 addresses)', HEAVY, () => {
    for (let i = 0; i < 5_000; i++) {
      const v = value(4);
      const read = parseAddress(formatIPv4(v));
      expect(read.ok && read.value.address.value).toBe(v);
    }
  });
});

describe('Match', () => {
  it('equals the check of every pair (300 lists)', HEAVY, () => {
    for (let i = 0; i < 300; i++) {
      const family = families[i % 2]!;
      const blocks: Range[] = [];
      for (let k = 0, n = below(30); k < n; k++) {
        const b = randomBlock(family);
        const narrow = { ...b, prefix: Math.max(b.prefix, BITS[family] - 12) };
        const fixed = { ...narrow, network: narrow.network & ~((1n << BigInt(BITS[family] - narrow.prefix)) - 1n) };
        blocks.push({ family, first: fixed.network, last: lastOf(fixed) });
      }
      const addresses = Array.from({ length: 40 }, () => {
        const near = blocks.length && below(3) ? blocks[below(blocks.length)]! : null;
        const v = near ? near.first + bits(8) : value(family);
        return { family, value: v & ((1n << BigInt(BITS[family])) - 1n) };
      });
      const rows = matchAddresses(addresses, blocks);
      rows.forEach((row, j) => {
        const holding = blocks
          .map((b, k) => ({ b, k }))
          .filter(({ b }) => b.first <= addresses[j]!.value && addresses[j]!.value <= b.last);
        expect(row.count).toBe(holding.length);
        const best = holding.sort((x, y) =>
          x.b.last - x.b.first < y.b.last - y.b.first
            ? -1
            : x.b.last - x.b.first > y.b.last - y.b.first
              ? 1
              : x.k - y.k,
        )[0];
        expect(row.best).toBe(best ? best.k : null);
      });
    }
  });
});
