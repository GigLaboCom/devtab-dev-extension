/**
 * The extension's HistoryStore on IndexedDB (seam `HistoryStore`, @workspace/tools-shared/history/store.ts). One
 * database per extension origin — the pages and the service worker see the same one (probe,
 * docs/research/history-storage-probe.md). Blobs are stored as Blobs (Chrome keeps large ones as files of its own).
 *
 *   records   key id; the row derived from the line (rowOf) and the line itself
 *             indexes: time [time, id], owner [owner, time, id], blob (multiEntry on the hashes), kid
 *   blobs     key hash; { hash, size, type, kid?, data: Blob }
 *   keyrings  key kid; { kid, line }
 *   meta      'stats' → { records, recordBytes, blobs, blobBytes }, kept by the same transactions that change them
 *
 * No `chrome.*` here: a second host on the web could take this file as it is.
 */
import {
  freedBlobs,
  isEverything,
  matches,
  normalizeFilter,
  rowOf,
  StoreFullError,
} from '@workspace/tools-shared/history';
import type {
  AddResult,
  BlobData,
  HistoryFilter,
  HistoryPage,
  HistoryStats,
  HistoryStore,
  Measure,
  PageCursor,
  RecordRow,
} from '@workspace/tools-shared/history';

export const HISTORY_DB = 'tool-history';
const VERSION = 1;
const ZERO: Measure = { records: 0, recordBytes: 0, blobs: 0, blobBytes: 0 };
/** Rows a scan reads per transaction, and how many it may pass over without a match before it yields. */
const SCAN_BATCH = 256;
const SCAN_EXAMINE = 4096;

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });

const finished = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error('aborted'));
    tx.onerror = () => reject(tx.error);
  });

const full = (error: unknown): unknown =>
  error instanceof DOMException && error.name === 'QuotaExceededError' ? new StoreFullError(error.message) : error;

export const openHistoryDb = (factory: IDBFactory, name = HISTORY_DB): Promise<IDBDatabase> =>
  new Promise((resolve, reject) => {
    const request = factory.open(name, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      const records = db.createObjectStore('records', { keyPath: 'id' });
      records.createIndex('time', ['time', 'id']);
      records.createIndex('owner', ['owner', 'time', 'id']);
      records.createIndex('blob', 'blobs', { multiEntry: true });
      records.createIndex('kid', 'kid');
      db.createObjectStore('blobs', { keyPath: 'hash' });
      db.createObjectStore('keyrings', { keyPath: 'kid' });
      db.createObjectStore('meta');
    };
    request.onsuccess = () => {
      const db = request.result;
      // Another page upgrades (a newer version of the extension): let it.
      db.onversionchange = () => db.close();
      resolve(db);
    };
    request.onerror = () => reject(request.error);
    request.onblocked = () => reject(new Error('the history database is blocked by an older page'));
  });

/** The browser's IndexedDB, passed in (the tests pass an implementation for Node). */
export interface IndexedDbApi {
  factory: IDBFactory;
  keyRange: typeof IDBKeyRange;
}

