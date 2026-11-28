/**
 * `ProjectEditorSettings` from `.editorconfig` (./editorConfigReader.ts) over a project played in memory: which files
 * are read (from the file's folder up to the project's root, nearest first, never above; a `root = true` stops the
 * walk), precedence (closer files and later sections win, `unset`), how the indent is read (`indent_size`, `tab_width`,
 * `indent_size = tab`, 1–16), the cache per folder (no second read, none while one is in flight), dropping it on the
 * `files.changed` event, and a failure or a file over the limits degrading to "no project settings". Then the seam's
 * other parts (../project.ts): the free edition's reads nothing, the lazy one loads once and passes changes on.
 */
import { DEPTH_MAX, editorConfigSettings, foldersOf } from './editorConfigReader';
import { FILE_MAX_BYTES } from './parse';
import { defaultEditorSettings } from '../model';
import { NO_PROJECT_SETTINGS, decidingFiles, lazyProjectEditorSettings, noProjectEditorSettings } from '../project';
import { effectiveEditorSettings } from '../resolve';
import { describe, expect, it } from 'vitest';
import type { ProjectFiles } from '../project';

/** A project's files in memory, with every read noted and an event to send. */
const project = (files: Record<string, string>, options: { fail?: string[]; hold?: boolean } = {}) => {
  const reads: string[] = [];
  const listeners = new Set<(paths: readonly string[] | 'all') => void>();
  const held: Array<() => void> = [];
  const access: ProjectFiles = {
    read: path => {
      reads.push(path);
      const answer = () => {
        if (options.fail?.includes(path)) return Promise.reject(new Error('the companion went away'));
        const text = files[path];
        return Promise.resolve(text === undefined ? null : { text, size: new TextEncoder().encode(text).length });
      };
      if (!options.hold) return answer();
      return new Promise((resolve, reject) => held.push(() => void answer().then(resolve, reject)));
    },
    onChanged: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    files,
    reads,
    access,
    release: () => held.splice(0).forEach(go => go()),
    changed: (paths: readonly string[] | 'all') => listeners.forEach(l => l(paths)),
    listeners: () => listeners.size,
  };
};

describe('which files are read', () => {
  it('from the file’s folder up to the project’s root, nearest first — nothing above the project', async () => {
    const p = project({});
    await editorConfigSettings(p.access).forFile('src/api/user.py');
    expect(p.reads).toEqual(['src/api/.editorconfig', 'src/.editorconfig', '.editorconfig']);
    expect(p.reads.some(r => r.startsWith('..') || r.startsWith('/'))).toBe(false);
    expect(foldersOf('a.txt')).toEqual(['']);
  });

  it('a `root = true` stops the walk: no folder above it is read or applied', async () => {
    const p = project({
      '.editorconfig': '[*]\nindent_style = tab\n',
      'web/.editorconfig': 'root = true\n[*]\nindent_size = 2\n',
    });
    const settings = await editorConfigSettings(p.access).forFile('web/src/a.ts');
    expect(p.reads).toEqual(['web/src/.editorconfig', 'web/.editorconfig']);
    expect(settings.values).toEqual({ indentSize: 2 });
  });

  it(`at most ${DEPTH_MAX} folders for one file`, async () => {
    const p = project({});
    const deep = `${Array.from({ length: 40 }, (_, i) => `d${i}`).join('/')}/a.txt`;
    await editorConfigSettings(p.access).forFile(deep);
    expect(p.reads).toHaveLength(DEPTH_MAX);
  });
});

