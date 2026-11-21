/**
 * The contract suite of the `HistoryStore` seam: every implementation runs it (memoryStore.test.ts here, the IndexedDB
 * store in the extension). Written against the interface only.
 */
import { idGenerator, utf8Length } from './bytes';
import { recordLine } from './envelope';
import { describe, expect, it } from 'vitest';
import type { BlobData, HistoryRecord } from './envelope';
import type { HistoryStore } from './store';

const T0 = Date.UTC(2026, 10, 1, 12, 0, 0);
const nextId = idGenerator();

export const hashOf = (n: number) => `sha256-${n.toString(16).padStart(64, '0')}`;

export const blobOf = (n: number, text: string, type = 'text/plain'): BlobData => ({
  hash: hashOf(n),
  size: utf8Length(text),
  type,
  data: new Blob([text], { type }),
});

export const lineOf = (over: Partial<HistoryRecord> & { at?: number } = {}): string => {
  const at = over.at ?? T0;
  const record: HistoryRecord = {
    v: 1,
    id: over.id ?? nextId(at),
    owner: over.owner ?? 'json',
    kind: over.kind ?? 'result',
    session: over.session ?? 'S1',
    time: new Date(at).toISOString(),
    schema: over.schema ?? 1,
    ...(over.label !== undefined ? { label: over.label } : {}),
    ...(over.text !== undefined ? { text: over.text } : {}),
    payload: over.payload ?? { a: 1 },
    ...(over.blobs ? { blobs: over.blobs } : {}),
    ...(over.sealed ? { sealed: over.sealed } : {}),
  };
  return recordLine(record);
};

const all = async (store: HistoryStore) => {
  const out = [];
  for await (const row of store.scan({})) out.push(row);
  return out;
};

