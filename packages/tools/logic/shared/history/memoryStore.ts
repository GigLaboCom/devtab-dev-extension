/**
 * The in-memory HistoryStore — the default when there is no host (a tool rendered alone keeps its history in the page's
 * memory and loses it on reload), the store of the tests, and the reference the contract suite is written against.
 */
import { rowOf } from './envelope';
import { matches } from './filter';
import type { BlobData, RecordRow } from './envelope';
import type { AddResult, HistoryPage, HistoryStats, HistoryStore, Measure, PageCursor } from './store';

const order = (a: { time: number; id: string }, b: { time: number; id: string }): number =>
  a.time - b.time || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0);

/** Blobs that only `rows` reference among all rows: what deleting `rows` frees. */
export const freedBlobs = (
  rows: readonly RecordRow[],
  totalRefs: (hash: string) => number,
): Map<string, number> /* hash → matching references */ => {
  const within = new Map<string, number>();
  for (const row of rows) for (const hash of row.blobs) within.set(hash, (within.get(hash) ?? 0) + 1);
  for (const [hash, n] of within) if (totalRefs(hash) > n) within.delete(hash);
  return within;
};

export const memoryStore = (): HistoryStore => {
  const rows = new Map<string, RecordRow>();
  const blobs = new Map<string, BlobData>();
  const keyrings = new Map<string, string>();
  const sorted = (): RecordRow[] => [...rows.values()].sort(order);
  const refs = (hash: string): number => [...rows.values()].filter(r => r.blobs.includes(hash)).length;

  const measureRows = (picked: readonly RecordRow[]): Measure => {
    const freed = freedBlobs(picked, refs);
    return {
      records: picked.length,
      recordBytes: picked.reduce((n, r) => n + r.lineBytes, 0),
      blobs: freed.size,
      blobBytes: [...freed.keys()].reduce((n, h) => n + (blobs.get(h)?.size ?? 0), 0),
    };
  };

  return {
    async add(lines, given) {
      const parsed = lines.map(rowOf);
      const offered = new Map(given.map(b => [b.hash, b]));
      for (const row of parsed)
        for (const hash of row.blobs)
          if (!blobs.has(hash) && !offered.has(hash)) throw new Error(`missing blob ${hash}`);
      const result: AddResult = { added: [], same: [], conflicts: [] };
      for (const row of parsed) {
        const existing = rows.get(row.id);
        if (existing) (existing.line === row.line ? result.same : result.conflicts).push(row.id);
        else {
          rows.set(row.id, row);
          result.added.push(row.id);
          for (const hash of row.blobs) if (!blobs.has(hash)) blobs.set(hash, offered.get(hash)!);
        }
      }
      return result;
    },
    async hasBlobs(hashes) {
      return new Set(hashes.filter(h => blobs.has(h)));
    },
    async get(id) {
      return rows.get(id);
    },
    async blob(hash) {
      return blobs.get(hash);
    },
    async page(filter, { limit, before }): Promise<HistoryPage> {
      const all = sorted()
        .reverse()
        .filter(r => matches(filter, r) && (!before || order(r, before) < 0));
      const picked = all.slice(0, limit);
      const last = picked.at(-1);
      return { rows: picked, ...(all.length > limit && last ? { next: { time: last.time, id: last.id } } : {}) };
    },
    async *scan(filter) {
      let after: PageCursor | undefined;
      for (;;) {
        const batch = sorted()
          .filter(r => (!after || order(r, after) > 0) && matches(filter, r))
          .slice(0, 256);
        if (!batch.length) return;
        yield* batch;
        after = batch.at(-1)!;
      }
    },
    async measure(filter) {
      return measureRows(sorted().filter(r => matches(filter, r)));
    },
    async delete(filter) {
      const picked = sorted().filter(r => matches(filter, r));
      const measure = measureRows(picked);
      const freed = freedBlobs(picked, refs);
      for (const r of picked) rows.delete(r.id);
      for (const hash of freed.keys()) blobs.delete(hash);
      return measure;
    },
    async stats(): Promise<HistoryStats> {
      const all = sorted();
      return {
        records: all.length,
        recordBytes: all.reduce((n, r) => n + r.lineBytes, 0),
        blobs: blobs.size,
        blobBytes: [...blobs.values()].reduce((n, b) => n + b.size, 0),
        ...(all.length ? { oldest: all[0].time, newest: all.at(-1)!.time } : {}),
      };
    },
    async keyrings() {
      return new Map(keyrings);
    },
    async putKeyring(kid, line) {
      keyrings.set(kid, line);
    },
    async deleteKeyring(kid) {
      keyrings.delete(kid);
    },
  };
};