describe('what applies', () => {
  it('closer files win; in a file the later section wins; `unset` takes a value away; each value on its own', async () => {
    const p = project({
      '.editorconfig':
        'root = true\n[*]\nindent_style = space\nindent_size = 4\nend_of_line = lf\n[*.py]\nindent_size = 8\n',
      'src/.editorconfig': '[*.py]\nindent_size = 2\n[*.py]\nindent_size = 3\n[legacy/**]\nindent_style = unset\n',
    });
    const reader = editorConfigSettings(p.access);
    expect(await reader.forFile('src/app.py')).toEqual({
      values: { indentStyle: 'space', indentSize: 3 },
      from: { indentStyle: '.editorconfig', indentSize: 'src/.editorconfig' },
      other: { end_of_line: 'lf' },
      problem: null,
    });
    expect((await reader.forFile('src/legacy/old.py')).values).toEqual({ indentSize: 3 });
    expect((await reader.forFile('README')).values).toEqual({ indentStyle: 'space', indentSize: 4 });
  });

  it('patterns with a separator are relative to their own file’s folder', async () => {
    const p = project({
      '.editorconfig': '[lib/*.js]\nindent_size = 2\n',
      'packages/.editorconfig': '[lib/*.js]\nindent_size = 6\n',
    });
    const reader = editorConfigSettings(p.access);
    expect((await reader.forFile('lib/a.js')).values).toEqual({ indentSize: 2 });
    expect((await reader.forFile('packages/lib/a.js')).values).toEqual({ indentSize: 6 });
    expect((await reader.forFile('other/lib/a.js')).values).toBeNull();
  });

  it('the size: indent_size, tab_width, `indent_size = tab`; outside 1–16 or not a number, not applied', async () => {
    const at = async (text: string) =>
      (await editorConfigSettings(project({ '.editorconfig': text }).access).forFile('a.c')).values;
    expect(await at('[*]\nindent_size = tab\ntab_width = 8\n')).toEqual({ indentSize: 8, tabWidth: 8 });
    expect(await at('[*]\nindent_size = tab\n')).toBeNull();
    expect(await at('[*]\nindent_style = tab\ntab_width = 3\nindent_size = 4\n')).toEqual({
      indentStyle: 'tab',
      indentSize: 4,
      tabWidth: 3,
    });
    expect(await at('[*]\nindent_size = 1000000000\ntab_width = 0\n')).toBeNull();
    expect(await at('[*]\nindent_size = 17\n')).toBeNull();
    expect(await at('[*]\nindent_size = 16\n')).toEqual({ indentSize: 16 });
    expect(await at('[*]\nindent_size = four\nindent_style = banana\n')).toBeNull();
  });

  it('what is parsed but not applied is reported in `other`: end of line, charset, whitespace, final newline, line length', async () => {
    const p = project({
      '.editorconfig':
        '[*]\nend_of_line = CRLF\ncharset = utf-8\ntrim_trailing_whitespace = true\ninsert_final_newline = true\nmax_line_length = 100\nij_any = x\n',
    });
    const settings = await editorConfigSettings(p.access).forFile('a.txt');
    expect(settings.values).toBeNull();
    expect(settings.other).toEqual({
      end_of_line: 'crlf',
      charset: 'utf-8',
      trim_trailing_whitespace: 'true',
      insert_final_newline: 'true',
      max_line_length: '100',
      ij_any: 'x',
    });
  });
});

