/**
 * Seam `EditorSettingsStore` (D39): its contract (./contract.ts) on both implementations — the extension's storage (over
 * an area shaped as `chrome.storage.local`) and the page's memory — and what only the storage meets: the one record and
 * its key, a full area, a record of another shape or version, other records left alone. The model's reading of a
 * record (`normalizeEditorSettings`, `migrateEditorSettings`) and the language rows' helpers.
 */
import { editorSettingsStoreContract } from './contract';
import {
  BUILT_IN_LANGUAGES,
  BUILT_IN_VALUES,
  FONT_SIZE_MAX,
  INDENT_SIZE_MAX,
  LANGUAGES_MAX,
  defaultEditorSettings,
  languageChanged,
  migrateEditorSettings,
  normalizeEditorSettings,
  withLanguage,
  withLanguageReset,
} from './model';
import { EDITOR_SETTINGS_KEY, areaEditorSettings, memoryEditorArea, memoryEditorSettings } from './storage';
import { describe, expect, it } from 'vitest';
import type { EditorSettingsArea } from './storage';

const stored = (area: EditorSettingsArea) => areaEditorSettings(area, { id: 'chrome-storage-local', keeps: true });

editorSettingsStoreContract('the extension’s storage', () => {
  const area = memoryEditorArea();
  return { store: stored(area), reopen: () => stored(area) };
});

editorSettingsStoreContract('the page’s memory', () => ({
  store: memoryEditorSettings(),
  reopen: () => memoryEditorSettings(),
}));

describe('the extension’s storage', () => {
  it('keeps one record, `editorSettings`, with its version, and leaves every other record alone', async () => {
    const area = memoryEditorArea();
    area.rows.set('keyShortcuts', { version: 2, keys: {} });
    area.rows.set('editorProfiles', { version: 1, profiles: [{ id: 'p_1', name: 'Work' }] });
    const store = stored(area);
    await store.save({ ...defaultEditorSettings(), base: { ...BUILT_IN_VALUES, indentSize: 2 } });
    expect([...area.rows.keys()].sort()).toEqual(['editorProfiles', EDITOR_SETTINGS_KEY, 'keyShortcuts'].sort());
    expect(area.rows.get(EDITOR_SETTINGS_KEY)).toMatchObject({ version: 1, base: { indentSize: 2 } });
    expect(area.rows.get('editorProfiles')).toEqual({ version: 1, profiles: [{ id: 'p_1', name: 'Work' }] });
    // Nothing is written by reading or watching.
    const fresh = memoryEditorArea();
    const stop = stored(fresh).watch(() => undefined);
    await stored(fresh).load();
    stop();
    expect(fresh.rows.size).toBe(0);
  });

  it('a full storage refuses plainly and keeps what was stored', async () => {
    let full = false;
    const area = memoryEditorArea(() => (full ? new Error('QUOTA_BYTES quota exceeded') : null));
    const store = stored(area);
    await store.save({ ...defaultEditorSettings(), base: { ...BUILT_IN_VALUES, indentStyle: 'tab' } });
    full = true;
    const answer = await store.save(defaultEditorSettings());
    expect(answer).toEqual({ ok: false, refused: { kind: 'full' } });
    expect((await store.load()).base.indentStyle).toBe('tab');
    const other = stored(memoryEditorArea(() => new Error('IO error')));
    expect(await other.save(defaultEditorSettings())).toEqual({
      ok: false,
      refused: { kind: 'failed', message: 'IO error' },
    });
  });

  it('a change made on another page reaches a watcher here', async () => {
    const area = memoryEditorArea();
    const here = stored(area);
    const seen: number[] = [];
    here.watch(record => seen.push(record.base.indentSize));
    await expect.poll(() => seen).toEqual([4]);
    await stored(area).save({ ...defaultEditorSettings(), base: { ...BUILT_IN_VALUES, indentSize: 3 } });
    await expect.poll(() => seen).toEqual([4, 3]);
    // Another key, or another area, is not this record.
    area.onChanged.addListener(() => undefined);
    await area.area.set({ keyShortcuts: {} });
    expect(seen).toEqual([4, 3]);
  });
});

describe('the stored record as this build reads it', () => {
  it('nothing stored, or nothing readable: the Default set as it starts', () => {
    for (const raw of [undefined, null, 'x', 4, []])
      expect(normalizeEditorSettings(raw)).toEqual(defaultEditorSettings());
    expect(migrateEditorSettings(undefined)).toBeNull();
  });

  it('each field of its type and within the limits; the rest its default, nothing guessed', () => {
    const record = normalizeEditorSettings({
      version: 1,
      base: {
        indentStyle: 'banana',
        indentSize: INDENT_SIZE_MAX + 1,
        detectIndent: 'yes',
        fontSize: FONT_SIZE_MAX + 1,
        softWrap: true,
        whitespace: 1,
        indentGuides: false,
        lineNumbers: null,
        unknown: 'kept? no',
      },
      languages: {
        go: { indentStyle: 'tab', indentSize: 0, softWrap: 'no' },
        python: { indentSize: 2, theme: 'dark' },
        'Not An Id': { indentSize: 2 },
        kotlin: 'tabs',
        // A language of a newer build: kept, not applied here.
        zig: { indentSize: 4 },
      },
    });
    expect(record.base).toEqual({ ...BUILT_IN_VALUES, softWrap: true, indentGuides: false });
    expect(record.languages).toEqual({ go: { indentStyle: 'tab' }, python: { indentSize: 2 }, zig: { indentSize: 4 } });
    expect(normalizeEditorSettings({ base: { fontSize: 14 } }).base.fontSize).toBe(14);
    expect(normalizeEditorSettings({ base: { fontSize: 14.5 } }).base.fontSize).toBeNull();
  });

  it(`at most ${LANGUAGES_MAX} language rows`, () => {
    const languages = Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`l${i}`, { indentSize: 2 }]));
    expect(Object.keys(normalizeEditorSettings({ languages }).languages)).toHaveLength(LANGUAGES_MAX);
  });

  it('a record of a newer version is read as far as this build understands it', () => {
    const record = normalizeEditorSettings({ version: 7, base: { indentSize: 2, ruler: 80 }, languages: {} });
    expect(record).toEqual({ version: 1, base: { ...BUILT_IN_VALUES, indentSize: 2 }, languages: {} });
  });
});

describe('language rows', () => {
  it('set, reset to the built-in row, and whether a reset would change anything', () => {
    const start = defaultEditorSettings();
    expect(Object.keys(BUILT_IN_LANGUAGES).some(id => languageChanged(start, id))).toBe(false);
    const go = withLanguage(start, 'go', { indentStyle: 'space', indentSize: 2 });
    expect(go.languages.go).toEqual({ indentStyle: 'space', indentSize: 2 });
    expect(languageChanged(go, 'go')).toBe(true);
    expect(withLanguageReset(go, 'go').languages.go).toEqual({ indentStyle: 'tab' });
    // A language without a built-in row: a row is a change; reset removes it.
    const py = withLanguage(start, 'python', {});
    expect(languageChanged(py, 'python')).toBe(true);
    expect('python' in withLanguageReset(py, 'python').languages).toBe(false);
    // An emptied built-in row stays (it says: the general values) and differs from the built-in one.
    const emptied = withLanguage(start, 'yaml', {});
    expect(emptied.languages.yaml).toEqual({});
    expect(languageChanged(emptied, 'yaml')).toBe(true);
    expect(normalizeEditorSettings(emptied).languages.yaml).toEqual({});
  });
});
