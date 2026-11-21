/**
 * The rules for what may become a side's text (files.ts), and how a drop is collected.
 */
import { MAX_BYTES, collectDrop, decodeText, lineCount, readEntries } from './files';
import { describe, expect, it } from 'vitest';
import type { DroppedEntry } from '@src/shared/viewerProtocol';

const bytes = (...values: number[]): Uint8Array => new Uint8Array(values);
const utf8 = (text: string): Uint8Array => new TextEncoder().encode(text);
const entry = (file: File, extra: Partial<DroppedEntry> = {}): DroppedEntry => ({
  name: file.name,
  file,
  handle: null,
  directory: false,
  text: null,
  ...extra,
});
const file = (name: string, content: BlobPart, size?: number): File => {
  const f = new File([content], name);
  if (size !== undefined) Object.defineProperty(f, 'size', { value: size });
  return f;
};

describe('decodeText', () => {
  it('reads UTF-8, keeping line ends; a byte-order mark is taken off and remembered', () => {
    expect(decodeText(utf8('a\r\nb — ü\n'))).toEqual({ text: 'a\r\nb — ü\n', bom: false });
    expect(decodeText(bytes(0xef, 0xbb, 0xbf, 0x61))).toEqual({ text: 'a', bom: true });
    expect(decodeText(bytes())).toEqual({ text: '', bom: false });
  });
  it('refuses binary files, UTF-16 and text that is not UTF-8', () => {
    expect(decodeText(bytes(0x89, 0x50, 0x4e, 0x47, 0x00, 0x01))).toEqual({ problem: 'looks like a binary file' });
    expect(decodeText(bytes(0xff, 0xfe, 0x61, 0x00))).toEqual({ problem: 'is UTF-16 text; only UTF-8 is read' });
    expect(decodeText(bytes(0x63, 0x61, 0x66, 0xe9))).toEqual({ problem: 'is not UTF-8 text; only UTF-8 is read' });
  });
});

describe('readEntries', () => {
  it('reads one or two files in order', async () => {
    const result = await readEntries([entry(file('a.rs', 'fn a() {}\n')), entry(file('b.rs', 'fn b() {}\n'))]);
    expect(result.problems).toEqual([]);
    expect(result.texts.map(t => [t.fileName, t.text])).toEqual([
      ['a.rs', 'fn a() {}\n'],
      ['b.rs', 'fn b() {}\n'],
    ]);
  });
  it('takes dragged text as a text without a file', async () => {
    const result = await readEntries([{ name: '', file: null, handle: null, directory: false, text: 'hello' }]);
    expect(result.texts).toEqual([{ text: 'hello', fileName: null, handle: null, bom: false }]);
  });
  it('is all or nothing: one bad item and no text is used, every problem named', async () => {
    const result = await readEntries([
      entry(file('notes.txt', 'fine\n')),
      entry(file('logo.png', new Uint8Array([0x89, 0x50, 0x00]))),
    ]);
    expect(result.texts).toEqual([]);
    expect(result.problems).toEqual(['logo.png looks like a binary file']);
  });
  it('refuses more than two items, folders, files over the limit and files that cannot be read', async () => {
    const three = await readEntries([1, 2, 3].map(n => entry(file(`${n}.txt`, 'x'))));
    expect(three.problems).toEqual(['3 items at once — one or two files can be compared (the first is the original)']);
    const folder = await readEntries([{ name: 'src', file: null, handle: null, directory: true, text: null }]);
    expect(folder.problems).toEqual(['src is a folder; drop files']);
    const large = await readEntries([entry(file('huge.log', 'x', MAX_BYTES * 2 + 1))]);
    expect(large.problems).toEqual(['huge.log is too large (10.0 MB; the limit is 5.0 MB)']);
    const broken = file('gone.txt', 'x');
    broken.arrayBuffer = () => Promise.reject(new DOMException('The file was removed', 'NotReadableError'));
    expect((await readEntries([entry(broken)])).problems).toEqual([
      'gone.txt could not be read (The file was removed)',
    ]);
  });
});

describe('collectDrop', () => {
  const transfer = (files: File[], items: Array<Partial<DataTransferItem>>, text = ''): DataTransfer =>
    ({
      files,
      items,
      types: files.length ? ['Files'] : ['text/plain'],
      getData: () => text,
    }) as unknown as DataTransfer;

  it('takes the files, which are folders, and the handles the browser gives', async () => {
    const a = file('a.txt', 'a');
    const dir = file('src', '');
    const handle = { kind: 'file', name: 'a.txt' } as FileSystemFileHandle;
    const entries = await collectDrop(
      transfer(
        [a, dir],
        [
          {
            kind: 'file',
            webkitGetAsEntry: () => ({ isDirectory: false }) as FileSystemEntry,
            getAsFileSystemHandle: () => Promise.resolve(handle),
          } as Partial<DataTransferItem>,
          { kind: 'file', webkitGetAsEntry: () => ({ isDirectory: true }) as FileSystemEntry },
        ],
      ),
    );
    expect(entries).toEqual([
      { name: 'a.txt', file: a, handle, directory: false, text: null },
      { name: 'src', file: null, handle: null, directory: true, text: null },
    ]);
  });
  it('takes dragged text when there are no files', async () => {
    expect(await collectDrop(transfer([], [{ kind: 'string' }], 'some text'))).toEqual([
      { name: '', file: null, handle: null, directory: false, text: 'some text' },
    ]);
  });
});

it('counts lines as the editor does', () => {
  expect([lineCount(''), lineCount('a'), lineCount('a\n'), lineCount('a\nb')]).toEqual([1, 1, 2, 2]);
});
