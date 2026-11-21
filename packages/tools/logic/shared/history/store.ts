/**
 * Seam `HistoryStore` — where the tool history's records and blobs live (docs/replaceable-behaviors.md). Implementations:
 * memoryStore.ts (the default: no host, tests, a host without storage) and the extension's IndexedDB store; both pass
 * the one contract suite (contract.ts).
 *
 * The store holds lines, not objects: a record is its exact JSON line (envelope.ts), and the store derives the row it
 * indexes from that line itself. Blobs are content-addressed by hash and kept once, however many records reference
 * them; a blob that no record references any more is removed by the same operation that removed its last record.
 * The store knows nothing of encryption beyond the clear fields: it keeps sealed lines, sealed blobs and the keyrings
 * (wrapped keys) as opaque data.
 */
import type { BlobData, RecordRow } from './envelope';
import type { HistoryFilter } from './filter';

export interface AddResult {
  /** Ids written now. */
  added: string[];
  /** Ids already there with the same line: nothing done. */
  same: string[];
  /** Ids already there with another line: the stored one is kept. */
  conflicts: string[];
}

/** Counts of a filter, or of what an operation removed. Blobs: those only matching records reference. */
export interface Measure {
  records: number;
  recordBytes: number;
  blobs: number;
  blobBytes: number;
}

export interface HistoryStats extends Measure {
  /** ms of the oldest and the newest record. */
  oldest?: number;
  newest?: number;
}

export interface PageCursor {
  time: number;
  id: string;
}

export interface HistoryPage {
  rows: RecordRow[];
  /** Where the next (older) page starts; absent at the end. */
  next?: PageCursor;
}

export interface HistoryStore {
  /**
   * Writes records and the blobs they need, all or nothing. A blob already stored is not written again; a record whose
   * blob is neither given nor stored is refused (the whole call fails). Lines that are not records fail the call.
   */
  add(lines: readonly string[], blobs: readonly BlobData[]): Promise<AddResult>;
  /** Which of these hashes are stored. */
  hasBlobs(hashes: readonly string[]): Promise<Set<string>>;
  get(id: string): Promise<RecordRow | undefined>;
  blob(hash: string): Promise<BlobData | undefined>;
  /** Newest first. */
  page(filter: HistoryFilter, options: { limit: number; before?: PageCursor }): Promise<HistoryPage>;
  /** Oldest first, every matching row — for export and pruning; read in batches, never all at once. */
  scan(filter: HistoryFilter): AsyncIterable<RecordRow>;
  measure(filter: HistoryFilter): Promise<Measure>;
  /** Removes the matching records and the blobs nothing else references; returns what went. */
  delete(filter: HistoryFilter): Promise<Measure>;
  stats(): Promise<HistoryStats>;
  /** Keyrings (wrapped data keys, cipher.ts) as their exact JSON lines, by kid. */
  keyrings(): Promise<Map<string, string>>;
  putKeyring(kid: string, line: string): Promise<void>;
  deleteKeyring(kid: string): Promise<void>;
}

/** Thrown by a store when the browser refuses to store more (quota). */
export class StoreFullError extends Error {}
