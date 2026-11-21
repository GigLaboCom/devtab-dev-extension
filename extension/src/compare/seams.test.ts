/**
 * The shell seams of «Compare code» (docs/replaceable-behaviors.md): one shared contract per seam, run against every
 * implementation, and each default's own behaviour. The composition root picks them (behaviors.ts).
 */
import { compareBehaviors, windowConfirm } from './behaviors';
import { REFUSED_READ, navigatorClipboard } from './clipboard';
import { bundledExamples, pairsOf } from './examples';
import { EXAMPLES } from './examples.data';
import { lineCount } from './files';
import { LANGUAGES } from './languages';
import { blobOf, chooseSaver, downloadSaver, fileSystemSaver } from './sideSaver';
import { browserTextSource } from './textSource';
import { describe, expect, it, vi } from 'vitest';
import type { SaveRequest, SideSaver } from './sideSaver';

// ---- SideSaver ----------------------------------------------------------------------------------------------------

/** A blob's text with a byte-order mark kept (Blob.text() takes it off). */
const textOf = async (blob: Blob): Promise<string> =>
  new TextDecoder('utf-8', { ignoreBOM: true }).decode(await blob.arrayBuffer());

/** A file handle that records what was written to it. */
const fakeHandle = (name: string, permission: PermissionState = 'granted') => {
  const written: string[] = [];
  const handle = {
    kind: 'file',
    name,
    queryPermission: vi.fn(() => Promise.resolve(permission)),
    requestPermission: vi.fn(() => Promise.resolve(permission)),
    createWritable: vi.fn(() =>
      Promise.resolve({
        write: async (blob: Blob) => void written.push(await textOf(blob)),
        close: () => Promise.resolve(),
      }),
    ),
  };
  return { handle: handle as unknown as FileSystemFileHandle, written, raw: handle };
};

/** Each saver with a world it saves into: what was written where, and a way to make the next "where?" a cancel. */
const savers = () => {
  const picked = fakeHandle('picked.rs');
  let cancelNext = false;
  const fsa = fileSystemSaver({
    showSaveFilePicker: async () => {
      if (cancelNext) {
        cancelNext = false;
        throw new DOMException('The user aborted a request.', 'AbortError');
      }
      return picked.handle;
    },
  });
  const downloads: Array<{ name: string; blob: Blob }> = [];
  const blobs = new Map<string, Blob>();
  const doc = document.implementation.createHTMLDocument('');
  const download = downloadSaver({
    doc,
    url: {
      createObjectURL: (blob: Blob) => {
        const address = `blob:test/${blobs.size}`;
        blobs.set(address, blob as Blob);
        return address;
      },
      revokeObjectURL: () => undefined,
    },
  });
  doc.addEventListener('click', event => {
    const link = event.target as HTMLAnchorElement;
    if (cancelNext) {
      cancelNext = false;
      return;
    }
    downloads.push({ name: link.download, blob: blobs.get(link.getAttribute('href')!)! });
    event.preventDefault();
  });
  return {
    all: [
      ['file-system-access', fsa, () => picked.written.at(-1)],
      ['download', download, async () => (downloads.length ? textOf(downloads.at(-1)!.blob) : undefined)],
    ] as Array<[string, SideSaver, () => Promise<string | undefined> | string | undefined]>,
    picked,
    downloads,
    cancel: () => (cancelNext = true),
  };
};

const request = (over: Partial<SaveRequest> = {}): SaveRequest => ({
  text: 'fn main() {}\n',
  bom: false,
  suggestedName: 'changed.rs',
  handle: null,
  ...over,
});

describe.each(savers().all.map(([name]) => name))('SideSaver contract: %s', name => {
  const pick = () => {
    const world = savers();
    const [, saver, last] = world.all.find(([n]) => n === name)!;
    return { world, saver, last };
  };
  it('Save as writes the text and says the name it went under', async () => {
    const { saver, last } = pick();
    const result = await saver.saveAs(request());
    expect(result.status).toBe('saved');
    expect(await last()).toBe('fn main() {}\n');
    if (result.status === 'saved') expect(['picked.rs', 'changed.rs']).toContain(result.fileName);
  });
  it('Save of a side with no file of its own does what Save as does', async () => {
    const { saver, last } = pick();
    expect((await saver.save(request())).status).toBe('saved');
    expect(await last()).toBe('fn main() {}\n');
  });
  it('writes the byte-order mark back when the file had one', async () => {
    const { saver, last } = pick();
    await saver.saveAs(request({ bom: true }));
    expect(await last()).toBe('﻿fn main() {}\n');
  });
});

