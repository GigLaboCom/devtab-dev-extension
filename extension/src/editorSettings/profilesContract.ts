/**
 * The contract of seam `EditorProfilesStore` (./profilesStore.ts): one suite every implementation passes
 * (./profiles.test.ts runs it on the extension's storage, on the page's memory and on "no profiles"). It names no
 * implementation: what an implementation keeps is asked of it (`included`, `keeps`), and what outlives the page of the
 * harness (`reopen`).
 */
import { BUILT_IN_VALUES, builtInSet } from './model';
import { DEFAULT_PROFILE, PROFILES_MAX, createProfile, emptyEditorProfiles } from './profiles';
import { describe, expect, it } from 'vitest';
import type { EditorProfilesRecord } from './profiles';
import type { EditorProfilesStore } from './profilesStore';

export interface EditorProfilesHarness {
  store: EditorProfilesStore;
  /** The same storage as a new page reads it. */
  reopen(): EditorProfilesStore;
}

const withWork = (): EditorProfilesRecord => {
  const made = createProfile(
    emptyEditorProfiles(),
    'Work',
    { ...builtInSet(), base: { ...BUILT_IN_VALUES, indentSize: 2 } },
    'ep_work000001',
  );
  if (!made.ok) throw new Error('not made');
  return { ...made.record, projects: { p_demo0garden: 'ep_work000001' } };
};

export const editorProfilesStoreContract = (name: string, make: () => EditorProfilesHarness): void => {
  describe(`EditorProfilesStore contract: ${name}`, () => {
    it('starts with Default alone, active everywhere', async () => {
      expect(await make().store.load()).toEqual(emptyEditorProfiles());
    });

    it('keeps what is saved where it has profiles, normalized; refuses as an answer where it has none', async () => {
      const { store } = make();
      const result = await store.save({ ...withWork(), active: 'ep_nobody00001' });
      if (!store.included) {
        expect(result).toEqual({ ok: false, refused: { kind: 'excluded' } });
        expect(await store.load()).toEqual(emptyEditorProfiles());
        return;
      }
      if (!result.ok) throw new Error(JSON.stringify(result.refused));
      // The active one named no profile: Default is.
      expect(result.value.active).toBe(DEFAULT_PROFILE);
      expect(result.value.profiles.map(p => [p.id, p.name, p.base.indentSize])).toEqual([['ep_work000001', 'Work', 2]]);
      expect(result.value.projects).toEqual({ p_demo0garden: 'ep_work000001' });
      expect(await store.load()).toEqual(result.value);
    });

    it(`keeps at most ${PROFILES_MAX} profiles, Default counted`, async () => {
      const { store } = make();
      const profiles = Array.from({ length: PROFILES_MAX + 5 }, (_, i) => ({
        id: `ep_many${String(i).padStart(5, '0')}`,
        name: `P${i}`,
        ...builtInSet(),
      }));
      const result = await store.save({ ...emptyEditorProfiles(), profiles });
      if (!store.included) return expect(result.ok).toBe(false);
      if (!result.ok) throw new Error(JSON.stringify(result.refused));
      expect(result.value.profiles).toHaveLength(PROFILES_MAX - 1);
    });

    it('tells a watcher the stored record at once and every change after it, until it stops', async () => {
      const { store } = make();
      const seen: EditorProfilesRecord[] = [];
      const stop = store.watch(record => seen.push(record));
      await expect.poll(() => seen.length).toBe(1);
      expect(seen[0]).toEqual(emptyEditorProfiles());
      await store.save(withWork());
      if (store.included) {
        await expect.poll(() => seen.length).toBe(2);
        expect(seen[1]?.profiles[0]?.name).toBe('Work');
      }
      stop();
      const before = seen.length;
      await store.save(emptyEditorProfiles());
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(seen).toHaveLength(before);
    });

    it('what is kept survives a reload', async () => {
      const harness = make();
      await harness.store.save(withWork());
      const again = harness.reopen();
      const expected = harness.store.keeps ? await harness.store.load() : emptyEditorProfiles();
      expect(await again.load()).toEqual(expected);
    });
  });
};