export const historyStoreContract = (name: string, make: () => Promise<HistoryStore>): void => {
  describe(`HistoryStore contract: ${name}`, () => {
    it('keeps a record as its exact line and derives the row from it, unknown fields included', async () => {
      const store = await make();
      const line = lineOf({ label: 'Format', text: 'Hello World' }).replace(/}$/, ',"future":{"x":[1,2.50,"é"]}}');
      expect(await store.add([line], [])).toEqual({ added: [JSON.parse(line).id], same: [], conflicts: [] });
      const row = await store.get(JSON.parse(line).id);
      expect(row?.line).toBe(line);
      expect(row).toMatchObject({
        owner: 'json',
        kind: 'result',
        session: 'S1',
        time: T0,
        search: 'format\nhello world',
      });
      expect(row?.lineBytes).toBe(utf8Length(line));
    });

    it('refuses lines that are not records, and a record whose blob is missing — writing nothing', async () => {
      const store = await make();
      await expect(store.add(['{"v":1}'], [])).rejects.toThrow();
      await expect(store.add(['not json'], [])).rejects.toThrow();
      const ok = lineOf();
      const missing = lineOf({ blobs: [{ name: 'input', hash: hashOf(9), size: 3 }] });
      await expect(store.add([ok, missing], [])).rejects.toThrow();
      expect((await store.stats()).records).toBe(0);
    });

    it('keeps one copy of a blob however many records reference it, and removes it with its last record', async () => {
      const store = await make();
      const blob = blobOf(1, 'shared input');
      const ref = [{ name: 'input', hash: blob.hash, size: blob.size, type: 'text/plain' }];
      const a = lineOf({ at: T0, blobs: ref });
      const b = lineOf({ at: T0 + 1000, blobs: ref });
      await store.add([a], [blob]);
      await store.add([b], []);
      expect(await store.stats()).toMatchObject({ records: 2, blobs: 1, blobBytes: blob.size });
      expect(await store.hasBlobs([blob.hash, hashOf(2)])).toEqual(new Set([blob.hash]));
      expect(await (await store.blob(blob.hash))!.data.text()).toBe('shared input');

      expect(await store.measure({ ids: [JSON.parse(a).id] })).toMatchObject({ records: 1, blobs: 0, blobBytes: 0 });
      await store.delete({ ids: [JSON.parse(a).id] });
      expect(await store.stats()).toMatchObject({ records: 1, blobs: 1 });
      const m = await store.measure({});
      expect(m).toMatchObject({ records: 1, blobs: 1, blobBytes: blob.size });
      expect(await store.delete({})).toEqual(m);
      expect(await store.stats()).toMatchObject({ records: 0, blobs: 0, blobBytes: 0, recordBytes: 0 });
      expect(await store.blob(blob.hash)).toBeUndefined();
    });

    it('tells a repeated id with the same line from a conflict, and keeps the stored line', async () => {
      const store = await make();
      const line = lineOf({ label: 'one' });
      const id = JSON.parse(line).id;
      await store.add([line], []);
      const other = line.replace('"one"', '"two"');
      expect(await store.add([line, other], [])).toEqual({ added: [], same: [id], conflicts: [id] });
      expect((await store.get(id))?.line).toBe(line);
    });

    it('pages newest first and filters by owner, kind, time, size, text, session, ids and encryption', async () => {
      const store = await make();
      const lines = [
        lineOf({ at: T0, owner: 'json', kind: 'input', text: 'alpha', session: 'A' }),
        lineOf({ at: T0 + 1, owner: 'json', kind: 'result', text: 'beta', session: 'A' }),
        lineOf({
          at: T0 + 2,
          owner: 'base64',
          kind: 'result',
          text: 'Alphabet',
          session: 'B',
          payload: { big: 'x'.repeat(500) },
        }),
        lineOf({
          at: T0 + 3,
          owner: 'password',
          kind: 'generated',
          session: 'C',
          payload: undefined,
          sealed: { alg: 'A256GCM', kid: 'K1', iv: 'AAAA', ct: 'alpha' },
        }),
      ];
      await store.add(lines, []);
      const ids = lines.map(l => JSON.parse(l).id as string);
      const page = async (f: Parameters<HistoryStore['page']>[0]) =>
        (await store.page(f, { limit: 10 })).rows.map(r => r.id);
      expect(await page({})).toEqual([...ids].reverse());
      expect(await page({ owners: ['json'] })).toEqual([ids[1], ids[0]]);
      expect(await page({ kinds: ['result'] })).toEqual([ids[2], ids[1]]);
      expect(await page({ from: T0 + 1, to: T0 + 3 })).toEqual([ids[2], ids[1]]);
      expect(await page({ text: 'ALPHA' })).toEqual([ids[2], ids[0]]); // never the encrypted one
      expect(await page({ minBytes: 500 })).toEqual([ids[2]]);
      expect(await page({ maxBytes: 300 })).not.toContain(ids[2]);
      expect(await page({ sessions: ['A'] })).toEqual([ids[1], ids[0]]);
      expect(await page({ ids: [ids[3], ids[0]] })).toEqual([ids[3], ids[0]]);
      expect(await page({ sealed: true })).toEqual([ids[3]]);
      expect(await page({ sealed: false })).toHaveLength(3);
      expect((await store.get(ids[3]))?.kid).toBe('K1');

      const first = await store.page({}, { limit: 3 });
      expect(first.rows.map(r => r.id)).toEqual([ids[3], ids[2], ids[1]]);
      expect(first.next).toEqual({ time: T0 + 1, id: ids[1] });
      const second = await store.page({}, { limit: 3, before: first.next });
      expect(second.rows.map(r => r.id)).toEqual([ids[0]]);
      expect(second.next).toBeUndefined();
    });

    it('scans every matching row oldest first, past one batch', async () => {
      const store = await make();
      const lines = Array.from({ length: 700 }, (_, i) => lineOf({ at: T0 + i * 10, kind: i % 2 ? 'a' : 'b' }));
      await store.add(lines, []);
      const rows = await all(store);
      expect(rows.map(r => r.line)).toEqual(lines);
      const bs = [];
      for await (const row of store.scan({ kinds: ['b'] })) bs.push(row.id);
      expect(bs).toHaveLength(350);
    });

    it('measures exactly what a delete removes, and its stats add up', async () => {
      const store = await make();
      const x = blobOf(1, 'x'.repeat(100));
      const y = blobOf(2, 'y'.repeat(50));
      const r1 = lineOf({ at: T0, blobs: [{ hash: x.hash, size: x.size }] });
      const r2 = lineOf({
        at: T0 + 5,
        blobs: [
          { hash: x.hash, size: x.size },
          { hash: y.hash, size: y.size },
        ],
      });
      const r3 = lineOf({ at: T0 + 9 });
      await store.add([r1, r2, r3], [x, y]);
      const stats = await store.stats();
      expect(stats).toMatchObject({ records: 3, blobs: 2, blobBytes: 150, oldest: T0, newest: T0 + 9 });
      expect(stats.recordBytes).toBe(utf8Length(r1) + utf8Length(r2) + utf8Length(r3));
      const filter = { from: T0 + 1 };
      const measure = await store.measure(filter);
      expect(measure).toEqual({ records: 2, recordBytes: utf8Length(r2) + utf8Length(r3), blobs: 1, blobBytes: 50 });
      expect(await store.delete(filter)).toEqual(measure);
      expect(await store.stats()).toMatchObject({ records: 1, blobs: 1, blobBytes: 100 });
    });

    it('keeps keyrings as their lines', async () => {
      const store = await make();
      await store.putKeyring('K1', '{"kid":"K1","x":1}');
      await store.putKeyring('K2', '{"kid":"K2"}');
      await store.putKeyring('K1', '{"kid":"K1","x":2}');
      expect(await store.keyrings()).toEqual(
        new Map([
          ['K1', '{"kid":"K1","x":2}'],
          ['K2', '{"kid":"K2"}'],
        ]),
      );
      await store.deleteKeyring('K2');
      expect([...(await store.keyrings()).keys()]).toEqual(['K1']);
    });

    it('keeps the type and the kid of a blob', async () => {
      const store = await make();
      const sealed: BlobData = {
        hash: `hmac256-${'a'.repeat(64)}`,
        size: 4,
        type: 'application/octet-stream',
        kid: 'K1',
        data: new Blob([new Uint8Array([1, 2, 3, 4])]),
      };
      await store.add(
        [lineOf({ blobs: [{ hash: sealed.hash, size: 4 }], sealed: { alg: 'A256GCM', kid: 'K1', iv: 'A', ct: 'B' } })],
        [sealed],
      );
      const got = await store.blob(sealed.hash);
      expect(got).toMatchObject({ hash: sealed.hash, size: 4, type: 'application/octet-stream', kid: 'K1' });
      expect([...new Uint8Array(await got!.data.arrayBuffer())]).toEqual([1, 2, 3, 4]);
    });
  });
};
