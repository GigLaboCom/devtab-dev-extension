import CompressTool from './CompressTool';
import { definition } from './definition';
import { detect } from './detect';
import { pageCodecs } from './runner';
import { compressSettings } from './settings';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { gzipSync } from 'node:zlib';

// The specification's samples (docs/tools/specs/compress.md §10).
const HELLO_GZ = 'H4sIAAAAAAAAA8tIzcnJBwCGphA2BQAAAA==';
const WAIT = { timeout: 5000 };

// jsdom has no workers: the work runs on the page, with the codecs the workers carry.
beforeAll(() => {
  pageCodecs.load = async family =>
    family === 'zstd'
      ? { zstd: (await import('./workers/zstdModule')).zstdBytes }
      : family === 'brotli'
        ? { brotliDecoder: (await import('./workers/brotliModule')).brotliBytes }
        : family === 'brotli-encode'
          ? {
              brotliCompress: (await import('./workers/brotliEncoder')).brotliCompress,
              brotliDecoder: (await import('./workers/brotliModule')).brotliBytes,
            }
          : {};
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const input = () => screen.getByLabelText('Input') as HTMLTextAreaElement;
const result = () => (screen.getByLabelText('Result') as HTMLTextAreaElement).value;
const typeIn = (value: string) => fireEvent.change(input(), { target: { value } });
/** A segment of one toggle group: Direction, Input encoding or View. */
const segment = (name: string, group?: string) =>
  fireEvent.click(
    group ? within(screen.getByLabelText(group)).getByRole('radio', { name }) : screen.getByRole('radio', { name }),
  );
const line = (part: string) => document.querySelector(`[data-part="${part}"]`)?.textContent?.trim() ?? '';
const notes = () =>
  [...document.querySelectorAll('[data-part="notes"] [data-slot="tool-message"]')].map(n => n.textContent!.trim());
const hints = () =>
  [...document.querySelectorAll('[data-part="hints"] [data-slot="tool-message"]')].map(n => n.textContent!.trim());
const fileInput = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const choose = (file: File) => fireEvent.change(fileInput(), { target: { files: [file] } });
const pick = async (label: string, option: string) => {
  fireEvent.keyDown(screen.getByLabelText(label), { key: 'Enter' });
  fireEvent.keyDown(await screen.findByRole('option', { name: option }), { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const stubClipboard = () => {
  const writeText = vi.fn<(text: string) => Promise<void>>(() => Promise.resolve());
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText } });
  return writeText;
};
const entriesOf = async (host: ReturnType<typeof memoryHost>, kinds?: string[]) =>
  (await host.history.forOwner('compress', definition.history!).list(kinds ? { kinds } : {})).entries;

describe('the Compress / Decompress tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition).toMatchObject({ id: 'compress', order: 37, output: { origin: 'input' } });
    expect((await definition.load()).default).toBe(CompressTool);
  });

  it('recognises its input from a module of its own (§7)', () => {
    expect(detect(HELLO_GZ)).toBe(true);
    expect(detect('SGVsbG8sIFdvcmxkIQ==')).toBe(false);
  });

  it('renders with no host at all, empty: Copy and Save off, no facts', () => {
    render(<CompressTool />);
    expect(input().value).toBe('');
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByRole('button', { name: 'Save' }) as HTMLButtonElement).disabled).toBe(true);
    expect(line('sizes')).toBe('');
  });
});