describe('SideSaver defaults', () => {
  it('File System Access: Save writes back to the side’s own file, asking for write access first', async () => {
    const own = fakeHandle('lib.rs', 'prompt');
    own.raw.requestPermission.mockResolvedValue('granted');
    const saver = fileSystemSaver({ showSaveFilePicker: vi.fn() });
    const result = await saver.save(request({ handle: own.handle }));
    expect(own.raw.requestPermission).toHaveBeenCalledWith({ mode: 'readwrite' });
    expect(own.written).toEqual(['fn main() {}\n']);
    expect(result).toEqual({ status: 'saved', fileName: 'lib.rs', handle: own.handle, how: 'file' });
  });
  it('File System Access: a refused write access or a closed picker writes nothing and says so', async () => {
    const own = fakeHandle('lib.rs', 'denied');
    const saver = fileSystemSaver({
      showSaveFilePicker: () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
    });
    expect(await saver.save(request({ handle: own.handle }))).toEqual({
      status: 'failed',
      message: 'Chrome was not allowed to change lib.rs. Use Save as instead.',
    });
    expect(own.written).toEqual([]);
    expect(await saver.saveAs(request())).toEqual({ status: 'cancelled' });
  });
  it('the download is named after the side and leaves nothing to write back to', async () => {
    const world = savers();
    const [, download] = world.all[1]!;
    expect(await download.save(request({ handle: fakeHandle('lib.rs').handle }))).toEqual({
      status: 'saved',
      fileName: 'changed.rs',
      handle: null,
      how: 'download',
    });
    expect(world.downloads.map(d => d.name)).toEqual(['changed.rs']);
  });
  it('chooses File System Access where the browser has its picker, the download otherwise', () => {
    expect(chooseSaver(Object.assign(Object.create(window), { showSaveFilePicker: vi.fn() })).name).toBe(
      'file-system-access',
    );
    expect(chooseSaver(Object.assign(Object.create(window), { showSaveFilePicker: undefined })).name).toBe('download');
  });
  it('a saved text is UTF-8 plain text', async () => {
    expect(blobOf({ text: 'ü', bom: false }).type).toBe('text/plain;charset=utf-8');
    expect(await blobOf({ text: 'ü', bom: false }).text()).toBe('ü');
  });
});

// ---- TextSource ---------------------------------------------------------------------------------------------------

describe('TextSource default', () => {
  it('picks with File System Access where it is: the handles let Save write back', async () => {
    const handle = { kind: 'file', name: 'a.rs', getFile: () => Promise.resolve(new File(['fn a() {}\n'], 'a.rs')) };
    const source = browserTextSource(
      Object.assign(Object.create(window), {
        showOpenFilePicker: vi.fn(() => Promise.resolve([handle as unknown as FileSystemFileHandle])),
      }),
    );
    expect(await source.pick()).toEqual({
      texts: [{ text: 'fn a() {}\n', fileName: 'a.rs', handle, bom: false }],
      problems: [],
    });
  });
  it('a closed picker is nothing, not a problem', async () => {
    const source = browserTextSource(
      Object.assign(Object.create(window), {
        showOpenFilePicker: () => Promise.reject(new DOMException('The user aborted a request.', 'AbortError')),
      }),
    );
    expect(await source.pick()).toBeNull();
  });
  it('without File System Access, a file input; its files go through the same rules', async () => {
    const doc = document.implementation.createHTMLDocument('');
    const create = doc.createElement.bind(doc);
    vi.spyOn(doc, 'createElement').mockImplementation((tag: string) => {
      const element = create(tag);
      // The chooser: the user picks one file.
      if (element instanceof HTMLInputElement)
        element.click = () => {
          Object.defineProperty(element, 'files', { value: [new File(['x\n'], 'x.txt')] });
          element.dispatchEvent(new Event('change'));
        };
      return element;
    });
    const source = browserTextSource(
      Object.assign(Object.create(window), { document: doc, showOpenFilePicker: undefined }),
    );
    expect((await source.pick())?.texts.map(t => t.fileName)).toEqual(['x.txt']);
  });
  it('a drop goes through the rules (files.ts)', async () => {
    const source = browserTextSource(window);
    const result = await source.drop([{ name: 'src', file: null, handle: null, directory: true, text: null }]);
    expect(result.problems).toEqual(['src is a folder; drop files']);
  });
});