describe('the cache', () => {
  it('a folder is read once; a folder being read is not read again — the lookups share the read', async () => {
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n' }, { hold: true });
    const reader = editorConfigSettings(p.access);
    const first = reader.forFile('a.txt');
    const second = reader.forFile('b.txt');
    await Promise.resolve();
    p.release();
    expect((await first).values).toEqual({ indentSize: 2 });
    expect((await second).values).toEqual({ indentSize: 2 });
    await reader.forFile('c.txt');
    expect(p.reads).toEqual(['.editorconfig']);
  });

  it('the `files.changed` event that names an `.editorconfig` drops its folder and tells the listeners; others do not', async () => {
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n', 'src/.editorconfig': '[*]\nindent_style = tab\n' });
    const reader = editorConfigSettings(p.access);
    let told = 0;
    reader.onChange(() => (told += 1));
    await reader.forFile('src/a.ts');
    expect(p.reads).toHaveLength(2);
    p.changed(['src/a.ts', 'README.md']);
    expect(told).toBe(0);
    p.files['src/.editorconfig'] = '[*]\nindent_style = space\nindent_size = 6\n';
    p.changed(['src/.editorconfig']);
    expect(told).toBe(1);
    expect((await reader.forFile('src/a.ts')).values).toEqual({ indentStyle: 'space', indentSize: 6 });
    // Only the changed folder was read again.
    expect(p.reads).toEqual(['src/.editorconfig', '.editorconfig', 'src/.editorconfig']);
    // A new file in a folder known to have none; a folder removed; not every path listed.
    await reader.forFile('src/deep/x.ts');
    p.files['src/deep/.editorconfig'] = '[*]\nindent_size = 3\n';
    p.changed(['src/deep/.editorconfig']);
    expect(told).toBe(2);
    expect((await reader.forFile('src/deep/x.ts')).values).toMatchObject({ indentSize: 3 });
    p.changed(['src']);
    expect(told).toBe(3);
    p.changed('all');
    expect(told).toBe(4);
    const before = p.reads.length;
    await reader.forFile('src/deep/x.ts');
    expect(p.reads.length - before).toBe(3);
  });

  it('a lookup in flight when its folder changes does not put the old answer back', async () => {
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n' }, { hold: true });
    const reader = editorConfigSettings(p.access);
    const first = reader.forFile('a.txt');
    await Promise.resolve();
    p.changed(['.editorconfig']);
    p.files['.editorconfig'] = '[*]\nindent_size = 5\n';
    p.release();
    await first;
    const again = reader.forFile('a.txt');
    await Promise.resolve();
    p.release();
    expect((await again).values).toEqual({ indentSize: 5 });
  });

  it('let go: no event is followed any more', () => {
    const p = project({});
    const reader = editorConfigSettings(p.access);
    expect(p.listeners()).toBe(1);
    reader.dispose();
    expect(p.listeners()).toBe(0);
  });
});

describe('failure degrades to "no project settings"', () => {
  it('a read that fails: nothing of the project applies, the problem names the file, and the next lookup reads again', async () => {
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n' }, { fail: ['src/.editorconfig'] });
    const reader = editorConfigSettings(p.access);
    expect(await reader.forFile('src/a.ts')).toEqual({
      ...NO_PROJECT_SETTINGS,
      problem: { kind: 'unreadable', file: 'src/.editorconfig' },
    });
    await reader.forFile('src/a.ts');
    expect(p.reads.filter(r => r === 'src/.editorconfig')).toHaveLength(2);
  });

  it('a file over the limits — its size, its sections, a match past its budget — the same', async () => {
    const big = project({ '.editorconfig': `[*]\nx = ${'y'.repeat(FILE_MAX_BYTES)}\n` });
    expect((await editorConfigSettings(big.access).forFile('a')).problem).toEqual({
      kind: 'over-limits',
      file: '.editorconfig',
    });
    const many = project({ 'src/.editorconfig': '[x]\n'.repeat(1001) });
    expect((await editorConfigSettings(many.access).forFile('src/a')).problem).toEqual({
      kind: 'over-limits',
      file: 'src/.editorconfig',
    });
    // Sections whose patterns take the whole budget of a lookup between them.
    const slow = project({ '.editorconfig': `[${'*a'.repeat(200)}*b]\nindent_size = 2\n`.repeat(20) });
    const started = performance.now();
    const settings = await editorConfigSettings(slow.access).forFile(`${'a'.repeat(1000)}.txt`);
    expect(settings).toEqual({ ...NO_PROJECT_SETTINGS, problem: { kind: 'over-limits', file: '.editorconfig' } });
    expect(performance.now() - started).toBeLessThan(3000);
  });
});

