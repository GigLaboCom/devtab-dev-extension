/**
 * Seam `SideSaver` — how a side's text is saved (docs/replaceable-behaviors.md). "Save" and "Save as" as in editors:
 * Save writes back to the side's own file when the browser gave a handle for it (opened with the File System Access
 * picker, dropped, or saved as before), asking Chrome for write access the first time; without one it does what Save
 * as does. Save as always asks where.
 *
 * Two implementations here, chosen by what the browser has (behaviors.ts):
 * - `fileSystemSaver` — `showSaveFilePicker` and `FileSystemFileHandle.createWritable` (Chrome 86+, on extension pages
 *   too: docs/spikes/compare-probe);
 * - `downloadSaver` — the fallback: the text as a download (`<a download>` with a `blob:` address, which the
 *   extension's CSP allows); the browser decides where it goes.
 * A third lives with the Projects section: `projectSaver` (src/projects/projectSaver.ts) saves a side that is a
 * project's file through the companion (`file.save` from the version it started from; Save as — `file.create`). It
 * passes the same contract (seams.test.ts) and is chosen by the section's composition root.
 *
 * These are the only writes of «Compare code», and only when the user asks: nothing else is stored (D16).
 */
import { isAbort, messageOf as message } from './files';

export interface SaveRequest {
  text: string;
  /** Write a UTF-8 byte-order mark first (the file had one). */
  bom: boolean;
  /** What a "where to save" question suggests: the side's file name or a neutral one. */
  suggestedName: string;
  /** The side's own file, when Save may write back to it. */
  handle: FileSystemFileHandle | null;
}

export type SaveResult =
  | {
      status: 'saved';
      /** The name it was saved under. */
      fileName: string;
      /** Where the next Save writes without asking; null after a download. */
      handle: FileSystemFileHandle | null;
      how: 'file' | 'download';
    }
  | { status: 'cancelled' }
  | {
      status: 'failed';
      message: string;
      /** A refusal with a code (the companion's, for `projectSaver`): the page says it in its own words by it. */
      code?: string;
      data?: Record<string, unknown>;
    };

export interface SideSaver {
  /** For the report and the tests. */
  readonly name: string;
  save(request: SaveRequest): Promise<SaveResult>;
  saveAs(request: SaveRequest): Promise<SaveResult>;
}

export const blobOf = (request: Pick<SaveRequest, 'text' | 'bom'>): Blob =>
  new Blob([request.bom ? '﻿' : '', request.text], { type: 'text/plain;charset=utf-8' });

/** Write access to a file handle: not in TypeScript's DOM types. */
type PermissionedHandle = FileSystemFileHandle & {
  queryPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
  requestPermission?: (descriptor: { mode: 'readwrite' }) => Promise<PermissionState>;
};

export interface SavePicker {
  showSaveFilePicker?: (options?: { suggestedName?: string }) => Promise<FileSystemFileHandle>;
}

const writeTo = async (handle: FileSystemFileHandle, blob: Blob): Promise<SaveResult> => {
  const permissioned = handle as PermissionedHandle;
  try {
    if (permissioned.queryPermission && (await permissioned.queryPermission({ mode: 'readwrite' })) !== 'granted') {
      const answer = await permissioned.requestPermission?.({ mode: 'readwrite' });
      if (answer !== 'granted')
        return { status: 'failed', message: `Chrome was not allowed to change ${handle.name}. Use Save as instead.` };
    }
    const writable = await handle.createWritable();
    await writable.write(blob);
    await writable.close();
    return { status: 'saved', fileName: handle.name, handle, how: 'file' };
  } catch (error) {
    if (isAbort(error)) return { status: 'cancelled' };
    return { status: 'failed', message: `${handle.name} could not be written (${message(error)}).` };
  }
};

export const fileSystemSaver = (win: SavePicker): SideSaver => {
  const saveAs = async (request: SaveRequest): Promise<SaveResult> => {
    let handle: FileSystemFileHandle;
    try {
      handle = await win.showSaveFilePicker!({ suggestedName: request.suggestedName });
    } catch (error) {
      if (isAbort(error)) return { status: 'cancelled' };
      return { status: 'failed', message: `The file could not be saved (${message(error)}).` };
    }
    return writeTo(handle, blobOf(request));
  };
  return {
    name: 'file-system-access',
    save: request => (request.handle ? writeTo(request.handle, blobOf(request)) : saveAs(request)),
    saveAs,
  };
};

export interface DownloadDeps {
  doc: Document;
  url: Pick<typeof URL, 'createObjectURL' | 'revokeObjectURL'>;
}

export const downloadSaver = ({ doc, url }: DownloadDeps): SideSaver => {
  const download = async (request: SaveRequest): Promise<SaveResult> => {
    const address = url.createObjectURL(blobOf(request));
    const link = doc.createElement('a');
    link.href = address;
    link.download = request.suggestedName;
    doc.body.append(link);
    link.click();
    link.remove();
    // The browser has taken the address once the click returned; revoked a little later, as the download starts.
    setTimeout(() => url.revokeObjectURL(address), 10_000);
    return { status: 'saved', fileName: request.suggestedName, handle: null, how: 'download' };
  };
  return { name: 'download', save: download, saveAs: download };
};

/** The File System Access saver where the browser has its picker, the download otherwise. */
export const chooseSaver = (win: Window & SavePicker): SideSaver =>
  typeof win.showSaveFilePicker === 'function' ? fileSystemSaver(win) : downloadSaver({ doc: win.document, url: URL });
