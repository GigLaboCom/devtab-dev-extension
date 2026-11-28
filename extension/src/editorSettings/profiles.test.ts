/**
 * The editor's profiles (D39 stage 2, Pro): seam `EditorProfilesStore`'s contract (./profilesContract.ts) on the
 * extension's storage, the page's memory and "no profiles"; what only the storage meets (its own record and key, a full
 * area, a damaged or newer record, the Default set's record left alone); the model — normalization and its limits,
 * names, the changes a person makes, which profile a place uses; export and import, with hostile files; and the
 * editions — the free one never opens the record, a licence that ends leaves it as it was and the editors on Default,
 * and Pro back finds it again.
 */
import { BUILT_IN_VALUES, LANGUAGES_MAX, builtInSet, defaultEditorSettings } from './model';
import {
  DEFAULT_PROFILE,
  PROFILES_MAX,
  PROFILES_RECORD_MAX_CHARS,
  PROFILE_FILE_MAX_BYTES,
  PROFILE_NAME_MAX,
  PROJECTS_MAX,
  UNNAMED_PROFILE,
  chooseActive,
  chooseForProject,
  cleanName,
  createProfile,
  deleteProfile,
  duplicateProfile,
  emptyEditorProfiles,
  importProfile,
  migrateEditorProfiles,
  nameOf,
  nameProblem,
  newProfileId,
  normalizeEditorProfiles,
  profileFileName,
  profileFileText,
  profileFor,
  readProfileFile,
  renameProfile,
  uniqueName,
  withProfileSet,
} from './profiles';
import { editorProfilesStoreContract } from './profilesContract';
import { EDITOR_PROFILES_KEY, areaEditorProfiles, memoryEditorProfiles, noEditorProfiles } from './profilesStore';
import { EDITOR_SETTINGS_KEY, memoryEditorArea } from './storage';
import { free } from '@src/edition/free';
import { pro } from '@src/edition/pro';
import { historyHost } from '@src/history/behaviors';
import { fakeStorage } from '@src/test/fakes';
import { FREE, PRO, switchableSource } from '@src/test/switchableSource';
import { memoryStore } from '@workspace/tools-shared/history';
import { describe, expect, it } from 'vitest';
import type { EditorProfilesRecord } from './profiles';
import type { HistoryChrome } from '@src/history/behaviors';

editorProfilesStoreContract('the extension’s storage', () => {
  const area = memoryEditorArea();
  return { store: areaEditorProfiles(area), reopen: () => areaEditorProfiles(area) };
});
editorProfilesStoreContract('the page’s memory', () => ({
  store: memoryEditorProfiles(),
  reopen: () => memoryEditorProfiles(),
}));
editorProfilesStoreContract('no profiles (the free edition)', () => ({
  store: noEditorProfiles,
  reopen: () => noEditorProfiles,
}));

const ids = (n: number) => Array.from({ length: n }, (_, i) => `ep_id${String(i).padStart(7, '0')}`);
let counter = 0;
const nextId = () => `ep_t${String(++counter).padStart(8, '0')}`;
const ok = <T extends { ok: boolean }>(change: T): Extract<T, { ok: true }> => {
  if (!change.ok) throw new Error(JSON.stringify(change));
  return change as Extract<T, { ok: true }>;
};
const twoSpaces = { ...builtInSet(), base: { ...BUILT_IN_VALUES, indentSize: 2 } };

