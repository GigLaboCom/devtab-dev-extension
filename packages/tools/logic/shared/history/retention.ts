/**
 * Seam `RetentionRule` — what the history forgets by itself (docs/replaceable-behaviors.md). The default, `ageAndBudget`:
 * records older than the retention period go; then, while the history is over its size budget, the oldest go until it
 * is back under 90 % of it (so the next write does not prune again at once). Blobs no record references any more go with
 * their last record (the store does that).
 */
import { recordBytes } from './filter';
import type { HistoryStore, Measure } from './store';

export interface RetentionRule {
  prune(store: HistoryStore, now: number): Promise<Measure>;
}

export const DAY_MS = 24 * 60 * 60 * 1000;

const add = (a: Measure, b: Measure): Measure => ({
  records: a.records + b.records,
  recordBytes: a.recordBytes + b.recordBytes,
  blobs: a.blobs + b.blobs,
  blobBytes: a.blobBytes + b.blobBytes,
});

export const ageAndBudget = (limits: () => { maxAgeDays: number; budgetBytes: number }): RetentionRule => ({
  async prune(store, now) {
    const { maxAgeDays, budgetBytes } = limits();
    let removed = await store.delete({ to: now - maxAgeDays * DAY_MS });
    const stats = await store.stats();
    let over = stats.recordBytes + stats.blobBytes - budgetBytes;
    if (over > 0) {
      over += budgetBytes * 0.1;
      const ids: string[] = [];
      // Record bytes plus its blobs as stated: an estimate of what it frees (a shared blob frees less) — enough to stop.
      for await (const row of store.scan({})) {
        ids.push(row.id);
        over -= recordBytes(row);
        if (over <= 0) break;
      }
      if (ids.length) removed = add(removed, await store.delete({ ids }));
    }
    return removed;
  },
});
