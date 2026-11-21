/**
 * What may become a side's text, and how a drop is collected. Plain functions over `File`s and bytes — the default
 * TextSource (textSource.ts) applies them to dropped and opened files; the editor page uses `collectDrop` for a drop
 * that reaches its canvas. The rules (docs/decisions.md D11):
 *
 * - one drop or one pick is all or nothing: if any item cannot be used, no side changes and the message names each
 *   problem — the page never ends up half-replaced;
 * - at most two items (two = the original and the changed text); a folder is refused;
 * - a file over MAX_BYTES is refused before it is read;
 * - a file whose first 8 000 bytes hold a NUL byte is binary (git's test), as is UTF-16 (its byte-order mark);
 * - text must be UTF-8 (a decoding error refuses the file); a UTF-8 byte-order mark is taken off and remembered, so
 *   Save writes it back; line ends are kept as they are (the editor shows `\r\n` files unchanged);
 * - an empty file is fine: an empty side.
 */
import type { DroppedEntry } from '@src/shared/viewerProtocol';

/** The largest file a side takes: the editor compares and shows a 50 000-line, 2.5 MB pair in well under a second. */
export const MAX_BYTES = 5 * 1024 * 1024;
/** How far into a file to look for a NUL byte (git looks at the first 8 000 bytes). */
const BINARY_PROBE = 8000;

/** An error's own words (a DOMException is not an Error in every realm). */
export const messageOf = (error: unknown): string =>
  typeof error === 'object' && error !== null && 'message' in error ? String(error.message) : String(error);

/** Whether an error is the user closing a picker or a prompt. */
export const isAbort = (error: unknown): boolean =>
  typeof error === 'object' && error !== null && 'name' in error && error.name === 'AbortError';

/** A text that may go into a side, from a file or elsewhere. */
export interface SideText {
  text: string;
  /** The file's name; null for text that did not come from a file. */
  fileName: string | null;
  /** The file's handle when the browser gave one (File System Access): Save can write back to it. */
  handle: FileSystemFileHandle | null;
  /** The file began with a UTF-8 byte-order mark (taken off the text, written back on Save). */
  bom: boolean;
}

/** What a drop or a pick yields: texts in order, or — if anything was wrong — the problems and no texts. */
export interface Incoming {
  texts: SideText[];
  problems: string[];
}

export const formatBytes = (bytes: number): string =>
  bytes < 1024
    ? `${bytes} bytes`
    : bytes < 1024 * 1024
      ? `${(bytes / 1024).toFixed(1)} KB`
      : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export type Decoded = { text: string; bom: boolean } | { problem: string };

/** A file's bytes as a side's text, or why they cannot be one. */
export const decodeText = (bytes: Uint8Array): Decoded => {
  if (bytes.length >= 2 && ((bytes[0] === 0xff && bytes[1] === 0xfe) || (bytes[0] === 0xfe && bytes[1] === 0xff)))
    return { problem: 'is UTF-16 text; only UTF-8 is read' };
  if (bytes.subarray(0, BINARY_PROBE).includes(0)) return { problem: 'looks like a binary file' };
  const bom = bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bom ? bytes.subarray(3) : bytes);
    return { text, bom };
  } catch {
    return { problem: 'is not UTF-8 text; only UTF-8 is read' };
  }
};

/** Reads one file under the rules above. */
const readFile = async (file: File, handle: FileSystemFileHandle | null): Promise<SideText | string> => {
  if (file.size > MAX_BYTES)
    return `${file.name} is too large (${formatBytes(file.size)}; the limit is ${formatBytes(MAX_BYTES)})`;
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await file.arrayBuffer());
  } catch (error) {
    return `${file.name} could not be read (${messageOf(error)})`;
  }
  const decoded = decodeText(bytes);
  if ('problem' in decoded) return `${file.name} ${decoded.problem}`;
  return { text: decoded.text, fileName: file.name, handle, bom: decoded.bom };
};

/** Applies the rules to the items of one drop or one pick. */
export const readEntries = async (entries: readonly DroppedEntry[]): Promise<Incoming> => {
  if (entries.length > 2) {
    return {
      texts: [],
      problems: [`${entries.length} items at once — one or two files can be compared (the first is the original)`],
    };
  }
  const read = await Promise.all(
    entries.map(async (entry): Promise<SideText | string> => {
      if (entry.directory) return `${entry.name} is a folder; drop files`;
      if (entry.file) return readFile(entry.file, entry.handle);
      if (entry.text !== null) return { text: entry.text, fileName: null, handle: null, bom: false };
      return `${entry.name || 'the item'} is neither a file nor text`;
    }),
  );
  const problems = read.filter((r): r is string => typeof r === 'string');
  return problems.length ? { texts: [], problems } : { texts: read as SideText[], problems: [] };
};

/** `getAsFileSystemHandle` (Chrome 86+, File System Access): not in TypeScript's DOM types. */
type HandleItem = DataTransferItem & { getAsFileSystemHandle?: () => Promise<FileSystemHandle | null> };

/**
 * The items of a drop. Everything the browser keeps only during the event — the files, whether an item is a folder,
 * the handle promises, dragged text — is taken synchronously; the promise resolves once the handles have.
 */
export const collectDrop = (transfer: DataTransfer): Promise<DroppedEntry[]> => {
  const files = [...transfer.files];
  // A file's item has kind `file` in a real drop and an empty kind in one sent through DevTools; never `string`.
  const items = [...transfer.items].filter(item => item.kind !== 'string') as HandleItem[];
  const pending = files.map(async (file, index) => {
    const item = items[index];
    const directory = item?.webkitGetAsEntry?.()?.isDirectory ?? false;
    const handlePromise = item?.getAsFileSystemHandle?.().catch(() => null) ?? Promise.resolve(null);
    const handle = await handlePromise;
    return {
      name: file.name,
      file: directory ? null : file,
      handle: handle && handle.kind === 'file' ? (handle as FileSystemFileHandle) : null,
      directory: directory || handle?.kind === 'directory',
      text: null,
    } satisfies DroppedEntry;
  });
  if (!files.length) {
    const text = transfer.getData('text/plain');
    if (text) return Promise.resolve([{ name: '', file: null, handle: null, directory: false, text }]);
  }
  return Promise.all(pending);
};

/** How many lines a text has, as the editor counts them (a newline at the end opens one more line). */
export const lineCount = (text: string): number => text.split('\n').length;
