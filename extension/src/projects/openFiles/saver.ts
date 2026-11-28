/**
 * `openedFileSaver` — «Compare code»'s seam `SideSaver` (../../compare/sideSaver.ts) for a file opened from the system
 * (seam `OpenedFiles`, ./files.ts), the way `projectSaver` (../projectSaver.ts) is for a project's file: Save writes
 * the file through the companion from the version the edit started from (`baseHash`), so a file that changed on disk
 * meanwhile is not overwritten — the refusal names the disk's version (`conflict`) and the page offers the same three
 * choices as for a project's file. The editor saves by itself (../autosave.ts) through `write`.
 *
 * An opened file has no folder of its own on the page: nothing is created next to it, so Save as is not the
 * companion's — it is the browser's (the saver the root names for downloads), or cancelled without one. Refusals come
 * back with the companion's code and data, never its message: the page says them in its own words.
 */
import { isCompanionError } from '../types';
import type { SaveRequest, SaveResult, SideSaver } from '../../compare/sideSaver';
import type { OpenedFiles } from './files';

export interface OpenedFileSaver extends SideSaver {
  readonly file: string;
  /** The version of the file the next Save starts from. */
  readonly baseHash: string;
  /** The companion's save from `baseHash`: the new version, or a rejection with its error (`conflict`, …). */
  write(text: string, baseHash: string): Promise<{ hash: string }>;
}

export interface OpenedFileSaverOptions {
  /** Where Save as goes (the browser's picker or a download); without it Save as is cancelled. */
  saveAs?: SideSaver;
}

export type OpenedFileSaverFactory = (
  files: OpenedFiles,
  file: string,
  name: string,
  baseHash: string,
  options?: OpenedFileSaverOptions,
) => OpenedFileSaver;

const refused = (error: unknown): SaveResult => {
  if (isCompanionError(error, 'cancelled')) return { status: 'cancelled' };
  if (isCompanionError(error))
    return { status: 'failed', message: error.code, code: error.code, ...(error.data && { data: { ...error.data } }) };
  return { status: 'failed', message: error instanceof Error ? error.message : String(error) };
};

export const openedFileSaver: OpenedFileSaverFactory = (files, file, name, baseHash, options = {}) => {
  let base = baseHash;
  const write: OpenedFileSaver['write'] = async (text, from) => {
    const saved = await files.save(file, from, text);
    base = saved.hash;
    return saved;
  };
  return {
    name: 'opened-file',
    file,
    get baseHash() {
      return base;
    },
    write,
    async save(request: SaveRequest): Promise<SaveResult> {
      try {
        await write(request.text, base);
        return { status: 'saved', fileName: name, handle: null, how: 'file' };
      } catch (error) {
        return refused(error);
      }
    },
    saveAs: request => (options.saveAs ? options.saveAs.saveAs(request) : Promise.resolve({ status: 'cancelled' })),
  };
};
