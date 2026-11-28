/**
 * `ProjectEditorSettings` from a project's `.editorconfig` files (D39 stage 3; research §2.1, §2.5, §3.1 path C,
 * §3.2, §3.4) — read by the extension itself through the backend's read method, so the companion and its contract do
 * not change. Loaded in a chunk of its own the first time a project asks (../project.ts, `lazyProjectEditorSettings`).
 *
 * For a file `src/api/user.py` it reads `src/api/.editorconfig`, then `src/.editorconfig`, then `.editorconfig` at the
 * project's root — one folder after another, nearest first, stopping at a file that says `root = true`. The project's
 * root is always the last (as if it said `root = true`): nothing above the project is ever asked for (§3.2). At most
 * `DEPTH_MAX` folders are read for one file. The files apply from the farthest to the nearest, and in a file the later
 * section wins: the nearest, latest pair of a property is the one in force; `unset` takes a property away again.
 *
 * Applied in this stage — what the editor can do: `indent_style`; the size, one number for the editor, from
 * `indent_size` and `tab_width` (../resolve.ts chooses between them by the style in force: tabs take `tab_width`,
 * spaces `indent_size`, each falling back to the other; `indent_size = tab` is `tab_width`); a size outside 1–16 is not
 * applied. The rest is parsed and reported (`other`), not applied.
 *
 * Cache: one answer per folder (none, a parsed file, or over the limits), kept until the `files.changed` event names
 * that folder's `.editorconfig` (or the folder itself, or says not every path is listed); a folder being read is not read
 * again meanwhile — the waiting lookups share the read. A read that fails is not kept: the lookup says `unreadable` and
 * the next one tries again. A file over the limits (./parse.ts), or a match past its budget (./glob.ts), is
 * `over-limits`. Either way nothing of the project applies to the file: "no project settings", said in one line by the
 * indicator.
 */
import { MATCH_BUDGET } from './glob';
import { FILE_MAX_BYTES, parseEditorConfig } from './parse';
import { INDENT_SIZE_MAX, INDENT_SIZE_MIN } from '../model';
import { NO_PROJECT_SETTINGS } from '../project';
import type { ProjectEditorSettings, ProjectEditorSettingsFactory, ProjectFiles, ProjectSettings } from '../project';
import type { ProjectValues } from '../resolve';
import type { EditorConfigFile } from './parse';

/** Folders read for one file, nearest first. */
export const DEPTH_MAX = 32;
/** Steps all the matches of one lookup may take together (./glob.ts). */
export const LOOKUP_BUDGET = 2_000_000;

const NAME = '.editorconfig';

type Entry =
  { kind: 'none' } | { kind: 'file'; path: string; file: EditorConfigFile } | { kind: 'over-limits'; path: string };

const settingsPath = (dir: string): string => (dir ? `${dir}/${NAME}` : NAME);

/** The file's folders, nearest first, the project's root (``) last; at most `DEPTH_MAX`. */
export const foldersOf = (path: string): string[] => {
  const parts = path.split('/');
  const dirs: string[] = [];
  for (let i = parts.length - 1; i >= 0 && dirs.length < DEPTH_MAX; i -= 1) dirs.push(parts.slice(0, i).join('/'));
  return dirs;
};

const sizeOf = (value: string | undefined): number | undefined => {
  if (value === undefined || !/^\d{1,3}$/.test(value)) return undefined;
  const n = Number(value);
  return n >= INDENT_SIZE_MIN && n <= INDENT_SIZE_MAX ? n : undefined;
};

const APPLIED = new Set(['indent_style', 'indent_size', 'tab_width']);

