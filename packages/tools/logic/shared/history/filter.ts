/**
 * The filter model — one shape serves listing, measuring, exporting and deleting, so "what the list shows" is exactly
 * what "export what is shown" writes and "delete what is shown" removes. Every field narrows; an empty filter is the
 * whole history. Matching is on the row (the clear part of a record), so it works on encrypted records too, except
 * `text`, which never matches an encrypted record (its text is inside the ciphertext).
 */
import type { RecordRow } from './envelope';

export interface HistoryFilter {
  /** Owners (tool ids, section ids). */
  owners?: readonly string[];
  kinds?: readonly string[];
  /** ms since the epoch, inclusive. */
  from?: number;
  /** ms since the epoch, exclusive. */
  to?: number;
  /** Record size: its line plus the blobs it references, in bytes; inclusive bounds. */
  minBytes?: number;
  maxBytes?: number;
  /** Case-insensitive substring of the record's label and text. */
  text?: string;
  sessions?: readonly string[];
  ids?: readonly string[];
  /** true: only encrypted records; false: only clear ones. */
  sealed?: boolean;
}

export const recordBytes = (row: RecordRow): number => row.lineBytes + row.blobBytes;

const within = (list: readonly string[] | undefined, value: string): boolean => !list || list.includes(value);

export const matches = (filter: HistoryFilter, row: RecordRow): boolean => {
  if (!within(filter.owners, row.owner) || !within(filter.kinds, row.kind)) return false;
  if (!within(filter.sessions, row.session) || !within(filter.ids, row.id)) return false;
  if (filter.from !== undefined && row.time < filter.from) return false;
  if (filter.to !== undefined && row.time >= filter.to) return false;
  const bytes = recordBytes(row);
  if (filter.minBytes !== undefined && bytes < filter.minBytes) return false;
  if (filter.maxBytes !== undefined && bytes > filter.maxBytes) return false;
  if (filter.sealed !== undefined && filter.sealed !== (row.kid !== undefined)) return false;
  const text = filter.text?.trim().toLowerCase();
  if (text && (row.kid !== undefined || !row.search.includes(text))) return false;
  return true;
};

/** Drops empty fields, so `{owners: []}` does not mean "no owner". */
export const normalizeFilter = (filter: HistoryFilter): HistoryFilter => {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(filter)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) && value.length === 0) continue;
    if (typeof value === 'string' && value.trim() === '') continue;
    out[key] = value;
  }
  return out as HistoryFilter;
};

export const isEverything = (filter: HistoryFilter): boolean => Object.keys(normalizeFilter(filter)).length === 0;
