/**
 * The contract suite of seam `ParameterStorage` (parameterStorage.ts): every implementation runs it — the one in
 * memory, the switched-off one and a fake remote here (parameterStorage.test.ts), the extension's over
 * chrome.storage.local in its own tests. Written against the interface alone; a harness opens the storage as another
 * page or device would and looks at the place it keeps things in past it.
 *
 * What an implementation says of itself decides which half of a rule is checked: one that keeps (`keeps: true`) must
 * give back what it took, refuse a stale write and report changes; one that does not must hold nothing, change nothing
 * and report nothing — whatever its place does. A harness of a keeping storage that can make its place refuse writes
 * (`refuse`) or cut a storage off (`cut`) gets the rules of `failed` and `unavailable` checked as well.
 */
import { describe, expect, it } from 'vitest';
import type { ParameterEntry, ParameterStorage, StoredParameters } from './parameterStorage';

export interface ParameterStorageHarness {
  /** The storage as another page — or another device — over the same place gets it. */
  open(): ParameterStorage;
  /** What the place holds for the tool, read past the storage (`undefined`: nothing). */
  held(toolId: string): Promise<unknown>;
  /** Puts a raw value for the tool into the place, past the storage (an older build's record, a damaged one). */
  seed(toolId: string, raw: unknown): Promise<void>;
  /** Resolves when everything on its way has arrived (a storage with a delay). */
  settle(): Promise<void>;
  /** Makes the place refuse writes or take them again — where it can be made to. */
  refuse?(on: boolean): void;
  /** Cuts a storage this harness opened off, or brings it back — where it can be. */
  cut?(storage: ParameterStorage, on: boolean): void;
}

const INDENT: StoredParameters = { schema: 1, values: { indent: 4 } };
const SORTED: StoredParameters = { schema: 1, values: { indent: 4, sortKeys: true } };
const ZONES: StoredParameters = { schema: 2, values: { zones: ['UTC', 'Asia/Tokyo'], operation: 'subtract' } };

/** What a watcher heard: the tool and the parameters of the entry reported (null: removed). */
const listen = (storage: ParameterStorage) => {
  const heard: Array<[string, unknown]> = [];
  const entries: Array<ParameterEntry | undefined> = [];
  const stop = storage.watch((toolId, entry) => {
    heard.push([toolId, entry ? entry.parameters : null]);
    entries.push(entry);
  });
  return { heard, entries, stop };
};

const accepted = async (
  storage: ParameterStorage,
  toolId: string,
  parameters: StoredParameters | undefined,
  base: string | undefined,
): Promise<ParameterEntry | undefined> => {
  const answer = await storage.write(toolId, parameters, base);
  expect(answer.status).toBe('accepted');
  return answer.status === 'accepted' ? answer.entry : undefined;
};