describe('the store over the extension’s storage', () => {
  it('keeps one record of its own, `editorProfiles`, with its version; the Default set’s record is not touched', async () => {
    const area = memoryEditorArea();
    area.rows.set(EDITOR_SETTINGS_KEY, defaultEditorSettings());
    const store = areaEditorProfiles(area);
    await store.save(ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces, 'ep_work000001')).record);
    expect([...area.rows.keys()].sort()).toEqual([EDITOR_PROFILES_KEY, EDITOR_SETTINGS_KEY]);
    expect(area.rows.get(EDITOR_SETTINGS_KEY)).toEqual(defaultEditorSettings());
    expect(area.rows.get(EDITOR_PROFILES_KEY)).toMatchObject({ version: 1, active: 'ep_work000001' });
  });

  it('a full area or a record past its size is a refusal, and what was stored stays', async () => {
    const area = memoryEditorArea(items =>
      EDITOR_PROFILES_KEY in items ? new Error('QUOTA_BYTES quota exceeded') : null,
    );
    const store = areaEditorProfiles(area);
    expect(await store.save(ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces)).record)).toEqual({
      ok: false,
      refused: { kind: 'full' },
    });
    expect(await store.load()).toEqual(emptyEditorProfiles());
    // A name of 60 characters and 64 language rows of long ids in each of 19 profiles: past 64 KiB.
    const languages = Object.fromEntries(
      Array.from({ length: LANGUAGES_MAX }, (_, i) => [
        `l${String(i).padStart(2, '0')}${'x'.repeat(29)}`,
        twoSpaces.base,
      ]),
    );
    const big: EditorProfilesRecord = {
      ...emptyEditorProfiles(),
      profiles: ids(PROFILES_MAX - 1).map((id, i) => ({
        id,
        name: `${i}`.padEnd(PROFILE_NAME_MAX, 'n'),
        ...twoSpaces,
        languages,
      })),
    };
    const roomy = areaEditorProfiles(memoryEditorArea());
    const result = await roomy.save(big);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.refused).toMatchObject({ kind: 'too-large', max: PROFILES_RECORD_MAX_CHARS });
    expect(await roomy.load()).toEqual(emptyEditorProfiles());
  });

  it('a damaged record is read as far as it makes sense, and is not deleted for it', async () => {
    const area = memoryEditorArea();
    const damaged = {
      version: 7,
      profiles: [
        {
          id: 'ep_good000001',
          name: '  Work   from   home ',
          base: { indentSize: 99, indentStyle: 'tab' },
          languages: { go: { indentSize: 2 }, 'BAD ID': {} },
        },
        { id: 'ep_good000001', name: 'Twice' },
        { id: 'not-an-id', name: 'No id' },
        { id: 'ep_good000002', name: 'work FROM home' },
        { id: 'ep_good000003', name: 42 },
        'nonsense',
      ],
      active: 'ep_good000002',
      projects: { p_one: 'ep_good000001', p_two: 'ep_gone000000', 'bad id with spaces': 'default' },
      somethingNew: true,
    };
    area.rows.set(EDITOR_PROFILES_KEY, damaged);
    const record = await areaEditorProfiles(area).load();
    expect(record.profiles.map(p => [p.id, p.name])).toEqual([
      ['ep_good000001', 'Work from home'],
      ['ep_good000002', 'work FROM home (2)'],
      ['ep_good000003', UNNAMED_PROFILE],
    ]);
    expect(record.profiles[0]?.base).toEqual({ ...BUILT_IN_VALUES, indentStyle: 'tab' });
    expect(record.profiles[0]?.languages).toEqual({ go: { indentSize: 2 } });
    expect(record.active).toBe('ep_good000002');
    expect(record.projects).toEqual({ p_one: 'ep_good000001' });
    expect(record).not.toHaveProperty('somethingNew');
    expect(area.rows.get(EDITOR_PROFILES_KEY)).toEqual(damaged);
  });
});

