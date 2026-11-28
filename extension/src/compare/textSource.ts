/**
 * Seam `TextSource` — where a side's text comes from when it is a file (docs/replaceable-behaviors.md): the files the
 * user picks, the items of a drop, and the texts another part of the page handed over (a tool sending the person here,
 * handoff.ts). Files and drops go through the same rules (files.ts: one or two files, all or nothing,
 * UTF-8 text, the size limit). The clipboard is the `Clipboard` seam (clipboard.ts), the example the `ExampleSource`
 * seam (examples.ts).
 *
 * The default picks with the File System Access API where the browser has it (`showOpenFilePicker`): the handles it
 * gives let Save write back to the opened file after Chrome's own prompt. Without it, a plain file input — then Save
 * downloads (sideSaver.ts). Nothing read is stored: the texts go to the editor and stay in the page's memory.
 */
import { isAbort, messageOf, readEntries } from './files';
import { takeHandedTexts } from './handoff';
import type { Incoming, SideText } from './files';
import type { HandedCompareText } from './handoff';
import type { DroppedEntry } from '@src/shared/viewerProtocol';

export interface TextSource {
  /** The browser's file chooser (one or two files); null when the user closes it without choosing. */
  pick(): Promise<Incoming | null>;
  /** The items of a drop, collected during the event (files.ts `collectDrop`). */
  drop(entries: readonly DroppedEntry[]): Promise<Incoming>;
  /**
   * Texts handed over for the comparison when the page opened — the original, then the changed text — taken once; none
   * when nothing was handed over. Absent: the page never gets any.
   */
  handed?(): readonly SideText[];
}

/** The File System Access pickers: in Chrome, not in TypeScript's DOM types. */
export interface OpenPicker {
  showOpenFilePicker?: (options?: { multiple?: boolean }) => Promise<FileSystemFileHandle[]>;
}

/** A plain `<input type=file>`: resolves with the chosen files, or null when the chooser is closed. */
const inputPick = (doc: Document): Promise<File[] | null> =>
  new Promise(resolve => {
    const input = doc.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.addEventListener('change', () => resolve(input.files ? [...input.files] : null), { once: true });
    input.addEventListener('cancel', () => resolve(null), { once: true });
    input.click();
  });

export const browserTextSource = (
  win: Window & OpenPicker,
  handedTexts: () => readonly HandedCompareText[] = takeHandedTexts,
): TextSource => ({
  async pick() {
    if (typeof win.showOpenFilePicker === 'function') {
      let handles: FileSystemFileHandle[];
      try {
        handles = await win.showOpenFilePicker({ multiple: true });
      } catch (error) {
        if (isAbort(error)) return null;
        return { texts: [], problems: [`The file could not be opened (${messageOf(error)})`] };
      }
      const entries = await Promise.all(
        handles.map(async (handle): Promise<DroppedEntry> => {
          const file = await handle.getFile();
          return { name: file.name, file, handle, directory: false, text: null };
        }),
      );
      return readEntries(entries);
    }
    const files = await inputPick(win.document);
    if (!files?.length) return null;
    return readEntries(files.map(file => ({ name: file.name, file, handle: null, directory: false, text: null })));
  },
  drop: entries => readEntries(entries),
  handed: () =>
    handedTexts().map(({ text, name, origin }) => ({
      text,
      fileName: name,
      handle: null,
      bom: false,
      ...(origin && { project: origin }),
    })),
});