// ---- Clipboard ----------------------------------------------------------------------------------------------------

describe('Clipboard default', () => {
  it('reads and writes the system clipboard', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    const clipboard = navigatorClipboard({ readText: () => Promise.resolve('copied'), writeText });
    expect(await clipboard.read()).toEqual({ text: 'copied' });
    await clipboard.write('out');
    expect(writeText).toHaveBeenCalledWith('out');
  });
  it('a read Chrome refuses comes back with what to do instead (what Chrome says on an extension page)', async () => {
    const clipboard = navigatorClipboard({
      readText: () =>
        Promise.reject(
          new DOMException("Failed to execute 'readText' on 'Clipboard': Read permission denied.", 'NotAllowedError'),
        ),
      writeText: vi.fn(),
    });
    expect(await clipboard.read()).toEqual({ refused: REFUSED_READ });
  });
});

// ---- ExampleSource ------------------------------------------------------------------------------------------------

describe('ExampleSource default: the bundled pairs', () => {
  it('has a pair for every language of the list', async () => {
    const examples = bundledExamples();
    for (const { id } of LANGUAGES) {
      const pair = await examples.load(id);
      expect(pair?.language, id).toBe(id);
    }
    expect(await examples.load('cobol')).toBeNull();
    expect(Object.keys(EXAMPLES).sort()).toEqual(LANGUAGES.map(l => l.id).sort());
  });
  it.each(Object.values(EXAMPLES).map(p => [p.language, p] as const))(
    '%s: short, two different versions, named after the language’s files',
    (_language, pair) => {
      for (const side of [pair.before, pair.after]) {
        expect(lineCount(side.text)).toBeGreaterThanOrEqual(20);
        expect(lineCount(side.text)).toBeLessThanOrEqual(60);
        expect(side.text.endsWith('\n')).toBe(true);
        // Nothing that reaches the network or names anyone: no addresses in the texts.
        expect(side.text).not.toMatch(/https?:\/\//);
      }
      expect(pair.before.text).not.toBe(pair.after.text);
      expect(pair.before.name.startsWith('before.')).toBe(true);
      expect(pair.after.name.startsWith('after.')).toBe(true);
    },
  );
  it('pairs files by language and side, the .txt off the name', () => {
    expect(
      pairsOf({
        './examples/go/before.go.txt': 'a',
        './examples/go/after.go.txt': 'b',
        './examples/lone/before.x.txt': 'c',
      }),
    ).toEqual({
      go: { language: 'go', before: { name: 'before.go', text: 'a' }, after: { name: 'after.go', text: 'b' } },
    });
  });
});

// ---- the composition root -----------------------------------------------------------------------------------------

describe('compareBehaviors', () => {
  it('assembles one implementation per seam and the toolbar list', () => {
    const behaviors = compareBehaviors(window);
    expect(Object.keys(behaviors).sort()).toEqual(
      ['actions', 'clipboard', 'confirmDiscard', 'examples', 'saver', 'texts'].sort(),
    );
    expect(behaviors.actions.length).toBeGreaterThan(0);
  });
  it('ConfirmDiscard default: the browser’s own question', async () => {
    const confirm = vi.fn(() => false);
    expect(await windowConfirm({ confirm })('Replace?')).toBe(false);
    expect(confirm).toHaveBeenCalledWith('Replace?');
  });
});