describe('the model', () => {
  it('reads nothing stored, and anything that is not a record, as Default alone', () => {
    for (const raw of [undefined, null, 'x', 3, [], true])
      expect(normalizeEditorProfiles(raw)).toEqual(emptyEditorProfiles());
    expect(migrateEditorProfiles({ version: 1 })).toEqual({ version: 1 });
    expect(migrateEditorProfiles([])).toBeNull();
  });

  it(`keeps at most ${PROJECTS_MAX} projects' own profiles; the oldest choice goes first`, () => {
    let record = ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces, 'ep_work000001')).record;
    for (let i = 0; i < PROJECTS_MAX + 3; i += 1) record = chooseForProject(record, `p_${i}`, 'ep_work000001');
    const projects = Object.keys(record.projects);
    expect(projects).toHaveLength(PROJECTS_MAX);
    expect(projects[0]).toBe('p_3');
    expect(projects.at(-1)).toBe(`p_${PROJECTS_MAX + 2}`);
    // Chosen again: it becomes the newest.
    record = chooseForProject(record, 'p_3', DEFAULT_PROFILE);
    expect(Object.keys(record.projects).at(-1)).toBe('p_3');
    expect(
      Object.keys(
        normalizeEditorProfiles({ ...record, projects: { ...record.projects, p_x: 'ep_work000001' } }).projects,
      ),
    ).toHaveLength(PROJECTS_MAX);
  });

  it('names: cleaned, within the limit, allowed characters, not taken (Default included, without case)', () => {
    expect(cleanName('  a \t b  ')).toBe('a b');
    expect(nameProblem('   ', [])).toBe('empty');
    expect(nameProblem('x'.repeat(PROFILE_NAME_MAX + 1), [])).toBe('too-long');
    expect(nameProblem('x'.repeat(PROFILE_NAME_MAX), [])).toBeNull();
    expect(nameProblem(`a${String.fromCharCode(7)}b`, [])).toBe('characters');
    expect(nameProblem(`a${String.fromCharCode(0x202e)}b`, [])).toBe('characters');
    expect(nameProblem('default', ['Default'])).toBe('taken');
    expect(nameProblem('Работа 🙂', ['Default'])).toBeNull();
    expect(uniqueName('Work', ['Default', 'work', 'Work (2)'])).toBe('Work (3)');
    expect(uniqueName('w'.repeat(PROFILE_NAME_MAX), ['w'.repeat(PROFILE_NAME_MAX)])).toHaveLength(PROFILE_NAME_MAX);
    expect(newProfileId()).toMatch(/^ep_[a-z0-9]{10}$/);
  });

  it('create (from the set in force, made active), rename, duplicate, delete — Default neither renamed nor deleted', () => {
    let record = emptyEditorProfiles();
    const made = ok(createProfile(record, ' Work ', twoSpaces, 'ep_work000001'));
    record = made.record;
    expect(record.active).toBe('ep_work000001');
    expect(record.profiles[0]).toMatchObject({ name: 'Work', base: { indentSize: 2 } });
    expect(createProfile(record, 'work', twoSpaces)).toEqual({ ok: false, problem: 'taken' });
    expect(createProfile(record, '', twoSpaces)).toEqual({ ok: false, problem: 'empty' });
    record = ok(renameProfile(record, 'ep_work000001', 'Office')).record;
    expect(nameOf(record, 'ep_work000001')).toBe('Office');
    expect(renameProfile(record, DEFAULT_PROFILE, 'Mine')).toEqual({ ok: false, problem: 'default' });
    expect(renameProfile(record, 'ep_nobody00001', 'Mine')).toEqual({ ok: false, problem: 'not-found' });
    expect(renameProfile(record, 'ep_work000001', 'Default')).toEqual({ ok: false, problem: 'taken' });
    // Renamed to itself in another case: allowed.
    expect(renameProfile(record, 'ep_work000001', 'OFFICE').ok).toBe(true);
    record = ok(duplicateProfile(record, 'ep_work000001', twoSpaces, 'ep_copy000001')).record;
    record = ok(duplicateProfile(record, DEFAULT_PROFILE, builtInSet(), 'ep_copy000002')).record;
    expect(record.profiles.map(p => p.name)).toEqual(['Office', 'Office (2)', 'Default (2)']);
    expect(record.active).toBe('ep_work000001');
    record = chooseForProject(record, 'p_a', 'ep_work000001');
    record = chooseForProject(record, 'p_b', 'ep_copy000001');
    record = ok(deleteProfile(record, 'ep_work000001')).record;
    expect(record.active).toBe(DEFAULT_PROFILE);
    expect(record.projects).toEqual({ p_b: 'ep_copy000001' });
    expect(deleteProfile(record, DEFAULT_PROFILE)).toEqual({ ok: false, problem: 'default' });
    expect(chooseActive(record, 'ep_gone000000')).toBe(record);
    record = withProfileSet(record, 'ep_copy000001', builtInSet());
    expect(record.profiles[0]?.base.indentSize).toBe(BUILT_IN_VALUES.indentSize);
  });

  it(`at most ${PROFILES_MAX} profiles: the next is refused, by every way of making one`, () => {
    let record = emptyEditorProfiles();
    for (let i = 1; i < PROFILES_MAX; i += 1) record = ok(createProfile(record, `P${i}`, twoSpaces, nextId())).record;
    expect(record.profiles).toHaveLength(PROFILES_MAX - 1);
    expect(createProfile(record, 'One more', twoSpaces)).toEqual({ ok: false, problem: 'full' });
    expect(duplicateProfile(record, DEFAULT_PROFILE, twoSpaces)).toEqual({ ok: false, problem: 'full' });
    expect(importProfile(record, { name: 'X', ...twoSpaces })).toEqual({ ok: false, problem: 'full' });
  });

  it('the profile a place uses: the project’s own, else the active one, else Default', () => {
    let record = ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces, 'ep_work000001')).record;
    record = ok(createProfile(record, 'Home', twoSpaces, 'ep_home000001')).record;
    record = chooseForProject(record, 'p_a', 'ep_work000001');
    expect(profileFor(record)).toBe('ep_home000001');
    expect(profileFor(record, 'p_a')).toBe('ep_work000001');
    expect(profileFor(record, 'p_b')).toBe('ep_home000001');
    expect(profileFor(chooseForProject(record, 'p_a', DEFAULT_PROFILE), 'p_a')).toBe(DEFAULT_PROFILE);
    expect(profileFor({ ...record, active: 'ep_gone000000', projects: {} })).toBe(DEFAULT_PROFILE);
  });
});

