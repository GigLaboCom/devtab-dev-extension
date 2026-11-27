/**
 * The contract of seam `ScratchStore` (./store.ts): one suite every implementation passes (./scratch.test.ts runs it on
 * the extension's storage and on the page's memory). It names no implementation: what outlives the page is asked of
 * the harness (`reopen` — the same storage read by a new page), and only where the store says it `keeps`.
 */
import { SCRATCH_MAX_CHARS, SCRATCH_MAX_COUNT, compareNames, fileName } from './store';
import { describe, expect, it } from 'vitest';
import type { ScratchResult, ScratchStore } from './store';

export interface ScratchStoreHarness {
  store: ScratchStore;
  /** The same storage as a new page reads it (a reload, the browser's restart). */
  reopen(): ScratchStore;
}

const value = <T>(result: ScratchResult<T>): T => {
  if (!result.ok) throw new Error(`refused: ${JSON.stringify(result.refused)}`);
  return result.value;
};

export const scratchStoreContract = (name: string, make: () => ScratchStoreHarness): void => {
  describe(`ScratchStore contract: ${name}`, () => {
    it('starts empty, offering plain text', async () => {
      const { store } = make();
      expect(await store.list()).toEqual({ scratches: [], lastLanguage: 'text' });
    });

    it('creates empty scratches named scratch, scratch_1, … in their language, and remembers the last language', async () => {
      const { store } = make();
      const a = value(await store.create('python'));
      const b = value(await store.create('python'));
      const c = value(await store.create('rust'));
      expect([a, b, c].map(fileName)).toEqual(['scratch.py', 'scratch_1.py', 'scratch.rs']);
      expect(new Set([a.id, b.id, c.id]).size).toBe(3);
      expect(await store.read(a.id)).toBe('');
      const list = await store.list();
      expect(list.lastLanguage).toBe('rust');
      const names = list.scratches.map(fileName);
      expect(names).toEqual(['scratch.py', 'scratch_1.py', 'scratch.rs'].sort(compareNames));
    });

    it('a language the editor does not know is plain text', async () => {
      const { store } = make();
      expect(value(await store.create('cobol')).language).toBe('text');
    });

    it('writes the text and its size; reads it back', async () => {
      const { store } = make();
      const a = value(await store.create('json'));
      const written = value(await store.write(a.id, '{ "a": 1 }\n'));
      expect(written.chars).toBe(11);
      expect(written.updatedMs).toBeGreaterThanOrEqual(a.updatedMs);
      expect(await store.read(a.id)).toBe('{ "a": 1 }\n');
    });

    it('renames: the name as typed; a known extension changes the language, another dot stays in the name', async () => {
      const { store } = make();
      const a = value(await store.create('text'));
      expect(fileName(value(await store.rename(a.id, '  notes  ')))).toBe('notes.txt');
      const md = value(await store.rename(a.id, 'readme.md'));
      expect([md.name, md.language, fileName(md)]).toEqual(['readme', 'markdown', 'readme.md']);
      expect(fileName(value(await store.rename(a.id, 'config.local')))).toBe('config.local.md');
      expect(fileName(value(await store.rename(a.id, 'a/b:c')))).toBe('a_b_c.md');
      // Nothing left of the name: it stays as it was.
      expect(fileName(value(await store.rename(a.id, ' .. ')))).toBe('a_b_c.md');
    });

    it('changes the language at any time: the text stays, the extension follows', async () => {
      const { store } = make();
      const a = value(await store.create('text'));
      await store.write(a.id, 'print(1)\n');
      const changed = value(await store.setLanguage(a.id, 'python'));
      expect(fileName(changed)).toBe('scratch.py');
      expect(await store.read(a.id)).toBe('print(1)\n');
      expect((await store.list()).scratches[0]?.language).toBe('python');
    });

    it('deletes a scratch and its text; the others stay', async () => {
      const { store } = make();
      const a = value(await store.create('go'));
      const b = value(await store.create('go'));
      await store.write(a.id, 'package a\n');
      expect((await store.remove(a.id)).ok).toBe(true);
      expect(await store.read(a.id)).toBeNull();
      expect((await store.list()).scratches.map(s => s.id)).toEqual([b.id]);
    });

    it('a deleted scratch is not written, renamed or changed again: it is missing', async () => {
      const { store } = make();
      const a = value(await store.create('go'));
      await store.remove(a.id);
      for (const result of [
        await store.write(a.id, 'x'),
        await store.rename(a.id, 'y'),
        await store.setLanguage(a.id, 'rust'),
      ])
        expect(result).toEqual({ ok: false, refused: { kind: 'missing' } });
      expect((await store.list()).scratches).toEqual([]);
    });

    it(`keeps at most ${SCRATCH_MAX_COUNT} scratches: one more is refused and says so; a deletion makes room`, async () => {
      const { store } = make();
      const made = [];
      for (let i = 0; i < SCRATCH_MAX_COUNT; i++) made.push(value(await store.create('text')));
      expect(await store.create('text')).toEqual({ ok: false, refused: { kind: 'too-many', max: SCRATCH_MAX_COUNT } });
      expect((await store.list()).scratches).toHaveLength(SCRATCH_MAX_COUNT);
      await store.remove(made[0]!.id);
      expect((await store.create('text')).ok).toBe(true);
    });

    it(`keeps a text of at most ${SCRATCH_MAX_CHARS} units: a longer one is refused and the stored one stays`, async () => {
      const { store } = make();
      const a = value(await store.create('text'));
      const fits = 'x'.repeat(SCRATCH_MAX_CHARS);
      expect(value(await store.write(a.id, fits)).chars).toBe(SCRATCH_MAX_CHARS);
      expect(await store.write(a.id, `${fits}y`)).toEqual({
        ok: false,
        refused: { kind: 'too-large', max: SCRATCH_MAX_CHARS, chars: SCRATCH_MAX_CHARS + 1 },
      });
      expect(await store.read(a.id)).toBe(fits);
      expect((await store.list()).scratches[0]?.chars).toBe(SCRATCH_MAX_CHARS);
    });

    it('calls made together run one after another: a rename does not undo an autosave, nor the other way', async () => {
      const { store } = make();
      const a = value(await store.create('text'));
      await Promise.all([store.write(a.id, 'one'), store.rename(a.id, 'renamed'), store.setLanguage(a.id, 'sql')]);
      const [listed] = (await store.list()).scratches;
      expect([listed?.name, listed?.language, listed?.chars]).toEqual(['renamed', 'sql', 3]);
      expect(await store.read(a.id)).toBe('one');
    });

    it('what is kept survives a reload: the list, the names, the languages and the texts', async () => {
      const harness = make();
      const { store } = harness;
      const a = value(await store.create('typescript'));
      await store.write(a.id, 'const a = 1;\n');
      await store.rename(a.id, 'probe');
      const again = harness.reopen();
      if (!store.keeps) {
        expect((await again.list()).scratches).toEqual([]);
        return;
      }
      const list = await again.list();
      expect(list.lastLanguage).toBe('typescript');
      expect(list.scratches.map(fileName)).toEqual(['probe.ts']);
      expect(await again.read(a.id)).toBe('const a = 1;\n');
    });
  });
};