export const idbStore = ({ factory, keyRange }: IndexedDbApi, name = HISTORY_DB): HistoryStore => {
  let opening: Promise<IDBDatabase> | undefined;
  const db = (): Promise<IDBDatabase> => {
    opening ??= openHistoryDb(factory, name).catch(error => {
      opening = undefined;
      throw error;
    });
    return opening;
  };

  const readStats = async (tx: IDBTransaction): Promise<Measure> =>
    ((await done(tx.objectStore('meta').get('stats'))) as Measure | undefined) ?? { ...ZERO };

  /**
   * Rows matching `filter`, oldest first, after `after`: at most SCAN_BATCH matches, passing over at most SCAN_EXAMINE
   * rows in one transaction. `last` is the last row looked at (where the next batch starts); absent at the end.
   */
  const batch = async (
    filter: HistoryFilter,
    after?: PageCursor,
  ): Promise<{ rows: RecordRow[]; last?: PageCursor }> => {
    const tx = (await db()).transaction('records');
    const one = filter.owners?.length === 1 ? filter.owners[0] : undefined;
    const lowTime = Math.max(after?.time ?? -Infinity, filter.from ?? -Infinity);
    const highTime = filter.to ?? Infinity;
    if (lowTime >= highTime) return { rows: [] };
    const range = one
      ? keyRange.bound([one, lowTime, ''], [one, highTime, ''], false, true)
      : keyRange.bound([lowTime, ''], [highTime, ''], false, true);
    const index = tx.objectStore('records').index(one ? 'owner' : 'time');
    const rows: RecordRow[] = [];
    let examined = 0;
    let last: PageCursor | undefined;
    await new Promise<void>((resolve, reject) => {
      const request = index.openCursor(range, 'next');
      request.onerror = () => reject(request.error);
      request.onsuccess = () => {
        const cursor = request.result;
        if (!cursor) {
          last = undefined;
          return resolve();
        }
        const row = cursor.value as RecordRow;
        if (!after || row.time > after.time || (row.time === after.time && row.id > after.id)) {
          examined++;
          if (matches(filter, row)) rows.push(row);
          last = { time: row.time, id: row.id };
          if (rows.length >= SCAN_BATCH || examined >= SCAN_EXAMINE) return resolve();
        }
        cursor.continue();
      };
    });
    return { rows, ...(last ? { last } : {}) };
  };

  const scan = async function* (filter: HistoryFilter): AsyncGenerator<RecordRow> {
    const clean = normalizeFilter(filter);
    if (clean.ids) {
      const tx = (await db()).transaction('records');
      const got = await Promise.all(clean.ids.map(id => done(tx.objectStore('records').get(id))));
      const rows = (got.filter(Boolean) as RecordRow[]).filter(r => matches(clean, r));
      rows.sort((a, b) => a.time - b.time || (a.id < b.id ? -1 : 1));
      yield* rows;
      return;
    }
    let after: PageCursor | undefined;
    for (;;) {
      const { rows, last } = await batch(clean, after);
      yield* rows;
      if (!last) return;
      after = last;
    }
  };

  const collect = async (filter: HistoryFilter): Promise<RecordRow[]> => {
    const rows: RecordRow[] = [];
    for await (const row of scan(filter)) rows.push(row);
    return rows;
  };

  const refCount = async (hashes: Iterable<string>): Promise<Map<string, number>> => {
    const tx = (await db()).transaction('records');
    const index = tx.objectStore('records').index('blob');
    const out = new Map<string, number>();
    for (const hash of hashes) out.set(hash, await done(index.count(hash)));
    return out;
  };

  const measureRows = async (rows: readonly RecordRow[]): Promise<Measure> => {
    const counts = await refCount(new Set(rows.flatMap(r => r.blobs)));
    const freed = freedBlobs(rows, h => counts.get(h) ?? 0);
    const tx = (await db()).transaction('blobs');
    const sizes = await Promise.all([...freed.keys()].map(h => done(tx.objectStore('blobs').get(h))));
    return {
      records: rows.length,
      recordBytes: rows.reduce((n, r) => n + r.lineBytes, 0),
      blobs: freed.size,
      blobBytes: sizes.reduce((n, b) => n + ((b as BlobData | undefined)?.size ?? 0), 0),
    };
  };

  return {
    async add(lines, given) {
      const rows = lines.map(rowOf);
      const offered = new Map(given.map(b => [b.hash, b]));
      const tx = (await db()).transaction(['records', 'blobs', 'meta'], 'readwrite');
      const end = finished(tx);
      const result: AddResult = { added: [], same: [], conflicts: [] };
      try {
        const records = tx.objectStore('records');
        const blobs = tx.objectStore('blobs');
        const stats = await readStats(tx);
        const written = new Set<string>();
        for (const row of rows) {
          const existing = (await done(records.get(row.id))) as RecordRow | undefined;
          if (existing) {
            (existing.line === row.line ? result.same : result.conflicts).push(row.id);
            continue;
          }
          for (const hash of row.blobs) {
            if (written.has(hash)) continue;
            const have = await done(blobs.getKey(hash));
            if (have === undefined) {
              const blob = offered.get(hash);
              if (!blob) throw new Error(`missing blob ${hash}`);
              blobs.put({
                hash: blob.hash,
                size: blob.size,
                type: blob.type,
                ...(blob.kid ? { kid: blob.kid } : {}),
                data: blob.data,
              });
              stats.blobs++;
              stats.blobBytes += blob.size;
            }
            written.add(hash);
          }
          records.put(row);
          stats.records++;
          stats.recordBytes += row.lineBytes;
          result.added.push(row.id);
        }
        tx.objectStore('meta').put(stats, 'stats');
      } catch (error) {
        try {
          tx.abort();
        } catch {
          // already finished
        }
        await end.catch(() => undefined);
        throw full(error);
      }
      await end.catch(error => {
        throw full(error);
      });
      return result;
    },

    async hasBlobs(hashes) {
      const tx = (await db()).transaction('blobs');
      const keys = await Promise.all(hashes.map(h => done(tx.objectStore('blobs').getKey(h))));
      return new Set(hashes.filter((_, i) => keys[i] !== undefined));
    },

    async get(id) {
      return (await done((await db()).transaction('records').objectStore('records').get(id))) as RecordRow | undefined;
    },

    async blob(hash) {
      return (await done((await db()).transaction('blobs').objectStore('blobs').get(hash))) as BlobData | undefined;
    },

    async page(filter, { limit, before }): Promise<HistoryPage> {
      const clean = normalizeFilter(filter);
      const tx = (await db()).transaction('records');
      const one = clean.owners?.length === 1 ? clean.owners[0] : undefined;
      const lowTime = clean.from ?? -Infinity;
      const highTime = Math.min(clean.to ?? Infinity, before ? before.time + 1 : Infinity);
      const rows: RecordRow[] = [];
      if (lowTime < highTime) {
        const range = one
          ? keyRange.bound([one, lowTime, ''], [one, highTime, ''], false, true)
          : keyRange.bound([lowTime, ''], [highTime, ''], false, true);
        const index = tx.objectStore('records').index(one ? 'owner' : 'time');
        await new Promise<void>((resolve, reject) => {
          const request = index.openCursor(range, 'prev');
          request.onerror = () => reject(request.error);
          request.onsuccess = () => {
            const cursor = request.result;
            if (!cursor) return resolve();
            const row = cursor.value as RecordRow;
            const older = !before || row.time < before.time || (row.time === before.time && row.id < before.id);
            if (older && matches(clean, row)) rows.push(row);
            if (rows.length > limit) return resolve();
            cursor.continue();
          };
        });
      }
      const picked = rows.slice(0, limit);
      const last = picked.at(-1);
      return { rows: picked, ...(rows.length > limit && last ? { next: { time: last.time, id: last.id } } : {}) };
    },

    scan,

    async measure(filter) {
      // Everything: the kept counts, without reading every row.
      if (isEverything(filter)) return readStats((await db()).transaction('meta'));
      return measureRows(await collect(filter));
    },

    async delete(filter) {
      if (isEverything(filter)) {
        const tx = (await db()).transaction(['records', 'blobs', 'meta'], 'readwrite');
        const end = finished(tx);
        const removed = await readStats(tx);
        tx.objectStore('records').clear();
        tx.objectStore('blobs').clear();
        tx.objectStore('meta').put({ ...ZERO }, 'stats');
        await end;
        return removed;
      }
      const rows = await collect(filter);
      if (!rows.length) return { ...ZERO };
      const candidates = new Set(rows.flatMap(r => r.blobs));
      const tx = (await db()).transaction(['records', 'blobs', 'meta'], 'readwrite');
      const end = finished(tx);
      const removed: Measure = { ...ZERO };
      const records = tx.objectStore('records');
      const blobs = tx.objectStore('blobs');
      const stats = await readStats(tx);
      for (const row of rows) {
        const existing = (await done(records.get(row.id))) as RecordRow | undefined;
        if (!existing) continue;
        records.delete(row.id);
        removed.records++;
        removed.recordBytes += existing.lineBytes;
      }
      for (const hash of candidates) {
        if ((await done(records.index('blob').count(hash))) > 0) continue;
        const blob = (await done(blobs.get(hash))) as BlobData | undefined;
        if (!blob) continue;
        blobs.delete(hash);
        removed.blobs++;
        removed.blobBytes += blob.size;
      }
      tx.objectStore('meta').put(
        {
          records: stats.records - removed.records,
          recordBytes: stats.recordBytes - removed.recordBytes,
          blobs: stats.blobs - removed.blobs,
          blobBytes: stats.blobBytes - removed.blobBytes,
        },
        'stats',
      );
      await end;
      return removed;
    },

    async stats(): Promise<HistoryStats> {
      const tx = (await db()).transaction(['records', 'meta']);
      const stats = await readStats(tx);
      const index = tx.objectStore('records').index('time');
      const first = (await done(index.openCursor(null, 'next')))?.value as RecordRow | undefined;
      const last = (await done(index.openCursor(null, 'prev')))?.value as RecordRow | undefined;
      return { ...stats, ...(first ? { oldest: first.time } : {}), ...(last ? { newest: last.time } : {}) };
    },

    async keyrings() {
      const all = (await done((await db()).transaction('keyrings').objectStore('keyrings').getAll())) as Array<{
        kid: string;
        line: string;
      }>;
      return new Map(all.map(k => [k.kid, k.line]));
    },

    async putKeyring(kid, line) {
      const tx = (await db()).transaction('keyrings', 'readwrite');
      tx.objectStore('keyrings').put({ kid, line });
      await finished(tx);
    },

    async deleteKeyring(kid) {
      const tx = (await db()).transaction('keyrings', 'readwrite');
      tx.objectStore('keyrings').delete(kid);
      await finished(tx);
    },
  };
};