describe('export and import', () => {
  it('a profile exported and imported again is the same profile, under "name (2)" when the name is taken', () => {
    let record = ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces, 'ep_work000001')).record;
    const work = record.profiles[0]!;
    const text = profileFileText(work.name, work);
    expect(JSON.parse(text)).toEqual({
      format: 'devtab-editor-profile',
      version: 1,
      profile: { name: 'Work', base: work.base, languages: work.languages },
    });
    const read = readProfileFile(text, 'Imported profile');
    if (!read.ok) throw new Error(read.problem);
    record = ok(importProfile(record, read.profile, 'ep_imported01')).record;
    const imported = record.profiles[1]!;
    expect(imported.name).toBe('Work (2)');
    expect({ base: imported.base, languages: imported.languages }).toEqual({
      base: work.base,
      languages: work.languages,
    });
    // Importing does not change the active one.
    expect(record.active).toBe('ep_work000001');
    expect(profileFileName('Work: 2 spaces / Go')).toBe('work-2-spaces-go.editor-profile.json');
    expect(profileFileName('Работа')).toBe('profile.editor-profile.json');
  });

  it('never trusts the file: refuses what is not a profile, says why, and normalizes what is', () => {
    const file = (value: unknown) => JSON.stringify(value);
    expect(readProfileFile('{not json', 'X')).toEqual({ ok: false, problem: 'not-json' });
    expect(readProfileFile('x'.repeat(PROFILE_FILE_MAX_BYTES + 1), 'X')).toEqual({ ok: false, problem: 'too-large' });
    // Three bytes a character: past the limit in bytes while short in characters.
    expect(readProfileFile('€'.repeat(PROFILE_FILE_MAX_BYTES / 3 + 1), 'X')).toEqual({
      ok: false,
      problem: 'too-large',
    });
    for (const value of [
      [],
      'profile',
      { format: 'something-else', version: 1, profile: {} },
      { format: 'devtab-editor-profile', version: 0, profile: {} },
      { format: 'devtab-editor-profile', version: 1.5, profile: {} },
      { format: 'devtab-editor-profile', version: '1', profile: {} },
      { format: 'devtab-editor-profile', version: 1, profile: [] },
      { format: 'devtab-editor-profile', version: 1 },
    ])
      expect(readProfileFile(file(value), 'X')).toEqual({ ok: false, problem: 'not-a-profile' });

    const hostile = readProfileFile(
      file({
        format: 'devtab-editor-profile',
        version: 3,
        script: 'alert(1)',
        profile: {
          id: 'ep_chosen00001',
          name: `${'<b>'.repeat(40)}${String.fromCharCode(0)}`,
          base: { indentSize: 1e9, indentStyle: 'banana', fontSize: 4, softWrap: 'yes', lineNumbers: false, extra: 1 },
          languages: {
            go: { indentStyle: 'tab', indentSize: -1, evil: true },
            ['__proto__']: { indentSize: 2 },
            'not a language id': { indentSize: 2 },
            ...Object.fromEntries(Array.from({ length: 100 }, (_, i) => [`lang${i}`, { softWrap: true }])),
          },
          active: true,
        },
      }),
      'Imported profile',
    );
    if (!hostile.ok) throw new Error(hostile.problem);
    const { profile } = hostile;
    expect(Object.keys(profile).sort()).toEqual(['base', 'languages', 'name']);
    expect([...profile.name].length).toBeLessThanOrEqual(PROFILE_NAME_MAX);
    expect(profile.name).not.toContain(String.fromCharCode(0));
    expect(profile.base).toEqual({ ...BUILT_IN_VALUES, lineNumbers: false });
    expect(profile.languages.go).toEqual({ indentStyle: 'tab' });
    expect(Object.keys(profile.languages)).toHaveLength(LANGUAGES_MAX);
    expect(Object.keys(profile.languages)).not.toContain('not a language id');
    expect(Object.getPrototypeOf(profile.languages)).toBe(Object.prototype);
    // A name that cannot be read is the fallback; the imported profile gets an id of ours.
    const nameless = readProfileFile(
      file({ format: 'devtab-editor-profile', version: 1, profile: { name: '   ' } }),
      'Imported profile',
    );
    if (!nameless.ok) throw new Error(nameless.problem);
    expect(nameless.profile.name).toBe('Imported profile');
    const added = ok(importProfile(emptyEditorProfiles(), profile));
    expect(added.id).toMatch(/^ep_[a-z0-9]{10}$/);
    expect(added.id).not.toBe('ep_chosen00001');
  });
});