/** The pairs in force for a file, with the file that set each, read into what applies. */
const interpret = (pairs: Map<string, { value: string; file: string }>): Omit<ProjectSettings, 'problem'> => {
  const values: ProjectValues = {};
  const from: Partial<Record<keyof ProjectValues, string>> = {};
  const style = pairs.get('indent_style');
  if (style && (style.value === 'tab' || style.value === 'space')) {
    values.indentStyle = style.value;
    from.indentStyle = style.file;
  }
  const tab = pairs.get('tab_width');
  const tabWidth = sizeOf(tab?.value);
  if (tabWidth !== undefined) {
    values.tabWidth = tabWidth;
    from.tabWidth = tab!.file;
  }
  const indent = pairs.get('indent_size');
  if (indent?.value === 'tab') {
    if (tabWidth !== undefined) {
      values.indentSize = tabWidth;
      from.indentSize = tab!.file;
    }
  } else {
    const size = sizeOf(indent?.value);
    if (size !== undefined) {
      values.indentSize = size;
      from.indentSize = indent!.file;
    }
  }
  const other = Object.fromEntries(
    [...pairs].filter(([key]) => !APPLIED.has(key) && key !== 'root').map(([key, { value }]) => [key, value]),
  );
  return { values: Object.keys(values).length ? values : null, from, other };
};

export const editorConfigSettings: ProjectEditorSettingsFactory = Object.assign(
  (files: ProjectFiles): ProjectEditorSettings => {
    const cache = new Map<string, Promise<Entry>>();
    const listeners = new Set<() => void>();
    let disposed = false;

    const entry = (dir: string): Promise<Entry> => {
      const kept = cache.get(dir);
      if (kept) return kept;
      const path = settingsPath(dir);
      const reading = files.read(path).then((found): Entry => {
        if (!found) return { kind: 'none' };
        if (found.size > FILE_MAX_BYTES) return { kind: 'over-limits', path };
        const parsed = parseEditorConfig(found.text);
        return parsed.ok ? { kind: 'file', path, file: parsed.file } : { kind: 'over-limits', path };
      });
      cache.set(dir, reading);
      // A failure is not kept: the next lookup reads again.
      reading.catch(() => {
        if (cache.get(dir) === reading) cache.delete(dir);
      });
      return reading;
    };

    const forFile = async (path: string): Promise<ProjectSettings> => {
      const found: Array<{ dir: string; path: string; file: EditorConfigFile }> = [];
      for (const dir of foldersOf(path)) {
        let got: Entry;
        try {
          got = await entry(dir);
        } catch {
          return { ...NO_PROJECT_SETTINGS, problem: { kind: 'unreadable', file: settingsPath(dir) } };
        }
        if (got.kind === 'over-limits')
          return { ...NO_PROJECT_SETTINGS, problem: { kind: 'over-limits', file: got.path } };
        if (got.kind === 'file') {
          found.push({ dir, path: got.path, file: got.file });
          if (got.file.root) break;
        }
      }
      const pairs = new Map<string, { value: string; file: string }>();
      let left = LOOKUP_BUDGET;
      // From the farthest file to the nearest; in each, section after section: the last word stands.
      for (const { dir, path: file, file: parsed } of found.reverse()) {
        const relative = dir ? path.slice(dir.length + 1) : path;
        for (const section of parsed.sections) {
          const spent = { steps: 0, exhausted: false };
          const matched = section.glob.matches(relative, { budget: Math.min(MATCH_BUDGET, left), spent });
          left -= spent.steps;
          if (spent.exhausted) return { ...NO_PROJECT_SETTINGS, problem: { kind: 'over-limits', file } };
          if (!matched) continue;
          for (const [key, value] of section.pairs) {
            if (value === 'unset') pairs.delete(key);
            else pairs.set(key, { value, file });
          }
        }
      }
      return { ...interpret(pairs), problem: null };
    };

    const undo = files.onChanged(paths => {
      if (disposed) return;
      let dropped = false;
      for (const dir of [...cache.keys()]) {
        const hit =
          paths === 'all' ||
          paths.some(
            changed =>
              changed === settingsPath(dir) || changed === dir || (changed !== '' && dir.startsWith(`${changed}/`)),
          );
        if (hit) {
          cache.delete(dir);
          dropped = true;
        }
      }
      if (dropped) listeners.forEach(listener => listener());
    });

    return {
      included: true,
      forFile,
      onChange(listener) {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
      dispose() {
        disposed = true;
        undo();
        listeners.clear();
        cache.clear();
      },
    };
  },
  { id: 'editorconfig', included: true },
);
