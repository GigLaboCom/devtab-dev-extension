/**
 * The page's behaviour in jsdom (docs/tools/specs/image-convert.md §2, §6, §8, §11): what a person adds, sets, presses
 * and sees, what the history records and what an entry brings back, the saved parameters. jsdom has no canvas and no
 * createImageBitmap, so the worker's client is a stand-in that answers as the worker does; the pixels themselves are
 * the e2e's (scripts/e2e-tools/image-convert.mjs).
 */
import { definition } from './definition';
import { imageConvertHistory } from './history';
import ImageConvertTool from './ImageConvertTool';
import { imageConvertSettings } from './settings';
import { HUGE_JPEG_HEADER_BASE64, PNG_8X8_BASE64 } from './testing';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { memoryHost } from '@workspace/tools-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ConvertOptions } from './convert.worker';

const calls: Array<{ kind: string; options?: unknown; name?: string }> = [];
let failNext: string | null = null;

vi.mock('./runner', () => {
  class Cancelled extends Error {}
  return {
    Cancelled,
    createRunner: () => ({
      convert: async (_file: Blob, options: ConvertOptions) => {
        calls.push({ kind: 'convert', options });
        if (failNext) {
          const message = failNext;
          failNext = null;
          throw new Error(message);
        }
        const size =
          options.resize.mode === 'width'
            ? { width: options.resize.width, height: options.resize.width }
            : { width: 8, height: 8 };
        const blob = new Blob([new Uint8Array(40)], { type: `image/${options.format}` });
        return { blob, size, source: { width: 8, height: 8 }, notes: [] };
      },
      encode: async () => ({
        blob: new Blob([new Uint8Array(10)]),
        size: { width: 1, height: 1 },
        source: { width: 1, height: 1 },
        notes: [],
      }),
      icons: async (
        _source: unknown,
        options: { files: Array<{ name: string; size: number }>; icoSizes: number[] },
      ) => {
        calls.push({ kind: 'icons', options });
        return {
          files: [
            ...(options.icoSizes.length
              ? [{ name: 'favicon.ico', blob: new Blob([new Uint8Array(300)]), sizes: options.icoSizes }]
              : []),
            ...options.files.map(f => ({ name: f.name, blob: new Blob([new Uint8Array(f.size)]), sizes: [f.size] })),
          ],
          notes: [],
        };
      },
      zip: async (files: Array<{ name: string }>) => {
        calls.push({ kind: 'zip', name: files.map(f => f.name).join(',') });
        return new Blob([new Uint8Array(22)]);
      },
      cancel: () => undefined,
    }),
  };
});

const bytes = (b64: string) => Uint8Array.from(atob(b64), c => c.charCodeAt(0));
const png = (name = 'screen.png') => new File([bytes(PNG_8X8_BASE64)], name, { type: 'image/png' });
const picker = () => document.querySelector('input[type="file"]') as HTMLInputElement;
const add = (...files: File[]) => fireEvent.change(picker(), { target: { files } });
const choose = async (label: string, option: string) => {
  const trigger = screen.getByLabelText(label);
  fireEvent.keyDown(trigger, { key: 'Enter' });
  const item = await screen.findByRole('option', { name: option });
  fireEvent.keyDown(item, { key: 'Enter' });
  await waitFor(() => expect(screen.queryByRole('listbox')).toBeNull());
};
const convertButton = () => screen.getByRole('button', { name: 'Convert' }) as HTMLButtonElement;
const sources = () => screen.queryByRole('list', { name: 'Images' });
const results = () => screen.queryByRole('list', { name: 'Results' });
const value = (label: string) => (screen.getByLabelText(label) as HTMLInputElement).value;

let revoked: string[] = [];
let clicked: Array<{ name: string; href: string }> = [];