describe('the editions: the free one never opens the record; a licence that ends deletes nothing', () => {
  const host = (initial = PRO) => {
    const local = fakeStorage();
    const session = fakeStorage();
    const source = switchableSource(initial);
    const chrome = {
      storage: { local: local.area, session: session.area, onChanged: local.onChanged },
    } as unknown as HistoryChrome;
    return { local, source, host: historyHost({ chrome, storage: { store: memoryStore() }, tools: [], source }) };
  };

  it('each edition names its store: Pro the record `editorProfiles`, free none', () => {
    const area = memoryEditorArea();
    expect(pro.editorProfiles(area)).toMatchObject({ included: true, keeps: true });
    expect(free.editorProfiles(area)).toBe(noEditorProfiles);
  });

  it('the free store reads, writes and follows nothing of the storage it is given', async () => {
    const reads: unknown[] = [];
    const area = memoryEditorArea();
    const watched = {
      ...area,
      area: {
        ...area.area,
        get: ((key: unknown) => (reads.push(key), area.area.get(key as never))) as typeof area.area.get,
      },
    };
    let listeners = 0;
    watched.onChanged = {
      addListener: () => void (listeners += 1),
      removeListener: () => undefined,
    } as unknown as typeof area.onChanged;
    const store = free.editorProfiles(watched);
    await store.load();
    store.watch(() => undefined)();
    await store.save(emptyEditorProfiles());
    expect(reads).toEqual([]);
    expect(listeners).toBe(0);
    expect(area.rows.size).toBe(0);
  });

  it('Pro → free on an open page: the record is neither read nor deleted; Pro back finds it as it was', async () => {
    const { local, source, host: h } = host(PRO);
    const work = ok(createProfile(emptyEditorProfiles(), 'Work', twoSpaces, 'ep_work000001')).record;
    expect(h.editorProfiles.included).toBe(true);
    await h.editorProfiles.save(work);
    const kept = structuredClone(local.rows.get(EDITOR_PROFILES_KEY));
    source.set(FREE);
    expect(h.editorProfiles).toBe(noEditorProfiles);
    // What the editors use now: Default alone.
    const now = await h.editorProfiles.load();
    expect(profileFor(now)).toBe(DEFAULT_PROFILE);
    await h.editorProfiles.save(emptyEditorProfiles());
    expect(local.rows.get(EDITOR_PROFILES_KEY)).toEqual(kept);
    source.set(PRO);
    expect(h.editorProfiles.included).toBe(true);
    const back = await h.editorProfiles.load();
    expect(back.active).toBe('ep_work000001');
    expect(back.profiles.map(p => p.name)).toEqual(['Work']);
  });

  it('a page that opens in the free edition never asks for the record', async () => {
    const { local, host: h } = host(FREE);
    const asked: unknown[] = [];
    const get = local.area.get;
    local.area.get = ((keys: string | string[]) => (asked.push(keys), get(keys as never))) as typeof get;
    await h.editorProfiles.load();
    expect(asked.flat()).not.toContain(EDITOR_PROFILES_KEY);
    expect(h.projectEditorSettings.included).toBe(false);
  });
});
