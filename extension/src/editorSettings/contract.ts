/**
 * The contract of seam `EditorSettingsStore` (./store.ts): one suite every implementation passes (./store.test.ts runs
 * it on the extension's storage and on the page's memory). It names no implementation: what outlives the page is asked
 * of the harness (`reopen` — the same storage read by a new page), and only where the store says it `keeps`.
 */
import {
  BUILT_IN_LANGUAGES,
  BUILT_IN_VALUES,
  LANGUAGES_MAX,
  RECORD_MAX_CHARS,
  defaultEditorSettings,
  withLanguage,
} from './model';
import { describe, expect, it } from 'vitest';
import type { EditorSettingsRecord } from './model';
import type { EditorSettingsStore } from './store';

export interface EditorSettingsHarness {
  store: EditorSettingsStore;
  /** The same storage as a new page reads it (a reload, the browser's restart). */
  reopen(): EditorSettingsStore;
}

const changed = (): EditorSettingsRecord => ({
  ...withLanguage(defaultEditorSettings(), 'python', { indentSize: 2 }),
  base: { ...BUILT_IN_VALUES, indentStyle: 'tab', indentSize: 8, whitespace: true, fontSize: 15 },
});

export const editorSettingsStoreContract = (name: string, make: () => EditorSettingsHarness): void => {
  describe(`EditorSettingsStore contract: ${name}`, () => {
    it('starts with the Default set: the built-in values and the built-in language rows', async () => {
      const { store } = make();
      const record = await store.load();
      expect(record).toEqual({ version: 1, base: { ...BUILT_IN_VALUES }, languages: BUILT_IN_LANGUAGES });
    });

    it('keeps what is saved and answers with it, normalized', async () => {
      const { store } = make();
      const result = await store.save({ ...changed(), base: { ...changed().base, indentSize: 99 } });
      if (!result.ok) throw new Error(JSON.stringify(result.refused));
      // 99 is past the limit: the field takes its default.
      expect(result.value.base.indentSize).toBe(BUILT_IN_VALUES.indentSize);
      expect(await store.load()).toEqual(result.value);
      expect(result.value.languages.python).toEqual({ indentSize: 2 });
    });

    it(`keeps at most ${LANGUAGES_MAX} language rows, so a record stays far below ${RECORD_MAX_CHARS} characters`, async () => {
      const { store } = make();
      const languages = Object.fromEntries(
        Array.from({ length: LANGUAGES_MAX + 6 }, (_, i) => [
          `l${String(i).padStart(2, '0')}${'x'.repeat(29)}`,
          { indentSize: 2, indentStyle: 'tab' as const, softWrap: true },
        ]),
      );
      const result = await store.save({ ...defaultEditorSettings(), languages });
      if (!result.ok) throw new Error(JSON.stringify(result.refused));
      expect(Object.keys(result.value.languages)).toHaveLength(LANGUAGES_MAX);
      expect(JSON.stringify(await store.load()).length).toBeLessThan(RECORD_MAX_CHARS);
    });

    it('tells a watcher the stored set at once and every change after it, until it stops', async () => {
      const { store } = make();
      const seen: EditorSettingsRecord[] = [];
      const stop = store.watch(record => seen.push(record));
      await expect.poll(() => seen.length).toBe(1);
      expect(seen[0]).toEqual(defaultEditorSettings());
      await store.save(changed());
      await expect.poll(() => seen.length).toBe(2);
      expect(seen[1]?.base.indentStyle).toBe('tab');
      stop();
      await store.save(defaultEditorSettings());
      await new Promise(resolve => setTimeout(resolve, 10));
      expect(seen).toHaveLength(2);
    });

    it('what is kept survives a reload', async () => {
      const harness = make();
      await harness.store.save(changed());
      const again = harness.reopen();
      if (!harness.store.keeps) {
        expect(await again.load()).toEqual(defaultEditorSettings());
        return;
      }
      expect(await again.load()).toEqual(await harness.store.load());
      expect((await again.load()).base).toMatchObject({ indentStyle: 'tab', indentSize: 8, fontSize: 15 });
    });
  });
};
