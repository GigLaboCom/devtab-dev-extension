/**
 * Save (docs/tools/specs/compress.md §5.10). Where the browser can write files (`showSaveFilePicker` — the extension's
 * pages have it), the person picks the file in the system's dialog and the bytes go into it as a stream: held bytes from
 * the page, a large result from a worker that makes it again straight into the file. Elsewhere, a temporary
 * `<a download>` on a Blob of the held bytes. No permission either way: the dialog is the person's choice.
 */
type Picker = (options: { suggestedName?: string }) => Promise<FileSystemFileHandle>;

const picker = (): Picker | null => {
  const w = globalThis as unknown as { showSaveFilePicker?: Picker };
  return typeof w.showSaveFilePicker === 'function' ? w.showSaveFilePicker.bind(globalThis) : null;
};

export const canWriteFiles = (): boolean => picker() !== null;

/** The file the person chose, or null when they closed the dialog. Call it in the press (it needs the gesture). */
export const pickFile = async (suggestedName: string): Promise<FileSystemFileHandle | null> => {
  try {
    return await picker()!({ suggestedName });
  } catch (error) {
    if (error instanceof DOMException && error.name === 'AbortError') return null;
    throw error;
  }
};

export const writeBytes = async (handle: FileSystemFileHandle, bytes: Uint8Array): Promise<void> => {
  const writable = await handle.createWritable();
  try {
    await writable.write(bytes as Uint8Array<ArrayBuffer>);
    await writable.close();
  } catch (error) {
    await writable.abort().catch(() => undefined);
    throw error;
  }
};

/** A temporary `<a download>` on the bytes, clicked and removed; its URL revoked after the click. */
export const downloadBytes = (bytes: Uint8Array, fileName: string): void => {
  const url = URL.createObjectURL(new Blob([bytes as Uint8Array<ArrayBuffer>]));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  a.hidden = true;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
};
