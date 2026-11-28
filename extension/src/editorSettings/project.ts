/**
 * Seam `ProjectEditorSettings` (D39 stage 3; docs/replaceable-behaviors.md; research §3, §4.8): what a project of the
 * Projects section says about one of its files — level 2 of ./resolve.ts, between the person's choice for the file
 * and the indentation detected in it. The edition names the implementation (src/edition/edition.ts,
 * `projectEditorSettings`), and the host follows what it says about itself (`included`):
 *
 *   EditorConfig (Pro)  the project's `.editorconfig` files, read by the extension itself through the backend's
 *                       existing read method (`file.read`) — from the file's folder up to the project's root, never
 *                       above it (./editorconfig/editorConfigReader.ts, loaded only when first asked: `lazyProject…`)
 *   none (free)         no project settings: nothing is read at all, and the indicator of a project's file says in
 *                       one line that they are not part of this version
 *
 * Asynchronous from the first day (a later source — a field the companion resolves itself, path B of §3.1 — answers
 * over the wire). Scratches and «Compare code» have no project and never ask.
 */
import type { ProjectValues } from './resolve';

/** What the seam may read of a project: its files by path, and the news that some changed. */
export interface ProjectFiles {
  /**
   * A file's text by its path from the project's root (`src/.editorconfig`), with its size in bytes; null when there is
   * no such file. Rejects when the file cannot be read.
   */
  read(path: string): Promise<{ text: string; size: number } | null>;
  /** Files changed on disk — their paths, or `all` when not every path is known; returns the undo. */
  onChanged(listener: (paths: readonly string[] | 'all') => void): () => void;
}

/** What a project says about one file. */
export interface ProjectSettings {
  /** The values applied (level 2); null: the project says nothing (or could not be read). */
  readonly values: ProjectValues | null;
  /** For each applied value, the file that decided it (a path from the project's root). */
  readonly from: Readonly<Partial<Record<keyof ProjectValues, string>>>;
  /**
   * What the files say beyond that, parsed and not applied in this stage (`end_of_line`, `charset`,
   * `trim_trailing_whitespace`, `insert_final_newline`, `max_line_length`, unknown keys): key → value.
   */
  readonly other: Readonly<Record<string, string>>;
  /** Why nothing applies although the project may have settings: a file not read, or over the limits. */
  readonly problem: { readonly kind: 'unreadable' | 'over-limits'; readonly file: string } | null;
}

export const NO_PROJECT_SETTINGS: ProjectSettings = Object.freeze({
  values: null,
  from: Object.freeze({}),
  other: Object.freeze({}),
  problem: null,
});

/**
 * The files that decided what the indicator shows: the one that set the style, when the style came from the project,
 * and the one whose number gave the size (the tab width for tabs, the indent size for spaces, each standing in for the
 * other) — nearest first, each once.
 */
export const decidingFiles = (
  project: ProjectSettings | null,
  effective: { values: { indentStyle: 'space' | 'tab' }; sources: { indentStyle: string; indentSize: string } },
): string[] => {
  if (!project?.values) return [];
  const files: string[] = [];
  if (effective.sources.indentStyle === 'project' && project.from.indentStyle) files.push(project.from.indentStyle);
  if (effective.sources.indentSize === 'project') {
    const { values, from } = project;
    const tab = effective.values.indentStyle === 'tab';
    const file = tab
      ? values.tabWidth !== undefined
        ? from.tabWidth
        : from.indentSize
      : values.indentSize !== undefined
        ? from.indentSize
        : from.tabWidth;
    if (file && !files.includes(file)) files.push(file);
  }
  return files.sort((a, b) => b.split('/').length - a.split('/').length);
};

/** The project's settings for its files, as long as one project is open. */
export interface ProjectEditorSettings {
  /** Whether this edition reads a project's settings at all (`false`: nothing is read, and the indicator says so). */
  readonly included: boolean;
  /** What the project says about a file (a path from its root). Never rejects: a failure is `problem`. */
  forFile(path: string): Promise<ProjectSettings>;
  /** Called when what `forFile` answers may have changed (a settings file changed); returns the undo. */
  onChange(listener: () => void): () => void;
  /** The project is closed: nothing is followed any more. */
  dispose(): void;
}

/** Makes the seam for one open project. `included` and `id` are known before any is made. */
export type ProjectEditorSettingsFactory = ((files: ProjectFiles) => ProjectEditorSettings) & {
  readonly id: string;
  readonly included: boolean;
};

/** No project settings: nothing is read, nothing is followed. */
export const noProjectEditorSettings: ProjectEditorSettingsFactory = Object.assign(
  (): ProjectEditorSettings => ({
    included: false,
    forFile: () => Promise.resolve(NO_PROJECT_SETTINGS),
    onChange: () => () => undefined,
    dispose: () => undefined,
  }),
  { id: 'none', included: false },
);

/**
 * A factory whose implementation is loaded when the first project asks (a chunk of its own, so neither the shell nor
 * the start page carries it): until then a lookup waits for it, and the changes it reports reach the listeners given
 * before.
 */
export const lazyProjectEditorSettings = (
  id: string,
  load: () => Promise<ProjectEditorSettingsFactory>,
): ProjectEditorSettingsFactory =>
  Object.assign(
    (files: ProjectFiles): ProjectEditorSettings => {
      const listeners = new Set<() => void>();
      let disposed = false;
      const made = load().then(factory => {
        const real = factory(files);
        real.onChange(() => listeners.forEach(l => l()));
        if (disposed) real.dispose();
        return real;
      });
      return {
        included: true,
        forFile: path =>
          made.then(
            real => real.forFile(path),
            () => ({ ...NO_PROJECT_SETTINGS, problem: { kind: 'unreadable' as const, file: '.editorconfig' } }),
          ),
        onChange(listener) {
          listeners.add(listener);
          return () => listeners.delete(listener);
        },
        dispose() {
          disposed = true;
          listeners.clear();
          void made.then(
            real => real.dispose(),
            () => undefined,
          );
        },
      };
    },
    { id, included: true },
  );