describe('the resolution with every level present', () => {
  it('the choice for the file → EditorConfig, value by value → detected → the language → the profile → built in', async () => {
    const p = project({ '.editorconfig': 'root = true\n[*.py]\nindent_style = tab\n' });
    const projectSettings = await editorConfigSettings(p.access).forFile('app.py');
    const profile = {
      base: { ...defaultEditorSettings().base, indentSize: 2 },
      languages: { python: { indentSize: 6 } },
    };
    const resolve = (file: { indentStyle?: 'space' | 'tab'; indentSize?: number } | null) =>
      effectiveEditorSettings({
        profile,
        language: 'python',
        detected: { indentStyle: 'space', indentSize: 4 },
        project: projectSettings.values,
        file,
      });
    // The research's example (§2.5): EditorConfig says tabs, the size is the detected 4.
    const none = resolve(null);
    expect(none.values).toMatchObject({ indentStyle: 'tab', indentSize: 4 });
    expect(none.sources).toMatchObject({ indentStyle: 'project', indentSize: 'detected', softWrap: 'general' });
    expect(decidingFiles(projectSettings, none)).toEqual(['.editorconfig']);
    const chosen = resolve({ indentStyle: 'space', indentSize: 8 });
    expect(chosen.values).toMatchObject({ indentStyle: 'space', indentSize: 8 });
    expect(chosen.sources).toMatchObject({ indentStyle: 'file', indentSize: 'file' });
    expect(decidingFiles(projectSettings, chosen)).toEqual([]);
  });

  it('tabs take the project’s tab width, spaces its indent size, each standing in for the other', () => {
    const at = (
      project: { indentStyle?: 'space' | 'tab'; indentSize?: number; tabWidth?: number },
      file?: 'space' | 'tab',
    ) =>
      effectiveEditorSettings({
        profile: defaultEditorSettings(),
        language: 'c',
        detected: null,
        project,
        file: file ? { indentStyle: file } : null,
      }).values.indentSize;
    expect(at({ indentStyle: 'tab', indentSize: 4, tabWidth: 8 })).toBe(8);
    expect(at({ indentStyle: 'space', indentSize: 4, tabWidth: 8 })).toBe(4);
    expect(at({ indentStyle: 'space', tabWidth: 3 })).toBe(3);
    expect(at({ indentStyle: 'tab', indentSize: 2 })).toBe(2);
    // The person chose tabs for the file: the project's tab width follows the style in force.
    expect(at({ indentStyle: 'space', indentSize: 4, tabWidth: 8 }, 'tab')).toBe(8);
  });
});

describe('the seam’s other implementations (../project.ts)', () => {
  it('the free edition’s reads nothing and follows nothing', async () => {
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n' });
    const none = noProjectEditorSettings(p.access);
    expect(noProjectEditorSettings.included).toBe(false);
    expect(none.included).toBe(false);
    expect(await none.forFile('src/a.ts')).toEqual(NO_PROJECT_SETTINGS);
    expect(p.reads).toEqual([]);
    expect(p.listeners()).toBe(0);
  });

  it('the lazy one loads its implementation once, at the first project, and passes its changes on', async () => {
    let loads = 0;
    const lazy = lazyProjectEditorSettings('editorconfig', async () => {
      loads += 1;
      return editorConfigSettings;
    });
    expect(lazy.included).toBe(true);
    expect(loads).toBe(0);
    const p = project({ '.editorconfig': '[*]\nindent_size = 2\n' });
    const made = lazy(p.access);
    let told = 0;
    made.onChange(() => (told += 1));
    expect((await made.forFile('a.ts')).values).toEqual({ indentSize: 2 });
    p.changed(['.editorconfig']);
    expect(told).toBe(1);
    made.dispose();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(loads).toBe(1);
    expect(p.listeners()).toBe(0);
  });

  it('an implementation that cannot load is "not read", never an error', async () => {
    const lazy = lazyProjectEditorSettings('editorconfig', () => Promise.reject(new Error('no chunk')));
    const settings = await lazy(project({}).access).forFile('a.ts');
    expect(settings.values).toBeNull();
    expect(settings.problem?.kind).toBe('unreadable');
  });
});