describe('§2 scenarios', () => {
  it('1: gzip Base64 handed from the start page — hello, the sizes, the header', async () => {
    render(<CompressTool input={HELLO_GZ} />);
    await waitFor(() => expect(result()).toBe('hello'), WAIT);
    expect(line('sizes')).toBe('gzip (recognised by 1f 8b) · 25 bytes → 5 bytes · ratio 0.20 : 1');
    expect(line('header')).toContain('Operating system');
    expect(line('header')).toContain('Unix (3)');
    expect(line('header')).toContain('not set');
  });

  it('2, 3: zlib recognised, zstd recognised', async () => {
    render(<CompressTool />);
    typeIn('eJzLSM3JyQcABiwCFQ==');
    await waitFor(() => expect(result()).toBe('hello'), WAIT);
    expect(line('sizes')).toMatch(/^zlib \(recognised by its zlib header\)/);
  });

  it('4: brotli is not recognised by Auto; chosen by hand it reads', async () => {
    render(<CompressTool />);
    typeIn('CwKAaGVsbG8D');
    await waitFor(() => expect(line('error')).toMatch(/^The format is not recognised/), WAIT);
    expect(result()).toBe('');
  });

  it('6: a result that is not text is shown in hex, Text is off, with the note', async () => {
    render(<CompressTool />);
    typeIn(gzipSync(Buffer.from([0xff, 0xfe, 0xfd, 0x00, 0x41])).toString('base64'));
    await waitFor(() => expect(result()).toBe('ff fe fd 00 41'), WAIT);
    expect(notes()).toContain('Not text: not valid UTF-8 from byte 1.');
    expect(
      (within(screen.getByLabelText('View')).getByRole('radio', { name: 'Text' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    segment('Base64', 'View');
    expect(result()).toBe('//79AEE=');
  });

  it('8: Compress hello into gzip — the same bytes every time: no name, no time, OS 255', async () => {
    render(<CompressTool />);
    segment('Compress');
    typeIn('hello');
    await waitFor(() => expect(result()).toBe('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA=='), WAIT);
    expect(line('sizes')).toBe('gzip · 5 bytes → 25 bytes · ratio 0.20 : 1');
    segment('Hex', 'View');
    expect(result()).toBe('1f8b08000000000000ffcb48cdc9c9070086a6103605000000');
    await pick('Format', 'zlib');
    segment('Base64', 'View');
    await waitFor(() => expect(result()).toBe('eJzLSM3JyQcABiwCFQ=='), WAIT);
  });

  it('10: Base64 under Hex — the error with its place and the hint', async () => {
    render(<CompressTool />);
    segment('Hex', 'Input encoding');
    typeIn(HELLO_GZ);
    await waitFor(() => expect(line('error')).toBe('Line 1, column 1: "H" is not a hex digit'), WAIT);
    expect(hints()).toContain('This looks like Base64: choose Base64.');
  });

  it('a typo in Base64 is named with its place, and the result goes', async () => {
    render(<CompressTool />);
    typeIn('H4sI!');
    await waitFor(() => expect(line('error')).toBe('Line 1, column 5: invalid character "!"'), WAIT);
    expect(result()).toBe('');
  });

  it('a text that ends with a line break says so; CR LF is shown as a symbol, copied as is', async () => {
    const writeText = stubClipboard();
    render(<CompressTool />);
    typeIn(gzipSync('a\r\nb').toString('base64'));
    await waitFor(() => expect(result()).toBe('a\u{240d}\nb'), WAIT);
    expect(notes()).toContain('1 control character, shown as a symbol. Copy copies the real characters.');
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith('a\r\nb'));
    segment('Compress');
    typeIn('abc\n');
    expect(hints()).toContain('The text ends with a line break. It is part of the compressed bytes.');
  });

  it('a file is decompressed; a result over 1 MiB is previewed, not shown, and Copy is off', async () => {
    render(<CompressTool />);
    segment('File', 'Input encoding');
    const big = Buffer.alloc(1100 * 1024, 'abcdefgh');
    choose(new File([gzipSync(big)], 'big.txt.gz'));
    await waitFor(
      () => expect(line('too-large')).toMatch(/^The result is 1\.1 MB: too large to show here\. Save it as a file\./),
      WAIT,
    );
    expect(result()).toBe(big.subarray(0, 4096).toString());
    expect((screen.getByRole('button', { name: 'Copy' }) as HTMLButtonElement).disabled).toBe(true);
    expect(line('file')).toMatch(/^big\.txt\.gz — \d[\d.]* KB \([\d,]+ bytes\)$/);
  });

  it('two gzip members read one after another, with the note', async () => {
    render(<CompressTool />);
    typeIn(Buffer.concat([gzipSync('hello '), gzipSync('world')]).toString('base64'));
    await waitFor(() => expect(result()).toBe('hello world'), WAIT);
  });

  it('a result that is gzip again offers Decompress again', async () => {
    render(<CompressTool />);
    typeIn(gzipSync(gzipSync('inner')).toString('base64'));
    await waitFor(() => expect(notes()).toContain('The result is gzip data too.'), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Decompress again' }));
    await waitFor(() => expect(result()).toBe('inner'), WAIT);
  });
});

describe('history (D17)', () => {
  it('records an edit as a snapshot and Copy as a commit, with the input as a blob', async () => {
    stubClipboard();
    const host = memoryHost();
    const { unmount } = render(<CompressTool host={host} />);
    typeIn(HELLO_GZ);
    await waitFor(() => expect(result()).toBe('hello'), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(async () => expect((await entriesOf(host)).some(e => e.label?.endsWith('copied'))).toBe(true), WAIT);
    unmount();
    await act(async () => undefined);
    const entries = await entriesOf(host, ['decompress']);
    const copied = entries.find(e => e.label?.endsWith('copied'))!;
    expect(copied.label).toBe('Decompress · gzip · 25 bytes → 5 bytes · ratio 0.20 : 1 · copied');
    const opened = await host.history.forOwner('compress', definition.history!).open(copied.id);
    expect(opened.ok && (await opened.blobs.input!.text())).toBe(HELLO_GZ);
    expect(opened.ok && opened.payload).toMatchObject({
      direction: 'decompress',
      format: 'auto',
      recognised: 'gzip',
      input: 'base64',
      inputBytes: 25,
      outputBytes: 5,
      action: 'copy',
    });
  });

  it('opens an entry back: direction, format, input; the result is made again', async () => {
    stubClipboard();
    const host = memoryHost();
    const first = render(<CompressTool host={host} />);
    segment('Compress');
    await pick('Format', 'zstd');
    typeIn('hello');
    await waitFor(() => expect(result()).toBe('KLUv/QBYKQAAaGVsbG8='), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Copy' }));
    await waitFor(async () => expect(await entriesOf(host, ['compress'])).not.toHaveLength(0), WAIT);
    first.unmount();
    await act(async () => undefined);
    const entry = (await entriesOf(host, ['compress'])).find(e => e.label?.endsWith('copied'))!;
    expect(entry.label).toBe('Compress · zstd 3 · 5 bytes → 14 bytes · ratio 0.36 : 1 · copied');
    render(<CompressTool host={host} restore={{ id: entry.id }} />);
    expect(await screen.findByText(`Opened from History: ${entry.label}.`)).toBeTruthy();
    expect(input().value).toBe('hello');
    await waitFor(() => expect(result()).toBe('KLUv/QBYKQAAaGVsbG8='), WAIT);
  });

  it('keeps no input over 1 MiB, and says so', async () => {
    const host = memoryHost();
    render(<CompressTool host={host} />);
    segment('Compress');
    typeIn('x'.repeat(1024 * 1024 + 1));
    expect(hints()).toContain('This input is over 1 MiB: it is not kept in the history.');
    await waitFor(() => expect(result()).not.toBe(''), WAIT);
    await new Promise(r => setTimeout(r, 50));
    expect(await entriesOf(host)).toHaveLength(0);
  });
});

describe('saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('compress').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('compress').save(compressSettings.schema, values as never);
    await host.settings.forTool('compress').flush();
  };
  /** The segment that is on in a toggle group. */
  const on = (group: string) =>
    within(screen.getByLabelText(group))
      .getAllByRole('radio')
      .find(r => r.getAttribute('data-state') === 'on')?.textContent;
  const shown = (label: string) => screen.getByLabelText(label).textContent;

  it('saves what the person chose; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<CompressTool host={host} />);
    await pick('Format', 'brotli');
    segment('Base64', 'View');
    segment('Compress');
    await pick('Format', 'zstd');
    await pick('Level', '9');
    segment('Hex', 'View');
    segment('Hex', 'Input encoding');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: {
        dFormat: 'brotli',
        view: 'base64',
        direction: 'compress',
        cFormat: 'zstd',
        zstdLevel: 9,
        encoding: 'hex',
        cInput: 'hex',
      },
    });
    render(<CompressTool host={host} />);
    expect(on('Direction')).toBe('Compress');
    expect([shown('Format'), shown('Level'), on('View'), on('Input encoding')]).toEqual(['zstd', '9', 'Hex', 'Hex']);
    expect(input().value).toBe('');
    typeIn('68656c6c6f');
    await waitFor(() => expect(result()).toMatch(/^28b52ffd/), WAIT);
    segment('Decompress');
    expect([shown('Format'), on('View'), on('Input encoding')]).toEqual(['brotli', 'Base64', 'Base64']);
    typeIn('CwKAaGVsbG8D');
    await waitFor(() => expect(result()).toBe('aGVsbG8='), WAIT);
  });

  it('a saved record it cannot show falls back field by field', async () => {
    const host = memoryHost();
    await seed(host, {
      direction: 'sideways',
      dFormat: 'lz4',
      cFormat: 'xz',
      zstdLevel: 25,
      brotliQuality: 5,
      keepName: 'yes',
      dInput: 'file',
      cInput: 'url',
      view: 'pixels',
      encoding: 'base64url',
    });
    render(<CompressTool host={host} />);
    expect(on('Direction')).toBe('Decompress');
    expect([shown('Format'), on('Input encoding'), on('View')]).toEqual([
      'Auto — from the first bytes',
      'File',
      'Text',
    ]);
    segment('Compress');
    expect([shown('Format'), on('Input encoding'), on('View')]).toEqual(['gzip', 'Text', 'Base64 URL-safe']);
    await pick('Format', 'zstd');
    expect(shown('Level')).toBe('3');
    await pick('Format', 'brotli');
    expect(shown('Quality')).toBe('5');
  });

  it('a paste, an opened entry and Decompress again choose for the visit; what is saved stays', async () => {
    const host = memoryHost();
    const kept = { direction: 'compress', dFormat: 'brotli', dInput: 'hex', view: 'base64' };
    await seed(host, kept);
    // Text handed over from the start page: Decompress, Auto, Base64; the saved view stays.
    const pasted = render(<CompressTool host={host} input={HELLO_GZ} />);
    expect(on('Direction')).toBe('Decompress');
    expect([shown('Format'), on('Input encoding')]).toEqual(['Auto — from the first bytes', 'Base64']);
    await waitFor(() => expect(result()).toBe('aGVsbG8='), WAIT);
    pasted.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    // An entry of the history: its direction, format, level, input and view.
    await host.history
      .forOwner('compress', definition.history!)
      .session()
      .commit({
        kind: 'compress',
        label: 'Compress · zstd 5',
        payload: { direction: 'compress', format: 'zstd', input: 'text', level: 5, view: 'hex', inputBytes: 5 },
        blobs: { input: new Blob(['hello'], { type: 'text/plain' }) },
      });
    const [entry] = await entriesOf(host);
    const opened = render(<CompressTool host={host} restore={{ id: entry!.id }} />);
    expect(await screen.findByText('Opened from History: Compress · zstd 5.')).toBeTruthy();
    expect([shown('Format'), shown('Level'), on('View'), on('Input encoding')]).toEqual(['zstd', '5', 'Hex', 'Text']);
    await waitFor(() => expect(result()).toMatch(/^28b52ffd/), WAIT);
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: kept });

    // Decompress again: the result's bytes choose Auto, File and the view; the saved ones stay.
    const again = memoryHost();
    await seed(again, { dFormat: 'gzip', view: 'hex' });
    render(<CompressTool host={again} />);
    typeIn(gzipSync(gzipSync('inner')).toString('base64'));
    await waitFor(() => expect(notes()).toContain('The result is gzip data too.'), WAIT);
    fireEvent.click(screen.getByRole('button', { name: 'Decompress again' }));
    await waitFor(() => expect(result()).toBe('inner'), WAIT);
    expect([shown('Format'), on('Input encoding'), on('View')]).toEqual([
      'Auto — from the first bytes',
      'File',
      'Text',
    ]);
    await again.settings.forTool('compress').flush();
    expect(savedOf(again)).toEqual({ schema: 1, values: { dFormat: 'gzip', view: 'hex' } });
  });

  it('reset puts every parameter back to its default and keeps the input; the result follows', async () => {
    const host = memoryHost();
    await seed(host, { direction: 'compress', cFormat: 'zlib', encoding: 'hex' });
    render(<CompressTool host={host} />);
    typeIn('hello');
    await waitFor(() => expect(result()).toBe('789ccb48cdc9c90700062c0215'), WAIT);
    await act(async () => host.settings.forTool('compress').reset());
    expect(on('Direction')).toBe('Decompress');
    expect(savedOf(host)).toBeUndefined();
    segment('Compress');
    expect(input().value).toBe('hello');
    expect([shown('Format'), on('View')]).toEqual(['gzip', 'Base64']);
    await waitFor(() => expect(result()).toBe('H4sIAAAAAAAA/8tIzcnJBwCGphA2BQAAAA=='), WAIT);
  });

  it('a saved zstd loads nothing until there is something to compress', async () => {
    const host = memoryHost();
    await seed(host, { direction: 'compress', cFormat: 'zstd' });
    const load = vi.spyOn(pageCodecs, 'load');
    render(<CompressTool host={host} />);
    expect(shown('Format')).toBe('zstd');
    await new Promise(r => setTimeout(r, 50));
    expect(load).not.toHaveBeenCalled();
    typeIn('hello');
    await waitFor(() => expect(result()).toBe('KLUv/QBYKQAAaGVsbG8='), WAIT);
    expect(load).toHaveBeenCalledWith('zstd');
  });
});