export const parameterStorageContract = (name: string, make: () => ParameterStorageHarness): void => {
  const keeps = make().open().keeps;

  describe(`ParameterStorage contract: ${name} (keeps: ${String(keeps)})`, () => {
    it('a tool with nothing kept reads as nothing', async () => {
      const storage = make().open();
      expect(await storage.read('json')).toBeUndefined();
    });

    it('a write on the condition of there being nothing is accepted and answered with the entry', async () => {
      const storage = make().open();
      const entry = await accepted(storage, 'json', INDENT, undefined);
      expect(entry?.parameters).toEqual(INDENT);
      expect(typeof entry?.revision).toBe('string');
    });

    it('undefined removes the entry', async () => {
      const h = make();
      const storage = h.open();
      const entry = await accepted(storage, 'json', INDENT, undefined);
      expect(await accepted(storage, 'json', undefined, entry?.revision)).toBeUndefined();
      expect(await storage.read('json')).toBeUndefined();
      expect(await h.held('json')).toBeUndefined();
    });

    it.runIf(keeps)(
      'what is accepted is what a read gives — here and in a storage opened later — with the same revision',
      async () => {
        const h = make();
        const storage = h.open();
        const entry = await accepted(storage, 'date-calc', ZONES, undefined);
        expect(await storage.read('date-calc')).toEqual(entry);
        expect(await h.open().read('date-calc')).toEqual(entry);
        expect(await h.held('date-calc')).toEqual(ZONES);
      },
    );

    it.runIf(!keeps)(
      'keeps nothing: a read — here and in a storage opened later — finds nothing, and nothing is written anywhere',
      async () => {
        const h = make();
        const storage = h.open();
        await accepted(storage, 'date-calc', ZONES, undefined);
        expect(await storage.read('date-calc')).toBeUndefined();
        expect(await h.open().read('date-calc')).toBeUndefined();
        expect(await h.held('date-calc')).toBeUndefined();
      },
    );

    it.runIf(keeps)(
      'a write names the revision it was computed from: a stale one changes nothing and is answered with the current entry',
      async () => {
        const h = make();
        const a = h.open();
        const b = h.open();
        const first = await accepted(a, 'json', INDENT, undefined);
        // Computed from there being nothing, while there is an entry.
        expect(await b.write('json', ZONES, undefined)).toEqual({ status: 'conflict', entry: first });
        const second = await accepted(b, 'json', SORTED, first?.revision);
        // Computed from the entry that has just been replaced.
        expect(await a.write('json', ZONES, first?.revision)).toEqual({ status: 'conflict', entry: second });
        expect(await h.held('json')).toEqual(SORTED);
        // Computed from an entry that is gone.
        await accepted(a, 'json', undefined, second?.revision);
        expect(await b.write('json', ZONES, second?.revision)).toEqual({ status: 'conflict', entry: undefined });
        expect(await h.held('json')).toBeUndefined();
      },
    );

    it.runIf(keeps)('a changed entry has another revision; one read twice without a change has the same', async () => {
      const h = make();
      const storage = h.open();
      const first = await accepted(storage, 'json', INDENT, undefined);
      expect((await storage.read('json'))?.revision).toBe(first?.revision);
      expect((await h.open().read('json'))?.revision).toBe(first?.revision);
      const second = await accepted(storage, 'json', SORTED, first?.revision);
      expect(second?.revision).not.toBe(first?.revision);
      expect((await storage.read('json'))?.revision).toBe(second?.revision);
    });

    it.runIf(keeps)('one tool, one entry: a write of one tool leaves every other tool’s entry as it was', async () => {
      const h = make();
      const storage = h.open();
      const json = await accepted(storage, 'json', INDENT, undefined);
      const dates = await accepted(storage, 'date-calc', ZONES, undefined);
      await accepted(storage, 'json', SORTED, json?.revision);
      expect(await storage.read('date-calc')).toEqual(dates);
      await accepted(storage, 'json', undefined, (await storage.read('json'))?.revision);
      expect(await storage.read('date-calc')).toEqual(dates);
      expect(await h.held('date-calc')).toEqual(ZONES);
    });

    it.runIf(keeps)(
      'watch: a change made through another storage is reported with the entry as it is now, tool by tool, in order',
      async () => {
        const h = make();
        const a = h.open();
        const b = h.open();
        const { heard, entries, stop } = listen(b);
        const first = await accepted(a, 'json', INDENT, undefined);
        await accepted(a, 'date-calc', ZONES, undefined);
        const second = await accepted(a, 'json', SORTED, first?.revision);
        await accepted(a, 'json', undefined, second?.revision);
        await h.settle();
        expect(heard).toEqual([
          ['json', INDENT],
          ['date-calc', ZONES],
          ['json', SORTED],
          ['json', null],
        ]);
        expect(entries[0]?.revision).toBe(first?.revision);
        expect(entries[2]?.revision).toBe(second?.revision);
        stop();
        await accepted(a, 'json', INDENT, undefined);
        await h.settle();
        expect(heard).toHaveLength(4);
      },
    );

    it.runIf(!keeps)('watch reports nothing', async () => {
      const h = make();
      const a = h.open();
      const { heard } = listen(h.open());
      const own = listen(a);
      await accepted(a, 'json', INDENT, undefined);
      await h.settle();
      expect(heard).toEqual([]);
      expect(own.heard).toEqual([]);
    });

    it.runIf(keeps)(
      'holds what is there unchecked: a foreign value is an entry with a revision, replaced by a conditional write',
      async () => {
        const h = make();
        await h.seed('curl-to-code', 'garbage');
        await h.seed('json', { schema: 'one', values: [1, 2] });
        const storage = h.open();
        const garbage = await storage.read('curl-to-code');
        expect(garbage?.parameters).toBe('garbage');
        expect((await storage.read('json'))?.parameters).toEqual({ schema: 'one', values: [1, 2] });
        expect((await storage.write('curl-to-code', INDENT, undefined)).status).toBe('conflict');
        await accepted(storage, 'curl-to-code', INDENT, garbage?.revision);
        expect(await h.held('curl-to-code')).toEqual(INDENT);
      },
    );

    it.runIf(keeps && make().refuse !== undefined)(
      'a refused write is answered `failed`, changes nothing, and the next one is taken',
      async () => {
        const h = make();
        const storage = h.open();
        const first = await accepted(storage, 'json', INDENT, undefined);
        h.refuse!(true);
        const answer = await storage.write('json', SORTED, first?.revision);
        expect(answer.status).toBe('failed');
        expect(answer.status === 'failed' && answer.reason).toBeTruthy();
        expect(await h.held('json')).toEqual(INDENT);
        h.refuse!(false);
        expect((await storage.read('json'))?.revision).toBe(first?.revision);
        await accepted(storage, 'json', SORTED, first?.revision);
        expect(await h.held('json')).toEqual(SORTED);
      },
    );

    it.runIf(keeps && make().cut !== undefined)(
      'cut off: a write is answered `unavailable` and changes nothing, a read finds nothing; back in reach, the current entry of each such tool is reported',
      async () => {
        const h = make();
        const elsewhere = h.open();
        const storage = h.open();
        const first = await accepted(storage, 'json', INDENT, undefined);
        await h.settle();
        const { heard } = listen(storage);
        h.cut!(storage, true);
        expect(await storage.write('json', SORTED, first?.revision)).toEqual({ status: 'unavailable' });
        expect(await storage.read('password')).toBeUndefined();
        // Meanwhile a tool changes elsewhere: this storage cannot be told.
        await accepted(elsewhere, 'date-calc', ZONES, undefined);
        await h.settle();
        expect(heard).toEqual([]);
        expect(await h.held('json')).toEqual(INDENT);
        h.cut!(storage, false);
        await h.settle();
        expect([...heard].sort()).toEqual(
          [
            ['json', INDENT],
            ['date-calc', ZONES],
            ['password', null],
          ].sort(),
        );
        await accepted(storage, 'json', SORTED, first?.revision);
      },
    );
  });
};
