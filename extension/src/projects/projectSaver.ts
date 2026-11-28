/**
 * `projectSaver` — the third implementation of «Compare code»'s seam `SideSaver` (../compare/sideSaver.ts; the
 * companion's specification §8.6, row 5.4): a side that is a project's file is saved through the companion. Save is
 * `file.save` from the version the text started from (`baseHash`), so a file that changed on disk meanwhile is not
 * overwritten: the answer is a refusal that names the disk's version (`conflict`), and the page offers its three
 * choices (Р23). Save as is `file.create` with a new path in the project, which the person names (`ask`).
 *
 * The editor of the Projects section saves by itself (../autosave.ts) through `write`, the same `file.save` with the
 * base the schedule holds; Save and Save as are the seam's, for every other side that knows its project file.
 *
 * What the companion refuses — a read-only project, a secret, `.git`, a link, a text the file's encoding cannot hold,
 * too little disk — comes back as `failed` with the error's code and data, never its message: the page says it in its
 * own words (src/app/projects/errors.ts). The file keeps its encoding, byte order mark and line ends (the companion's);
 * a new file is UTF-8, with a byte order mark only when the request asks for one.
 */
import { CompanionError, isCompanionError } from './types';
import type { SaveRequest, SaveResult, SideSaver } from '../compare/sideSaver';
import type { ProjectBackend } from './backend';
import type { ProjectId } from './types';

export interface ProjectSaverOptions {
  /** Where Save as goes: a path in the project, or null when the person cancels. Without it Save as is cancelled. */
  ask?(suggested: string): Promise<string | null>;
  /** The editing session's name, for the companion's one «Before edit» copy per session. */
  session?: string;
}

export interface ProjectSaver extends SideSaver {
  readonly project: ProjectId;
  /** The file Save writes; after a Save as, the new one. */
  readonly path: string;
  /** The version of the file the next Save starts from. */
  readonly baseHash: string;
  /**
   * `file.save` of this file from `baseHash`: the new version and the rule that marks it as running code, or a
   * rejection with the companion's error (`conflict` with the disk's `currentHash`).
   */
  write(
    text: string,
    baseHash: string,
    reason: 'auto' | 'explicit',
  ): Promise<{ hash: string; protected: string | null }>;
}

const nameOf = (path: string): string => path.slice(path.lastIndexOf('/') + 1);

/** A refusal as the seam says it: the code and data for the page to put in words. */
const refused = (error: unknown): SaveResult => {
  if (isCompanionError(error, 'cancelled')) return { status: 'cancelled' };
  if (isCompanionError(error))
    return { status: 'failed', message: error.code, code: error.code, ...(error.data && { data: { ...error.data } }) };
  return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
};

export type ProjectSaverFactory = (
  backend: ProjectBackend,
  project: ProjectId,
  path: string,
  baseHash: string,
  options?: ProjectSaverOptions,
) => ProjectSaver;

export const projectSaver: ProjectSaverFactory = (backend, project, path, baseHash, options = {}) => {
  let current = path;
  let base = baseHash;

  const write: ProjectSaver['write'] = async (text, from, reason) => {
    const saved = await backend.call('file.save', {
      project,
      path: current,
      baseHash: from,
      text,
      reason,
      ...(options.session && { session: options.session }),
    });
    base = saved.hash;
    return { hash: saved.hash, protected: saved.protected ?? null };
  };

  const save = async (request: SaveRequest): Promise<SaveResult> => {
    try {
      await write(request.text, base, 'explicit');
      return { status: 'saved', fileName: nameOf(current), handle: null, how: 'file' };
    } catch (error) {
      return refused(error);
    }
  };

  const saveAs = async (request: SaveRequest): Promise<SaveResult> => {
    const target = options.ask ? await options.ask(request.suggestedName) : null;
    if (target === null) return { status: 'cancelled' };
    try {
      // A new file is UTF-8 without a byte order mark; one is asked for by writing it as the text's first character.
      const created = await backend.call('file.create', {
        project,
        path: target,
        text: request.bom ? `\ufeff${request.text}` : request.text,
      });
      current = target;
      base = created.hash;
      return { status: 'saved', fileName: nameOf(target), handle: null, how: 'file' };
    } catch (error) {
      return refused(error);
    }
  };

  return {
    name: 'project',
    project,
    get path() {
      return current;
    },
    get baseHash() {
      return base;
    },
    write,
    save,
    saveAs,
  };
};

/** The companion's error a `failed` result of this saver carries, for the page's words. */
export const errorOf = (result: SaveResult): CompanionError | null =>
  result.status === 'failed' && result.code
    ? new CompanionError(result.code as CompanionError['code'], result.message, result.data)
    : null;
