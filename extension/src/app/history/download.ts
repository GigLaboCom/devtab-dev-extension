/**
 * Saves an export: the archive streams into a Blob (Chrome keeps a large one on disk, not in the page's memory) that a
 * link with `download` saves — no `downloads` permission. The file name says what it is and when it was made.
 */
import { isEverything } from '@workspace/tools-shared/history';
import type { HistoryArchive, HistoryFilter, HistoryStore, Producer } from '@workspace/tools-shared/history';

export const archiveName = (product: string, now: number, filtered: boolean): string => {
  const d = new Date(now);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  const slug = product
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
  return `${slug}-history${filtered ? '-filtered' : ''}-${stamp}.zip`;
};

export const saveStream = async (
  stream: ReadableStream<Uint8Array>,
  name: string,
  doc: Document = document,
): Promise<number> => {
  const blob = await new Response(stream).blob();
  const url = URL.createObjectURL(new Blob([blob], { type: 'application/zip' }));
  const a = doc.createElement('a');
  a.href = url;
  a.download = name;
  a.hidden = true;
  doc.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
  return blob.size;
};

/** Exports what `filter` matches to a file the user saves; returns how many records went and the file's size. */
export const download = async (
  host: { store: HistoryStore; archive: HistoryArchive; producer: Producer },
  filter: HistoryFilter,
  now = Date.now(),
): Promise<{ records: number; size: number }> => {
  const { records } = await host.store.measure(filter);
  const stream = host.archive.write(host.store, filter, { producer: host.producer, now });
  const size = await saveStream(stream, archiveName(host.producer.name, now, !isEverything(filter)));
  return { records, size };
};