beforeEach(() => {
  calls.length = 0;
  failNext = null;
  revoked = [];
  clicked = [];
  let n = 0;
  URL.createObjectURL = vi.fn(() => `blob:test/${++n}`);
  URL.revokeObjectURL = vi.fn((url: string) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    clicked.push({ name: this.download, href: this.href });
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('the Image Converter tool', () => {
  it('is described by its definition, which loads it', async () => {
    expect(definition.id).toBe('image-convert');
    expect(definition.order).toBe(44);
    expect(definition.output).toEqual({ origin: 'input' });
    expect((await definition.load()).default).toBe(ImageConvertTool);
  });

  it('renders with no host at all, empty: nothing to convert, the metadata line said', () => {
    render(<ImageConvertTool />);
    expect(screen.getByRole('button', { name: 'Choose images' })).toBeTruthy();
    expect(convertButton().disabled).toBe(true);
    expect(screen.getByText('The results appear here.')).toBeTruthy();
    expect(
      screen.getByText(
        'Metadata is not copied: EXIF (camera, date and GPS location), comments and colour profiles are dropped. Colours are converted to sRGB.',
      ),
    ).toBeTruthy();
  });

  it('lists a chosen image with its facts, converts it and saves the result under the new name (§2.1)', async () => {
    render(<ImageConvertTool host={memoryHost()} />);
    add(png());
    await waitFor(() => expect(within(sources()!).getByText('PNG · 8 × 8 · 186 bytes')).toBeTruthy());
    await choose('Format', 'WebP');
    await choose('Size', 'Width');
    expect(convertButton().disabled).toBe(true);
    expect(screen.getByText('Width must be a whole number from 1 to 65,535.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '4' } });
    expect(screen.queryByText('Width must be a whole number from 1 to 65,535.')).toBeNull();
    fireEvent.click(convertButton());
    await waitFor(() => expect(within(results()!).getByText('screen.webp')).toBeTruthy());
    expect(within(results()!).getByText('WebP · 4 × 4 · 40 bytes · 22% of the original')).toBeTruthy();
    expect(calls[0]).toMatchObject({
      kind: 'convert',
      options: { format: 'webp', quality: 80, lossless: false, resize: { mode: 'width', width: 4 } },
    });
    expect(screen.getByText('Converted 1 image.')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Save screen.webp' }));
    expect(clicked).toEqual([{ name: 'screen.webp', href: expect.stringMatching(/^blob:/) }]);
    // the download's URL is revoked at once
    expect(revoked).toContain(clicked[0]!.href);
  });

  it('records one entry when Convert ends: parameters and facts, never the picture or its name (§11)', async () => {
    const host = memoryHost();
    render(<ImageConvertTool host={host} />);
    add(png('passport-scan.png'));
    await waitFor(() => expect(convertButton().disabled).toBe(false));
    fireEvent.click(convertButton());
    await waitFor(() => expect(results()).toBeTruthy());
    const history = host.history.forOwner('image-convert', imageConvertHistory);
    await waitFor(async () => expect((await history.list({})).entries).toHaveLength(1));
    const [entry] = (await history.list({})).entries;
    expect(entry!.kind).toBe('convert');
    expect(entry!.label).toBe('PNG 8 × 8 → PNG · 8 × 8 · 22% of the original');
    const opened = await history.open(entry!.id);
    expect(opened.ok && Object.keys(opened.blobs)).toEqual([]);
    expect(JSON.stringify(opened.ok && opened.payload)).not.toContain('passport');
    expect(opened.ok && opened.payload).toMatchObject({
      task: 'convert',
      format: 'png',
      files: [
        { type: 'PNG', size: { width: 8, height: 8 }, bytes: 186, out: { size: { width: 8, height: 8 }, bytes: 40 } },
      ],
    });
    // The page says what is kept while a file is there.
    expect(
      screen.getByText(
        'Kept in the history: the settings and the images’ types and sizes — never the pictures or file names.',
      ),
    ).toBeTruthy();
  });

  it('says what will not work at once, and converts the rest (§6)', async () => {
    render(<ImageConvertTool />);
    add(
      new File(['%PDF-1.7'], 'doc.pdf'),
      png('a.png'),
      png('a.png'),
      new File([bytes(HUGE_JPEG_HEADER_BASE64)], 'huge.jpg'),
    );
    await waitFor(() => expect(within(sources()!).getAllByRole('listitem')).toHaveLength(4));
    expect(
      within(sources()!).getByText('Not an image this tool reads: PNG, JPEG, WebP, GIF, BMP, ICO, AVIF or SVG.'),
    ).toBeTruthy();
    expect(
      within(sources()!).getByText(
        'The image says it is 30,000 × 30,000 pixels (900 megapixels), more than the 100 megapixels this tool decodes.',
      ),
    ).toBeTruthy();
    failNext = 'The image could not be decoded: the file may be damaged or truncated.';
    fireEvent.click(convertButton());
    await waitFor(() => expect(within(results()!).getAllByRole('listitem')).toHaveLength(2));
    // repeated names are numbered; one failed in the worker
    expect(within(results()!).getByText('a.png')).toBeTruthy();
    expect(within(results()!).getByText('a (2).png')).toBeTruthy();
    expect(
      within(results()!).getByText('The image could not be decoded: the file may be damaged or truncated.'),
    ).toBeTruthy();
    expect(screen.getByText('Converted 1 of 2 images; 1 failed.')).toBeTruthy();
  });

  it('takes at most 20 files and says so; Save all makes images.zip', async () => {
    render(<ImageConvertTool />);
    add(...Array.from({ length: 22 }, (_, i) => png(`s${i}.png`)));
    await waitFor(() => expect(within(sources()!).getAllByRole('listitem')).toHaveLength(20));
    expect(screen.getByText('Only the first 20 files are used.')).toBeTruthy();
    fireEvent.click(convertButton());
    await waitFor(() => expect(within(results()!).getAllByRole('listitem')).toHaveLength(20));
    fireEvent.click(screen.getByRole('button', { name: 'Save all (.zip)' }));
    await waitFor(() => expect(clicked.map(c => c.name)).toEqual(['images.zip']));
    expect(calls.find(c => c.kind === 'zip')?.name?.split(',')).toHaveLength(20);
  });

  it('notes that JPEG fills transparency, shows Background and Quality; Lossless switches Quality off (§5.4)', async () => {
    render(<ImageConvertTool />);
    add(png());
    await waitFor(() => expect(sources()).toBeTruthy());
    await choose('Format', 'JPEG');
    expect(
      screen.getByText('JPEG has no transparency: transparent areas are filled with the background colour.'),
    ).toBeTruthy();
    expect(value('Background')).toBe('#ffffff');
    expect(value('Quality')).toBe('85');
    fireEvent.change(screen.getByLabelText('Quality'), { target: { value: '0' } });
    expect(screen.getByText('Quality must be a whole number from 1 to 100.')).toBeTruthy();
    expect(convertButton().disabled).toBe(true);
    await choose('Format', 'WebP');
    expect(value('Quality')).toBe('80');
    fireEvent.click(screen.getByLabelText('Lossless'));
    expect((screen.getByLabelText('Quality') as HTMLInputElement).disabled).toBe(true);
    fireEvent.click(convertButton());
    await waitFor(() => expect(calls).toHaveLength(1));
    expect(calls[0]!.options).toMatchObject({ format: 'webp', lossless: true });
  });

  it('takes a pasted SVG text outside a field as pasted.svg, and a pasted image file (§5.2)', async () => {
    render(<ImageConvertTool />);
    const paste = (data: { text?: string; files?: File[] }) => {
      const event = new Event('paste', { bubbles: true, cancelable: true });
      Object.defineProperty(event, 'clipboardData', {
        value: {
          items: (data.files ?? []).map(f => ({ kind: 'file', type: f.type, getAsFile: () => f })),
          getData: () => data.text ?? '',
        },
      });
      document.body.dispatchEvent(event);
    };
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/></svg>';
    act(() => paste({ text: svg }));
    await waitFor(() => expect(within(sources()!).getByText('pasted.svg')).toBeTruthy());
    expect(within(sources()!).getByText(`SVG · 24 × 24 · ${svg.length} bytes`)).toBeTruthy();
    expect(
      within(sources()!).getByText('This SVG has no width and height: its own size comes from its viewBox (24 × 24).'),
    ).toBeTruthy();
    act(() => paste({ text: 'just words' }));
    act(() => paste({ files: [png('image.png')] }));
    await waitFor(() => expect(within(sources()!).getAllByRole('listitem')).toHaveLength(2));
  });

  it('Clear empties the list and the results', async () => {
    render(<ImageConvertTool />);
    add(png());
    await waitFor(() => expect(convertButton().disabled).toBe(false));
    fireEvent.click(convertButton());
    await waitFor(() => expect(results()).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(sources()).toBeNull();
    expect(results()).toBeNull();
  });

  it('makes icons: favicon.ico and the Favicon set by default, the markup to copy (§2.6, §5.8)', async () => {
    const host = memoryHost();
    render(<ImageConvertTool host={host} />);
    fireEvent.click(screen.getByRole('radio', { name: 'Icons' }));
    add(png('logo.png'));
    await waitFor(() => expect(screen.getByRole('list', { name: 'Source' })).toBeTruthy());
    fireEvent.click(screen.getByRole('button', { name: 'Make icons' }));
    const icons = await screen.findByRole('list', { name: 'Icons' });
    expect(
      within(icons)
        .getAllByRole('listitem')
        .map(li => li.getAttribute('data-result')),
    ).toEqual(['favicon.ico', 'favicon-16x16.png', 'favicon-32x32.png', 'apple-touch-icon.png']);
    expect(within(icons).getByText('3 images (16, 32, 48) · 300 bytes')).toBeTruthy();
    expect(calls[0]).toMatchObject({ kind: 'icons', options: { icoSizes: [16, 32, 48], icoImages: 'png' } });
    expect((screen.getByLabelText('Markup') as HTMLTextAreaElement).value).toContain(
      '<link rel="apple-touch-icon" href="/apple-touch-icon.png">',
    );
    const history = host.history.forOwner('image-convert', imageConvertHistory);
    await waitFor(async () => expect((await history.list({})).entries).toHaveLength(1));
    expect((await history.list({})).entries[0]!.label).toBe(
      'Icons from PNG 8 × 8 · favicon.ico (16, 32, 48), Favicon · 4 files',
    );
    // nothing to make
    for (const size of ['16', '32', '48']) fireEvent.click(screen.getByLabelText(size));
    fireEvent.click(screen.getByLabelText('Favicon'));
    expect(screen.getByText('Choose at least one size or set.')).toBeTruthy();
    expect((screen.getByRole('button', { name: 'Make icons' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('opens an entry with its parameters and says the images are not kept', async () => {
    const host = memoryHost();
    await host.history
      .forOwner('image-convert', imageConvertHistory)
      .session()
      .commit({
        kind: 'convert',
        label: 'PNG 8 × 8 → JPEG 70 · 4 × 4 · 22% of the original',
        payload: {
          task: 'convert',
          format: 'jpeg',
          quality: 70,
          lossless: false,
          background: '#000000',
          resize: { mode: 'percent', width: 0, height: 0, percent: 50, fit: 'contain', enlarge: false },
          files: [],
        },
      });
    const [entry] = (await host.history.forOwner('image-convert', imageConvertHistory).list({})).entries;
    render(<ImageConvertTool host={host} restore={{ id: entry!.id }} />);
    expect(
      await screen.findByText(
        'Opened from History: PNG 8 × 8 → JPEG 70 · 4 × 4 · 22% of the original. The images are not kept: choose them again.',
      ),
    ).toBeTruthy();
    expect(screen.getByLabelText('Format').textContent).toBe('JPEG');
    expect(value('Quality')).toBe('70');
    expect(value('Percentage')).toBe('50');
    expect(value('Background')).toBe('#000000');
  });
});

describe('the Image Converter’s saved parameters (D21, docs/tools/settings.md)', () => {
  const savedOf = (host: ReturnType<typeof memoryHost>) => host.settings.forTool('image-convert').saved();
  const seed = async (host: ReturnType<typeof memoryHost>, values: Record<string, unknown>) => {
    host.settings.forTool('image-convert').save(imageConvertSettings.schema, values as never);
    await host.settings.forTool('image-convert').flush();
  };

  it('opens with the defaults and saves nothing until a parameter changes; reopened, it is as left', async () => {
    const host = memoryHost();
    const first = render(<ImageConvertTool host={host} />);
    expect(screen.getByLabelText('Format').textContent).toBe('PNG');
    expect(screen.getByLabelText('Size').textContent).toBe('Original size');
    add(png());
    await waitFor(() => expect(sources()).toBeTruthy());
    await host.settings.forTool('image-convert').flush();
    expect(savedOf(host)).toBeUndefined();
    await choose('Format', 'JPEG');
    fireEvent.change(screen.getByLabelText('Quality'), { target: { value: '60' } });
    await choose('Size', 'Width and height');
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '640' } });
    fireEvent.change(screen.getByLabelText('Height'), { target: { value: '480' } });
    await choose('Fit', 'Fill and crop');
    first.unmount();
    expect(savedOf(host)).toEqual({
      schema: 1,
      values: { format: 'jpeg', jpegQuality: 60, sizeMode: 'both', width: 640, height: 480, fit: 'cover' },
    });
    render(<ImageConvertTool host={host} />);
    expect(screen.getByLabelText('Format').textContent).toBe('JPEG');
    expect(value('Quality')).toBe('60');
    expect(value('Width')).toBe('640');
    expect(screen.getByLabelText('Fit').textContent).toBe('Fill and crop');
    expect(sources()).toBeNull();
  });

  it('a saved record it cannot show falls back field by field; the rest is used', async () => {
    const host = memoryHost();
    await seed(host, {
      format: 'gif',
      webpQuality: 500,
      sizeMode: 'percent',
      percent: 40,
      background: 'red',
      task: 'x',
    });
    render(<ImageConvertTool host={host} />);
    expect(screen.getByLabelText('Format').textContent).toBe('PNG');
    expect(value('Percentage')).toBe('40');
    expect(screen.getByRole('radio', { name: 'Convert' }).getAttribute('data-state')).toBe('on');
  });

  it('an entry opened from History wins for the visit and leaves what is saved alone', async () => {
    const host = memoryHost();
    await seed(host, { format: 'webp', webpQuality: 90 });
    await host.history
      .forOwner('image-convert', imageConvertHistory)
      .session()
      .commit({
        kind: 'icons',
        label: 'Icons',
        payload: {
          task: 'icons',
          icoSizes: [32],
          icoImages: 'bmp',
          sets: ['pwa'],
          background: '#ffffff',
          source: { type: 'PNG', bytes: 1 },
          made: [],
        },
      });
    const [entry] = (await host.history.forOwner('image-convert', imageConvertHistory).list({})).entries;
    const opened = render(<ImageConvertTool host={host} restore={{ id: entry!.id }} />);
    await screen.findByText(/^Opened from History: Icons\./);
    expect(screen.getByRole('radio', { name: 'Icons' }).getAttribute('data-state')).toBe('on');
    expect(screen.getByLabelText('ICO images').textContent).toBe('BMP up to 48 px, PNG above');
    expect(screen.getByLabelText('PWA').getAttribute('data-state')).toBe('checked');
    opened.unmount();
    expect(savedOf(host)).toEqual({ schema: 1, values: { format: 'webp', webpQuality: 90 } });
  });

  it('reset puts every parameter back to its default and keeps the files', async () => {
    const host = memoryHost();
    await seed(host, { format: 'jpeg', jpegQuality: 50, sizeMode: 'width', width: 300 });
    render(<ImageConvertTool host={host} />);
    add(png());
    await waitFor(() => expect(sources()).toBeTruthy());
    fireEvent.change(screen.getByLabelText('Width'), { target: { value: '30' } });
    await act(async () => host.settings.forTool('image-convert').reset());
    expect(screen.getByLabelText('Format').textContent).toBe('PNG');
    expect(screen.getByLabelText('Size').textContent).toBe('Original size');
    expect(screen.queryByLabelText('Width')).toBeNull();
    expect(sources()).toBeTruthy();
    expect(savedOf(host)).toBeUndefined();
  });
});
